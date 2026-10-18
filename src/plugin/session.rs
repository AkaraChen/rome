//! Running a plugin: a stored plugin row in, entries in the database out.
//!
//! [`refresh_source`] is the whole of a refresh — load the rows, run the plugin
//! in a [`Session`], fold what it returned into the store, record how it went.
//! Keeping that in one function is what makes a manual refresh, a scheduled one
//! and a test behave identically, including how a failure is recorded; a caller
//! that assembled the steps itself would be free to skip the recording, and a
//! source that failed without saying so is exactly what the sidebar cannot show.
//!
//! Everything here blocks. A plugin is a child process the host waits on, so a
//! refresh must not run on the thread that draws the window.

use std::path::Path;

use serde_json::{Value, json};

use crate::db::Database;
use crate::http::{Http, RequestInit};
use crate::models::{Entry, Plugin, Source, View};
use crate::paths;
use crate::plugin::sidecar::{self, Sidecar};
use crate::plugin::{DialogRequest, HostRequest, method};
use crate::store::{self, IngestReport, NewEntry};
use crate::ui::content;
use crate::worker::Event;

/// Why a plugin run failed.
///
/// Every variant ends up as a source's `last_error`, which the sidebar shows
/// next to that source, so the message has to be enough to act on. The split
/// that matters is between *this plugin is broken* and *this installation is
/// broken*: the first is the plugin author's to fix, the second is not.
#[derive(Debug)]
pub enum PluginError {
    /// The runtime, the harness, or the plugin's own code could not be reached.
    Environment(String),
    /// The plugin ran and failed: it threw, it hung, or it died.
    Run(String),
    /// The plugin answered, but with something the host cannot use.
    Malformed(String),
}

impl std::fmt::Display for PluginError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PluginError::Environment(message)
            | PluginError::Run(message)
            | PluginError::Malformed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for PluginError {}

impl PluginError {
    fn message_mut(&mut self) -> &mut String {
        match self {
            PluginError::Environment(message)
            | PluginError::Run(message)
            | PluginError::Malformed(message) => message,
        }
    }

    /// Attach what the plugin logged before it failed.
    ///
    /// A plugin that throws usually said something first, and that line is
    /// often the whole explanation: the thrown error says *what* broke, the log
    /// says *why*. Only the tail is kept, because the message ends up in a
    /// sidebar row and the line worth reading is the one just before the
    /// failure.
    fn with_log(mut self, log: &[LogLine]) -> Self {
        /// How many of the plugin's last lines to keep.
        const TAIL: usize = 5;

        if log.is_empty() {
            return self;
        }

        let tail = log
            .iter()
            .rev()
            .take(TAIL)
            .rev()
            .map(|line| format!("[{}] {}", line.level, line.message))
            .collect::<Vec<_>>()
            .join("\n");

        let message = self.message_mut();
        message.push_str("\n\n");
        message.push_str(&tail);

        self
    }
}

/// What a plugin declares about itself, read back from `describe`.
#[derive(Debug, Clone)]
pub struct Manifest {
    /// The plugin's own id, which is what makes an upgrade land on the existing
    /// row instead of installing a second copy.
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    /// The view this plugin's sources start in.
    pub default_view: View,
    /// The settings form the plugin wants drawn. Kept opaque — see
    /// [`Plugin::settings`].
    pub settings: Value,
    /// The form that describes one source of this plugin.
    ///
    /// A plugin that reads one site usually needs a URL, a subreddit, a
    /// channel — something that differs per subscription and is the reason a
    /// plugin can have several sources at all. Declaring it here rather than
    /// taking a blob of JSON is what lets the install dialog ask for it in the
    /// same controls as everything else.
    pub params: Value,
    /// Whether the module exports a `preview` hook. See
    /// [`crate::models::Plugin::has_preview`].
    pub preview: bool,
}

impl Manifest {
    /// Read a `describe` result.
    ///
    /// `id` and `name` are the only required fields. Without an id the plugin
    /// cannot be upgraded in place or told apart from another, and without a
    /// name the sidebar has nothing to put on the row; everything else has a
    /// sensible default, because a plugin that declares less should still
    /// install rather than be refused over a missing icon.
    fn parse(result: &Value) -> Result<Self, PluginError> {
        let meta = result.get("meta").unwrap_or(result);

        let required = |key: &str| -> Result<String, PluginError> {
            meta.get(key)
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
                .ok_or_else(|| {
                    PluginError::Malformed(format!("the plugin's `meta` has no `{key}`"))
                })
        };

        let optional = |key: &str| meta.get(key).and_then(Value::as_str).map(str::to_owned);

        // `version` and `apiVersion` are read from either a string or a number.
        // Every plugin that means "the first version" writes it the way JSON
        // makes it natural in a config literal — `apiVersion: 1` — and refusing
        // that over a missing pair of quotes would be a parse error the author
        // cannot see the reason for.
        let number_or_text = |key: &str| -> Option<String> {
            match meta.get(key)? {
                Value::String(text) => Some(text.clone()),
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            }
        };

        let api_version = number_or_text("apiVersion").unwrap_or_else(|| "1".to_owned());

        // The host implements interface version 1 and says so rather than
        // running a plugin that was written against a different vocabulary. A
        // plugin is code; guessing at what a version 2 plugin expects is how a
        // reader ends up with entries nobody can explain.
        let major = api_version.split('.').next().unwrap_or_default().trim();
        if major != "1" {
            return Err(PluginError::Malformed(format!(
                "this plugin speaks interface version {api_version}, and this Rome \
                 implements version 1; it was not installed"
            )));
        }

        Ok(Self {
            plugin_id: required("id")?,
            name: required("name")?,
            version: number_or_text("version").unwrap_or_else(|| "0.0.0".to_owned()),
            api_version,
            description: optional("description"),
            icon: optional("icon"),
            // An unrecognised name is not an error: a plugin written against a
            // later version of the view list should still install, and simply
            // land somewhere.
            default_view: optional("view")
                .as_deref()
                .and_then(View::from_name)
                .unwrap_or(View::Articles),
            settings: result.get("settings").cloned().unwrap_or(Value::Null),
            params: meta.get("params").cloned().unwrap_or(Value::Null),
            // Reported by the harness from the module itself rather than
            // declared in `meta`; a plugin written against an older harness
            // simply has no `hooks` and therefore no preview.
            preview: result
                .get("hooks")
                .and_then(|hooks| hooks.get("preview"))
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }
}

/// Somewhere a plugin's dialog can be shown and answered.
///
/// A trait rather than a channel so a session can be driven with no window at
/// all — which is what a refresh does, and what the tests do. The host's
/// implementation sends the request to the UI thread and blocks on the answer,
/// but nothing here needs to know that.
pub trait Dialogs {
    /// Show `request` and return the user's answer.
    ///
    /// Blocks until the user gives one, because the plugin is blocked too: it
    /// asked a question and is waiting for the answer. Returning early would
    /// hand it a value nobody chose.
    fn ask(&mut self, request: DialogRequest) -> Value;
}

/// One line a plugin logged while it ran.
#[derive(Debug, Clone, PartialEq, Eq)]
struct LogLine {
    level: String,
    message: String,
}

/// Read what a plugin declares about itself, without installing it.
///
/// Every host method is refused here. `describe` is meant to be a declaration
/// rather than work: a plugin that fetched during it would make the install
/// dialog hang on somebody else's server, and the dialog has nothing to show
/// while that happens.
pub fn describe(source_code: &str) -> Result<Manifest, PluginError> {
    let path = paths::staging_plugin_code_path();
    std::fs::write(&path, source_code).map_err(environment)?;

    let described = describe_staged(&path);

    // Needed only for the length of the call. Leaving it behind would put one
    // file in the temporary directory for every install attempt, including the
    // ones that were abandoned.
    let _ = std::fs::remove_file(&path);

    described
}

/// The half of [`describe`] that runs once the code is on disk.
///
/// Split out so that the staged file is removed on every path out, including
/// the ones that return early with an error.
fn describe_staged(path: &Path) -> Result<Manifest, PluginError> {
    let harness = sidecar::harness_path().map_err(environment)?;
    let mut sidecar = Sidecar::spawn_with_args(&harness, [path])
        .map_err(|error| PluginError::Environment(error.to_string()))?;

    let result = sidecar
        .call(method::DESCRIBE, json!({}), |request| {
            Err(format!(
                "`{}` is not available while a plugin is being described",
                request.method
            ))
        })
        .map_err(|error| PluginError::Run(error.to_string()))?;

    Manifest::parse(&result)
}

/// A plugin, running, with the host services it can reach.
///
/// One session is one `tjs` child and one plugin. It is deliberately not
/// `Send`: the child, its pipes and the database handle all belong to the
/// thread that made them, and [`Session::fetch`] blocks that thread for as long
/// as the plugin takes.
///
/// The child outlives the session. Starting a runtime, loading a module and
/// building whatever it sets up at the top of the file costs more than most
/// calls spend on the network, and a plugin's own state — a token it refreshed,
/// a page it already asked for — only means anything if the next call lands in
/// the same process. So [`Session::drop`] hands the sidecar back to [`pool`],
/// and [`Session::start`] takes it out again for the next call.
struct Session<'a> {
    sidecar: Option<Sidecar>,
    services: Services<'a>,
    /// Which plugin the runtime belongs to, and which code it is running.
    ///
    /// Both are what the pool keys on: an upgrade changes the code, and a
    /// runtime still running the old code must not answer for the new one.
    plugin_id: u64,
    source: u64,
    /// Set when the process must not be handed back: activation failed, or
    /// `deactivate` has run and the plugin is on its way out.
    retire: bool,
}

impl Drop for Session<'_> {
    fn drop(&mut self) {
        let Some(sidecar) = self.sidecar.take() else {
            return;
        };

        if self.retire {
            // Dropped here rather than returned, which kills the child.
            return;
        }

        pool::put(self.plugin_id, self.source, sidecar);
    }
}

