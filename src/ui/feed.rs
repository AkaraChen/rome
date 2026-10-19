//! The views that are browsed rather than read: a timeline, a photo grid, a
//! video feed and a podcast home.
//!
//! Articles get the two-column layout in [`super::entry_list`] and
//! [`super::reading_pane`]: a narrow list of headlines and a wide column of
//! prose. A social post is also read in place, so its view is two columns as
//! well — a timeline on the left, the selected post in the reading pane on the
//! right. What it is not is a 340-pixel column of truncated titles: a post
//! carries its own byline and body, so the list is wider than a headline list
//! and the body opens beside it rather than in a browser.
//!
//! The other three views are not read in place. A picture opens into a
//! full-size detail, a video from a cover, a podcast from its show art.
//!
//! Pictures are the one that keeps a detail of its own, drawn as an overlay
//! because a grid cell cannot hold either a full-size image or a caption.
//! Videos and episodes hand the entry to the browser on click — that is what a
//! reader does with them, and it keeps Rome from growing a second renderer for
//! pages it does not own.
//!
//! All four are virtualised by row. The worker caps a column at a couple of
//! hundred entries, but the cap exists to bound what crosses the channel, not
//! because drawing every cover at once would be fine: an image starts loading
//! the moment it is laid out, so a non-virtualised grid would fetch every cover
//! in the list on the first frame.

use std::collections::HashSet;
use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::menu::{ContextMenuExt, PopupMenu, PopupMenuItem};
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::{Phosphor, PhosphorIcon};

use crate::models::View;
use crate::snapshot::{Body, EntryDetail, EntryRow, Selection, Snapshot};
use crate::worker::Command;

use super::content::{self, Block};
use super::{Action, Dispatch, entry_list, picture, reading_pane};

/// The application's `content-width` token: the widest a full-width feed lays
/// itself out, so a very large window does not stretch four cards into six
/// hundred pixels each.
const CONTENT: Pixels = px(1200.);

/// The page's horizontal inset. Vercel's `space-8`, the between-group gap.
const PAD: Pixels = px(32.);

/// The gap between two cards in a row. Vercel's `space-4`.
const GAP: Pixels = px(16.);

/// The width of the social timeline.
///
/// The left column of the social view, and wider than the article list because
/// a post carries a byline, two lines of text and often a thumbnail. It is
/// fixed rather than a share of the window for the same reason the article list
/// is: the list is for scanning, and the pane beside it is for reading.
const TIMELINE: Pixels = px(380.);

/// A social post's height.
///
/// Fixed because the timeline is a `uniform_list`. The number is the content
/// it has to hold: 12 pixels of padding twice, a 20-pixel byline, two 20-pixel
/// title lines, an 18-pixel summary line and the two 4-pixel gaps between them.
/// A row shorter than this does not clip — it lets the byline bleed over the
/// next post's avatar.
const POST: Pixels = px(110.);

/// The smallest a card may get before a row holds one fewer of them. The
/// numbers are where each card stops reading as a card: a video cover smaller
/// than a phone thumbnail, a photo smaller than a column of text.
const MIN_VIDEO: Pixels = px(220.);
const MIN_PICTURE: Pixels = px(220.);
const MIN_SHOW: Pixels = px(132.);

/// Which home a selection gets, if it gets one of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Home {
    Social,
    Pictures,
    Videos,
    Audios,
}

/// The feed a selection is drawn as, or `None` for the two-column layout.
///
/// A search runs across every view at once, so it is never a feed: a grid of
/// pictures with the text results missing would be a worse answer than a list
/// of headlines. "全部", "收藏" and a user list mix views for the same reason.
pub fn home(snapshot: &Snapshot) -> Option<Home> {
    if snapshot.search.is_some() {
        return None;
    }

    let view = match snapshot.selection {
        Selection::View(view) => view,
        Selection::Source(id) => snapshot
            .sources
            .iter()
            .find(|source| source.id == id)
            .map(|source| source.view)?,
        Selection::All | Selection::Starred | Selection::List(_) => return None,
    };

    match view {
        View::Articles => None,
        View::SocialMedia => Some(Home::Social),
        View::Pictures => Some(Home::Pictures),
        View::Videos => Some(Home::Videos),
        View::Audios => Some(Home::Audios),
    }
}

