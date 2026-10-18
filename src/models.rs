//! The application's data model.
//!
//! Three levels, and keeping them distinct is what keeps everything above them
//! coherent:
//!
//! - A [`Plugin`] is installed once for the whole application. Settings that
//!   belong to the plugin itself — an API key — live here.
//! - A [`Source`] is one instance of a plugin, with its own parameters. The
//!   same plugin subscribed to three subreddits is three sources. Settings that
//!   belong to a subscription — which subreddit — live here.
//! - An [`Entry`] is one item a source produced.
//!
//! Collapsing plugin and source into one table is the mistake that makes
//! configuration, deduplication and unread counts all go wrong at once, so they
//! are separate from the start.

use toasty::Deferred;

/// The shape a source's entries take, and therefore which list renderer shows
/// them.
///
/// Stored as an integer so the database does not depend on the Rust enum's
/// layout. The numbering matches the order these are presented in, and a source
/// never carries `All` — that is a filter over the others, not a shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(i32)]
pub enum View {
    Articles = 0,
    SocialMedia = 1,
    Pictures = 2,
    Videos = 3,
    Audios = 4,
    Notifications = 5,
}

impl View {
    pub const ALL: [View; 6] = [
        View::Articles,
        View::SocialMedia,
        View::Pictures,
        View::Videos,
        View::Audios,
        View::Notifications,
    ];

    pub fn from_i32(value: i32) -> Option<View> {
        View::ALL.into_iter().find(|view| *view as i32 == value)
    }

    /// The view a plugin manifest named, or `None` if it is not one of them.
    ///
    /// The spellings are the ones a JavaScript author would reach for; an
    /// unrecognised name is not an error, because a plugin written against a
    /// later version of this list should still install and simply land in the
    /// default view.
    pub fn from_name(name: &str) -> Option<View> {
        match name {
            "articles" => Some(View::Articles),
            "social" | "socialMedia" | "social-media" => Some(View::SocialMedia),
            "pictures" | "photos" | "images" => Some(View::Pictures),
            "videos" | "video" => Some(View::Videos),
            "audios" | "audio" | "podcasts" => Some(View::Audios),
            "notifications" => Some(View::Notifications),
            _ => None,
        }
    }

    /// The name this view is written as in a manifest.
    pub fn name(self) -> &'static str {
        match self {
            View::Articles => "articles",
            View::SocialMedia => "social",
            View::Pictures => "pictures",
            View::Videos => "videos",
            View::Audios => "audios",
            View::Notifications => "notifications",
        }
    }
}

/// An installed plugin: one row per plugin, whatever it is subscribed to.
#[derive(Debug, toasty::Model)]
pub struct Plugin {
    #[key]
    #[auto]
    pub id: u64,

    /// The `id` from the plugin's own manifest. Stable across versions, so a
    /// plugin can be upgraded in place rather than installed twice.
    #[unique]
    pub plugin_id: String,

    pub name: String,
    pub version: String,

    /// The plugin API version the plugin was written against, so that changing
    /// the host API later does not silently break plugins that have not moved.
    pub api_version: String,

    pub description: Option<String>,
    pub icon: Option<String>,

    /// The view a source created from this plugin starts in.
    ///
    /// A default rather than a property of the plugin: the same plugin
    /// subscribed to two places can legitimately want two shapes — a subreddit
    /// of articles and one of pictures — which is why the source carries its
    /// own and this only seeds it.
    pub default_view: i32,

    pub enabled: bool,

    /// The plugin's JavaScript, kept in the database rather than referenced by
    /// path. Installing a plugin is then one row, and the app never depends on
    /// where the code came from or whether that file is still there.
    pub source_code: String,

    /// What the user filled in on the settings page generated from the plugin's
    /// declared schema. Shape is the plugin's business, so it stays opaque.
    #[column(type = text)]
    pub settings: serde_json::Value,

    /// The settings form the plugin declared, kept from the manifest it was
    /// installed with.
    ///
    /// Stored rather than re-read from `source_code` on demand because reading
    /// a manifest means starting a JavaScript runtime, and the settings dialog
    /// has to open on a click. It is also a promise: the controls the user saw
    /// when they installed the plugin are the ones they see when they edit it,
    /// even if the plugin has since been upgraded on disk and not installed.
    #[column(type = text)]
    pub settings_schema: serde_json::Value,