impl<'a> Session<'a> {
    /// Start `plugin`, with `db` and `http` answering the requests it makes.
    ///
    /// A runtime from the pool is preferred when it is already running the
    /// same code; otherwise the code is written to disk first, because `tjs`
    /// loads a plugin from a path. Materialising it means the exact code that
    /// ran is still there to read afterwards — which is the first thing anyone
    /// looks at when a plugin misbehaves.
    fn start(
        plugin: &Plugin,
        db: &'a mut Database,
        http: &'a mut Http,
        dialogs: Option<&'a mut dyn Dialogs>,
        events: Option<&'a flume::Sender<Event>>,
    ) -> Result<Self, PluginError> {
        let source = fingerprint(&plugin.source_code);

        let sidecar = match pool::take(plugin.id, source) {
            Some(sidecar) => sidecar,
            None => {
                let path = paths::plugin_code_path(db.path(), plugin.id).map_err(environment)?;
                std::fs::write(&path, &plugin.source_code).map_err(environment)?;

                let harness = sidecar::harness_path().map_err(environment)?;
                Sidecar::spawn_with_args(&harness, [&path])
                    .map_err(|error| PluginError::Environment(error.to_string()))?
            }
        };

        Ok(Self {
            sidecar: Some(sidecar),
            services: Services {
                plugin_id: plugin.id,
                db,
                http,
                dialogs,
                events,
                log: Vec::new(),
            },
            plugin_id: plugin.id,
            source,
            retire: false,
        })
    }

    /// Make sure this runtime is killed when the session ends.
    fn retire(&mut self) {
        self.retire = true;
    }

    /// Run the plugin's `activate`, which is where it sets itself up.
    ///
    /// The one hook a plugin may prompt from: the user is present by
    /// definition — they just installed it, or just switched it on — and asking
    /// for an API key is the whole reason the hook exists.
    fn activate(&mut self, plugin: &Plugin) -> Result<(), PluginError> {
        // No source parameters: activating is about the plugin, not about one
        // of its subscriptions. A plugin with three sources has three sets of
        // parameters and no way to choose between them here.
        let params = json!({ "settings": plugin.settings, "params": {} });

        let Self {
            sidecar, services, ..
        } = self;

        sidecar
            .as_mut()
            .expect("a session always holds its runtime")
            .call(method::ACTIVATE, params, |request| {
                services.dispatch(request)
            })
            .map_err(|error| PluginError::Run(error.to_string()))?;

        Ok(())
    }

    /// Run the plugin's `deactivate`.
    ///
    /// A plugin with nothing to shut down simply does not define the hook, so
    /// this succeeds silently in the common case.
    fn deactivate(&mut self) -> Result<(), PluginError> {
        let Self {
            sidecar, services, ..
        } = self;

        sidecar
            .as_mut()
            .expect("a session always holds its runtime")
            .call(method::DEACTIVATE, json!({}), |request| {
                services.dispatch(request)
            })
            .map_err(|error| PluginError::Run(error.to_string()))?;

        Ok(())
    }

    /// Everything the plugin logged during this session.
    fn log(&self) -> &[LogLine] {
        &self.services.log
    }

    /// Ask the plugin for its current items.
    ///
    /// The settings are the plugin's, the parameters are the source's, and the
    /// cursor is whatever the last run handed back — three different scopes,
    /// which is why they are three different things on the wire rather than one
    /// bag of options.
    fn fetch(&mut self, plugin: &Plugin, source: &Source) -> Result<Fetched, PluginError> {
        let params = json!({
            "settings": plugin.settings,
            "params": source.params,
            "cursor": source.cursor,
        });

        // Destructured so the sidecar and the services are borrowed as separate
        // fields: the handler runs *inside* the call, and needs the services
        // while the call still holds the sidecar.
        let Self {
            sidecar, services, ..
        } = self;

        let result = sidecar
            .as_mut()
            .expect("a session always holds its runtime")
            .call(method::FETCH, params, |request| services.dispatch(request))
            .map_err(|error| PluginError::Run(error.to_string()))?;

        Fetched::parse(&result)
    }

    /// Ask the plugin to draw one entry's page.
    ///
    /// The source's parameters and settings go along with the item because a
    /// preview is usually the same site read more deeply: which account, which
    /// region, which key — the same three scopes as a fetch, plus the item.
    ///
    /// `Ok(None)` means the plugin had nothing to add, which is a normal
    /// answer rather than a failure: the host keeps whatever the entry already
    /// had.
    fn preview(
        &mut self,
        plugin: &Plugin,
        source: &Source,
        entry: &Entry,
    ) -> Result<Option<String>, PluginError> {
        let params = json!({
            "settings": plugin.settings,
            "params": source.params,
            "item": {
                "id": entry.external_id,
                "title": entry.title,
                "url": entry.url,
                // Handed back exactly as the plugin gave it: the host never
                // looks inside, which is what makes it the plugin's.
                "params": entry.params,
            },
        });

        let Self {
            sidecar, services, ..
        } = self;

        let result = sidecar
            .as_mut()
            .expect("a session always holds its runtime")
            .call(method::PREVIEW, params, |request| {
                services.dispatch(request)
            })
            .map_err(|error| PluginError::Run(error.to_string()))?;

        Ok(result
            .get("content")
            .and_then(Value::as_str)
            .filter(|content| !content.trim().is_empty())
            .map(str::to_owned))
    }
}

