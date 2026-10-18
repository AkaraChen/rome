//! Database layer: the Toasty handle, plus the bridge between GPUI's executor
//! and the tokio runtime Toasty requires.

use std::path::Path;

use toasty::Db;
use toasty::migration::MigrationSet;

/// The boxed future [`Database::run`] accepts.
pub type BoxFuture<'a, T> = std::pin::Pin<Box<dyn std::future::Future<Output = T> + 'a>>;

/// The `sqlite:` URL for a filesystem path.
pub fn sqlite_url(path: impl AsRef<Path>) -> String {
    format!("sqlite:{}", path.as_ref().display())
}

/// Connect to `url`, registering every model in this crate.
///
/// Shared with the `migrate` binary so both see the same set of models.
pub async fn connect(url: &str) -> toasty::Result<Db> {
    Db::builder()
        .models(toasty::models!(crate::*))
        .connect(url)
        .await
}

/// Owns the Toasty handle and the tokio runtime that drives it.
///
/// GPUI runs its own executor and cannot poll tokio futures, so the runtime
/// lives here and every statement is driven to completion with `block_on`.
/// That blocks the calling thread for the duration of the statement.
pub struct Database {
    runtime: tokio::runtime::Runtime,
    db: Db,
    path: std::path::PathBuf,
}

impl Database {
    /// Open, creating if absent, the SQLite database at `path`.
    ///
    /// Does not touch the schema; call [`Database::migrate`] for that. The
    /// migrations are passed in rather than embedded here so that the `migrate`
    /// binary can compile against a checkout that has no `toasty/` directory
    /// yet — the directory it exists to generate.
    pub fn open(path: impl AsRef<Path>) -> toasty::Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("failed to build tokio runtime");

        let db = runtime.block_on(connect(&sqlite_url(path.as_ref())))?;

        Ok(Self {
            runtime,
            db,
            path: path.as_ref().to_path_buf(),
        })
    }

    /// The file this database lives in.
    ///
    /// Exposed because things derived from the database are kept beside it —
    /// see [`crate::paths::plugin_code_path`] — so that pointing a run at a
    /// scratch database isolates everything it writes, not just its rows.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Apply every migration the database has not seen yet.
    ///
    /// Safe to call on every launch: already-applied migrations are skipped via
    /// the `__toasty_migrations` table.
    ///
    /// Note: Toasty's `Db::push_schema` is deliberately unused. It issues the
    /// full `CREATE TABLE` set on every call without checking what exists, so a
    /// second call against the same database fails with `table already exists`.
    /// It is only suitable for a throwaway in-memory database in a test.
    ///
    /// Review every generated migration before applying it. Toasty does not emit
    /// a SQL `DEFAULT` for a `#[default(expr)]` field — that attribute is an
    /// insert-time value in the ORM, not a column constraint. So adding a
    /// non-optional field to an existing model generates
    /// `ALTER TABLE ... ADD COLUMN ... NOT NULL` with no default, which SQLite
    /// rejects with `Cannot add a NOT NULL column with default value NULL` as
    /// soon as the table has a single row. It passes on an empty development
    /// database and fails on real user data. Either hand-edit the generated file
    /// to add `DEFAULT <value>`, or make the field `Option<T>`.
    pub fn migrate(
        &self,
        migrations: &MigrationSet,
    ) -> toasty::Result<toasty::migration::MigrationReport> {
        self.runtime.block_on(migrations.apply(&self.db))
    }

    /// Drive one database operation to completion and return its result.
    ///
    /// Every Toasty statement takes exclusive access to the connection, so the
    /// closure is handed the handle instead of a borrow of `self` — the
    /// runtime and the connection are borrowed as separate fields. Callers
    /// write an ordinary `async` block and never see either.
    pub fn run<T>(&mut self, f: impl for<'a> FnOnce(&'a mut Db) -> BoxFuture<'a, T>) -> T {
        let Self { runtime, db, .. } = self;
        runtime.block_on(f(db))
    }
}
