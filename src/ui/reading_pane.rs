//! The right column: the entry being read.
//!
//! A plugin hands the host whatever it found, which for most feeds is a chunk
//! of HTML. Rome does not run an engine — a web view inside the reading pane
//! would be a second renderer, a second security surface, and a second set of
//! fonts — so the markup is reduced to blocks of text and drawn with the app's
//! own type. That loses the styling of the original page and keeps the thing
//! the reader came for: the words, at a width and size they can read.
//!
//! The parsing lives in [`super::content`] because it is the part worth
//! testing; this file is the mapping from those blocks to GPUI elements.

use std::cell::RefCell;
use std::ops::Range;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::text::TextView;
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorIcon;

use crate::snapshot::{Body, EntryDetail, Snapshot};
use crate::worker::Command;

use super::content::{self, Link, Parsed};
use super::{Action, Dispatch, entry_list::placeholder, picture};

// Re-exported for the tests that exercise the parser through the pane's old
// path. The parser itself is `content`'s, and new code should use it directly.
pub use super::content::{Block, blocks};

/// How wide the text is allowed to get, in logical pixels.
///
/// A measure, not the pane's width. Text that runs the whole width of a wide
/// window is unreadable — the eye loses the line on the way back — and the
/// reading pane is the one column that grows with the window, so it is the one
/// that has to say where it stops. Roughly forty-five characters of Chinese at
/// `text_sm`, which is the upper end of what stays comfortable.
///
/// Named because the toolbar is laid out against the same number: the buttons
/// act on the text, so they belong on its spine rather than the window's edge.
const MEASURE: Pixels = px(680.);

thread_local! {
    /// Where the article column is scrolled to, kept across frames.
    ///
    /// It has to live outside the element tree: a [`ScrollHandle`] is the
    /// scroll state itself, so one built fresh in each `render` would report
    /// the top of the article every frame and the column could never move.
    static READING_SCROLL: RefCell<Option<ScrollHandle>> = const { RefCell::new(None) };
}

fn reading_scroll() -> ScrollHandle {
    READING_SCROLL.with(|slot| {
        slot.borrow_mut()
            .get_or_insert_with(ScrollHandle::new)
            .clone()
    })
}

/// How many blocks past the viewport are drawn with their pictures loaded.
///
/// Half a screen of slack, so a picture is fetched while it is still below the
/// fold rather than at the moment it crosses it.
const LOOKAHEAD: usize = 6;

/// How many blocks at the top of an article are drawn with their pictures
/// before the column has told us where it is scrolled to.
const EAGER: usize = 8;

/// The blocks whose pictures should be fetched this frame.
///
/// GPUI starts an image's request in `request_layout`, and layout runs for
/// every element whether or not it is on screen — a scrollbar does not remove
/// anything from the tree. So an article with forty pictures in it starts forty
/// requests the moment it opens, which is the one place in the app where a
/// fetch is not already limited to what the reader can see: the two lists are
/// virtualized, and this column is not.
///
/// Not drawing an image is therefore the only way to defer it, and the block
/// keeps its place as a placeholder until a later frame draws it for real.
/// Every scroll is a repaint, so a picture below the fold is always drawn by
/// the frame in which it comes into view.
fn visible(scroll: &ScrollHandle, blocks: usize) -> Range<usize> {
    let measured =
        blocks > 0 && scroll.children_count() == blocks && scroll.bounds().size.height > px(0.);

    // The counts disagree before the column has been laid out once, and after
    // it has been handed a different entry with a different number of blocks.
    // What was recorded then describes a column that no longer exists, so the
    // first screenful is drawn instead of trusting it.
    if !measured {
        return 0..EAGER.min(blocks);
    }

    let top = scroll.top_item().saturating_sub(LOOKAHEAD);
    let bottom = (scroll.bottom_item() + LOOKAHEAD).min(blocks - 1);
    top..bottom + 1
}

