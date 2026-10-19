//! The application theme, built from Vercel's brand tokens.
//!
//! Values come from the token families published at
//! `https://vercel.com/geist/vercel-brand.css`, which the brand guidelines at
//! `https://vercel.com/design.md` name as the design authority. Vercel states
//! its scale in OKLCH with zero chroma, so each value here is that lightness
//! converted to sRGB exactly rather than eyeballed. Every field names the token
//! it comes from; see `AGENTS.md` for the full tables and for the tokens that
//! have no home in this theme.
//!
//! Two of the guidelines' rules shape what is deliberately absent: design in
//! monochrome and let color carry meaning only, and prefer spacing, alignment
//! and typography over borders and boxes. So the greys do nearly all the work,
//! blue appears only as the focus ring and the text selection, and the semantic
//! colors are reserved for actual state.

use std::rc::Rc;

use gpui_kit::component::theme::{Theme, ThemeConfig, ThemeMode};
use gpui_kit::gpui::{App, Hsla, rgb};

/// The monochrome ramp plus the few semantic colors the system allows.
///
/// Every value is a Vercel token; the field names describe the role it plays
/// here, and the doc comment names the token it is.
///
/// The strings are written in the notation the component library's parser
/// accepts, and that notation is not CSS. It takes `#rrggbb`, `#rrggbbaa`, a
/// palette name, or `name/opacity` with the opacity out of 100. Anything else
/// fails to parse, and the failure is silent: `ThemeColor::apply_config` is
/// `try_parse_color(value).unwrap_or(default)`, so a value it cannot read is
/// the library's own colour standing in for a token that was written,
/// reviewed, and never applied. Alpha is written as the last byte of a hex
/// literal for that reason and not as `rgba(...)`, which is what every one of
/// these used to be. [`the_palettes_are_readable`] is what keeps it honest.
struct Palette {
    /// `background-100`. The content surface.
    surface: &'static str,
    /// Light: `background-200`, which is the `surface-secondary` role. Dark:
    /// `gray-100`, because `background-200` collapses to black there and would
    /// leave a raised surface indistinguishable from the one it sits on.
    raised: &'static str,
    /// `gray-100` in light, `gray-200` in dark: one step past `raised`, for
    /// hover on a raised surface.
    raised_hover: &'static str,
    /// `gray-1000`. Primary text.
    text: &'static str,
    /// `gray-900`. Secondary text and inactive icons.
    text_secondary: &'static str,
    /// `gray-700`. Muted text.
    text_muted: &'static str,
    /// `gray-alpha-400`. Hairline separators, and the `border-default` role.
    border: &'static str,
    /// The primary action fill. Vercel's own primary control is `gray-1000`.
    primary: &'static str,
    /// Derived: `primary` moved one step along the ramp. Vercel publishes no
    /// hover fill for a solid primary, so this is the nearest ramp value rather
    /// than a token.
    primary_hover: &'static str,
    /// `background-100`: the fill is inverted, so the label is the surface.
    primary_foreground: &'static str,
    /// `--vbg-focus`: `blue-700` in light, `blue-900` in dark.
    focus: &'static str,
    /// Derived from `blue-400`. Vercel publishes no selection token; this is
    /// the wash their 400 shade gives at full strength.
    selection: &'static str,
    /// `--vbg-color-error`: `red-700` in both modes.
    danger: &'static str,
    /// `--vbg-color-success`: `green-900` in both modes.
    success: &'static str,
    /// `--vbg-color-warning`: `amber-900` in both modes.
    warning: &'static str,
    /// `--vbg-color-info`: `blue-700` in both modes.
    info: &'static str,
    /// `gray-alpha-500`.
    scrollbar: &'static str,
    /// `gray-alpha-700`.
    scrollbar_hover: &'static str,
}

impl Palette {
    /// Every field, named.
    ///
    /// The destructuring is deliberate: it makes the list exhaustive, so
    /// adding a colour to [`Palette`] stops this compiling until the new field
    /// is named here too, and a field that is not named here is a field that
    /// is never checked for readability.
    ///
    /// Test-only, because the readability check is the only thing that asks.
    #[cfg(test)]
    fn fields(&self) -> [(&'static str, &'static str); 18] {
        let Palette {
            surface,
            raised,
            raised_hover,
            text,
            text_secondary,
            text_muted,
            border,
            primary,
            primary_hover,
            primary_foreground,
            focus,
            selection,
            danger,
            success,
            warning,
            info,
            scrollbar,
            scrollbar_hover,
        } = self;

        [
            ("surface", surface),
            ("raised", raised),
            ("raised_hover", raised_hover),
            ("text", text),
            ("text_secondary", text_secondary),
            ("text_muted", text_muted),
            ("border", border),
            ("primary", primary),
            ("primary_hover", primary_hover),
            ("primary_foreground", primary_foreground),
            ("focus", focus),
            ("selection", selection),
            ("danger", danger),
            ("success", success),
            ("warning", warning),
            ("info", info),
            ("scrollbar", scrollbar),
            ("scrollbar_hover", scrollbar_hover),
        ]
    }
}

