//! Reading and writing the application's data.
//!
//! Every function here is one complete operation that has already finished by
//! the time it returns, so the UI thread never holds a future. The bodies are
//! ordinary async Toasty code; [`Database::run`] is the only place the runtime
//! and the executor appear.

use std::collections::HashMap;

use crate::db::Database;
use crate::models::{Entry, List, ListEntry, Plugin, PluginStorage, Setting, Source, View};
use crate::snapshot::Selection;

/// Seconds since the Unix epoch.
///
/// Every timestamp in the schema is one of these rather than a typed date, so
/// the database stores no opinion about time zones and the app can decide how
/// to present them.
pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs() as i64
}

/// One item a plugin returned, before it becomes an [`Entry`].
#[derive(Debug, Clone, Default)]
pub struct NewEntry {
    /// The plugin's own id for the item. It has to be stable across runs, or
    /// every refresh inserts the whole list again.
    pub external_id: String,
    pub title: String,
    pub url: Option<String>,
    pub author: Option<String>,
    pub published_at: Option<i64>,
    pub content: Option<String>,
    pub summary: Option<String>,
    pub image: Option<String>,
    /// The values the plugin wants handed back to its `preview` hook for this
    /// item. See [`crate::models::Entry::params`].
    pub params: Option<serde_json::Value>,
}

/// What one ingest did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct IngestReport {
    pub inserted: usize,
    pub updated: usize,
    /// Items whose stored fields were already identical, so nothing was
    /// written. A healthy plugin that returns an unchanged window lands
    /// entirely here, and a refresh that changes nothing costs no writes.
    pub unchanged: usize,
}

/// A plugin being installed or upgraded.
#[derive(Debug, Clone)]
pub struct NewPlugin {
    pub plugin_id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    pub description: Option<String>,
    pub icon: Option<String>,
    /// The view this plugin's sources start in, from its manifest.
    pub default_view: View,
    pub source_code: String,
    pub settings: serde_json::Value,
    /// The forms the plugin declared, kept so its settings can be edited later
    /// without starting a JavaScript runtime to ask it again.
    pub settings_schema: serde_json::Value,
    pub params_schema: serde_json::Value,
    /// Whether the plugin's module exports a `preview` hook. See
    /// [`crate::models::Plugin::has_preview`].
    pub has_preview: bool,
}

/// Install a plugin, or upgrade it in place if its id is already present.
///
/// Installing by id rather than inserting means a plugin author can ship a new
/// version without the user losing their sources or their settings.
pub fn install_plugin(db: &mut Database, plugin: NewPlugin) -> toasty::Result<Plugin> {
    let timestamp = now();

    db.run(|conn| {
        Box::pin(async move {
            let existing = Plugin::filter_by_plugin_id(&plugin.plugin_id)
                .first()
                .exec(&mut *conn)
                .await?;

            match existing {
                Some(mut record) => {
                    toasty::update!(record {
                        name: plugin.name,
                        version: plugin.version,
                        api_version: plugin.api_version,
                        description: plugin.description,
                        icon: plugin.icon,
                        // A new version may declare a different default view.
                        // Only the default moves; sources already created keep
                        // the view they were made with.
                        default_view: plugin.default_view as i32,
                        source_code: plugin.source_code,
                        // The declared forms move with the code: an upgrade
                        // that adds a field should make it appear in the
                        // dialog that edits it.
                        settings_schema: plugin.settings_schema,
                        params_schema: plugin.params_schema,
                        // Whether the hook exists moves with the code, like
                        // the forms do: an upgrade that adds `preview` should
                        // start using it without a reinstall.
                        has_preview: plugin.has_preview,
                        updated_at: timestamp,
                    })
                    .exec(&mut *conn)
                    .await?;

                    Ok(record)
                }
                None => {
                    toasty::create!(Plugin {
                        plugin_id: plugin.plugin_id,
                        name: plugin.name,
                        version: plugin.version,
                        api_version: plugin.api_version,
                        description: plugin.description,
                        icon: plugin.icon,
                        default_view: plugin.default_view as i32,
                        enabled: true,
                        has_preview: plugin.has_preview,
                        source_code: plugin.source_code,
                        settings: plugin.settings,
                        settings_schema: plugin.settings_schema,
                        params_schema: plugin.params_schema,
                        installed_at: timestamp,
                        updated_at: timestamp,
                        last_run_at: None,
                        last_error: None,
                        last_error_at: None,
                    })
                    .exec(&mut *conn)
                    .await
                }
            }
        })
    })
}

