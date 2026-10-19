//! The window: the one piece of state the UI owns, and the wiring that turns
//! worker events into what is drawn.
//!
//! Everything else under `ui` is a function from a [`Snapshot`] to an element.
//! This is the exception, and it is the smallest one that can be: it holds the
//! last snapshot, applies the next, and hands the panes a [`Dispatch`]. It
//! decides nothing about how anything looks.
//!
//! It lives in the library rather than in `main` so that it can be rendered
//! outside the application — see `tests/render.rs`, which draws it headlessly
//! and writes a PNG. A view that only the binary can construct is a view that
//! can only be checked by a person looking at it, and "it looked right when I
//! ran it" is not a check that survives the next change.

use std::rc::Rc;

use gpui_kit::component::input::InputState;
use gpui_kit::component::{ActiveTheme, h_flex, v_flex};
use gpui_kit::*;
use serde_json::{Value, json};

use crate::snapshot::Snapshot;
use crate::worker::{Command, Event, Worker};

use super::{
    Action, Dispatch, add_source, dialog, entry_list, feed, lists, plugins, reading_pane, sidebar,
    wizard,
};

/// Which content the middle and right columns are showing.
///
/// A mode rather than a [`crate::snapshot::Selection`] because the plugin
/// manager is not a filter over entries: it is a different screen that happens
/// to live in the same window, and pretending otherwise would put a case in
/// every query the worker runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    Browse,
    Plugins,
    /// The add-source page: installed plugins to subscribe to, and the market
    /// to install more from.
    ///
    /// A screen rather than a dialog because a fresh install has no plugins at
    /// all, and a dialog that could only list what was already there would have
    /// given the bundled ones nowhere to be discovered.
    AddSource,
}

/// The window.
pub struct RomeApp {
    worker: Worker,
    /// Everything on screen, as of the last event.
    snapshot: Snapshot,
    mode: Mode,
    /// The add-source page's tab and step.
    ///
    /// Window state rather than a snapshot field: it is a half-finished
    /// conversation with the user, and the worker has no business knowing about
    /// a name it has not been given yet.
    add_source: wizard::State,
    /// The market's filter box, once the tab has been opened.
    ///
    /// Built on first use because an [`InputState`] needs a window, and the
    /// window's own constructor does not have one yet. The subscription is held
    /// for the same reason it exists at all: the grid is drawn from the box's
    /// value, so every keystroke has to redraw the page.
    market_search: Option<Entity<InputState>>,
    _market_search_events: Option<Subscription>,
    /// Whether the sidebar is narrowed to its icons.
    ///
    /// Window state, not snapshot state: the worker has nothing to do with it
    /// and it deliberately does not survive a restart. A reader who collapsed
    /// the sidebar to get a wider column wants it back the next time they open
    /// the app, not to be met with a window that lost half its navigation.
    sidebar_collapsed: bool,
}

impl RomeApp {
    pub fn new(worker: Worker) -> Self {
        Self {
            worker,
            snapshot: Snapshot::default(),
            mode: Mode::Browse,
            add_source: wizard::State::default(),
            market_search: None,
            _market_search_events: None,
            sidebar_collapsed: false,
        }
    }

    /// The snapshot as last published.
    pub fn snapshot(&self) -> &Snapshot {
        &self.snapshot
    }

    /// Replace the snapshot without a worker, for tests and for the first paint.
    pub fn set_snapshot(&mut self, snapshot: Snapshot) {
        self.snapshot = snapshot;
    }

    /// Show one of the window's own screens.
    ///
    /// Leaving the add-source page clears the half-filled form with it: the
    /// form is a step in that page's flow, not a mode of its own, and leaving
    /// it behind a different screen would make it reappear somewhere unrelated.
    pub fn set_mode(&mut self, mode: Mode) {
        if self.mode == Mode::AddSource && mode != Mode::AddSource {
            self.add_source = wizard::State::default();
        }

        self.mode = mode;
    }

    /// Show the add-source page on `tab`, at its first step.
    ///
    /// Takes a window and a context because the market's filter box is an
    /// input, and the first time the market is opened that box has to be
    /// created and watched.
    pub fn open_add_source(
        &mut self,
        tab: wizard::Tab,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.mode = Mode::AddSource;
        self.add_source = wizard::State::at(tab);

        if tab != wizard::Tab::Market {
            return;
        }

        let search = match self.market_search.clone() {
            Some(search) => search,
            None => {
                let search = cx.new(|cx| InputState::new(window, cx).placeholder("搜索插件"));
                self._market_search_events = Some(cx.observe(&search, |_, _, cx| cx.notify()));
                self.market_search = Some(search.clone());
                search
            }
        };

        // A query is about the visit that typed it. The tab was just reset, so
        // the box is too, or a reader who came back to install something else
        // would find the market filtered by a word they no longer remember.
        search.update(cx, |state, cx| state.set_value("", window, cx));
    }

