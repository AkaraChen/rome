//! The middle column: the entries of whatever the sidebar selected.
//!
//! It draws one of two layouts from the same rows. Articles is a virtualised
//! stack of headlines; Pictures is a wrapped grid of what the entries carry as
//! their image. Which one is used is decided by the view the selection is in,
//! so a source added as a photo feed opens as photos without the user choosing
//! anything.
//!
//! The list is virtualised because the row count is a policy, not a layout
//! decision: the worker currently caps a column at a couple of hundred rows,
//! but that cap exists to bound what crosses the channel, not because drawing
//! more would be fine. A few thousand rows should cost a few dozen elements.

use std::cell::RefCell;
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::{ContextMenuExt, PopupMenuItem};
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorIcon;

use crate::snapshot::{EntryRow, Selection, Snapshot};
use crate::worker::Command;

use super::{Action, Dispatch};

// The focus handle the article list listens on.
//
// Cached in a thread local rather than created per frame because a focus
// handle's identity is what focus is: a fresh handle every frame would lose
// focus on the first repaint. `App::focus_handle` only needs `&App`, which is
// all the column is given, so this is the one place the list can get one
// without an entity of its own.
thread_local! {
    static LIST_FOCUS: RefCell<Option<FocusHandle>> = const { RefCell::new(None) };
    /// The list's scroll position, kept across frames so keyboard navigation
    /// can bring the entry it opened into view.
    static LIST_SCROLL: RefCell<Option<UniformListScrollHandle>> = const { RefCell::new(None) };
}

fn list_focus(cx: &App) -> FocusHandle {
    LIST_FOCUS.with(|slot| {
        slot.borrow_mut()
            .get_or_insert_with(|| cx.focus_handle())
            .clone()
    })
}

fn list_scroll() -> UniformListScrollHandle {
    LIST_SCROLL.with(|slot| {
        slot.borrow_mut()
            .get_or_insert_with(UniformListScrollHandle::new)
            .clone()
    })
}

/// The heading the middle column is under, given what is selected.
///
/// Shared with the full-width feeds, which are under the same heading for the
/// same reason: the sidebar says where the reader is, and the page says it once
/// more at its own scale.
pub(crate) fn title(snapshot: &Snapshot) -> String {
    if let Some(query) = &snapshot.search {
        return format!("搜索「{query}」");
    }

    match snapshot.selection {
        Selection::All => "全部".to_owned(),
        Selection::View(view) => super::sidebar::view_label(view).to_owned(),
        Selection::Starred => "收藏".to_owned(),
        Selection::Source(id) => snapshot
            .sources
            .iter()
            .find(|source| source.id == id)
            .map(|source| source.title.clone())
            .unwrap_or_default(),
        Selection::List(id) => snapshot
            .lists
            .iter()
            .find(|list| list.id == id)
            .map(|list| list.name.clone())
            .unwrap_or_default(),
    }
}

/// Build the middle column.
pub fn column(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let body = match &snapshot.error {
        Some(error) => placeholder(
            PhosphorIcon::WarningCircle.regular(),
            "读不到数据",
            error,
            Some(cx.theme().danger),
            cx,
        ),
        None if snapshot.entries.is_empty() => empty_state(snapshot, cx),
        // A search runs across every view at once and the remaining selections
        // mix views together, so this column is always the headline layout.
        // The views with a shape of their own are drawn edge to edge instead
        // of here; see `super::feed`.
        None => articles(&snapshot.entries, snapshot, dispatch, cx),
    };

    v_flex()
        .size_full()
        .min_w_0()
        .child(header(snapshot, dispatch, cx))
        .child(body)
        .into_any_element()
}