/// Build the reading pane.
pub fn pane(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let Some(entry) = &snapshot.open else {
        // A broken source is the likeliest reason a reader is looking at an
        // empty pane, so the failure is said here rather than only on a
        // sidebar row too narrow for it.
        let broken = snapshot
            .sources
            .iter()
            .find(|source| source.error.is_some() && source.id == selected_source(snapshot));

        if let Some(error) = broken.and_then(|source| source.error.clone()) {
            return placeholder(
                PhosphorIcon::WarningCircle.regular(),
                "这个信息源抓取失败了",
                &error,
                Some(cx.theme().danger),
                cx,
            );
        }

        return placeholder(
            PhosphorIcon::BookOpen.regular(),
            "没有打开的条目",
            "从列表里选一条，内容会显示在这里",
            None,
            cx,
        );
    };

    // Parsed once, so the toolbar's copy action and the body are looking at
    // exactly the same text.
    let parsed = without_repeated_title(content::parse(entry.body_html()), &entry.title);

    v_flex()
        .size_full()
        .min_w_0()
        .when(snapshot.busy && snapshot.busy_with.is_some(), |this| {
            this.child(busy_bar(snapshot, cx))
        })
        .child(toolbar(entry, &parsed, dispatch, cx))
        .child(body(entry, &parsed, cx))
        .into_any_element()
}

/// The source the middle column is showing, when it is showing one.
fn selected_source(snapshot: &Snapshot) -> u64 {
    match snapshot.selection {
        crate::snapshot::Selection::Source(id) => id,
        _ => 0,
    }
}

/// The parsed body, without an opening heading that is only the title again.
///
/// A page's article very nearly always opens with its own `<h1>`, which says
/// what the title above it already says. Dropping it here rather than in the
/// extractor is deliberate: the page is right to have it, and the repetition is
/// a fact about this drawing, which puts the title on screen once already.
fn without_repeated_title(mut parsed: Parsed, title: &str) -> Parsed {
    let repeats = matches!(
        parsed.blocks.first(),
        Some(Block::Heading(text)) if same_words(text, title)
    );

    if repeats {
        parsed.blocks.remove(0);
    }

    parsed
}

/// Whether two strings are the same text, ignoring case and how it is spaced.
///
/// A heading is one run of prose that a page may have broken across lines, and
/// case is not a difference a reader would recognise.
fn same_words(a: &str, b: &str) -> bool {
    let normalise = |text: &str| {
        text.split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_lowercase()
    };

    normalise(a) == normalise(b)
}

/// A line that says work is happening, so a refresh does not look like a hang.
fn busy_bar(snapshot: &Snapshot, cx: &App) -> AnyElement {
    h_flex()
        .h(px(24.))
        .flex_shrink_0()
        .items_center()
        .gap_1p5()
        .px_3()
        .bg(cx.theme().accent.opacity(0.12))
        .child(
            gpui_kit::component::spinner::Spinner::new()
                .xsmall()
                .color(cx.theme().accent),
        )
        .child(
            div()
                .text_xs()
                .truncate()
                .text_color(cx.theme().foreground)
                .child(snapshot.busy_with.clone().unwrap_or_default()),
        )
        .into_any_element()
}

