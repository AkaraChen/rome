//! The page that adds a source: pick a plugin, or install one first.
//!
//! The page has two tabs, and they are two different jobs rather than two
//! layouts of one list:
//!
//! - 「已安装」 is the subscription flow. Choose a plugin that is already on
//!   this machine, name the subscription, fill in the parameters that plugin
//!   asked for. Nothing here installs anything.
//! - 「插件市场」 is plugin installation. It lists the plugins compiled into
//!   the binary and the way in from a file. Nothing here subscribes to
//!   anything.
//!
//! Keeping them apart is what lets each tab answer one question. A reader who
//! wants to read something lands on 「已安装」; a reader with nothing installed
//! is sent to the market tab from the empty state, not shown a market they did
//! not ask for.
//!
//! The configure step is the second half of the first tab rather than a dialog.
//! It belongs to the same decision — a dialog over the page would be a third
//! surface for a two-step flow — and it keeps the tab row visible, so going
//! back is where it looks like it is.
//!
//! Nothing here reads the database; the page is drawn from the snapshot and
//! speaks through [`Dispatch`].

use std::rc::Rc;

use gpui_kit::component::button::{Button, ButtonVariants};
use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::tab::{Tab as TabItem, TabBar};
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex, v_flex};
use gpui_kit::prelude::FluentBuilder;
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorIcon;
use serde_json::Value;

use crate::snapshot::{PluginRow, Snapshot};

use super::form::Form;
use super::sidebar::view_label;
use super::{Action, Dispatch};

/// The page's measure, the same one the feeds use.
const CONTENT: Pixels = px(1200.);

/// The page's side padding, the same one the feeds use.
const PAD: Pixels = px(32.);

/// The configure step's measure. A form is read line by line, and a field that
/// runs the full width of a wide window is harder to fill than a narrower one.
const FORM_WIDTH: Pixels = px(560.);

/// The narrowest a market card is allowed to get before the grid drops a
/// column. Wide enough for a 40px mark, a name and two lines of description.
const CARD_MIN: Pixels = px(240.);

/// The gap between market cards, and the height they all share.
///
/// A fixed height rather than a function of the description: a grid whose rows
/// change height with the length of a sentence reads as a ragged page, and the
/// longest description here is two lines.
const CARD_GAP: Pixels = px(16.);
const CARD_HEIGHT: Pixels = px(176.);

/// How many market cards fit across `inner`, never fewer than one.
fn card_columns(inner: Pixels) -> usize {
    let inner = f32::from(inner);
    let min = f32::from(CARD_MIN);
    let gap = f32::from(CARD_GAP);

    (((inner + gap) / (min + gap)).floor() as usize).clamp(1, 4)
}

/// The width of one card in a row of `count`, filling `inner`.
fn card_width(inner: Pixels, count: usize) -> Pixels {
    let gaps = f32::from(CARD_GAP) * (count.saturating_sub(1)) as f32;
    (inner - px(gaps)) * (1.0 / count as f32)
}

/// Which half of the page is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Tab {
    /// Add a source from a plugin that is already installed.
    #[default]
    Installed,
    /// Install a plugin, which is a prerequisite for the first tab.
    Market,
}

impl Tab {
    fn index(self) -> usize {
        match self {
            Self::Installed => 0,
            Self::Market => 1,
        }
    }
}

/// How far the installed tab has got.
///
/// The configure variant owns the entities its controls need, which is why it
/// cannot be built without a window. Choosing owns nothing.
pub enum Step {
    Choose,
    Configure {
        /// The row id of the plugin being subscribed to.
        plugin: u64,
        title: Entity<InputState>,
        params: Rc<Form>,
    },
}

/// The page's state, owned by the window rather than the worker.
///
/// A half-filled form is a conversation with the user, and the worker has no
/// business knowing about a name it has not been given yet.
pub struct State {
    pub tab: Tab,
    pub step: Step,
}

impl Default for State {
    fn default() -> Self {
        Self {
            tab: Tab::Installed,
            step: Step::Choose,
        }
    }
}

impl State {
    /// Open on `tab`, at the first step.
    pub fn at(tab: Tab) -> Self {
        Self {
            tab,
            ..Self::default()
        }
    }

