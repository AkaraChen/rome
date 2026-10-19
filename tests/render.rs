//! Draw the window and write it out as a PNG.
//!
//! Every other test in this directory checks a decision. This one checks what
//! the decisions add up to, which is the only thing the reader ever sees — and
//! it is the one thing that cannot be checked by reading the code. A column
//! that is four pixels off, a label that wraps, a muted grey that is too light
//! to read: all of those pass every other test in this tree.
//!
//! It renders through GPUI's headless Metal renderer, which needs no visible
//! window and no AppKit window server. The frames land in `$ROME_SHOT_DIR`
//! (default `/tmp/rome-shots`) and are meant to be looked at, not asserted on:
//! there is no reference image to diff against, because the point is a person
//! seeing the window, and a golden file would only be re-blessed every time the
//! design changed on purpose.
//!
//! Run it with:
//!
//! ```sh
//! ROME_SHOT_DIR=/tmp/rome-shots cargo test --test render
//! ```
//!
//! This is a `main` rather than a set of `#[test]`s, and the target is declared
//! `harness = false` in `Cargo.toml`, because on macOS the platform cannot be
//! built off the main thread — `MacPlatform::new` holds a `MainThreadMarker`,
//! and a missing one is a panic, not a degraded mode. The test harness runs
//! every test on a worker thread, so a `#[test]` here would fail on the first
//! line. GPUI Kit builds its own render test the same way.
//!
//! On a platform with no headless renderer it says so and writes nothing —
//! `current_headless_renderer` returns `None` off macOS and Linux.

use std::path::PathBuf;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gpui_kit::assets::Assets;
use gpui_kit::component::Theme;
use gpui_kit::component::theme::ThemeMode;
use gpui_kit_phosphor::PhosphorAssets;
use serde_json::json;

// Named one at a time, and deliberately not `use gpui_kit::*`.
//
// GPUI exports an attribute macro called `test` — `#[gpui::test]` on an async
// function — and a glob import puts it in scope for the whole file, where it
// takes precedence over the built-in `#[test]`. Adding a `#[test]` under one is
// then not a type error but a stack overflow inside `rustc`: the macro expands
// to another `#[test]`, which resolves back to itself, and the recursion runs
// until the parser dies. The error names `syn::parse_stmt` and a SIGBUS, which
// says nothing about the glob import three lines up.
use gpui_kit::{
    AppContext as _, Bounds, HeadlessAppContext, WindowBounds, WindowOptions, px, size,
};

use rome::models::View;
use rome::plugin::DialogRequest;
use rome::plugin::session::Manifest;
use rome::snapshot::{
    Body, EntryDetail, EntryRow, ListRow, PluginRow, Selection, Snapshot, SourceRow, Tab,
};
use rome::ui::add_source;
use rome::ui::app::{Mode, RomeApp};
use rome::ui::dialog;
use rome::ui::wizard::Tab as AddSourceTab;
use rome::view_order;
use rome::worker::{Ask, Worker};
use toasty::migration::MigrationSet;

static MIGRATIONS: MigrationSet = toasty::embed_migrations!();

/// A size to draw at, in logical pixels.
type Frame = (f32, f32);

/// A laptop window. The one the layout was designed against.
const LAPTOP: Frame = (1440.0, 900.0);
/// A large display. Nothing here is wider than the content wants, so this is
/// where a column that is not capped, or a toolbar pinned to the window edge
/// while the text is centred, stops coincidentally lining up.
const LARGE: Frame = (1920.0, 1200.0);
/// A small window. Layouts break at the small end long before they break at the
/// large one, and nobody resizes a window down to find out.
const SMALL: Frame = (1100.0, 720.0);
/// Narrower again, which is where the market's grid has to drop a column and
/// stop being a row of cards that cannot fit.
const COMPACT: Frame = (900.0, 720.0);

/// Where the PNGs go.
fn shot_dir() -> PathBuf {
    let dir = std::env::var("ROME_SHOT_DIR").unwrap_or_else(|_| "/tmp/rome-shots".to_owned());
    let dir = PathBuf::from(dir);

    std::fs::create_dir_all(&dir).expect("could not make the screenshot directory");

    dir
}

