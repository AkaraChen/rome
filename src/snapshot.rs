//! Everything the UI draws, as one value.
//!
//! The UI is a pure function of a [`Snapshot`]. It never reads the database and
//! never asks it a question of its own — it renders what it was last handed and
//! sends [`crate::worker::Command`]s when the user does something. That split is
//! forced by the shape of the work rather than chosen for tidiness: a `store::`
//! call blocks its thread until the statement finishes, and a plugin run blocks
//! for as long as thirty seconds, so none of it can happen on the thread that
//! draws the window.
//!
//! It also removes a whole class of bug. A sidebar that queries for itself can
//! show a count from one moment beside a list from another; a snapshot cannot,
//! because everything in it was read in the same pass.

use crate::models::View;

/// What the middle column is showing.
///
/// The worker owns this rather than the UI, so that the sidebar's highlight and
/// the list beneath it can never disagree — they are both derived from the same
/// snapshot, produced from the same selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Selection {
    /// Everything, which is a filter over the views rather than one of them.
    #[default]
    All,
    View(View),
    Starred,
    /// One source's entries.
    Source(u64),
    /// One user-made list.
    List(u64),
}

impl Selection {
    /// Whether `selection` is what the given sidebar row stands for, so a row
    /// can tell whether it is the active one.
    pub fn is(self, other: Selection) -> bool {
        self == other
    }
}

/// One entry in a view tab, with what its badge counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tab {
    pub view: View,
    pub unread: usize,
}

/// One source, as the sidebar draws it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRow {
    pub id: u64,
    pub plugin_id: u64,
    pub title: String,
    pub view: View,
    /// Which group it is filed under, if any.
    pub category: Option<String>,
    pub enabled: bool,
    /// What this subscription passes to the plugin.
    ///
    /// Carried so the edit dialog can start from the values in force rather
    /// than from the schema's defaults, which would silently change a working
    /// source back to its initial state the moment the user opened it.
    pub params: serde_json::Value,
    pub unread: usize,
    /// The last failure, if the source is currently broken.
    ///
    /// A plugin that stopped working is the normal case rather than an
    /// exceptional one — the sites they read change without warning — so this
    /// is part of the row rather than something the user has to go looking for.
    pub error: Option<String>,
}

/// One installed plugin, as the plugin manager draws it.
///
/// Health is reported per plugin rather than per source because that is how it
/// actually fails: when a site changes its markup, every source reading it
/// breaks in the same breath, and five identical warnings is a worse way to say
/// one thing than a single row naming the plugin.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginRow {
    pub id: u64,
    /// The plugin's own identifier, from its manifest — `"hacker-news"`, not a
    /// row number.
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub enabled: bool,
    /// How many sources are subscribed to it.
    pub sources: usize,
    /// The most recent failure any of its sources recorded, if one is broken.
    pub error: Option<String>,
    /// The domains this plugin has most recently fetched from, newest first.
    ///
    /// The transport records every request a plugin makes, which is what lets
    /// the trust story be "here is every domain it reached" rather than a
    /// promise; this is that record, filtered to this plugin and deduplicated
    /// by host. The worker caps it, because it rides in every snapshot and a
    /// snapshot is cloned into every frame.
    pub recent_domains: Vec<String>,
    /// What the user filled in last time.
    pub settings: serde_json::Value,
    /// The forms the plugin declared when it was installed.
    ///
    /// Carried in the snapshot rather than fetched when a dialog opens because
    /// asking the plugin again means starting a JavaScript runtime, and a
    /// settings dialog that takes a second to appear is a settings dialog that
    /// feels broken.
    pub settings_schema: serde_json::Value,
    pub params_schema: serde_json::Value,
}

/// One user-made list, as the sidebar draws it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListRow {
    pub id: u64,
    pub name: String,
    pub count: usize,
}