/// A stable-enough identity for one version of a plugin's code.
///
/// The point is not cryptography. It is to notice that the row's `source_code`
/// is no longer the text the running runtime loaded, so an upgrade starts a new
/// process instead of being answered by the old one.
fn fingerprint(source: &str) -> u64 {
    use std::hash::{Hash, Hasher};

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source.hash(&mut hasher);
    hasher.finish()
}

/// The runtimes that are still alive between calls.
///
/// Starting `tjs` costs far more than handing it another line, and a plugin is
/// usually called several times in a row — open, preview, refresh — so the
/// session that finishes a call leaves its child here rather than killing it.
/// The next call for the same plugin takes it back out.
///
/// The pool is per thread because the caller is: the worker owns every plugin
/// run in the application, and a `tjs` child is not something to move between
/// threads behind the protocol's back. Tests get one each for the same reason.
mod pool {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::time::{Duration, Instant};

    use super::Sidecar;

    /// How long an unused runtime is kept before it is killed.
    ///
    /// Long enough to cover a reader moving between entries, short enough that
    /// leaving the application open overnight does not leave a process per
    /// plugin running until morning.
    const IDLE: Duration = Duration::from_secs(10 * 60);

    /// How many runtimes may wait at once.
    ///
    /// Bounds the process count for a reader with many plugins. The longest
    /// idle one goes first; the ones being used keep their place.
    const MAX: usize = 8;

    struct Warm {
        sidecar: Sidecar,
        source: u64,
        used: Instant,
    }

    thread_local! {
        static WARM: RefCell<HashMap<u64, Warm>> = RefCell::new(HashMap::new());
    }

    /// Take the runtime for `plugin_id` back, if it is alive and running
    /// `source`.
    ///
    /// A runtime that died, that has gone too long without a call, or that is
    /// running other code is dropped — which kills it — and `None` says to
    /// start a new one.
    pub fn take(plugin_id: u64, source: u64) -> Option<Sidecar> {
        WARM.with(|warm| {
            let mut warm = warm.borrow_mut();
            let now = Instant::now();

            warm.retain(|_, idle| now.duration_since(idle.used) < IDLE && idle.sidecar.alive());

            match warm.remove(&plugin_id) {
                Some(idle) if idle.source == source => Some(idle.sidecar),
                _ => None,
            }
        })
    }

    /// Keep `sidecar` for the next call, unless it is already gone.
    pub fn put(plugin_id: u64, source: u64, mut sidecar: Sidecar) {
        if !sidecar.alive() {
            return;
        }

        WARM.with(|warm| {
            let mut warm = warm.borrow_mut();

            while warm.len() >= MAX {
                let oldest = warm
                    .iter()
                    .min_by_key(|(_, idle)| idle.used)
                    .map(|(id, _)| *id);

                let Some(oldest) = oldest else {
                    break;
                };

                warm.remove(&oldest);
            }

            warm.insert(
                plugin_id,
                Warm {
                    sidecar,
                    source,
                    used: Instant::now(),
                },
            );
        });
    }

    /// Kill whatever is waiting for `plugin_id`.
    ///
    /// Called when the plugin is switched off: a runtime that was not asked to
    /// deactivate still has no business outliving the switch.
    pub fn forget(plugin_id: u64) {
        WARM.with(|warm| {
            warm.borrow_mut().remove(&plugin_id);
        });
    }
}

/// What one run of a plugin returned.
struct Fetched {
    entries: Vec<NewEntry>,
    /// The token to hand back next time, if the plugin gave one.
    cursor: Option<String>,
}

impl Fetched {
    fn parse(result: &Value) -> Result<Self, PluginError> {
        let entries = result
            .get("entries")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                PluginError::Malformed("`fetch` did not return an `entries` array".to_owned())
            })?;

        let mut parsed = Vec::with_capacity(entries.len());
        for (index, entry) in entries.iter().enumerate() {
            parsed.push(parse_entry(entry, index)?);
        }

        Ok(Self {
            entries: parsed,
            cursor: result
                .get("cursor")
                .and_then(Value::as_str)
                .map(str::to_owned),
        })
    }
}

/// Read one entry out of a plugin's output.
///
/// `id` is required and must not be empty. It is the whole of the deduplication
/// key, so an entry without one is re-inserted on every single refresh, and the
/// list grows without bound while looking like it works. That is worth failing
/// over: the message names the entry, where silently dropping it would leave
/// the user wondering why their feed is short.
fn parse_entry(value: &Value, index: usize) -> Result<NewEntry, PluginError> {
    let text = |key: &str| value.get(key).and_then(Value::as_str).map(str::to_owned);

    let external_id = text("id").filter(|id| !id.is_empty()).ok_or_else(|| {
        PluginError::Malformed(format!(
            "entry {index} has no `id`; every entry needs one, and it has to stay the same \
             across runs, or the whole list is inserted again on every refresh"
        ))
    })?;

    Ok(NewEntry {
        external_id,
        title: text("title").unwrap_or_default(),
        url: text("url"),
        author: text("author"),
        published_at: timestamp(value, "publishedAt"),
        content: text("content"),
        summary: text("summary"),
        image: text("image"),
        // Opaque to the host; only an object, because it is handed back to the
        // plugin as a bag of named values and anything else would be a shape
        // the plugin's own `preview` could not read.
        params: value
            .get("params")
            .filter(|params| params.is_object())
            .cloned(),
    })
}

/// Seconds since the Unix epoch, out of a plugin's output.
///
/// A float is accepted as well as an integer. JavaScript has one number type,
/// so a plugin that divides a millisecond timestamp to get seconds hands over
/// `1750000000.5` and means the same instant.
fn timestamp(value: &Value, key: &str) -> Option<i64> {
    let value = value.get(key)?;

    value
        .as_i64()
        .or_else(|| value.as_f64().map(|seconds| seconds as i64))
}

/// Run one source's plugin and fold what it returns into the database.
///
/// A source or plugin that is switched off is skipped rather than failed: it is
/// the state the user asked for, and recording it as an error would put a
/// warning on a row they deliberately turned off.
pub fn refresh_source(
    db: &mut Database,
    http: &mut Http,
    source_id: u64,
    events: Option<&flume::Sender<Event>>,
) -> Result<IngestReport, PluginError> {
    let source = store::source(db, source_id).map_err(environment)?;

    if !source.enabled {
        return Ok(IngestReport::default());
    }

    let plugin = store::plugin(db, source.plugin_id).map_err(environment)?;

    if !plugin.enabled {
        return Ok(IngestReport::default());
    }

    match run(&plugin, &source, db, http, events) {
        Ok((report, cursor)) => {
            store::record_fetch(db, source_id, Ok(cursor)).map_err(environment)?;
            Ok(report)
        }
        Err(error) => {
            // The run's own failure is what the user needs to see, so a failure
            // to *record* it must not replace it. Dropping the second error is
            // deliberate: there is no room for two, and the first one is the
            // one that explains the empty list.
            let _ = store::record_fetch(db, source_id, Err(error.to_string()));
            Err(error)
        }
    }
}

