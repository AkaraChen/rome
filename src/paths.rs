//! Where the application keeps its files on disk.
//!
//! Paths follow each platform's convention rather than the working directory,
//! so the database lives somewhere writable and predictable regardless of where
//! the app was launched from:
//!
//! - macOS: `~/Library/Application Support/com.AkaraChen.rome`
//! - Linux: `~/.local/share/rome` (or `$XDG_DATA_HOME/rome`)
//! - Windows: `%LOCALAPPDATA%\AkaraChen\rome\data`

use std::io;
use std::path::{Path, PathBuf};

use directories::ProjectDirs;

/// File name of the SQLite database inside the data directory.
const DATABASE_FILE: &str = "rome.db";

/// Environment variable that overrides the data directory.
///
/// Point it at a scratch directory to run against a throwaway database without
/// touching the real one, e.g. `ROME_DATA_DIR=/tmp/rome-dev cargo run`.
pub const DATA_DIR_ENV: &str = "ROME_DATA_DIR";

/// The directory the application keeps its data in, per platform convention.
pub fn data_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os(DATA_DIR_ENV) {
        return PathBuf::from(dir);
    }

    // `data_local_dir` rather than `data_dir`: on Windows the latter is the
    // roaming AppData, which a domain profile syncs between machines. Syncing a
    // live SQLite file underneath its user is a good way to corrupt it.
    project_dirs().data_local_dir().to_path_buf()
}

/// The path of the SQLite database, creating the data directory if needed.
///
/// Both the application and the `migrate` binary go through here so they cannot
/// disagree about which database they are talking to.
pub fn database_path() -> io::Result<PathBuf> {
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(DATABASE_FILE))
}

/// Directory inside the data directory that holds materialised plugin code.
const PLUGIN_DIR: &str = "plugins";

/// The file a plugin's JavaScript is written to before the runtime loads it.
///
/// The database is the source of truth for a plugin's code, but `tjs` loads a
/// plugin from a path, so the code has to exist as a file for the duration of a
/// run. Materialising it rather than keeping it in a temporary directory means
/// the exact code that ran is still there to read when a plugin misbehaves —
/// which is the first thing anyone looks at.
///
/// It goes *beside the database* rather than in the platform data directory, so
/// that a run pointed at a scratch database writes everything it derives into
/// that same scratch place. `plugin_id` is unique per plugin, and a plugin
/// refreshed twice at once writes identical bytes to the same file, so there is
/// nothing to collide over.
pub fn plugin_code_path(database: &Path, plugin_id: u64) -> io::Result<PathBuf> {
    let dir = database.parent().unwrap_or(Path::new(".")).join(PLUGIN_DIR);
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(format!("{plugin_id}.js")))
}

/// Directory inside the data directory that holds the example plugins.
const BUNDLED_DIR: &str = "examples";

/// Where one of the built-in example plugins is written, and the file created
/// with it.
///
/// An example has no file of its own — it is compiled into the binary — but
/// everything downstream of the install dialog works in paths, and rightly so:
/// describing a plugin means running it, and the runtime loads a plugin from a
/// file. Writing the example out is what lets it take the same road a plugin
/// from disk takes, rather than a second road that would then have to be kept
/// in step with the first.
///
/// Beside the database rather than in the temporary directory, so a run pointed
/// at a scratch database keeps everything it derives in that scratch place —
/// and so the path the install dialog shows is one the reader can open
/// afterwards to read the plugin they just installed.
///
/// Written on every call. It is the app's own copy of a file the app shipped,
/// so there is nothing a user could have edited here that is worth keeping, and
/// a copy that was left alone would be an example that no longer matches the
/// source it was built from.
pub fn write_bundled_plugin(slug: &str, code: &str) -> io::Result<PathBuf> {
    let dir = data_dir().join(BUNDLED_DIR);
    std::fs::create_dir_all(&dir)?;

    let path = dir.join(format!("{slug}.js"));
    std::fs::write(&path, code)?;

    Ok(path)
}

/// Where a plugin's code is staged while it is being described, before it has a
/// row and therefore an id.
///
/// In the system temporary directory, because at this point the code has no
/// home: the install may yet be abandoned, and writing into the application's
/// own directory would leave a file behind for a plugin that was never
/// installed.
///
/// Unique per call, and the caller removes it when it is done — a single shared
/// path would be a race, with two installs overwriting each other's code. A
/// clock is not enough to make it unique, because two calls can read the same
/// tick.
pub fn staging_plugin_code_path() -> PathBuf {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let serial = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    std::env::temp_dir().join(format!("rome-staging-{}-{serial}.js", std::process::id()))
}

fn project_dirs() -> ProjectDirs {
    ProjectDirs::from("com", "AkaraChen", "rome")
        .expect("no home directory; cannot locate the application data directory")
}
