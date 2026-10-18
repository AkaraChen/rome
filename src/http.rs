//! The host's HTTP transport — what a plugin's `fetch` actually runs on.
//!
//! A plugin writes an ordinary `fetch(url, init)`; the request is made here, in
//! the host process, not in the plugin runtime. That is the whole point: because
//! the host owns the socket it can attach the shared cookie jar, follow
//! redirects itself, and record which domains a plugin touched. This layer
//! restricts nothing — a plugin fetches whatever it likes, because that is the
//! user's own business — it only adds what the plugin would otherwise have to
//! reimplement, badly, for every plugin.
//!
//! Everything a plugin can see is in [`RequestInit`] and [`HttpResponse`]. The
//! jar and the log are host state, not plugin state.
//!
//! [`Http::request`] is blocking: it finishes before it returns. It is called
//! from the sidecar's read loop while the UI thread waits on a plugin, so it
//! cannot hand back a future. To stay blocking it drives its future on the
//! runtime [`Database`] already owns, via [`Database::run`], rather than
//! building a second runtime.

use std::collections::VecDeque;
use std::fmt;
use std::time::Duration;

use reqwest::header::{CONTENT_TYPE, COOKIE, HeaderMap, LOCATION, SET_COOKIE};
use reqwest::{Client, Method, Url};
use serde_json::Value;
use toasty::Db;

use crate::db::Database;
use crate::models::Cookie;
use crate::store::now;

/// The most of a response body the host will read into memory.
///
/// A plugin must not be able to pull a gigabyte into the app's address space,
/// whether by pointing at a huge file or by hitting a server that streams
/// without end. Eight MiB is far more than any feed, article or JSON API needs
/// and small enough that several concurrent fetches are unremarkable. A body
/// that would exceed it is an error ([`HttpError::BodyTooLarge`]) rather than a
/// silent truncation, because a truncated JSON body fails later as a confusing
/// parse error while an explicit size error names the real cause.
pub const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;

/// How many redirects to follow before giving up.
///
/// Redirects are followed here rather than by reqwest's built-in policy, since
/// only then can the `Set-Cookie` on a redirect be captured — and a login that
/// answers with a 302 is exactly where a session cookie arrives.
const MAX_REDIRECTS: usize = 10;

/// How many requests the in-memory log keeps.
const REQUEST_LOG_CAPACITY: usize = 512;

/// Sent when a plugin does not set its own `User-Agent`, which it may.
const USER_AGENT: &str = concat!("rome/", env!("CARGO_PKG_VERSION"));

/// Ceiling on one request, per hop.
///
/// A plugin reads someone else's site over someone else's connection, so there
/// is no honest bound on a legitimate slow response — but there is a bound on
/// how long the app will wait. reqwest applies this to each `send`, so the whole
/// redirect chain is bounded by the sidecar's own call deadline, which is set to
/// the same value for exactly that reason.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Ceiling on establishing the connection alone.
///
/// Separate from the whole-request timeout so an unreachable host fails in ten
/// seconds instead of consuming the full thirty.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// A request a plugin asked for, in the shape it writes `fetch(url, init)`.
///
/// `method` empty means `GET`, and `body` is a string because that is what the
/// plugin has: the wire protocol hands the host a string and nothing else.
#[derive(Debug, Clone, Default)]
pub struct RequestInit {
    pub method: String,
    pub headers: Vec<(String, String)>,
    pub body: Option<String>,
}

impl RequestInit {
    /// Read the `init` a plugin sent over the protocol.
    ///
    /// Headers arrive as an object rather than as pairs, because that is what
    /// `fetch` hands the harness and the harness passes on unchanged. A name
    /// that appears more than once arrives as an array of values; both
    /// spellings collapse to the same list here, which is the shape the request
    /// builder wants and the shape the wire has no room for anyway.
    pub fn from_json(value: &Value) -> Self {
        let method = value
            .get("method")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();

        let body = value
            .get("body")
            .and_then(Value::as_str)
            .map(str::to_owned);

        let mut headers = Vec::new();

        if let Some(object) = value.get("headers").and_then(Value::as_object) {
            for (name, value) in object {
                match value {
                    Value::String(text) => headers.push((name.clone(), text.clone())),
                    Value::Array(values) => {
                        for text in values.iter().filter_map(Value::as_str) {
                            headers.push((name.clone(), text.to_owned()));
                        }
                    }
                    // Anything else is not a header value; the harness has
                    // already stringified what it was given, so this is a
                    // malformed request rather than a number to convert.
                    _ => {}
                }
            }
        }

        Self {
            method,
            headers,
            body,
        }
    }
}

/// What the plugin gets back.
#[derive(Debug, Clone)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

