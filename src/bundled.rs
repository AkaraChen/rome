//! The example plugins that ship inside the binary.
//!
//! Rome has no plugin repository and no network of its own, so a fresh install
//! has nothing to read and no obvious way to find out what a plugin is meant to
//! look like. These are the answer to both: the sources are compiled in, so
//! there is no file to lose, no download to fail, and nothing to keep in sync
//! with an installation step.
//!
//! They are offered rather than installed. A reader who opens Rome for the
//! first time should not find seven plugins already fetching on their behalf —
//! the whole point of the product is that the user chooses what it reads, and
//! choosing is exactly what the install dialog is for.
//!
//! The source is written to a real file before it is described, rather than
//! handed to the worker as a string. That is not a workaround: it is the same
//! path a picked file takes, so an example plugin is described, validated and
//! installed by exactly the code a plugin from disk is, and the install dialog
//! shows a path that genuinely holds the plugin being installed.

/// One example plugin.
pub struct Bundled {
    /// The file's stem. Stable, because it is what the copy on disk is called
    /// and what the install dialog shows.
    pub slug: &'static str,
    /// What the chooser calls it.
    ///
    /// Repeats the `name` in the plugin's own manifest, which the install
    /// dialog then shows from the manifest itself. The duplication is
    /// deliberate: a menu that cannot be drawn without running seven plugins is
    /// not a menu. [`bundled_ids_are_in_their_own_sources`] is what keeps the
    /// two from drifting apart.
    ///
    /// [`bundled_ids_are_in_their_own_sources`]: ../../tests/bundled.rs
    pub name: &'static str,
    /// What the example is *for* — the technique it demonstrates, not what it
    /// reads. A reader picking one of these is choosing what to learn from.
    pub about: &'static str,
    pub code: &'static str,
}

/// Every example, in the order the chooser lists them.
///
/// Fetchers first, then the computed ones, because that is the order they make
/// sense in: a computed feed takes the output of a fetch and turns it into
/// something neither RSS nor RSSHub can produce, and that argument does not
/// land until you have seen the simple case.
pub const ALL: &[Bundled] = &[
    Bundled {
        slug: "hacker-news",
        name: "Hacker News",
        about: "最小的抓取型：一次请求，一个数组，一次映射",
        code: include_str!("../plugins/hacker-news.js"),
    },
    Bundled {
        slug: "lobsters",
        name: "Lobsters",
        about: "抓取型：把来源自己的 id 用成稳定的条目 id",
        code: include_str!("../plugins/lobsters.js"),
    },
    Bundled {
        slug: "bing-wallpaper",
        name: "必应每日壁纸",
        about: "图片型：声明 view 为 pictures，条目带 image",
        code: include_str!("../plugins/bing-wallpaper.js"),
    },
    Bundled {
        slug: "bilibili-popular",
        name: "哔哩哔哩综合热门",
        about: "抓取型：用 storage 记住游标，一次刷新往后翻一页",
        code: include_str!("../plugins/bilibili-popular.js"),
    },
    Bundled {
        slug: "bluesky",
        name: "Bluesky",
        about: "社交媒体型：把时间线读成一个 socialMedia 视图",
        code: include_str!("../plugins/bluesky.js"),
    },
    Bundled {
        slug: "aggregate",
        name: "聚合热榜",
        about: "计算型：合并两个来源，去重、排序、截断",
        code: include_str!("../plugins/aggregate.js"),
    },
    Bundled {
        slug: "digest",
        name: "每日精选",
        about: "计算型：按站内名次排序，而不是把不同站点的分数相加",
        code: include_str!("../plugins/digest.js"),
    },
];

/// The example with this slug, if there is one.
pub fn get(slug: &str) -> Option<&'static Bundled> {
    ALL.iter().find(|bundled| bundled.slug == slug)
}
