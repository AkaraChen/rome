//! The application's presentation layer.
//!
//! Every module here is a function from a [`Snapshot`] to an element. None of
//! them reads the database, none of them owns any state, and none of them
//! decides what a click means — an element that the user can act on calls the
//! [`Dispatch`] it was handed and lets the application work out the rest.
//!
//! That is not tidiness for its own sake. The UI cannot read the database at
//! all: `store::` calls block until their statement finishes and a plugin run
//! blocks for as long as thirty seconds, so all of it happens on the worker
//! thread and the UI is a function of what the worker last published. See
//! [`crate::worker`].
//!
//! [`Snapshot`]: crate::snapshot::Snapshot

use std::rc::Rc;

use gpui_kit::*;

use crate::worker::Command;

pub mod add_source;
pub mod app;
pub mod content;
pub mod dialog;
pub mod entry_list;
pub mod feed;
pub mod form;
pub mod lists;
pub mod picture;
pub mod plugins;
pub mod reading_pane;
pub mod search;
pub mod sidebar;
pub mod wizard;

/// Something the user did, in the one vocabulary the UI speaks.
///
/// Most of it is a [`Command`] for the worker, and wrapping those rather than
/// passing them straight through is what leaves room for the rest: a few
/// things the user can do start and end in the window — opening the "add a
/// source" flow, answering a plugin's question — and they need a way through
/// the same dispatch as everything else.
#[derive(Debug, Clone)]
pub enum Action {
    /// Ask the worker to do something.
    Worker(Command),
    /// Open the add-source page on its installed-plugins tab.
    ///
    /// This is what 「添加信息源」 in the sidebar means: add a subscription to a
    /// plugin that is already here. Installing a plugin is the page's other
    /// tab, not the thing this button asks for.
    OpenAddSource,
    /// Open the add-source page on its market tab.
    ///
    /// The plugin manager's way to get more plugins. It is the same page
    /// because it is the same journey — install, then subscribe — but a
    /// different tab, because the two are different jobs.
    OpenPluginMarket,
    /// Switch between the add-source page's two tabs.
    SwitchAddSource(wizard::Tab),
    /// Install a bundled plugin by slug, leaving the source for later.
    InstallBundled(String),
    /// Open a plugin file and install it, leaving the source for later.
    InstallFromFile,
    /// Start configuring a source for an installed plugin.
    SelectAddSourcePlugin(u64),
    /// Go back from configuring a source to choosing its plugin.
    AddSourceBack,
    /// Create the source the page has been filled in for.
    SubmitAddSource,
    /// Open a plugin's settings, so its parameters can be corrected without
    /// reinstalling it.
    EditSource(u64),
    /// Open an installed plugin's settings.
    ///
    /// Distinct from [`Action::EditSource`] because a plugin's settings are one
    /// object shared by all the sources it has, while a source's parameters
    /// differ per subscription.
    EditPlugin(u64),
    /// Forget a source, after the user has confirmed it.
    RemoveSource(u64),
    /// Forget a plugin, its sources and its entries, after the user has
    /// confirmed it.
    ///
    /// Separate from switching it off, which is the reversible move and keeps
    /// everything: this is the one that does not come back.
    RemovePlugin(u64),
    /// Show the plugin manager in the middle column.
    ///
    /// Plugin health is a thing the user has to be able to look at, not only a
    /// marker on a sidebar row: a plugin that stopped working needs somewhere
    /// to say what went wrong and a way to be switched off.
    ManagePlugins,
    /// Make a list, asking for its name first.
    CreateList,
    /// Rename a list, asking for the new name first.
    RenameList(u64),
    /// Throw a list away, after the user has confirmed it.
    DeleteList(u64),
    /// File an entry into one of the user's lists.
    ///
    /// Takes the entry rather than the list because that is the order the user
    /// does it in: they are looking at something and decide where it goes.
    AddToList(u64),
    /// Collapse the sidebar to its icons, or bring it back.
    ///
    /// The one action here that the worker has no part in: nothing about it
    /// belongs in the database. It is a fact about this window, and a reader
    /// who narrowed it to get a column of text wider will not thank an app that
    /// remembered.
    ToggleSidebar,
}

impl From<Command> for Action {
    fn from(command: Command) -> Self {
        Self::Worker(command)
    }
}

/// The callback every interactive element in the UI calls.
///
/// Named rather than spelled out at each site: it appears in most signatures
/// here, and a `dyn Fn` taking three arguments is unreadable inline.
///
/// It is an `Rc<dyn Fn>` rather than a generic parameter because these
/// functions are called from `render`, which cannot be generic over a callback
/// type without making every view in the app generic in turn.
pub type Dispatch = Rc<dyn Fn(Action, &mut Window, &mut App)>;

/// Build a [`Dispatch`] that sends everything to `handler` on the entity that
/// owns it.
///
/// The indirection is what lets a pane hold the callback for as long as its
/// element lives: `cx.listener` re-enters the entity through its handle rather
/// than through a borrow of it, so the element outlives the call that built it.
pub fn dispatch<T: 'static>(
    cx: &Context<T>,
    handler: impl Fn(&mut T, Action, &mut Window, &mut Context<T>) + 'static,
) -> Dispatch {
    let listener = cx.listener(
        move |this: &mut T, action: &Action, window: &mut Window, cx: &mut Context<T>| {
            handler(this, action.clone(), window, cx)
        },
    );

    Rc::new(move |action, window, cx| listener(&action, window, cx))
}

/// The action that makes `source` the selection.
pub fn select_source(source_id: u64) -> Action {
    Action::Worker(Command::Select(crate::snapshot::Selection::Source(
        source_id,
    )))
}

/// A publication time, the way the list and the reading pane say it.
///
/// Deliberately coarse. A feed is read by the day — "3 天前" is what a reader
/// wants, and "2026-10-15 14:23:07" is what a log wants. Today's entries are
/// the one exception, where the time of day is the useful part.
pub fn when(at: i64) -> String {
    use chrono::{Datelike, Local, TimeZone};

    let Some(time) = Local.timestamp_opt(at, 0).single() else {
        return String::new();
    };

    let now = Local::now();
    let days = (now.date_naive() - time.date_naive()).num_days();

    match days {
        0 => time.format("%H:%M").to_string(),
        1 => "昨天".to_owned(),
        2..=6 => format!("{days} 天前"),
        // A timestamp in the future — a feed that got its own date wrong, or a
        // machine whose clock is behind. Better as a date than as "-2 天前".
        _ if time.year() == now.year() && days > 0 => time.format("%m-%d").to_string(),
        _ if days > 0 => time.format("%Y-%m-%d").to_string(),
        _ => time.format("%m-%d").to_string(),
    }
}
