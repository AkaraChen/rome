//! The left column: the view tabs, the source list, and the two states that
//! are not a list — nothing installed yet, and a load that failed.
//!
//! Everything here is drawn from a [`Snapshot`] the worker published. Nothing
//! in this module reads the database, and nothing in it decides what a click
//! means: a row reports the selection it stands for and the application works
//! out the rest.

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::PopupMenuItem;
use gpui_kit::component::sidebar::*;
use gpui_kit::component::{ActiveTheme, Icon, Side, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::{Phosphor, PhosphorIcon};

use crate::models::View;
use crate::snapshot::{ListRow, Selection, Snapshot, SourceRow};
use crate::worker::Command;

use super::{Action, Dispatch};

/// Build the sidebar.
///
/// `collapsed` is passed in rather than read from the snapshot: it is the one
/// thing on this screen that is not a fact about the data. It lives in the
/// window, because it is about this window — a reader who collapsed the sidebar
/// to get a wider column did not ask for a setting.
///
/// `active` is the selection that should look selected, or `None` when the
/// window is showing a screen that is not a selection at all — the market, the
/// plugin manager. The snapshot's own selection still says where the reader
/// was, and leaving a row highlighted would claim the screen beside it is that
/// selection.
pub fn sidebar(
    snapshot: &Snapshot,
    collapsed: bool,
    active: Option<Selection>,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    // The tabs first: which list you are looking at is the question the sidebar
    // is answering, and everything below narrows that answer.
    let mut sections = vec![view_tabs(snapshot, active, dispatch)];

    // Above the sources it filters, which is where a reader looks for it, and
    // not a category of its own.
    sections.push(SidebarGroup::new("收藏").child(row(
        "全部收藏",
        PhosphorIcon::Star.duotone(),
        Selection::Starred,
        snapshot.starred,
        false,
        active,
        dispatch,
    )));

    for (category, sources) in by_category(&snapshot.sources) {
        sections.push(
            SidebarGroup::new(category.unwrap_or("未分类")).children(
                sources
                    .into_iter()
                    .map(|source| source_row(source, active, dispatch)),
            ),
        );
    }

    // Always drawn, empty or not. This is where a list is made, so a group that
    // only appeared once you already had one would be a group nobody finds.
    sections.push(
        SidebarGroup::new("列表")
            .children(
                snapshot
                    .lists
                    .iter()
                    .map(|list| list_row(list, active, dispatch)),
            )
            .child(new_list_row(dispatch)),
    );

    match &snapshot.error {
        // The full message goes to the entry list, where it can wrap. Here the
        // row only has to make the failure impossible to miss.
        Some(_) => sections.push(SidebarGroup::new("信息源").child(notice_row(
            "信息源读取失败",
            Some(PhosphorIcon::WarningCircle.regular()),
            cx.theme().danger,
        ))),
        None if snapshot.sources.is_empty() => sections.push(
            SidebarGroup::new("信息源")
                .child(notice_row(
                    "还没有信息源",
                    Some(PhosphorIcon::Info.regular()),
                    cx.theme().muted_foreground,
                ))
                .child(notice_row(
                    "点上方「添加信息源」开始",
                    None,
                    cx.theme().muted_foreground,
                )),
        ),
        None => {}
    }

    Sidebar::new("sidebar")
        .side(Side::Left)
        // Icon, not off-canvas. The icons are the point of the narrow state:
        // collapsing a reader's sources out of the window entirely would trade
        // a wide column for having to reopen the sidebar every time they want
        // to look at something else.
        .collapsible(SidebarCollapsible::Icon)
        .collapsed(collapsed)
        .header(header(collapsed, dispatch))
        .children(sections)
        .footer(footer(collapsed, dispatch))
        .into_any_element()
}

/// The app mark, the way to add a source, and the way to narrow the sidebar.
///
/// Three things in two rows: the mark and the collapse control share the top
/// one, and the button that adds a source gets the row under it to itself.
/// Packed into a single row they filled the header edge to edge — the mark, the
/// button and the control ran from one side to the other with nothing between
/// them, which is a strip rather than a header.
///
/// Collapsed, the button goes away rather than the mark: at 48 pixels there is
/// room for one icon, and the control that brings the width back is the one the
/// reader needs.
///
/// The header carries no horizontal padding of its own, and the brand row
/// carries the 8 a menu row carries. That is what puts the mark on the same
/// vertical line as every icon below it, since the wrapper has already inset by
/// 12 and a row adds 8 of its own — and it is what lets the add button below
/// sit on that line too, because a button's fill starts at its own box and the
/// box now starts where the rows start.
///
/// The button hugs its label rather than filling the column. A `Button` centres
/// its contents and does not offer a way not to — the style that would move
/// them is `pub(crate)` — so a full-width one would put its plus in the middle
/// of the sidebar, alone, on an axis nothing else uses. Wrapped in a row that
/// gives it the width and leaves it at the start, it is the width of what it
/// says, which is also what makes it read as a button rather than as one more
/// row of the navigation under it.
///
/// Built here rather than from [`SidebarHeader`], which is a clickable row —
/// it carries a hover fill and a `DropdownMenu` implementation, for a workspace
/// switcher — and this header is not one. It also pads its contents again on
/// top of the padding the sidebar wrapper already applies, which is what put
/// the collapse control 12 pixels right of every icon below it once collapsed:
/// the padding left it a 16-pixel box to centre a 28-pixel button in, and the
/// button won. `SidebarFooter` is the right component for the other end
/// because that row *is* clickable.
fn header(collapsed: bool, dispatch: &Dispatch) -> AnyElement {
    let toggle = dispatch.clone();

    let toggle_button = Button::new("toggle-sidebar")
        .ghost()
        .small()
        .icon(Icon::new(PhosphorIcon::SidebarSimple.regular()))
        .tooltip(if collapsed {
            "展开侧栏"
        } else {
            "收起侧栏"
        })
        .on_click(move |_, window, cx| toggle(Action::ToggleSidebar, window, cx));

    if collapsed {
        // Centred on the sidebar's own axis, which is where the component
        // centres a collapsed row: 48 pixels wide, 8 of padding either side,
        // and the icon in the middle of what is left.
        return h_flex()
            .w_full()
            .justify_center()
            .child(toggle_button)
            .into_any_element();
    }

    let open = dispatch.clone();

    v_flex()
        .w_full()
        .gap_2()
        .child(
            h_flex()
                .w_full()
                .items_center()
                .gap_2()
                // The inset a menu row's contents get, so the mark lands on the
                // same vertical line as every icon under it.
                .p_2()
                .child(
                    h_flex()
                        .flex_1()
                        .min_w_0()
                        .gap_2()
                        .text_sm()
                        .child(Icon::new(PhosphorIcon::BookOpen.duotone()))
                        .child("Rome"),
                )
                .child(toggle_button),
        )
        .child(
            // A row to give the button the width and hold it at the start of
            // it. Without one the button would be stretched across the column
            // and centre its label in the middle of the sidebar.
            h_flex().w_full().child(
                Button::new("add-source")
                    .ghost()
                    .small()
                    .icon(Icon::new(PhosphorIcon::Plus.regular()))
                    .label("添加信息源")
                    .on_click(move |_, window, cx| open(Action::OpenAddSource, window, cx)),
            ),
        )
        .into_any_element()
}

/// The settings row, at the bottom where a sidebar keeps it.
///
/// The label is dropped when the sidebar is collapsed. It used to be drawn
/// regardless, which at 48 pixels wide meant the row's text started 37 pixels
/// in and the sidebar cut it off through the middle of the first character —
/// half a 插, which reads as a rendering fault rather than as a state.
fn footer(collapsed: bool, dispatch: &Dispatch) -> SidebarFooter {
    let manage = dispatch.clone();

    let mut row = h_flex()
        .id("manage-plugins")
        .gap_2()
        .text_sm()
        .cursor_pointer()
        .child(Icon::new(PhosphorIcon::PuzzlePiece.duotone()));

    if !collapsed {
        row = row.child("插件");
    }

    SidebarFooter::new().child(
        row.when(collapsed, |this| this.w_full().justify_center())
            .on_click(move |_, window, cx| {
                manage(Action::ManagePlugins, window, cx);
            }),
    )
}

/// "全部" and one tab per [`View`], each with its unread count.
///
/// The count is the point of the row. A reader opens this app to find out what
/// is waiting, and a tab that cannot answer that is decoration.
///
/// Each tab carries a right-click reorder, because the order is the reader's:
/// they decide which view greets them first. "全部" does not, since it is a
/// filter over the tabs rather than a position in their order. The move off
/// either end is disabled rather than offered and ignored, for the same reason
/// the notice rows are.
fn view_tabs(
    snapshot: &Snapshot,
    active: Option<Selection>,
    dispatch: &Dispatch,
) -> SidebarGroup<SidebarMenuItem> {
    // "全部" is a filter over the other tabs rather than a view of its own, so
    // it stands for a selection of its own kind.
    let mut tabs = vec![row(
        "全部",
        PhosphorIcon::SquaresFour.duotone(),
        Selection::All,
        snapshot.unread,
        false,
        active,
        dispatch,
    )];

    let last = snapshot.tabs.len().saturating_sub(1);

    tabs.extend(snapshot.tabs.iter().enumerate().map(|(index, tab)| {
        let up = dispatch.clone();
        let down = dispatch.clone();
        let view = tab.view;

        row(
            view_label(view),
            view_icon(view),
            Selection::View(view),
            tab.unread,
            false,
            active,
            dispatch,
        )
        .context_menu(move |menu, _, _| {
            let up = up.clone();
            let down = down.clone();

            menu.item(
                PopupMenuItem::new("上移")
                    .icon(PhosphorIcon::ArrowUp.regular())
                    .disabled(index == 0)
                    .on_click(move |_, window, cx| {
                        up(
                            Action::Worker(Command::MoveView { view, delta: -1 }),
                            window,
                            cx,
                        );
                    }),
            )
            .item(
                PopupMenuItem::new("下移")
                    .icon(PhosphorIcon::ArrowDown.regular())
                    .disabled(index == last)
                    .on_click(move |_, window, cx| {
                        down(
                            Action::Worker(Command::MoveView { view, delta: 1 }),
                            window,
                            cx,
                        );
                    }),
            )
        })
    }));

    SidebarGroup::new("视图").children(tabs)
}

/// One selectable row.
///
/// Every row has the same shape — icon, label, count, and a handler reporting
/// the selection it stands for — so they are all built here. `struck` is for
/// the rows that stand for something switched off, which take the muted
/// treatment rather than being hidden: a subscription the user paused still
/// needs to be visible and reachable.
#[allow(clippy::too_many_arguments)]
fn row(
    label: &str,
    icon: Phosphor,
    selection: Selection,
    count: usize,
    struck: bool,
    active: Option<Selection>,
    dispatch: &Dispatch,
) -> SidebarMenuItem {
    let dispatch = dispatch.clone();
    let item = SidebarMenuItem::new(label.to_owned())
        .icon(icon)
        .active(active == Some(selection))
        .suffix(count_suffix(count))
        .on_click(move |_, window, cx| {
            dispatch(Action::Worker(Command::Select(selection)), window, cx);
        });

    if struck { item.disable(true) } else { item }
}

/// One list, with the two things that can be done to it behind a right-click.
///
/// Renaming and deleting live in a context menu rather than on the row because
/// they are rare and, in one case, destructive: a row carrying a permanent
/// delete button is a row that can be mis-clicked, and the sidebar has no width
/// to spare for two more glyphs on every list the user has ever made.
fn list_row(list: &ListRow, active: Option<Selection>, dispatch: &Dispatch) -> SidebarMenuItem {
    let select = dispatch.clone();
    let rename = dispatch.clone();
    let delete = dispatch.clone();
    let id = list.id;

    SidebarMenuItem::new(list.name.clone())
        .icon(PhosphorIcon::ListBullets.regular())
        .active(active == Some(Selection::List(id)))
        .suffix(count_suffix(list.count))
        .on_click(move |_, window, cx| {
            select(
                Action::Worker(Command::Select(Selection::List(id))),
                window,
                cx,
            );
        })
        .context_menu(move |menu, _, _| {
            let rename = rename.clone();
            let delete = delete.clone();

            menu.item(
                PopupMenuItem::new("重命名")
                    .on_click(move |_, window, cx| rename(Action::RenameList(id), window, cx)),
            )
            .separator()
            .item(
                PopupMenuItem::new("删除")
                    .on_click(move |_, window, cx| delete(Action::DeleteList(id), window, cx)),
            )
        })
}

/// The row that makes a list.
///
/// A row inside the group rather than a button in its header: the reader who
/// wants a new list is already looking at the lists, and the group's own header
/// is a label the component library draws, not a place to hang an action.
fn new_list_row(dispatch: &Dispatch) -> SidebarMenuItem {
    let create = dispatch.clone();

    SidebarMenuItem::new("新建列表")
        .icon(PhosphorIcon::Plus.regular())
        .on_click(move |_, window, cx| create(Action::CreateList, window, cx))
}

/// What a view is called in the UI.
///
/// The enum's own names are the storage vocabulary. These are what a reader
/// sees, and they live here rather than on the model because they are
/// presentation.
pub fn view_label(view: View) -> &'static str {
    match view {
        View::Articles => "文章",
        View::SocialMedia => "社交媒体",
        View::Pictures => "图片",
        View::Videos => "视频",
        View::Audios => "音频",
    }
}