pub fn list_plugins(db: &mut Database) -> toasty::Result<Vec<Plugin>> {
    db.run(|conn| Box::pin(async move { Plugin::all().exec(&mut *conn).await }))
}

/// One plugin by its row id.
pub fn plugin(db: &mut Database, plugin_id: u64) -> toasty::Result<Plugin> {
    db.run(move |conn| Box::pin(async move { Plugin::get_by_id(&mut *conn, &plugin_id).await }))
}

pub fn set_plugin_enabled(db: &mut Database, plugin_id: u64, enabled: bool) -> toasty::Result<()> {
    db.run(|conn| {
        Box::pin(async move {
            let mut plugin = Plugin::get_by_id(&mut *conn, &plugin_id).await?;
            toasty::update!(plugin { enabled }).exec(&mut *conn).await
        })
    })
}

/// A source being created.
#[derive(Debug, Clone)]
pub struct NewSource {
    pub plugin_id: u64,
    pub title: String,
    pub params: serde_json::Value,
    pub view: View,
    pub category: Option<String>,
    pub refresh_interval_secs: i64,
}

pub fn create_source(db: &mut Database, source: NewSource) -> toasty::Result<Source> {
    let created_at = now();

    db.run(|conn| {
        Box::pin(async move {
            toasty::create!(Source {
                plugin_id: source.plugin_id,
                title: source.title,
                params: source.params,
                view: source.view as i32,
                category: source.category,
                enabled: true,
                refresh_interval_secs: source.refresh_interval_secs,
                cursor: None,
                last_fetched_at: None,
                last_error: None,
                last_error_at: None,
                created_at,
            })
            .exec(&mut *conn)
            .await
        })
    })
}

pub fn list_sources(db: &mut Database) -> toasty::Result<Vec<Source>> {
    db.run(|conn| Box::pin(async move { Source::all().exec(&mut *conn).await }))
}

/// One source by its row id.
pub fn source(db: &mut Database, source_id: u64) -> toasty::Result<Source> {
    db.run(move |conn| Box::pin(async move { Source::get_by_id(&mut *conn, &source_id).await }))
}

/// Forget a source and everything it fetched.
///
/// The entries go with it, and so do their list memberships. Toasty's
/// `belongs_to` is a relation in the ORM, not a foreign key in the schema —
/// there is no `ON DELETE CASCADE` to lean on — so a delete that stopped at the
/// source row would leave its entries behind, still counted in 全部 and still
/// reachable from a list, pointing at a source that no longer exists.
pub fn delete_source(db: &mut Database, source_id: u64) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let ids: Vec<u64> = Entry::filter_by_source_id(source_id)
                .exec(&mut *conn)
                .await?
                .into_iter()
                .map(|entry| entry.id)
                .collect();

            if !ids.is_empty() {
                // Memberships first: they point at the entries, so the other
                // order would leave rows nothing can name.
                ListEntry::filter(ListEntry::fields().entry_id().in_list(ids.clone()))
                    .delete()
                    .exec(&mut *conn)
                    .await?;

                Entry::filter(Entry::fields().id().in_list(ids))
                    .delete()
                    .exec(&mut *conn)
                    .await?;
            }

            Source::get_by_id(&mut *conn, &source_id)
                .await?
                .delete()
                .exec(&mut *conn)
                .await
        })
    })
}

