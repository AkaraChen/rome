//! The page a plugin draws for an entry, against a real database.
//!
//! Three properties, all of them properties of the schema and the writes rather
//! than of any function: the parameters a listing attached survive ingest
//! untouched, what the plugin drew is stored against the entry with the moment
//! it drew it, and a refresh — which rewrites `content` from the listing —
//! cannot take either away. A database is what it takes to see them.

use std::path::PathBuf;

use rome::db::Database;
use rome::models::View;
use rome::store::{self, NewEntry, NewSource};
use toasty::migration::MigrationSet;

/// The same set the application embeds. Read from `toasty/` at compile time, so
/// a test can never run against a schema the app does not have.
static MIGRATIONS: MigrationSet = toasty::embed_migrations!();

/// A database of its own, in a directory of its own.
struct Scratch {
    dir: PathBuf,
    db: Database,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("rome-preview-{}-{name}", std::process::id()));

        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("could not make a scratch directory");

        let db = Database::open(dir.join("rome.db")).expect("could not open the scratch database");
        db.migrate(&MIGRATIONS).expect("migrations failed");

        Self { dir, db }
    }

    /// A source to hang entries off. Nothing here needs a plugin row: Toasty's
    /// `belongs_to` is a relation in the ORM rather than a foreign key in the
    /// schema, so the id is a number like any other.
    fn source(&mut self) -> u64 {
        store::create_source(
            &mut self.db,
            NewSource {
                plugin_id: 1,
                title: "Hacker News".to_owned(),
                params: serde_json::json!({}),
                view: View::Articles,
                category: None,
                refresh_interval_secs: 3600,
            },
        )
        .expect("could not make a source")
        .id
    }

    /// One entry, ingested the way a plugin's output arrives.
    fn entry(&mut self, source_id: u64) -> u64 {
        store::ingest(
            &mut self.db,
            source_id,
            &[NewEntry {
                external_id: "hn:1".to_owned(),
                title: "A story".to_owned(),
                url: Some("https://example.com/a-story".to_owned()),
                summary: Some("312 分 · 84 条评论".to_owned()),
                ..NewEntry::default()
            }],
        )
        .expect("could not ingest");

        store::timeline(&mut self.db, None, 10)
            .expect("could not read the timeline back")
            .into_iter()
            .next()
            .expect("the entry was ingested")
            .id
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn the_params_a_plugin_attached_are_kept_for_the_preview() {
    let mut scratch = Scratch::new("params");
    let source = scratch.source();

    store::ingest(
        &mut scratch.db,
        source,
        &[NewEntry {
            external_id: "bilibili:BV1xx".to_owned(),
            title: "A video".to_owned(),
            url: Some("https://www.bilibili.com/video/BV1xx".to_owned()),
            params: Some(serde_json::json!({ "bvid": "BV1xx" })),
            ..NewEntry::default()
        }],
    )
    .expect("could not ingest");

    let stored = store::timeline(&mut scratch.db, None, 10)
        .expect("could not read the timeline back")
        .into_iter()
        .next()
        .expect("the entry was ingested");

    // Opaque: the store's job is to hand the same object back, not to have an
    // opinion about what is in it.
    assert_eq!(
        stored.params,
        Some(serde_json::json!({ "bvid": "BV1xx" })),
        "the values the plugin attached did not survive ingest"
    );
}

#[test]
fn what_the_plugin_drew_is_stored_with_when_it_drew_it() {
    let mut scratch = Scratch::new("stores");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_preview(
        &mut scratch.db,
        entry,
        Some("<ul><li>播放：1 万</li></ul>".to_owned()),
        1_700_000_000,
    )
    .expect("could not store the preview");

    let stored = store::entry(&mut scratch.db, entry).expect("could not read the entry");

    assert_eq!(
        stored.preview.as_deref(),
        Some("<ul><li>播放：1 万</li></ul>")
    );
    assert_eq!(stored.preview_at, Some(1_700_000_000));
}

#[test]
fn a_preview_hook_that_drew_nothing_is_still_recorded_as_asked() {
    let mut scratch = Scratch::new("empty");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_preview(&mut scratch.db, entry, None, 1_700_000_000)
        .expect("could not record the attempt");

    let stored = store::entry(&mut scratch.db, entry).expect("could not read the entry");

    // A hook that returns `null` has answered. Asking it again on every open
    // would be the host mistaking "nothing to show" for "did not run".
    assert_eq!(stored.preview, None);
    assert_eq!(stored.preview_at, Some(1_700_000_000));
}

#[test]
fn a_refresh_does_not_take_the_preview_with_it() {
    let mut scratch = Scratch::new("refresh");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_preview(
        &mut scratch.db,
        entry,
        Some("<p>The video.</p>".to_owned()),
        1_700_000_000,
    )
    .expect("could not store the preview");

    // The listing the plugin returns on every refresh. `content` is rewritten
    // from it, which is exactly why the preview has a column of its own.
    store::ingest(
        &mut scratch.db,
        source,
        &[NewEntry {
            external_id: "hn:1".to_owned(),
            title: "A story".to_owned(),
            url: Some("https://example.com/a-story".to_owned()),
            summary: Some("312 分 · 84 条评论".to_owned()),
            ..NewEntry::default()
        }],
    )
    .expect("could not ingest");

    let stored = store::entry(&mut scratch.db, entry).expect("could not read the entry");

    assert_eq!(stored.preview.as_deref(), Some("<p>The video.</p>"));
    assert_eq!(stored.preview_at, Some(1_700_000_000));
}