/// The icon a view is drawn with.
fn view_icon(view: View) -> Phosphor {
    match view {
        View::Articles => PhosphorIcon::Article.regular(),
        View::SocialMedia => PhosphorIcon::ChatsCircle.regular(),
        View::Pictures => PhosphorIcon::Image.regular(),
        View::Videos => PhosphorIcon::VideoCamera.regular(),
        View::Audios => PhosphorIcon::MusicNotes.regular(),
    }
}

/// The unread count that sits at the end of a row.
///
/// A plain label rather than the component library's `Badge`: that badge is an
/// absolutely-positioned overlay meant to sit on an avatar, and here the number
/// belongs in the row's own layout. Zero draws nothing, which is what a row
/// with nothing waiting should look like.
///
/// Vercel's `metadata` role, which is what a count is: 13 pixels rather than
/// the `text_xs` the rest of the sidebar's small text takes, because `text_xs`
/// resolves to 12 and Vercel publishes nothing below 13. The muted colour is
/// the role's own `--vbg-text-secondary`.
fn count_suffix(count: usize) -> impl Fn(&mut Window, &mut App) -> Div + 'static {
    move |_, cx| {
        let label = if count == 0 {
            String::new()
        } else {
            count.to_string()
        };

        div()
            .text_size(px(crate::theme::LABEL))
            .text_color(cx.theme().muted_foreground)
            .child(label)
    }
}

