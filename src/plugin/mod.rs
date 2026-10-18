//! The plugin runtime and the wire protocol it speaks.
//!
//! A plugin is JavaScript, so something has to run it, and that something is a
//! `tjs` child process ([`sidecar`]). The two processes talk in
//! newline-delimited JSON: one object per line, over the child's stdin and
//! stdout.
//!
//! ```text
//! Request:  {"id": <u64>, "method": "<name>", "params": <object>}
//! Response: {"id": <u64>, "result": <any>}
//!           {"id": <u64>, "error": {"message": "<string>"}}
//! ```
//!
//! Both directions use both shapes, and each side numbers its own requests from
//! one — so an `id` on its own does not say which way a line is going. Only a
//! request carries `method`, and that is the discriminator
//! [`HostRequest::parse`] keys on.
//!
//! Host to plugin:
//!
//! ```text
//! describe   {}                                                        -> {"meta": {...}, "settings": {...}, "hooks": {...}}
//! fetch      {"settings": {...}, "params": {...}, "cursor": <str|null>} -> {"entries": [...], "cursor": <str|null>}
//! preview    {"settings": {...}, "params": {...}, "item": {...}}       -> {"content": "<html>"} | null
//! activate   {"settings": {...}, "params": {...}}                       -> null
//! deactivate {}                                                        -> null
//! ```
//!
//! Plugin to host. These arrive *while the host is waiting on one of the above*
//! — the plugin is blocked on the reply — which is why
//! [`sidecar::Sidecar::call`] dispatches them instead of reading past them:
//!
//! ```text
//! http        {"url": "...", "init": {"method"?, "headers"?, "body"?}} -> {"status": <u16>, "headers": {...}, "body": "<string>"}
//! article     {"url": "..."}                                           -> "<html>" | null
//! ui          {"kind": "alert"|"confirm"|"prompt"|"notify"|"form"|"pick"|"login", ...} -> whatever the dialog returns
//! storage.get {"key": "..."}                                           -> <any|null>
//! storage.set {"key": "...", "value": <any>}                           -> null
//! log         {"level": "debug"|"info"|"warn"|"error", "message": "..."} -> null
//! ```

pub mod session;
pub mod sidecar;

use serde_json::Value;

/// The method names, in one place, so neither side spells them out as literals.
pub mod method {
    // Host to plugin.
    pub const DESCRIBE: &str = "describe";
    pub const FETCH: &str = "fetch";
    pub const PREVIEW: &str = "preview";
    pub const ACTIVATE: &str = "activate";
    pub const DEACTIVATE: &str = "deactivate";

    // Plugin to host.
    pub const HTTP: &str = "http";
    pub const ARTICLE: &str = "article";
    pub const UI: &str = "ui";
    pub const STORAGE_GET: &str = "storage.get";
    pub const STORAGE_SET: &str = "storage.set";
    pub const LOG: &str = "log";
}

/// A dialog a plugin asked the host to show.
///
/// This is the whole of a plugin's interface vocabulary. A plugin cannot draw —
/// it can only ask for one of these — which is what keeps every plugin's login
/// page and settings page looking like Rome instead of like the plugin, and is
/// the only way "plugins can be interactive" and "the interface stays coherent"
/// are true at the same time.
///
/// The variants are exactly what the harness offers; there is no `progress` or
/// `openExternal` here because the runtime does not expose one.
#[derive(Debug, Clone, PartialEq)]
pub enum DialogRequest {
    /// Tell the user something. Blocks until they dismiss it.
    Alert { message: String },
    /// Ask a yes/no question.
    Confirm { message: String },
    /// Ask for one line of text. `secret` means the answer should not be shown
    /// as it is typed.
    Prompt {
        message: String,
        title: Option<String>,
        placeholder: Option<String>,
        secret: bool,
    },
    /// A toast. The plugin is *not* waiting on the user for this one: it is
    /// told nothing and carries straight on.
    Notify { message: String, level: String },
    /// A form built from `schema`, in the same shape a plugin's settings use.
    Form { schema: Value },
    /// Choose one of `items`, handed straight back — the host does not
    /// understand them and has no business trying.
    Pick { items: Vec<Value> },
    /// Let the user log in to `url` in a native window.
    ///
    /// The only request that is a web page rather than a form. A login page is
    /// JavaScript, a captcha and a second factor, and none of those survive
    /// being flattened into a form schema; the host opens a real webview and
    /// copies the cookies it collects into the jar the plugin's own requests
    /// read. The answer is whether the user said they were finished.
    Login { url: String },
    /// Say how far along a long job is, or — with no message — that it is over.
    ///
    /// A report rather than a question, and the only one of these that is
    /// stateful: it replaces whatever the last report said rather than joining
    /// it, which is what makes a stream of them read as one bar filling up
    /// instead of a stack of toasts. `value` is 0..=1, or `None` for a job
    /// whose size is not known yet.
    Progress {
        message: Option<String>,
        value: Option<f32>,
    },
    /// Open `url` in the user's own browser.
    ///
    /// The plugin runtime has no DOM and no way to start a program, so a plugin
    /// that wants the reader to see a page has to ask. Only http(s) is opened:
    /// the host will not hand a `file://` or a custom scheme to the system
    /// opener, because the URL came from the plugin rather than from the user.
    OpenExternal { url: String },
}

