# Rome

A local-first desktop reader. Rust, GPUI through `gpui-kit 0.7.3`, SQLite through
Toasty, plugins as JavaScript sidecars, no accounts and no server of its own.

---

# Design tokens come from Vercel

**Every colour, size, weight, leading, radius and spacing value in this
application comes from Vercel's published design tokens. None of them is
invented, eyeballed, or rounded to a nicer number.**

The authority is two documents:

| What | Where |
| --- | --- |
| The rules, and which token means what | <https://vercel.com/design.md> |
| The values | <https://vercel.com/geist/vercel-brand.css> |

`design.md` states its scale in names and defers to the stylesheet for numbers
("Use the accompanying CSS for exact tokens"). So both are needed, and the
stylesheet is the one that wins on any value.

`src/theme.rs` is where this is implemented. It is the only file allowed to hold
a colour literal or a font size, and every field in it names the token it came
from. Read it alongside this document.

Vercel states its greys in OKLCH with zero chroma and its accent families in
OKLCH with chroma. GPUI wants sRGB. The values in `src/theme.rs` and in the
tables below are the published OKLCH converted to sRGB exactly, not sampled from
a screenshot. To redo a conversion, implement OKLab → linear sRGB and apply the
sRGB transfer function; do not round by eye.

## The published tokens

### Colour

Light and dark are one token with two values, written `light-dark(a, b)` in the
stylesheet. Rome resolves both at build time and hands the pair to the component
library, which keeps them apart per mode.

The monochrome ramp, which does nearly all the work:

| Token | Light | Dark |
| --- | --- | --- |
| `background-100` | `#ffffff` | `#000000` |
| `background-200` | `#fafafa` | `#000000` |
| `gray-100` | `#f2f2f2` | `#1a1a1a` |
| `gray-200` | `#ebebeb` | `#1f1f1f` |
| `gray-300` | `#e6e6e6` | `#292929` |
| `gray-400` | `#eaeaea` | `#2e2e2e` |
| `gray-500` | `#c9c9c9` | `#454545` |
| `gray-600` | `#a8a8a8` | `#878787` |
| `gray-700` | `#8f8f8f` | `#8f8f8f` |
| `gray-800` | `#7d7d7d` | `#7d7d7d` |
| `gray-900` | `#4d4d4d` | `#a0a0a0` |
| `gray-1000` | `#171717` | `#ededed` |

`gray-400` is lighter than `gray-300` in light. That is what Vercel publishes,
not a transcription slip.

The alpha ramp, for anything that has to sit on a surface it does not own:

| Token | Light | Dark |
| --- | --- | --- |
| `gray-alpha-100` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.07)` |
| `gray-alpha-200` | `rgba(0,0,0,0.081)` | `rgba(255,255,255,0.09)` |
| `gray-alpha-300` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.13)` |
| `gray-alpha-400` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.14)` |
| `gray-alpha-500` | `rgba(0,0,0,0.21)` | `rgba(255,255,255,0.24)` |
| `gray-alpha-600` | `rgba(0,0,0,0.24)` | `rgba(255,255,255,0.51)` |
| `gray-alpha-700` | `rgba(0,0,0,0.44)` | `rgba(255,255,255,0.54)` |
| `gray-alpha-800` | `rgba(0,0,0,0.51)` | `rgba(255,255,255,0.47)` |
| `gray-alpha-900` | `rgba(0,0,0,0.7)` | `rgba(255,255,255,0.61)` |
| `gray-alpha-1000` | `rgba(0,0,0,0.91)` | `rgba(255,255,255,0.92)` |

The published form of an alpha token is `oklch(0 0 0 / 0.08)`. The table above
writes it as `rgba(...)` because that is what it means, not because that is what
the application writes: the component library's parser cannot read CSS, so
`src/theme.rs` holds these as 8-digit hex — see [The colour strings are not
CSS](#the-colour-strings-are-not-css).

The accent families. Each publishes five steps and no more; the naming is
Vercel's, and the step numbers are not evenly spaced:

| Token | Light | Dark |
| --- | --- | --- |
| `blue-100` | `#f0f7ff` | `#06193a` |
| `blue-400` | `#cae7ff` | `#003674` |
| `blue-700` | `#006bff` | `#006efe` |
| `blue-900` | `#005ff2` | `#47a8ff` |
| `blue-1000` | `#002359` | `#eaf6ff` |
| `green-100` | `#ecfdec` | `#002608` |
| `green-400` | `#b9f5bc` | `#004615` |
| `green-700` | `#28a948` | `#00ac3a` |
| `green-900` | `#107d32` | `#00ca50` |
| `green-1000` | `#003a00` | `#d8ffe4` |
| `amber-100` | `#fff6de` | `#2a1700` |
| `amber-400` | `#ffdc73` | `#5b3000` |
| `amber-700` | `#ffae00` | `#ffae00` |
| `amber-900` | `#aa4d00` | `#ff9300` |
| `amber-1000` | `#561900` | `#fff3d5` |
| `red-100` | `#ffeeef` | `#330a11` |
| `red-400` | `#ffd7d6` | `#6f101b` |
| `red-700` | `#fc0035` | `#f13242` |
| `red-900` | `#d8001b` | `#ff565f` |
| `red-1000` | `#47000c` | `#ffe9ed` |