/// Build the page a feed occupies.
///
/// `available` is the window width left of the sidebar. It is passed in rather
/// than measured here because the number of columns is part of the layout, and
/// a card whose width is decided by flex alone cannot also decide the height of
/// the row it sits in — see [`columns`].
pub fn pane(
    home: Home,
    snapshot: &Snapshot,
    dispatch: &Dispatch,
    available: Pixels,
    cx: &App,
) -> AnyElement {
    let width = available.min(CONTENT).max(px(360.));

    match home {
        Home::Social => social(snapshot, dispatch, width, cx),
        Home::Pictures => pictures(snapshot, dispatch, width, cx),
        Home::Videos => videos(snapshot, dispatch, width, cx),
        Home::Audios => audios(snapshot, dispatch, width, cx),
    }
}

/// How many equal cards fit across `inner`, never fewer than one.
///
/// The arithmetic is done in pixels rather than left to flex wrapping because a
/// virtualised row has to know its own height before it is drawn, and the
/// height of a 16:9 cover is a function of its width. A wrapped row would give
/// the last card a different width — and therefore a different height — from
/// the rest, which is exactly what `uniform_list` cannot hold.
fn columns(inner: Pixels, min: Pixels) -> usize {
    let inner = f32::from(inner);
    let min = f32::from(min);
    let gap = f32::from(GAP);

    (((inner + gap) / (min + gap)).floor() as usize).clamp(1, 6)
}

/// The width of one card in a row of `count`, filling `inner`.
fn card_width(inner: Pixels, count: usize) -> Pixels {
    let gaps = f32::from(GAP) * (count.saturating_sub(1)) as f32;
    (inner - px(gaps)) * (1.0 / count as f32)
}

/// The heading every feed shares.
///
/// The same row the article column uses, at the same type size. A feed is a
/// different layout, not a different kind of page: its title is a section
/// label, and giving it a display size here made the four browsed views look
/// like a separate application.
fn header(snapshot: &Snapshot, dispatch: &Dispatch, unit: &str, cx: &App) -> AnyElement {
    v_flex()
        .flex_shrink_0()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(
            h_flex()
                .w_full()
                .max_w(CONTENT)
                .mx_auto()
                .child(entry_list::heading(snapshot, dispatch, unit, PAD, cx)),
        )
        .into_any_element()
}

/// The page: header and body, in the one shape every feed has.
fn page(header: AnyElement, body: AnyElement) -> AnyElement {
    v_flex()
        .size_full()
        .min_w_0()
        .child(header)
        .child(body)
        .into_any_element()
}

/// Why a feed is empty, in terms of the view it belongs to.
fn fallback(snapshot: &Snapshot, icon: Phosphor, hint: &str, cx: &App) -> AnyElement {
    if let Some(error) = &snapshot.error {
        return entry_list::placeholder(
            PhosphorIcon::WarningCircle.regular(),
            "读不到数据",
            error,
            Some(cx.theme().danger),
            cx,
        );
    }

    entry_list::placeholder(icon, "这里还没有内容", hint, None, cx)
}

// ---------------------------------------------------------------------------
// Social
// ---------------------------------------------------------------------------

fn social(snapshot: &Snapshot, dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    let head = header(snapshot, dispatch, "条", cx);

    if snapshot.entries.is_empty() || snapshot.error.is_some() {
        return page(
            head,
            fallback(
                snapshot,
                PhosphorIcon::ChatsCircle.regular(),
                "这个视图里还没有动态，按上方的刷新抓取一次。",
                cx,
            ),
        );
    }

    // The list keeps its width and the pane takes the rest, the same bargain
    // the article columns make. Both are measured against the page rather than
    // against each other so a very wide window widens the pane, not the
    // timeline.
    let timeline = TIMELINE.min(width * 0.5).max(px(280.));

    let rows: Rc<Vec<EntryRow>> = Rc::new(snapshot.entries.clone());
    let count = rows.len();
    let selected = snapshot.open.as_ref().map(|entry| entry.id);
    let row_rows = rows.clone();
    let row_dispatch = dispatch.clone();

    let list = uniform_list("social", count, move |range, _, cx| {
        range
            .map(|index| {
                let entry = &row_rows[index];
                social_post(entry, selected == Some(entry.id), &row_dispatch, cx)
            })
            .collect()
    })
    .flex_1()
    .min_h_0();

    let body = h_flex()
        .w_full()
        .max_w(CONTENT)
        .mx_auto()
        .flex_1()
        .min_h_0()
        .child(
            v_flex()
                .w(timeline)
                .h_full()
                .flex_shrink_0()
                .min_w(px(0.))
                .border_r_1()
                .border_color(cx.theme().border)
                .child(list),
        )
        .child(
            v_flex()
                .flex_1()
                .h_full()
                .min_w(px(0.))
                .child(reading_pane::pane(snapshot, dispatch, cx)),
        );

    page(head, body.into_any_element())
}