/// Why a request failed.
///
/// Kept as an enum rather than a bare string so the caller can tell "the URL was
/// nonsense" from "the body was too big" from "the site is down" without
/// parsing a message.
#[derive(Debug)]
pub enum HttpError {
    /// The URL or method could not be parsed.
    InvalidUrl(String),
    /// The request could not be completed: DNS, TLS, connection, timeout.
    Transport(String),
    /// The body exceeded [`MAX_BODY_BYTES`].
    BodyTooLarge { limit: usize },
    /// More than [`MAX_REDIRECTS`] redirects in a row.
    TooManyRedirects,
    /// Reading or writing the cookie jar failed.
    Storage(String),
}

impl fmt::Display for HttpError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            HttpError::InvalidUrl(message) => write!(f, "invalid request: {message}"),
            HttpError::Transport(message) => write!(f, "request failed: {message}"),
            HttpError::BodyTooLarge { limit } => {
                write!(f, "response body exceeded the {limit} byte limit")
            }
            HttpError::TooManyRedirects => {
                write!(f, "too many redirects (more than {MAX_REDIRECTS})")
            }
            HttpError::Storage(message) => write!(f, "cookie storage failed: {message}"),
        }
    }
}

impl std::error::Error for HttpError {}

/// Every layer of a failure, joined by `: `, outermost first.
///
/// `reqwest`'s own `Display` is the outermost layer alone — `error sending
/// request for url (…)` — and the layer that says what actually went wrong (a
/// certificate that would not verify, a name that would not resolve, a
/// connection that was reset) is its `source`. Reporting the outer layer by
/// itself produces a message that names the URL and nothing else, which is the
/// one part of a failed fetch the caller already knew: a plugin author reading
/// `request failed: error sending request for url (…)` has nowhere to go, and
/// neither does the user the plugin reports it to. The chain is what turns that
/// into something actionable, and it costs one `to_string` per layer on a path
/// that has already failed.
fn causes(error: &(dyn std::error::Error + 'static)) -> String {
    let mut message = error.to_string();
    let mut next = error.source();

    while let Some(cause) = next {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        next = cause.source();
    }

    message
}

/// One request the host made on a plugin's behalf.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequestLog {
    /// The plugin this request was made for, or `None` for a request the host
    /// made for itself. This is what the log is for: a plugin's trust story is
    /// "here is every domain it reached", and a log without the owner can only
    /// say that a fetch happened.
    pub plugin: Option<u64>,
    pub method: String,
    pub url: String,
    /// The status the server answered with, or `None` if the request never
    /// produced a response.
    pub status: Option<u16>,
    /// Seconds since the Unix epoch, the same clock as everywhere else.
    pub at: i64,
}

/// The host's HTTP transport: one client, one shared cookie jar, one log.
///
/// It borrows the [`Database`] per call rather than owning it. The jar lives in
/// the database and the database owns the runtime that drives every request,
/// but the app owns exactly one database and this is a service over it — the
/// plugin storage service needs the same handle, so ownership cannot sit here.
pub struct Http {
    client: Client,
    /// The request log.
    ///
    /// In memory, not a table. The log answers "which domains has this plugin
    /// touched" within a session and gives a failing plugin a visible trail
    /// while the user is looking at it — both of which are about the recent
    /// past. A table would add a write to every fetch on the hot path, grow
    /// without bound, and need its own retention policy: real cost for a
    /// feature whose value has already expired. A ring buffer is bounded and
    /// O(1), and losing it on restart is the correct default for a local v1.
    /// If a durable audit trail is ever wanted, add the table then; the one
    /// place that records is already isolated.
    log: VecDeque<RequestLog>,
}

impl Default for Http {
    fn default() -> Self {
        Self::new()
    }
}

impl Http {
    /// Build the transport.
    pub fn new() -> Self {
        let client = Client::builder()
            // Redirects are followed by hand, so reqwest must not follow them:
            // an automatic redirect hides the intermediate response, and its
            // `Set-Cookie` with it.
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(USER_AGENT)
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .expect("failed to build the HTTP client");

        Self {
            client,
            log: VecDeque::with_capacity(REQUEST_LOG_CAPACITY),
        }
    }

    /// Every request made so far, oldest first, capped at
    /// [`REQUEST_LOG_CAPACITY`].
    pub fn request_log(&self) -> &VecDeque<RequestLog> {
        &self.log
    }

    /// Make one request on `plugin`'s behalf and return its response.
    ///
    /// Blocks until the response has been read or the request has failed.
    /// `db` is borrowed for the duration: the jar is read before the request
    /// and written after it, both inside the same trip through the runtime that
    /// drives the request itself.
    ///
    /// `plugin` is only for the log — it is what makes the log answer "which
    /// domains has *this* plugin touched" rather than "what has been fetched".
    /// `None` is for a request the host made for itself.
    pub fn request(
        &mut self,
        db: &mut Database,
        plugin: Option<u64>,
        url: &str,
        init: RequestInit,
    ) -> Result<HttpResponse, HttpError> {
        let method = if init.method.is_empty() {
            "GET".to_string()
        } else {
            init.method.to_ascii_uppercase()
        };
        let target = url.to_string();
        let started = now();

        let client = self.client.clone();
        let request_url = target.clone();
        let request_method = method.clone();
        let outcome = db.run(move |conn| {
            Box::pin(async move {
                send(&client, conn, &request_url, &request_method, &init, started).await
            })
        });

        self.log.push_back(RequestLog {
            plugin,
            method,
            url: target,
            status: outcome.as_ref().ok().map(|response| response.status),
            at: started,
        });
        if self.log.len() > REQUEST_LOG_CAPACITY {
            self.log.pop_front();
        }

        outcome
    }
}