/// A worker on a throwaway database.
///
/// The window needs one because every row it draws carries a callback that
/// would send a command; nothing here clicks, so it is never used. A scratch
/// directory rather than the real one so that running the render tests cannot
/// touch a database anybody cares about.
fn worker(name: &str) -> Worker {
    let dir = std::env::temp_dir().join(format!("rome-render-{}-{name}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("could not make a scratch directory");

    Worker::start(dir.join("rome.db"), &MIGRATIONS)
}

/// A snapshot with enough in it to see the layout.
///
/// Deliberately awkward rather than tidy: a title long enough to wrap, one
/// entry with no image, one source carrying an error, an unread count on every
/// row. An empty window renders beautifully and says nothing.
fn fixture() -> Snapshot {
    let mut entries = vec![
        entry(
            1,
            "用 Rust 重写一个阅读器：为什么我放弃了 Electron",
            "少数派",
            "从内存占用、启动时间到打包体积，把三年的 Electron 实践换成一个原生窗口之后，我得到了什么，又失去了什么。",
            Some("https://picsum.photos/seed/rome1/1200/600"),
            false,
            true,
            Some("https://sspai.com/post/1"),
        ),
        entry(
            2,
            "Announcing Rust 1.94",
            "Rust Blog",
            "This release includes stabilised async closures, a faster incremental compiler, and a long list of library changes.",
            Some("https://picsum.photos/seed/rome2/1200/600"),
            false,
            false,
            Some("https://blog.rust-lang.org/2026/"),
        ),
        entry(
            3,
            "GPUI 的布局系统到底怎么回事",
            "知乎",
            "从 taffy 到 flex 的映射，以及为什么 h_flex 和 v_flex 不是镜像关系。",
            None,
            true,
            false,
            Some("https://zhihu.com/question/1"),
        ),
        entry(
            4,
            "Show HN: I built a local-first RSS reader",
            "Hacker News",
            "Comments are worth reading on this one — several people describe the same SQLite-locking problem and how they solved it.",
            None,
            true,
            true,
            Some("https://news.ycombinator.com/item?id=1"),
        ),
        entry(
            5,
            "为什么你的桌面应用启动要三秒",
            "V2EX",
            "冷启动的每一毫秒都可以被解释：动态库加载、字体枚举、GPU 初始化，以及你没意识到自己在做的网络请求。",
            Some("https://picsum.photos/seed/rome3/1200/600"),
            false,
            false,
            Some("https://v2ex.com/t/1"),
        ),
        entry(
            6,
            "SQLite 不是玩具数据库",
            "Lobsters",
            "A long thread on write-ahead logging, why WAL mode matters for a desktop app, and what happens when two processes open the same file.",
            None,
            false,
            false,
            Some("https://lobste.rs/s/1"),
        ),
        // A seventh, so the picture grid has a last row that is not full. A
        // grid only ever exercised on a row count divisible by its column
        // count is a grid whose last row has never been looked at.
        entry(
            7,
            "一份关于字体渲染的笔记",
            "少数派",
            "从 hinting 到 subpixel，为什么同一个网页在两台机器上看起来不一样。",
            Some("https://picsum.photos/seed/rome4/1200/600"),
            false,
            false,
            Some("https://sspai.com/post/2"),
        ),
    ];

    // Two rows carry a mark, so the article list's icon column is in a frame;
    // the rest have none, which is what most feeds produce.
    entries[0].icon = Some("https://sspai.com/favicon.ico".to_owned());
    entries[3].icon = Some("https://news.ycombinator.com/favicon.ico".to_owned());

    Snapshot {
        tabs: vec![
            Tab {
                view: View::Articles,
                unread: 4,
            },
            Tab {
                view: View::SocialMedia,
                unread: 12,
            },
            Tab {
                view: View::Pictures,
                unread: 0,
            },
            Tab {
                view: View::Videos,
                unread: 3,
            },
            Tab {
                view: View::Audios,
                unread: 0,
            },
        ],
        unread: 19,
        starred: 2,
        sources: vec![
            source(1, 1, "少数派", Some("中文"), 2, None),
            source(2, 2, "Rust Blog", Some("英文"), 1, None),
            source(3, 3, "知乎热榜", Some("中文"), 1, None),
            source(4, 4, "Hacker News", Some("英文"), 0, None),
            source(5, 5, "V2EX", Some("中文"), 1, None),
            source(
                6,
                6,
                "Lobsters",
                Some("英文"),
                0,
                Some("上次抓取失败：unexpected token at line 1"),
            ),
        ],
        plugins: vec![
            PluginRow {
                id: 1,
                plugin_id: "rome.hacker-news".to_owned(),
                name: "Hacker News".to_owned(),
                version: "1.0.0".to_owned(),
                description: Some("最小的抓取型：一次请求，一个数组，一次映射".to_owned()),
                icon: Some("https://news.ycombinator.com/favicon.ico".to_owned()),
                enabled: true,
                sources: 1,
                error: None,
                recent_domains: vec!["news.ycombinator.com".to_owned()],
                settings: json!({}),
                settings_schema: json!({ "fields": [] }),
                // The configure step draws whatever the plugin asked
                // for. The real Hacker News plugin takes no parameters, but a
                // fixture with an empty form would never show the controls the
                // step exists to draw.
                params_schema: json!({
                    "fields": [
                        {
                            "key": "query",
                            "label": "关键词",
                            "placeholder": "留空则读取首页",
                            "help": "只保留标题里含有这个词的故事。"
                        },
                        {
                            "key": "sort",
                            "label": "排序",
                            "type": "select",
                            "default": "hot",
                            "options": [
                                { "value": "hot", "label": "热度" },
                                { "value": "new", "label": "最新" }
                            ]
                        }
                    ],
                    "ok": "添加"
                }),
            },
            PluginRow {
                id: 6,
                plugin_id: "rome.lobsters".to_owned(),
                name: "Lobsters".to_owned(),
                version: "1.0.0".to_owned(),
                description: Some("最小的正确形状：一次请求，一个数组，一次映射".to_owned()),
                icon: None,
                enabled: true,
                sources: 1,
                error: Some("unexpected token at line 1".to_owned()),
                recent_domains: vec!["lobste.rs".to_owned()],
                settings: json!({}),
                settings_schema: json!({ "fields": [] }),
                params_schema: json!({ "fields": [] }),
            },
        ],
        lists: vec![
            ListRow {
                id: 1,
                name: "稍后读".to_owned(),
                count: 3,
            },
            ListRow {
                id: 2,
                name: "周末长文".to_owned(),
                count: 1,
            },
        ],
        selection: Selection::All,
        search: None,
        entries,
        open: Some(EntryDetail {
            id: 1,
            title: "用 Rust 重写一个阅读器：为什么我放弃了 Electron".to_owned(),
            url: Some("https://sspai.com/post/1".to_owned()),
            author: Some("李四".to_owned()),
            published_at: Some(now() - 3600 * 5),
            content: Some(LONG_BODY.to_owned()),
            summary: Some("从内存占用到打包体积。".to_owned()),
            preview: Body::Idle,
            image: Some("https://picsum.photos/seed/rome1/1200/600".to_owned()),
            icon: None,
            source_title: "少数派".to_owned(),
            read: true,
            starred: true,
        }),
        busy: false,
        busy_with: None,
        error: None,
    }
}

/// A first launch, as the worker would publish it: all five sidebar rows and
/// nothing else.
///
/// `Snapshot::default()` is not this state — it has no tabs at all, which the
/// worker never sends, and a page drawn over it shows a sidebar missing the
/// rows every real window has. The rows come from `view_order`, so a frame
/// stays honest if a view is ever added.
fn fresh() -> Snapshot {
    Snapshot {
        tabs: view_order::resolve(None)
            .into_iter()
            .map(|view| Tab { view, unread: 0 })
            .collect(),
        unread: 0,
        starred: 0,
        sources: Vec::new(),
        plugins: Vec::new(),
        lists: Vec::new(),
        selection: Selection::All,
        search: None,
        entries: Vec::new(),
        open: None,
        busy: false,
        busy_with: None,
        error: None,
    }
}

/// What a plugin hands the pane: the item's page, drawn from the item's own
/// parameters.
///
/// The opening heading is the title again on purpose. A page nearly always
/// carries one, and the pane draws the title itself, so this is the frame that
/// shows whether it draws the same words twice.
const DRAWN_PAGE: &str = "\
<h1>Show HN: I built a local-first RSS reader</h1>\
<p>I have been running this for about six months and finally feel like it is \
worth showing. It is a native window, a SQLite file, and a handful of small \
plugins that fetch feeds.</p>\
<p>Two things surprised me. The first is how much of a reader is bookkeeping \
rather than fetching: deduplicating a feed window, keeping a cursor, deciding \
what a refresh is allowed to overwrite. The second is that \
<a href=\"https://example.com/notes\">most feeds lie about their dates</a>, so \
the list is ordered by when something was published and falls back to when it \
arrived.</p>\
<p>It is written in Rust and it has no server of its own. Everything is a file \
on your disk, and a plugin is a script you can read.</p>";

/// The reading pane on an entry whose plugin is drawing a page for it.
///
/// Every link aggregator leaves `content` empty — Hacker News knows a story's
/// title and its address and nothing behind it — so this is the state the
/// reading pane is in for most of what a reader actually opens, and it is the
/// one no other frame reaches.
fn open_preview(preview: Body) -> Snapshot {
    let mut snapshot = fixture();

    snapshot.open = Some(EntryDetail {
        id: 4,
        title: "Show HN: I built a local-first RSS reader".to_owned(),
        url: Some("https://example.com/local-first-rss".to_owned()),
        author: Some("someone".to_owned()),
        published_at: Some(now() - 3600 * 2),
        content: None,
        summary: Some("312 分 · 84 条评论".to_owned()),
        preview,
        image: None,
        icon: Some("https://news.ycombinator.com/favicon.ico".to_owned()),
        source_title: "Hacker News".to_owned(),
        read: true,
        starred: false,
    });

    snapshot
}

/// The same entries, arranged for one of the full-width feeds.
///
/// Three things change from the article fixture. The selection names the view,
/// so the window chooses that view's layout; nothing is open, because the
/// default state of every feed is one with nothing selected; and every entry
/// gets a cover and an author, because the fixture deliberately omits both on
/// some rows to exercise the article list's missing-image path and a feed frame
/// full of placeholders would show the fallbacks instead of the layout.
fn feed(view: View) -> Snapshot {
    let mut snapshot = fixture();
    snapshot.selection = Selection::View(view);
    snapshot.open = None;

    // A view selection only ever contains entries from sources filed under it,
    // so the fixture has to file them too. Without this the audio page has
    // episodes but no shows, which is a state the database cannot produce.
    for source in &mut snapshot.sources {
        source.view = view;
    }

    // The shape each view draws its cover in: videos are 16:9, pictures are
    // portrait, show art is square.
    let size = match view {
        View::Videos => "1600/900",
        View::Pictures => "900/1200",
        View::Audios => "900/900",
        _ => "1200/900",
    };

    let authors = [
        "林檎", "dhouston", "someone", "patio11", "Livid", "jcs", "李四",
    ];

    for (index, entry) in snapshot.entries.iter_mut().enumerate() {
        entry.author = Some(authors[index % authors.len()].to_owned());
        entry.image = Some(format!("https://picsum.photos/seed/feed{index}/{size}"));
    }

    snapshot
}

/// The picture view's grid.
fn pictures() -> Snapshot {
    feed(View::Pictures)
}

/// The social view with a post open: the timeline on the left, the post in the
/// reading pane on the right.
///
/// A post is read in place, so this frame is the social view's normal state
/// rather than a detail somebody asked for.
fn social_open() -> Snapshot {
    let mut snapshot = feed(View::SocialMedia);

    snapshot.open = Some(EntryDetail {
        id: 1,
        title: "用 Rust 重写一个阅读器：为什么我放弃了 Electron".to_owned(),
        url: Some("https://sspai.com/post/1".to_owned()),
        author: Some("林檎".to_owned()),
        published_at: Some(now() - 3600 * 5),
        content: Some(LONG_BODY.to_owned()),
        summary: Some("从内存占用到打包体积。".to_owned()),
        preview: Body::Idle,
        image: Some("https://picsum.photos/seed/rome1/1200/600".to_owned()),
        icon: None,
        source_title: "少数派".to_owned(),
        read: true,
        starred: true,
    });

    snapshot
}

/// The picture view with one note open: the image on the left, the caption on
/// the right. The one feed interaction a snapshot can reach, because it is
/// drawn from `open` rather than opened on the window.
fn picture_detail() -> Snapshot {
    let mut snapshot = feed(View::Pictures);

    snapshot.open = Some(EntryDetail {
        id: 1,
        title: "用 Rust 重写一个阅读器：为什么我放弃了 Electron".to_owned(),
        url: Some("https://sspai.com/post/1".to_owned()),
        author: Some("林檎".to_owned()),
        published_at: Some(now() - 3600 * 5),
        content: Some(LONG_BODY.to_owned()),
        summary: Some("从内存占用到打包体积。".to_owned()),
        preview: Body::Idle,
        image: Some("https://picsum.photos/seed/note/900/1200".to_owned()),
        icon: None,
        source_title: "少数派".to_owned(),
        read: true,
        starred: true,
    });

    snapshot
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_secs() as i64
}

#[allow(clippy::too_many_arguments)]
fn entry(
    id: u64,
    title: &str,
    source_title: &str,
    summary: &str,
    image: Option<&str>,
    read: bool,
    starred: bool,
    url: Option<&str>,
) -> EntryRow {
    EntryRow {
        id,
        source_id: id,
        source_title: source_title.to_owned(),
        title: title.to_owned(),
        url: url.map(str::to_owned),
        author: None,
        published_at: Some(now() - 3600 * (id as i64 + 1)),
        summary: Some(summary.to_owned()),
        image: image.map(str::to_owned),
        icon: None,
        read,
        starred,
    }
}

fn source(
    id: u64,
    plugin_id: u64,
    title: &str,
    category: Option<&str>,
    unread: usize,
    error: Option<&str>,
) -> SourceRow {
    SourceRow {
        id,
        plugin_id,
        title: title.to_owned(),
        icon: None,
        view: View::Articles,
        category: category.map(str::to_owned),
        enabled: true,
        params: json!({}),
        unread,
        error: error.map(str::to_owned),
    }
}

/// A described plugin, for the dialog that confirms installing one.
///
/// It is the shape the worker sends back from `Describe`, built by hand
/// because the dialog only draws it.
fn manifest() -> Manifest {
    Manifest {
        plugin_id: "rome.hacker-news".to_owned(),
        name: "Hacker News".to_owned(),
        version: "1.1.0".to_owned(),
        api_version: "1".to_owned(),
        description: Some("Hacker News 首页故事".to_owned()),
        icon: None,
        default_view: View::Articles,
        settings: json!({ "fields": [] }),
        params: json!({ "fields": [] }),
        preview: true,
    }
}

/// Enough prose to fill the reading pane and then some, so the column's
/// measure and its line height are both visible.
const LONG_BODY: &str = "\
换成原生窗口的第一周，我最想确认的不是性能数字，而是那些看不见的东西还在不在：\
滚动是否跟手，输入法是否正常，选中文字时的心情是否和以前一样。\n\n\
答案是大部分都在，少数几个不在，而每一个不在的地方都能被解释。\n\n\
内存是最先有感觉的。以前开着十几个标签页，Activity Monitor 里的数字会稳定地\
爬到一个让人不安的位置；现在它停在同一个数字上，而且那个数字小得让人怀疑是不是\
自己看错了。启动时间同理——从点图标到能输入，中间那段空白的等待没有了。\n\n\
失去的是生态。任何一个人写好的、能嵌进页面的东西，你都得自己重做一遍。\
这是一笔一次性付清、但金额不小的账。";

/// Build a headless application, initialised the way the real one is.
fn context() -> HeadlessAppContext {
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(PhosphorAssets.with(Assets)),
        gpui_kit::platform::current_headless_renderer,
    );

    cx.update(|cx| {
        gpui_kit::init(cx);
        rome::theme::init(cx);
    });

    cx
}

/// Draw `snapshot` and write it to `name.png`.
///
/// Returns `false` when the platform has no headless renderer, which is a skip
/// rather than a failure — there is nothing to look at and nothing broken.
fn shoot(name: &str, frame: Frame, snapshot: Snapshot, look: Look) -> bool {
    let (width, height) = frame;
    let collapsed = look.collapsed;
    let mut cx = context();

    // `open_window` rather than the context's own, because this one wraps the
    // view in the `base::Root` the real window has. A frame drawn without it
    // would be a picture of a window nobody runs.
    let opened = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Default::default(),
                    size: size(px(width), px(height)),
                })),
                focus: false,
                show: false,
                ..Default::default()
            },
            cx,
            |window, cx| {
                let mut app = RomeApp::new(worker(name));
                app.set_snapshot(snapshot);
                app.set_sidebar_collapsed(collapsed);

                // The screens are window state rather than snapshot state, so a
                // frame that needs one has to ask for it here, before the
                // entity exists.
                match look.screen {
                    Screen::Browse => {}
                    Screen::Plugins => app.set_mode(Mode::Plugins),
                    Screen::AddSource => app.open_add_source(AddSourceTab::Installed),
                    Screen::AddSourceMarket => app.open_add_source(AddSourceTab::Market),
                    Screen::AddSourceConfigure(plugin) => app.configure_source(plugin, window, cx),
                }

                cx.new(|_| app)
            },
        )
    });

    let Ok((handle, _)) = opened else {
        return false;
    };

    cx.update_window(handle, |_, window, cx| {
        if let Shot::Dark = look.theme {
            Theme::change(ThemeMode::Dark, None, cx);
        }

        match look.overlay {
            Overlay::None => {}
            Overlay::Confirm => dialog::confirm(
                "删除列表",
                "「周末长文」会从侧边栏消失。里面的条目不会被删，只是不再属于这个列表。",
                "删除",
                Rc::new(|_, _| {}),
                window,
                cx,
            ),
            Overlay::Pick => dialog::open(
                Ask {
                    id: 0,
                    request: DialogRequest::Pick {
                        items: vec![
                            json!("稍后读"),
                            json!({ "title": "周末长文" }),
                            json!({ "name": "关于字体渲染的" }),
                        ],
                    },
                },
                worker("pick"),
                window,
                cx,
            ),
            Overlay::Install => add_source::confirm_install(
                PathBuf::from("/Users/you/Library/Application Support/rome/bundled/hacker-news.js"),
                manifest(),
                window,
                cx,
                worker("install"),
            ),
            Overlay::Prompt => dialog::prompt(
                "新建列表",
                "",
                "列表名称",
                "创建",
                Rc::new(|_, _, _| {}),
                window,
                cx,
            ),
        }
    })
    .expect("the window renders");

    // A dialog slides and fades in over a quarter of a second, and a single
    // `draw` catches it at the start of that: a surface at no opacity, halfway
    // off its resting position. The clock is simulated here, so the animation
    // is settled by advancing it rather than by waiting.
    //
    // Only for the overlays. A frame that settles runs the executor to a stop,
    // and the worker is still starting up behind the first frame: what it
    // publishes then belongs to the context that frame was built in, and using
    // it after the next frame has opened is an error rather than a repaint.
    if look.overlay != Overlay::None {
        cx.advance_clock(Duration::from_millis(400));
        cx.run_until_parked();
    }

    cx.update_window(handle, |_, window, cx| {
        // A dialog focuses its field the moment it opens, and a focused `Input`
        // draws the focus ring instead of its border — which is the one thing
        // this frame is here to show. Focus is handed to a handle that belongs
        // to nothing, so the field is drawn the way it is before the user has
        // clicked into it.
        if look.overlay == Overlay::Prompt {
            let nowhere = cx.focus_handle();
            window.focus(&nowhere, cx);
        }

        // What `gpui_kit`'s `render_frame` does, spelled out because the trait
        // it comes from is behind `gpui-kit`'s `test-support` feature, and that
        // feature cannot be turned on — see the note in `Cargo.toml`.
        window.refresh();
        window.draw(cx).clear(cx);
    })
    .expect("the window renders");

    let Ok(image) = cx.capture_screenshot(handle) else {
        return false;
    };

    let path = shot_dir().join(format!("{name}.png"));
    image.save(&path).expect("the frame writes as a PNG");

    println!("wrote {}", path.display());

    true
}

