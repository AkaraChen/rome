//! Migration CLI for `rome`.
//!
//! `toasty-cli` ships as a library rather than a binary, so this is the thin
//! wrapper that gives it a database handle. Run it with:
//!
//! ```sh
//! cargo run --bin migrate -- migration generate --name describe_change
//! cargo run --bin migrate -- migration apply
//! ```
//!
//! It operates on the real application database. Set `ROME_DATA_DIR` to point
//! it somewhere else.

use toasty_cli::ToastyCli;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let path = rome::paths::database_path()?;
    println!("database: {}", path.display());

    let db = rome::db::connect(&rome::db::sqlite_url(&path)).await?;
    ToastyCli::new(db).parse_and_run().await
}