/// The heading row: what is selected, how much of it there is, and what can be
/// done to it.
///
/// Shared with the full-width feeds so the two layouts cannot drift apart on
/// type size or on where the count sits. The count is on the title's line
/// rather than under it: it is a number, not a second heading, and a stacked
/// pair spends a line of the page on it.
///
/// Sources can be refreshed and removed from this row rather than only from the
/// sidebar: the sidebar row has room for a name and a count, and hiding
/// destructive actions behind a right-click is how people delete things by
/// accident.
pub(crate) fn heading(
    snapshot: &Snapshot,
    dispatch: &Dispatch,
    unit: &str,
    pad: Pixels,
    cx: &App,
) -> AnyElement {
    // A count of what is on screen, so a list that stops at the limit does not
    // quietly look like the whole feed.
    let count = snapshot.entries.len();
    let subtitle = if snapshot.busy {
        snapshot.busy_with.clone().unwrap_or_default()
    } else if count == 0 {
        String::new()
    } else {
        format!("{count} {unit}")
    };

    h_flex()
        .w_full()
        .h(px(44.))
        .items_center()
        .gap_2()
        .px(pad)
        .child(
            h_flex()
                .flex_1()
                .min_w_0()
                .items_center()
                .gap_2()
                .child(
                    div()
                        .min_w(px(0.))
                        .truncate()
                        .text_sm()
                        .text_color(cx.theme().foreground)
                        .child(title(snapshot)),
                )
                .when(!subtitle.is_empty(), |this| {
                    this.child(
                        div()
                            .flex_shrink_0()
                            .text_xs()
                            .text_color(cx.theme().muted_foreground)
                            .child(subtitle),
                    )
                }),
        )
        .child(source_actions(snapshot, dispatch))
        .into_any_element()
}

/// The middle column's header: the shared heading and the search field.
fn header(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    v_flex()
        .flex_shrink_0()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(heading(snapshot, dispatch, "条", px(12.), cx))
        .child(super::search::field(snapshot, dispatch, cx))
        .into_any_element()
}

/// What can be done to the selected source, if one is selected.
///
/// Shared with the full-width feeds: which view a source is in changes how its
/// entries are drawn, not what can be done to the subscription. Refreshing and
/// removing belong next to the entries rather than only in a sidebar row whose
/// width has room for a name and a count.
pub(crate) fn source_actions(snapshot: &Snapshot, dispatch: &Dispatch) -> AnyElement {
    let mut actions = h_flex().gap_1().flex_shrink_0();

    let Selection::Source(id) = snapshot.selection else {
        return actions.into_any_element();
    };

    let enabled = snapshot
        .sources
        .iter()
        .find(|source| source.id == id)
        .map(|source| source.enabled);

    let refresh = dispatch.clone();
    actions = actions.child(
        Button::new("refresh-source")
            .ghost()
            .xsmall()
            .icon(Icon::new(PhosphorIcon::ArrowsClockwise.regular()))
            .tooltip("刷新")
            .on_click(move |_, window, cx| {
                refresh(Action::Worker(Command::RefreshSource(id)), window, cx);
            }),
    );

    if let Some(enabled) = enabled {
        let toggle = dispatch.clone();
        actions = actions.child(
            Button::new("toggle-source")
                .ghost()
                .xsmall()
                .label(if enabled { "暂停" } else { "恢复" })
                .on_click(move |_, window, cx| {
                    toggle(
                        Action::Worker(Command::SetSourceEnabled {
                            source_id: id,
                            enabled: !enabled,
                        }),
                        window,
                        cx,
                    );
                }),
        );
    }

    let edit = dispatch.clone();
    actions = actions.child(
        Button::new("edit-source")
            .ghost()
            .xsmall()
            .icon(Icon::new(PhosphorIcon::GearSix.regular()))
            .tooltip("信息源设置")
            .on_click(move |_, window, cx| {
                edit(Action::EditSource(id), window, cx);
            }),
    );

    let remove = dispatch.clone();
    actions = actions.child(
        Button::new("remove-source")
            .ghost()
            .xsmall()
            .label("移除")
            .on_click(move |_, window, cx| {
                remove(Action::RemoveSource(id), window, cx);
            }),
    );

    actions.into_any_element()
}