/// Forget a plugin, its sources, its entries and its storage.
///
/// Switching a plugin off is the reversible move and keeps all of this; this is
/// the one that does not come back. The code file beside the database is left
/// alone — it is a file the user can look at, and a plugin that was uninstalled
/// is exactly the one somebody wants to read.
pub fn uninstall_plugin(db: &mut Database, plugin_id: u64) -> toasty::Result<()> {
    let source_ids: Vec<u64> = list_sources(db)?
        .into_iter()
        .filter(|source| source.plugin_id == plugin_id)
        .map(|source| source.id)
        .collect();

    for source_id in source_ids {
        delete_source(db, source_id)?;
    }

    db.run(move |conn| {
        Box::pin(async move {
            PluginStorage::filter_by_plugin_id(plugin_id)
                .delete()
                .exec(&mut *conn)
                .await?;

            Plugin::get_by_id(&mut *conn, &plugin_id)
                .await?
                .delete()
                .exec(&mut *conn)
                .await
        })
    })
}

/// The name of one list.
///
/// Used for the confirmation after an entry is filed, which is the only place
/// the app has to say which list something went into.
pub fn list_name(db: &mut Database, list_id: u64) -> toasty::Result<String> {
    db.run(move |conn| {
        Box::pin(async move {
            List::get_by_id(&mut *conn, &list_id)
                .await
                .map(|list| list.name)
        })
    })
}

/// Record how a fetch went, so the sidebar can show a source that has stopped
/// working.
///
/// A failing source is the normal case rather than an exceptional one: the
/// sites plugins read change without warning. Clearing the error on success is
/// part of the same write, so the state is never stale in one direction.
pub fn record_fetch(
    db: &mut Database,
    source_id: u64,
    outcome: Result<Option<String>, String>,
) -> toasty::Result<()> {
    let timestamp = now();

    db.run(|conn| {
        Box::pin(async move {
            let mut source = Source::get_by_id(&mut *conn, &source_id).await?;

            match outcome {
                Ok(cursor) => {
                    toasty::update!(source {
                        cursor,
                        last_fetched_at: Some(timestamp),
                        last_error: None,
                        last_error_at: None,
                    })
                    .exec(&mut *conn)
                    .await
                }
                Err(message) => {
                    toasty::update!(source {
                        last_fetched_at: Some(timestamp),
                        last_error: Some(message),
                        last_error_at: Some(timestamp),
                    })
                    .exec(&mut *conn)
                    .await
                }
            }
        })
    })
}

/// Fold a plugin's output into the entries table.
///
/// The plugin returns a window of its most recent items, the same way a feed
/// does, and this decides what is new. Items already stored keep their `read`
/// and `starred` state and their original `inserted_at`: those belong to the
/// user and the app, and a refresh must not be able to reset them.
pub fn ingest(
    db: &mut Database,
    source_id: u64,
    entries: &[NewEntry],
) -> toasty::Result<IngestReport> {
    let inserted_at = now();
    // Owned, because the future `run` returns has to be valid for every
    // lifetime of the connection borrow — a borrowed slice cannot satisfy
    // that, however long it actually lives.
    let entries = entries.to_vec();

    db.run(move |conn| {
        Box::pin(async move {
            let existing = Entry::filter_by_source_id(source_id)
                .exec(&mut *conn)
                .await?;

            let mut known: HashMap<String, Entry> = existing
                .into_iter()
                .map(|entry| (entry.dedup_key.clone(), entry))
                .collect();

            let mut report = IngestReport::default();

            for new in entries {
                let dedup_key = format!("{source_id}:{}", new.external_id);

                let Some(mut entry) = known.remove(&dedup_key) else {
                    toasty::create!(Entry {
                        source_id,
                        dedup_key,
                        external_id: new.external_id.clone(),
                        title: new.title.clone(),
                        url: new.url.clone(),
                        author: new.author.clone(),
                        published_at: new.published_at,
                        inserted_at,
                        content: new.content.clone(),
                        summary: new.summary.clone(),
                        image: new.image.clone(),
                        params: new.params.clone(),
                        read: false,
                        starred: false,
                    })
                    .exec(&mut *conn)
                    .await?;

                    report.inserted += 1;
                    continue;
                };

                let changed = entry.title != new.title
                    || entry.url != new.url
                    || entry.author != new.author
                    || entry.published_at != new.published_at
                    || entry.content != new.content
                    || entry.summary != new.summary
                    || entry.image != new.image
                    || entry.params != new.params;

                if !changed {
                    report.unchanged += 1;
                    continue;
                }

                toasty::update!(entry {
                    title: new.title.clone(),
                    url: new.url.clone(),
                    author: new.author.clone(),
                    published_at: new.published_at,
                    content: new.content.clone(),
                    summary: new.summary.clone(),
                    image: new.image.clone(),
                    params: new.params.clone(),
                })
                .exec(&mut *conn)
                .await?;

                report.updated += 1;
            }

            Ok(report)
        })
    })
}

