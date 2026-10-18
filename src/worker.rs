//! The worker thread: the one owner of the database.
//!
//! The UI cannot read the database itself. A `store::` call blocks its thread
//! until the statement has finished, and a plugin run blocks for as long as
//! thirty seconds — neither can happen on the thread that draws the window. So
//! the database and the HTTP transport live on a thread of their own, the UI
//! sends [`Command`]s to it and renders the [`Event::Snapshot`]s it sends back.
//!
//! The alternative — a mutex both threads take — is worse in exactly the case
//! that matters: a refresh holds the lock for thirty seconds, and every read the
//! UI makes while it does would block behind it. Here the UI never blocks at
//! all; it keeps drawing the last snapshot, and the spinner it shows comes from
//! that snapshot's own `busy` flag.
//!
//! Nothing in this file knows what a widget is, and nothing in `ui` knows what a
//! database is. [`crate::snapshot`] is the entire interface between them.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use flume::{Receiver, RecvTimeoutError, Sender};
use serde_json::{Value, json};
use toasty::migration::MigrationSet;

use crate::db::Database;
use crate::http::{Http, HttpResponse, RequestInit, recent_domains};
use crate::models::View;
use crate::plugin::DialogRequest;
use crate::plugin::session::{self, Dialogs, Manifest};
use crate::snapshot::{
    Article, EntryDetail, EntryRow, ListRow, PluginRow, Selection, Snapshot, SourceRow, Tab,
};
use crate::store::{self, NewPlugin, NewSource};
use crate::ui::content;
use crate::view_order;

/// How many entries the middle column loads.
///
/// A cap rather than a window: the list is the user's recent reading, and an
/// unbounded query would move a person's entire archive across a channel every
/// time they clicked a tab. Paging is the fix when this stops being enough.
const ENTRY_LIMIT: usize = 200;

/// How many domains a plugin's card reports.
///
/// The card is a trust panel, not an audit trail: a reader needs to recognise
/// the handful of hosts a plugin talks to, and the log still holds the rest.
/// The number is also a snapshot budget — the list is cloned into every frame
/// the window draws — so it stays small on purpose.
const DOMAIN_LIMIT: usize = 8;

/// How often a source is fetched when the user does not say otherwise.
const DEFAULT_INTERVAL: Duration = Duration::from_secs(900);

/// How often the worker looks for sources that are due.
///
/// The tick is short and the intervals are long, so a source is refreshed
/// within half a minute of when it is due rather than exactly on it. Nothing
/// here needs to be punctual.
const TICK: Duration = Duration::from_secs(30);

/// What the UI asks the worker to do.
///
/// `Clone` because the UI hands one to the dispatch callback, which owns it —
/// the alternative is a reference, and a `Command` carrying a borrowed path or
/// query would tie every element's lifetime to the snapshot it was built from.
#[derive(Debug, Clone)]
pub enum Command {
    /// Re-read everything and publish a snapshot.
    Reload,
    /// Change what the middle column shows. Clears any search.
    Select(Selection),
    /// Open an entry in the reading pane, or close it with `None`.
    Open(Option<u64>),
    /// Filter the middle column by `query`; an empty query clears it.
    Search(String),

    /// Refresh one source now.
    RefreshSource(u64),
    /// Refresh every enabled source.
    RefreshAll,

    /// Read a plugin's manifest out of a `.js` file without installing it.
    Describe {
        path: PathBuf,
    },
    /// Install the plugin in `path` and subscribe to it.
    Install {
        path: PathBuf,
        title: String,
        settings: Value,
        params: Value,
    },
    /// Switch a plugin on or off, running its lifecycle hook either way.
    SetPluginEnabled {
        plugin_id: u64,
        enabled: bool,
    },
    /// Switch one source on or off.
    SetSourceEnabled {
        source_id: u64,
        enabled: bool,
    },
    /// Change what a source reads, and what it is called.
    SetSourceParams {
        source_id: u64,
        title: String,
        params: Value,
    },
    /// Replace a plugin's settings.
    ///
    /// Applied on the plugin's next run: settings are handed to it on every
    /// call, so there is nothing cached to invalidate.
    SetPluginSettings {
        plugin_id: u64,
        settings: Value,
    },
    /// Forget a source and everything it fetched.
    DeleteSource(u64),
    /// Forget a plugin, its sources, its entries and its storage.
    UninstallPlugin(u64),

    /// Make a list, and select it. An existing list with that name is selected
    /// rather than duplicated.
    CreateList(String),
    /// Give a list a new name.
    RenameList {
        list_id: u64,
        name: String,
    },
    /// Throw a list away. The entries that were in it stay.
    DeleteList(u64),
    /// Put an entry in a list.
    AddToList {
        list_id: u64,
        entry_id: u64,
    },
    /// Put an entry in the list called `name`, making it if it does not exist.
    ///
    /// One command rather than "create a list, then add to it" because that is
    /// one thing the user did: they typed a name and pressed a button. The
    /// alternative needs the new list's id, which only exists after the next
    /// snapshot comes back.
    FileInto {
        name: String,
        entry_id: u64,
    },
    /// Take an entry out of a list.
    RemoveFromList {
        list_id: u64,
        entry_id: u64,
    },