/// One post, as the timeline draws it.
///
/// Flat rows separated by a hairline rather than cards: a timeline is a
/// continuous column, and a box around every post turns it into a stack of
/// unrelated things.
///
/// Clicking opens the post in the pane beside the timeline, which marks it
/// read. The browser is one button away in that pane, not the first thing a
/// click does: a post is something to read, and leaving the app to read one
/// line of it was the old view's whole cost.
fn social_post(entry: &EntryRow, selected: bool, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let id = entry.id;
    let read = entry.read;
    let open_dispatch = dispatch.clone();

    let handle = {
        let mut handle = String::new();

        if let Some(author) = &entry.author {
            handle.push('@');
            handle.push_str(author);
        }

        if let Some(at) = entry.published_at {
            if !handle.is_empty() {
                handle.push_str(" · ");
            }
            handle.push_str(&super::when(at));
        }

        handle
    };

    h_flex()
        .id(format!("social:{id}"))
        .w_full()
        .h(POST)
        .items_start()
        .gap_3()
        .px_4()
        .py_3()
        .border_b_1()
        .border_color(cx.theme().border.opacity(0.5))
        .cursor_pointer()
        .when(selected, |this| this.bg(cx.theme().accent))
        .when(!selected, |this| {
            this.hover(|this| this.bg(cx.theme().accent.opacity(0.06)))
        })
        .on_click(move |_, window, cx| {
            open_dispatch(Action::Worker(Command::Open(Some(id))), window, cx);
        })
        .context_menu(card_menu(entry, dispatch))
        .child(
            // The source stands where an avatar stands in a timeline: it is
            // who is speaking, and the resolved icon is the same mark the
            // source's row carries.
            picture::icon(
                entry.icon.as_deref(),
                px(36.),
                px(18.),
                PhosphorIcon::ChatsCircle.regular(),
                cx,
            ),
        )
        .child(
            v_flex()
                .flex_1()
                .min_w_0()
                .gap_1()
                .child(
                    h_flex()
                        .min_w_0()
                        .gap_1()
                        .text_sm()
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_color(cx.theme().foreground)
                                .child(entry.source_title.clone()),
                        )
                        .when(!handle.is_empty(), |this| {
                            this.child(
                                div()
                                    .min_w(px(0.))
                                    .truncate()
                                    .text_size(px(crate::theme::LABEL))
                                    .line_height(px(20.))
                                    .text_color(cx.theme().muted_foreground)
                                    .child(handle),
                            )
                        }),
                )
                .child(
                    div()
                        .min_w(px(0.))
                        .h(px(40.))
                        .text_sm()
                        .line_height(px(20.))
                        .line_clamp(2)
                        .text_color(if read {
                            cx.theme().muted_foreground
                        } else {
                            cx.theme().foreground
                        })
                        .child(entry.title.clone()),
                )
                .when_some(entry.summary.clone(), |this, summary| {
                    this.child(
                        div()
                            .min_w(px(0.))
                            .truncate()
                            .text_size(px(crate::theme::LABEL))
                            .line_height(px(18.))
                            .text_color(cx.theme().muted_foreground)
                            .child(summary),
                    )
                }),
        )
        .when_some(entry.image.clone(), |this, image| {
            this.child(
                div()
                    .w(px(64.))
                    .h(px(64.))
                    .flex_shrink_0()
                    .rounded(cx.theme().radius)
                    .overflow_hidden()
                    .bg(cx.theme().muted)
                    .child(picture::tile(image, cx.theme().radius, cx)),
            )
        })
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

fn pictures(snapshot: &Snapshot, dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    let head = header(snapshot, dispatch, "张", cx);

    if snapshot.entries.is_empty() || snapshot.error.is_some() {
        return page(
            head,
            fallback(
                snapshot,
                PhosphorIcon::Image.regular(),
                "这个视图里还没有图片，按上方的刷新抓取一次。",
                cx,
            ),
        );
    }

    let inner = width - PAD * 2.0;
    let count = columns(inner, MIN_PICTURE);
    let card = card_width(inner, count);
    let image = card * (4.0 / 3.0);
    // The cover, the 8-pixel gap, the 24-pixel title, the 4-pixel gap, the
    // 18-pixel meta line, and the row's own 8-pixel padding top and bottom.
    let row = image + px(70.);

    let rows: Rc<Vec<Vec<EntryRow>>> = Rc::new(
        snapshot
            .entries
            .chunks(count)
            .map(<[EntryRow]>::to_vec)
            .collect(),
    );
    let total = rows.len();

    let cell_rows = rows.clone();
    let cell_dispatch = dispatch.clone();

    let grid = uniform_list("pictures", total, move |range, _, cx| {
        range
            .map(|index| picture_row(&cell_rows[index], count, image, row, &cell_dispatch, cx))
            .collect()
    })
    .flex_1()
    .min_h_0();

    let mut body = v_flex().flex_1().min_h_0().relative().child(grid);

    if let Some(open) = &snapshot.open {
        body = body.child(detail(open, dispatch, width, cx));
    }

    page(head, body.into_any_element())
}