The semantic layer is what application code should reach for. The ramp is for
choosing a value for a token that does not exist yet:

| Semantic token | Is | Light | Dark |
| --- | --- | --- | --- |
| `surface-primary` | `background-100` | `#ffffff` | `#000000` |
| `surface-secondary` | `background-200` | `#fafafa` | `#000000` |
| `surface-contrast` | — | `#171717` | `#171717` |
| `text-primary` | `gray-1000` | `#171717` | `#ededed` |
| `text-secondary` | `gray-900` | `#4d4d4d` | `#a0a0a0` |
| `text-on-contrast` | — | `#ededed` | `#ededed` |
| `text-on-contrast-secondary` | — | `#a4a4a4` | `#a4a4a4` |
| `border-subtle` | `gray-alpha-300` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.13)` |
| `border-default` | `gray-alpha-400` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.14)` |
| `border-strong` | `gray-alpha-700` | `rgba(0,0,0,0.44)` | `rgba(255,255,255,0.54)` |
| `focus` | `blue-700` / `blue-900` | `#006bff` | `#47a8ff` |
| `color-info` | `blue-700` | `#006bff` | `#006efe` |
| `color-success` | `green-900` | `#107d32` | `#00ca50` |
| `color-warning` | `amber-900` | `#aa4d00` | `#ff9300` |
| `color-error` | `red-700` | `#fc0035` | `#f13242` |
| `star` | `amber-700` | `#ffae00` | `#ffae00` |
| `chart-1`..`chart-6` | `gray-1000`, `gray-900`, `gray-800`, repeated | monochrome | monochrome |

Two things to notice, because both are easy to get wrong:

- `surface-contrast` stays dark in **both** themes. It is the one surface that
  does not invert, and its text tokens (`text-on-contrast*`) are fixed with it.
- `focus` uses the 900 step in dark while `color-info` uses the 700 step. They
  agree in light and diverge in dark, on purpose.

Vercel publishes no selection token. Rome's text selection is derived from
`blue-400` at full strength; `src/theme.rs` says so at the field. Three other
things in the theme are derivations for the same reason — the published set has
no token for them — and each is marked as a derivation where it is set:

- `primary_hover` is the next step along the ramp, because Vercel publishes no
  hover fill for a solid primary.
- `overlay` (the scrim behind a dialog) is `border-default`. `design.md` is a
  document specification and has no modal surface; nothing is published to use
  instead. It is the weakest value in the theme — 8% black over the page is
  barely a scrim — and it is a judgment call, not a token.
- `skeleton` is the hover step. There is no loading-placeholder token.

### Spacing

| Token | px | | Token | px |
| --- | --- | --- | --- | --- |
| `space-1` | 4 | | `space-6` | 24 |
| `space-2` | 8 | | `space-8` | 32 |
| `space-3` | 12 | | `space-10` | 40 |
| `space-4` | 16 | | `space-12` | 48 |
| `space-5` | 20 | | `space-16` | 64 |

There is no `space-0`, no 2, and no 6. Nothing in the scale is below 4.

Four named flows sit on top, and they are the ones to reach for before picking a
step by eye:

| Flow | Is | px |
| --- | --- | --- |
| `flow-tight` | `space-2` | 8 |
| `flow-copy` | `space-4` | 16 |
| `flow-group` | `space-8` | 32 |
| `flow-section` | `space-16` | 64 |

The guidelines are explicit about which is which: within-group gaps are
`space-2`–`space-4`, between-group gaps `space-6`–`space-8`, major section turns
`space-8`–`space-12`, and `space-16` is for a real chapter break only, never as
the default stack gap. **Give every gap one owner** — a container sets the gap
and its children do not add margins of their own.

### Radius

