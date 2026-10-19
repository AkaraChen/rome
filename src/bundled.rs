//! The plugins that ship inside the binary.
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
//! choosing is what the marketplace is for.
//!
//! The source is written to a real file before it is installed, rather than
//! handed to the worker as a string. That is not a workaround: it is the same
//! path a picked file takes, so a bundled plugin is validated and installed by
//! exactly the code a plugin from disk is.
//!
//! Each row repeats the facts that are also in the plugin's own manifest — its
//! id, name, description, icon and default view. It has to: a market that
//! cannot be drawn without starting seven JavaScript runtimes is not a market,
//! and a runtime per card is slower than the page it fills. `tests/bundled.rs`
//! reads the same `include_str!` sources and keeps the two from drifting apart.

/// One plugin in the built-in market.
pub struct Bundled {
    /// The file's stem, and what the copy on disk is called.
    pub slug: &'static str,
    /// The `id` from the plugin's own manifest.
    pub plugin_id: &'static str,
    /// What the market calls it.
    pub name: &'static str,
    /// The one sentence the plugin says about itself, from its manifest.
    pub description: &'static str,
    /// The icon its manifest declares, if it declares one.
    ///
    /// Repeated for the same reason as the description: the market draws it
    /// before the plugin has ever run, and starting a runtime to learn one URL
    /// would cost more than the page it fills.
    pub icon: Option<&'static str>,
    /// The view its sources start in, from its manifest.
    pub view: crate::models::View,
    /// What the plugin is *for* — the technique it demonstrates. Kept for the
    /// tests and for anyone reading this table as documentation; the market
    /// shows the description instead, because a reader choosing what to read
    /// is not choosing what to learn.
    pub about: &'static str,
    pub code: &'static str,
}

/// Every bundled plugin, in the order the market lists them.
///
/// Fetchers first, then the computed ones, because that is the order they make
/// sense in: a computed feed takes the output of a fetch and turns it into
/// something neither RSS nor RSSHub can produce.
pub const ALL: &[Bundled] = &[
    Bundled {
        slug: "hacker-news",
        plugin_id: "rome.hacker-news",
        name: "Hacker News",
        description: "Hacker News 首页故事",
        icon: Some("https://news.ycombinator.com/favicon.ico"),
        view: crate::models::View::Articles,
        about: "最小的抓取型：一次请求，一个数组，一次映射",
        code: include_str!("../plugins/hacker-news.js"),
    },
    Bundled {
        slug: "lobsters",
        plugin_id: "rome.lobsters",
        name: "Lobsters",
        description: "Lobsters 技术社区的热门故事",
        icon: Some("https://lobste.rs/favicon.ico"),
        view: crate::models::View::Articles,
        about: "抓取型：把来源自己的 id 用成稳定的条目 id",
        code: include_str!("../plugins/lobsters.js"),
    },
    Bundled {
        slug: "bing-wallpaper",
        plugin_id: "rome.bing-wallpaper",
        name: "必应每日壁纸",
        description: "必应首页每日壁纸，含最近数天",
        icon: Some("https://www.bing.com/favicon.ico"),
        view: crate::models::View::Pictures,
        about: "图片型：声明 view 为 pictures，条目带 image",
        code: include_str!("../plugins/bing-wallpaper.js"),
    },
    Bundled {
        slug: "bilibili-popular",
        plugin_id: "rome.bilibili-popular",
        name: "哔哩哔哩热门",
        description: "哔哩哔哩综合热门视频榜，逐页向后抓取，打开后可看详情",
        icon: Some("https://www.bilibili.com/favicon.ico"),
        view: crate::models::View::Videos,
        about: "抓取型：用 storage 记住游标，一次刷新往后翻一页",
        code: include_str!("../plugins/bilibili-popular.js"),
    },
    Bundled {
        slug: "bluesky",
        plugin_id: "rome.bluesky",
        name: "Bluesky",
        description: "任意 Bluesky 账号的公开动态时间线",
        icon: Some("https://bsky.app/favicon.ico"),
        view: crate::models::View::SocialMedia,
        about: "社交媒体型：把时间线读成一个 socialMedia 视图",
        code: include_str!("../plugins/bluesky.js"),
    },
    Bundled {
        slug: "aggregate",
        plugin_id: "rome.aggregate",
        name: "聚合热榜",
        description: "合并 Hacker News 与 Lobsters，去重后按热度排序",
        icon: None,
        view: crate::models::View::Articles,
        about: "计算型：合并两个来源，去重、排序、截断",
        code: include_str!("../plugins/aggregate.js"),
    },
    Bundled {
        slug: "digest",
        plugin_id: "rome.digest",
        name: "每日精选",
        description: "合并 Hacker News、Lobsters 与 V2EX 的近期热帖，按站内名次而非原始分数排序",
        icon: None,
        view: crate::models::View::Articles,
        about: "计算型：按站内名次排序，而不是把不同站点的分数相加",
        code: include_str!("../plugins/digest.js"),
    },
];

/// The bundled plugin with this slug, if there is one.
pub fn get(slug: &str) -> Option<&'static Bundled> {
    ALL.iter().find(|bundled| bundled.slug == slug)
}

/// The bundled plugin an installed plugin came from, if any.
///
/// Matched by manifest id, not by name: the name is a label the plugin may
/// change, while the id is what an upgrade installs in place.
pub fn installed(plugin_id: &str) -> Option<&'static Bundled> {
    ALL.iter().find(|bundled| bundled.plugin_id == plugin_id)
}