fn picture_row(
    row: &[EntryRow],
    count: usize,
    image: Pixels,
    height: Pixels,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    let mut cells = h_flex()
        .w_full()
        .max_w(CONTENT)
        .mx_auto()
        .h(height)
        .items_start()
        .gap_4()
        .px(PAD)
        .py_2();

    for column in 0..count {
        cells = match row.get(column) {
            Some(entry) => cells.child(picture_card(entry, image, dispatch, cx)),
            // A last row that is not full keeps every slot, so its cards are
            // the same width as every other card in the grid.
            None => cells.child(div().flex_1().min_w(px(0.))),
        };
    }

    cells.into_any_element()
}

fn picture_card(entry: &EntryRow, image: Pixels, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let id = entry.id;
    let open = dispatch.clone();
    let radius = cx.theme().radius_lg;

    let cover = match &entry.image {
        Some(url) => div()
            .w_full()
            .h(image)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .child(picture::tile(url.clone(), radius, cx))
            .into_any_element(),
        None => div()
            .w_full()
            .h(image)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap_2()
            .child(
                Icon::new(PhosphorIcon::ImageBroken.regular())
                    .size_5()
                    .text_color(cx.theme().muted_foreground),
            )
            .child(
                div()
                    .text_size(px(crate::theme::LABEL))
                    .text_color(cx.theme().muted_foreground)
                    .child("没有图片"),
            )
            .into_any_element(),
    };

    v_flex()
        .id(format!("picture:{id}"))
        .flex_1()
        .min_w(px(0.))
        .gap_2()
        .cursor_pointer()
        .on_click(move |_, window, cx| {
            open(Action::Worker(Command::Open(Some(id))), window, cx);
        })
        .context_menu(card_menu(entry, dispatch))
        .child(cover)
        .child(cover_text(entry, cx))
        .into_any_element()
}