/// Ask a plugin to draw one entry's page, and keep what it drew.
///
/// The half of the entry-opening path the plugin owns. A plugin that exports a
/// `preview` hook said it can describe an item better than the host can by
/// fetching the item's URL, and it said so by exporting the function — so this
/// runs it with the values the plugin attached to the entry when it listed it.
///
/// `Ok(None)` is a normal answer: the hook can decide, per item, that it has
/// nothing to add. Whether the run succeeded is recorded here rather than left
/// to the caller, because an entry marked as previewed with no preview in it
/// would never be asked again, and "nothing to show" is still an answer.
pub fn preview_entry(
    db: &mut Database,
    http: &mut Http,
    events: Option<&flume::Sender<Event>>,
    entry_id: u64,
) -> Result<Option<String>, PluginError> {
    let entry = store::entry(db, entry_id).map_err(environment)?;
    let source = store::source(db, entry.source_id).map_err(environment)?;
    let plugin = store::plugin(db, source.plugin_id).map_err(environment)?;

    if !plugin.has_preview {
        return Ok(None);
    }

    // No dialogs: reading an entry must not stop to ask a question, and a
    // plugin that needs one has misread what a preview is for.
    let mut session = Session::start(&plugin, db, http, None, events)?;

    let drawn = match session.preview(&plugin, &source, &entry) {
        Ok(drawn) => drawn,
        Err(error) => return Err(error.with_log(session.log())),
    };

    // The session holds the database mutably for as long as it lives, and now
    // that dropping it hands the runtime back to the pool, the borrow ends
    // here rather than at the end of the function.
    drop(session);

    store::set_preview(db, entry_id, drawn.clone(), store::now()).map_err(environment)?;

    Ok(drawn)
}

/// Run a plugin's `activate` hook.
///
/// Called when a plugin is installed and when it is switched back on. A plugin
/// that has nothing to do returns immediately; one that needs a credential asks
/// for it here, which is the only place in a plugin's life where a dialog is
/// allowed.
pub fn activate_plugin(
    db: &mut Database,
    http: &mut Http,
    dialogs: &mut dyn Dialogs,
    events: &flume::Sender<Event>,
    plugin_id: u64,
) -> Result<(), PluginError> {
    let plugin = store::plugin(db, plugin_id).map_err(environment)?;

    let mut session = Session::start(&plugin, db, http, Some(dialogs), Some(events))?;

    match session.activate(&plugin) {
        Ok(()) => Ok(()),
        Err(error) => {
            let error = error.with_log(session.log());

            // Activation is where a plugin sets up the state everything after
            // it assumes. One that failed halfway must not be handed to the
            // next call: a fresh process and a clean attempt is the only way to
            // tell "it is broken" from "it was broken for a moment".
            session.retire();

            Err(error)
        }
    }
}

/// Run a plugin's `deactivate` hook, as it is switched off.
///
/// A failure here is not worth surfacing as a fault: the plugin is being
/// stopped either way, and the only thing it could have been doing is tidying
/// up. The caller is free to ignore the result.
pub fn deactivate_plugin(
    db: &mut Database,
    http: &mut Http,
    plugin_id: u64,
) -> Result<(), PluginError> {
    let plugin = store::plugin(db, plugin_id).map_err(environment)?;

    // No dialogs, and no reports either: a plugin being switched off has
    // nothing left to ask about, and anything it says on the way out is a
    // message about a thing that is already gone.
    let mut session = Session::start(&plugin, db, http, None, None)?;

    let result = session.deactivate();

    // Whatever it said on the way out, this process has no next call. Dropping
    // the session kills it rather than leaving it in the pool.
    session.retire();

    result
}

/// Kill any runtime still waiting for `plugin_id`.
///
/// Switching a plugin off is the one moment the pool has to be told directly:
/// the plugin may be idle rather than in a call, so there is no session to
/// retire.
pub fn forget_plugin(plugin_id: u64) {
    pool::forget(plugin_id);
}

/// One run, from the plugin process to rows in the database.
fn run(
    plugin: &Plugin,
    source: &Source,
    db: &mut Database,
    http: &mut Http,
    events: Option<&flume::Sender<Event>>,
) -> Result<(IngestReport, Option<String>), PluginError> {
    // No dialogs: a refresh runs whether or not anyone is watching. Reports
    // still go out, because a refresh is the run that takes long enough to
    // need describing.
    let mut session = Session::start(plugin, db, http, None, events)?;

    let fetched = match session.fetch(plugin, source) {
        Ok(fetched) => fetched,
        Err(error) => return Err(error.with_log(session.log())),
    };

    // The runtime goes back to the pool before the database is touched again;
    // the session's borrow of it would otherwise last to the end of the
    // function, because a type with a `Drop` is dropped after its scope.
    drop(session);

    let report = store::ingest(db, source.id, &fetched.entries).map_err(environment)?;

    Ok((report, fetched.cursor))
}

/// The host services a plugin can reach, and the log it is filling.
struct Services<'a> {
    plugin_id: u64,
    db: &'a mut Database,
    http: &'a mut Http,
    /// Where a question goes, if this run has somewhere to put one.
    ///
    /// `None` for a refresh: it happens whether or not anyone is watching, so
    /// there is no one to answer and the plugin is told so rather than being
    /// left waiting on a question nobody will see.
    dialogs: Option<&'a mut dyn Dialogs>,
    /// Where a report goes.
    ///
    /// Separate from `dialogs` because a report is not a question — the host
    /// answers it by doing it — and so it does not need anyone to be present to
    /// ask. That difference is the whole point: a refresh is exactly when a
    /// plugin has a long job to describe, and routing toasts and progress
    /// through the window check the questions get would silence it in the one
    /// moment it has something to say.
    events: Option<&'a flume::Sender<Event>>,
    log: Vec<LogLine>,
}