/// Light: `background-100` and `gray-1000`, the two poles of the light ramp.
const LIGHT: Palette = Palette {
    surface: "#ffffff",
    raised: "#fafafa",
    raised_hover: "#f2f2f2",
    text: "#171717",
    text_secondary: "#4d4d4d",
    text_muted: "#7d7d7d",
    border: "#00000014",
    primary: "#171717",
    primary_hover: "#383838",
    primary_foreground: "#ffffff",
    focus: "#006bff",
    selection: "#cae7ff",
    danger: "#fc0035",
    success: "#107d32",
    warning: "#aa4d00",
    info: "#006bff",
    scrollbar: "#00000036",
    scrollbar_hover: "#00000070",
};

/// Dark: the same ramp read from its other end.
const DARK: Palette = Palette {
    surface: "#000000",
    raised: "#1a1a1a",
    raised_hover: "#1f1f1f",
    text: "#ededed",
    text_secondary: "#a0a0a0",
    text_muted: "#8f8f8f",
    border: "#ffffff24",
    primary: "#ededed",
    primary_hover: "#cccccc",
    primary_foreground: "#000000",
    focus: "#47a8ff",
    selection: "#003674",
    danger: "#f13242",
    success: "#00ca50",
    warning: "#ff9300",
    info: "#006efe",
    scrollbar: "#ffffff3d",
    scrollbar_hover: "#ffffff8a",
};

/// The window's rem base, in pixels.
///
/// Vercel publishes its type scale in rem against a 16px base, so 16 is the
/// value that makes the component library's Tailwind-relative sizes land on
/// Vercel's roles rather than near them:
///
/// | gpui | at 16 | Vercel role |
/// |------|-------|-------------|
/// | `text_sm`   | 14 | `compact` (0.875rem) |
/// | `text_base` | 16 | `body` (1rem) |
/// | `text_lg`   | 18 | `lede` (1.125rem) |
/// | `text_xl`   | 20 | `subsection` (1.25rem) |
/// | `text_2xl`  | 24 | `section` (1.5rem) |
///
/// Five of the six land exactly. The sixth, `text_xs`, is 12 and Vercel's
/// smallest role is `label` at 13, so anything that is a label or a count in
/// Vercel's vocabulary needs an explicit size — see [`LABEL`].
const REM_BASE: f32 = 16.0;

/// Vercel's `label` and `metadata` role, in pixels: 0.8125rem at the base.
///
/// The component library's `text_xs` is 12, which is below every role Vercel
/// publishes. Group labels and unread counts are the `label` and `metadata`
/// roles, so they take this size instead.
pub const LABEL: f32 = 13.0;

/// `amber-700`, for a starred entry.
///
/// The one colour in the interface that marks a value the reader chose rather
/// than a state the program is in, which is what earns it a colour. `amber-700`
/// is the saturated step of the amber ramp, and Vercel publishes it as the same
/// value in light and dark, so a star does not change meaning with the theme —
/// which is also why it is a function here and not a field of [`Palette`]:
/// there is one value, not a light one and a dark one.
///
/// It is not read back out of the component library, because the library has no
/// field for it. It used to be drawn with `Theme::yellow`, which is one of the
/// base palette colours the library keeps private
/// (`theme/schema.rs`, `ThemeConfigColors`): a shadcn yellow that no
/// configuration can move, in an application whose colours are all Vercel's.
pub fn star() -> Hsla {
    rgb(0xffae00).into()
}

/// `surface-contrast`, for the scrim behind the picture detail.
///
/// Vercel publishes no modal scrim — its semantic layer has no dialog surface at
/// all — and the theme's `overlay` field is `border-default`, an 8% black wash
/// that is barely visible over a page. A picture detail needs a backdrop that
/// actually recedes, so it takes the one surface that stays dark in both themes
/// and applies its own alpha at the call site. The token is the colour; how much
/// of the page shows through is a property of the overlay, not of the token.
pub fn scrim() -> Hsla {
    rgb(0x171717).into()
}