/// Which theme to draw in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Shot {
    Light,
    Dark,
}

/// A dialog drawn over the window, for the frames that need one.
///
/// A dialog is the one thing a snapshot cannot carry: it is opened on a window,
/// not rendered from data. That is exactly why it needs a frame. Every dialog
/// in the application is built with `button_props`, and whether those props
/// become buttons depends on which of the library's two dialog types is
/// opening them — so a frame that never opens one cannot show that the buttons
/// are there at all.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Overlay {
    None,
    /// The app's own yes/no, which is the shape most of them take.
    Confirm,
    /// A dialog whose footer is not the default one, because it has nothing to
    /// confirm.
    Pick,
    /// The installer's confirmation, which is the one that draws a manifest
    /// rather than a form.
    Install,
    /// The dialog with a text field in it, which is the only frame that shows
    /// what an `Input` looks like: its border is a theme colour of its own, and
    /// the search box in the list column draws its own outline over the top of
    /// that one, so the list frames prove nothing about it.
    Prompt,
}

/// Which of the window's own screens to draw.
///
/// A snapshot cannot reach these: the mode and the add-source page's tab and
/// step live in `RomeApp`, not in the data. A frame that needs one asks for it
/// here.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Screen {
    Browse,
    Plugins,
    AddSource,
    AddSourceMarket,
    AddSourceConfigure(u64),
}