| Token | px |
| --- | --- |
| `radius-small` | 6 |
| `radius` | 8 |

Two values, and the guidelines say to keep radii "restrained and consistent with
the foundation". Do not introduce a third.

### Type

| Role | Size | Line height | Weight | Letter spacing |
| --- | --- | --- | --- | --- |
| `display` | 48 | 56 | 450 | -0.06em |
| `page-title` | 40 | 48 | 450 | -0.06em |
| `title` | 32 | 40 | 450 | — |
| `section` | 24 | 32 | 450 | -0.04em |
| `subsection` | 20 | 26 | 450 | -0.02em |
| `heading-16` | 16 | 24 | 450 | -0.02em |
| `lede` | 18 | 28 | 400 | — |
| `body` | 16 | 24 | 400 | — |
| `compact` | 14 | 20 | 400 | — |
| `label` | 13 | 16 | 400 | — |
| `metadata` | 13 | 18 | 400, tabular | — |

`label` and `metadata` are the same size and differ in leading and in the
figures: `metadata` is the role for anything counted, dated, measured or
identified, and it takes tabular numerals.

Sizes are stated in rem against a 16px base, which is why the application's rem
base is 16 — see `REM_BASE` in `src/theme.rs` for the table of which GPUI size
lands on which role.

### Weights

| Token | Value |
| --- | --- |
| `regular` | 400 |
| `heading` | 450 |
| `medium` | 500 |
| `semibold` | 600 |

Headings use 450, not 500 or 600. 450 is expressible — `FontWeight` is a newtype
over `f32` — but it has not been exercised in a render yet.

### Measures

| Token | Value |
| --- | --- |
| `reading-width` | 68ch |
| `display-measure` | 20ch |
| `title-measure` | 24ch |
| `compact-title-measure` | 30ch |
| `content-width` | 1200px |
| `chart-min-width` | 640px |
| `control-height` | 36px |
| `control-height-touch` | 44px |

## How they reach the component library

`gpui-component 0.7.3` has two token layers. The **legacy** layer is a flat
`ThemeConfig` of `Option<SharedString>` colours plus a handful of scalars, and
it is what every component actually reads. The **semantic** layer
(`SemanticThemeTokens`) is a typed projection of the same values for
application-owned code, and `Theme::semantic_tokens()` rebuilds it from the
legacy fields on every call.

Rome writes the legacy layer, in `src/theme.rs::config`. The mapping:

| Vercel token | `ThemeConfig` field | Notes |
| --- | --- | --- |
| `surface-primary` | `background`, `popover`, `list`, `tab`, `tab_bar`, `table` | every surface that is the page itself |
| `surface-secondary` (light) / `gray-100` (dark) | `sidebar`, `list_even`, `table_head`, `table_foot`, `tab_active`, `title_bar`, `status_bar` | see below |
| `gray-100` (light) / `gray-200` (dark) | `muted`, `accent`, `secondary`, `button_hover`, `sidebar_accent`, `slider_bar`, `switch`, `progress_bar` | the hover step |
| `text-primary` | `foreground`, `sidebar_foreground`, `popover_foreground`, `button_foreground`, `caret`, `slider_thumb` | |
| `text-secondary` | `muted_foreground`, `link_hover`, `link_active` | |
| `gray-700` | `tab_foreground`, `table_head_foreground`, `table_foot_foreground` | |
| `border-default` | `border`, `input`, `window_border`, `overlay`, `sidebar_border`, `table_row_border` | `input` is a border, not a surface — see below |
| `gray-1000` | `primary`, `sidebar_primary`, `list_active_border`, `table_active_border` | the solid primary control |
| `background-100` | `primary_foreground`, `sidebar_primary_foreground` | the inverted label |
| `focus` | `ring`, `drag_border`, `drop_target` | |
| `blue-400` | `selection` | derived; no published selection token |
| `color-error` | `danger` | |
| `color-success` | `success` | |
| `color-warning` | `warning` | |
| `color-info` | `info` | |
| `amber-700` | — | read directly by `theme::star()`, for a starred entry |
| `gray-alpha-500` | `scrollbar_thumb` | |
| `gray-alpha-700` | `scrollbar_thumb_hover` | |
| `radius-small` | `radius` | |
| `radius` | `radius_lg` | dialogs and notifications |
| `body` size | `font_size` | the rem base, 16 |
| — | `shadow` | **false.** See below |

The table lists the fields that carry a token of their own. The rest are
repeats: every `_hover` and `_active` field takes the step its base takes, and
`skeleton` takes the hover step.