impl Services<'_> {
    /// Answer one request from the plugin.
    ///
    /// An `Err` here goes back to the plugin as a failed call, not as a failed
    /// refresh. That distinction is the point: a plugin that asked for
    /// something the host could not give — a URL that did not resolve, a
    /// dialog with nobody to answer it — is free to catch that and carry on,
    /// and one that does not is the plugin's own bug to surface.
    fn dispatch(&mut self, request: HostRequest) -> Result<Value, String> {
        match request.method.as_str() {
            method::HTTP => self.http(request.params),
            method::ARTICLE => self.article(request.params),
            method::STORAGE_GET => self.storage_get(request.params),
            method::STORAGE_SET => self.storage_set(request.params),
            method::LOG => self.record_log(request.params),
            method::UI => self.ui(&request.params),
            other => Err(format!("the host has no method `{other}`")),
        }
    }

    /// Make one request on the plugin's behalf.
    ///
    /// The plugin's own headers are passed through untouched; what the host
    /// adds on top — the cookie jar, the user agent — is `http`'s business and
    /// is why a plugin's `fetch` goes through here at all rather than straight
    /// to the network from inside the runtime.
    fn http(&mut self, params: Value) -> Result<Value, String> {
        let url = params
            .get("url")
            .and_then(Value::as_str)
            .ok_or("`http` needs a `url`")?;

        let init = RequestInit::from_json(&params.get("init").cloned().unwrap_or(Value::Null));

        let response = self
            .http
            .request(self.db, self.plugin_id, url, init)
            .map_err(|error| error.to_string())?;

        // Headers as pairs: the harness accepts either shape, and a list is the
        // only one that can carry a name twice.
        Ok(json!({
            "status": response.status,
            "headers": response.headers,
            "body": response.body,
        }))
    }

    /// Read one page as an article, on the plugin's request.
    ///
    /// This is [`Services::http`] with the reader's extractor on the end of it,
    /// for the plugins that know a page is a story rather than a feed. The
    /// request is still the plugin's — its id, its cookie jar, its domain log —
    /// and the plugin still chooses the address and the moment. What it does
    /// not have to reimplement is stripping a page down to what a reader wants.
    ///
    /// `null` is a page that was read and had no article in it: a video, a
    /// login wall, a PDF. An `Err` is a page that was not read at all.
    fn article(&mut self, params: Value) -> Result<Value, String> {
        let url = params
            .get("url")
            .and_then(Value::as_str)
            .ok_or("`article` needs a `url`")?;

        let init = RequestInit::from_json(&json!({
            "headers": {
                // The conventional browser set. A site that negotiates on this
                // header should hand a reader the page rather than the feed.
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        }));

        let response = self
            .http
            .request(self.db, self.plugin_id, url, init)
            .map_err(|error| error.to_string())?;

        if !(200..300).contains(&response.status) {
            return Err(format!("the page answered {}", response.status));
        }

        if !is_html(&response.headers) {
            return Ok(Value::Null);
        }

        Ok(content::article(&response.body).map_or(Value::Null, Value::String))
    }

    /// Read a value the plugin stored for itself.
    fn storage_get(&mut self, params: Value) -> Result<Value, String> {
        let key = params
            .get("key")
            .and_then(Value::as_str)
            .ok_or("`storage.get` needs a `key`")?;

        store::storage_get(self.db, self.plugin_id, key)
            // `null` for a key that was never written: the plugin needs one
            // answer for "no value yet" and there is no second one on the wire.
            .map(|value| value.unwrap_or(Value::Null))
            .map_err(|error| format!("could not read the plugin's storage: {error}"))
    }

    /// Write a value the plugin stored for itself.
    fn storage_set(&mut self, params: Value) -> Result<Value, String> {
        let key = params
            .get("key")
            .and_then(Value::as_str)
            .ok_or("`storage.set` needs a `key`")?;

        let value = params.get("value").cloned().unwrap_or(Value::Null);

        store::storage_set(self.db, self.plugin_id, key, value)
            .map(|()| Value::Null)
            .map_err(|error| format!("could not write the plugin's storage: {error}"))
    }

    /// Show a dialog the plugin asked for.
    fn ui(&mut self, params: &Value) -> Result<Value, String> {
        let request = DialogRequest::parse(params)
            .ok_or_else(|| "the host does not know that kind of dialog".to_owned())?;

        // The reports first, and before the window check. A toast, a progress
        // line and a request to open a browser are all answered by the host
        // doing them, so none of them needs a person; refusing them here
        // because there is no window would take a plugin's only way of saying
        // what it is doing away from the run that takes longest.
        if !request.is_blocking() {
            return self.report(request);
        }

        let login = matches!(&request, DialogRequest::Login { .. });

        let answer = match self.dialogs.as_mut() {
            Some(dialogs) => dialogs.ask(request),
            None => {
                return Err(
                    "a plugin cannot prompt here: this run has no window, and a refresh happens \
                     whether or not anyone is watching. Ask from `activate` instead."
                        .to_owned(),
                );
            }
        };

        // A login is the one answer that changes state the plugin is about to
        // depend on: the next thing it does is fetch the page it just signed
        // in to, and that fetch has to see the cookies. Writing them here,
        // before the reply goes back over the pipe, is what makes the `await`
        // mean "you are logged in" rather than "you were, a moment ago".
        if login {
            self.remember_login(&answer)?;
        }

        Ok(answer)
    }

    /// Answer one of the requests that needs nobody: tell the UI, or open the
    /// link.
    ///
    /// Dropped rather than failed when there is nowhere to send it. A plugin
    /// that reports progress in a run with no window has done nothing wrong —
    /// there is simply no one to report to — and failing it would make a
    /// perfectly good plugin break depending on how it was started.
    fn report(&mut self, request: DialogRequest) -> Result<Value, String> {
        match request {
            DialogRequest::OpenExternal { url } => {
                // The result is the answer, and a refusal is a real answer: a
                // plugin that tried to open `file:///etc/passwd` is told no,
                // rather than being told yes and quietly ignored.
                let opened = crate::open::url(&url).is_ok();
                Ok(json!({ "opened": opened }))
            }
            DialogRequest::Notify { message, level } => {
                if let Some(events) = self.events {
                    let _ = events.send(Event::Notify { message, level });
                }
                Ok(Value::Null)
            }
            DialogRequest::Progress { message, value } => {
                if let Some(events) = self.events {
                    let _ = events.send(Event::Progress { message, value });
                }
                Ok(Value::Null)
            }
            // `is_blocking` is what decides which requests reach here, and
            // these are the ones it lets through; a question arriving means the
            // two lists have drifted apart, which is a bug in this file rather
            // than anything the plugin did.
            other => Err(format!(
                "{other:?} is a question, and this is the report path"
            )),
        }
    }

    /// Put the cookies the login window collected into the jar.
    ///
    /// The UI sends them with its answer because it is the only side that can
    /// read WebKit's cookie store, and the worker is the only side that may
    /// write the database.
    fn remember_login(&mut self, answer: &Value) -> Result<(), String> {
        let Some(cookies) = answer.get("cookies").and_then(Value::as_array) else {
            return Ok(());
        };

        for cookie in cookies {
            let Some(jar) = jar_cookie(cookie) else {
                continue;
            };

            crate::http::remember(self.db, jar)
                .map_err(|error| format!("could not save a login cookie: {error}"))?;
        }

        Ok(())
    }

    /// Record a line the plugin logged.
    ///
    /// The plugin is told nothing either way. It cannot do anything useful with
    /// the answer, and a plugin that logs in a loop must not be able to slow
    /// itself down waiting for the host to acknowledge each line.
    fn record_log(&mut self, params: Value) -> Result<Value, String> {
        let level = params
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or("info");

        let message = params
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();

        self.log.push(LogLine {
            level: level.to_owned(),
            message: message.to_owned(),
        });

        Ok(Value::Null)
    }
}

/// A storage or database failure, as a message the user can be shown.
/// Whether a response is a page the article extractor can read.
///
/// A missing `content-type` is treated as HTML: plenty of pages omit it, and
/// the extractor itself answers `None` for a body it finds no article in.
fn is_html(headers: &[(String, String)]) -> bool {
    let Some(kind) = headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value)
    else {
        return true;
    };

    // The header carries its charset after a semicolon often enough that
    // comparing the whole value would reject most of the web.
    let kind = kind.split(';').next().unwrap_or_default().trim();

    kind.eq_ignore_ascii_case("text/html") || kind.eq_ignore_ascii_case("application/xhtml+xml")
}

fn environment(error: impl std::fmt::Display) -> PluginError {
    PluginError::Environment(error.to_string())
}