/// What to draw, beyond the data: the things the window owns rather than the
/// worker. They are the states a screenshot has to be asked for, because
/// nothing in a fixture can reach them.
#[derive(Clone, Copy)]
struct Look {
    theme: Shot,
    collapsed: bool,
    overlay: Overlay,
    screen: Screen,
}

impl Look {
    const LIGHT: Self = Self {
        theme: Shot::Light,
        collapsed: false,
        overlay: Overlay::None,
        screen: Screen::Browse,
    };
    const DARK: Self = Self {
        theme: Shot::Dark,
        ..Self::LIGHT
    };
    /// The sidebar at its narrow width, where three things have to fit in 48
    /// pixels and none of them may spill.
    const NARROW: Self = Self {
        collapsed: true,
        ..Self::LIGHT
    };
    /// The plugin manager, which is where a broken plugin is read about.
    const PLUGINS: Self = Self {
        screen: Screen::Plugins,
        ..Self::LIGHT
    };
    /// The add-source page on its installed tab, with two plugins to choose
    /// from.
    const ADD_SOURCE: Self = Self {
        screen: Screen::AddSource,
        ..Self::LIGHT
    };
    /// The page's other tab: the built-in market.
    const ADD_SOURCE_MARKET: Self = Self {
        screen: Screen::AddSourceMarket,
        ..Self::LIGHT
    };
    /// The second step, with the form the plugin asked for.
    const ADD_SOURCE_CONFIGURE: Self = Self {
        screen: Screen::AddSourceConfigure(1),
        ..Self::LIGHT
    };
    /// The app's own confirmation, over the window it would be asked in.
    const CONFIRM: Self = Self {
        overlay: Overlay::Confirm,
        ..Self::LIGHT
    };
    /// A plugin's chooser, whose footer is hand-built.
    const PICK: Self = Self {
        overlay: Overlay::Pick,
        ..Self::LIGHT
    };
    /// The installer's confirmation, which is what a picked file lands on.
    const INSTALL: Self = Self {
        overlay: Overlay::Install,
        ..Self::LIGHT
    };
    /// The dialog with a field in it, which is where an `Input` is drawn with
    /// nothing over its own border.
    const PROMPT: Self = Self {
        overlay: Overlay::Prompt,
        ..Self::LIGHT
    };
}