### The colour strings are not CSS

`ThemeColor::apply_config` reads each field with
`try_parse_color(value).unwrap_or(default)`, and `try_parse_color` accepts four
things: `#rrggbb`, `#rrggbbaa`, a palette name, or `name/opacity` with the
opacity out of 100.

It does not accept CSS. A field written as `rgba(0, 0, 0, 0.08)` is **not** an
error, a panic or a warning — it is the library's own default for that field,
quietly standing in for a token that was written, reviewed, and never applied.
The window still looks deliberate, because the defaults are a coherent palette.
It is simply not Vercel's.

So alpha goes in the last byte of the hex literal, and the published
`oklch(… / a)` becomes the nearest 8-bit alpha:
`gray-alpha-400` is `#00000014` in light (0.08 → 20/255) and `#ffffff24` in dark
(0.14 → 36/255). `the_palettes_are_readable` in `src/theme.rs` parses every
value in both palettes and fails the build on anything the library cannot read;
that test is the only thing standing between a typo and a silently unthemed
application.

### Fields that do nothing

The config has 128 colour fields and the component library reads far fewer.
Setting one of these has no effect at all, and a mapping table that claims
otherwise is telling a story about code that does not run:

| Field | Why it is inert |
| --- | --- |
| `list` | `Theme` has an inherent `list: ListSettings` field that shadows the colour of the same name, so `cx.theme().list` never resolves to it. Rows paint from `list_hover` / `list_active` / `accent`. |
| `tab` | Inactive tabs paint `transparent`; only `tab_active`, `tab_foreground` and `tab_bar` are read. |
| `sidebar_primary`, `sidebar_primary_foreground` | The sidebar reads `sidebar`, `sidebar_accent*`, `sidebar_foreground` and `sidebar_border` only. |
| `window_border` | `window_border.rs` hardcodes a lightness instead of reading the token. |
| `list_even`, `list_head`, `list_active_border` | Only the table reads stripes, headers and active borders, from `table_even`, `table_head` and `table_active_border`. These three survive as those fields' fallbacks. |
| `title_bar`, `status_bar` | Only the library's `TitleBar` and `StatusBar` read them, and Rome draws neither. Worth knowing before adopting one: `title_bar` is not painted flat, it is blended 55/45 with `background` into a gradient. |

Four things about this mapping are worth knowing before changing it.

**`input` is a border colour, whatever it is called.** Every read of it in the
library is `.border_color(theme.input)` — the combobox, the select, the colour
picker, the unchecked box and radio — and its own default is `neutral-200`,
the same grey as `border`. Vercel says the same thing from the other side: its
control CSS is `border: 1px solid var(--vbg-border-default)` over
`background: var(--vbg-background-100)`, which is the page. Set it to a surface
and every input in the application draws its outline in the colour of the paper
under it, which is to say not at all. Dark has one wrinkle: the library's
`input_background()` is `input.mix_oklab(transparent, 0.3)`, so there this
border colour is also the input's fill.

**The `button_*` family is not set, on purpose.** `Button` does not read
`primary` for its primary variant; it reads `button_primary`, which the library
derives from `primary` — solid for the primary and secondary variants, washed
20% toward transparent for the four semantic ones, whose labels are then the
solid colour back. Every one of those fields is a fallback off a semantic
colour, so setting them by hand would fight the derivation and drift the moment
a semantic colour changed. Set the semantics and let the buttons follow.

**The sidebar takes a different token in dark than in light.** Vercel's
`surface-secondary` is `background-200`, which is `#fafafa` in light and
`#000000` in dark — the same as the page. A sidebar drawn on it would vanish.
Rome uses `background-200` in light and `gray-100` (`#1a1a1a`) in dark, which is
the token that means "raised" at that end of the ramp. This is the one place the
mapping is not a straight read, and `src/theme.rs` says why at the field.

**`shadow` is off.** The library's default is to put a small shadow under every
button and input. The guidelines reject ornamental shadows and fake depth
outright, and put spacing, alignment, typography and density ahead of borders
and boxes.

## Rules

These come from `design.md` and are the ones that bear on code in this
repository.

**Colour**

- Design in monochrome. Colour is for state, action and data, and always paired
  with a non-colour cue.
- Never colour something merely because it is favourable or important.
- Earn a surface or a boundary. Prefer spacing, alignment, typography and a
  change in density to a border or a box, and do not wrap every section in a
  card or nest panels.
- Never a gradient, glow, blob, texture, stripe, glass effect, coloured side
  rail or decorative shadow. A gradient is acceptable only as a labelled
  continuous data scale.