    /// The form describing one source of this plugin, likewise kept from the
    /// manifest.
    #[column(type = text)]
    pub params_schema: serde_json::Value,

    pub installed_at: i64,
    pub updated_at: i64,

    /// Health. A plugin breaking is the normal case rather than an exceptional
    /// one — the sites they scrape change without warning — so the last failure
    /// is part of the model instead of only a log line.
    pub last_run_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,

    #[has_many]
    pub sources: Deferred<Vec<Source>>,
}

/// One instance of a plugin: a subscription.
#[derive(Debug, toasty::Model)]
pub struct Source {
    #[key]
    #[auto]
    pub id: u64,

    #[index]
    pub plugin_id: u64,

    #[belongs_to]
    pub plugin: Deferred<Plugin>,

    /// What the user calls this source. Starts as the plugin's name.
    pub title: String,

    /// The parameters this instance runs with — which subreddit, which tags.
    /// The plugin defines the shape; nothing else reads inside it.
    #[column(type = text)]
    pub params: serde_json::Value,

    /// Which list renderer this source's entries belong to.
    pub view: i32,

    /// Optional grouping in the sidebar.
    pub category: Option<String>,

    pub enabled: bool,
    pub refresh_interval_secs: i64,

    /// Opaque continuation token handed back by the last run, so a plugin that
    /// can fetch incrementally does not have to re-read everything.
    pub cursor: Option<String>,

    pub last_fetched_at: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,

    pub created_at: i64,

    #[has_many]
    pub entries: Deferred<Vec<Entry>>,
}

/// One item a source produced.
#[derive(Debug, toasty::Model)]
pub struct Entry {
    #[key]
    #[auto]
    pub id: u64,

    #[index]
    pub source_id: u64,

    #[belongs_to]
    pub source: Deferred<Source>,

    /// `"{source_id}:{external_id}"`.
    ///
    /// Toasty has no composite unique constraint, and ingesting wants an upsert
    /// keyed on (source, item). Folding the two into one column gives exactly
    /// that: `upsert_by_dedup_key` is generated for free.
    #[unique]
    pub dedup_key: String,

    /// The plugin's own id for this item. It has to be stable across runs, or
    /// every refresh re-inserts the whole list.
    pub external_id: String,

    pub title: String,
    pub url: Option<String>,
    pub author: Option<String>,
    pub published_at: Option<i64>,
    pub inserted_at: i64,

    pub content: Option<String>,
    pub summary: Option<String>,
    pub image: Option<String>,

    /// The body of the entry's own page, read by the host.
    ///
    /// A column of its own rather than a second use of [`Entry::content`],
    /// which is what the plugin said and is rewritten from scratch on every
    /// refresh: for the aggregators that need this — Hacker News knows a
    /// story's title and address and nothing behind it — the plugin returns no
    /// content at all, so a refresh would wipe the article straight back out.
    /// Keeping the two apart also keeps the provenance honest: `content` is the
    /// plugin's, this is the host's.
    pub article: Option<String>,

    /// When the host last read [`Entry::article`]'s page, whether or not there
    /// was anything in it.
    ///
    /// The marker that stops a page being fetched again on every open. A page
    /// with no article in it — a video, a login wall — is read once and left
    /// alone. It is deliberately *not* set when the fetch itself failed, so a
    /// site that was down is tried again next time the entry is opened.
    pub article_at: Option<i64>,

    pub read: bool,

    /// Starred. A flag rather than a join table: there is one user and no sync,
    /// so a row per star would buy nothing. Revisit if either changes.
    pub starred: bool,
}

