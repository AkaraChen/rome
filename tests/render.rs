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
use std::time::Duration;
use std::rc::Rc;
use std::sync::Arc;

use gpui_kit::assets::Assets;
use gpui_kit::component::theme::ThemeMode;
use gpui_kit::component::Theme;
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
use rome::snapshot::{
    Article, EntryDetail, EntryRow, ListRow, PluginRow, Selection, Snapshot, SourceRow, Tab,
};
use rome::ui::add_source;
use rome::ui::app::RomeApp;
use rome::ui::dialog;
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
    let entries = vec![
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
            Tab {
                view: View::Notifications,
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
            source(6, 6, "Lobsters", Some("英文"), 0, Some("上次抓取失败：unexpected token at line 1")),
        ],
        plugins: vec![
            PluginRow {
                id: 1,
                plugin_id: "rome.hacker-news".to_owned(),
                name: "Hacker News".to_owned(),
                version: "1.0.0".to_owned(),
                description: Some("最小的抓取型：一次请求，一个数组，一次映射".to_owned()),
                enabled: true,
                sources: 1,
                error: None,
                recent_domains: vec!["news.ycombinator.com".to_owned()],
                settings: json!({}),
                settings_schema: json!({ "fields": [] }),
                params_schema: json!({ "fields": [] }),
            },
            PluginRow {
                id: 6,
                plugin_id: "rome.lobsters".to_owned(),
                name: "Lobsters".to_owned(),
                version: "1.0.0".to_owned(),
                description: Some("最小的正确形状：一次请求，一个数组，一次映射".to_owned()),
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
            article: Article::Idle,
            image: Some("https://picsum.photos/seed/rome1/1200/600".to_owned()),
            source_title: "少数派".to_owned(),
            read: true,
            starred: true,
        }),
        busy: false,
        busy_with: None,
        error: None,
    }
}

/// What the extractor hands the pane: the page's article, furniture removed.
///
/// The opening heading is the title again on purpose. A real page nearly always
/// carries one, and the pane draws the title itself, so this is the frame that
/// shows whether it draws the same words twice.
const FETCHED_ARTICLE: &str = "\
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

/// The reading pane on an entry the host had to read for itself.
///
/// Every link aggregator leaves `content` empty — Hacker News knows a story's
/// title and its address and nothing behind it — so this is the state the
/// reading pane is in for most of what a reader actually opens, and it is the
/// one no other frame reaches.
fn open_article(article: Article) -> Snapshot {
    let mut snapshot = fixture();

    snapshot.open = Some(EntryDetail {
        id: 4,
        title: "Show HN: I built a local-first RSS reader".to_owned(),
        url: Some("https://example.com/local-first-rss".to_owned()),
        author: Some("someone".to_owned()),
        published_at: Some(now() - 3600 * 2),
        content: None,
        summary: Some("312 分 · 84 条评论".to_owned()),
        article,
        image: None,
        source_title: "Hacker News".to_owned(),
        read: true,
        starred: false,
    });

    snapshot
}

/// The same window showing a view whose middle column is a grid rather than a
/// stack of headlines. A different list, and so a different set of things to
/// get wrong.
fn pictures() -> Snapshot {
    let mut snapshot = fixture();
    snapshot.selection = Selection::View(View::Pictures);
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
        view: View::Articles,
        category: category.map(str::to_owned),
        enabled: true,
        params: json!({}),
        unread,
        error: error.map(str::to_owned),
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
            |_, cx| {
                let mut app = RomeApp::new(worker(name));
                app.set_snapshot(snapshot);
                app.set_sidebar_collapsed(collapsed);
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
            Overlay::Install => add_source::choose(window, cx, worker("install")),
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
    /// The installer, which is the one with content of its own and a button
    /// whose label is a sentence.
    Install,
    /// The dialog with a text field in it, which is the only frame that shows
    /// what an `Input` looks like: its border is a theme colour of its own, and
    /// the search box in the list column draws its own outline over the top of
    /// that one, so the list frames prove nothing about it.
    Prompt,
}

/// What to draw, beyond the data: the things the window owns rather than the
/// worker. They are the states a screenshot has to be asked for, because
/// nothing in a fixture can reach them.
#[derive(Clone, Copy)]
struct Look {
    theme: Shot,
    collapsed: bool,
    overlay: Overlay,
}

impl Look {
    const LIGHT: Self = Self {
        theme: Shot::Light,
        collapsed: false,
        overlay: Overlay::None,
    };
    const DARK: Self = Self {
        theme: Shot::Dark,
        collapsed: false,
        overlay: Overlay::None,
    };
    /// The sidebar at its narrow width, where three things have to fit in 48
    /// pixels and none of them may spill.
    const NARROW: Self = Self {
        theme: Shot::Light,
        collapsed: true,
        overlay: Overlay::None,
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
    /// The installer, whose content is longer than any other dialog's.
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
        ("pictures", LAPTOP, pictures(), Look::LIGHT),
        ("collapsed", LAPTOP, fixture(), Look::NARROW),
        // An entry whose body the host had to go and read, and the moment
        // before it has come back. Both are states only a real fetch reaches:
        // the first is what the feature is for, and the second is the one that
        // would look like a bug if the waiting line were missing or misplaced.
        (
            "article-read",
            LAPTOP,
            open_article(Article::Read(FETCHED_ARTICLE.to_owned())),
            Look::LIGHT,
        ),
        ("article-waiting", LAPTOP, open_article(Article::Reading), Look::LIGHT),
        // The first launch, which is the state most users see first and the one
        // most likely to be left undesigned.
        ("empty", LAPTOP, Snapshot::default(), Look::LIGHT),
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