- Do not add a visible theme switcher. Light and dark follow the system.

**Type**

- Use the published roles. No arbitrary font sizes and no arbitrary weights.
- Hierarchy comes from typography before surfaces or colour.
- Sentence case for headings and labels. No all-caps eyebrows, overlines or
  decorative section numbers.
- Emphasis is scarce; body copy is regular.
- Tabular numerals for anything aligned or compared.
- Keep prose near 60–68 characters per line. Rewrite before shrinking; never
  use tiny grey copy to make density fit.
- Do not shrink one peer because its string is longer or its value larger.

**Layout**

- Every object aligns to a shared edge, baseline or grid line. Establish the
  alignment spines and keep to them.
- Give every gap one owner.
- `min-width: 0` on flex and grid children that hold text, or they will refuse
  to shrink and push their siblings out.
- Reflow before shrinking. Preserve readable type and control sizes at narrow
  widths.

**Interaction and accessibility**

- Default to stillness. Motion only to explain a state change, preserve
  continuity or confirm an action, and respect reduced-motion.
- Never gate reading behind animation or reveal content on scroll.
- Native controls, visible labels, visible focus, one concise live status.
- Meet WCAG AA. Never rely on colour alone.
- Icons are not decoration and do not go in coloured tiles. Prefer a text label
  unless an established icon is materially faster to recognise.

**Verifying**

The rules above are about things you cannot see in a diff. `just shots` draws
the window headlessly and writes PNGs to `shots/`; measure them rather than
trusting the code. A column four pixels off, a label that wraps and a muted grey
that is too light all pass every other test in this tree.

Measure, and pick a pixel whose colour you can predict. A theme value the
library cannot parse falls back to the library's default, and the defaults are
a coherent palette: the window still looks deliberate, and nothing about the
source says which of the two you are looking at. The border under the reading
pane's toolbar is `border-default`, which over white is 8% black — 235, not 255
and not the 229 of the library's `neutral-200`. That one reading is what showed
that every alpha colour in the theme had been discarded.

A dialog is not in a snapshot: it is opened on a window, not rendered from data.
So a change to one is only verified by a frame that opens it, and there is no
other kind of evidence. That is how a release came to have eleven dialogs and no
confirm button in any of them — the code looked right, the tests passed, and
nothing had ever drawn one.

## What does not fit

Four gaps. Each is a real deviation, not an oversight.

**Spacing tokens cannot be set.** `Theme::spacing_tokens()` returns
`SpacingTokens::default()` unconditionally and `apply_semantic_tokens` has no
storage for a spacing config, so `theme.tokens.spacing` is the library's scale
and not Vercel's. Rome's own layout code uses literal Vercel px. Where the two
happen to line up: `xs`=4=`space-1`, `sm`=8=`space-2`, `md`=12=`space-3`,
`lg`=16=`space-4`, `xl`=24=`space-6`, `xxl`=32=`space-8`. The library's `xxs`=2
is below Vercel's floor of 4 and should not be used; Vercel's 20, 40, 48 and 64
have no token at all.

**`text_xs` is 12, below Vercel's floor of 13.** It is the library's own size for
`SidebarGroup` labels and other small chrome, and it cannot be moved without
moving the rem base, which would take the five roles that currently land exactly
off their sizes. Rome's own small text is meant to use `theme::LABEL` (13)
instead, and the sidebar's unread counts do — but the rest of the interface
still calls `text_xs` in 29 places: subtitles, domains and dates under a
headline, picture captions, plugin descriptions, form hints. Every one of them
is a `label` or `metadata` role in Vercel's vocabulary, so every one of them is
a pixel under its size. Moving them is mechanical and not free: 12 → 13 is 8%
wider, so each site has to be re-rendered rather than trusted.

**No Geist.** `font_family` is left at `.SystemUIFont`; Vercel's type is Geist
Sans and Geist Mono. Embedding them means shipping the font files and calling
`add_fonts`, which is a separate job.

**Tokens with no home.** `chart-1`..`chart-6` are unused because Rome draws no
charts. `surface-contrast` and `text-on-contrast*` are unused because Rome has
no band. `reading-width` (68ch) is approximated by `MEASURE` in
`src/ui/reading_pane.rs`, which is stated in px because GPUI measures in px.
`accordion`, `group_box*`, `description_list_label*`, `struct` and
`tab_bar_segmented` are left at library defaults because Rome uses none of those
components — if one is adopted, map it from the tables above first.
