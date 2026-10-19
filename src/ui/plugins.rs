//! The plugin manager: what is installed, what is broken, and what can be
//! switched off.
//!
//! A plugin breaking is the normal case in this product rather than an
//! exceptional one — the sites they read change without warning, and a plugin
//! is only as good as the markup it was written against. So health gets a
//! screen of its own rather than a line in a log: the user has to be able to
//! find out which plugin stopped working, read what it said, and switch it off
//! without uninstalling it and losing its settings.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorIcon;

use crate::snapshot::{PluginRow, Snapshot};
use crate::worker::Command;

use super::{Action, Dispatch, entry_list::placeholder};

/// Build the plugin manager.
pub fn pane(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    if snapshot.plugins.is_empty() {
        return v_flex()
            .size_full()
            .min_w_0()
            .child(header(snapshot, dispatch, cx))
            .child(placeholder(
                PhosphorIcon::PuzzlePiece.regular(),
                "还没有装插件",
                "信息源来自插件。点右上角的「插件市场」：从内置插件里挑一个，或者从文件安装一个 .js。装好之后去「添加信息源」里添加订阅",
                None,
                cx,
            ))
            .into_any_element();
    }

    v_flex()
        .size_full()
        .min_w_0()
        .child(header(snapshot, dispatch, cx))
        .child(
            div()
                .id("plugins")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .p_3()
                .children(
                    snapshot
                        .plugins
                        .iter()
                        .map(|plugin| card(plugin, dispatch, cx)),
                ),
        )
        .into_any_element()
}

/// The strip at the top of the screen.
///
/// The way to install more is the market page, not a dialog: the same button in
/// the sidebar opens it, and a user who is thinking about plugins is the one
/// most likely to want the whole list rather than a file picker.
fn header(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    // How many are broken, so the strip says whether the screen needs reading
    // at all. Counting here rather than in the worker keeps a number that is
    // only ever a label out of the snapshot.
    let broken = snapshot
        .plugins
        .iter()
        .filter(|plugin| plugin.error.is_some())
        .count();

    let subtitle = match broken {
        0 => format!("{} 个插件", snapshot.plugins.len()),
        count => format!("{} 个插件 · {} 个有问题", snapshot.plugins.len(), count),
    };

    let market = dispatch.clone();
    let retry = dispatch.clone();

    h_flex()
        .h(px(44.))
        .flex_shrink_0()
        .items_center()
        .gap_2()
        .px_3()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .gap_2()
                .items_baseline()
                .child(
                    div()
                        .text_sm()
                        .text_color(cx.theme().foreground)
                        .child("插件"),
                )
                .child(
                    div()
                        .text_xs()
                        .truncate()
                        .text_color(if broken > 0 {
                            cx.theme().danger
                        } else {
                            cx.theme().muted_foreground
                        })
                        .child(subtitle),
                ),
        )
        .child(
            Button::new("plugins-retry")
                .ghost()
                .xsmall()
                .icon(Icon::new(PhosphorIcon::ArrowsClockwise.regular()))
                .tooltip("全部重新抓取")
                .on_click(move |_, window, cx| {
                    retry(Action::Worker(Command::RefreshAll), window, cx);
                }),
        )
        .child(
            Button::new("plugins-market")
                .xsmall()
                .icon(Icon::new(PhosphorIcon::Storefront.regular()))
                .label("插件市场")
                .on_click(move |_, window, cx| {
                    market(Action::OpenPluginMarket, window, cx);
                }),
        )
        .into_any_element()
}