/// The picture view's detail: the image on the left, what it is about on the
/// right.
///
/// An overlay rather than a third column because the picture wants the height
/// of the window and the caption wants a fixed measure beside it. Clicking the
/// scrim closes it, which is the same gesture that closes every lightbox the
/// reader has used before this one.
fn detail(entry: &EntryDetail, dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    let scrim_close = dispatch.clone();
    let close = dispatch.clone();
    let id = entry.id;

    let parsed = content::parse(entry.body_html());
    let image = entry.image.clone().or_else(|| {
        parsed.blocks.iter().find_map(|block| match block {
            Block::Image(raw) => content::image_url(entry.url.as_deref(), raw),
            _ => None,
        })
    });

    let prose_blocks: Vec<Block> = parsed
        .blocks
        .iter()
        .filter(|block| !matches!(block, Block::Image(_)))
        .cloned()
        .collect();
    let prose = content::plain_text(&prose_blocks);

    let waiting = match &entry.preview {
        Body::Reading => Some("正在读取详情…"),
        Body::Failed => Some("详情没能读到，下次打开再试"),
        _ => None,
    };

    let stage = match image {
        Some(url) => div()
            .flex_1()
            .min_w(px(0.))
            .h_full()
            .bg(cx.theme().muted)
            .child(
                gpui_kit::img(url)
                    .size_full()
                    .object_fit(ObjectFit::Contain),
            )
            .into_any_element(),
        None => div()
            .flex_1()
            .min_w(px(0.))
            .h_full()
            .bg(cx.theme().muted)
            .flex()
            .items_center()
            .justify_center()
            .child(
                Icon::new(PhosphorIcon::ImageBroken.regular())
                    .size_6()
                    .text_color(cx.theme().muted_foreground),
            )
            .into_any_element(),
    };

    let mut actions = h_flex().flex_shrink_0().flex_wrap().gap_2();

    let star = dispatch.clone();
    let starred = entry.starred;
    actions = actions.child(
        Button::new("detail-star")
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
            .label(if starred { "取消收藏" } else { "收藏" })
            .on_click(move |_, window, cx| {
                star(
                    Action::Worker(Command::SetStarred {
                        entry_id: id,
                        starred: !starred,
                    }),
                    window,
                    cx,
                );
            }),
    );

    let file = dispatch.clone();
    actions = actions.child(
        Button::new("detail-file")
            .ghost()
            .xsmall()
            .icon(Icon::new(PhosphorIcon::ListPlus.regular()))
            .label("加入列表")
            .on_click(move |_, window, cx| file(Action::AddToList(id), window, cx)),
    );

    if let Some(url) = entry.url.clone() {
        actions = actions.child(
            Button::new("detail-open")
                .ghost()
                .xsmall()
                .icon(Icon::new(PhosphorIcon::ArrowSquareOut.regular()))
                .label("在浏览器打开")
                .on_click(move |_, _, _| {
                    let _ = crate::open::url(&url);
                }),
        );
    }

    // The card is bounded by the page it floats over. A fixed width would run
    // off a narrow window; a fixed height would overflow a short one.
    let card_width = width.min(px(1040.));

    div()
        .id("picture-detail")
        .absolute()
        .top_0()
        .left_0()
        .size_full()
        .bg(crate::theme::scrim().opacity(0.7))
        .flex()
        .items_center()
        .justify_center()
        .p_6()
        .on_click(move |_, window, cx| {
            scrim_close(Action::Worker(Command::Open(None)), window, cx);
        })
        .child(
            h_flex()
                .id("picture-detail-card")
                .w_full()
                .max_w(card_width)
                .h_full()
                .max_h(px(640.))
                .rounded_lg()
                .overflow_hidden()
                .bg(cx.theme().background)
                .border_1()
                .border_color(cx.theme().border)
                .on_click(|_, _, cx| cx.stop_propagation())
                .child(stage)
                .child(
                    v_flex()
                        .w(px(380.))
                        .h_full()
                        .flex_shrink_0()
                        .min_w(px(0.))
                        .gap_3()
                        .p_5()
                        .border_l_1()
                        .border_color(cx.theme().border)
                        .child(
                            h_flex()
                                .items_start()
                                .gap_2()
                                .child(
                                    div()
                                        .flex_1()
                                        .min_w(px(0.))
                                        .text_size(px(crate::theme::LABEL))
                                        .line_height(px(18.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(byline_detail(entry)),
                                )
                                .child(
                                    Button::new("close-detail")
                                        .ghost()
                                        .xsmall()
                                        .icon(Icon::new(PhosphorIcon::X.regular()))
                                        .tooltip("关闭")
                                        .on_click(move |_, window, cx| {
                                            close(Action::Worker(Command::Open(None)), window, cx);
                                        }),
                                ),
                        )
                        .child(
                            div()
                                .min_w(px(0.))
                                .text_xl()
                                .line_height(px(26.))
                                .font_weight(FontWeight(450.))
                                .text_color(cx.theme().foreground)
                                .child(entry.title.clone()),
                        )
                        .child(
                            div()
                                .id("detail-body")
                                .flex_1()
                                .min_h_0()
                                .overflow_y_scroll()
                                .text_sm()
                                .line_height(px(24.))
                                .text_color(cx.theme().foreground)
                                .when_some(waiting, |this, message| {
                                    this.child(
                                        div()
                                            .pb_2()
                                            .text_size(px(crate::theme::LABEL))
                                            .text_color(cx.theme().muted_foreground)
                                            .child(message),
                                    )
                                })
                                .when(prose.is_empty(), |this| {
                                    this.child(
                                        div()
                                            .text_color(cx.theme().muted_foreground)
                                            .child("这条没有正文"),
                                    )
                                })
                                .when(!prose.is_empty(), |this| this.child(prose)),
                        )
                        .child(actions),
                ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Videos
// ---------------------------------------------------------------------------

fn videos(snapshot: &Snapshot, dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    let head = header(snapshot, dispatch, "个", cx);

    if snapshot.entries.is_empty() || snapshot.error.is_some() {
        return page(
            head,
            fallback(
                snapshot,
                PhosphorIcon::VideoCamera.regular(),
                "这个视图里还没有视频，按上方的刷新抓取一次。",
                cx,
            ),
        );
    }

    let inner = width - PAD * 2.0;
    let count = columns(inner, MIN_VIDEO);
    let card = card_width(inner, count);
    let cover = card * (9.0 / 16.0);
    // The cover, the 8-pixel gap, the 24-pixel title, the 4-pixel gap, the
    // 18-pixel meta line, and the row's own 8-pixel padding top and bottom.
    let row = cover + px(70.);

    let rows: Rc<Vec<Vec<EntryRow>>> = Rc::new(
        snapshot
            .entries
            .chunks(count)
            .map(<[EntryRow]>::to_vec)
            .collect(),
    );
    let total = rows.len();

    let cell_rows = rows.clone();
    let cell_dispatch = dispatch.clone();

    let list = uniform_list("videos", total, move |range, _, cx| {
        range
            .map(|index| video_row(&cell_rows[index], count, cover, row, &cell_dispatch, cx))
            .collect()
    })
    .flex_1()
    .min_h_0();

    page(head, list.into_any_element())
}

fn video_row(
    row: &[EntryRow],
    count: usize,
    cover: Pixels,
    height: Pixels,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    let mut cells = h_flex()
        .w_full()
        .max_w(CONTENT)
        .mx_auto()
        .h(height)
        .items_start()
        .gap_4()
        .px(PAD)
        .py_2();

    for column in 0..count {
        cells = match row.get(column) {
            Some(entry) => cells.child(video_card(entry, cover, dispatch, cx)),
            None => cells.child(div().flex_1().min_w(px(0.))),
        };
    }

    cells.into_any_element()
}

/// One video, as a Bilibili-style card: a wide cover, a one-line title, and who
/// it is from.
fn video_card(entry: &EntryRow, cover: Pixels, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let id = entry.id;
    let url = entry.url.clone();
    let read = entry.read;
    let visit_dispatch = dispatch.clone();
    let radius = cx.theme().radius_lg;

    let media = match &entry.image {
        Some(image) => div()
            .w_full()
            .h(cover)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .child(picture::tile(image.clone(), radius, cx))
            .into_any_element(),
        None => div()
            .w_full()
            .h(cover)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .flex()
            .items_center()
            .justify_center()
            .child(
                Icon::new(PhosphorIcon::VideoCamera.regular())
                    .size_5()
                    .text_color(cx.theme().muted_foreground),
            )
            .into_any_element(),
    };

    v_flex()
        .id(format!("video:{id}"))
        .flex_1()
        .min_w(px(0.))
        .gap_2()
        .when(url.is_some(), |this| {
            this.cursor_pointer().on_click(move |_, window, cx| {
                visit(id, url.clone(), read, &visit_dispatch, window, cx);
            })
        })
        .context_menu(card_menu(entry, dispatch))
        .child(media)
        .child(cover_text(entry, cx))
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Audios
// ---------------------------------------------------------------------------

fn audios(snapshot: &Snapshot, dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    let head = header(snapshot, dispatch, "集", cx);

    if snapshot.entries.is_empty() || snapshot.error.is_some() {
        return page(
            head,
            fallback(
                snapshot,
                PhosphorIcon::MusicNotes.regular(),
                "这个视图里还没有节目，按上方的刷新抓取一次。",
                cx,
            ),
        );
    }

    // A show strip only makes sense when the page is the view: inside one show,
    // the sidebar row above already says which one it is.
    let shows = match snapshot.selection {
        Selection::Source(_) => Vec::new(),
        _ => shows(snapshot),
    };

    let mut body = v_flex().flex_1().min_h_0();

    if !shows.is_empty() {
        body = body.child(show_strip(&shows, dispatch, width, cx));
    }

    body = body.child(episodes(snapshot, dispatch, width));

    page(head, body.into_any_element())
}

/// One source represented on the audio home.
struct Show {
    id: u64,
    title: String,
    cover: Option<String>,
    unread: usize,
}

/// The shows that have something in the list, in sidebar order.
fn shows(snapshot: &Snapshot) -> Vec<Show> {
    let present: HashSet<u64> = snapshot
        .entries
        .iter()
        .map(|entry| entry.source_id)
        .collect();

    snapshot
        .sources
        .iter()
        .filter(|source| source.view == View::Audios && present.contains(&source.id))
        .map(|source| Show {
            id: source.id,
            title: source.title.clone(),
            // The show's art is the first cover it published. A separate
            // channel image is not something the entry model carries; using a
            // real episode's cover is at least a picture the show chose.
            cover: snapshot
                .entries
                .iter()
                .find(|entry| entry.source_id == source.id && entry.image.is_some())
                .and_then(|entry| entry.image.clone()),
            unread: source.unread,
        })
        .collect()
}

fn show_strip(shows: &[Show], dispatch: &Dispatch, width: Pixels, cx: &App) -> AnyElement {
    v_flex()
        .flex_shrink_0()
        .w_full()
        .max_w(width)
        .mx_auto()
        .gap_3()
        .px(PAD)
        .pt_5()
        .pb_3()
        .child(
            div()
                .text_size(px(crate::theme::LABEL))
                .line_height(px(18.))
                .text_color(cx.theme().muted_foreground)
                .child("节目"),
        )
        .child(
            h_flex()
                .w_full()
                .items_start()
                .gap_4()
                .flex_wrap()
                .children(shows.iter().map(|show| show_card(show, dispatch, cx))),
        )
        .into_any_element()
}

fn show_card(show: &Show, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let select = dispatch.clone();
    let id = show.id;
    let radius = cx.theme().radius_lg;

    let cover = match &show.cover {
        Some(url) => div()
            .w_full()
            .h(MIN_SHOW)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .child(picture::tile(url.clone(), radius, cx))
            .into_any_element(),
        None => div()
            .w_full()
            .h(MIN_SHOW)
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .flex()
            .items_center()
            .justify_center()
            .child(
                Icon::new(PhosphorIcon::MusicNotes.regular())
                    .size_5()
                    .text_color(cx.theme().muted_foreground),
            )
            .into_any_element(),
    };

    v_flex()
        .id(format!("show:{id}"))
        .w(MIN_SHOW)
        .flex_shrink_0()
        .gap_2()
        .cursor_pointer()
        .on_click(move |_, window, cx| {
            select(
                Action::Worker(Command::Select(Selection::Source(id))),
                window,
                cx,
            );
        })
        .child(cover)
        .child(
            v_flex()
                .min_w(px(0.))
                .gap_1()
                .child(
                    div()
                        .min_w(px(0.))
                        .truncate()
                        .text_base()
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(cx.theme().foreground)
                        .child(show.title.clone()),
                )
                .child(
                    div()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child(if show.unread == 0 {
                            String::new()
                        } else {
                            format!("{} 集未听", show.unread)
                        }),
                ),
        )
        .into_any_element()
}

fn episodes(snapshot: &Snapshot, dispatch: &Dispatch, width: Pixels) -> AnyElement {
    let rows: Rc<Vec<EntryRow>> = Rc::new(snapshot.entries.clone());
    let total = rows.len();
    let row_rows = rows.clone();
    let row_dispatch = dispatch.clone();

    uniform_list("episodes", total, move |range, _, cx| {
        range
            .map(|index| episode_row(&row_rows[index], width, &row_dispatch, cx))
            .collect()
    })
    .flex_1()
    .min_h_0()
    .into_any_element()
}

/// One episode, the way a podcast app lists the latest: square art, the title,
/// and the show and date underneath.
fn episode_row(entry: &EntryRow, width: Pixels, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let id = entry.id;
    let url = entry.url.clone();
    let has_url = url.is_some();
    let read = entry.read;
    let visit_dispatch = dispatch.clone();

    let radius = cx.theme().radius;
    let art = match &entry.image {
        Some(image) => div()
            .w(px(52.))
            .h(px(52.))
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .child(picture::tile(image.clone(), radius, cx))
            .into_any_element(),
        None => div()
            .w(px(52.))
            .h(px(52.))
            .flex_shrink_0()
            .rounded(radius)
            .overflow_hidden()
            .bg(cx.theme().muted)
            .flex()
            .items_center()
            .justify_center()
            .child(
                Icon::new(PhosphorIcon::MusicNotes.regular())
                    .size_4()
                    .text_color(cx.theme().muted_foreground),
            )
            .into_any_element(),
    };

    h_flex()
        .id(format!("episode:{id}"))
        .w_full()
        .max_w(width)
        .mx_auto()
        .h(px(76.))
        .items_center()
        .gap_3()
        .px(PAD)
        .border_b_1()
        .border_color(cx.theme().border.opacity(0.5))
        .when(has_url, |this| {
            this.cursor_pointer()
                .hover(|this| this.bg(cx.theme().accent.opacity(0.06)))
                .on_click(move |_, window, cx| {
                    visit(id, url.clone(), read, &visit_dispatch, window, cx);
                })
        })
        .context_menu(card_menu(entry, dispatch))
        .child(art)
        .child(
            v_flex()
                .flex_1()
                .min_w(px(0.))
                .gap_1()
                .child(
                    div()
                        .min_w(px(0.))
                        .truncate()
                        .text_base()
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(if read {
                            cx.theme().muted_foreground
                        } else {
                            cx.theme().foreground
                        })
                        .child(entry.title.clone()),
                )
                .child(
                    div()
                        .min_w(px(0.))
                        .truncate()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child(byline(entry)),
                ),
        )
        .when(has_url, |this| {
            this.child(
                Icon::new(PhosphorIcon::ArrowSquareOut.regular())
                    .size_3()
                    .flex_shrink_0()
                    .text_color(cx.theme().muted_foreground),
            )
        })
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Shared card behaviour
// ---------------------------------------------------------------------------

/// Hand an entry to the browser, and mark it read.
///
/// The three feeds that do this have no reading pane, so this is what opening
/// means there. It is deliberately one function: the mark-read rule is the same
/// one the reading pane follows — opening is reading — and two copies of it
/// would eventually disagree about whether a failed browser launch counts.
fn visit(
    entry_id: u64,
    url: Option<String>,
    read: bool,
    dispatch: &Dispatch,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(url) = url else {
        return;
    };

    // Failure is not worth a dialog: the user clicked a link and their browser
    // did not open, which they can see.
    let _ = crate::open::url(&url);

    if !read {
        dispatch(
            Action::Worker(Command::SetRead {
                entry_id,
                read: true,
            }),
            window,
            cx,
        );
    }
}

/// The right-click menu every feed card carries.
///
/// Hover is not an affordance a keyboard or a screen reader has, and the three
/// feeds have no reading pane to hold the actions the article list puts on its
/// toolbar. The menu is what keeps starring, marking and filing reachable
/// without drawing a strip of icons over every cover.
fn card_menu(
    entry: &EntryRow,
    dispatch: &Dispatch,
) -> impl Fn(PopupMenu, &mut Window, &mut Context<PopupMenu>) -> PopupMenu + 'static {
    let star = dispatch.clone();
    let mark = dispatch.clone();
    let file = dispatch.clone();

    let id = entry.id;
    let starred = entry.starred;
    let read = entry.read;

    move |menu, _, _| {
        let do_star = star.clone();
        let do_mark = mark.clone();
        let do_file = file.clone();

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
            PopupMenuItem::new("加入列表")
                .icon(PhosphorIcon::ListPlus.regular())
                .on_click(move |_, window, cx| {
                    do_file(Action::AddToList(id), window, cx);
                }),
        )
    }
}

/// The text under a cover: the title, then where it came from.
///
/// One line each, and two clearly different roles rather than two 14-pixel
/// regulars a shade apart. The title is Vercel's `heading-16` — 16 over 24 at
/// the heading weight — and the byline is `label` at 13 over 18 in
/// `text-secondary`. That is the whole hierarchy a cover card needs: what it
/// is, and who published it. A second title line was the alternative, and it
/// made every row a different height for one extra clause of a sentence that
/// the page it opens already says in full.
fn cover_text(entry: &EntryRow, cx: &App) -> AnyElement {
    v_flex()
        .min_w(px(0.))
        .gap_1()
        .child(
            div()
                .min_w(px(0.))
                .truncate()
                .text_base()
                .line_height(px(24.))
                .font_weight(FontWeight(450.))
                .text_color(if entry.read {
                    cx.theme().muted_foreground
                } else {
                    cx.theme().foreground
                })
                .child(entry.title.clone()),
        )
        .child(
            div()
                .min_w(px(0.))
                .truncate()
                .text_size(px(crate::theme::LABEL))
                .line_height(px(18.))
                .text_color(cx.theme().muted_foreground)
                .child(byline(entry)),
        )
        .into_any_element()
}

/// Source, author and time, as one line.
fn byline(entry: &EntryRow) -> String {
    let mut parts = Vec::with_capacity(3);

    if !entry.source_title.is_empty() {
        parts.push(entry.source_title.clone());
    }

    if let Some(author) = &entry.author {
        parts.push(author.clone());
    }

    if let Some(at) = entry.published_at {
        parts.push(super::when(at));
    }

    parts.join(" · ")
}

/// The same line for an entry that is already open.
fn byline_detail(entry: &EntryDetail) -> String {
    let mut parts = Vec::with_capacity(3);

    if !entry.source_title.is_empty() {
        parts.push(entry.source_title.clone());
    }

    if let Some(author) = &entry.author {
        parts.push(author.clone());
    }

    if let Some(at) = entry.published_at {
        parts.push(super::when(at));
    }

    parts.join(" · ")
}