/// The timeline for a view, newest first.
///
/// Entries carry no view of their own — a view is a property of the source that
/// produced them — so this reads the sources for the view and then their
/// entries, one bounded query each. Per-source limits rather than one global
/// limit, because a single limit applied before the merge would let a noisy
/// source crowd the others out entirely.
pub fn timeline(db: &mut Database, view: Option<View>, limit: usize) -> toasty::Result<Vec<Entry>> {
    db.run(|conn| {
        Box::pin(async move {
            let sources = Source::all().exec(&mut *conn).await?;

            let mut entries = Vec::new();

            for source in sources {
                if let Some(view) = view
                    && source.view != view as i32
                {
                    continue;
                }

                let mut found = Entry::filter_by_source_id(source.id)
                    .order_by((
                        Entry::fields().published_at().desc(),
                        Entry::fields().inserted_at().desc(),
                    ))
                    .limit(limit)
                    .exec(&mut *conn)
                    .await?;

                entries.append(&mut found);
            }

            entries.sort_by(|a, b| {
                let a = (a.published_at, a.inserted_at, a.id);
                let b = (b.published_at, b.inserted_at, b.id);
                b.cmp(&a)
            });
            entries.truncate(limit);

            Ok(entries)
        })
    })
}

pub fn set_read(db: &mut Database, entry_id: u64, read: bool) -> toasty::Result<()> {
    db.run(|conn| {
        Box::pin(async move {
            let mut entry = Entry::get_by_id(&mut *conn, &entry_id).await?;
            toasty::update!(entry { read }).exec(&mut *conn).await
        })
    })
}

pub fn set_starred(db: &mut Database, entry_id: u64, starred: bool) -> toasty::Result<()> {
    db.run(|conn| {
        Box::pin(async move {
            let mut entry = Entry::get_by_id(&mut *conn, &entry_id).await?;
            toasty::update!(entry { starred }).exec(&mut *conn).await
        })
    })
}

/// Record what the host found when it read an entry's own page.
///
/// `article_at` is written whether or not there was an article to write, which
/// is what the two arguments are for: the timestamp is the record of the
/// *attempt*, and a page with nothing to read is a page that should not be
/// fetched again every time the reader opens the entry.
pub fn set_article(
    db: &mut Database,
    entry_id: u64,
    article: Option<String>,
    at: i64,
) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let mut entry = Entry::get_by_id(&mut *conn, &entry_id).await?;

            toasty::update!(entry {
                article,
                article_at: Some(at),
            })
            .exec(&mut *conn)
            .await
        })
    })
}