    /// Build the configure step for `plugin`.
    ///
    /// The name starts as the plugin's own, because that is the answer most of
    /// the time — a reader who wants "Hacker News" should not have to type it —
    /// and the parameters start at the defaults the plugin declared.
    pub fn configure(plugin: &PluginRow, window: &mut Window, cx: &mut App) -> Self {
        let name = plugin.name.clone();

        let title = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder(name.clone())
                .default_value(name)
        });

        let params = Rc::new(Form::new(&plugin.params_schema, &Value::Null, window, cx));

        let focus = title.read(cx).focus_handle(cx);
        window.defer(cx, move |window, cx| focus.focus(window, cx));

        Self {
            tab: Tab::Installed,
            step: Step::Configure {
                plugin: plugin.id,
                title,
                params,
            },
        }
    }

    /// The plugin the configure step is for, if it is open.
    pub fn plugin(&self) -> Option<u64> {
        match &self.step {
            Step::Choose => None,
            Step::Configure { plugin, .. } => Some(*plugin),
        }
    }

    /// Go back to choosing a plugin.
    pub fn choose(&mut self) {
        self.step = Step::Choose;
    }
}

/// Build the add-source page.
///
/// `available` is the window width left of the sidebar, passed in for the same
/// reason the feeds take it: the market's column count is part of the layout,
/// and a grid whose cards decide their own width cannot also keep its rows
/// aligned.
pub fn pane(
    snapshot: &Snapshot,
    state: &State,
    dispatch: &Dispatch,
    available: Pixels,
    cx: &App,
) -> AnyElement {
    // What the padding leaves of the page's measure.
    let inner = (available.min(CONTENT) - px(f32::from(PAD) * 2.0)).max(px(0.));

    let body = match state.tab {
        Tab::Installed => installed_tab(inner, snapshot, state, dispatch, cx),
        Tab::Market => market_tab(inner, snapshot, dispatch, cx),
    };

    v_flex()
        .size_full()
        .min_w_0()
        .child(header(state, dispatch, cx))
        .child(
            div()
                .id("add-source")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .child(
                    v_flex()
                        .w_full()
                        .max_w(CONTENT)
                        .mx_auto()
                        .px(PAD)
                        .py_8()
                        .child(body),
                ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

/// The page's title, its one file-level action, and the two tabs.
///
/// 「从文件安装…」 sits here rather than inside the market tab because it is a
/// way to get a plugin onto this machine, and a reader who has one on disk
/// should not have to know which tab installing lives under.
fn header(state: &State, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let file = dispatch.clone();
    let tabs = dispatch.clone();

    v_flex()
        .flex_shrink_0()
        .border_b_1()
        .border_color(cx.theme().border)
        .child(
            h_flex()
                .w_full()
                .max_w(CONTENT)
                .mx_auto()
                .items_start()
                .gap_3()
                .px(PAD)
                .pt_5()
                .child(
                    v_flex()
                        .flex_1()
                        .min_w_0()
                        .gap_1()
                        .child(
                            div()
                                .text_size(px(20.))
                                .line_height(px(26.))
                                .font_weight(FontWeight(450.))
                                .text_color(cx.theme().foreground)
                                .child("添加信息源"),
                        )
                        .child(
                            div()
                                .text_size(px(crate::theme::LABEL))
                                .line_height(px(18.))
                                .text_color(cx.theme().muted_foreground)
                                .child("选一个已安装的插件，或者先从市场安装一个"),
                        ),
                )
                .child(
                    Button::new("add-source-file")
                        .ghost()
                        .small()
                        .icon(Icon::new(PhosphorIcon::FolderOpen.regular()))
                        .label("从文件安装…")
                        .on_click(move |_, window, cx| {
                            file(Action::InstallFromFile, window, cx);
                        }),
                ),
        )
        .child(
            div()
                .w_full()
                .max_w(CONTENT)
                .mx_auto()
                .px(PAD)
                .mt_4()
                .child(
                    TabBar::new("add-source-tabs")
                        .underline()
                        .small()
                        .selected_index(state.tab.index())
                        .children([
                            TabItem::new().label("已安装"),
                            TabItem::new().label("插件市场"),
                        ])
                        .on_click(move |index, window, cx| {
                            let tab = if *index == 0 {
                                Tab::Installed
                            } else {
                                Tab::Market
                            };
                            tabs(Action::SwitchAddSource(tab), window, cx);
                        }),
                ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------
// The installed tab
// ---------------------------------------------------------------------------

fn installed_tab(
    inner: Pixels,
    snapshot: &Snapshot,
    state: &State,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    match &state.step {
        Step::Choose => choose(inner, snapshot, dispatch, cx),
        Step::Configure {
            plugin,
            title,
            params,
        } => match snapshot.plugins.iter().find(|row| row.id == *plugin) {
            Some(row) => configure(row, title, params, dispatch, cx),
            // The plugin went away while the step was open. The next snapshot
            // resets the step; until then there is nothing to configure, so the
            // page shows the grid it would have shown anyway.
            None => choose(inner, snapshot, dispatch, cx),
        },
    }
}

/// The first step: every installed plugin is a target.
fn choose(inner: Pixels, snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    // A failed read takes the place of the grid rather than sitting above an
    // empty one: an empty grid would say "no plugins", which is a different
    // fact from "the plugins could not be read".
    if let Some(error) = &snapshot.error {
        return note(error, cx.theme().danger, cx);
    }

    if snapshot.plugins.is_empty() {
        return empty(dispatch, cx);
    }

    // The market always has something to fill every column; this tab has
    // whatever is installed. Two plugins should not be drawn as two quarters of
    // an otherwise empty row, so the column count follows the plugins when
    // there are fewer of them than the width would allow.
    let count = card_columns(inner).min(snapshot.plugins.len().max(1));
    let width = card_width(inner, count);

    let mut grid = v_flex().w_full().gap_4();

    for row in snapshot.plugins.chunks(count) {
        grid = grid.child(
            h_flex().w_full().items_stretch().gap_4().children(
                row.iter()
                    .map(|plugin| choose_card(plugin, width, dispatch, cx)),
            ),
        );
    }

    v_flex()
        .w_full()
        .gap_4()
        .child(
            h_flex()
                .w_full()
                .items_baseline()
                .gap_2()
                .child(
                    div()
                        .text_size(px(16.))
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(cx.theme().foreground)
                        .child("选择插件"),
                )
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child("一个插件可以添加多个信息源"),
                ),
        )
        .child(grid)
        .into_any_element()
}

/// Nothing installed: say so, and put the market one click away.
///
/// This is the one place the two tabs touch. It is a sentence and a button
/// rather than the market itself, because the market is a different job and the
/// reader asked for a source, not for a catalogue.
fn empty(dispatch: &Dispatch, cx: &App) -> AnyElement {
    let market = dispatch.clone();

    v_flex()
        .w_full()
        .gap_4()
        .child(
            v_flex()
                .gap_1()
                .child(
                    div()
                        .text_size(px(16.))
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(cx.theme().foreground)
                        .child("还没有安装插件"),
                )
                .child(
                    div()
                        .text_size(px(13.))
                        .line_height(px(20.))
                        .text_color(cx.theme().muted_foreground)
                        .child(format!(
                            "信息源由插件抓取。市场里有 {} 个内置插件，装好之后回到这里添加。",
                            crate::bundled::ALL.len()
                        )),
                ),
        )
        .child(
            Button::new("add-source-market")
                .primary()
                .small()
                .label("去插件市场")
                .on_click(move |_, window, cx| {
                    market(Action::SwitchAddSource(Tab::Market), window, cx);
                }),
        )
        .into_any_element()
}

/// One installed plugin, as a card.
///
/// Shaped like a market card because it is the same object seen twice: the
/// market shows what can be installed, this shows what is installed and what
/// it is for. The whole card is the target rather than a button on it:
/// choosing a plugin is the only thing this step does, and a card carrying one
/// button would leave most of itself inert.
fn choose_card(plugin: &PluginRow, width: Pixels, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let pick = dispatch.clone();
    let id = plugin.id;

    v_flex()
        .id(format!("add-source-pick-{id}"))
        .w(width)
        .h(CARD_HEIGHT)
        .justify_between()
        .gap_3()
        .p_4()
        .rounded(cx.theme().radius)
        .border_1()
        .border_color(cx.theme().border)
        .cursor_pointer()
        .hover(|this| this.bg(cx.theme().accent))
        .on_click(move |_, window, cx| {
            pick(Action::SelectAddSourcePlugin(id), window, cx);
        })
        .child(
            v_flex()
                .w_full()
                .gap_3()
                .child(
                    h_flex()
                        .w_full()
                        .gap_3()
                        .items_center()
                        .child(super::picture::icon(
                            plugin.icon.as_deref(),
                            px(40.),
                            cx.theme().radius,
                            PhosphorIcon::PuzzlePiece.regular(),
                            cx,
                        ))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap_1()
                                .child(
                                    div()
                                        .w_full()
                                        .truncate()
                                        .text_sm()
                                        .text_color(if plugin.enabled {
                                            cx.theme().foreground
                                        } else {
                                            cx.theme().muted_foreground
                                        })
                                        .child(plugin.name.clone()),
                                )
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .text_size(px(crate::theme::LABEL))
                                        .line_height(px(18.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(sources_meta(plugin)),
                                ),
                        ),
                )
                .child(
                    div()
                        .w_full()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(20.))
                        .line_clamp(2)
                        .text_color(cx.theme().muted_foreground)
                        .child(describe(plugin)),
                ),
        )
        .child(
            h_flex()
                .w_full()
                .h(px(28.))
                .items_center()
                .justify_between()
                .child(
                    div()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child("添加信息源"),
                )
                .child(
                    Icon::new(PhosphorIcon::CaretRight.regular())
                        .size_3()
                        .flex_shrink_0()
                        .text_color(cx.theme().muted_foreground),
                ),
        )
        .into_any_element()
}

/// The second step: name the subscription and fill in the plugin's form.
fn configure(
    plugin: &PluginRow,
    title: &Entity<InputState>,
    params: &Form,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    let back = dispatch.clone();
    let submit = dispatch.clone();

    let mut fields = v_flex()
        .w_full()
        .gap_1()
        .child(field_label("名称", cx))
        .child(Input::new(title).bordered(true));

    if !params.is_empty() {
        fields = fields.child(
            v_flex()
                .w_full()
                .mt_2()
                .gap_3()
                .child(field_label("要抓取什么", cx))
                .child(params.render(cx)),
        );
    }

    v_flex()
        .w_full()
        .max_w(FORM_WIDTH)
        .gap_5()
        .child(
            v_flex()
                .w_full()
                .gap_1()
                .child(
                    h_flex()
                        .w_full()
                        .items_baseline()
                        .gap_2()
                        .child(
                            div()
                                .min_w_0()
                                .truncate()
                                .text_size(px(16.))
                                .line_height(px(24.))
                                .font_weight(FontWeight(450.))
                                .text_color(cx.theme().foreground)
                                .child(plugin.name.clone()),
                        )
                        .child(
                            div()
                                .flex_shrink_0()
                                .text_size(px(crate::theme::LABEL))
                                .line_height(px(18.))
                                .text_color(cx.theme().muted_foreground)
                                .child(sources_meta(plugin)),
                        ),
                )
                .child(
                    div()
                        .w_full()
                        .min_w_0()
                        .text_size(px(13.))
                        .line_height(px(20.))
                        .text_color(cx.theme().muted_foreground)
                        .child(describe(plugin)),
                ),
        )
        .child(fields)
        .when(!plugin.enabled, |this| {
            this.child(
                div()
                    .w_full()
                    .text_size(px(crate::theme::LABEL))
                    .line_height(px(18.))
                    .text_color(cx.theme().warning)
                    .child("这个插件已停用。信息源会建好，但在插件页面重新启用它之前不会抓取。"),
            )
        })
        .child(
            div()
                .w_full()
                .text_size(px(crate::theme::LABEL))
                .line_height(px(18.))
                .text_color(cx.theme().muted_foreground)
                .child("一个信息源是这个插件的一次订阅；同一个插件可以添加多个。"),
        )
        .child(
            h_flex()
                .w_full()
                .justify_end()
                .gap_2()
                .child(
                    Button::new("add-source-back")
                        .ghost()
                        .small()
                        .label("上一步")
                        .on_click(move |_, window, cx| {
                            back(Action::AddSourceBack, window, cx);
                        }),
                )
                .child(
                    Button::new("add-source-submit")
                        .primary()
                        .small()
                        .label("添加信息源")
                        .on_click(move |_, window, cx| {
                            submit(Action::SubmitAddSource, window, cx);
                        }),
                ),
        )
        .into_any_element()
}

// ---------------------------------------------------------------------------
// The market tab
// ---------------------------------------------------------------------------

/// The market, as a grid of cards.
///
/// A market is browsed rather than read: the reader is comparing seven things
/// they have never seen, and a row of text makes that comparison a reading
/// exercise. Cards put the mark, the name and the one line the plugin says
/// about itself in the same place on every item, so the eye can move down a
/// column instead of across a sentence.
fn market_tab(inner: Pixels, snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    let count = card_columns(inner);
    let width = card_width(inner, count);

    let mut grid = v_flex().w_full().gap_4();

    for row in crate::bundled::ALL.chunks(count) {
        grid = grid.child(
            h_flex().w_full().items_stretch().gap_4().children(
                row.iter()
                    .map(|bundled| market_card(bundled, width, snapshot, dispatch, cx)),
            ),
        );
    }

    v_flex()
        .w_full()
        .gap_4()
        .child(
            h_flex()
                .w_full()
                .items_baseline()
                .gap_2()
                .child(
                    div()
                        .text_size(px(16.))
                        .line_height(px(24.))
                        .font_weight(FontWeight(450.))
                        .text_color(cx.theme().foreground)
                        .child("内置插件市场"),
                )
                .child(
                    div()
                        .min_w_0()
                        .truncate()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(18.))
                        .text_color(cx.theme().muted_foreground)
                        .child("编译在 Rome 里；装好后到「已安装」里添加信息源"),
                ),
        )
        .child(grid)
        .into_any_element()
}

/// One bundled plugin, as a card.
///
/// Installed and not installed are the same card with a different ending. An
/// installed plugin has no action here on purpose: this tab installs, and the
/// other tab subscribes. Saying "已安装" is the whole message.
fn market_card(
    bundled: &crate::bundled::Bundled,
    width: Pixels,
    snapshot: &Snapshot,
    dispatch: &Dispatch,
    cx: &App,
) -> AnyElement {
    let installed = snapshot
        .plugins
        .iter()
        .any(|plugin| plugin.plugin_id == bundled.plugin_id);

    let ending = if installed {
        div()
            .h(px(28.))
            .flex()
            .items_center()
            .text_size(px(crate::theme::LABEL))
            .line_height(px(18.))
            .text_color(cx.theme().muted_foreground)
            .child("已安装")
            .into_any_element()
    } else {
        let install = dispatch.clone();
        let slug = bundled.slug.to_owned();

        h_flex()
            .h(px(28.))
            .items_center()
            .child(
                Button::new(format!("add-source-install-{}", bundled.slug))
                    .small()
                    .label("安装")
                    .on_click(move |_, window, cx| {
                        install(Action::InstallBundled(slug.clone()), window, cx);
                    }),
            )
            .into_any_element()
    };

    v_flex()
        .w(width)
        .h(CARD_HEIGHT)
        .justify_between()
        .gap_3()
        .p_4()
        .rounded(cx.theme().radius)
        .border_1()
        .border_color(cx.theme().border)
        .child(
            v_flex()
                .w_full()
                .gap_3()
                .child(
                    h_flex()
                        .w_full()
                        .gap_3()
                        .items_center()
                        // The plugin's own mark, which its manifest declares.
                        // The glyph is for the two computed plugins that read
                        // other plugins' output and have no site of their own.
                        .child(super::picture::icon(
                            bundled.icon,
                            px(40.),
                            cx.theme().radius,
                            PhosphorIcon::PuzzlePiece.regular(),
                            cx,
                        ))
                        .child(
                            v_flex()
                                .flex_1()
                                .min_w_0()
                                .gap_1()
                                .child(
                                    div()
                                        .w_full()
                                        .truncate()
                                        .text_sm()
                                        .text_color(cx.theme().foreground)
                                        .child(bundled.name),
                                )
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .text_size(px(crate::theme::LABEL))
                                        .line_height(px(18.))
                                        .text_color(cx.theme().muted_foreground)
                                        .child(view_label(bundled.view)),
                                ),
                        ),
                )
                .child(
                    div()
                        .w_full()
                        .text_size(px(crate::theme::LABEL))
                        .line_height(px(20.))
                        .line_clamp(2)
                        .text_color(cx.theme().muted_foreground)
                        .child(bundled.description),
                ),
        )
        .child(ending)
        .into_any_element()
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/// A plain sentence where a grid of cards would otherwise be empty.
fn note(text: &str, color: Hsla, cx: &App) -> AnyElement {
    div()
        .w_full()
        .py_3()
        .border_b_1()
        .border_color(cx.theme().border)
        .text_size(px(crate::theme::LABEL))
        .line_height(px(18.))
        .text_color(color)
        .child(text.to_owned())
        .into_any_element()
}

/// What a plugin's source count looks like on its row.
fn sources_meta(plugin: &PluginRow) -> String {
    let count = match plugin.sources {
        0 => "还没有信息源".to_owned(),
        1 => "1 个信息源".to_owned(),
        n => format!("{n} 个信息源"),
    };

    if plugin.enabled {
        count
    } else {
        format!("已停用 · {count}")
    }
}

/// The description a plugin row falls back to when the manifest has none.
fn describe(plugin: &PluginRow) -> String {
    plugin
        .description
        .clone()
        .filter(|description| !description.trim().is_empty())
        .unwrap_or_else(|| plugin.plugin_id.clone())
}

fn field_label(text: &str, cx: &App) -> AnyElement {
    div()
        .text_size(px(crate::theme::LABEL))
        .text_color(cx.theme().foreground)
        .child(text.to_owned())
        .into_any_element()
}