/// The domains `plugin` has most recently fetched from, newest first.
///
/// Deduplicated by host, because the question this answers is "what has this
/// plugin touched", not "what did it do last": a plugin that polls one API
/// twenty times reads as one entry, not twenty. Capped at `limit` hosts, so the
/// caller can carry the result into every frame it draws without paying for a
/// history it is not showing.
///
/// The log is oldest first — [`Http::request`] pushes to the back — so this
/// walks it backwards. A URL that will not parse, or one with no host, is
/// skipped rather than ending the walk: one malformed entry must not hide the
/// domains recorded after it.
pub fn recent_domains(log: &VecDeque<RequestLog>, plugin: u64, limit: usize) -> Vec<String> {
    let mut hosts = Vec::new();

    for entry in log.iter().rev() {
        if hosts.len() >= limit {
            break;
        }

        if entry.plugin != Some(plugin) {
            continue;
        }

        let Some(host) = host_in(&entry.url) else {
            continue;
        };

        if hosts.contains(&host) {
            continue;
        }

        hosts.push(host);
    }

    hosts
}

/// Make one request, following redirects by hand and capturing cookies at every
/// hop.
///
/// Returns the final response. `init` is borrowed rather than consumed so each
/// hop can re-send the plugin's own headers.
async fn send(
    client: &Client,
    conn: &mut Db,
    url: &str,
    method: &str,
    init: &RequestInit,
    started: i64,
) -> Result<HttpResponse, HttpError> {
    let mut current = Url::parse(url).map_err(|error| HttpError::InvalidUrl(error.to_string()))?;
    let mut method = Method::from_bytes(method.as_bytes())
        .map_err(|_| HttpError::InvalidUrl(format!("unknown method {method:?}")))?;
    let mut body = init.body.clone();

    // The plugin's headers, minus the two the host owns: `Cookie` is built from
    // the jar, and `Content-Length` is derived from the body. Owned pairs
    // because a cross-host redirect has to drop the sensitive ones.
    let mut headers: Vec<(String, String)> = init
        .headers
        .iter()
        .filter(|(name, _)| {
            !name.eq_ignore_ascii_case("cookie") && !name.eq_ignore_ascii_case("content-length")
        })
        .cloned()
        .collect();

    for _ in 0..=MAX_REDIRECTS {
        let host = host_of(&current);

        // Cookies are chosen per hop: after a redirect to another host, the
        // new host's cookies are the ones that apply.
        let cookies = cookies_for(conn, &current, started).await?;

        let mut request = client.request(method.clone(), current.clone());
        if let Some(header) = cookie_header(&cookies) {
            request = request.header(COOKIE, header);
        }
        for (name, value) in &headers {
            request = request.header(name.as_str(), value.as_str());
        }
        if let Some(body) = &body {
            request = request.body(body.clone());
        }

        let response = request
            .send()
            .await
            .map_err(|error| HttpError::Transport(causes(&error)))?;
        let status = response.status();

        // Capture cookies before looking at anything else. A login answers with
        // a redirect that carries the session cookie, and that response is one
        // the plugin never sees.
        for value in response.headers().get_all(SET_COOKIE) {
            let Ok(value) = value.to_str() else { continue };
            if let Some(jar) = parse_set_cookie(&host, current.path(), value, started) {
                store_cookie(conn, jar).await?;
            }
        }

        if status.is_redirection() {
            let location = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);

            if let Some(location) = location {
                let next = current
                    .join(&location)
                    .map_err(|_| HttpError::InvalidUrl(location.clone()))?;
                if host_of(&next) != host {
                    // A redirect to another host must not carry the plugin's
                    // credentials with it. reqwest does this for its own
                    // redirects; following them by hand means doing it here.
                    headers.retain(|(name, _)| !is_sensitive_header(name));
                }
                if redirect_forces_get(status.as_u16(), &method) {
                    method = Method::GET;
                    body = None;
                }
                current = next;
                continue;
            }
        }

        let headers = collect_headers(response.headers());
        let body = read_body(response, MAX_BODY_BYTES).await?;
        return Ok(HttpResponse {
            status: status.as_u16(),
            headers,
            body,
        });
    }

    Err(HttpError::TooManyRedirects)
}

