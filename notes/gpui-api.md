# GPUI API notes for Rome

Versions actually on disk:

| Facade | Crate | Version |
| --- | --- | --- |
| `gpui_kit::*` | `gpui-pre` (lib name is **`gpui`**) | `0.3.9` |
| `gpui_kit::base` | `gpui-base` | `0.7.3` |
| `gpui_kit::component` | `gpui-component` | `0.7.3` |
| executor internals | `gpui-pre-scheduler` | `0.3.9` |
| channel crate (private dep) | `flume` | `0.12.0` |

`gpui-kit 0.7.3`'s manifest has `[dependencies.gpui] version = "=0.3.9"; package = "gpui-pre"`, so
`use gpui_kit::*;` is upstream GPUI 0.3.9. Its `lib.rs` also re-exports `gpui_base as base` and
`gpui_component as component`.

Everything below was read from the crate sources under
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/…`. Statements marked **verified** were
also compiled: a scratch crate (`/tmp/rome_api_check`) depending on `gpui-kit 0.7.3` was checked
with `cargo check`, including the concurrency sketch, every component listed in B, the flume
variant, the file picker, and the second-window call.

---

## A. Concurrency

### A1. Spawning an async task tied to an entity

`gpui-pre` 0.3.9, `src/app/context.rs:230`:

```rust
impl<'a, T: 'static> Context<'a, T> {
    #[track_caller]
    #[inline(always)]
    pub fn spawn<AsyncFn, R>(&self, f: AsyncFn) -> Task<R>
    where
        T: 'static,
        AsyncFn: AsyncFnOnce(WeakEntity<T>, &mut AsyncApp) -> R + 'static,
        R: 'static,
    { ... }
}
```

* The closure receives `WeakEntity<T>` and `&mut AsyncApp`.
* Bounds are `'static` only. **No `Send`** — the future is `.boxed_local()` and runs on the
  *foreground* (main-thread) executor (`src/app.rs:2297`).