/// One plugin.
fn card(plugin: &PluginRow, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let toggle = dispatch.clone();
    let id = plugin.id;
    let enabled = plugin.enabled;

    let health = match &plugin.error {
        Some(error) => h_flex()
            .gap_1()
            .items_start()
            .child(
                Icon::new(PhosphorIcon::WarningCircle.regular())
                    .size_3()
                    .flex_shrink_0()
                    .mt(px(2.))
                    .text_color(cx.theme().danger),
            )
            .child(
                div()
                    .text_xs()
                    .line_height(px(18.))
                    .text_color(cx.theme().danger)
                    .child(error.clone()),
            )
            .into_any_element(),
        None => h_flex()
            .gap_1()
            .child(
                Icon::new(PhosphorIcon::CheckCircle.regular())
                    .size_3()
                    .text_color(cx.theme().success),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("正常"),
            )
            .into_any_element(),
    };

    let mut meta = format!("v{}", plugin.version);
    if plugin.sources > 0 {
        meta.push_str(&format!(" · {} 个信息源", plugin.sources));
    } else {
        meta.push_str(" · 没有信息源");
    }

    v_flex()
        .w_full()
        .gap_2()
        .p_3()
        .mb_2()
        .rounded_md()
        .border_1()
        .border_color(cx.theme().border)
        .bg(cx.theme().secondary.opacity(0.25))
        .child(
            h_flex()
                .w_full()
                .gap_2()
                .items_start()
                // No leading mark here, deliberate: this column is narrow and
                // the three actions at the end leave the name about eighty
                // pixels before the metadata. A 32px icon took enough of that
                // to truncate "Hacker News", and the icon is already shown
                // where the plugin is chosen and where it is installed.
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap_1()
                        .child(
                            h_flex()
                                .gap_2()
                                .child(
                                    div()
                                        .text_sm()
                                        .truncate()
                                        .text_color(if plugin.enabled {
                                            cx.theme().foreground
                                        } else {
                                            cx.theme().muted_foreground
                                        })
                                        .child(plugin.name.clone()),
                                )
                                .child(
                                    div()
                                        .text_xs()
                                        .flex_shrink_0()
                                        .text_color(cx.theme().muted_foreground)
                                        .child(meta),
                                ),
                        )
                        .when_some(plugin.description.clone(), |this, description| {
                            this.child(
                                div()
                                    .text_xs()
                                    .line_height(px(18.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(description),
                            )
                        })
                        .child(
                            div()
                                .text_xs()
                                .font_family("monospace")
                                .text_color(cx.theme().muted_foreground)
                                .child(plugin.plugin_id.clone()),
                        ),
                )
                .child(
                    h_flex()
                        .gap_1()
                        .flex_shrink_0()
                        .child(
                            Button::new("edit-plugin")
                                .ghost()
                                .xsmall()
                                .icon(Icon::new(PhosphorIcon::GearSix.regular()))
                                .tooltip("设置")
                                .on_click({
                                    let edit = dispatch.clone();
                                    move |_, window, cx| {
                                        edit(Action::EditPlugin(id), window, cx);
                                    }
                                }),
                        )
                        .child(
                            Button::new("toggle-plugin")
                                .ghost()
                                .xsmall()
                                .label(if enabled { "停用" } else { "启用" })
                                .on_click(move |_, window, cx| {
                                    toggle(
                                        Action::Worker(Command::SetPluginEnabled {
                                            plugin_id: id,
                                            enabled: !enabled,
                                        }),
                                        window,
                                        cx,
                                    );
                                }),
                        )
                        .child(
                            // Beside 停用 rather than behind a menu, because
                            // the two are the pair a user has to choose
                            // between: one keeps the entries and one does not,
                            // and a delete hidden somewhere else is a delete
                            // found after the entries are already gone.
                            Button::new("remove-plugin")
                                .ghost()
                                .xsmall()
                                .icon(
                                    Icon::new(PhosphorIcon::Trash.regular())
                                        .text_color(cx.theme().danger),
                                )
                                .tooltip("卸载")
                                .on_click({
                                    let remove = dispatch.clone();
                                    move |_, window, cx| {
                                        remove(Action::RemovePlugin(id), window, cx);
                                    }
                                }),
                        ),
                ),
        )
        .child(health)
        .when(!plugin.recent_domains.is_empty(), |this| {
            // What the plugin has touched, which is the one thing about a
            // plugin the user cannot read off its code in a glance. Drawn only
            // when there is something to say: a plugin that has not fetched
            // anything yet has no domains, and an empty list would read as a
            // finding rather than as the absence of one.
            this.child(
                h_flex()
                    .w_full()
                    .min_w_0()
                    .flex_wrap()
                    .items_baseline()
                    .gap_2()
                    .child(
                        div()
                            .text_xs()
                            .flex_shrink_0()
                            .text_color(cx.theme().muted_foreground)
                            .child("访问过"),
                    )
                    .children(plugin.recent_domains.iter().map(|host| {
                        div()
                            .text_xs()
                            .font_family("monospace")
                            .text_color(cx.theme().muted_foreground)
                            .child(host.clone())
                    })),
            )
        })
        .when(!plugin.enabled, |this| {
            this.child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("已停用：它的信息源不会抓取，已有的条目还在"),
            )
        })
        .into_any_element()
}