/// Whether a redirect turns the request into a `GET` with no body.
///
/// 303 always does. 301 and 302 do for a POST — the long-standing browser
/// behaviour, which servers rely on — while 307 and 308 exist precisely to
/// preserve the method and body, so they never do.
fn redirect_forces_get(status: u16, method: &Method) -> bool {
    match status {
        303 => true,
        301 | 302 => *method == Method::POST,
        _ => false,
    }
}

/// Whether a header carries credentials that must not follow a redirect to
/// another host.
///
/// `Cookie` is not here because a plugin's own `Cookie` header is dropped up
/// front and the host's jar cookies are re-selected per hop.
fn is_sensitive_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("authorization")
        || name.eq_ignore_ascii_case("proxy-authorization")
        || name.eq_ignore_ascii_case("www-authenticate")
}

/// Read a response body, refusing to exceed `limit` bytes.
///
/// The body is streamed in chunks rather than read whole, because a cap that
/// only applies after the whole body is already in memory is no cap at all.
/// The charset comes from the `Content-Type` header; anything unrecognised is
/// treated as UTF-8.
async fn read_body(response: reqwest::Response, limit: usize) -> Result<String, HttpError> {
    let charset = response_charset(response.headers());
    let mut response = response;
    let mut bytes: Vec<u8> = Vec::new();

    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| HttpError::Transport(causes(&error)))?
    {
        if bytes.len() + chunk.len() > limit {
            return Err(HttpError::BodyTooLarge { limit });
        }
        bytes.extend_from_slice(&chunk);
    }

    let encoding = charset
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(&bytes);

    Ok(text.into_owned())
}

/// The `charset` from a `Content-Type` header, if it names one.
fn response_charset(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(CONTENT_TYPE)?.to_str().ok()?;
    for part in value.split(';') {
        if let Some((key, value)) = part.split_once('=')
            && key.trim().eq_ignore_ascii_case("charset")
        {
            return Some(value.trim().trim_matches('"').to_string());
        }
    }
    None
}

/// The response's headers as owned pairs.
fn collect_headers(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                value.to_str().unwrap_or_default().to_string(),
            )
        })
        .collect()
}

/// The request host, lower-cased. Empty for a URL with no host.
fn host_of(url: &Url) -> String {
    url.host_str().unwrap_or_default().to_ascii_lowercase()
}

/// The host of a URL string, lower-cased, or `None` if it has none.
///
/// [`host_of`] reads a parsed [`Url`]; a log entry keeps the URL as the string
/// the plugin asked for, so it is parsed here, and one that will not parse has
/// no host to report.
fn host_in(url: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    let host = host_of(&parsed);
    (!host.is_empty()).then_some(host)
}

/// A host and all of its parent domains, most specific first.
///
/// `a.b.example.com` yields `a.b.example.com`, `b.example.com`, `example.com`,
/// `com`. These are exactly the domains a cookie could have been stored under
/// that would apply to this host, so they are the rows worth asking the
/// database for. Public-suffix rules are not implemented: without them a server
/// could in principle set a cookie for a whole TLD, which is a known gap shared
/// with any RFC 6265 implementation that ships no suffix list.
fn domain_candidates(host: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut rest = host;
    loop {
        candidates.push(rest.to_string());
        match rest.split_once('.') {
            Some((_, tail)) => rest = tail,
            None => break,
        }
    }
    candidates
}

/// The cookies that apply to a request for `url`.
async fn cookies_for(conn: &mut Db, url: &Url, at: i64) -> Result<Vec<Cookie>, HttpError> {
    let host = host_of(url);
    if host.is_empty() {
        return Ok(Vec::new());
    }
    let path = url.path();
    let secure = url.scheme() == "https";

    let mut found = Vec::new();
    for domain in domain_candidates(&host) {
        let mut rows = Cookie::filter_by_domain(&domain)
            .exec(&mut *conn)
            .await
            .map_err(storage)?;
        found.append(&mut rows);
    }

    found.retain(|cookie| {
        let jar = JarCookie::from(cookie);
        !is_expired(jar.expires_at, at)
            && domain_matches(&host, &jar.domain, jar.host_only)
            && path_matches(&jar.path, path)
            && (!jar.secure || secure)
    });

    Ok(found)
}

/// The `Cookie` request header for a set of stored cookies, or `None` if there
/// are none.
///
/// Ordered the way RFC 6265 §5.4 asks — longer paths first, then older cookies
/// first — so a server that reads only the first value sees the most specific.
fn cookie_header(cookies: &[Cookie]) -> Option<String> {
    if cookies.is_empty() {
        return None;
    }

    let mut ordered: Vec<&Cookie> = cookies.iter().collect();
    ordered.sort_by(|a, b| {
        b.path
            .len()
            .cmp(&a.path.len())
            .then(a.created_at.cmp(&b.created_at))
    });

    let mut header = String::new();
    for (index, cookie) in ordered.iter().enumerate() {
        if index > 0 {
            header.push_str("; ");
        }
        header.push_str(&cookie.name);
        header.push('=');
        header.push_str(&cookie.value);
    }
    Some(header)
}

