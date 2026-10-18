//! The HTTP client GPUI loads remote images with.
//!
//! Rome asks for nothing on its own behalf: no server, no account, no
//! telemetry. But the pictures a plugin collected live on someone else's
//! server, and drawing one is the reader's own act — the same act as following
//! the link at the foot of an entry. GPUI will not fetch a remote image without
//! a client and its default is a null one, so without this every picture in the
//! app — the hero at the top of an entry, the images inside it, the whole
//! Pictures view — fails silently and draws nothing at all.
//!
//! Two deliberate differences from [`crate::http`], the transport that serves
//! the plugins:
//!
//! * **No cookie jar.** A plugin's fetch is the plugin's own request, made with
//!   whatever credentials the user gave it. An `<img src>` in an entry is
//!   markup the plugin has already fetched, and the host in it was chosen by
//!   whoever wrote the feed. Sending the jar there would hand a session to a
//!   third party named by content the reader never chose. Images are fetched
//!   anonymously.
//! * **Its own runtime.** The plugin transport is driven with `block_on` on the
//!   worker thread's single-threaded runtime, and a single-threaded runtime
//!   cannot be entered from the UI thread. Image loads start from `render`, so
//!   they get a runtime of their own — a small pool, because the work is
//!   entirely waiting on sockets.
//!
//! It is also not in [`crate::http`]'s request log. That log answers "which
//! domains has this plugin touched", and an image is not the plugin touching
//! anything: it is the reader looking at what the plugin already brought back.

use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use futures::AsyncReadExt;
use gpui_kit::http_client::{AsyncBody, HttpClient, Request, Response, Url, http::HeaderValue};

/// Long enough for a large picture over a slow connection, short enough that a
/// host that never answers does not hold a slot forever.
const TIMEOUT: Duration = Duration::from_secs(20);

/// How the app identifies itself to an image host.
///
/// Its own name, not a browser's. Some hosts refuse a request with no user
/// agent at all, which is why there is one; pretending to be Chrome would be a
/// lie told to get past a rule, and the rules this app has to respect are the
/// reader's, not a CDN's.
const USER_AGENT: &str = concat!("rome/", env!("CARGO_PKG_VERSION"));

/// The client, and the runtime its sockets live on.
pub struct Images {
    client: reqwest::Client,
    runtime: tokio::runtime::Runtime,
}

impl Images {
    /// Build the client and start its runtime.
    ///
    /// Fails only if the TLS stack or the runtime cannot be created, which is a
    /// reason not to start the app at all rather than to start it without
    /// pictures — a reader who sees no images has no way to tell a broken
    /// client from a feed that has none.
    pub fn new() -> anyhow::Result<Self> {
        let client = reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(TIMEOUT)
            .build()?;

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .thread_name("rome-images")
            .build()?;

        Ok(Self { client, runtime })
    }
}

impl HttpClient for Images {
    /// Reported as absent, so GPUI does not add one of its own on top of the
    /// one reqwest is already configured with.
    fn user_agent(&self) -> Option<&HeaderValue> {
        None
    }

    /// Also absent: reqwest reads the system proxy settings itself, and saying
    /// "no proxy" here would be a second answer to a question already answered.
    fn proxy(&self) -> Option<&Url> {
        None
    }

    fn send(
        &self,
        request: Request<AsyncBody>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<Response<AsyncBody>>> + Send + 'static>> {
        let client = self.client.clone();
        let runtime = self.runtime.handle().clone();

        Box::pin(async move {
            let (parts, body) = request.into_parts();
            let (sender, receiver) = flume::bounded(1);

            // The request itself is spawned onto tokio rather than awaited
            // here: reqwest needs tokio's reactor, and this future is running
            // on GPUI's executor, which is not tokio's. The answer comes back
            // over a channel because that is a bridge that works between any
            // two executors, and `flume` is already in the tree for the UI's
            // side of the same problem.
            runtime.spawn(async move {
                let _ = sender.send(fetch(&client, parts, body).await);
            });

            receiver
                .recv_async()
                .await
                .map_err(|_| anyhow::anyhow!("the image request was dropped before it answered"))?
        })
    }
}

/// One request, in reqwest's vocabulary and back out of it.
async fn fetch(
    client: &reqwest::Client,
    parts: gpui_kit::http_client::http::request::Parts,
    body: AsyncBody,
) -> anyhow::Result<Response<AsyncBody>> {
    if parts.uri.scheme().is_none() {
        anyhow::bail!("an image URL has to be absolute, and this one is {}", parts.uri);
    }

    let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes())?;

    // Read rather than dropped, even though every caller today sends an empty
    // body. A transport that silently discards what it was asked to send is a
    // transport that will be wrong the first time something does send one.
    let mut outgoing_body = Vec::new();
    let mut body = body;
    body.read_to_end(&mut outgoing_body).await?;

    let mut outgoing = client
        .request(method, parts.uri.to_string())
        .headers(parts.headers);

    if !outgoing_body.is_empty() {
        outgoing = outgoing.body(outgoing_body);
    }

    let answer = outgoing.send().await?;
    let status = answer.status();
    let headers = answer.headers().clone();
    let bytes = answer.bytes().await?;

    // Rebuilt by hand rather than handed over: GPUI asked for a body it can
    // read asynchronously, and reqwest's streaming body is not one. The whole
    // picture is in memory by this point either way — GPUI decodes it from
    // memory — so buffering it here costs nothing that was not already spent.
    let mut response = Response::new(AsyncBody::from_bytes(bytes));
    *response.status_mut() = status;
    *response.headers_mut() = headers;

    Ok(response)
}