impl DialogRequest {
    /// Read a `ui` request, or `None` if it is not one this host knows.
    pub fn parse(params: &Value) -> Option<Self> {
        let text = |key: &str| params.get(key).and_then(Value::as_str).map(str::to_owned);

        Some(match params.get("kind")?.as_str()? {
            "alert" => Self::Alert {
                message: text("message").unwrap_or_default(),
            },
            "confirm" => Self::Confirm {
                message: text("message").unwrap_or_default(),
            },
            "prompt" => Self::Prompt {
                message: text("message").unwrap_or_default(),
                title: text("title"),
                placeholder: text("placeholder"),
                secret: params
                    .get("secret")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            },
            "notify" => Self::Notify {
                message: text("message").unwrap_or_default(),
                level: text("level").unwrap_or_else(|| "info".to_owned()),
            },
            "form" => Self::Form {
                schema: params.get("schema").cloned().unwrap_or(Value::Null),
            },
            "pick" => Self::Pick {
                items: params
                    .get("items")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default(),
            },
            // No `url` is not a request the host can fulfil, and an empty
            // window would be worse than an error the plugin can report.
            "login" => Self::Login { url: text("url")? },
            "progress" => Self::Progress {
                // An absent message is the instruction, not a missing field:
                // it is how the plugin says the job is finished and the bar
                // should go away.
                message: text("message"),
                value: params
                    .get("value")
                    .and_then(Value::as_f64)
                    // Clamped rather than refused. A plugin that computes
                    // 1.0000001 from a division should get a full bar, not an
                    // error it has no idea how to handle.
                    .map(|value| value.clamp(0.0, 1.0) as f32),
            },
            "openExternal" => Self::OpenExternal { url: text("url")? },
            _ => return None,
        })
    }

    /// Whether the plugin is waiting for the user, or can be answered at once.
    ///
    /// A toast is not a question. Making the plugin block on one would let a
    /// progress-style plugin stall itself behind a notification nobody is
    /// looking at — which is the same reason a progress report and a request to
    /// open a browser come back immediately: the host answers those by doing
    /// them.
    pub fn is_blocking(&self) -> bool {
        !matches!(
            self,
            Self::Notify { .. } | Self::Progress { .. } | Self::OpenExternal { .. }
        )
    }
}

/// A request the plugin sent to the host.
///
/// These arrive inside [`sidecar::Sidecar::call`], between the host's request
/// and the plugin's answer to it. The plugin is blocked until the host replies,
/// so the handler has to answer there and then — queueing one for a later turn
/// would deadlock the plugin, which is waiting on the queue.
#[derive(Debug, Clone, PartialEq)]
pub struct HostRequest {
    /// The plugin's id for this request.
    ///
    /// It comes from the plugin's own counter, so it can collide with the id of
    /// the host call currently in flight; nothing may key on `id` alone.
    pub id: u64,
    pub method: String,
    /// `null` when the plugin sent no params, which the protocol allows.
    pub params: Value,
}

impl HostRequest {
    /// Read a request out of a decoded protocol line, or `None` if the line is
    /// not one — in which case the caller is holding a response.
    ///
    /// The test is for `method`. A response never carries one, and an `id`
    /// cannot distinguish the two: the plugin allocates its own ids, so one of
    /// its requests routinely shares a number with the host call it is
    /// interrupting.
    pub(crate) fn parse(line: &Value) -> Option<Self> {
        let id = line.get("id")?.as_u64()?;
        let method = line.get("method")?.as_str()?.to_owned();

        Some(Self {
            id,
            method,
            params: line.get("params").cloned().unwrap_or(Value::Null),
        })
    }

    /// Whether answering this request means waiting for a person.
    ///
    /// The call that is in flight has a deadline, and that deadline exists to
    /// stop a plugin that hangs. A user deciding what to type into a form is
    /// not a hung plugin, so the time spent on this request is given back to
    /// the plugin rather than charged against it — see
    /// [`sidecar::Sidecar::call`](crate::plugin::sidecar::Sidecar::call).
    pub fn waits_for_user(&self) -> bool {
        self.method == method::UI
    }
}