/// A plugin's own key/value scratch space.
///
/// Distinct from [`Plugin::settings`], which is the *user's* configuration and
/// is rendered into a form for them to fill in. This is the plugin's private
/// state — a session token it refreshes itself, a high-water mark, a cache —
/// and nothing outside the plugin reads it.
///
/// Kept in the database rather than in a file the plugin writes, so it is
/// covered by the same lifecycle as everything else: uninstalling a plugin takes
/// its state with it, and there is no second place to look when something is
/// stale.
#[derive(Debug, toasty::Model)]
pub struct PluginStorage {
    #[key]
    #[auto]
    pub id: u64,

    #[index]
    pub plugin_id: u64,

    /// `"{plugin_id}:{key}"`.
    ///
    /// Toasty has no composite unique constraint and every lookup is (plugin,
    /// key), so folding the two into one column gives exactly that — the same
    /// move as [`Entry::dedup_key`].
    #[unique]
    pub storage_key: String,

    /// Opaque: the plugin defines the shape, and nothing else reads inside it.
    #[column(type = text)]
    pub value: serde_json::Value,

    pub updated_at: i64,
}

/// A preference belonging to the application rather than to a plugin or a
/// source: the order of the view rows, and whatever else turns out to be a
/// property of the window instead of of the data.
///
/// A table of its own rather than a column somewhere, because there is no row
/// these belong to — there is no "the application" row to hang them on — and
/// rather than a config file, because everything else the app remembers is in
/// the database and a second place to look is a second place to get out of step.
///
/// Deliberately *not* [`PluginStorage`]. That one is the plugin's private
/// scratch space, filed under a plugin id; this is the user's, and a plugin has
/// no business reading it. Keeping them apart is what lets a plugin be
/// uninstalled without wondering which rows were its state and which were the
/// user's settings.
#[derive(Debug, toasty::Model)]
pub struct Setting {
    #[key]
    #[auto]
    pub id: u64,

    /// Stable across releases, and never shown to anyone.
    #[unique]
    pub key: String,

    /// A JSON value, so a preference that is a number or a flag needs no
    /// migration of its own — the same reasoning as [`PluginStorage::value`].
    #[column(type = text)]
    pub value: serde_json::Value,

    pub updated_at: i64,
}

/// A user-built collection of entries.
#[derive(Debug, toasty::Model)]
pub struct List {
    #[key]
    #[auto]
    pub id: u64,

    #[unique]
    pub name: String,

    pub created_at: i64,
}

/// Membership of an entry in a list.
#[derive(Debug, toasty::Model)]
pub struct ListEntry {
    #[key]
    #[auto]
    pub id: u64,

    #[index]
    pub list_id: u64,

    #[belongs_to]
    pub list: Deferred<List>,

    #[index]
    pub entry_id: u64,

    #[belongs_to]
    pub entry: Deferred<Entry>,

    pub added_at: i64,
}

/// One cookie in the application-wide jar.
///
/// The jar belongs to the app, not to a plugin. A site session is a public
/// resource that every plugin touching that site shares — that is what makes a
/// login once usable everywhere — so there is deliberately no owner column.
/// The policy that fills and reads this table lives in `crate::http`.
#[derive(Debug, toasty::Model)]
pub struct Cookie {
    #[key]
    #[auto]
    pub id: u64,

    /// Lower-cased host the cookie applies to, with no leading dot. For a
    /// host-only cookie this is the exact request host; for a domain cookie it
    /// is the `Domain` attribute, which also covers that domain's subdomains.
    ///
    /// Indexed because every request looks cookies up by domain, walking the
    /// host's parent domains.
    #[index]
    pub domain: String,

    pub path: String,

    pub name: String,
    pub value: String,

    /// `true` when the `Set-Cookie` carried no `Domain` attribute, which
    /// restricts the cookie to `domain` exactly. The flag has to be stored
    /// rather than inferred from the domain string: without it a host-only
    /// cookie for `example.com` would be sent to `evil.example.com`.
    pub host_only: bool,

    /// Seconds since the Unix epoch, or `None` for a session cookie — a cookie
    /// the server set with neither `Expires` nor `Max-Age`. Session cookies are
    /// kept rather than dropped at exit, because dropping them would log the
    /// user out of every site that uses one; see `http::JarCookie`.
    pub expires_at: Option<i64>,

    pub secure: bool,
    pub http_only: bool,

    pub created_at: i64,
}