/// Store the page the plugin drew for an entry, and when it drew it.
///
/// The same shape as [`set_article`], and deliberately separate from it: the
/// two are different provenances — one the plugin's, one the host's — and a
/// refresh must not wipe either.
pub fn set_preview(
    db: &mut Database,
    entry_id: u64,
    preview: Option<String>,
    at: i64,
) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let mut entry = Entry::get_by_id(&mut *conn, &entry_id).await?;

            toasty::update!(entry {
                preview,
                preview_at: Some(at),
            })
            .exec(&mut *conn)
            .await
        })
    })
}

pub fn list_starred(db: &mut Database, limit: usize) -> toasty::Result<Vec<Entry>> {
    db.run(|conn| {
        Box::pin(async move {
            Entry::filter(Entry::fields().starred().eq(true))
                .order_by((
                    Entry::fields().published_at().desc(),
                    Entry::fields().inserted_at().desc(),
                ))
                .limit(limit)
                .exec(&mut *conn)
                .await
        })
    })
}

/// The user's lists, for the sidebar's bottom section.
pub fn list_lists(db: &mut Database) -> toasty::Result<Vec<List>> {
    db.run(|conn| Box::pin(async move { List::all().exec(&mut *conn).await }))
}

/// Make a list, or hand back the one that already has that name.
///
/// The name is unique, so asking for the same list twice is asking for the same
/// list. Failing instead would turn a double click into an error the user
/// cannot see the reason for, and would leave them wondering which of two
/// identical-looking lists their entry went into.
pub fn create_list(db: &mut Database, name: &str) -> toasty::Result<List> {
    let name = name.trim().to_owned();

    db.run(move |conn| {
        Box::pin(async move {
            let existing = List::filter(List::fields().name().eq(name.clone()))
                .first()
                .exec(&mut *conn)
                .await?;

            match existing {
                Some(list) => Ok(list),
                None => {
                    toasty::create!(List {
                        name,
                        created_at: now(),
                    })
                    .exec(&mut *conn)
                    .await
                }
            }
        })
    })
}

/// Rename a list.
///
/// A name already in use comes back as an error from the database rather than
/// being resolved here: two lists cannot share a name, and silently merging
/// them would lose entries the user did not ask to move.
pub fn rename_list(db: &mut Database, list_id: u64, name: &str) -> toasty::Result<()> {
    let name = name.trim().to_owned();

    db.run(move |conn| {
        Box::pin(async move {
            let mut list = List::get_by_id(&mut *conn, &list_id).await?;
            toasty::update!(list { name }).exec(&mut *conn).await
        })
    })
}

/// Delete a list and everything that was in it.
///
/// The entries are not touched: a list is a way of pointing at entries, not a
/// container that owns them. Deleting one takes away the collection, never the
/// reading.
pub fn delete_list(db: &mut Database, list_id: u64) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            ListEntry::filter_by_list_id(list_id)
                .delete()
                .exec(&mut *conn)
                .await?;

            List::get_by_id(&mut *conn, &list_id)
                .await?
                .delete()
                .exec(&mut *conn)
                .await
        })
    })
}

/// Put an entry in a list. Adding one that is already there is not an error.
///
/// Membership is a fact, not an event: the second time the user adds an entry
/// they already collected, they are checking that it is there.
pub fn add_to_list(db: &mut Database, list_id: u64, entry_id: u64) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let existing = ListEntry::filter(
                ListEntry::fields()
                    .list_id()
                    .eq(list_id)
                    .and(ListEntry::fields().entry_id().eq(entry_id)),
            )
            .first()
            .exec(&mut *conn)
            .await?;

            if existing.is_some() {
                return Ok(());
            }

            toasty::create!(ListEntry {
                list_id,
                entry_id,
                added_at: now(),
            })
            .exec(&mut *conn)
            .await
            .map(|_| ())
        })
    })
}

/// Take an entry out of a list.
pub fn remove_from_list(db: &mut Database, list_id: u64, entry_id: u64) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            ListEntry::filter(
                ListEntry::fields()
                    .list_id()
                    .eq(list_id)
                    .and(ListEntry::fields().entry_id().eq(entry_id)),
            )
            .delete()
            .exec(&mut *conn)
            .await
        })
    })
}