/// Copy, star, open in the browser, and a way back to the list.
fn toolbar(entry: &EntryDetail, parsed: &Parsed, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let star = dispatch.clone();
    let star_id = entry.id;
    let starred = entry.starred;

    let mut actions = h_flex().gap_1().flex_shrink_0();

    // Copying is the answer to the fact that the body is drawn as a stack of
    // plain text elements rather than one selectable document: GPUI exposes
    // selection through its rich-text view, and handing the article back
    // through that parser would undo the reason the stripper exists. The
    // button gives the user the whole text without asking them to drag across
    // a dozen blocks.
    let copy_text = copy_text(entry, parsed);
    actions = actions.child(
        Button::new("copy-body")
            .ghost()
            .xsmall()
            .icon(Icon::new(PhosphorIcon::Copy.regular()))
            .label("复制正文")
            .on_click(move |_, _, cx: &mut App| {
                cx.write_to_clipboard(ClipboardItem::new_string(copy_text.clone()));
            }),
    );

    actions = actions.child(
        Button::new("star")
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
            .on_click(move |_, window, cx| {
                star(
                    Action::Worker(Command::SetStarred {
                        entry_id: star_id,
                        starred: !starred,
                    }),
                    window,
                    cx,
                );
            }),
    );

    // Filing is offered here as well as on the row because this is where a
    // reader decides something is worth keeping: they have just read it. The
    // row's button is for the one they can already tell from the headline.
    let file = dispatch.clone();
    let file_id = entry.id;
    actions = actions.child(
        Button::new("file-into-list")
            .ghost()
            .xsmall()
            .icon(Icon::new(PhosphorIcon::ListPlus.regular()))
            .label("加入列表")
            .on_click(move |_, window, cx| file(Action::AddToList(file_id), window, cx)),
    );

    if let Some(url) = entry.url.clone() {
        actions = actions.child(
            Button::new("open-external")
                .ghost()
                .xsmall()
                .icon(Icon::new(PhosphorIcon::ArrowSquareOut.regular()))
                .tooltip("在浏览器中打开")
                .on_click(move |_, _, _| {
                    // Failure is not worth a dialog: the user clicked a link
                    // and their browser did not open, which they can see.
                    let _ = crate::open::url(&url);
                }),
        );
    }

    // The rule spans the pane but the buttons do not. A hairline that stopped
    // at the measure would look like a mistake, while buttons pinned to the
    // pane's own edge line up with the article only at the one window width
    // where the two happen to coincide — on a large display they end up half a
    // screen away from the words they act on.
    h_flex()
        .h(px(36.))
        .flex_shrink_0()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(
            h_flex()
                .w_full()
                .max_w(MEASURE)
                .mx_auto()
                .items_center()
                .justify_end()
                .gap_1()
                // The same inset as the body's, so the last button ends where
                // the last character of a line ends.
                .px_6()
                .child(actions),
        )
        .into_any_element()
}

/// The entry itself, as a scrolling column of text.
fn body(entry: &EntryDetail, parsed: &Parsed, cx: &App) -> AnyElement {
    let mut meta = entry.source_title.clone();
    if let Some(author) = &entry.author {
        if !meta.is_empty() {
            meta.push_str(" · ");
        }
        meta.push_str(author);
    }
    if let Some(at) = entry.published_at {
        if !meta.is_empty() {
            meta.push_str(" · ");
        }
        meta.push_str(&super::when(at));
    }

    let base = entry.url.as_deref();
    let hero = entry
        .image
        .as_deref()
        .and_then(|raw| content::image_url(base, raw));
    let links = content::usable_links(&parsed.links, base);

    // Built as a list rather than by chaining `.child` so that a block knows its
    // own index while it is drawn: whether a picture is fetched depends on
    // where its block sits, and a chain does not say. `pictures` holds the
    // images that were drawn as a placeholder and still need their element.
    let mut column: Vec<AnyElement> = Vec::new();
    let mut pictures: Vec<(usize, String, Pixels)> = Vec::new();

    column.push(title(entry, cx));

    if !meta.is_empty() {
        column.push(
            div()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(meta)
                .into_any_element(),
        );
    }

    // The hero sits under the title rather than above it: a feed image that
    // takes a moment to load must not push the headline down.
    //
    // Always fetched, because it is the entry's face and the top of the column
    // is the one place that is certainly on screen. It is the article's own
    // images that are worth deferring.
    if let Some(url) = hero.clone() {
        column.push(picture::hero(url, cx));
    }

    // What the plugin is doing about the entry's own page, when it is doing
    // something. Without this an entry whose plugin is drawing a page is one
    // line of metadata and looks like a story that turned out to be a sentence
    // long, and a page that could not be drawn looks like a page that had
    // nothing in it.
    let waiting = match &entry.preview {
        Body::Reading => Some("正在读取详情…"),
        Body::Failed => Some("详情没能读到，下次打开再试"),
        _ => None,
    };

    if let Some(message) = waiting {
        column.push(
            div()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(message)
                .into_any_element(),
        );
    }

    if parsed.blocks.is_empty() {
        // Not while a page is being read or after one failed: the line above
        // has already said why the pane is empty, and "no body" underneath it
        // would contradict what it just said.
        if waiting.is_none() {
            column.push(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child("这条没有正文")
                    .into_any_element(),
            );
        }
    } else {
        for block in &parsed.blocks {
            let slot = column.len();
            if let Some(element) = draw(block, base, hero.as_deref(), slot, &mut pictures, cx) {
                column.push(element);
            }
        }
    }

    if !links.is_empty() {
        column.push(link_section(&links, cx));
    }

    let scroll = reading_scroll();
    let band = visible(&scroll, column.len());
    for (slot, url, cap) in pictures {
        if band.contains(&slot) {
            column[slot] = picture::picture(url, cap, cx);
        }
    }

    // The scrolling element is the column itself, not a full-width box around
    // it. GPUI records the bounds of a tracked element's direct children and
    // nothing deeper, so a wrapper would leave the article as one tall child
    // and the handle unable to say which block is on screen.
    v_flex()
        .id("reading")
        .flex_1()
        .min_h_0()
        .overflow_y_scroll()
        .track_scroll(&scroll)
        // Capped and centred in whatever space is left; see [`MEASURE`].
        .w_full()
        .max_w(MEASURE)
        .mx_auto()
        .gap_3()
        .px_6()
        .py_5()
        .children(column)
        .into_any_element()
}

