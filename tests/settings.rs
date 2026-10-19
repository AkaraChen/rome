//! Application preferences, against a real database.
//!
//! Every other test in this directory is pure — it hands a function some values
//! and checks what comes back — and for the ordering rules in
//! `view_order::tests` that is the right level. What it cannot check is whether
//! a preference is still there after the app is closed, which is the only
//! property the user can actually observe: they drag a row, quit, and open the
//! app again. That takes a database, so this file makes one.
//!
//! The database is a real file in a temporary directory rather than an
//! in-memory one, because an in-memory database cannot be reopened and the
//! reopening is the whole point.

use std::path::PathBuf;

use rome::db::Database;
use rome::models::View;
use rome::store;
use rome::view_order;
use serde_json::json;
use toasty::migration::MigrationSet;

/// The same set the application embeds. Read from `toasty/` at compile time, so
/// a test can never run against a schema the app does not have.
static MIGRATIONS: MigrationSet = toasty::embed_migrations!();

/// A database of its own, in a directory of its own.
///
/// `name` distinguishes the tests from each other; the process id distinguishes
/// concurrent runs of the suite. The directory is cleared before use and
/// removed after, so a run that panicked last time does not leave a half-written
/// database behind for this one to trip over.
struct Scratch {
    dir: PathBuf,
    db: Database,
}

impl Scratch {
    fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("rome-test-{}-{name}", std::process::id()));

        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("could not make a scratch directory");

        let db = Self::open_at(&dir);

        Self { dir, db }
    }

    /// Open the database in `dir`, applying every migration.
    ///
    /// Separate from [`Scratch::new`] so a test can close and reopen the same
    /// file — which is what proves a preference was written down rather than
    /// merely held somewhere in the process.
    fn open_at(dir: &std::path::Path) -> Database {
        let db = Database::open(dir.join("rome.db")).expect("could not open the scratch database");

        db.migrate(&MIGRATIONS).expect("migrations failed");

        db
    }

    /// Close this handle and open the file again, as a restart would.
    ///
    /// A second connection rather than a re-read through the first: what the
    /// test has to rule out is a value that only ever lived in this process's
    /// memory, and a new connection cannot see one of those.
    fn reopen(&mut self) {
        self.db = Self::open_at(&self.dir);
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn a_preference_that_was_never_set_is_absent() {
    let mut scratch = Scratch::new("absent");

    // `None` rather than an error or a default: a fresh database has no
    // preferences in it, and every caller has to read that as "use the
    // built-in order".
    let stored = store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed");

    assert_eq!(stored, None);
    assert_eq!(view_order::resolve(stored.as_ref()), View::ALL.to_vec());
}

#[test]
fn a_preference_comes_back_as_it_was_written() {
    let mut scratch = Scratch::new("round-trip");

    let value = json!(["pictures", "articles"]);

    store::setting_set(&mut scratch.db, view_order::KEY, value.clone()).expect("write failed");

    assert_eq!(
        store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed"),
        Some(value)
    );
}

#[test]
fn writing_a_preference_twice_replaces_it() {
    let mut scratch = Scratch::new("replace");

    store::setting_set(&mut scratch.db, view_order::KEY, json!(["pictures"]))
        .expect("write failed");
    store::setting_set(&mut scratch.db, view_order::KEY, json!(["videos"])).expect("write failed");

    // One row, not two: the key is unique, and a second write is an update
    // rather than an insert that would then be ambiguous to read back.
    assert_eq!(
        store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed"),
        Some(json!(["videos"]))
    );
}

#[test]
fn preferences_are_kept_apart_by_key() {
    let mut scratch = Scratch::new("keys");

    store::setting_set(&mut scratch.db, view_order::KEY, json!(["pictures"]))
        .expect("write failed");
    store::setting_set(&mut scratch.db, "something_else", json!(7)).expect("write failed");

    assert_eq!(
        store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed"),
        Some(json!(["pictures"]))
    );
    assert_eq!(
        store::setting_get(&mut scratch.db, "something_else").expect("read failed"),
        Some(json!(7))
    );
}

#[test]
fn a_reordered_sidebar_is_still_reordered_after_a_restart() {
    // The whole feature, in the order the user does it: open, move a row up,
    // quit, open again.
    let mut scratch = Scratch::new("restart");

    // Open. Nothing stored, so the rows are in the enum's own order.
    let stored = store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed");
    let before = view_order::resolve(stored.as_ref());

    assert_eq!(before, View::ALL.to_vec());

    // Move Pictures up one — exactly what `Command::MoveView` does, minus the
    // command plumbing, which needs a worker thread and a window.
    let after = view_order::moved(&before, View::Pictures, -1);

    store::setting_set(&mut scratch.db, view_order::KEY, view_order::encode(&after))
        .expect("write failed");

    // Quit and open again.
    scratch.reopen();

    let stored = store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed");

    assert_eq!(view_order::resolve(stored.as_ref()), after);
    assert_eq!(
        after.iter().map(|view| view.name()).collect::<Vec<_>>(),
        ["articles", "pictures", "social", "videos", "audios"]
    );
}

#[test]
fn a_restart_still_draws_every_row_when_the_stored_order_is_stale() {
    // The upgrade path: a preference written by a release that knew fewer views
    // is read by one that knows more. Every row has to be there — a missing
    // view is a part of the library the user cannot reach — and the ones they
    // chose the order of must not move.
    let mut scratch = Scratch::new("stale");

    store::setting_set(&mut scratch.db, view_order::KEY, json!(["pictures"]))
        .expect("write failed");

    scratch.reopen();

    let stored = store::setting_get(&mut scratch.db, view_order::KEY).expect("read failed");
    let order = view_order::resolve(stored.as_ref());

    assert_eq!(order.len(), View::ALL.len());
    assert_eq!(order[0], View::Pictures);
}