/// Install the Vercel theme for both modes.
///
/// Call after `gpui_kit::init`, which creates the `Theme` global this replaces.
pub fn init(cx: &mut App) {
    let mode = Theme::global(cx).mode;

    // The configs, not the live `colors`, are what a mode switch re-applies —
    // `Theme::change` calls `apply_config`, which rebuilds `colors` and `tokens`
    // from the config for the mode being entered. Writing the live struct alone
    // would look right until the first switch to dark and then revert.
    Theme::update(cx, |theme| {
        theme.light_theme = Rc::new(config(&theme.light_theme, ThemeMode::Light, &LIGHT));
        theme.dark_theme = Rc::new(config(&theme.dark_theme, ThemeMode::Dark, &DARK));
    });

    // Re-apply so the config just installed takes effect in the current mode.
    Theme::change(mode, None, cx);
}

/// Clone a stock config and overwrite the colors, so every field this theme
/// does not care about keeps whatever the component library ships.
fn config(base: &ThemeConfig, mode: ThemeMode, p: &Palette) -> ThemeConfig {
    let mut config = base.clone();
    config.name = if mode.is_dark() {
        "Vercel Dark".into()
    } else {
        "Vercel Light".into()
    };
    config.mode = mode;

    // The one number that sizes every label in the window. gpui-component
    // hardcodes `text_sm` for menu items and `text_xs` for group labels, both
    // relative to the window's rem size, and the root element derives that rem
    // size from this value. See `REM_BASE` for why it is 16 and not anything
    // else.
    config.font_size = Some(REM_BASE);

    // `--vbg-radius-small` and `--vbg-radius`. The library's own defaults are
    // the same two numbers, but it derives four more from them — `sm` is half
    // of `radius` and `xl` is twice it — so leaving them implicit would let a
    // library upgrade move the whole scale under a theme that claims to be
    // Vercel's.
    config.radius = Some(6);
    config.radius_lg = Some(8);

    // The guidelines reject ornamental shadows outright and put spacing,
    // alignment and typography ahead of borders and boxes. The library's
    // default is to shadow every button and input, which is the one thing the
    // visual system says never to do.
    config.shadow = Some(false);

    let c = &mut config.colors;
    c.background = Some(p.surface.into());
    c.foreground = Some(p.text.into());
    c.border = Some(p.border.into());
    c.window_border = Some(p.border.into());
    c.overlay = Some(p.border.into());
    c.skeleton = Some(p.raised_hover.into());

    // Sidebar chrome, which the sidebar component reads through its own tokens.
    c.sidebar = Some(p.raised.into());
    c.sidebar_foreground = Some(p.text.into());
    c.sidebar_border = Some(p.border.into());
    c.sidebar_accent = Some(p.raised_hover.into());
    c.sidebar_accent_foreground = Some(p.text.into());
    c.sidebar_primary = Some(p.primary.into());
    c.sidebar_primary_foreground = Some(p.primary_foreground.into());

    c.muted = Some(p.raised_hover.into());
    c.muted_foreground = Some(p.text_secondary.into());
    c.accent = Some(p.raised_hover.into());
    c.accent_foreground = Some(p.text.into());

    c.primary = Some(p.primary.into());
    c.primary_hover = Some(p.primary_hover.into());
    c.primary_active = Some(p.primary_hover.into());
    c.primary_foreground = Some(p.primary_foreground.into());
    c.secondary = Some(p.raised_hover.into());
    c.secondary_hover = Some(p.raised.into());
    c.secondary_active = Some(p.raised.into());
    c.secondary_foreground = Some(p.text.into());

    c.button = Some(p.raised.into());
    c.button_hover = Some(p.raised_hover.into());
    c.button_active = Some(p.raised_hover.into());
    c.button_foreground = Some(p.text.into());

    // A border, not a surface, whatever the field is called. Every read of
    // `input` in the component library is `.border_color(theme.input)` — the
    // field's own default is `neutral-200`, the same grey as `border`. Vercel
    // agrees: its control CSS is `border: 1px solid var(--vbg-border-default)`
    // with `background: var(--vbg-background-100)`, which is the page. Set it
    // to a surface and every input in the application draws its outline in the
    // colour of the paper under it, which is to say not at all.
    //
    // Dark has one wrinkle: `Theme::input_background()` falls back to
    // `input.mix_oklab(transparent, 0.3)`, so this border colour is also the
    // input's fill there. `gray-alpha-400` at 30% is a 4% white wash over black
    // where Vercel's own dark control is flat `background-100`; it reads as a
    // field rather than as a hole, which is the side to err on.
    c.input = Some(p.border.into());
    c.popover = Some(p.surface.into());
    c.popover_foreground = Some(p.text.into());
    c.caret = Some(p.text.into());
    c.ring = Some(p.focus.into());
    c.selection = Some(p.selection.into());
    c.link = Some(p.text.into());
    c.link_hover = Some(p.text_secondary.into());
    c.link_active = Some(p.text_secondary.into());

    c.list = Some(p.surface.into());
    c.list_hover = Some(p.raised_hover.into());
    c.list_active = Some(p.raised_hover.into());
    c.list_active_border = Some(p.text.into());
    c.list_head = Some(p.surface.into());
    c.list_even = Some(p.raised.into());

    c.tab = Some(p.surface.into());
    c.tab_bar = Some(p.surface.into());
    c.tab_foreground = Some(p.text_muted.into());
    c.tab_active = Some(p.raised.into());
    c.tab_active_foreground = Some(p.text.into());

    c.table = Some(p.surface.into());
    c.table_head = Some(p.raised.into());
    c.table_head_foreground = Some(p.text_muted.into());
    c.table_foot = Some(p.raised.into());
    c.table_foot_foreground = Some(p.text_muted.into());
    c.table_hover = Some(p.raised_hover.into());
    c.table_active = Some(p.raised_hover.into());
    c.table_active_border = Some(p.text.into());
    c.table_even = Some(p.raised.into());
    c.table_row_border = Some(p.border.into());

    c.title_bar = Some(p.raised.into());
    c.title_bar_border = Some(p.border.into());
    c.status_bar = Some(p.raised.into());
    c.status_bar_border = Some(p.border.into());

    c.scrollbar = Some("transparent".into());
    c.scrollbar_thumb = Some(p.scrollbar.into());
    c.scrollbar_thumb_hover = Some(p.scrollbar_hover.into());

    c.drag_border = Some(p.focus.into());
    c.drop_target = Some(p.focus.into());
    c.slider_bar = Some(p.raised_hover.into());
    c.slider_thumb = Some(p.text.into());
    c.switch = Some(p.raised_hover.into());
    c.switch_thumb = Some(p.surface.into());
    c.progress_bar = Some(p.raised_hover.into());

    // The `--vbg-color-*` semantics. The component library derives each
    // `button_*` variant from the matching field here — a `button_danger` fill
    // is `danger` washed toward transparent, and its label is `danger` itself —
    // so the button family needs no separate mapping.
    c.danger = Some(p.danger.into());
    c.danger_hover = Some(p.danger.into());
    c.danger_active = Some(p.danger.into());
    c.danger_foreground = Some(p.primary_foreground.into());
    c.success = Some(p.success.into());
    c.success_hover = Some(p.success.into());
    c.success_active = Some(p.success.into());
    c.success_foreground = Some(p.primary_foreground.into());
    c.warning = Some(p.warning.into());
    c.warning_hover = Some(p.warning.into());
    c.warning_active = Some(p.warning.into());
    c.warning_foreground = Some(p.primary_foreground.into());
    c.info = Some(p.info.into());
    c.info_hover = Some(p.info.into());
    c.info_active = Some(p.info.into());
    c.info_foreground = Some(p.primary_foreground.into());

    config
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::component::theme::try_parse_color;

    /// Every colour in both palettes has to be one the library can read.
    ///
    /// This is not a formality, and it is not a test of Vercel's tokens either.
    /// It exists because of what happens when the two disagree: the library
    /// parses each field with `try_parse_color(value).unwrap_or(default)`, so a
    /// string it does not understand is not a compile error, not a panic and
    /// not a warning — it is the library's own default quietly taking the
    /// place of a token. Every alpha colour in this file was written in CSS
    /// notation for as long as it took to measure a border and find out that
    /// the parser does not accept CSS, and the window looked deliberate the
    /// whole time.
    #[test]
    fn the_palettes_are_readable() {
        for (mode, palette) in [("light", &LIGHT), ("dark", &DARK)] {
            for (field, value) in palette.fields() {
                assert!(
                    try_parse_color(value).is_ok(),
                    "{mode} `{field}` is {value:?}, which the component library cannot parse, \
                     so this field is silently the library's default instead of a Vercel token"
                );
            }
        }
    }
}
