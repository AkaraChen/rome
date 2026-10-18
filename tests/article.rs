//! What the host read off a page, against a real database.
//!
//! The extraction itself is `content`'s and is tested there; what these cover
//! is the other half of the feature — that the text lands in a column of its
//! own, that a refresh cannot wipe it, and that a page with nothing in it is
//! still recorded as read. All three are properties of the schema and the
//! writes rather than of any function, so a database is what it takes.

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
        let dir = std::env::temp_dir().join(format!("rome-article-{}-{name}", std::process::id()));

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
fn what_the_host_read_is_stored_with_when_it_read_it() {
    let mut scratch = Scratch::new("stores");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_article(
        &mut scratch.db,
        entry,
        Some("<p>The article.</p>".to_owned()),
        1_700_000_000,
    )
    .expect("could not store the article");

    let stored = store::entry(&mut scratch.db, entry).expect("could not read the entry");

    assert_eq!(stored.article.as_deref(), Some("<p>The article.</p>"));
    assert_eq!(stored.article_at, Some(1_700_000_000));
}

#[test]
fn a_page_with_nothing_in_it_is_still_recorded_as_read() {
    let mut scratch = Scratch::new("empty");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_article(&mut scratch.db, entry, None, 1_700_000_000)
        .expect("could not record the attempt");

    let stored = store::entry(&mut scratch.db, entry).expect("could not read the entry");

    // Both halves matter. The timestamp is what stops the page being fetched
    // again on every open, and the text has to be absent rather than a leftover
    // from a previous attempt — which is only true if writing `None` reaches
    // the column.
    assert_eq!(stored.article, None);
    assert_eq!(stored.article_at, Some(1_700_000_000));
}

#[test]
fn a_refresh_does_not_take_the_article_with_it() {
    let mut scratch = Scratch::new("refresh");
    let source = scratch.source();
    let entry = scratch.entry(source);

    store::set_article(
        &mut scratch.db,
        entry,
        Some("<p>The article.</p>".to_owned()),
        1_700_000_000,
    )
    .expect("could not store the article");

    // The same window the plugin returns on every refresh: a title and an
    // address, and nothing behind either of them. This is what an aggregator
    // always sends, and the reason the article is not stored in `content` —
    // which this call rewrites.
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

    assert_eq!(stored.article.as_deref(), Some("<p>The article.</p>"));
    assert_eq!(stored.article_at, Some(1_700_000_000));
    assert_eq!(stored.content, None);
}