/// One source row.
///
/// The two markers carry more than the name does: a source the user switched
/// off, and one whose last fetch failed. Plugin health has to be readable from
/// the sidebar without opening anything — a plugin breaking is the normal case
/// in this product, not an exceptional one.
fn source_row(
    source: &SourceRow,
    active: Option<Selection>,
    dispatch: &Dispatch,
) -> SidebarMenuItem {
    let item = row(
        &source.title,
        PhosphorIcon::Rss.regular(),
        Selection::Source(source.id),
        source.unread,
        !source.enabled,
        active,
        dispatch,
    );

    match &source.error {
        // The message itself is too long for a row and goes to the reading
        // pane; here it only has to be impossible to miss.
        Some(error) => item.suffix(error_suffix(error.clone())),
        None => item,
    }
}

/// The failure marker on a broken source.
///
/// A suffix of its own rather than a replacement for the count, because a
/// source that failed can still have unread entries from before it broke —
/// and losing that number to the warning would hide the thing the user is
/// most likely to want to read while they sort the plugin out.
fn error_suffix(error: String) -> impl Fn(&mut Window, &mut App) -> Div + 'static {
    // No tooltip: GPUI only exposes `.tooltip` on its own interactive
    // components, not on a bare `div`. The icon is the marker and the message
    // itself has a home — the reading pane, where it can wrap.
    let _ = error;

    move |_, cx| {
        h_flex()
            .gap_1()
            .child(Icon::new(PhosphorIcon::WarningCircle.regular()).text_color(cx.theme().danger))
    }
}