/// The headline layout, virtualised.
fn articles(
    entries: &[EntryRow],
    snapshot: &Snapshot,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    let open = snapshot.open.as_ref().map(|detail| detail.id);
    let focus = list_focus(cx);
    let scroll = list_scroll();

    // The rows are owned by the list's render closure, which outlives this
    // call and runs on later frames. They are a copy of a snapshot that was
    // itself a copy from the worker, so this is not a second copy of anything
    // expensive — just the headlines.
    let rows = Rc::new(entries.to_vec());
    let count = rows.len();

    // Which list the column is showing, if it is showing one. The row's third
    // button means "put this somewhere" everywhere except inside a list, where
    // it means the opposite — a list is the only place a reader can see that an
    // entry is filed, so it is the only place they can see it is filed wrongly.
    let viewing = match snapshot.selection {
        Selection::List(id) => Some(id),
        _ => None,
    };

    let row_rows = rows.clone();
    let row_dispatch = dispatch.clone();
    let row_focus = focus.clone();

    let key_rows = rows.clone();
    let key_dispatch = dispatch.clone();
    let key_scroll = scroll.clone();

    uniform_list("articles", count, move |range, _, cx| {
        range
            .map(|index| {
                let entry = &row_rows[index];
                article_row(
                    entry,
                    open == Some(entry.id),
                    viewing,
                    &row_dispatch,
                    &row_focus,
                    cx,
                )
            })
            .collect()
    })
    // Navigation lives on the list, not on the window. A window-level binding
    // would make Up and Down mean "the article list" in every context and
    // would need main.rs to know that the middle column exists; here the list
    // only answers keys while it has focus, which a click gives it.
    .track_focus(&focus)
    .track_scroll(&scroll)
    .on_key_down(move |event, window, cx| {
        let keystroke = &event.keystroke;

        // Leave chords alone. Without this, Cmd-Down would navigate the list
        // instead of whatever it is supposed to do.
        if keystroke.modifiers.platform || keystroke.modifiers.control || keystroke.modifiers.alt {
            return;
        }

        let key = keystroke.key.to_ascii_lowercase();
        let Some(target) = navigation(&key, &key_rows, open) else {
            return;
        };
        let Some(entry) = key_rows.get(target) else {
            return;
        };

        key_scroll.scroll_to_item(target, ScrollStrategy::Nearest);

        // Opening is what marks an entry read, so opening the row that is
        // already open would only re-fetch it. Enter on the open row is a
        // no-op; the arrows at the ends of the list stay put for the same
        // reason.
        if open == Some(entry.id) {
            return;
        }

        key_dispatch(Action::Worker(Command::Open(Some(entry.id))), window, cx);
    })
    .flex_1()
    .min_h_0()
    .into_any_element()
}

/// The row a navigation key moves to, if it is one.
///
/// Down and j, up and k: arrows for everyone, and the home row for readers who
/// never leave it. There is deliberately no wrapping — a list that jumps from
/// the end to the start loses the reader's place instead of telling them they
/// reached the end — and nothing is open yet, down starts at the first row and
/// up at the last.
///
/// Public because it is the one part of the list's keyboard handling that can
/// be tested without a window, and the ends of the list are exactly where the
/// arithmetic is worth testing.
pub fn navigation(key: &str, entries: &[EntryRow], open: Option<u64>) -> Option<usize> {
    if entries.is_empty() {
        return None;
    }

    let current = open.and_then(|id| entries.iter().position(|entry| entry.id == id));

    match key {
        "down" | "j" => Some(
            current
                .map(|index| (index + 1).min(entries.len() - 1))
                .unwrap_or(0),
        ),
        "up" | "k" => Some(
            current
                .map(|index| index.saturating_sub(1))
                .unwrap_or(entries.len() - 1),
        ),
        "enter" => Some(current.unwrap_or(0)),
        _ => None,
    }
}