/// What the sidebar's badges count.
///
/// One snapshot rather than a count per tab, so the total can never disagree
/// with the parts it is made of.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Unread {
    /// Unread entries across every source, which is what "全部" shows.
    pub total: usize,
    /// Unread entries per view, indexed by `View as usize`.
    ///
    /// An array rather than a map because `View` is a small closed set with
    /// contiguous discriminants — see the enum in `models`. A source whose
    /// stored view is not one of them still counts towards `total`; it simply
    /// has no tab to appear under.
    pub by_view: [usize; View::ALL.len()],
    /// Starred entries, whatever view they are in. The starred row is a filter
    /// over everything, so it is counted on its own rather than folded into a
    /// view, where a starred entry would be counted twice.
    pub starred: usize,
    /// Unread entries per source, keyed by source id.
    ///
    /// Gathered in the same pass as the rest: the sidebar shows a source's own
    /// count beside the view totals it is part of, and reading them at two
    /// different moments is how those two numbers end up disagreeing.
    pub by_source: HashMap<u64, usize>,
}

impl Unread {
    /// Unread entries belonging to `view`.
    pub fn for_view(&self, view: View) -> usize {
        self.by_view[view as usize]
    }
}

/// Count what the sidebar shows badges for.
///
/// One `COUNT(*)` per source rather than a single grouped query: Toasty has no
/// `GROUP BY`, the set of sources is small, and each of these is a count over
/// the index on `source_id` rather than a scan of the entries table.
pub fn unread_counts(db: &mut Database) -> toasty::Result<Unread> {
    db.run(|conn| {
        Box::pin(async move {
            let mut unread = Unread::default();

            for source in Source::all().exec(&mut *conn).await? {
                let count = Entry::filter_by_source_id(source.id)
                    .filter(Entry::fields().read().eq(false))
                    .count()
                    .exec(&mut *conn)
                    .await? as usize;

                unread.total += count;
                unread.by_source.insert(source.id, count);

                if let Some(view) = View::from_i32(source.view) {
                    unread.by_view[view as usize] += count;
                }
            }

            unread.starred = Entry::filter(Entry::fields().starred().eq(true))
                .count()
                .exec(&mut *conn)
                .await? as usize;

            Ok(unread)
        })
    })
}

/// The column a plugin's storage entry is filed under.
///
/// See [`PluginStorage::storage_key`]: the pair is folded into one string
/// because Toasty has no composite unique constraint. `:` is safe as a separator
/// only because the numeric plugin id always comes first — a key that itself
/// contains `:` still lands under its own plugin and cannot collide with a
/// different one's row.
fn storage_key(plugin_id: u64, key: &str) -> String {
    format!("{plugin_id}:{key}")
}

/// Read a value a plugin stored for itself.
///
/// `None` when the plugin has never written that key, which is how a plugin
/// tells "no cached token yet" from "cached an empty one".
pub fn storage_get(
    db: &mut Database,
    plugin_id: u64,
    key: &str,
) -> toasty::Result<Option<serde_json::Value>> {
    let storage_key = storage_key(plugin_id, key);

    db.run(move |conn| {
        Box::pin(async move {
            Ok(PluginStorage::filter_by_storage_key(&storage_key)
                .first()
                .exec(&mut *conn)
                .await?
                .map(|row| row.value))
        })
    })
}