/// Write one parsed cookie into the jar, replacing or deleting as the policy
/// requires.
async fn store_cookie(conn: &mut Db, jar: JarCookie) -> Result<(), HttpError> {
    let timestamp = now();
    let expired = is_expired(jar.expires_at, timestamp);

    // Only cookies already stored under this exact domain can collide with the
    // new one, so the index on `domain` answers the whole question.
    let rows = Cookie::filter_by_domain(&jar.domain)
        .exec(&mut *conn)
        .await
        .map_err(storage)?;
    let existing = rows
        .into_iter()
        .find(|cookie| same_cookie(cookie, &jar));

    match existing {
        // A past expiry, or a non-positive `Max-Age`, is how a server deletes a
        // cookie: remove the stored one instead of adding this one.
        Some(record) if expired => record.delete().exec(&mut *conn).await.map_err(storage),
        Some(mut record) => toasty::update!(record {
            value: jar.value,
            host_only: jar.host_only,
            expires_at: jar.expires_at,
            secure: jar.secure,
            http_only: jar.http_only,
        })
        .exec(&mut *conn)
        .await
        .map_err(storage),
        None if expired => Ok(()),
        None => toasty::create!(Cookie {
            domain: jar.domain,
            path: jar.path,
            name: jar.name,
            value: jar.value,
            host_only: jar.host_only,
            expires_at: jar.expires_at,
            secure: jar.secure,
            http_only: jar.http_only,
            created_at: timestamp,
        })
        .exec(&mut *conn)
        .await
        .map(|_| ())
        .map_err(storage),
    }
}

fn storage(error: toasty::Error) -> HttpError {
    HttpError::Storage(error.to_string())
}

/// Write a cookie harvested by the login window into the jar.
///
/// The login window is the one place a cookie is born outside this client, and
/// it has to land in exactly the same jar: a site signed in through the window
/// and the same site fetched by a plugin must agree on what the session is, or
/// the plugin reads a logged-out page while the user is looking at their own
/// account. Reusing [`store_cookie`] rather than a second insert is what keeps
/// that true — the replacement and expiry rules are the same ones a
/// `Set-Cookie` gets.
pub fn remember(db: &mut Database, cookie: JarCookie) -> Result<(), HttpError> {
    db.run(|conn| Box::pin(store_cookie(conn, cookie)))
}

/// The identity of a cookie for replacement: RFC 6265 §5.3 step 11 replaces a
/// stored cookie with the same name, domain and path.
///
/// Host-only is deliberately *not* part of the identity, so a `Domain` cookie
/// replaces a host-only one of the same name — the two have the same domain
/// string, and the spec compares no more than that.
fn same_cookie(cookie: &Cookie, jar: &JarCookie) -> bool {
    cookie.name == jar.name && cookie.domain == jar.domain && cookie.path == jar.path
}

/// A cookie as the policy sees it, independent of storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JarCookie {
    pub domain: String,
    pub path: String,
    pub name: String,
    pub value: String,
    pub host_only: bool,
    pub expires_at: Option<i64>,
    pub secure: bool,
    pub http_only: bool,
}

impl From<&Cookie> for JarCookie {
    fn from(cookie: &Cookie) -> Self {
        Self {
            domain: cookie.domain.clone(),
            path: cookie.path.clone(),
            name: cookie.name.clone(),
            value: cookie.value.clone(),
            host_only: cookie.host_only,
            expires_at: cookie.expires_at,
            secure: cookie.secure,
            http_only: cookie.http_only,
        }
    }
}

/// Parse one `Set-Cookie` header value into a [`JarCookie`], applying RFC 6265's
/// defaults.
///
/// Parsing is delegated to the `cookie` crate — the part that is genuinely
/// fiddly and easy to get subtly wrong: attribute casing, quoted values, a
/// negative `Max-Age`, four different date formats. Everything above it (domain
/// and path matching, expiry, replacement) is ours, because that is the policy
/// worth being able to read in one place.
///
/// `host` and `request_path` fill in the defaults a header may omit: a cookie
/// with no `Domain` is host-only, and one with no `Path` takes the request's
/// default path. Returns `None` for a header the parser rejects, or a `Domain`
/// the request host is not allowed to set — a server may only set cookies for a
/// domain that covers it.
fn parse_set_cookie(host: &str, request_path: &str, header: &str, at: i64) -> Option<JarCookie> {
    let parsed = cookie::Cookie::parse(header).ok()?;
    if parsed.name().is_empty() {
        return None;
    }

    let (domain, host_only) = match parsed.domain() {
        Some(attribute) => {
            let domain = normalize_domain(attribute);
            if domain.is_empty() || !domain_matches(host, &domain, false) {
                return None;
            }
            (domain, false)
        }
        None => (host.to_string(), true),
    };

    let path = match parsed.path() {
        Some(path) if path.starts_with('/') => path.to_string(),
        _ => default_path(request_path),
    };

    // `Max-Age` wins over `Expires` when both are present (RFC 6265 §5.3). A
    // non-positive `Max-Age` means "delete": an expiry one second in the past,
    // which `store_cookie` turns into a removal.
    let expires_at = match parsed.max_age() {
        Some(age) => {
            let seconds = age.whole_seconds();
            Some(if seconds <= 0 { at - 1 } else { at + seconds })
        }
        None => match parsed.expires() {
            Some(cookie::Expiration::DateTime(when)) => Some(when.unix_timestamp()),
            _ => None,
        },
    };

    Some(JarCookie {
        domain,
        path,
        name: parsed.name().to_string(),
        value: parsed.value().to_string(),
        host_only,
        expires_at,
        secure: parsed.secure().unwrap_or(false),
        http_only: parsed.http_only().unwrap_or(false),
    })
}