/// One entry, as a headline.
///
/// The row has a fixed height because the list assumes every row is the same
/// height when it virtualises them. That is not a compromise here: a headline
/// is one line and a byline is one line, and a list whose rows breathe with the
/// length of their title is harder to scan, not easier.
fn article_row(
    entry: &EntryRow,
    selected: bool,
    viewing: Option<u64>,
    dispatch: &Dispatch,
    focus: &FocusHandle,
    cx: &App,
) -> AnyElement {
    let id = entry.id;

    let open = dispatch.clone();
    let open_focus = focus.clone();

    let star = dispatch.clone();
    let starred = entry.starred;

    let mark = dispatch.clone();
    let read = entry.read;

    let file = dispatch.clone();

    // A second set for the context menu. `Dispatch` is an `Rc`, so this is
    // four pointer copies rather than four closures.
    let menu_star = dispatch.clone();
    let menu_mark = dispatch.clone();
    let menu_file = dispatch.clone();

    let mut meta = entry.source_title.clone();
    if let Some(at) = entry.published_at {
        if !meta.is_empty() {
            meta.push_str(" · ");
        }
        meta.push_str(&super::when(at));
    }

    // The row's own actions. Ghost buttons that sit at opacity zero until the
    // row is hovered keep the column quiet while reserving their width, so
    // nothing shifts when the pointer arrives. A starred entry keeps its star
    // visible: the star is state, not an affordance, and hiding it would mean
    // the only way to see what is starred is to hover everything.
    let star_button = Button::new(format!("star:{id}"))
        .ghost()
        .xsmall()
        .icon(
            Icon::new(if starred {
                PhosphorIcon::Star.duotone()
            } else {
                PhosphorIcon::Star.regular()
            })
            .text_color(if starred {
                crate::theme::star()
            } else {
                cx.theme().muted_foreground
            }),
        )
        .tooltip(if starred { "取消收藏" } else { "收藏" })
        .opacity(if starred { 1.0 } else { 0.0 })
        .group_hover("article-row", |style| style.opacity(1.0))
        .on_click(move |_, window, cx| {
            // The row underneath opens the entry; the star is not a request
            // to read it.
            cx.stop_propagation();
            star(
                Action::Worker(Command::SetStarred {
                    entry_id: id,
                    starred: !starred,
                }),
                window,
                cx,
            );
        });

    let read_button = Button::new(format!("read:{id}"))
        .ghost()
        .xsmall()
        .icon(
            Icon::new(if read {
                PhosphorIcon::EnvelopeSimpleOpen.regular()
            } else {
                PhosphorIcon::EnvelopeSimple.regular()
            })
            .text_color(cx.theme().muted_foreground),
        )
        .tooltip(if read { "标为未读" } else { "标为已读" })
        .opacity(0.0)
        .group_hover("article-row", |style| style.opacity(1.0))
        .on_click(move |_, window, cx| {
            cx.stop_propagation();
            mark(
                Action::Worker(Command::SetRead {
                    entry_id: id,
                    read: !read,
                }),
                window,
                cx,
            );
        });

    let file_button = Button::new(format!("file:{id}"))
        .ghost()
        .xsmall()
        .icon(
            Icon::new(if viewing.is_some() {
                PhosphorIcon::X.regular()
            } else {
                PhosphorIcon::ListPlus.regular()
            })
            .text_color(cx.theme().muted_foreground),
        )
        .tooltip(if viewing.is_some() {
            "移出列表"
        } else {
            "加入列表"
        })
        .opacity(0.0)
        .group_hover("article-row", |style| style.opacity(1.0))
        .on_click(move |_, window, cx| {
            cx.stop_propagation();

            let action = match viewing {
                // Filing the entry into the list it is already in would be a
                // no-op the user cannot see, which is worse than a button that
                // does nothing: it would look like it worked.
                Some(list_id) => Action::Worker(Command::RemoveFromList {
                    list_id,
                    entry_id: id,
                }),
                None => Action::AddToList(id),
            };

            file(action, window, cx);
        });

    h_flex()
        .id(format!("article:{id}"))
        .group("article-row")
        .h(px(64.))
        .w_full()
        .items_center()
        .gap_2()
        .px_3()
        .cursor_pointer()
        .border_b_1()
        .border_color(cx.theme().border.opacity(0.5))
        .when(selected, |this| this.bg(cx.theme().accent.opacity(0.12)))
        .hover(|this| this.bg(cx.theme().accent.opacity(0.06)))
        .on_click(move |_, window, cx| {
            // A reader who clicked a row expects the next Down to continue
            // from it, so clicking is what hands the list the keyboard.
            open_focus.focus(window, cx);
            open(Action::Worker(Command::Open(Some(id))), window, cx);
        })
        // The row's buttons are a shortcut, not the only way in. Hover is not
        // an affordance a keyboard or a screen reader has, so every command
        // that lives on one of them is repeated here, where GPUI's own menu
        // supplies the things a strip of icons cannot: arrow-key navigation,
        // dismissal, disabled items, and focus handed back on close.
        .context_menu(move |menu, _, _| {
            let do_star = menu_star.clone();
            let do_mark = menu_mark.clone();
            let do_file = menu_file.clone();

            menu.item(
                PopupMenuItem::new(if starred { "取消收藏" } else { "收藏" })
                    .icon(if starred {
                        PhosphorIcon::Star.duotone()
                    } else {
                        PhosphorIcon::Star.regular()
                    })
                    .on_click(move |_, window, cx| {
                        do_star(
                            Action::Worker(Command::SetStarred {
                                entry_id: id,
                                starred: !starred,
                            }),
                            window,
                            cx,
                        );
                    }),
            )
            .item(
                PopupMenuItem::new(if read { "标为未读" } else { "标为已读" })
                    .icon(if read {
                        PhosphorIcon::EnvelopeSimple.regular()
                    } else {
                        PhosphorIcon::EnvelopeSimpleOpen.regular()
                    })
                    .on_click(move |_, window, cx| {
                        do_mark(
                            Action::Worker(Command::SetRead {
                                entry_id: id,
                                read: !read,
                            }),
                            window,
                            cx,
                        );
                    }),
            )
            .separator()
            .item(
                PopupMenuItem::new(match viewing {
                    Some(_) => "移出列表",
                    None => "加入列表",
                })
                .icon(match viewing {
                    Some(_) => PhosphorIcon::X.regular(),
                    None => PhosphorIcon::ListPlus.regular(),
                })
                .on_click(move |_, window, cx| {
                    let action = match viewing {
                        Some(list_id) => Action::Worker(Command::RemoveFromList {
                            list_id,
                            entry_id: id,
                        }),
                        None => Action::AddToList(id),
                    };

                    do_file(action, window, cx);
                }),
            )
        })
        .child(
            // An unread marker, not a badge: its absence is the read state, so
            // a scanned column shows what is new without any of the rows
            // shifting as things are read.
            div()
                .w(px(6.))
                .h(px(6.))
                .flex_shrink_0()
                .rounded_full()
                .when(!entry.read, |this| this.bg(cx.theme().accent))
                .when(entry.read, |this| this.bg(gpui_kit::transparent_black())),
        )
        .when_some(entry.icon.as_deref(), |this, url| {
            // The row's mark: the item's own, or its source's, or its
            // plugin's. Nothing is drawn when all three are silent — a generic
            // glyph on every headline would be decoration, and the row already
            // has a source name under the title.
            this.child(super::picture::icon(
                Some(url),
                px(20.),
                cx.theme().radius,
                PhosphorIcon::Article.regular(),
                cx,
            ))
        })
        .child(
            v_flex()
                .min_w_0()
                .flex_1()
                .gap_1()
                .child(
                    div()
                        .text_sm()
                        .line_height(px(20.))
                        .truncate()
                        .text_color(if entry.read {
                            cx.theme().muted_foreground
                        } else {
                            cx.theme().foreground
                        })
                        .child(entry.title.clone()),
                )
                .when(!meta.is_empty(), |this| {
                    this.child(
                        h_flex()
                            .gap_1()
                            .text_xs()
                            .line_height(px(16.))
                            .text_color(cx.theme().muted_foreground)
                            // Truncated for the same reason the title is, and
                            // by the same rule: a source with a long name must
                            // not be what decides how wide a row wants to be.
                            .child(div().min_w(px(0.)).truncate().child(meta)),
                    )
                }),
        )
        .child(
            h_flex()
                .flex_shrink_0()
                .gap_0p5()
                .child(star_button)
                .child(file_button)
                .child(read_button),
        )
        .into_any_element()
}