/// Write a value a plugin stored for itself, replacing whatever was there.
///
/// Read-then-write rather than a real upsert because Toasty's generated
/// `upsert_by_*` wants the whole row including the auto id, and this is on the
/// path a plugin takes whenever it refreshes a token — one indexed lookup
/// against a local file.
pub fn storage_set(
    db: &mut Database,
    plugin_id: u64,
    key: &str,
    value: serde_json::Value,
) -> toasty::Result<()> {
    let storage_key = storage_key(plugin_id, key);
    let updated_at = now();

    db.run(move |conn| {
        Box::pin(async move {
            let existing = PluginStorage::filter_by_storage_key(&storage_key)
                .first()
                .exec(&mut *conn)
                .await?;

            match existing {
                Some(mut row) => {
                    toasty::update!(row { value, updated_at })
                        .exec(&mut *conn)
                        .await
                }
                None => toasty::create!(PluginStorage {
                    plugin_id,
                    storage_key,
                    value,
                    updated_at,
                })
                .exec(&mut *conn)
                .await
                .map(|_| ()),
            }
        })
    })
}

/// Read an application preference.
///
/// `None` when it has never been set, which every caller has to treat as "use
/// the default" rather than as an error: a fresh database has no preferences in
/// it, and that is the normal state of a first launch.
pub fn setting_get(db: &mut Database, key: &str) -> toasty::Result<Option<serde_json::Value>> {
    let key = key.to_owned();

    db.run(move |conn| {
        Box::pin(async move {
            Ok(Setting::filter_by_key(&key)
                .first()
                .exec(&mut *conn)
                .await?
                .map(|row| row.value))
        })
    })
}

/// Write an application preference, replacing whatever was there.
///
/// Read-then-write rather than an upsert, for the reason [`storage_set`] gives:
/// Toasty's generated `upsert_by_*` wants the whole row including the auto id,
/// and this is one indexed lookup against a local file, on a path the user
/// takes by moving a row in the sidebar.
pub fn setting_set(db: &mut Database, key: &str, value: serde_json::Value) -> toasty::Result<()> {
    let key = key.to_owned();
    let updated_at = now();

    db.run(move |conn| {
        Box::pin(async move {
            let existing = Setting::filter_by_key(&key)
                .first()
                .exec(&mut *conn)
                .await?;

            match existing {
                Some(mut row) => {
                    toasty::update!(row { value, updated_at })
                        .exec(&mut *conn)
                        .await
                }
                None => toasty::create!(Setting {
                    key,
                    value,
                    updated_at,
                })
                .exec(&mut *conn)
                .await
                .map(|_| ()),
            }
        })
    })
}

/// How many entries each list holds, keyed by list id.
///
/// One count per list rather than a grouped query, for the same reason the
/// unread counts are: Toasty has no `GROUP BY`, and the set of lists is small.
pub fn list_counts(db: &mut Database) -> toasty::Result<HashMap<u64, usize>> {
    db.run(|conn| {
        Box::pin(async move {
            let mut counts = HashMap::new();

            for list in List::all().exec(&mut *conn).await? {
                let count = ListEntry::filter_by_list_id(list.id)
                    .count()
                    .exec(&mut *conn)
                    .await? as usize;

                counts.insert(list.id, count);
            }

            Ok(counts)
        })
    })
}

/// The entries a selection shows, newest first.
///
/// A view is a property of the source that produced an entry, not of the entry,
/// so selecting one reads the sources first and then filters on their ids —
/// which is one extra statement against a small table rather than a join Toasty
/// cannot express.
pub fn entries_for(
    db: &mut Database,
    selection: Selection,
    limit: usize,
) -> toasty::Result<Vec<Entry>> {
    db.run(move |conn| {
        Box::pin(async move {
            let query = match selection {
                Selection::All => Entry::all(),

                Selection::View(view) => {
                    let ids = source_ids_with_view(&mut *conn, view).await?;
                    if ids.is_empty() {
                        return Ok(Vec::new());
                    }
                    Entry::filter(Entry::fields().source_id().in_list(ids))
                }

                Selection::Starred => Entry::filter(Entry::fields().starred().eq(true)),

                Selection::Source(source_id) => {
                    Entry::filter(Entry::fields().source_id().eq(source_id))
                }

                Selection::List(list_id) => {
                    let ids: Vec<u64> = ListEntry::filter_by_list_id(list_id)
                        .exec(&mut *conn)
                        .await?
                        .into_iter()
                        .map(|row| row.entry_id)
                        .collect();

                    // An empty `IN ()` is not valid SQL, and asking for it is
                    // the normal case for a list the user has just made.
                    if ids.is_empty() {
                        return Ok(Vec::new());
                    }
                    Entry::filter(Entry::fields().id().in_list(ids))
                }
            };

            query
                .order_by((
                    Entry::fields().published_at().desc(),
                    Entry::fields().inserted_at().desc(),
                ))
                .limit(limit)
                .exec(&mut *conn)
                .await
        })
    })
}