/// Lower-case a `Domain` attribute and strip its surrounding dots, so
/// `.example.com` and `example.com.` both normalise to `example.com`.
fn normalize_domain(value: &str) -> String {
    value.trim().trim_matches('.').to_ascii_lowercase()
}

/// RFC 6265 §5.1.3 domain-match.
///
/// A host-only cookie matches only its exact host. A domain cookie matches its
/// domain and that domain's subdomains, but only at a label boundary, so
/// `example.com` matches `a.example.com` and not `notexample.com`.
fn domain_matches(host: &str, cookie_domain: &str, host_only: bool) -> bool {
    if host == cookie_domain {
        return true;
    }
    if host_only {
        return false;
    }
    match host.len().checked_sub(cookie_domain.len()) {
        Some(offset) if offset >= 1 => {
            host.get(..offset).is_some_and(|prefix| prefix.ends_with('.'))
                && host.get(offset..) == Some(cookie_domain)
        }
        _ => false,
    }
}

/// RFC 6265 §5.1.4 path-match.
///
/// The cookie path is a prefix of the request path only at a `/` boundary:
/// `/foo` matches `/foo/bar` but not `/foobar`.
fn path_matches(cookie_path: &str, request_path: &str) -> bool {
    if cookie_path == request_path {
        return true;
    }
    match request_path.strip_prefix(cookie_path) {
        Some(rest) => cookie_path.ends_with('/') || rest.starts_with('/'),
        None => false,
    }
}

/// RFC 6265 §5.1.4 default-path: the request path up to but not including its
/// last `/`, or `/` when there is none.
fn default_path(request_path: &str) -> String {
    if !request_path.starts_with('/') {
        return "/".to_string();
    }
    match request_path.rfind('/') {
        Some(0) | None => "/".to_string(),
        Some(index) => request_path[..index].to_string(),
    }
}

/// Whether a cookie has expired as of `at`.
///
/// `None` is a session cookie, which this jar keeps rather than dropping at
/// exit: a session cookie is exactly what most logins hand back, so discarding
/// them would mean re-authenticating every site on every launch — the opposite
/// of what a shared jar is for.
fn is_expired(expires_at: Option<i64>, at: i64) -> bool {
    matches!(expires_at, Some(when) if when <= at)
}

#[cfg(test)]
mod tests {
    use super::*;

    // The clock the tests pretend it is; any fixed value does, since the
    // functions only compare against it.
    const NOW: i64 = 1_700_000_000;

    // -- domain matching ----------------------------------------------------

    #[test]
    fn host_only_cookie_matches_only_its_host() {
        assert!(domain_matches("example.com", "example.com", true));
        assert!(!domain_matches("a.example.com", "example.com", true));
        assert!(!domain_matches("example.com", "a.example.com", true));
    }

    #[test]
    fn domain_cookie_matches_subdomains() {
        assert!(domain_matches("example.com", "example.com", false));
        assert!(domain_matches("a.example.com", "example.com", false));
        assert!(domain_matches("a.b.example.com", "example.com", false));
    }

    #[test]
    fn domain_match_respects_label_boundaries() {
        // The whole point of the boundary check: a suffix that is not a label
        // suffix must not match.
        assert!(!domain_matches("notexample.com", "example.com", false));
        assert!(!domain_matches("example.com.evil.com", "example.com", false));
        assert!(!domain_matches("com", "example.com", false));
    }

    // -- path matching ------------------------------------------------------

    #[test]
    fn path_matches_exact_and_prefix() {
        assert!(path_matches("/", "/"));
        assert!(path_matches("/", "/anything"));
        assert!(path_matches("/foo", "/foo"));
        assert!(path_matches("/foo", "/foo/bar"));
        assert!(path_matches("/foo/", "/foo/bar"));
    }

    #[test]
    fn path_match_respects_segment_boundaries() {
        assert!(!path_matches("/foo", "/foobar"));
        assert!(!path_matches("/foo", "/fooey/bar"));
        assert!(!path_matches("/foo/bar", "/foo"));
        assert!(!path_matches("/bar", "/foo/bar"));
    }