/// Why the middle column is empty, said in terms of what the user can do.
fn empty_state(snapshot: &Snapshot, cx: &App) -> AnyElement {
    if let Some(query) = &snapshot.search {
        return placeholder(
            PhosphorIcon::MagnifyingGlass.regular(),
            "没有找到",
            &format!("「{query}」没有匹配的条目"),
            None,
            cx,
        );
    }

    if snapshot.sources.is_empty() {
        return placeholder(
            PhosphorIcon::Rss.regular(),
            "还没有信息源",
            "在左边点「添加信息源」，从市场里挑一个插件，装上后添加订阅",
            None,
            cx,
        );
    }

    placeholder(
        PhosphorIcon::TextAlignLeft.regular(),
        "这里还没有条目",
        "按上方的刷新抓取一次，或者换一个视图看看",
        None,
        cx,
    )
}

/// A centred statement of why a pane is empty.
///
/// The hint is the part that matters: it says what the user can do, not just
/// that there is nothing. `color` is for the cases where the reason is a
/// failure rather than an absence.
pub fn placeholder(
    icon: gpui_kit_phosphor::Phosphor,
    title: &str,
    hint: &str,
    color: Option<Hsla>,
    cx: &App,
) -> AnyElement {
    v_flex()
        .size_full()
        .items_center()
        .justify_center()
        .gap_2()
        .px_8()
        .text_center()
        .child(
            Icon::new(icon)
                .size_4()
                .text_color(color.unwrap_or(cx.theme().muted_foreground)),
        )
        // `items_center` above means these would otherwise size to their own
        // text and run off the side of the pane instead of wrapping; `w_full`
        // pins them to the pane's width so a long hint wraps and stays centred.
        .child(
            div()
                .w_full()
                .text_sm()
                .text_color(cx.theme().foreground)
                .child(title.to_owned()),
        )
        .child(
            div()
                .w_full()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(hint.to_owned()),
        )
        .into_any_element()
}