* Note `&self`, not `&mut self`, so it can be called from `new`, from a handler, or from `render`
  (don't do the last one per frame).
* `Task<R>` is `#[must_use]`. **Dropping it cancels the task**; `.detach()` lets it run on
  (`gpui-pre-scheduler-0.3.9/src/executor.rs:398-402, 571-578`).

Window-bound variant, `src/app/context.rs:690`:

```rust
pub fn spawn_in<AsyncFn, R>(&self, window: &Window, f: AsyncFn) -> Task<R>
where
    R: 'static,
    AsyncFn: AsyncFnOnce(WeakEntity<T>, &mut AsyncWindowContext) -> R + 'static;
```

Other spellings:

```rust
// src/app.rs:2297
impl App {
    pub fn spawn<AsyncFn, R>(&self, f: AsyncFn) -> Task<R>
    where
        AsyncFn: AsyncFnOnce(&mut AsyncApp) -> R + 'static,
        R: 'static;
}

// src/app/async_context.rs:218
impl AsyncApp {
    pub fn spawn<AsyncFn, R>(&self, f: AsyncFn) -> Task<R>
    where
        AsyncFn: AsyncFnOnce(&mut AsyncApp) -> R + 'static,
        R: 'static;
}
```

### A2. Getting back onto the main thread

`src/app/entity_map.rs:803`:

```rust
impl<T: 'static> WeakEntity<T> {
    #[inline(always)]
    pub fn update<C, R>(
        &self,
        cx: &mut C,
        update: impl FnOnce(&mut T, &mut Context<T>) -> R,
    ) -> Result<R>
    where
        C: AppContext;
}
```

* Returns `anyhow::Result<R>`; `Err` if the entity was released.
* The closure receives `&mut T` (your state) and `&mut Context<T>` (for `cx.notify()`).
* Call `cx.notify()` inside to mark the entity dirty and repaint.

Strong-handle variant, `src/app/entity_map.rs:497`:

```rust
impl<T: 'static> Entity<T> {
    pub fn update<R, C: AppContext>(
        &self,
        cx: &mut C,
        update: impl FnOnce(&mut T, &mut Context<T>) -> R,
    ) -> R;                       // no Result: panics if released
}
```

Other contexts:

```rust
// src/app/async_context.rs:176 — app-level state, no entity
pub fn update<R>(&self, f: impl FnOnce(&mut App) -> R) -> R;

// src/app/async_context.rs:315 — window + app
impl AsyncWindowContext {
    pub fn update<R>(&mut self, update: impl FnOnce(&mut Window, &mut App) -> R) -> Result<R>;
}
```

**The bound that bites:** `AsyncApp` is `!Send` (it holds `std::rc::Weak<AppCell>`, and `AppCell` is
a thread-local `RefCell`), and `Context<'a, T>` is `!Send` because it holds `&'a mut App`. You
therefore *cannot* carry an `AsyncApp` or `Context<T>` into a `background_executor().spawn` future.
(`Entity<T>` / `WeakEntity<T>` themselves are made of `std::sync::Weak<RwLock<…>>` + IDs and can be
`Send`, but every operation on them needs an `App`/`AsyncApp`, so they are unusable from another
thread in practice.) The working shape is:

1. `background_executor().spawn(...)` does the blocking work and **returns a plain `Send` value**;
2. a foreground `Context::spawn` task `.await`s that `Task` and then calls
   `weak_entity.update(cx, ...)`.

```rust
let executor = cx.background_executor().clone();
let slow: Task<Vec<String>> = executor.spawn(async move { expensive() });

cx.spawn(async move |this, cx| {
    let rows = slow.await;                     // still on the main thread here
    let _ = this.update(cx, |app, cx| {        // cx: &mut AsyncApp
        app.rows = rows;
        cx.notify();
    });
})
.detach();
```

**Verified:** the above compiles (`cx.background_executor()` is available inside `Context` because
`Context` derefs to `App`).

### A3. Background executor

`src/app.rs:2229` and `src/app/async_context.rs:159`:

```rust
impl App      { pub fn background_executor(&self) -> &BackgroundExecutor; }
impl AsyncApp { pub fn background_executor(&self) -> &BackgroundExecutor; }
```

`src/executor.rs:101-128`:

```rust
impl BackgroundExecutor {
    #[track_caller]
    pub fn spawn<R>(&self, future: impl Future<Output = R> + Send + 'static) -> Task<R>
    where
        R: Send + 'static;

    #[track_caller]
    pub fn spawn_with_priority<R>(
        &self,
        priority: Priority,
        future: impl Future<Output = R> + Send + 'static,
    ) -> Task<R>
    where
        R: Send + 'static;

    pub fn timer(&self, duration: Duration) -> Task<()>;
    pub fn num_cpus(&self) -> usize;
    pub fn is_main_thread(&self) -> bool;
    pub async fn scoped<'scope, F>(&self, scheduler: F);
}
```

There is also the `AppContext` trait method, `src/app/async_context.rs:131`:

```rust
fn background_spawn<R>(&self, future: impl Future<Output = R> + Send + 'static) -> Task<R>
where
    R: Send + 'static;
```

so `cx.background_spawn(async move { ... })` works anywhere a `&App`/`&Context` is in scope.
**Verified compiling.**

`BackgroundExecutor::spawn` is a real thread pool. `ForegroundExecutor::spawn` is the main-thread
executor and does **not** require `Send`.

### A4. Channels

* **No channel type is re-exported by `gpui` or `gpui-kit`.** A grep for `flume` across
  `gpui-pre-0.3.9/src` returns nothing. `flume` is a *private* dependency of
  `gpui-pre-scheduler 0.3.9`:

  ```toml
  # gpui-pre-scheduler-0.3.9/Cargo.toml
  [dependencies.flume]
  version = "0.12"
  features = ["async"]
  # plus "flume/spin" from the feature list
  ```

  `Cargo.lock` here resolves it to **`flume 0.12.0`**. If you want flume, add
  `flume = "0.12"` to `Cargo.toml` yourself (it is not reachable through `gpui_kit::*`).

* **`flume::Receiver::recv_async()` works inside `Context::spawn`.** **Verified compiling.** It
  works because `Context::spawn` uses `boxed_local()` — the future does not need to be `Send`, and
  flume's async recv is executor-agnostic. The foreground executor polls it; flume's waker wakes the
  main loop.

* **Zero-new-dependency alternative:** `tokio` is already a direct dependency of Rome with the
  `sync` feature. `tokio::sync::mpsc::unbounded_channel` gives a `Send` sender usable from the
  worker thread (`send()` is synchronous) and an async receiver usable in `Context::spawn`
  (`recv().await`). **Verified compiling.** Use `blocking_recv()` on the worker side.

* Do **not** use `std::sync::mpsc` in the async half — it has no `recv().await`.

### A5. The persistent worker pattern

**Verified compiling** (scratch crate, `cargo check`). This is the flume version, since that is
what was asked about; replacing `flume::unbounded` with `tokio::sync::mpsc::unbounded_channel` and
`recv_async().await` with `recv().await` / `recv()` with `blocking_recv()` is the equivalent
no-new-dependency form.

```rust
use std::thread;

use gpui_kit::*;
use flume::{Receiver, Sender};

enum Command {
    Refresh,
}

enum Event {
    Loaded(Vec<String>),
    Failed(String),
}

struct RomeApp {
    /// UI -> worker. Non-blocking: `unbounded` never makes the UI wait.
    commands: Sender<Command>,
    /// Last snapshot published by the worker; `render` only reads this.
    rows: Vec<String>,
    /// Both handles are kept so the worker and the pump die with the entity.
    /// Dropping a `Task` cancels it, so `_pump` must be stored (or detached).
    _worker: thread::JoinHandle<()>,
    _pump: Task<()>,
}

impl RomeApp {
    fn new(database_path: std::path::PathBuf, cx: &mut Context<Self>) -> Self {
        let (command_tx, command_rx) = flume::unbounded::<Command>();
        let (event_tx, event_rx) = flume::unbounded::<Event>();

        // Everything blocking lives here, and the database handle is opened
        // on this thread so it never crosses a thread boundary at all.
        let worker = thread::spawn(move || {
            let mut database = rome::db::Database::open(&database_path)
                .expect("could not open the database");

            while let Ok(command) = command_rx.recv() {
                match command {
                    Command::Refresh => {
                        // May block for up to 30 s. That is fine here.
                        let rows: Vec<String> = Vec::new();
                        if event_tx.send(Event::Loaded(rows)).is_err() {
                            break; // the UI is gone
                        }
                    }
                }
            }
        });

        // The pump is a foreground task: it only ever awaits, never blocks.
        let pump = cx.spawn(async move |this, cx| {
            while let Ok(event) = event_rx.recv_async().await {
                let applied = this.update(cx, |app: &mut Self, cx| {
                    match event {
                        Event::Loaded(rows) => app.rows = rows,
                        Event::Failed(message) => { /* show the error */ }
                    }
                    cx.notify(); // repaint this entity
                });

                if applied.is_err() {
                    break; // entity was released; stop the pump
                }
            }
        });

        Self {
            commands: command_tx,
            rows: Vec::new(),
            _worker: worker,
            _pump: pump,
        }
    }

    fn refresh(&self) {
        let _ = self.commands.send(Command::Refresh);
    }
}
```

Notes on the bounds:

* `std::thread::spawn` needs `Send + 'static`. So `Command: Send`, `Event: Send`, and
  `Sender<T>`/`Receiver<T>` are `Send` when `T: Send`. `PathBuf` is `Send`.
* `rome::db::Database` **is `Send`** (verified with `fn assert_send<T: Send>()` plus
  `assert_send::<rome::db::Database>()`), so you *may* construct it on the UI thread and move it.
  Constructing it inside the worker is still the simplest rule.
* `Context::spawn` needs only `'static` on `T` and the closure. The pump future is `!Send` by
  design and that is allowed.
* **The receiver cannot live in both the entity and the pump.** The pump must own
  `Receiver<Event>` for its `'static` closure. The entity keeps the `Task<()>`, which owns the
  pump, which owns the receiver — so dropping the entity still tears everything down. If you
  specifically want the entity to hold the receiver, the alternative is a second "wake" channel:
  the pump awaits a `()` wake, then calls `this.update(...)` and the entity drains
  `self.events.try_recv()` in a loop. That is strictly more machinery for the same result.
* Use `flume::bounded(n)` if you want backpressure from UI to worker. Beware `send()` on a bounded
  channel from the UI thread: it blocks. Prefer `try_send` there.
* Awaiting a channel does not block the UI thread. A 30 s database call must never be `.await`ed
  directly in `Context::spawn`, because that would block the foreground executor; it must happen
  on the worker thread (or a `background_executor` task).

---

## B. Component inventory (gpui-component 0.7.3)

Import paths are exact; note that only `ActiveTheme`, `Icon`, `Sizable`, `VirtualList`,
`v_virtual_list`, `h_virtual_list`, `WindowExt`, `h_flex`, `v_flex` and a handful of traits are
re-exported at `gpui_kit::component`'s root. Everything else is under its own module.

| # | Need | Status | Import / constructor |
| --- | --- | --- | --- |
| 1 | Virtualised list | yes | see below |
| 2 | Modal / dialog | yes | `component::dialog::{Dialog, AlertDialog}` + `WindowExt::open_dialog` |
| 3 | Text input | yes | `component::input::{Input, InputState, Textarea, TextareaState, Editor, EditorState}` |
| 4 | Checkbox / switch / toggle | yes | `component::checkbox::Checkbox`, `component::switch::Switch`, `component::radio::{Radio, RadioGroup}`, `component::button::Toggle` |
| 5 | Select / dropdown / combobox | yes | `component::select::{Select, SelectState}`, `component::combobox::{Combobox, ComboboxState}` |
| 6 | Tabs | yes | `component::tab::{Tab, TabBar}` |
| 7 | Tooltip | partial | `component::tooltip::Tooltip`; arbitrary-element attachment is **not public** |
| 8 | Native file picker | yes, in GPUI itself | `App::prompt_for_paths` / `prompt_for_new_path` (no `rfd`) |
| 9 | Spinner / progress | yes | `component::spinner::Spinner`, `component::progress::{Progress, ProgressCircle}` |
| 10 | Toast / notification | yes | `component::notification::Notification` + `WindowExt::push_notification` |

### B1. Virtualised list

Three real options:

**(a) GPUI's `uniform_list` — simplest for 10k fixed-height rows.**
`gpui-pre-0.3.9/src/elements/uniform_list.rs:22`, exported as `gpui_kit::uniform_list`:

```rust
#[track_caller]
pub fn uniform_list<R>(
    id: impl Into<ElementId>,
    item_count: usize,
    f: impl 'static + Fn(Range<usize>, &mut Window, &mut App) -> Vec<R>,
) -> UniformList
where
    R: IntoElement;
```

It only builds the visible range. `UniformList` has `.with_sizing_behavior(...)`; scroll with
`UniformListScrollHandle`.

**(b) gpui-component / gpui-base `VirtualList` — variable row heights.**
`gpui-base-0.7.3/src/virtual_list.rs:139`, re-exported as
`gpui_kit::component::{VirtualList, VirtualListScrollHandle, v_virtual_list, h_virtual_list}`:

```rust
pub fn v_virtual_list<R, V>(
    view: Entity<V>,
    id: impl Into<ElementId>,
    item_sizes: Rc<Vec<Size<Pixels>>>,
    f: impl 'static + Fn(&mut V, Range<usize>, &mut Window, &mut Context<V>) -> Vec<R>,
) -> VirtualList
where
    R: IntoElement,
    V: Render;
```

```rust
pub fn h_virtual_list<R, V>(
    view: Entity<V>,
    id: impl Into<ElementId>,
    item_sizes: Rc<Vec<Size<Pixels>>>,
    f: impl 'static + Fn(&mut V, Range<usize>, &mut Window, &mut Context<V>) -> Vec<R>,
) -> VirtualList
where
    R: IntoElement,
    V: Render;
```

Builders: `VirtualList::track_scroll(&VirtualListScrollHandle)`,
`.with_sizing_behavior(ListSizingBehavior)`, `.with_item_to_measure_index(usize)`.
Call it from `render` with `cx.entity()` as the view. **Verified compiling.**

**(c) gpui-component `List` with selection/search — needs a delegate.**
`gpui-component-0.7.3/src/list/list.rs`:

```rust
pub struct ListState<D: ListDelegate> { ... }
impl<D> ListState<D> where D: ListDelegate {
    pub fn new(delegate: D, window: &mut Window, cx: &mut Context<Self>) -> Self;
    pub fn searchable(mut self, searchable: bool) -> Self;
    pub fn selectable(mut self, selectable: bool) -> Self;
    pub fn set_selected_index(...);
    pub fn scroll_to_item(...);
    pub fn scroll_handle(&self) -> &VirtualListScrollHandle;
}

pub struct List<D: ListDelegate + 'static> { ... }
impl<D: ListDelegate + 'static> List<D> {
    pub fn new(state: &Entity<ListState<D>>) -> Self;
    pub fn scrollbar_visible(mut self, visible: bool) -> Self;
    pub fn search_placeholder(mut self, placeholder: impl Into<SharedString>) -> Self;
}
```

`ListDelegate` (`list/delegate.rs:10`) requires `type Item: Selectable + IntoElement`,
`items_count(&self, section, &App) -> usize`, and
`render_item(&mut self, ix: IndexPath, &mut Window, &mut Context<ListState<Self>>) -> Option<Self::Item>`.
Other methods have defaults.

There is also GPUI's own variable-height `gpui_kit::list(ListState, render_item)` with
`gpui_kit::ListState::new(item_count, alignment, overdraw)`
(`gpui-pre-0.3.9/src/elements/list.rs:24,314`).

**Recommendation:** `uniform_list` for the entry rows; `v_virtual_list` if rows differ in height;
`List`/`ListState` only if you want its built-in query field and selection model.

### B2. Modal / dialog

```rust
use gpui_kit::component::dialog::{Dialog, AlertDialog};
use gpui_kit::component::WindowExt as _;

window.open_dialog(cx, |dialog, _window, _cx| dialog.title("Import"));
```

`WindowExt` (`gpui-component/src/window_ext.rs:75`):

```rust
fn open_dialog<F>(&mut self, cx: &mut App, build: F)
where F: Fn(Dialog, &mut Window, &mut App) -> Dialog + 'static;

fn open_alert_dialog<F>(&mut self, cx: &mut App, build: F)
where F: Fn(AlertDialog, &mut Window, &mut App) -> AlertDialog + 'static;

fn has_active_dialog(&mut self, cx: &mut App) -> bool;
fn close_dialog(&mut self, cx: &mut App);
fn close_all_dialogs(&mut self, cx: &mut App);
```

`Dialog` (`dialog/dialog.rs:303`):

```rust
pub fn new(cx: &mut App) -> Self;
pub fn trigger(self, trigger: impl IntoElement) -> Self;
pub fn content<F>(self, builder: F) -> Self;      // F: Fn(AnyView, &mut Window, &mut Context<Dialog>) -> AnyView
pub fn title(self, title: impl IntoElement) -> Self;
pub fn footer(self, footer: impl IntoElement) -> Self;
pub fn button_props(self, props: DialogButtonProps) -> Self;
pub fn on_close(...), on_ok(...), on_cancel(...);
pub fn close_button(self, bool) -> Self;
pub fn w(self, impl Into<Pixels>) -> Self;
pub fn width(self, impl Into<Pixels>) -> Self;
pub fn max_w(self, impl Into<Pixels>) -> Self;
pub fn overlay(self, bool) -> Self;
pub fn overlay_closable(self, bool) -> Self;
pub fn keyboard(self, bool) -> Self;
pub fn entrance(self, DialogEntrance) -> Self;
```

Side panel instead of centred modal: `component::Sheet` + `WindowExt::open_sheet(cx, build)` /
`open_sheet_at(placement, cx, build)`.

**Requirement:** the window root must be `gpui_base::Root` for dialog/notification layers.
`gpui_kit::open_window` already wraps your view in `base::Root`.

### B3. Text input

```rust
use gpui_kit::component::input::{Input, InputState, Textarea, TextareaState};
```

Single line — `gpui-base-0.7.3/src/input/base/state.rs:10920`:

```rust
impl InputBaseState<InputMode> {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self;
}
// pub type InputState = InputBaseState<InputMode>;
```

Multi-line — `gpui-base/src/input/base/state.rs:11122`:

```rust
impl InputBaseState<TextareaMode> {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self;
}
// pub type TextareaState = InputBaseState<TextareaMode>;
```

Views (`gpui-component/src/input/input.rs:213`, `textarea.rs:70`):

```rust
Input::new(state: &Entity<InputState>)
Textarea::new(state: &Entity<TextareaState>)
```

Builder methods on the view: `.appearance(bool)`, `.bordered(bool)`, `.cleanable(bool)`,
`.disabled(bool)`, `.readonly(bool)`, `.prefix(impl IntoElement)`, `.suffix(...)`, `.h(...)`,
`.mask_toggle()`, `.content_type(InputContentType)`, `.tab_index(isize)`, `.on_paste(...)`.

State side: `.placeholder(impl Into<SharedString>)` (builder), `set_placeholder`, `set_value`,
`value() -> SharedString`, `text() -> &Rope`, `focus(&mut Window, &mut Context<Self>)`,
`focus_handle() -> &FocusHandle`.

`Editor` / `EditorState` (in the same module) is the code-editor variant.

**Verified compiling** with `cx.new(|cx| InputState::new(window, cx).placeholder("搜索"))`.

### B4. Checkbox / switch / toggle

```rust
use gpui_kit::component::checkbox::Checkbox;
use gpui_kit::component::switch::Switch;
use gpui_kit::component::radio::{Radio, RadioGroup};
```

`Checkbox::new(id)`, `Switch::new(id)`; both share:

```rust
.checkbox: .checked(bool) .label(impl Into<Text>) .on_change(impl Fn(&bool, &mut Window, &mut App) + 'static)
           .on_click(...) .disabled(bool) .tooltip(impl Into<SharedString>) .tab_index(isize) .tab_stop(bool)
.switch:   .checked(bool) .label(...) .on_change<F>(F) .on_click<F>(F) .color(impl Into<Hsla>) .tooltip(...)
```

Both implement `Sizable` (`.small()`, `.large()`, `.with_size(impl Into<Size>)`).
`RadioGroup::vertical(id)` / `::horizontal(id)` with `.selected_index(Option<usize>)`,
`.on_change(|&usize, &mut Window, &mut App|)`.

### B5. Select / dropdown / combobox

```rust
use gpui_kit::component::select::{Select, SelectState};
use gpui_kit::component::combobox::{Combobox, ComboboxState};
use gpui_kit::component::searchable_list::{SearchableListDelegate, SearchableListItem};
```

`SelectState` (`select.rs:152`):

```rust
impl<D> SelectState<D>
where
    D: SearchableListDelegate + 'static,
    <D::Item as SearchableListItem>::Value: PartialEq + Clone,
{
    pub fn new(
        delegate: D,
        selected_index: Option<IndexPath>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self;

    pub fn searchable(mut self, searchable: bool) -> Self;
    pub fn set_items(&mut self, items: D, &mut Window, &mut Context<Self>);
    pub fn selected_index(&self, cx: &App) -> Option<IndexPath>;
    pub fn selected_value(&self) -> Option<&<D::Item as SearchableListItem>::Value>;
    pub fn focus(&self, window: &mut Window, cx: &mut App);
}
```

`Select::new(state: &Entity<SelectState<D>>)` (`select.rs:649`) with `.placeholder(...)`,
`.cleanable(bool)`, `.disabled(bool)`, `.icon(Icon)`, `.title_prefix(...)`, `.menu_width(...)`,
`.menu_max_h(...)`, `.search_placeholder(...)`, `.empty(...)`, `.appearance(bool)`.

`SearchableListItem` (`searchable_list/delegate.rs:8`) needs `type Value: Clone + PartialEq`,
`fn title(&self) -> SharedString`, `fn value(&self) -> &Self::Value`; `render`, `display_title`,
`matches` and `disabled` have defaults. `SearchableListDelegate` needs `type Item`,
`items_count(&self, section) -> usize`, `item(&self, ix: IndexPath) -> Option<&Item>`, and
`position<V>(&self, &V) -> Option<IndexPath>`; `perform_search`, section headers and row rendering
have defaults.

**Verified compiling** with a two-field row type and a minimal delegate. A subtlety worth knowing:
inside `position<V>`, write `let candidate: &V = row.value(); candidate == value` — comparing
`&row.id` directly fails to unify `usize` with `V` under the associated-type bound.

`Combobox` is the multi-select / custom-trigger variant: `ComboboxState::new(...)` plus
`.multiple(bool)`, `.searchable(bool)`, `.selected_values()`, `.set_selected_values(...)`;
`Combobox::new(&entity)` plus `.render_trigger(...)`, `.footer(...)`, `.check_icon(...)`.

### B6. Tabs

```rust
use gpui_kit::component::tab::{Tab, TabBar};
```

`TabBar::new(id)` (`tab/tab_bar.rs:60`):

```rust
.with_variant(TabVariant) / .pill() / .outline() / .segmented() / .underline()
.menu(bool) .max_width(impl Into<Pixels>) .track_scroll(&ScrollHandle)
.prefix(impl IntoElement) .suffix(impl IntoElement)
.children(impl IntoIterator<Item = impl Into<Tab>>) .child(impl Into<Tab>)
.selected_index(usize)
.on_click(|&usize, &mut Window, &mut App| + 'static)
```

`Tab::new()` (`tab/tab.rs:478`): `.label(impl Into<SharedString>)`, `.icon(Icon)`,
`.disabled(bool)`, `.prefix(...)`, `.suffix(...)`, `.on_click(...)`, same variant helpers.

### B7. Tooltip — partial

```rust
use gpui_kit::component::tooltip::Tooltip;
```

`tooltip.rs:42`:

```rust
pub fn new(text: impl Into<Text>) -> Self;
pub fn element<E, F>(builder: F) -> Self
where E: IntoElement, F: Fn(&mut Window, &mut App) -> E + 'static;
pub fn action(mut self, action: &dyn Action, context: Option<&str>) -> Self;
pub fn key_binding(mut self, key_binding: Option<Kbd>) -> Self;
pub fn build(self, _: &mut Window, cx: &mut App) -> AnyView;   // cx.new(|_| self)
```

`Tooltip` implements `Render`, not `IntoElement`.

**Limitation:** the machinery that attaches a tooltip to an arbitrary element
(`ManagedTooltipExt`, `ComponentTooltip`) is `pub(crate)` in 0.7.3. What *is* public is the
`.tooltip(impl Into<SharedString>)` builder on components that have it built in: `Button`,
`Checkbox`, `Switch`, `Radio`, `Clipboard`, `Attachment`. For a bare `div`, either wrap the content
in a `Button`/`Checkbox`-style component or build your own hover + overlay. This is a real gap, not
an import-path problem.

### B8. Native file picker — yes, but not from gpui-component

There is **no** `rfd` dependency (grep of `Cargo.lock` and all three manifests: zero hits), and
gpui-component has no file-picker component. But GPUI itself exposes the platform's native dialog
(`gpui-pre-0.3.9/src/app.rs:1891,1904`):

```rust
impl App {
    pub fn prompt_for_paths(
        &self,
        options: PathPromptOptions,
    ) -> oneshot::Receiver<Result<Option<Vec<PathBuf>>>>;

    pub fn prompt_for_new_path(
        &self,
        directory: &Path,
        suggested_name: Option<&str>,
    ) -> oneshot::Receiver<Result<Option<PathBuf>>>;
}
```

`PathPromptOptions` (`src/platform.rs:2802`):

```rust
pub struct PathPromptOptions {
    pub files: bool,
    pub directories: bool,
    pub multiple: bool,
    pub prompt: Option<SharedString>,
}
```

The macOS backend implements both (`gpui-pre-macos-0.3.9/src/platform.rs:898,946`). Await the
receiver inside a foreground task:

```rust
let rx = cx.prompt_for_paths(PathPromptOptions {
    files: true,
    directories: false,
    multiple: false,
    prompt: Some("选择插件".into()),
});

cx.spawn(async move |this, cx| {
    if let Ok(Ok(Some(paths))) = rx.await {
        let _ = this.update(cx, |app, cx| {
            app.rows = paths.iter().map(|p| p.display().to_string()).collect();
            cx.notify();
        });
    }
})
.detach();
```

**Verified compiling.** Note the double `Result`: the outer is `oneshot::Canceled`, the inner is
the platform's `anyhow::Result`, and `None` means the user cancelled. `App::reveal_path` and
`App::open_with_system` also exist.

### B9. Spinner / progress

```rust
use gpui_kit::component::spinner::Spinner;
use gpui_kit::component::progress::{Progress, ProgressCircle};
```

`Spinner::new()` + `.icon(impl Into<Icon>)`, `.color(Hsla)`, `.ease(impl Fn(f32) -> f32)`; implements
`Sizable`.

`Progress::new(id)` + `.value(f32)` (0.0..=1.0), `.loading(bool)`, `.color(impl Into<Hsla>)`,
`.accessibility_label(...)`. `ProgressCircle` has the same builder set.

Also in the crate if you want a placeholder rather than a spinner: `component::skeleton::Skeleton`,
`component::shimmer::Shimmer`.

### B10. Toast / notification

```rust
use gpui_kit::component::notification::Notification;
use gpui_kit::component::WindowExt as _;

window.push_notification(Notification::info("已刷新"), cx);
```

`Notification::new()` / `info(msg)` / `success(msg)` / `warning(msg)` / `error(msg)`; builders
`.title(...)`, `.icon(...)`, `.autohide(bool)`, `.placement(Anchor)`, `.delivery(NotificationDelivery)`,
`.system()`, `.in_app_and_system()`, `.on_click(...)`, `.on_close(...)`, `.action(...)`,
`.id::<T>()`, `.id1::<T>(key)`.

`WindowExt` methods: `push_notification`, `remove_notification::<T>(cx)`,
`remove_notification1::<T>(key, cx)`, `clear_notifications(cx)`, `notifications(cx) -> Rc<Vec<Entity<Notification>>>`.
`WindowState` (the `Root` layer) has the same methods if you have it directly.

### Second window

Yes. `gpui-kit` exposes `open_window` (`src/lib.rs:176`):

```rust
pub fn open_window<V: Render>(
    options: WindowOptions,
    cx: &mut App,
    build: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> Result<(AnyWindowHandle, Entity<V>)>;
```

It is a thin wrapper over `App::open_window` (`gpui-pre-0.3.9/src/app.rs:1500`):

```rust
pub fn open_window<V: 'static + Render>(
    &mut self,
    options: WindowOptions,
    build_root_view: impl FnOnce(&mut Window, &mut App) -> Entity<V>,
) -> anyhow::Result<WindowHandle<V>>;
```

Also `AsyncApp::open_window(&self, options, build_root_view) -> Result<WindowHandle<V>>`
(`async_context.rs:199`).

Called from a handler on an existing view:

```rust
cx.open_window(WindowOptions::default(), |_window, cx| {
    cx.new(|_| SecondWindow)
})
.expect("second window");
```

**Verified compiling.** `gpui_kit::open_window` wraps the view in `base::Root`, so the second
window gets dialogs/notifications too. There is no webview component in gpui-kit; for the login
webview you would need a platform view (WKWebView on macOS) embedded via GPUI's platform hooks —
that is outside these crates.

---

## C. Theming

`ActiveTheme` (`gpui-component/src/theme/mod.rs:44`) is implemented for `App`, so `cx.theme()`
works in views and handlers:

```rust
pub trait ActiveTheme {
    fn theme(&self) -> &Theme;
}
impl ActiveTheme for App { fn theme(&self) -> &Theme { Theme::global(self) } }
```

`Theme` (`theme/mod.rs:147`) derefs to `ThemeColor` (`theme/mod.rs:220`), so the flat accessors
used throughout Rome are exactly the colour fields:

```rust
cx.theme().background            // == cx.theme().colors.background
cx.theme().foreground
cx.theme().muted_foreground
cx.theme().border
cx.theme().primary
cx.theme().danger
```

**`ThemeColor` fields** (`theme/theme_color.rs:59`, all `Hsla`):

`accent`, `accent_foreground`, `background`, `border`, `button`, `button_active`, `button_foreground`,
`button_hover`, `button_primary`, `button_primary_foreground`, `button_danger`, `button_info`,
`button_success`, `button_warning`, `caret`, `danger`, `danger_active`, `danger_foreground`,
`danger_hover`, `foreground`, `info`, `info_active`, `info_foreground`, `info_hover`, `input`,
`link`, `link_active`, `link_hover`, `list`, `list_active`, `list_active_border`, `list_even`,
`list_head`, `list_hover`, `muted`, `muted_foreground`, `popover`, `popover_foreground`, `primary`,
`primary_active`, `primary_foreground`, `primary_hover`, `progress_bar`, `ring`, `scrollbar`,
`scrollbar_thumb`, `scrollbar_thumb_hover`, `secondary`, `secondary_active`, `secondary_foreground`,
`secondary_hover`, `selection`, `sidebar`, `sidebar_accent`, `sidebar_accent_foreground`,
`sidebar_border`, `sidebar_foreground`, `sidebar_primary`, `sidebar_primary_foreground`, `skeleton`,
`slider_bar`, `slider_thumb`, `success`, `success_foreground`, `success_hover`, `success_active`,
`switch`, `switch_thumb`, `tab`, `tab_active`, `tab_active_foreground`, `tab_bar`,
`tab_bar_segmented`, `tab_foreground`, `table`, `table_active`, `table_active_border`, `table_even`,
`table_head`, `table_head_foreground`, `table_foot`, `table_foot_foreground`, `table_hover`,
`table_row_border`, `title_bar`, `title_bar_border`, `status_bar`.

`Theme`'s own fields: `font_family: SharedString`, `font_size: Pixels` (default 16px),
`mono_font_family`, `mono_font_size`, `radius: Pixels`, `radius_lg: Pixels`, `shadow: bool`,
`focus_ring: bool`, `scrollbar_mode`, `notification: NotificationSettings`, `list: ListSettings`,
`sheet: SheetSettings`, `motion: MotionTokens`, `mode: ThemeMode`.

Methods on `Theme` (`theme/mod.rs:239-612`):

```rust
pub fn global(cx: &App) -> &Theme;
pub fn global_mut(cx: &mut App) -> &mut Theme;
pub fn update<R>(cx: &mut App, edit: impl FnOnce(&mut Theme) -> R) -> R;
pub fn change(mode: impl Into<ThemeMode>, window: Option<&mut Window>, cx: &mut App);
pub fn is_dark(&self) -> bool;
pub fn input_background(&self) -> Hsla;
pub fn semantic_tokens(&self) -> SemanticThemeTokens;
pub fn color_tokens(&self) -> ColorTokens;
pub fn typography_tokens(&self) -> TypographyTokens;
pub fn spacing_tokens(&self) -> SpacingTokens;
pub fn radius_tokens(&self) -> RadiusTokens;
pub fn radius_full(&self) -> Pixels;
pub fn radius_2xl(&self) / radius_3xl(&self) / radius_4xl(&self) -> Pixels;
pub fn shadow_tokens(&self) -> ShadowTokens;
pub fn motion_tokens(&self) -> &MotionTokens;
```

**Semantic tokens** (`gpui-base/src/theme_tokens.rs`) are the newer, component-agnostic surface:

```rust
pub struct SemanticThemeTokens {
    pub colors: ColorTokens,        // background, foreground, surface, surface_foreground,
                                    // primary, primary_foreground, secondary, secondary_foreground,
                                    // muted, muted_foreground, accent, accent_foreground,
                                    // destructive, destructive_foreground, border, input, ring, selection
    pub radius: RadiusTokens,       // none, sm, md, lg, xl, full
    pub spacing: SpacingTokens,     // xxs, xs, sm, md, lg, xl, xxl
    pub typography: TypographyTokens,
    pub shadow: ShadowTokens,       // sm, md, lg
}

pub struct TypographyTokens {
    pub sans: SharedString,
    pub mono: SharedString,
    pub xs: TextStyleToken,   // 12 / 16
    pub sm: TextStyleToken,   // 14 / 20
    pub md: TextStyleToken,   // 16 / 24
    pub lg: TextStyleToken,   // 18 / 28
    pub xl: TextStyleToken,   // 20 / 28
    pub mono_md: TextStyleToken, // 13 / 20
}

pub struct TextStyleToken {
    pub size: Pixels,
    pub line_height: Pixels,
    pub weight: FontWeight,
}
```

**Font size / weight helpers.** There is no `theme.text_sm()`-style method; use GPUI's `Styled`
trait, which is in scope from `gpui_kit::*` (and is what `src/ui/sidebar.rs` already uses):

```rust
div()
    .text_xs()      // 12px
    .text_sm()      // 14px
    .text_base()    // 16px
    .text_lg()      // 18px
    .text_xl()      // 20px
    .text_2xl()     // 24px
    .font_weight(FontWeight::SEMIBOLD)   // NORMAL / SEMIBOLD / BOLD
    .font_family(cx.theme().font_family.clone())
```

Source: `gpui-pre-0.3.9/src/styled.rs:522,545-580,708`. For a token-driven size:
`cx.theme().typography_tokens().sm.size` and `.sm.line_height` / `.sm.weight`.

Rome's `rome::theme::init(cx)` installs its own `ThemeConfig` into this same global `Theme`, so
`cx.theme()` returns the Vercel palette; nothing above changes.

---

## Gotchas worth remembering

1. `Task<T>` is `#[must_use]` and **dropping it cancels the work**. Store it in the entity or call
   `.detach()`.
2. `Context::spawn` is foreground/main-thread. `background_executor().spawn` is a thread pool and
   requires `Send` on both the future and its output.
3. `AsyncApp` and `Context<T>` are `!Send`; do not try to carry them (or anything that needs them)
   into a background task. Return values or use a channel.
4. `WeakEntity::update` returns `Result`; a released entity is `Err`, which is the clean way to
   stop a pump loop.
5. The dialog and notification layers only exist under `gpui_base::Root`; use
   `gpui_kit::open_window` (or wrap `base::Root::new(view, window, cx)` yourself).
6. `gpui_kit::component`'s root re-exports are limited. `Checkbox`, `Switch`, `Select`, `Tab`,
   `Spinner`, `Progress`, `Notification` and `Tooltip` all need their module path.