    #[test]
    fn default_path_follows_rfc() {
        assert_eq!(default_path("/a/b/c"), "/a/b");
        assert_eq!(default_path("/a"), "/");
        assert_eq!(default_path("/"), "/");
        assert_eq!(default_path(""), "/");
        // A path that does not start with `/` has no default path but the root.
        assert_eq!(default_path("a/b"), "/");
    }

    // -- expiry -------------------------------------------------------------

    #[test]
    fn session_cookies_never_expire() {
        assert!(!is_expired(None, NOW));
        assert!(!is_expired(None, i64::MAX));
    }

    #[test]
    fn expiry_is_inclusive_of_the_present() {
        assert!(!is_expired(Some(NOW + 1), NOW));
        assert!(is_expired(Some(NOW), NOW));
        assert!(is_expired(Some(NOW - 1), NOW));
    }

    // -- Set-Cookie parsing -------------------------------------------------

    #[test]
    fn parses_a_bare_cookie_as_host_only() {
        let jar = parse_set_cookie("example.com", "/a/b", "sid=abc", NOW).unwrap();
        assert_eq!(jar.name, "sid");
        assert_eq!(jar.value, "abc");
        assert_eq!(jar.domain, "example.com");
        assert!(jar.host_only);
        assert_eq!(jar.path, "/a"); // default-path of /a/b
        assert_eq!(jar.expires_at, None); // session cookie
        assert!(!jar.secure);
        assert!(!jar.http_only);
    }

    #[test]
    fn parses_a_domain_attribute_and_strips_its_dot() {
        let jar = parse_set_cookie("a.example.com", "/", "sid=1; Domain=.Example.COM", NOW).unwrap();
        // `.Example.COM` normalises to lower-case with no leading dot.
        assert_eq!(jar.domain, "example.com");
        assert!(!jar.host_only);
    }

    #[test]
    fn rejects_a_domain_the_host_cannot_set() {
        // example.com may not set a cookie for another.com ...
        assert!(parse_set_cookie("example.com", "/", "sid=1; Domain=other.com", NOW).is_none());
        // ... nor for a domain that only looks like a suffix of it.
        assert!(parse_set_cookie("notexample.com", "/", "sid=1; Domain=example.com", NOW).is_none());
    }

    #[test]
    fn attribute_names_are_case_insensitive() {
        let jar = parse_set_cookie(
            "example.com",
            "/",
            "sid=1; dOmAiN=.example.com; pAtH=/x; SeCuRe; HttpOnLy",
            NOW,
        )
        .unwrap();
        assert_eq!(jar.domain, "example.com");
        assert_eq!(jar.path, "/x");
        assert!(jar.secure);
        assert!(jar.http_only);
    }

    #[test]
    fn max_age_wins_over_expires() {
        let header = "sid=1; Max-Age=60; Expires=Wed, 01 Jan 2100 00:00:00 GMT";
        let jar = parse_set_cookie("example.com", "/", header, NOW).unwrap();
        assert_eq!(jar.expires_at, Some(NOW + 60));
    }

    #[test]
    fn a_past_expires_is_kept_as_an_expiry_not_dropped() {
        // The store turns a past expiry into a delete, so parsing must not
        // swallow it.
        let header = "sid=1; Expires=Thu, 01 Jan 1970 00:00:01 GMT";
        let jar = parse_set_cookie("example.com", "/", header, NOW).unwrap();
        assert_eq!(jar.expires_at, Some(1));
        assert!(is_expired(jar.expires_at, NOW));
    }

    #[test]
    fn a_non_positive_max_age_is_an_expiry_in_the_past() {
        let jar = parse_set_cookie("example.com", "/", "sid=1; Max-Age=0", NOW).unwrap();
        assert!(is_expired(jar.expires_at, NOW));
        let jar = parse_set_cookie("example.com", "/", "sid=1; Max-Age=-5", NOW).unwrap();
        assert!(is_expired(jar.expires_at, NOW));
    }

    #[test]
    fn a_quoted_value_survives_parsing() {
        let jar = parse_set_cookie("example.com", "/", "sid=\"a b\"", NOW).unwrap();
        assert_eq!(jar.value, "\"a b\"");
    }

    #[test]
    fn an_explicit_path_is_used_and_must_start_with_a_slash() {
        let jar = parse_set_cookie("example.com", "/a/b", "sid=1; Path=/deep", NOW).unwrap();
        assert_eq!(jar.path, "/deep");
        // A path not starting with `/` is not a valid path attribute, so the
        // default path applies.
        let jar = parse_set_cookie("example.com", "/a/b", "sid=1; Path=deep", NOW).unwrap();
        assert_eq!(jar.path, "/a");
    }

    #[test]
    fn a_header_with_no_name_value_pair_is_rejected() {
        assert!(parse_set_cookie("example.com", "/", "justaname", NOW).is_none());
        assert!(parse_set_cookie("example.com", "/", "=value", NOW).is_none());
    }