/// The headline, selectable.
///
/// GPUI exposes text selection through its rich-text `TextView`, which parses
/// Markdown; the title is plain text, so it is escaped first. The body stays
/// outside that view on purpose — running the whole article through a Markdown
/// parser would be a second interpretation of content that the stripper has
/// already interpreted, and it would take the block layout back from this
/// module. "复制正文" is the body's copy path.
fn title(entry: &EntryDetail, cx: &App) -> AnyElement {
    // One stable id, not one per entry: GPUI keeps a text view's state for the
    // window's lifetime, and a state per entry read would pile up a parsed
    // document and a background task for every headline the user ever opened.
    // The element hands its text to the state each frame, so the same view
    // shows whichever entry is open now.
    TextView::markdown("reading-title", content::escape_markdown(&entry.title))
        .selectable(true)
        .w_full()
        .text_xl()
        .line_height(px(30.))
        .text_color(cx.theme().foreground)
        .into_any_element()
}

/// Draw one block, or `None` when it is an image that cannot or should not be
/// drawn.
///
/// `slot` is the index the block will take in the column, and `pictures` takes
/// the images that came back as a placeholder; `body` replaces the ones that
/// are close enough to the viewport to be fetched.
fn draw(
    block: &Block,
    base: Option<&str>,
    hero: Option<&str>,
    slot: usize,
    pictures: &mut Vec<(usize, String, Pixels)>,
    cx: &App,
) -> Option<AnyElement> {
    Some(match block {
        Block::Paragraph(text) => paragraph(text, cx).into_any_element(),
        Block::Heading(text) => div()
            .text_lg()
            .line_height(px(26.))
            .mt_1()
            .text_color(cx.theme().foreground)
            .child(text.clone())
            .into_any_element(),
        Block::Bullet(text) => h_flex()
            .gap_2()
            .items_start()
            .child(
                div()
                    .flex_shrink_0()
                    .text_sm()
                    .line_height(px(24.))
                    .text_color(cx.theme().muted_foreground)
                    .child("•"),
            )
            .child(paragraph(text, cx))
            .into_any_element(),
        Block::Quote(text) => div()
            .border_l_2()
            .border_color(cx.theme().border)
            .pl_3()
            .text_color(cx.theme().muted_foreground)
            .child(paragraph(text, cx))
            .into_any_element(),
        // Monospace and a surface of its own, because code read as prose is
        // code with its indentation and alignment lying to the reader. The
        // newlines survived `clean_code`, and the text system honours them.
        Block::Code(text) => div()
            .w_full()
            .p_3()
            .rounded_md()
            .bg(cx.theme().muted)
            .font_family(cx.theme().mono_font_family.clone())
            .text_xs()
            .line_height(px(20.))
            .text_color(cx.theme().foreground)
            .child(text.clone())
            .into_any_element(),
        Block::Image(raw) => {
            let url = content::image_url(base, raw)?;

            // The content usually repeats the hero as its opening image.
            // Comparing the resolved URLs is the only non-guessing way to
            // tell; a re-encoded copy at another size will show twice, which
            // is visible but harmless, where a positional guess could drop a
            // different picture the author meant to show.
            if hero == Some(url.as_str()) {
                return None;
            }

            let cap = px(480.);
            pictures.push((slot, url, cap));
            picture::placeholder(cap, cx)
        }
        Block::Divider => div()
            .w_full()
            .h(px(1.))
            .my_1()
            .bg(cx.theme().border)
            .into_any_element(),
    })
}