/// Read one cookie as the login window serialised it.
///
/// This is the host's own wire format — the UI built these objects from
/// WebKit's cookie store — so a missing field is a bug here, not a plugin
/// problem. `domain` and `name` are what identify a cookie, and a cookie
/// without them could not be stored under anything.
fn jar_cookie(value: &Value) -> Option<crate::http::JarCookie> {
    let text = |key: &str| value.get(key).and_then(Value::as_str);

    Some(crate::http::JarCookie {
        domain: text("domain")?.to_owned(),
        path: text("path").unwrap_or("/").to_owned(),
        name: text("name")?.to_owned(),
        value: text("value").unwrap_or_default().to_owned(),
        // Older answer shapes may not say; a host-only cookie is the safe
        // reading, since it is sent to fewer places.
        host_only: value
            .get("host_only")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        expires_at: value.get("expires_at").and_then(Value::as_i64),
        secure: value
            .get("secure")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        http_only: value
            .get("http_only")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::{NewPlugin, NewSource};

    /// The migrations, embedded exactly as the application embeds them, so a
    /// test database has the schema a real one has.
    static MIGRATIONS: toasty::migration::MigrationSet = toasty::embed_migrations!();

    /// Distinguishes one scratch directory from the next within this process.
    ///
    /// A clock is not enough, and the failure it causes is nasty rather than
    /// obvious: these tests start together, `SystemTime::now` on a coarse clock
    /// hands several of them the same reading, and two tests then share a
    /// directory — so each overwrites the other's plugin code and whichever
    /// finishes first deletes the other's out from under it. A counter cannot
    /// collide.
    static NEXT_SCRATCH: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    /// A scratch database in its own directory, removed when it goes away.
    ///
    /// Its own *directory* rather than a bare file because a run writes the
    /// plugin's code beside the database — so this isolates everything a
    /// refresh derives, not only the rows it inserts.
    struct Scratch {
        dir: std::path::PathBuf,
        db: Database,
    }

    impl Scratch {
        fn new() -> Self {
            let serial = NEXT_SCRATCH.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

            let dir =
                std::env::temp_dir().join(format!("rome-session-{}-{serial}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("could not create a scratch directory");

            let db =
                Database::open(dir.join("rome.db")).expect("could not open a scratch database");
            db.migrate(&MIGRATIONS)
                .expect("could not migrate a scratch database");

            Self { dir, db }
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            // `drop` runs before the fields are dropped, so the database handle
            // is still open here; unlinking an open file is fine on the
            // platforms this runs on. Cleaning up must not be able to fail a
            // test that has already passed.
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    /// The runtime and the harness are vendored, but a checkout missing them
    /// should skip rather than fail — the same rule the sidecar's own tests
    /// follow.
    fn runtime_is_available() -> bool {
        sidecar::runtime_path().is_ok() && sidecar::harness_path().is_ok()
    }

    /// Install `source_code`, upgrading the row of a plugin already installed
    /// under the same id.
    ///
    /// Described first, the way the application does it, so a plugin's declared
    /// hooks land on the row exactly as they would for a real install.
    fn install_plugin(db: &mut Database, source_code: &str) -> Plugin {
        let manifest = describe(source_code).expect("the plugin should describe");

        store::install_plugin(
            db,
            NewPlugin {
                plugin_id: manifest.plugin_id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                api_version: manifest.api_version.clone(),
                description: manifest.description.clone(),
                icon: manifest.icon.clone(),
                default_view: manifest.default_view,
                source_code: source_code.to_owned(),
                settings: json!({}),
                settings_schema: manifest.settings.clone(),
                params_schema: manifest.params.clone(),
                has_preview: manifest.preview,
            },
        )
        .expect("the plugin should install")
    }

    /// Install `source_code` as a plugin and create one source for it.
    fn install(db: &mut Database, source_code: &str) -> u64 {
        let plugin = install_plugin(db, source_code);

        store::create_source(
            db,
            NewSource {
                plugin_id: plugin.id,
                title: "Test".to_owned(),
                params: json!({}),
                view: View::Articles,
                category: None,
                refresh_interval_secs: 900,
            },
        )
        .expect("the source should be created")
        .id
    }

    /// Skip the test body when nothing is vendored for this platform.
    macro_rules! require_runtime {
        () => {
            if !runtime_is_available() {
                eprintln!("skipping: no vendored runtime for this platform");
                return;
            }
        };
    }

    /// `describe` is where an install starts: it reads a plugin's manifest
    /// without installing anything, so the user can be shown what they are
    /// about to add before they add it.
    #[test]
    fn describe_reads_a_manifest_without_installing_anything() {
        require_runtime!();

        let manifest = describe(
            r#"
export const meta = {
  id: 'test.plugin',
  name: 'Test Plugin',
  version: '2.1.0',
  apiVersion: '1',
  view: 'videos',
  description: 'does a thing',
}

export const settings = { fields: [{ key: 'token', type: 'password', label: 'Token' }] }

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect("the manifest should parse");

        assert_eq!(manifest.plugin_id, "test.plugin");
        assert_eq!(manifest.name, "Test Plugin");
        assert_eq!(manifest.version, "2.1.0");
        assert_eq!(manifest.default_view, View::Videos);
        assert_eq!(manifest.description.as_deref(), Some("does a thing"));
        // The settings form is the plugin's to define and is passed through
        // untouched — nothing here interprets it.
        assert_eq!(manifest.settings["fields"][0]["key"], "token");
    }

    /// A plugin that declares less still installs: only `id` and `name` are
    /// required, because everything else has a sensible default and refusing an
    /// install over a missing icon would be absurd.
    #[test]
    fn describe_defaults_what_a_plugin_leaves_out() {
        require_runtime!();

        let manifest = describe(
            r#"
export const meta = { id: 'test.plugin', name: 'Bare' }

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect("the manifest should parse");

        assert_eq!(manifest.default_view, View::Articles);
        assert_eq!(manifest.version, "0.0.0");
        assert_eq!(manifest.api_version, "1");
        assert_eq!(manifest.settings, Value::Null);
    }

    /// `apiVersion: 1` is how a plugin author writes "interface version one"
    /// in a JavaScript object literal. Requiring a string would turn the most
    /// natural spelling into an install failure with no explanation.
    #[test]
    fn api_version_may_be_a_number() {
        require_runtime!();

        let manifest = describe(
            r#"
export const meta = { id: 'test.plugin', name: 'Numeric', apiVersion: 1, version: 2 }

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect("a numeric apiVersion should parse");

        assert_eq!(manifest.api_version, "1");
        assert_eq!(manifest.version, "2");
    }

    /// A plugin written against an interface this build does not implement is
    /// refused rather than run and left to misbehave. "Not now" is recoverable;
    /// a plugin that half-works produces entries nobody can account for.
    #[test]
    fn a_future_interface_version_is_refused() {
        require_runtime!();

        let error = describe(
            r#"
export const meta = { id: 'test.plugin', name: 'From the future', apiVersion: 2 }

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect_err("version 2 is not implemented");

        let message = error.to_string();
        assert!(
            message.contains("version 2") && message.contains("version 1"),
            "the failure names both versions: {message}"
        );
    }

    /// A plugin with no id is refused: without one it cannot be upgraded in
    /// place, and would install a second copy of itself on every version bump.
    #[test]
    fn describe_refuses_a_plugin_with_no_id() {
        require_runtime!();

        let error = describe(
            r#"
export const meta = { name: 'Nameless' }

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect_err("a plugin with no id should not install");

        // As with an entry's id, the harness checks this before the host does,
        // so this asserts the behaviour rather than which layer reports it.
        let message = error.to_string();
        assert!(
            message.contains("meta") && message.contains("id"),
            "the failure says the id is the problem: {message}"
        );
    }

    /// `describe` is a declaration, not work. A plugin that reaches for the
    /// network while it is being described would make the install dialog hang
    /// on somebody else's server, so the host refuses it — and this plugin
    /// reaches at import time, which is exactly when `describe` runs.
    #[test]
    fn describe_refuses_a_plugin_that_does_work() {
        require_runtime!();

        let error = describe(
            r#"
export const meta = { id: 'test.plugin', name: 'Eager', version: '1.0.0', apiVersion: '1' }

await globalThis.fetch('https://example.com/never')

export async function fetch(ctx) {
  return { entries: [] }
}
"#,
        )
        .expect_err("a plugin that does work while being described should be refused");

        assert!(
            error.to_string().contains("not available"),
            "the refusal says why: {error}"
        );
    }

    /// The whole loop: code out of the database, the real runtime, the real
    /// harness, and rows in the database at the end of it.
    #[test]
    fn a_fetch_lands_entries_in_the_database() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return {
    entries: [
      { id: 'a', title: 'First', url: 'https://example.com/a', publishedAt: 1700000000 },
      { id: 'b', title: 'Second', author: 'someone' },
    ],
  }
}
"#,
        );

        let mut http = Http::new();
        let report = refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect("the refresh should work");

        assert_eq!(report.inserted, 2);
        assert_eq!(report.updated, 0);

        let entries =
            store::timeline(&mut scratch.db, Some(View::Articles), 10).expect("a timeline");

        assert_eq!(entries.len(), 2);

        let first = entries
            .iter()
            .find(|entry| entry.external_id == "a")
            .expect("the first entry should be stored");

        assert_eq!(first.title, "First");
        assert_eq!(first.url.as_deref(), Some("https://example.com/a"));
        assert_eq!(first.published_at, Some(1700000000));
        // A plugin cannot mark its own entries read, whatever it returns.
        assert!(!first.read);
    }

    /// The item's own parameters are what the preview hook is handed, and what
    /// it draws is stored against the entry.
    #[test]
    fn the_preview_hook_draws_a_page_from_the_items_params() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ id: 'v1', title: 'A video', params: { bvid: 'BV1xx' } }] }
}

export async function preview(ctx) {
  return { content: `<p>${ctx.item.params.bvid}</p>` }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the refresh");

        let entry = store::timeline(&mut scratch.db, None, 10)
            .expect("a timeline")
            .into_iter()
            .next()
            .expect("one entry");

        let drawn =
            preview_entry(&mut scratch.db, &mut http, None, entry.id).expect("the preview runs");

        assert_eq!(drawn.as_deref(), Some("<p>BV1xx</p>"));

        let stored = store::entry(&mut scratch.db, entry.id).expect("the entry");
        assert_eq!(stored.preview.as_deref(), Some("<p>BV1xx</p>"));
        assert!(stored.preview_at.is_some());
    }

    /// A plugin that exports no hook is not started at all: `preview_entry`
    /// answers from the row, which is what keeps opening an entry of an
    /// ordinary feed from launching a JavaScript runtime.
    #[test]
    fn a_plugin_without_a_preview_hook_is_not_asked() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ id: 'a', title: 'First' }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the refresh");

        let entry = store::timeline(&mut scratch.db, None, 10)
            .expect("a timeline")
            .into_iter()
            .next()
            .expect("one entry");

        let drawn =
            preview_entry(&mut scratch.db, &mut http, None, entry.id).expect("the call succeeds");

        assert_eq!(drawn, None);

        let stored = store::entry(&mut scratch.db, entry.id).expect("the entry");
        // Unasked, rather than asked and empty: the timestamp is what says the
        // hook ran.
        assert_eq!(stored.preview_at, None);
    }

    /// A plugin is a process, not a call. The runtime that answered one fetch
    /// answers the next, so whatever it set up at the top of the file — a
    /// token, a cache, a counter — is still there.
    ///
    /// The counter is the evidence. A fresh process would start it at one
    /// again, and the second run would dedupe away as a repeat of the first.
    #[test]
    fn the_runtime_survives_between_calls() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.counting', name: 'Counting', version: '1.0.0', apiVersion: '1' }

let runs = 0

export async function fetch(ctx) {
  runs += 1
  return { entries: [{ id: `run:${runs}`, title: `第 ${runs} 次` }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the first refresh");
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the second refresh");

        let mut ids: Vec<String> = store::timeline(&mut scratch.db, None, 10)
            .expect("a timeline")
            .into_iter()
            .map(|entry| entry.external_id)
            .collect();
        ids.sort();

        assert_eq!(
            ids,
            ["run:1", "run:2"],
            "the second call started a new runtime instead of reusing the warm one"
        );
    }

    /// An upgrade is new code, so the next call may not be answered by the
    /// process that loaded the old text. The id changes only if the new module
    /// ran, which makes it the whole of the evidence.
    #[test]
    fn an_upgrade_starts_a_new_runtime() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.upgrade', name: 'Upgrade', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ id: 'old:1', title: '旧版' }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the first refresh");

        // Same plugin id, new code: exactly what installing a newer file does.
        install_plugin(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.upgrade', name: 'Upgrade', version: '2.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ id: 'new:1', title: '新版' }] }
}
"#,
        );

        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the second refresh");

        let ids: Vec<String> = store::timeline(&mut scratch.db, None, 10)
            .expect("a timeline")
            .into_iter()
            .map(|entry| entry.external_id)
            .collect();

        assert!(
            ids.contains(&"new:1".to_owned()),
            "the upgraded code did not run; the old runtime answered: {ids:?}"
        );
    }

    /// A second run over the same items writes nothing: `id` is the whole of
    /// the deduplication key, and a feed that re-inserted itself every refresh
    /// would grow without bound while looking like it worked.
    #[test]
    fn a_second_fetch_does_not_insert_again() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ id: 'a', title: 'First' }, { id: 'b', title: 'Second' }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the first refresh");
        let second = refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect("the second refresh");

        assert_eq!(second.inserted, 0);
        assert_eq!(second.unchanged, 2);

        let entries =
            store::timeline(&mut scratch.db, Some(View::Articles), 10).expect("a timeline");
        assert_eq!(entries.len(), 2);
    }

    /// Storage outlives the session that wrote it. A plugin that refreshes a
    /// token, or remembers where it got to, depends on this and nothing else.
    #[test]
    fn what_a_plugin_stores_survives_the_next_run() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  const runs = ((await ctx.storage.get('runs')) ?? 0) + 1
  await ctx.storage.set('runs', runs)

  return { entries: [{ id: String(runs), title: `run ${runs}` }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the first refresh");
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the second refresh");

        // The second run read back the 1 the first one wrote, so its entry is
        // numbered 2 — and both are stored, because their ids differ.
        let entries =
            store::timeline(&mut scratch.db, Some(View::Articles), 10).expect("a timeline");

        assert_eq!(entries.len(), 2);
        assert!(
            entries.iter().any(|entry| entry.external_id == "2"),
            "the second run saw the first run's storage"
        );
    }

    /// A plugin's `fetch` leaves the runtime and is made by the host.
    ///
    /// This is the point of routing `fetch` through the host at all, and the
    /// only place it is proved: a server that exists solely for this test
    /// answers, and the body it sent comes back as an entry.
    #[test]
    fn a_plugins_fetch_is_made_by_the_host() {
        require_runtime!();

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("could not bind");
        let port = listener
            .local_addr()
            .expect("the listener has an address")
            .port();
        listener
            .set_nonblocking(true)
            .expect("the listener can be non-blocking");

        let server = std::thread::spawn(move || {
            // Non-blocking with a deadline rather than a plain `accept`: if the
            // request never arrives the test should fail on its assertions, not
            // hang forever on a thread nobody can interrupt.
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);

            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0u8; 2048];
                        let _ = std::io::Read::read(&mut stream, &mut buffer);

                        let body = "made-by-the-host";
                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );

                        let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() > deadline {
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(_) => return,
                }
            }
        });

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            &format!(
                r#"
export const meta = {{ id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }}

export async function fetch(ctx) {{
  const response = await ctx.fetch('http://127.0.0.1:{port}/hello')
  const body = await response.text()

  return {{ entries: [{{ id: 'one', title: body, summary: String(response.status) }}] }}
}}
"#
            ),
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect("the refresh should work");

        let entries =
            store::timeline(&mut scratch.db, Some(View::Articles), 10).expect("a timeline");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "made-by-the-host");
        assert_eq!(entries[0].summary.as_deref(), Some("200"));

        // And the host's own log agrees the request happened, against the
        // plugin that asked for it.
        assert!(
            http.request_log()
                .iter()
                .any(|request| request.url.ends_with("/hello") && request.status == Some(200)),
            "the request is in the host's log"
        );

        let _ = server.join();
    }

    /// `ctx.article` is a request the plugin makes, answered by the host
    /// fetching the page under the plugin's id and stripping it to the story.
    ///
    /// The navigation and the footer are the evidence that the extractor ran;
    /// the log entry is the evidence that the request is the plugin's, not one
    /// the host decided to make.
    #[test]
    fn a_plugin_can_ask_for_an_article() {
        require_runtime!();

        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("could not bind");
        let port = listener
            .local_addr()
            .expect("the listener has an address")
            .port();
        listener
            .set_nonblocking(true)
            .expect("the listener can be non-blocking");

        let page = format!(
            "<html><body><nav>menu</nav><article><h1>Story</h1><p>{}</p></article>\
             <footer>the footer</footer></body></html>",
            "The story keeps going. ".repeat(20)
        );

        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);

            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut buffer = [0u8; 2048];
                        let _ = std::io::Read::read(&mut stream, &mut buffer);

                        let response = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
                            page.len()
                        );

                        let _ = std::io::Write::write_all(&mut stream, response.as_bytes());
                        return;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() > deadline {
                            return;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                    Err(_) => return,
                }
            }
        });

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            &format!(
                r#"
export const meta = {{ id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }}

export async function fetch(ctx) {{
  return {{ entries: [{{ id: 'one', title: 'A story', url: 'http://127.0.0.1:{port}/story' }}] }}
}}

export async function preview(ctx) {{
  const content = await ctx.article(ctx.item.url)
  return content === null ? null : {{ content }}
}}
"#
            ),
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None).expect("the refresh");

        let entry = store::timeline(&mut scratch.db, None, 10)
            .expect("a timeline")
            .into_iter()
            .next()
            .expect("one entry");

        let drawn = preview_entry(&mut scratch.db, &mut http, None, entry.id)
            .expect("the preview")
            .expect("the page should have a story in it");

        assert!(drawn.contains("Story"), "the story text is missing");
        assert!(
            drawn.contains("The story keeps going."),
            "the article paragraph is missing"
        );
        assert!(!drawn.contains("menu"), "the navigation was kept");
        assert!(!drawn.contains("footer"), "the footer was kept");

        let plugin_id = store::source(&mut scratch.db, source_id)
            .expect("the source")
            .plugin_id;

        assert!(
            http.request_log()
                .iter()
                .any(|request| request.url.ends_with("/story")
                    && request.status == Some(200)
                    && request.plugin == plugin_id),
            "the article request is not in the log as the plugin's"
        );

        let _ = server.join();
    }

    /// A plugin that throws fails the refresh, and what it logged on the way
    /// down comes with it — that line is usually the whole explanation.
    #[test]
    fn a_failing_plugin_records_why_and_keeps_its_log() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  ctx.log.warn('about to fail')
  throw new Error('boom')
}
"#,
        );

        let mut http = Http::new();
        let error = refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect_err("a plugin that throws should fail the refresh");

        let message = error.to_string();
        assert!(
            message.contains("boom"),
            "the thrown error is in it: {message}"
        );
        assert!(
            message.contains("about to fail"),
            "and so is what the plugin logged first: {message}"
        );

        // The failure reaches the row the sidebar reads, or the user sees an
        // empty list and no reason for it.
        let source = store::source(&mut scratch.db, source_id).expect("the source");
        assert!(source.last_error.is_some(), "the failure is recorded");
    }

    /// An entry without an id is refused rather than dropped: it would be
    /// inserted again on every refresh, and a feed quietly missing items is
    /// harder to diagnose than a plugin that says why.
    #[test]
    fn an_entry_without_an_id_fails_the_refresh() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  return { entries: [{ title: 'no id here' }] }
}
"#,
        );

        let mut http = Http::new();
        let error = refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect_err("an entry with no id should fail the refresh");

        // The harness checks this first and names the index itself, so this
        // asserts the behaviour rather than which of the two layers reports it.
        // Both exist on purpose: the harness gives a plugin author a good
        // message, and [`parse_entry`] keeps the rule true if the harness is
        // ever replaced or relaxed.
        let message = error.to_string();
        assert!(
            message.contains("id") && message.contains("refresh"),
            "the failure says the id is the problem: {message}"
        );
    }

    /// A plugin can say what it is doing from inside a refresh.
    ///
    /// This is the whole reason the reports are answered by the host rather
    /// than by the window: `fetch` is where the loop over forty pages is, and
    /// it is also the one hook that runs with nobody watching. Routing a
    /// progress report through the check that the questions get would silence
    /// a plugin in the only run that has something to report.
    #[test]
    fn a_plugin_can_report_from_a_refresh() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  ctx.ui.progress('working', 0.5)
  await ctx.ui.notify('halfway', 'info')
  ctx.ui.progress(null)

  return { entries: [{ id: 'one', title: 'reported' }] }
}
"#,
        );

        let (events, reported) = flume::unbounded::<Event>();
        let mut http = Http::new();

        refresh_source(&mut scratch.db, &mut http, source_id, Some(&events))
            .expect("a refresh that only reports should succeed");

        let reported: Vec<Event> = reported.drain().collect();

        assert!(
            reported.iter().any(|event| matches!(
                event,
                Event::Progress { message: Some(message), value: Some(value) }
                    if message == "working" && (*value - 0.5).abs() < f32::EPSILON
            )),
            "the progress report reached the window: {reported:?}"
        );
        assert!(
            reported.iter().any(|event| matches!(
                event,
                Event::Notify { message, level } if message == "halfway" && level == "info"
            )),
            "the toast reached the window: {reported:?}"
        );
        assert!(
            reported
                .iter()
                .any(|event| matches!(event, Event::Progress { message: None, .. })),
            "and so did the instruction to take the bar down: {reported:?}"
        );
    }

    /// A question asked from a refresh is still refused, and the plugin can
    /// catch the refusal and carry on.
    ///
    /// The two halves of this matter equally. Refusing is what keeps a refresh
    /// from hanging on a dialog nobody will ever see; being catchable is what
    /// keeps that from turning into a plugin that simply stops working when it
    /// is refreshed rather than enabled.
    #[test]
    fn a_question_in_a_refresh_is_refused() {
        require_runtime!();

        let mut scratch = Scratch::new();
        let source_id = install(
            &mut scratch.db,
            r#"
export const meta = { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1' }

export async function fetch(ctx) {
  try {
    await ctx.ui.prompt('key?')
  } catch (error) {
    return { entries: [{ id: 'one', title: error.message }] }
  }

  return { entries: [{ id: 'one', title: 'the prompt was answered' }] }
}
"#,
        );

        let mut http = Http::new();
        refresh_source(&mut scratch.db, &mut http, source_id, None)
            .expect("a plugin that catches the refusal should still refresh");

        let entries =
            store::timeline(&mut scratch.db, Some(View::Articles), 10).expect("a timeline");
        let title = &entries
            .iter()
            .find(|entry| entry.external_id == "one")
            .expect("the entry should be stored")
            .title;

        assert!(
            title.contains("no window"),
            "the plugin was told why there was nobody to ask: {title}"
        );
    }
}