    /// Type a query into the market's filter box.
    ///
    /// The box is filled by typing, and a frame cannot type. This is the same
    /// kind of seam as [`RomeApp::set_sidebar_collapsed`]: a way for a test to
    /// reach a state the window owns, so that the page the reader sees after a
    /// keystroke can be looked at rather than reasoned about.
    pub fn set_market_search(&self, query: &str, window: &mut Window, cx: &mut App) {
        let Some(search) = self.market_search.as_ref() else {
            return;
        };

        search.update(cx, |state, cx| state.set_value(query, window, cx));
    }

    /// Go to the configure step for one installed plugin.
    ///
    /// This is what a row's own click means. It always opens the installed tab:
    /// configuring a source is that tab's job, even when the row was reached
    /// from somewhere else.
    pub fn configure_source(&mut self, plugin: u64, window: &mut Window, cx: &mut App) {
        self.mode = Mode::AddSource;

        self.add_source = match self.snapshot.plugins.iter().find(|row| row.id == plugin) {
            Some(row) => wizard::State::configure(row, window, cx),
            // The plugin went away between the click and this call. The page
            // opens on the list it would have shown anyway.
            None => wizard::State::at(wizard::Tab::Installed),
        };
    }

    /// Narrow the sidebar, the way the header's own control does.
    ///
    /// The collapsed sidebar is a layout of its own — three icons' worth of
    /// width, and a mark, a button and a label that have to get out of the way
    /// of each other — so it is worth being able to draw without a pointer.
    pub fn set_sidebar_collapsed(&mut self, collapsed: bool) {
        self.sidebar_collapsed = collapsed;
    }

    /// Apply one event from the worker.
    ///
    /// Takes a window because two of these open things: a plugin's question is
    /// a dialog, and a manifest that came back from a file is the install
    /// dialog. Everything else only touches the snapshot.
    pub fn apply(&mut self, event: Event, window: &mut Window, cx: &mut Context<Self>) {
        match event {
            Event::Snapshot(snapshot) => {
                self.snapshot = *snapshot;

                // The configure step is about one plugin, and that plugin can
                // disappear from under it — uninstalled in another window, or
                // by a plugin's own cleanup. The step has no meaning once its
                // plugin is gone, so it falls back to the list rather than
                // drawing a form for nothing.
                if let Some(plugin) = self.add_source.plugin()
                    && !self.snapshot.plugins.iter().any(|row| row.id == plugin)
                {
                    self.add_source.choose();
                }

                cx.notify();
            }
            Event::Manifest { path, manifest } => {
                add_source::confirm_install(path, *manifest, window, cx, self.worker.clone());
            }
            Event::Ask(ask) => dialog::open(ask, self.worker.clone(), window, cx),
            Event::Notify { message, level } => dialog::notify(&message, &level, window, cx),
            Event::Progress { message, value } => dialog::progress(message, value, window, cx),
        }
    }