/// One entry, as the middle column draws it.
///
/// No `content`: a list of two hundred entries carrying two hundred articles'
/// worth of HTML is a lot of memory to move across a channel for something only
/// one of them will be read. The full text arrives separately, when an entry is
/// opened — see [`EntryDetail`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryRow {
    pub id: u64,
    pub source_id: u64,
    /// The source's title, so a row can say where it came from without the UI
    /// having to join it against the source list itself.
    pub source_title: String,
    pub title: String,
    pub url: Option<String>,
    pub author: Option<String>,
    /// Seconds since the Unix epoch.
    pub published_at: Option<i64>,
    pub summary: Option<String>,
    pub image: Option<String>,
    pub read: bool,
    pub starred: bool,
}

/// What the host found when it read the entry's own page.
///
/// An enum rather than an `Option` and a flag, because the three states the
/// reading pane has to tell apart are exclusive and one of them is a question
/// rather than an answer: whether the page is being read right now decides
/// whether the pane says so, and "no article yet" and "no article ever" look
/// the same in the text and mean different things on screen.
///
/// It only ever applies to entries a plugin left empty-handed, which is every
/// link aggregator: Hacker News knows a story's title and its address, and
/// nothing about what is behind it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum Article {
    /// Nobody has read the page, and nobody is going to: the plugin supplied a
    /// body of its own, the entry has no address, or the page has already been
    /// read and had nothing in it.
    #[default]
    Idle,
    /// The host is reading it now. This is the one state the pane has to say
    /// out loud, because the entry it is showing has no body in it yet.
    Reading,
    /// What the page turned out to hold. Empty is a real answer — the fetch
    /// succeeded and there was no article in it — and is not the same as
    /// [`Article::Idle`], because the next open will not fetch it again.
    Read(String),
    /// The page could not be fetched. The next open tries again.
    Failed,
}

/// One entry with its full text, for the reading pane.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryDetail {
    pub id: u64,
    pub title: String,
    pub url: Option<String>,
    pub author: Option<String>,
    pub published_at: Option<i64>,
    pub content: Option<String>,
    pub summary: Option<String>,
    /// The body of the entry's own page, which the host read for the entries
    /// whose plugin had none. See [`Article`].
    pub article: Article,
    /// The picture the feed attached to this entry, if any.
    ///
    /// Carried separately from the content because it is the article's hero:
    /// `content` often repeats it as its first `<img>`, and the reading pane
    /// needs to know which URL is the one drawing the banner so it does not
    /// draw it twice.
    pub image: Option<String>,
    pub source_title: String,
    pub read: bool,
    pub starred: bool,
}

/// Everything the UI draws.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Snapshot {
    /// One per [`View`], in presentation order, each with its unread count.
    pub tabs: Vec<Tab>,
    /// Unread across every source, which is what the "全部" row counts.
    pub unread: usize,
    pub starred: usize,
    pub sources: Vec<SourceRow>,
    pub plugins: Vec<PluginRow>,
    pub lists: Vec<ListRow>,

    pub selection: Selection,
    /// The query the middle column is filtered by, if the user is searching.
    ///
    /// Overrides `selection` while it is set: a search is across everything,
    /// and a search that silently only looked inside the selected view would be
    /// a bug the user could not see.
    pub search: Option<String>,
    pub entries: Vec<EntryRow>,
    /// The entry the reading pane is showing, if one is open.
    pub open: Option<EntryDetail>,

    /// True while the worker is doing something the user is waiting on, so the
    /// UI can say so rather than looking frozen.
    pub busy: bool,
    /// What the worker is doing, for that message.
    pub busy_with: Option<String>,

    /// Set when the last command failed in a way the user should see.
    ///
    /// Separate from a source's own `error`: this is about the app, not about
    /// one subscription — a database that will not open, a plugin that would
    /// not install.
    pub error: Option<String>,
}

/// One item a plugin offered to let the user choose from.
///
/// Deliberately untyped: `ctx.ui.pick` is handed whatever the plugin passes,
/// and the chosen one is handed straight back. The host has no business
/// understanding it.
pub type PickItem = serde_json::Value;