fn paragraph(text: &str, cx: &App) -> Div {
    div()
        .text_sm()
        .line_height(px(24.))
        .text_color(cx.theme().foreground)
        .child(text.to_owned())
}

/// The compact list of what the article linked to.
///
/// This is the deliberate low-cost answer to inline links. Styling an anchor
/// inside a paragraph is easy; making it clickable by span is not, because a
/// plain GPUI text element has no per-span hit boxes. Rendering one clickable
/// line per link below the prose keeps the prose flowing, keeps every
/// destination reachable, and does not turn the article into a column of
/// underlined fragments.
fn link_section(links: &[Link], cx: &App) -> AnyElement {
    /// Beyond this the list stops being a summary and becomes a second page.
    const SHOWN: usize = 20;

    let mut section = v_flex()
        .w_full()
        .gap_0p5()
        .mt_3()
        .pt_3()
        .border_t_1()
        .border_color(cx.theme().border)
        .child(
            div()
                .text_xs()
                .pb_1()
                .text_color(cx.theme().muted_foreground)
                .child("链接"),
        );

    section = section.children(
        links
            .iter()
            .take(SHOWN)
            .enumerate()
            .map(|(index, link)| link_row(link, index, cx)),
    );

    if links.len() > SHOWN {
        section = section.child(
            div()
                .pt_1()
                .text_xs()
                .text_color(cx.theme().muted_foreground)
                .child(format!("还有 {} 个链接", links.len() - SHOWN)),
        );
    }

    section.into_any_element()
}

fn link_row(link: &Link, index: usize, cx: &App) -> AnyElement {
    let url = link.url.clone();
    let label = if link.text.is_empty() {
        link.url.clone()
    } else {
        link.text.clone()
    };
    let show_url = !link.text.is_empty();

    h_flex()
        // A click handler needs an element identity in GPUI, and the index is
        // the one name that is guaranteed short and unique in this list.
        .id(format!("reading-link:{index}"))
        .w_full()
        .gap_2()
        .items_start()
        .px_1()
        .py_0p5()
        .rounded_sm()
        .cursor_pointer()
        .hover(|this| this.bg(cx.theme().accent.opacity(0.08)))
        .on_click(move |_, _, _| {
            // Same contract as the toolbar's "open in browser": the user
            // asked for the link, so a browser that does not answer needs no
            // dialog from us.
            let _ = crate::open::url(&url);
        })
        .child(
            Icon::new(PhosphorIcon::LinkSimple.regular())
                .size_3()
                .mt(px(2.))
                .flex_shrink_0()
                .text_color(cx.theme().muted_foreground),
        )
        .child(
            v_flex()
                .min_w_0()
                .flex_1()
                .gap_0p5()
                // `info` is the theme's link blue. The accent token in this
                // theme is a grey surface wash, so it would make links look
                // like selected rows rather than destinations.
                .child(
                    div()
                        .text_xs()
                        .truncate()
                        .text_color(cx.theme().info)
                        .child(label),
                )
                .when(show_url, |this| {
                    this.child(
                        div()
                            .text_xs()
                            .truncate()
                            .text_color(cx.theme().muted_foreground)
                            .child(link.url.clone()),
                    )
                }),
        )
        .into_any_element()
}

/// The text the copy button puts on the clipboard.
///
/// The title is part of the article, and a paste that starts mid-sentence
/// without it loses the one line that says what is being read.
fn copy_text(entry: &EntryDetail, parsed: &Parsed) -> String {
    let body = content::plain_text(&parsed.blocks);

    if body.is_empty() {
        entry.title.clone()
    } else {
        format!("{}\n\n{body}", entry.title)
    }
}