fn main() {
    let frames = [
        ("browse-light", LAPTOP, fixture(), Look::LIGHT),
        // The same window after dark, because a colour that works on white is
        // not evidence of anything about the one that has to work on black.
        ("browse-dark", LAPTOP, fixture(), Look::DARK),
        ("browse-large", LARGE, fixture(), Look::LIGHT),
        ("browse-small", SMALL, fixture(), Look::LIGHT),
        // The four browsed views, which are edge to edge rather than a list
        // beside a pane. Each has its own shape and its own things to get
        // wrong: a timeline's measure, a grid's row pitch, a cover's aspect
        // ratio, a podcast home's two sections.
        ("social", LAPTOP, feed(View::SocialMedia), Look::LIGHT),
        // The same view with a post selected, which is how the two columns are
        // meant to be used: scan on the left, read on the right.
        ("social-open", LAPTOP, social_open(), Look::LIGHT),
        ("videos", LAPTOP, feed(View::Videos), Look::LIGHT),
        ("pictures", LAPTOP, pictures(), Look::LIGHT),
        ("audios", LAPTOP, feed(View::Audios), Look::LIGHT),
        // The narrow window is where a computed column count earns its keep:
        // four covers cannot stay four when the page is 845 pixels wide.
        ("videos-small", SMALL, feed(View::Videos), Look::LIGHT),
        ("pictures-small", SMALL, pictures(), Look::LIGHT),
        // The one feed state that is not data: a note opened over its grid.
        ("picture-detail", LAPTOP, picture_detail(), Look::LIGHT),
        ("collapsed", LAPTOP, fixture(), Look::NARROW),
        // An entry whose page the plugin had to draw, and the moment before it
        // has come back. Both are states only a real run reaches: the first is
        // what the feature is for, and the second is the one that would look
        // like a bug if the waiting line were missing or misplaced.
        (
            "preview-read",
            LAPTOP,
            open_preview(Body::Read(DRAWN_PAGE.to_owned())),
            Look::LIGHT,
        ),
        (
            "preview-waiting",
            LAPTOP,
            open_preview(Body::Reading),
            Look::LIGHT,
        ),
        // The first launch, which is the state most users see first and the one
        // most likely to be left undesigned. The sidebar rows are still there,
        // at zero: they come from the view order, not from having any data.
        ("empty", LAPTOP, fresh(), Look::LIGHT),
        // The two screens the sidebar's own buttons open. Adding a source and
        // managing a plugin are different jobs; neither is a filter over
        // entries, so neither can be a snapshot of a selection.
        ("plugins", LAPTOP, fixture(), Look::PLUGINS),
        // The add-source page, one tab at a time: the installed plugins to
        // subscribe to, and the market to install more from.
        ("add-source", LAPTOP, fixture(), Look::ADD_SOURCE),
        (
            "add-source-market",
            LAPTOP,
            fixture(),
            Look::ADD_SOURCE_MARKET,
        ),
        // The market with fewer columns available, which is the frame that
        // catches a grid whose card width is a minimum rather than a share.
        (
            "add-source-market-compact",
            COMPACT,
            fixture(),
            Look::ADD_SOURCE_MARKET,
        ),
        // The page on a fresh install, where nothing is installed and the
        // market is the only way forward.
        ("add-source-empty", LAPTOP, fresh(), Look::ADD_SOURCE),
        ("add-source-small", SMALL, fixture(), Look::ADD_SOURCE),
        // The page's two steps. The first has no controls but the list; the
        // second is the only frame that shows a plugin-declared form outside a
        // dialog.
        (
            "add-source-configure",
            LAPTOP,
            fixture(),
            Look::ADD_SOURCE_CONFIGURE,
        ),
        // The overlays, which no fixture can reach.
        ("dialog-confirm", LAPTOP, fixture(), Look::CONFIRM),
        ("dialog-pick", LAPTOP, fixture(), Look::PICK),
        ("dialog-install", LAPTOP, fixture(), Look::INSTALL),
        ("dialog-prompt", LAPTOP, fixture(), Look::PROMPT),
    ];

    let mut written = 0;
    let mut skipped = Vec::new();

    for (name, frame, snapshot, look) in frames {
        if shoot(name, frame, snapshot, look) {
            written += 1;
        } else {
            skipped.push(name);
        }
    }

    if skipped.is_empty() {
        println!("wrote {written} frames to {}", shot_dir().display());
        return;
    }

    // Not a failure. A machine without Metal has nothing to show and nothing
    // broken, and a non-zero exit would only teach whoever ran this to ignore
    // the result.
    println!(
        "no headless renderer here; wrote nothing for {skipped:?}. \
         Frames are written on macOS and Linux."
    );
}