    // -- replacement --------------------------------------------------------

    #[test]
    fn same_name_domain_and_path_is_a_replacement() {
        let stored = cookie_record("sid", "example.com", "/", false);
        let incoming = parse_set_cookie("example.com", "/", "sid=fresh", NOW).unwrap();
        assert!(same_cookie(&stored, &incoming));
    }

    #[test]
    fn a_different_path_or_name_or_domain_is_a_new_cookie() {
        let stored = cookie_record("sid", "example.com", "/", false);

        assert!(!same_cookie(&stored, &jar("sid", "example.com", "/a", false)));
        assert!(!same_cookie(&stored, &jar("token", "example.com", "/", false)));
        assert!(!same_cookie(&stored, &jar("sid", "a.example.com", "/", false)));
    }

    #[test]
    fn a_domain_cookie_replaces_a_host_only_one_of_the_same_name() {
        // RFC 6265 §5.3 step 11 replaces on name, domain and path alone, so a
        // domain cookie overwrites a host-only one of the same name.
        let stored = cookie_record("sid", "example.com", "/", true);
        let incoming = parse_set_cookie("example.com", "/", "sid=1; Domain=example.com", NOW).unwrap();
        assert!(same_cookie(&stored, &incoming));
    }

    #[test]
    fn parse_defaults_agree_with_stored_identity() {
        // A host-only cookie stored with the request's default path must be
        // recognised as the same cookie a later bare `Set-Cookie` names.
        let stored = cookie_record("sid", "example.com", "/a", false);
        let incoming = parse_set_cookie("example.com", "/a/b", "sid=2", NOW).unwrap();
        assert_eq!(incoming.path, "/a");
        assert!(same_cookie(&stored, &incoming));
    }

    // -- redirects ----------------------------------------------------------

    #[test]
    fn redirect_method_rules() {
        assert!(redirect_forces_get(303, &Method::POST));
        assert!(redirect_forces_get(303, &Method::GET));
        assert!(redirect_forces_get(301, &Method::POST));
        assert!(redirect_forces_get(302, &Method::POST));
        // A GET stays a GET, and 307/308 preserve the method either way.
        assert!(!redirect_forces_get(301, &Method::GET));
        assert!(!redirect_forces_get(302, &Method::GET));
        assert!(!redirect_forces_get(307, &Method::POST));
        assert!(!redirect_forces_get(308, &Method::POST));
    }

    #[test]
    fn credentials_are_recognised_for_stripping() {
        assert!(is_sensitive_header("Authorization"));
        assert!(is_sensitive_header("authorization"));
        assert!(is_sensitive_header("Proxy-Authorization"));
        assert!(!is_sensitive_header("Accept"));
        // `Cookie` is handled separately: the host builds it from the jar.
        assert!(!is_sensitive_header("Cookie"));
    }

    // -- helpers ------------------------------------------------------------

    #[test]
    fn domain_candidates_walk_up_the_host() {
        assert_eq!(
            domain_candidates("a.b.example.com"),
            ["a.b.example.com", "b.example.com", "example.com", "com"]
        );
        assert_eq!(domain_candidates("localhost"), ["localhost"]);
    }

    #[test]
    fn cookie_header_orders_longer_paths_first() {
        let mut short = cookie_record("a", "example.com", "/", false);
        short.created_at = 10;
        let mut long = cookie_record("b", "example.com", "/deep", false);
        long.created_at = 20;

        let header = cookie_header(&[short, long]).unwrap();
        assert_eq!(header, "b=value; a=value");
    }

    #[test]
    fn cookie_header_is_none_without_cookies() {
        assert!(cookie_header(&[]).is_none());
    }

    #[test]
    fn normalize_domain_lowercases_and_strips_dots() {
        assert_eq!(normalize_domain(".Example.COM"), "example.com");
        assert_eq!(normalize_domain("example.com."), "example.com");
        assert_eq!(normalize_domain("  example.com  "), "example.com");
    }

    /// A stored cookie, for the tests that need one. Only the fields the policy
    /// reads are meaningful here.
    fn cookie_record(name: &str, domain: &str, path: &str, host_only: bool) -> Cookie {
        Cookie {
            id: 0,
            domain: domain.to_string(),
            path: path.to_string(),
            name: name.to_string(),
            value: "value".to_string(),
            host_only,
            expires_at: None,
            secure: false,
            http_only: false,
            created_at: 0,
        }
    }

    /// A jar cookie, for the tests that need one without going through parsing.
    fn jar(name: &str, domain: &str, path: &str, host_only: bool) -> JarCookie {
        JarCookie {
            domain: domain.to_string(),
            path: path.to_string(),
            name: name.to_string(),
            value: "value".to_string(),
            host_only,
            expires_at: None,
            secure: false,
            http_only: false,
        }
    }
}
