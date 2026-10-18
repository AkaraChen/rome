//! Rome — a local reader.
//!
//! This module is only the entry point: it opens the database, starts the
//! worker, and hands the window an application. The window itself is
//! [`rome::ui::app::RomeApp`], which lives in the library so it can be rendered
//! without launching anything — see `tests/render.rs`.
//!
//! The window is a pure function of the last [`Snapshot`] the worker published.
//! Nothing here reads the database: a `store::` call blocks its thread until the
//! statement finishes, and a plugin run blocks for as long as thirty seconds, so
//! both happen on the worker thread and the window only draws what it was
//! handed. See `rome::worker`.

use gpui_kit::assets::Assets;
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorAssets;

use rome::image_client;
use rome::paths;
use rome::ui::app::RomeApp;
use rome::worker::{Command, Worker};

/// Every migration under `toasty/`, embedded so a launch applies the ones the
/// database has not seen. Already-applied migrations are skipped.
///
/// Kept in this binary rather than the library so the `migrate` binary still
/// compiles against a checkout whose `toasty/` directory has not been generated
/// yet — the directory that binary exists to create.
static MIGRATIONS: toasty::migration::MigrationSet = toasty::embed_migrations!();

fn main() {
    let path = paths::database_path().expect("could not locate the application data directory");
    println!("database: {}", path.display());

    let worker = Worker::start(path, &MIGRATIONS);

    // Built before the window because there is nothing to do with a failure
    // here: a reader looking at a page of entries with no pictures in them
    // cannot tell a client that never started from a feed that has no pictures.
    let images = image_client::Images::new().expect("failed to build the image client");

    // Phosphor first, then GPUI Kit's own component icons.
    gpui_kit::application()
        .with_assets(PhosphorAssets.with(Assets))
        .with_http_client(std::sync::Arc::new(images))
        .run(move |cx| {
            gpui_kit::init(cx);
            rome::theme::init(cx);

            let worker = worker;

            gpui_kit::open_window(WindowOptions::default(), cx, move |window, cx| {
                let app = cx.new(|_| RomeApp::new(worker.clone()));

                // The pump. It only ever awaits, so it belongs on the
                // foreground task: the blocking half — the database, the plugin
                // processes — is on the worker thread, and this side does
                // nothing but turn an event into a redraw.
                //
                // Detached rather than stored: the loop ends when the worker
                // drops its sender, which happens when the worker thread stops,
                // which happens when this process exits. A handle stored in the
                // entity would only add a field that exists to keep a task
                // alive that already outlives everything it touches.
                let events = worker.events();
                let weak = app.downgrade();
                let pump = window.spawn(cx, async move |cx| {
                    while let Ok(event) = events.recv_async().await {
                        let alive = cx
                            .update(|window, cx| match weak.upgrade() {
                                Some(app) => {
                                    app.update(cx, |app, cx| app.apply(event, window, cx));
                                    true
                                }
                                None => false,
                            })
                            .unwrap_or(false);

                        if !alive {
                            break;
                        }
                    }
                });
                pump.detach();

                // The first paint. A window that opens empty and fills a moment
                // later looks broken, and the worker has already opened the
                // database by the time this lands.
                worker.send(Command::Reload);

                app
            })
            .expect("failed to open window");
        });
}