    SetRead {
        entry_id: u64,
        read: bool,
    },
    SetStarred {
        entry_id: u64,
        starred: bool,
    },

    /// Move a view row `delta` places in the sidebar: `-1` up, `1` down.
    ///
    /// A move rather than "here is the new order", so the window never has to
    /// send back a list it would first have to have been given — and so two
    /// moves that arrive together cannot leave the two sides disagreeing about
    /// what the order was. Off either end, this does nothing.
    MoveView {
        view: View,
        delta: i32,
    },

    /// Stop the thread.
    Shutdown,
}

/// What the worker tells the UI.
#[derive(Debug)]
pub enum Event {
    /// Everything the UI draws, as of now.
    Snapshot(Box<Snapshot>),
    /// A plugin's manifest, in answer to [`Command::Describe`].
    ///
    /// The path comes back with it so the UI can send it straight back to
    /// [`Command::Install`] without having to remember which file it asked
    /// about.
    Manifest {
        path: PathBuf,
        manifest: Box<Manifest>,
    },
    /// The worker is blocked until the user answers this.
    Ask(Ask),
    /// A plugin asked to say something. Nothing is waiting on it.
    Notify { message: String, level: String },
    /// A plugin said how far along it is, or — with no message — that it is
    /// done.
    ///
    /// Not a snapshot field, because a snapshot is what the user is looking at
    /// and this is what the app is doing: it changes many times per refresh and
    /// the list underneath it does not. It goes to the notification stack,
    /// which is the same place `Notify` goes and the only place in this window
    /// that holds something up on its own without a redraw being asked for.
    Progress {
        message: Option<String>,
        value: Option<f32>,
    },
}

/// A question the worker is blocked on.
#[derive(Debug)]
pub struct Ask {
    /// Which question this is. The answer carries it back, so an answer to a
    /// question the user has already dismissed cannot be applied to the next
    /// one.
    pub id: u64,
    pub request: DialogRequest,
}

/// The user's answer to a [`Ask`].
#[derive(Debug)]
struct Answer {
    id: u64,
    value: Value,
}

/// A handle on the worker thread.
///
/// Cloning is cheap and deliberate: every closure that outlives the call which
/// built it — a dialog's OK button, a file picker that has not returned yet —
/// needs its own handle, and there is no sense in making them reach through the
/// window to find one.
#[derive(Clone)]
pub struct Worker {
    commands: Sender<Command>,
    answers: Sender<Answer>,
    events: Receiver<Event>,
}

impl Worker {
    /// Open `path`, apply `migrations`, and start serving commands.
    ///
    /// The migrations are passed in rather than embedded here so that the
    /// `migrate` binary still compiles against a checkout whose `toasty/`
    /// directory has not been generated yet — the directory that binary exists
    /// to create. See the note on `MIGRATIONS` in `main`.
    pub fn start(path: PathBuf, migrations: &'static MigrationSet) -> Self {
        let (commands, command_rx) = flume::unbounded();
        let (answers, answer_rx) = flume::unbounded();
        let (event_tx, events) = flume::unbounded();

        std::thread::Builder::new()
            .name("rome-worker".to_owned())
            .spawn(move || run(path, migrations, command_rx, answer_rx, event_tx))
            .expect("could not start the worker thread");

        Self {
            commands,
            answers,
            events,
        }
    }

    /// Ask the worker to do something.
    ///
    /// Failing to send means the worker is gone, which the UI finds out from
    /// its event channel closing rather than from here — there is nothing
    /// useful it could do about it at the call site anyway.
    pub fn send(&self, command: Command) {
        let _ = self.commands.send(command);
    }

    /// Answer the question `id` was asked for.
    pub fn answer(&self, id: u64, value: Value) {
        let _ = self.answers.send(Answer { id, value });
    }

    /// The worker's events.
    ///
    /// A clone, because the UI moves it into the task that reads it and still
    /// needs to be able to drop the handle when the window closes.
    pub fn events(&self) -> Receiver<Event> {
        self.events.clone()
    }
}