    /// Do one thing the user asked for.
    pub fn act(&mut self, action: Action, window: &mut Window, cx: &mut Context<Self>) {
        match action {
            Action::Worker(command) => {
                // Anything that changes what is being read takes the window back
                // to the list: the plugin manager is a detour, and leaving it up
                // after the user asked for an entry would hide the answer.
                if matches!(
                    command,
                    Command::Select(_) | Command::Open(_) | Command::Search(_)
                ) {
                    self.set_mode(Mode::Browse);
                    cx.notify();
                }

                self.worker.send(command);
            }

            Action::OpenAddSource => {
                self.open_add_source(wizard::Tab::Installed, window, cx);
                cx.notify();
            }

            Action::OpenPluginMarket => {
                self.open_add_source(wizard::Tab::Market, window, cx);
                cx.notify();
            }

            Action::SwitchAddSource(tab) => {
                // Switching tabs starts that tab over. A half-filled form is
                // about a plugin on the other tab, and coming back to it after
                // browsing the market would present a decision the reader has
                // already walked away from.
                self.open_add_source(tab, window, cx);
                cx.notify();
            }

            Action::ShowMoreMarket => {
                self.add_source.show_more_market();
                cx.notify();
            }

            Action::InstallBundled(slug) => {
                let Some(bundled) = crate::bundled::get(&slug) else {
                    return;
                };

                match crate::paths::write_bundled_plugin(bundled.slug, bundled.code) {
                    Ok(path) => self.worker.send(Command::InstallPlugin { path }),
                    Err(error) => {
                        dialog::notify(&format!("写不出插件文件：{error}"), "error", window, cx);
                    }
                }
            }

            Action::InstallFromFile => add_source::pick_file(window, cx, self.worker.clone()),

            Action::SelectAddSourcePlugin(plugin) => {
                self.configure_source(plugin, window, cx);
                cx.notify();
            }

            Action::AddSourceBack => {
                if self.add_source.plugin().is_some() {
                    self.add_source.choose();
                    cx.notify();
                }
            }

            Action::SubmitAddSource => {
                let submitted = match &self.add_source.step {
                    wizard::Step::Configure {
                        plugin,
                        title,
                        params,
                    } => {
                        let typed = title.read(cx).value().trim().to_owned();

                        // An empty name is not an error: the field starts with
                        // the plugin's own name in it, so blanking it reads as
                        // "call it what the plugin is called" rather than as a
                        // mistake to be corrected.
                        let title = if typed.is_empty() {
                            self.snapshot
                                .plugins
                                .iter()
                                .find(|row| row.id == *plugin)
                                .map(|row| row.name.clone())
                                .unwrap_or_default()
                        } else {
                            typed
                        };

                        let params = if params.is_empty() {
                            json!({})
                        } else {
                            params.value(cx)
                        };

                        Some(Command::AddSource {
                            plugin_id: *plugin,
                            title,
                            params,
                        })
                    }
                    wizard::Step::Choose => None,
                };

                let Some(command) = submitted else {
                    return;
                };

                // The worker selects the new source when it creates it, so the
                // list behind this is about to become that source's entries.
                // Leaving the add-source page at the same time is what puts
                // them on screen instead of behind it.
                self.add_source = wizard::State::default();
                self.mode = Mode::Browse;
                cx.notify();
                self.worker.send(command);
            }

            Action::ManagePlugins => {
                self.set_mode(Mode::Plugins);
                cx.notify();
            }

            Action::EditSource(id) => {
                let Some(source) = self.snapshot.sources.iter().find(|row| row.id == id) else {
                    return;
                };

                let schema = self
                    .snapshot
                    .plugins
                    .iter()
                    .find(|plugin| plugin.id == source.plugin_id)
                    .map(|plugin| plugin.params_schema.clone())
                    .unwrap_or(Value::Null);

                add_source::edit(
                    id,
                    &source.title,
                    &schema,
                    &source.params,
                    window,
                    cx,
                    self.worker.clone(),
                );
            }

            Action::EditPlugin(id) => {
                let Some(plugin) = self.snapshot.plugins.iter().find(|row| row.id == id) else {
                    return;
                };

                add_source::edit_plugin(
                    id,
                    &plugin.settings_schema,
                    &plugin.settings,
                    window,
                    cx,
                    self.worker.clone(),
                );
            }

            Action::RemoveSource(id) => {
                let Some(source) = self.snapshot.sources.iter().find(|row| row.id == id) else {
                    return;
                };

                let title = source.title.clone();
                let dispatch = super::dispatch(cx, Self::act);
                add_source::confirm_remove(id, &title, &dispatch, window, cx);
            }

            Action::RemovePlugin(id) => {
                let Some(plugin) = self.snapshot.plugins.iter().find(|row| row.id == id) else {
                    return;
                };

                let name = plugin.name.clone();
                let sources = plugin.sources;
                let worker = self.worker.clone();

                // The count is in the message because it is the part the user
                // cannot see from here: a plugin row does not show what it
                // collected, and "卸载" alone reads like it only removes a file.
                let message = match sources {
                    0 => format!("「{name}」会被删掉。它还没有抓过东西。"),
                    n => format!(
                        "「{name}」和它的 {n} 个信息源会一起删掉，抓到的条目也没了。想留着条目就选「停用」。"
                    ),
                };

                dialog::confirm(
                    "卸载插件",
                    &message,
                    "卸载",
                    Rc::new(move |_, _| worker.send(Command::UninstallPlugin(id))),
                    window,
                    cx,
                );
            }

            Action::CreateList => {
                let worker = self.worker.clone();

                dialog::prompt(
                    "新建列表",
                    "",
                    "列表的名字",
                    "创建",
                    Rc::new(move |name, _, _| {
                        worker.send(Command::CreateList(name.to_owned()));
                    }),
                    window,
                    cx,
                );
            }

            Action::RenameList(id) => {
                let Some(list) = self.snapshot.lists.iter().find(|row| row.id == id) else {
                    return;
                };

                let current = list.name.clone();
                let worker = self.worker.clone();

                dialog::prompt(
                    "重命名列表",
                    &current,
                    "列表的名字",
                    "重命名",
                    Rc::new(move |name, _, _| {
                        worker.send(Command::RenameList {
                            list_id: id,
                            name: name.to_owned(),
                        });
                    }),
                    window,
                    cx,
                );
            }

            Action::DeleteList(id) => {
                let Some(list) = self.snapshot.lists.iter().find(|row| row.id == id) else {
                    return;
                };

                let name = list.name.clone();
                let worker = self.worker.clone();

                // Says what survives, because the fear this dialog has to
                // answer is "did I just delete the articles". It did not: a
                // list is a grouping, and the entries belong to their source.
                dialog::confirm(
                    "删除列表",
                    &format!(
                        "「{name}」会从侧边栏消失。里面的条目不会被删，只是不再属于这个列表。"
                    ),
                    "删除",
                    Rc::new(move |_, _| worker.send(Command::DeleteList(id))),
                    window,
                    cx,
                );
            }

            Action::AddToList(entry_id) => {
                lists::add_to_list(
                    entry_id,
                    self.snapshot.lists.clone(),
                    window,
                    cx,
                    self.worker.clone(),
                );
            }

            Action::ToggleSidebar => {
                self.sidebar_collapsed = !self.sidebar_collapsed;
                cx.notify();
            }
        }
    }
}

