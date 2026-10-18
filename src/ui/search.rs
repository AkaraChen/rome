//! The search field in the middle column's header.
//!
//! A search box has to be a real text input — IME, selection, paste, a caret —
//! and in this component library a real input is an entity-backed `InputState`.
//! That collides with the middle column's contract: `entry_list::column` is a
//! pure function handed a `&App`, and `cx.new` needs `&mut App` plus a
//! `Window`. So the state entity is created once, on the foreground executor,
//! the first time the column renders; see [`ensure_created`]. The alternative —
//! a bare `div` catching key events and appending characters — cannot type
//! Chinese, cannot paste, and cannot show where the caret is, which is not a
//! search box.
//!
//! Typing is debounced. The worker answers a search with a database query, and
//! sending one per keystroke would put a query behind every letter for no
//! benefit: what the reader wants is the result of the word, not of each of its
//! prefixes.

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use gpui_kit::component::input::{Input, InputState};
use gpui_kit::component::{ActiveTheme, Icon, Sizable, h_flex};
use gpui_kit::*;
use gpui_kit_phosphor::PhosphorIcon;

use crate::snapshot::Snapshot;
use crate::worker::Command;

use super::{Action, Dispatch};

/// How long the field waits after the last keystroke before searching.
///
/// Short enough that a pause between words feels like the search keeping up,
/// long enough that typing a word sends one query rather than five. Clearing
/// skips the wait: an empty box that still shows the old results for a fifth of
/// a second reads as a bug.
const DEBOUNCE: Duration = Duration::from_millis(200);

thread_local! {
    /// The field's state entity, created on first render and kept for the
    /// lifetime of the process. `SearchField` owns it; this only holds it so
    /// the next render can find it without a view to hang it on.
    static FIELD: RefCell<Option<Entity<SearchField>>> = const { RefCell::new(None) };
    /// Guards against spawning a second creation task while the first is in
    /// flight, since a frame can render many times before the first one lands.
    static CREATING: Cell<bool> = const { Cell::new(false) };
    /// Whether the worker's last snapshot had a search. A true-to-false edge is
    /// how the field learns that something other than its own clear — a
    /// sidebar selection — dropped the query.
    static SEARCH_ACTIVE: Cell<bool> = const { Cell::new(false) };
    /// Bumped on every such edge. The field compares it across frames.
    static CLEAR_EPOCH: Cell<u64> = const { Cell::new(0) };
}

/// The search field, for the column header.
///
/// Falls back to a static-looking placeholder for the one frame before the
/// input entity exists, so the header does not change height a moment after the
/// window opens.
pub fn field(snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    note_search_state(snapshot.search.is_some());

    if let Some(field) = FIELD.with(|slot| slot.borrow().clone()) {
        return field.into_any_element();
    }

    ensure_created(dispatch, cx);
    placeholder(cx)
}

/// Notice a search that was dropped without the field's involvement.
///
/// The field clears the worker's query itself when the user empties it, and
/// that publishes a snapshot with no search too. The distinction matters only
/// for what to do with text the user typed after the clear but before the
/// snapshot arrived; the field records its own clears with `cleared`, so here
/// every edge is reported and the field decides.
fn note_search_state(active: bool) {
    let was_active = SEARCH_ACTIVE.with(|cell| cell.replace(active));

    if was_active && !active {
        CLEAR_EPOCH.with(|epoch| epoch.set(epoch.get() + 1));
    }
}

/// Create the field's entity when the app has a window to create it in.
///
/// The column only gets a `&App`, so the creation happens on the foreground
/// executor, where `AsyncApp` can hand out `&mut App` and a window handle. The
/// task runs before the next frame is drawn, so the placeholder is visible for
/// one frame at most.
fn ensure_created(dispatch: &Dispatch, cx: &App) {
    if CREATING.with(|creating| creating.replace(true)) {
        return;
    }

    let dispatch = dispatch.clone();
    cx.spawn(async move |cx| {
        let window = cx.update(|cx| cx.active_window().or_else(|| cx.windows().first().copied()));

        if let Some(window) = window {
            let _ = window.update(cx, |_, window, cx| {
                let field = cx.new(|cx| SearchField::new(window, cx, dispatch.clone()));
                FIELD.with(|slot| *slot.borrow_mut() = Some(field));
            });
        }

        CREATING.with(|creating| creating.set(false));
        // The frame that asked for this was drawn without the field; ask for
        // one more so there is no visible gap between the placeholder and the
        // real thing.
        cx.refresh();
    })
    .detach();
}