/// Group sources by the category the user filed them under.
///
/// Groups come out in the order their category first appears, with the
/// uncategorised sources last. A `Vec` searched linearly rather than a map:
/// a sidebar has tens of sources, and keeping the order the user built is worth
/// more than the lookup.
fn by_category(sources: &[SourceRow]) -> Vec<(Option<&str>, Vec<&SourceRow>)> {
    let mut groups: Vec<(Option<&str>, Vec<&SourceRow>)> = Vec::new();
    let mut uncategorised = Vec::new();

    for source in sources {
        let Some(category) = source.category.as_deref() else {
            uncategorised.push(source);
            continue;
        };

        match groups.iter_mut().find(|(name, _)| *name == Some(category)) {
            Some((_, group)) => group.push(source),
            None => groups.push((Some(category), vec![source])),
        }
    }

    if !uncategorised.is_empty() {
        groups.push((None, uncategorised));
    }

    groups
}

/// A row that reports something instead of going somewhere.
///
/// `Sidebar` holds menu items and nothing else, and a menu item that does
/// nothing when clicked is a lie, so the row is disabled: it takes the muted
/// treatment and stops answering the pointer, which is what a message should
/// do. The label is coloured on top of that, because "the load failed" has to
/// read as a failure rather than as an item.
fn notice_row(label: &str, icon: Option<Phosphor>, color: Hsla) -> SidebarMenuItem {
    let label_style = StyleRefinement::default().text_color(color);

    let row = SidebarMenuItem::new(label.to_owned())
        .disable(true)
        .label_style(label_style);

    match icon {
        Some(icon) => row.icon(Icon::new(icon).text_color(color)),
        None => row,
    }
}
