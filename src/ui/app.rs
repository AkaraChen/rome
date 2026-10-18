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

use gpui_kit::component::{ActiveTheme, h_flex, v_flex};
use gpui_kit::*;
use serde_json::Value;

use crate::snapshot::Snapshot;
use crate::worker::{Command, Event, Worker};

use super::{
    Action, Dispatch, add_source, dialog, entry_list, lists, plugins, reading_pane, sidebar,
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
}

/// The window.
pub struct RomeApp {
    worker: Worker,
    /// Everything on screen, as of the last event.
    snapshot: Snapshot,
    mode: Mode,
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
                cx.notify();
            }
            Event::Manifest { path, manifest } => {
                add_source::install(path, *manifest, window, cx, self.worker.clone());
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
                    self.mode = Mode::Browse;
                    cx.notify();
                }

                self.worker.send(command);
            }

            Action::AddSource => {
                self.mode = Mode::Browse;
                cx.notify();
                add_source::choose(window, cx, self.worker.clone());
            }

            Action::ManagePlugins => {
                self.mode = Mode::Plugins;
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let dispatch: Dispatch = super::dispatch(cx, Self::act);

        let middle = match self.mode {
            Mode::Plugins => plugins::pane(&self.snapshot, &dispatch, cx),
            Mode::Browse => entry_list::column(&self.snapshot, &dispatch, cx),
        };

        h_flex()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .child(sidebar::sidebar(
                &self.snapshot,
                self.sidebar_collapsed,
                &dispatch,
                cx,
            ))
            // The list is a fixed column and the reading pane takes what is
            // left: a reader wants the text wide and the headlines narrow, and
            // a list that grows with the window would do the opposite.
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
                    .child(reading_pane::pane(&self.snapshot, &dispatch, cx)),
            )
    }
}
