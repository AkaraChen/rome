//! Every picture in the window, and the block that stands in for it.
//!
//! GPUI draws nothing at all for an image until its bytes have arrived, and it
//! starts asking for those bytes the moment the element is laid out. What the
//! reader sees of a remote picture, then, is a hole that closes: the text below
//! it jumps when it appears, and on a picture that never arrives the hole stays
//! open with no sign that anything was meant to be there.
//!
//! So every image in the app is drawn through this module, which puts a block
//! of the muted surface in its place while it is fetched. The block is not the
//! picture and does not pretend to be one — it is the size of a typical
//! picture, it is the only colour in the window that means "nothing here yet",
//! and it is what tells the reader that the gap is a wait rather than a
//! mistake.
//!
//! The timing is GPUI's own: [`StyledImage::with_loading`] draws the block once
//! a load has been waiting for 200 milliseconds, and
//! [`StyledImage::with_fallback`] draws in its place if the load fails. The
//! delay is worth keeping — a block that appears for forty milliseconds is a
//! flicker, which is worse than the hole it was meant to explain.
//!
//! Deferring the fetch itself is the other half, and it is not done here: an
//! image loads when it is laid out, so the only way to not load one is to not
//! draw it. The reading pane decides that per block, in
//! [`super::reading_pane`]; the lists are virtualised and only lay out the rows
//! that are on screen.

use gpui_kit::component::ActiveTheme;
use gpui_kit::*;

/// The shape a picture is assumed to have before it has arrived.
///
/// Sixteen by nine, which at the reading column's width is about the height of
/// the block below. Stated as a height rather than as an `aspect_ratio`: the
/// column is a flex child, and an aspect ratio against a percentage width is
/// resolved a pass too late to give the block any height at all.
const ASSUMED: Pixels = px(360.);

/// The entry's own picture, at the top of the reading pane.
///
/// The one image in the app that is fetched as soon as the pane exists, because
/// it is on screen the moment the entry opens — deferring it would only mean
/// drawing the entry without its face. What it does need is a place held from
/// the first frame: the muted surface is painted as the picture's own
/// background, so the band is there before the bytes are, and the cover fills
/// it instead of pushing everything below it down.
///
/// `Cover` rather than `Contain`, because the band has a fixed height and
/// letterboxing would leave the placeholder showing around a picture that had
/// arrived. The same choice the grid makes for the same image.
pub fn hero(url: impl Into<String>, cx: &App) -> AnyElement {
    div()
        .w_full()
        .h(ASSUMED)
        .flex_shrink_0()
        .rounded_md()
        .overflow_hidden()
        .bg(cx.theme().muted)
        .child(
            gpui_kit::img(url.into())
                .size_full()
                .object_fit(ObjectFit::Cover)
                .with_fallback(|| div().into_any_element()),
        )
        .into_any_element()
}

/// A picture in an article: as wide as the column, and no taller than `cap`.
///
/// `Contain` rather than `Cover`, because the whole image is evidence and a
/// tight crop can take the caption out of a chart. The height cap keeps a tall
/// portrait from becoming a full screen of picture before the article starts.
pub fn picture(url: impl Into<String>, cap: Pixels, cx: &App) -> AnyElement {
    let fill = cx.theme().muted;

    div()
        .w_full()
        .max_h(cap)
        // A flex child shrinks by default when the column overflows, and an
        // element with no content has nothing to shrink down *to*: without this
        // the picture collapses to a hairline in the scrolling column rather
        // than holding its space and the words below it scroll with it.
        .flex_shrink_0()
        .rounded_md()
        .overflow_hidden()
        .child(
            gpui_kit::img(url.into())
                .w_full()
                .max_h(cap)
                .object_fit(ObjectFit::Contain)
                .with_loading(move || placeholder_with(cap, fill))
                // Feed images fail routinely — hotlink protection, dead CDNs —
                // and a warning box for each one would bury the words under the
                // article's broken furniture. A failure collapses to nothing,
                // where a placeholder that stayed would claim a picture is
                // still coming.
                .with_fallback(|| div().into_any_element()),
        )
        .into_any_element()
}

/// A picture that fills a box of its own choosing: a tile in the grid.
///
/// `Cover` here, and the opposite of [`picture`]'s choice, because a tile is a
/// grid cell and an image letterboxed inside one would leave the grid ragged.
pub fn tile(url: impl Into<String>, cx: &App) -> AnyElement {
    let fill = cx.theme().muted;

    gpui_kit::img(url.into())
        .size_full()
        .object_fit(ObjectFit::Cover)
        .with_loading(move || div().size_full().bg(fill).into_any_element())
        .with_fallback(|| div().into_any_element())
        .into_any_element()
}

/// The block that stands in for a picture while it is being fetched.
///
/// Public because the reading pane draws the block first and only draws the
/// picture itself for the blocks near the viewport; see
/// [`super::reading_pane`].
pub fn placeholder(cap: Pixels, cx: &App) -> AnyElement {
    placeholder_with(cap, cx.theme().muted)
}

fn placeholder_with(cap: Pixels, fill: Hsla) -> AnyElement {
    div()
        .w_full()
        .h(ASSUMED.min(cap))
        .flex_shrink_0()
        .rounded_md()
        .bg(fill)
        .into_any_element()
}