/// A search box, with the magnifier and the clear button the library draws.
struct SearchField {
    input: Entity<InputState>,
    dispatch: Dispatch,
    /// The text the field last reacted to, so a frame caused by something else
    /// does not re-send the same query.
    last: String,
    /// Bumped on every edit. A debounce task only dispatches if its token is
    /// still the current one, which is what makes the debounce a debounce and
    /// not one delayed query per keystroke.
    generation: Rc<Cell<u64>>,
    /// Whether the last query this field actually sent was empty.
    ///
    /// An empty query is what a clear looks like on the wire, and the worker
    /// answers it with a snapshot that has no search — the same snapshot a
    /// selection made elsewhere produces. This is how the field tells the two
    /// apart, so it does not wipe text typed while the clear was in flight.
    cleared: Rc<Cell<bool>>,
    /// The clear edge this field has already handled.
    epoch: u64,
}

impl SearchField {
    fn new(window: &mut Window, cx: &mut Context<Self>, dispatch: Dispatch) -> Self {
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("搜索")
                .clean_on_escape()
        });

        Self {
            input,
            dispatch,
            last: String::new(),
            generation: Rc::new(Cell::new(0)),
            cleared: Rc::new(Cell::new(false)),
            epoch: CLEAR_EPOCH.with(Cell::get),
        }
    }

    /// Send `query` after the debounce, unless a newer edit has landed.
    fn schedule(&self, window: &mut Window, cx: &mut Context<Self>, query: String) {
        self.generation.set(self.generation.get() + 1);
        let generation = self.generation.get();
        let current = self.generation.clone();
        let cleared = self.cleared.clone();
        let dispatch = self.dispatch.clone();

        let delay = if query.is_empty() {
            // Clearing is not an edit to be settled; the user wants the list
            // back now.
            Duration::ZERO
        } else {
            DEBOUNCE
        };

        window
            .spawn(cx, async move |cx| {
                cx.background_executor().timer(delay).await;

                if current.get() != generation {
                    return;
                }

                cleared.set(query.is_empty());

                let _ = cx.update(|window, cx| {
                    dispatch(Action::Worker(Command::Search(query)), window, cx);
                });
            })
            .detach();
    }
}

impl Render for SearchField {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // A selection made elsewhere clears the query. The box has to follow,
        // or it keeps claiming a filter the list is not applying. A clear this
        // field caused is skipped: the text after it is something the user
        // typed while the snapshot was in flight.
        let epoch = CLEAR_EPOCH.with(Cell::get);
        if epoch != self.epoch {
            self.epoch = epoch;

            if !self.cleared.replace(false) {
                self.input
                    .update(cx, |state, cx| state.set_value("", window, cx));
                self.last.clear();
                self.generation.set(self.generation.get() + 1);
            }
        }

        let value = self.input.read(cx).value().to_string();
        if value != self.last {
            self.last = value.clone();
            self.schedule(window, cx, value);
        }

        div().px_3().pb_2().child(
            Input::new(&self.input).small().cleanable(true).prefix(
                Icon::new(PhosphorIcon::MagnifyingGlass.regular())
                    .size_3()
                    .text_color(cx.theme().muted_foreground),
            ),
        )
    }
}

/// The field's shape before its entity exists.
///
/// Deliberately the same footprint as the input; it is replaced on the next
/// frame.
fn placeholder(cx: &App) -> AnyElement {
    h_flex()
        .mx_3()
        .mb_2()
        .h(px(30.))
        .items_center()
        .gap_2()
        .px_2p5()
        .rounded_md()
        .border_1()
        .border_color(cx.theme().border)
        .text_sm()
        .text_color(cx.theme().muted_foreground)
        .child(Icon::new(PhosphorIcon::MagnifyingGlass.regular()).size_3())
        .child("搜索")
        .into_any_element()
}
