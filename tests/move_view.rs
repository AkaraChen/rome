//! Moving a view row, through the worker — the path the sidebar actually takes.
//!
//! `view_order`'s own tests cover the arithmetic and `settings.rs` covers
//! whether a preference survives a restart. What is left is the middle: that
//! `Command::MoveView` reads the current order, writes a new one, and publishes
//! a snapshot the window can draw from. That needs the real worker on its own
//! thread, so this file starts one.
//!
//! It is the only test here that runs a thread, which is why it is a file of its
//! own rather than a case in `settings.rs`.

use std::path::PathBuf;
use std::time::Duration;

use rome::models::View;
use rome::snapshot::Snapshot;
use rome::worker::{Command, Event, Worker};
use toasty::migration::MigrationSet;

static MIGRATIONS: MigrationSet = toasty::embed_migrations!();

/// How long to wait for the worker before calling it stuck.
///
/// Generous: the first snapshot waits on the database being opened and every
/// migration being applied. A failure here should mean the worker is wedged, not
/// that a busy machine was given too little time.
const PATIENCE: Duration = Duration::from_secs(20);

/// A directory of its own, named so concurrent runs of the suite do not collide.
fn scratch_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("rome-test-{}-{name}", std::process::id()));

    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("could not make a scratch directory");

    dir
}

/// The next snapshot the worker publishes.
///
/// Loops rather than taking the next event: a snapshot is not the only thing
/// that can arrive, and a test that assumed otherwise would fail on an
/// unrelated event rather than on the thing it is checking.
fn next_snapshot(worker: &Worker) -> Snapshot {
    let events = worker.events();

    loop {
        match events.recv_timeout(PATIENCE) {
            Ok(Event::Snapshot(snapshot)) => return *snapshot,
            Ok(_) => continue,
            Err(error) => panic!("the worker published nothing: {error}"),
        }
    }
}

/// The order of the view rows, as names.
fn tabs(snapshot: &Snapshot) -> Vec<&'static str> {
    snapshot.tabs.iter().map(|tab| tab.view.name()).collect()
}

#[test]
fn moving_a_view_up_reorders_the_next_snapshot() {
    let dir = scratch_dir("move-up");
    let worker = Worker::start(dir.join("rome.db"), &MIGRATIONS);

    // The worker publishes once on startup, before it reads a command.
    let opening = next_snapshot(&worker);

    assert_eq!(
        tabs(&opening),
        ["articles", "social", "pictures", "videos", "audios", "notifications"]
    );

    worker.send(Command::MoveView {
        view: View::Pictures,
        delta: -1,
    });

    let moved = next_snapshot(&worker);

    assert_eq!(
        tabs(&moved),
        ["articles", "pictures", "social", "videos", "audios", "notifications"]
    );

    // Nothing was added or lost: a reorder is a permutation, and a row that
    // vanished would be a part of the library the user could not reach.
    assert_eq!(moved.tabs.len(), opening.tabs.len());
}

#[test]
fn moving_the_first_view_up_leaves_the_order_alone() {
    let dir = scratch_dir("move-off-the-end");
    let worker = Worker::start(dir.join("rome.db"), &MIGRATIONS);

    let opening = next_snapshot(&worker);

    worker.send(Command::MoveView {
        view: View::Articles,
        delta: -1,
    });

    let after = next_snapshot(&worker);

    // Not an error, and not a wrap to the bottom: the row stays put and the
    // snapshot comes back saying so.
    assert_eq!(tabs(&after), tabs(&opening));
    assert_eq!(after.error, None);
}

#[test]
fn a_move_survives_the_worker_restarting() {
    // The same guarantee `settings.rs` checks, but reached through the command
    // rather than by writing the preference directly — which is what makes it
    // worth doing twice: this is the only test that proves the *command* writes
    // to the database rather than only to the snapshot it publishes.
    let dir = scratch_dir("move-restart");

    {
        let worker = Worker::start(dir.join("rome.db"), &MIGRATIONS);

        let _ = next_snapshot(&worker);

        worker.send(Command::MoveView {
            view: View::Notifications,
            delta: -1,
        });

        let moved = next_snapshot(&worker);

        assert_eq!(moved.tabs[4].view, View::Notifications);

        // Dropping the handle closes the command channel, which is how the
        // worker is told to stop.
    }

    let worker = Worker::start(dir.join("rome.db"), &MIGRATIONS);
    let reopened = next_snapshot(&worker);

    assert_eq!(reopened.tabs[4].view, View::Notifications);
    assert_eq!(
        tabs(&reopened),
        ["articles", "social", "pictures", "videos", "notifications", "audios"]
    );
}