impl Render for RomeApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let dispatch: Dispatch = super::dispatch(cx, Self::act);

        // What is left of the window once the sidebar has taken its column.
        // The feed layouts need it before they are built: how many cards fit
        // across decides how tall a row is, and a virtualised row has to know
        // that before it is drawn. The two widths are the component library's
        // own — see `Sidebar`'s `DEFAULT_WIDTH` and `COLLAPSED_WIDTH`.
        let sidebar = if self.sidebar_collapsed {
            px(48.)
        } else {
            px(255.)
        };
        let available = (window.viewport_size().width - sidebar).max(px(0.));

        let content = match (self.mode, feed::home(&self.snapshot)) {
            (Mode::Plugins, _) => columns(
                plugins::pane(&self.snapshot, &dispatch, cx),
                &self.snapshot,
                &dispatch,
                cx,
            ),
            // The add-source page is edge to edge, like the feeds: it is not a
            // filter over entries and there is nothing to read beside it.
            (Mode::AddSource, _) => wizard::pane(
                &self.snapshot,
                &self.add_source,
                self.market_search.as_ref(),
                &dispatch,
                available,
                cx,
            ),
            // The four browsed views take the whole width. Their shape is the
            // content's, not a list's: a timeline, a grid of covers, a podcast
            // home. There is no reading pane because there is nothing in them
            // to read in place.
            (Mode::Browse, Some(home)) => {
                feed::pane(home, &self.snapshot, &dispatch, available, cx)
            }
            (Mode::Browse, None) => columns(
                entry_list::column(&self.snapshot, &dispatch, cx),
                &self.snapshot,
                &dispatch,
                cx,
            ),
        };

        h_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(sidebar::sidebar(
                &self.snapshot,
                self.sidebar_collapsed,
                // A screen that is not a selection has no row in the
                // sidebar, so no row should look chosen while it is up.
                (self.mode == Mode::Browse).then_some(self.snapshot.selection),
                &dispatch,
                cx,
            ))
            .child(content)
            .into_any_element()
    }
}

/// The two-column layout: a fixed column of headlines and the reading pane.
///
/// The list is fixed and the pane takes what is left, because a reader wants
/// the text wide and the headlines narrow; a list that grew with the window
/// would do the opposite.
fn columns(middle: AnyElement, snapshot: &Snapshot, dispatch: &Dispatch, cx: &App) -> AnyElement {
    h_flex()
        .flex_1()
        .h_full()
        .min_w_0()
        .child(
            v_flex()
                .w(px(340.))
                .h_full()
                .flex_shrink_0()
                .min_w_0()
                .border_r_1()
                .border_color(cx.theme().border)
                .child(middle),
        )
        .child(
            v_flex()
                .flex_1()
                .h_full()
                .min_w_0()
                .child(reading_pane::pane(snapshot, dispatch, cx)),
        )
        .into_any_element()
}