/// The ids of the sources carrying `view`.
async fn source_ids_with_view(conn: &mut toasty::Db, view: View) -> toasty::Result<Vec<u64>> {
    Ok(Source::all()
        .exec(&mut *conn)
        .await?
        .into_iter()
        .filter(|source| source.view == view as i32)
        .map(|source| source.id)
        .collect())
}

/// One entry, by its row id.
pub fn entry(db: &mut Database, entry_id: u64) -> toasty::Result<Entry> {
    db.run(move |conn| Box::pin(async move { Entry::get_by_id(&mut *conn, &entry_id).await }))
}

/// Entries whose title or summary contains `query`, newest first.
///
/// A plain substring match rather than a search index: the database is a local
/// file holding one person's reading, and the point of search here is to find
/// the thing you remember reading, not to rank a corpus.
pub fn search(db: &mut Database, query: &str, limit: usize) -> toasty::Result<Vec<Entry>> {
    // `%` and `_` are wildcards in `LIKE`, so a query containing them would
    // otherwise match far more than it should — and a user searching for "50%"
    // means the literal text.
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{escaped}%");

    db.run(move |conn| {
        Box::pin(async move {
            Entry::filter(
                Entry::fields()
                    .title()
                    .like_with_escape(pattern.clone(), '\\')
                    .or(Entry::fields().summary().like_with_escape(pattern, '\\')),
            )
            .order_by((
                Entry::fields().published_at().desc(),
                Entry::fields().inserted_at().desc(),
            ))
            .limit(limit)
            .exec(&mut *conn)
            .await
        })
    })
}

/// Switch one source on or off.
///
/// A source is a subscription, so this is the user saying "stop fetching this
/// one" without losing its parameters or its entries — which is what deleting
/// it would do.
pub fn set_source_enabled(db: &mut Database, source_id: u64, enabled: bool) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let mut source = Source::get_by_id(&mut *conn, &source_id).await?;
            toasty::update!(source { enabled }).exec(&mut *conn).await
        })
    })
}

/// Change what a source reads, and what it is called.
///
/// The plugin is not re-activated: settings belong to the plugin and parameters
/// to the source, and re-running `activate` for a renamed subscription would
/// let a plugin reset state the user did not ask it to reset.
pub fn set_source_params(
    db: &mut Database,
    source_id: u64,
    title: String,
    params: serde_json::Value,
) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            // Read first so a source that is not there is an error rather
            // than a silent no-op — the caller is a dialog, and a dialog that
            // closed on a change that did not happen is a lie.
            let mut source = Source::get_by_id(&mut *conn, &source_id).await?;
            toasty::update!(source { title, params })
                .exec(&mut *conn)
                .await
        })
    })
}

/// Replace a plugin's settings.
///
/// The plugin is told on its next run — `activate` for a lifecycle hook that
/// cares, and every `fetch` in between. Settings are handed to the plugin on
/// every call rather than cached in the runtime, so there is nothing to
/// invalidate.
pub fn set_plugin_settings(
    db: &mut Database,
    plugin_id: u64,
    settings: serde_json::Value,
) -> toasty::Result<()> {
    db.run(move |conn| {
        Box::pin(async move {
            let mut plugin = Plugin::get_by_id(&mut *conn, &plugin_id).await?;
            toasty::update!(plugin { settings }).exec(&mut *conn).await
        })
    })
}