/// The worker thread's whole life.
fn run(
    path: PathBuf,
    migrations: &'static MigrationSet,
    commands: Receiver<Command>,
    answers: Receiver<Answer>,
    events: Sender<Event>,
) {
    let mut state = match State::open(path, migrations) {
        Ok(state) => state,
        Err(error) => {
            // Nothing can work without a database, so the one thing left to do
            // is say so. The UI renders this snapshot and then sees the channel
            // close.
            let _ = events.send(Event::Snapshot(Box::new(Snapshot {
                error: Some(error),
                ..Snapshot::default()
            })));
            return;
        }
    };

    state.publish(&events);

    loop {
        match commands.recv_timeout(TICK) {
            Ok(Command::Shutdown) => break,
            Ok(command) => state.handle(command, &events, &answers),
            Err(RecvTimeoutError::Timeout) => state.refresh_due(&events),
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Everything the worker thread owns.
struct State {
    db: Database,
    http: Http,
    /// What the middle column shows.
    selection: Selection,
    /// The active search, which overrides `selection` while it is set.
    search: Option<String>,
    /// The entry the reading pane is showing, already loaded.
    open: Option<EntryDetail>,
    /// What is being worked on, for the UI to show.
    busy: Option<String>,
    /// The last thing that went wrong *for the app* rather than for one source.
    ///
    /// A source's own failure belongs on its row in the sidebar, where the user
    /// can see which subscription broke. This is for the rest: a plugin that
    /// would not install, a database that would not write.
    error: Option<String>,
}

/// What still has to be fetched for an entry that was just opened.
///
/// One decision per open, made when the entry is read out of the store, so the
/// two ways of getting a body cannot both run: the plugin's page and the host's
/// reading of the URL are alternatives, not a sequence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Page {
    /// Nothing: the entry brought its own body.
    Nothing,
    /// The plugin's own page for the item. It exports a `preview` hook and has
    /// not been asked for this entry yet.
    Preview,
    /// The page behind the entry's URL, for the host to read and strip.
    Article,
}

impl State {
    fn open(path: PathBuf, migrations: &'static MigrationSet) -> Result<Self, String> {
        let db = Database::open(&path).map_err(|error| format!("打不开数据库：{error}"))?;
        db.migrate(migrations)
            .map_err(|error| format!("迁移失败：{error}"))?;

        Ok(Self {
            db,
            http: Http::new(),
            selection: Selection::All,
            search: None,
            open: None,
            busy: None,
            error: None,
        })
    }

    /// Do one thing the UI asked for, then publish what changed.
    fn handle(&mut self, command: Command, events: &Sender<Event>, answers: &Receiver<Answer>) {
        // Cleared first, so a message about the last failure does not outlive
        // the failure by more than one action.
        self.error = None;

        match command {
            Command::Reload => {}

            Command::Select(selection) => {
                self.selection = selection;
                self.search = None;
                self.open = None;
            }

            Command::Open(id) => {
                let opened = id.and_then(|id| self.open_entry(id));
                let page = opened.as_ref().map_or(Page::Nothing, |(_, page)| *page);

                self.open = opened.map(|(entry, _)| entry);

                if let Page::Preview | Page::Article = page {
                    // The entry goes on screen before its page is fetched, so a
                    // site that takes ten seconds to answer shows as a line
                    // saying the page is being read rather than as the entry
                    // that was open a moment ago.
                    if let Some(open) = &mut self.open {
                        match page {
                            Page::Preview => open.preview = Article::Reading,
                            _ => open.article = Article::Reading,
                        }
                    }

                    self.publish(events);

                    match page {
                        Page::Preview => self.read_open_preview(),
                        _ => self.read_open_article(),
                    }
                }
            }

            Command::Search(query) => {
                self.search = Some(query).filter(|query| !query.trim().is_empty());
                self.open = None;
            }

            Command::RefreshSource(source_id) => {
                self.busy = Some("正在抓取".to_owned());
                self.publish(events);
                // A source's own failure is recorded on the source and shown on
                // its sidebar row, so it is deliberately not repeated here.
                let _ =
                    session::refresh_source(&mut self.db, &mut self.http, source_id, Some(events));
                self.busy = None;
            }

            Command::RefreshAll => self.refresh_everything(events),

            Command::Describe { path } => match read_and_describe(&path) {
                Ok(manifest) => {
                    let _ = events.send(Event::Manifest {
                        path,
                        manifest: Box::new(manifest),
                    });
                    return;
                }
                Err(message) => self.error = Some(message),
            },

            Command::Install {
                path,
                title,
                settings,
                params,
            } => {
                self.busy = Some("正在安装插件".to_owned());
                self.publish(events);

                if let Err(message) = self.install(path, title, settings, params, events, answers) {
                    self.error = Some(message);
                }

                self.busy = None;
            }

            Command::SetPluginEnabled { plugin_id, enabled } => {
                match store::set_plugin_enabled(&mut self.db, plugin_id, enabled) {
                    Ok(()) if !enabled => {
                        // Best effort: the plugin is being switched off either
                        // way, and the only thing it could still be doing is
                        // tidying up.
                        let _ = session::deactivate_plugin(&mut self.db, &mut self.http, plugin_id);
                    }
                    Ok(()) => {}
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::SetSourceEnabled { source_id, enabled } => {
                if let Err(error) = store::set_source_enabled(&mut self.db, source_id, enabled) {
                    self.error = Some(error.to_string());
                }
            }

            Command::SetSourceParams {
                source_id,
                title,
                params,
            } => {
                if let Err(error) = store::set_source_params(&mut self.db, source_id, title, params)
                {
                    self.error = Some(error.to_string());
                }
            }

            Command::SetPluginSettings {
                plugin_id,
                settings,
            } => {
                if let Err(error) = store::set_plugin_settings(&mut self.db, plugin_id, settings) {
                    self.error = Some(error.to_string());
                }
            }

            Command::DeleteSource(source_id) => {
                if let Err(error) = store::delete_source(&mut self.db, source_id) {
                    self.error = Some(error.to_string());
                }
                if matches!(self.selection, Selection::Source(id) if id == source_id) {
                    self.selection = Selection::All;
                }
            }

            Command::UninstallPlugin(plugin_id) => {
                // The plugin is switched off first so its lifecycle hook runs
                // while it still exists: a plugin that shuts a connection down
                // in `deactivate` should get the chance before its row is gone.
                let _ = session::deactivate_plugin(&mut self.db, &mut self.http, plugin_id);

                match store::uninstall_plugin(&mut self.db, plugin_id) {
                    Ok(()) => {
                        // Whatever was being shown may have been one of its
                        // sources, so the selection falls back to everything
                        // rather than to a filter over rows that are gone.
                        if !self.selection_still_exists() {
                            self.selection = Selection::All;
                        }
                        self.open = None;
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::CreateList(name) => {
                match store::create_list(&mut self.db, &name) {
                    // Selecting what was just made is the point of making it
                    // from the sidebar: the user named a list because they
                    // have something to put in it, and an empty middle column
                    // they then have to go and find would be a step backwards.
                    Ok(list) => {
                        self.selection = Selection::List(list.id);
                        self.search = None;
                        self.open = None;
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::RenameList { list_id, name } => {
                if let Err(error) = store::rename_list(&mut self.db, list_id, &name) {
                    // The name is unique, so this is most often "there is
                    // already a list with that name" — a message the user can
                    // act on rather than a silent no-op.
                    self.error = Some(error.to_string());
                }
            }

            Command::DeleteList(list_id) => {
                if let Err(error) = store::delete_list(&mut self.db, list_id) {
                    self.error = Some(error.to_string());
                }
                if matches!(self.selection, Selection::List(id) if id == list_id) {
                    self.selection = Selection::All;
                }
            }

            Command::AddToList { list_id, entry_id } => {
                match store::add_to_list(&mut self.db, list_id, entry_id) {
                    // Said out loud because nothing on screen changes when an
                    // entry is filed: the row stays where it is, in whatever
                    // list is open, and without a word the user cannot tell a
                    // click that worked from one that missed.
                    Ok(()) => {
                        let name = store::list_name(&mut self.db, list_id)
                            .unwrap_or_else(|_| "列表".to_owned());
                        let _ = events.send(Event::Notify {
                            message: format!("已加入「{name}」"),
                            level: "success".to_owned(),
                        });
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::FileInto { name, entry_id } => {
                // `create_list` hands back the list that already has this name
                // rather than refusing, which is what makes "新建并加入" safe to
                // press when the reader has forgotten they made that list
                // already: the outcome they wanted is the outcome they get.
                let filed = store::create_list(&mut self.db, &name).and_then(|list| {
                    store::add_to_list(&mut self.db, list.id, entry_id)?;
                    Ok(list)
                });

                match filed {
                    // Unlike `AddToList`, the selection deliberately stays put.
                    // A list made from the sidebar is made to be looked at, but
                    // this one was made to hold the thing the reader is reading
                    // — jumping the middle column out from under them would
                    // lose the row they just filed.
                    Ok(list) => {
                        let _ = events.send(Event::Notify {
                            message: format!("已加入「{}」", list.name),
                            level: "success".to_owned(),
                        });
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::RemoveFromList { list_id, entry_id } => {
                if let Err(error) = store::remove_from_list(&mut self.db, list_id, entry_id) {
                    self.error = Some(error.to_string());
                }
            }

            Command::MoveView { view, delta } => {
                // Read, move, write the whole order back. The write stores the
                // resolved order rather than a patch of the stored one, so a
                // value from an older release — or one the user edited by hand
                // — is replaced by a complete, current one the first time they
                // touch the sidebar.
                match store::setting_get(&mut self.db, view_order::KEY) {
                    Ok(stored) => {
                        let order =
                            view_order::moved(&view_order::resolve(stored.as_ref()), view, delta);

                        if let Err(error) = store::setting_set(
                            &mut self.db,
                            view_order::KEY,
                            view_order::encode(&order),
                        ) {
                            self.error = Some(error.to_string());
                        }
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::SetRead { entry_id, read } => {
                match store::set_read(&mut self.db, entry_id, read) {
                    Ok(()) => {
                        if let Some(open) = &mut self.open
                            && open.id == entry_id
                        {
                            open.read = read;
                        }
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::SetStarred { entry_id, starred } => {
                match store::set_starred(&mut self.db, entry_id, starred) {
                    Ok(()) => {
                        if let Some(open) = &mut self.open
                            && open.id == entry_id
                        {
                            open.starred = starred;
                        }
                    }
                    Err(error) => self.error = Some(error.to_string()),
                }
            }

            Command::Shutdown => {}
        }

        self.publish(events);
    }

    /// Whether what the middle column is showing still exists.
    ///
    /// Only a source or a list can be deleted out from under the selection, and
    /// a selection pointing at a row that is gone shows an empty column with no
    /// way to explain itself. A query that fails answers "yes": a database
    /// problem should not also move the user somewhere they did not ask to go.
    fn selection_still_exists(&mut self) -> bool {
        match self.selection {
            Selection::Source(id) => store::list_sources(&mut self.db)
                .map(|sources| sources.iter().any(|source| source.id == id))
                .unwrap_or(true),
            Selection::List(id) => store::list_lists(&mut self.db)
                .map(|lists| lists.iter().any(|list| list.id == id))
                .unwrap_or(true),
            Selection::All | Selection::View(_) | Selection::Starred => true,
        }
    }

    /// Load an entry for the reading pane, marking it read on the way.
    ///
    /// Opening is what marks something read. There is no separate button for it
    /// because there should not need to be: a reader that made you click twice
    /// to acknowledge an item you had just read would be a worse reader.
    ///
    /// The bool is whether the entry's own page still has to be read, which is
    /// [`State::read_open_article`]'s question. It is answered here because
    /// this is where the row is in hand; the answer is not part of the entry
    /// the pane draws.
    fn open_entry(&mut self, entry_id: u64) -> Option<(EntryDetail, Page)> {
        if let Err(error) = store::set_read(&mut self.db, entry_id, true) {
            self.error = Some(error.to_string());
        }

        let entry = store::entry(&mut self.db, entry_id).ok()?;

        let source = store::source(&mut self.db, entry.source_id).ok()?;
        let source_title = source.title;
        let plugin_preview = store::plugin(&mut self.db, source.plugin_id)
            .map(|plugin| plugin.has_preview)
            .unwrap_or(false);

        // A plugin that returned a body has already said what the entry is,
        // and the host has no business fetching a page to replace it with.
        // What is left is the aggregators: an address, a title, and nothing
        // behind either of them.
        let plugin_body = entry
            .content
            .as_deref()
            .is_some_and(|content| !content.trim().is_empty());

        // The plugin's own page first, because it knows what the item is. The
        // host only knows where it lives, and reads whatever HTML is served at
        // that address — which for a video, a login wall or a JavaScript shell
        // is nothing at all. Falling back to the address is what happens when
        // the plugin has no preview hook, not when it has one that failed.
        let page = if plugin_preview && entry.preview.is_none() && entry.preview_at.is_none() {
            Page::Preview
        } else if !plugin_body
            && entry.article.is_none()
            && entry.article_at.is_none()
            && entry.url.is_some()
        {
            Page::Article
        } else {
            Page::Nothing
        };

        let detail = EntryDetail {
            id: entry.id,
            title: entry.title,
            url: entry.url,
            author: entry.author,
            published_at: entry.published_at,
            content: entry.content,
            summary: entry.summary,
            article: entry.article.map_or(Article::Idle, Article::Read),
            preview: entry.preview.map_or(Article::Idle, Article::Read),
            image: entry.image,
            source_title,
            read: true,
            starred: entry.starred,
        };

        Some((detail, page))
    }

    /// Ask the open entry's plugin to draw its page, and put what it drew in
    /// the pane.
    ///
    /// Blocks for as long as the plugin runs — a JavaScript runtime to start,
    /// a request or two inside it — the same way a refresh does, and with the
    /// same consequence: the window keeps drawing the snapshot published before
    /// this was called.
    ///
    /// A run that failed leaves `preview_at` unset, so opening the entry again
    /// asks again; one that succeeded records the attempt even if the plugin
    /// had nothing to draw, so a video whose page turns out to be empty is not
    /// asked for on every click.
    fn read_open_preview(&mut self) {
        let Some(open) = &self.open else {
            return;
        };

        let entry_id = open.id;

        let preview = match session::preview_entry(&mut self.db, &mut self.http, None, entry_id) {
            Ok(preview) => preview.map_or(Article::Idle, Article::Read),
            // As with the host's own read, the reason is not shown: the pane's
            // line says the page could not be read and that opening the entry
            // again will try, which is everything the reader can act on.
            Err(_) => Article::Failed,
        };

        // Only if the reader has not moved on, for the same reason as
        // `read_open_article`.
        if let Some(open) = &mut self.open
            && open.id == entry_id
        {
            open.preview = preview;
        }
    }

    /// Read the open entry's own page and put what it finds in the pane.
    ///
    /// Blocks the worker for as long as the request takes, the same way a
    /// refresh does. The window stays live — it draws the snapshot published
    /// before this was called — and nothing the user asks for while it runs is
    /// lost, only queued behind it.
    ///
    /// A page that could not be fetched leaves `article_at` unset, so opening
    /// the entry again tries again. A page that *was* fetched records the
    /// attempt whether or not it had an article in it, so a video or a login
    /// wall is read once and never fetched again.
    fn read_open_article(&mut self) {
        let Some(open) = &self.open else {
            return;
        };

        let entry_id = open.id;
        let Some(url) = open.url.clone() else {
            return;
        };

        let article = match self.fetch_article(&url) {
            Ok(article) => {
                if let Err(error) =
                    store::set_article(&mut self.db, entry_id, article.clone(), store::now())
                {
                    self.error = Some(error.to_string());
                }

                article.map_or(Article::Idle, Article::Read)
            }
            // The reason is not shown: a reader who opened a link wants the
            // words, and "connection reset by peer" is not one of them. The
            // line the pane draws says the page could not be read and that
            // opening it again will try, which is the whole of what the reader
            // can act on.
            Err(_) => Article::Failed,
        };

        // Only if the reader has not moved on: this runs on the worker thread
        // with everything else, so nothing else could have changed `open`, but
        // saying so here is what keeps that true if it ever stops being so.
        if let Some(open) = &mut self.open
            && open.id == entry_id
        {
            open.article = article;
        }
    }

    /// Fetch one page and take the article out of it.
    ///
    /// `Ok(None)` is a page that was read and had no article in it — a video, a
    /// login wall, a PDF. `Err` is a page that was not read at all.
    fn fetch_article(&mut self, url: &str) -> Result<Option<String>, String> {
        let init = RequestInit::from_json(&json!({
            "headers": {
                // The conventional browser set. A site that negotiates on this
                // header should hand a reader the page rather than the feed.
                "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            },
        }));

        // `None` for the plugin: this is a request the host made for itself,
        // and the log's per-plugin domain list is a plugin's trust story rather
        // than a record of what the app did on its own.
        let response = self
            .http
            .request(&mut self.db, None, url, init)
            .map_err(|error| error.to_string())?;

        if !(200..300).contains(&response.status) {
            return Err(format!("the page answered {}", response.status));
        }

        if !is_html(&response) {
            return Ok(None);
        }

        Ok(content::article(&response.body))
    }

    /// Install a plugin and subscribe to it, in one step.
    fn install(
        &mut self,
        path: PathBuf,
        title: String,
        settings: Value,
        params: Value,
        events: &Sender<Event>,
        answers: &Receiver<Answer>,
    ) -> Result<(), String> {
        let code = std::fs::read_to_string(&path)
            .map_err(|error| format!("读不到 {}：{error}", path.display()))?;

        let manifest = session::describe(&code).map_err(|error| error.to_string())?;

        let plugin = store::install_plugin(
            &mut self.db,
            NewPlugin {
                plugin_id: manifest.plugin_id.clone(),
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                api_version: manifest.api_version.clone(),
                description: manifest.description.clone(),
                icon: manifest.icon.clone(),
                default_view: manifest.default_view,
                source_code: code,
                settings,
                settings_schema: manifest.settings.clone(),
                params_schema: manifest.params.clone(),
                has_preview: manifest.preview,
            },
        )
        .map_err(|error| format!("装不上：{error}"))?;

        // Let the plugin set itself up. This is the one moment a plugin may
        // prompt, and the reason the dialog plumbing exists at all: a plugin
        // that needs a key asks for it here, while the user is looking.
        let mut bridge = DialogBridge::new(events, answers);
        if let Err(error) =
            session::activate_plugin(&mut self.db, &mut self.http, &mut bridge, events, plugin.id)
        {
            // Still installed. A plugin that failed to activate usually just
            // needs its settings fixed, and throwing it away would lose them.
            self.error = Some(format!("插件已安装，但启用失败：{error}"));
        }

        let source = store::create_source(
            &mut self.db,
            NewSource {
                plugin_id: plugin.id,
                title,
                params,
                view: manifest.default_view,
                category: None,
                refresh_interval_secs: DEFAULT_INTERVAL.as_secs() as i64,
            },
        )
        .map_err(|error| format!("建不了信息源：{error}"))?;

        self.selection = Selection::Source(source.id);
        self.search = None;

        // Fetch once, so the source is not an empty box the user has to guess
        // about. A failure here is the source's own and shows on its row.
        self.busy = Some(format!("正在抓取「{}」", source.title));
        self.publish(events);
        let _ = session::refresh_source(&mut self.db, &mut self.http, source.id, Some(events));

        Ok(())
    }

    /// Refresh every enabled source, one at a time.
    ///
    /// Serially rather than concurrently: each one spawns a process and waits on
    /// somebody else's server, and firing twenty of those at once is how you get
    /// rate-limited by all twenty. The user sees which one is running.
    fn refresh_everything(&mut self, events: &Sender<Event>) {
        let sources = match store::list_sources(&mut self.db) {
            Ok(sources) => sources,
            Err(error) => {
                self.error = Some(error.to_string());
                return;
            }
        };

        for source in sources.into_iter().filter(|source| source.enabled) {
            self.busy = Some(format!("正在抓取「{}」", source.title));
            self.publish(events);
            let _ = session::refresh_source(&mut self.db, &mut self.http, source.id, Some(events));
        }

        self.busy = None;
    }

    /// Refresh the sources whose interval has elapsed.
    fn refresh_due(&mut self, events: &Sender<Event>) {
        let now = store::now();

        let sources = match store::list_sources(&mut self.db) {
            Ok(sources) => sources,
            // Nothing to report: the tick is not something the user asked for,
            // and a database that cannot be read will say so on the next
            // command they do ask for.
            Err(_) => return,
        };

        let due: Vec<_> = sources
            .into_iter()
            .filter(|source| {
                source.enabled
                    && source.refresh_interval_secs > 0
                    && match source.last_fetched_at {
                        // Never fetched: due now. This is what makes a source
                        // added while the app was closed fill itself in.
                        None => true,
                        Some(at) => now - at >= source.refresh_interval_secs,
                    }
            })
            .collect();

        if due.is_empty() {
            return;
        }

        for source in due {
            self.busy = Some(format!("正在抓取「{}」", source.title));
            self.publish(events);
            let _ = session::refresh_source(&mut self.db, &mut self.http, source.id, Some(events));
        }

        self.busy = None;
        self.publish(events);
    }

    /// Build the snapshot and hand it to the UI.
    fn publish(&mut self, events: &Sender<Event>) {
        let snapshot = self.snapshot();
        let _ = events.send(Event::Snapshot(Box::new(snapshot)));
    }

    fn snapshot(&mut self) -> Snapshot {
        let mut snapshot = Snapshot {
            selection: self.selection,
            search: self.search.clone(),
            busy: self.busy.is_some(),
            busy_with: self.busy.clone(),
            ..Snapshot::default()
        };

        // One failed read must not empty the whole window. The sidebar keeps
        // whatever it managed to load and the message says what went wrong,
        // which is far more useful than a blank column.
        if let Err(error) = self.fill(&mut snapshot) {
            snapshot.error = Some(error.to_string());
        } else {
            snapshot.error = self.error.clone();
        }

        snapshot
    }

    fn fill(&mut self, snapshot: &mut Snapshot) -> toasty::Result<()> {
        let sources = store::list_sources(&mut self.db)?;
        let unread = store::unread_counts(&mut self.db)?;
        let lists = store::list_lists(&mut self.db)?;
        let counts = store::list_counts(&mut self.db)?;

        snapshot.unread = unread.total;
        snapshot.starred = unread.starred;

        // The order the user put the rows in, defaulting to the enum's own when
        // they never have. `resolve` guarantees every view appears exactly
        // once, so the sidebar is the same set of rows either way — only the
        // order is theirs.
        //
        // A preference that cannot be read is reported and then ignored rather
        // than propagated: the order of the sidebar is a nicety, and failing
        // `fill` over it would blank a window whose data was fine. The reads
        // above are the ones worth losing the window over — without sources or
        // counts there is nothing to draw.
        let stored = match store::setting_get(&mut self.db, view_order::KEY) {
            Ok(stored) => stored,
            Err(error) => {
                self.error = Some(error.to_string());
                None
            }
        };

        let order = view_order::resolve(stored.as_ref());

        snapshot.tabs = order
            .into_iter()
            .map(|view| Tab {
                view,
                unread: unread.for_view(view),
            })
            .collect();

        snapshot.sources = sources
            .iter()
            .map(|source| SourceRow {
                id: source.id,
                plugin_id: source.plugin_id,
                title: source.title.clone(),
                // A view the app no longer knows about lands in Articles
                // rather than being dropped: a plugin written against a later
                // version should still show its entries somewhere.
                view: View::from_i32(source.view).unwrap_or(View::Articles),
                category: source.category.clone(),
                enabled: source.enabled,
                params: source.params.clone(),
                unread: unread.by_source.get(&source.id).copied().unwrap_or(0),
                error: source.last_error.clone(),
            })
            .collect();

        let plugins = store::list_plugins(&mut self.db)?;

        // Read once and hand the same slice to every row: the log is shared by
        // all plugins, and `recent_domains` is what narrows it to one.
        let log = self.http.request_log();

        snapshot.plugins = plugins
            .iter()
            .map(|plugin| PluginRow {
                id: plugin.id,
                plugin_id: plugin.plugin_id.clone(),
                name: plugin.name.clone(),
                version: plugin.version.clone(),
                description: plugin.description.clone(),
                enabled: plugin.enabled,
                sources: sources
                    .iter()
                    .filter(|source| source.plugin_id == plugin.id)
                    .count(),
                // The newest failure, since `sources` comes back in insertion
                // order rather than by time and a plugin's sources all break
                // together anyway.
                error: sources
                    .iter()
                    .filter(|source| source.plugin_id == plugin.id)
                    .find_map(|source| source.last_error.clone()),
                recent_domains: recent_domains(log, plugin.id, DOMAIN_LIMIT),
                settings: plugin.settings.clone(),
                settings_schema: plugin.settings_schema.clone(),
                params_schema: plugin.params_schema.clone(),
            })
            .collect();

        snapshot.lists = lists
            .iter()
            .map(|list| ListRow {
                id: list.id,
                name: list.name.clone(),
                count: counts.get(&list.id).copied().unwrap_or(0),
            })
            .collect();

        let titles: HashMap<u64, String> = sources
            .iter()
            .map(|source| (source.id, source.title.clone()))
            .collect();

        let entries = match &self.search {
            Some(query) => store::search(&mut self.db, query, ENTRY_LIMIT)?,
            None => store::entries_for(&mut self.db, self.selection, ENTRY_LIMIT)?,
        };

        snapshot.entries = entries
            .iter()
            .map(|entry| EntryRow {
                id: entry.id,
                source_id: entry.source_id,
                source_title: titles.get(&entry.source_id).cloned().unwrap_or_default(),
                title: entry.title.clone(),
                url: entry.url.clone(),
                author: entry.author.clone(),
                published_at: entry.published_at,
                summary: entry.summary.clone(),
                image: entry.image.clone(),
                read: entry.read,
                starred: entry.starred,
            })
            .collect();

        snapshot.open = self.open.clone();

        Ok(())
    }
}

/// Whether a response is markup rather than something with no prose in it.
///
/// A link in a feed is as likely to be a PDF, a video or an image as it is to
/// be an article, and none of those has a body to read. A response that names
/// no type at all is given the benefit of the doubt: plenty of servers omit the
/// header, and refusing those would give up on pages that are perfectly
/// readable.
fn is_html(response: &HttpResponse) -> bool {
    let Some(kind) = response
        .headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value)
    else {
        return true;
    };

    // The header carries its charset after a semicolon often enough that
    // comparing the whole value would reject most of the web.
    let kind = kind.split(';').next().unwrap_or_default().trim();

    kind.eq_ignore_ascii_case("text/html") || kind.eq_ignore_ascii_case("application/xhtml+xml")
}

/// Read a plugin file and ask it what it is.
fn read_and_describe(path: &std::path::Path) -> Result<Manifest, String> {
    let code = std::fs::read_to_string(path)
        .map_err(|error| format!("读不到 {}：{error}", path.display()))?;

    session::describe(&code).map_err(|error| error.to_string())
}

/// The worker's side of a dialog conversation.
///
/// The plugin is blocked inside `activate`, so the worker is blocked with it —
/// but the worker is not the UI thread, so the window stays live while the user
/// decides. That is the whole reason a plugin can ask a question at all.
struct DialogBridge<'a> {
    events: &'a Sender<Event>,
    answers: &'a Receiver<Answer>,
    /// Ids for questions asked in this run, so an answer cannot be applied to
    /// the wrong one.
    next_id: u64,
}

impl<'a> DialogBridge<'a> {
    fn new(events: &'a Sender<Event>, answers: &'a Receiver<Answer>) -> Self {
        Self {
            events,
            answers,
            next_id: 0,
        }
    }
}

impl Dialogs for DialogBridge<'_> {
    fn ask(&mut self, request: DialogRequest) -> Value {
        // Only questions reach here — the reports are answered in `Services`
        // before the window check, because they need no window. Reaching this
        // with one would mean the plugin waited on a notification, so it is
        // worth saying rather than quietly sending it.
        debug_assert!(
            request.is_blocking(),
            "a report was routed to the question path"
        );

        let id = self.next_id;
        self.next_id += 1;

        if self.events.send(Event::Ask(Ask { id, request })).is_err() {
            // The window is gone, so nobody will ever answer. The plugin gets a
            // "no" rather than hanging forever on a question with no asker.
            return Value::Null;
        }

        loop {
            match self.answers.recv() {
                Ok(answer) if answer.id == id => return answer.value,
                // An answer to a question that was already abandoned — the
                // window closed and reopened, say. Skipping it is the only
                // reading that does not apply somebody's answer to the wrong
                // question.
                Ok(_) => continue,
                Err(_) => return Value::Null,
            }
        }
    }
}
