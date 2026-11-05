//! Session tabs (E.12, rows W01, W02, W08): the state of `context/session-tabs.tsx`, its commands
//! (`app.tsx:849-902,1317-1321`), and the strip and rail that draw it. Layout: `docs/E.12.md`.
//!
//! `app::Tui` holds one [`Tabs`]. `Tui::navigate` calls [`route_changed`], `Tui::sync` calls [`sync`], and
//! `features::events` passes `session.deleted` to [`session_deleted`] first.

pub mod model;
pub mod pulse;
pub mod rail;
pub mod strip;

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::generated::{
    SessionID, SessionInboxInfo, SessionInboxItem, SessionInfoOutcome, SessionViewInput, V2Event,
};
use opencode_local::storage::Storage;
use opencode_store::{Changes, SessionStatus, State};
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opentui::input::{KeyCode, Modifiers};
use opentui::keymap::{Condition, Disposer};
use serde::{Deserialize, Serialize};

use crate::app::Tui;
use crate::routes::Route;
use crate::routes::session::messages::list::ScrollAnchor;
use model::{Closed, History, NEW_SESSION_TAB_TITLE, Tab, Unread};

const VIEW_RETRY_DELAY: Duration = Duration::from_millis(250);
const VIEW_RETRY_MAX_DELAY: Duration = Duration::from_secs(5);

/// One scope's tabs as `tabs.json` stores them. `unread` stays empty, for older clients that still read it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Scope {
    #[serde(default)]
    pub tabs: Vec<Tab>,
    #[serde(default)]
    pub unread: serde_json::Map<String, serde_json::Value>,
}

/// The whole `tabs` storage key.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Persisted {
    #[serde(default)]
    pub global: Scope,
    #[serde(default)]
    pub cwd: BTreeMap<String, Scope>,
}

/// What a tab shows besides its title (`status` in `context/session-tabs.tsx`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Status {
    pub unread: Option<Unread>,
    pub prompt_pulse: u32,
    pub attention: Option<Attention>,
    pub busy: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Attention {
    Permission,
    Question,
}

impl Status {
    pub fn complete(&self) -> bool {
        model::complete(self.unread, self.busy)
    }

    /// The running sweep shows while busy and nothing waits on the user.
    pub fn runs(&self) -> bool {
        self.busy && self.attention.is_none()
    }
}

type Mutation = Arc<dyn Fn(&mut Scope) + Send + Sync>;
type Write = Arc<dyn Fn(&mut Persisted) + Send + Sync>;

#[derive(Default)]
pub struct Tabs {
    file: RefCell<Persisted>,
    /// The latest write; a write's result replaces the memory copy only if no newer write was sent.
    writes: Cell<u64>,
    /// Writes not in `tabs.json` yet, in the order they were made, with their revisions.
    pending: Arc<Mutex<Vec<(u64, Write)>>>,
    history: RefCell<History>,
    closed: RefCell<Vec<Closed>>,
    /// Closed tabs that a write still in flight must not bring back (`cancelledTabs`).
    cancelled: RefCell<HashSet<String>>,
    pulses: RefCell<HashMap<String, u32>>,
    groups: RefCell<HashMap<String, HashMap<String, bool>>>,
    anchors: RefCell<HashMap<String, ScrollAnchor>>,
    new_tab: Cell<bool>,
    /// The routed session the last [`route_changed`] admitted, so a remount does not record it twice.
    routed: RefCell<Option<String>>,
    focused: Cell<Option<bool>>,
    acknowledged: RefCell<HashMap<String, f64>>,
    retry: Cell<Option<opentui::prelude::TimerId>>,
    attempt: Cell<u32>,
    cwd: RefCell<String>,
    /// Tabs whose session [`prefetch`] read.
    fetched: RefCell<HashSet<String>>,
    epoch: Cell<Option<std::time::Instant>>,
    _watch: RefCell<Option<opencode_local::watch::Watch>>,
}

impl Tabs {
    /// When the tabs mounted; spinner frames count from it.
    pub fn epoch(&self) -> std::time::Instant {
        self.epoch.get().unwrap_or_else(std::time::Instant::now)
    }

    /// `config.tabs.enabled`.
    pub fn enabled(tui: &Tui) -> bool {
        tui.config().tabs.enabled
    }

    /// The open tabs of the configured scope.
    pub fn tabs(&self, tui: &Tui) -> Vec<Tab> {
        let file = self.file.borrow();
        let scope = match tui.config().tabs.scope {
            opencode_local::cli_config::TabsScope::Cwd => file.cwd.get(self.cwd.borrow().as_str()),
            _ => Some(&file.global),
        };
        scope.map(|scope| scope.tabs.clone()).unwrap_or_default()
    }

    /// Whether the new-session slot is the active tab (`newTab`).
    pub fn new_tab(&self) -> bool {
        self.new_tab.get()
    }

    /// The root session of the open session route (`current`).
    pub fn current(&self, tui: &Tui) -> Option<String> {
        match tui.route() {
            Route::Session { id } => Some(tui.data.read(|state| state.root(&id)).0),
            _ => None,
        }
    }

    /// The tabs dialogs show as open: the open tab IDs while tabs are on.
    pub fn open_ids(&self, tui: &Tui) -> Vec<String> {
        if !Self::enabled(tui) {
            return Vec::new();
        }
        self.tabs(tui).into_iter().map(|tab| tab.session_id).collect()
    }

    pub fn status(&self, tui: &Tui, session: &str) -> Status {
        let pulse = self.pulses.borrow().get(session).copied().unwrap_or(0);
        tui.data.read(|state| status(state, &SessionID(session.to_owned()), pulse))
    }

    /// Recently closed tabs that are not open again, newest first, with their current titles.
    pub fn recently_closed(&self, tui: &Tui) -> Vec<Tab> {
        let open = self.tabs(tui);
        let closed = self.closed.borrow().clone();
        tui.data.read(|state| {
            closed
                .into_iter()
                .rev()
                .filter(|entry| !open.iter().any(|tab| tab.session_id == entry.tab.session_id))
                .map(|entry| Tab {
                    title: state
                        .session(&SessionID(entry.tab.session_id.clone()))
                        .and_then(|session| session.title.clone())
                        .or(entry.tab.title),
                    session_id: entry.tab.session_id,
                })
                .collect()
        })
    }

    /// The groups of `session` the reader opened or closed, by group ID (E.8, `sessionTabs.groupExpanded`). They
    /// outlive the session's view.
    pub fn expanded_groups(&self, session: &str) -> HashMap<String, bool> {
        self.groups.borrow().get(session).cloned().unwrap_or_default()
    }

    /// `sessionTabs.setGroupExpanded` for every group of `session`.
    pub fn set_expanded_groups(&self, session: &str, groups: HashMap<String, bool>) {
        self.groups.borrow_mut().insert(session.to_owned(), groups);
    }

    /// Where the reader left `session`'s transcript, while its tab is open (`sessionTabs.scrollAnchor`).
    pub fn scroll_anchor(&self, tui: &Tui, session: &str) -> Option<ScrollAnchor> {
        self.is_open(tui, session).then(|| self.anchors.borrow().get(session).cloned()).flatten()
    }

    /// `sessionTabs.setScrollAnchor`: kept only while the session's tab is open.
    pub fn set_scroll_anchor(&self, tui: &Tui, session: &str, anchor: Option<ScrollAnchor>) {
        match anchor.filter(|_| self.is_open(tui, session)) {
            Some(anchor) => self.anchors.borrow_mut().insert(session.to_owned(), anchor),
            None => self.anchors.borrow_mut().remove(session),
        };
    }

    fn is_open(&self, tui: &Tui, session: &str) -> bool {
        let root = tui.data.read(|state| state.root(&SessionID(session.to_owned()))).0;
        self.tabs(tui).iter().any(|tab| tab.session_id == root)
    }

    /// The tabs file, for tests and the P-FILE proof.
    pub fn persisted(&self) -> Persisted {
        self.file.borrow().clone()
    }
}

/// Loads `tabs.json`, registers the tab commands, and follows the storage directory.
pub fn install(tui: &Rc<Tui>) {
    tui.tabs.epoch.set(Some(tui.app.now()));
    *tui.tabs.cwd.borrow_mut() =
        std::env::current_dir().map(|path| path.to_string_lossy().into_owned()).unwrap_or_default();
    if let Some(storage) = tui.storage() {
        *tui.tabs.file.borrow_mut() = load(&storage);
        let proxy = tui.app.proxy();
        *tui.tabs._watch.borrow_mut() = storage.watch(move || {
            let _ = proxy.send(Reload);
        });
        tui.app.on_message(bind!(tui, |tui, _, _: &Reload| {
            if let Some(storage) = tui.storage() {
                let file = load(&storage);
                if *tui.tabs.file.borrow() != file {
                    *tui.tabs.file.borrow_mut() = file;
                    changed(&tui);
                }
                crate::frame::reload(&tui, &storage);
            }
        }));
    }
    let weak = tui.weak();
    tui.app.on_message(bind!(weak, |tui, _, Written(revision, file)| {
        if *revision == tui.tabs.writes.get() && *tui.tabs.file.borrow() != *file {
            *tui.tabs.file.borrow_mut() = file.clone();
            changed(&tui);
        }
    }));
    // Terminal focus reports set the focus. TS also counts `useKeyboard`: the keymap consumes shortcuts before
    // it (`E.12/tab-strip` posts no `session.view` after them), but typed text reaches it (`H.5/permission-reply`
    // posts `session.view` without a focus report).
    let weak = tui.weak();
    tui.app.on_key_capture(move |_, key| {
        let typed = matches!(key.code, KeyCode::Char(_))
            && key.modifiers.without_locks().bits() & !Modifiers::SHIFT.bits() == 0;
        if let Some(tui) = weak.upgrade().filter(|tui| typed && tui.tabs.focused.get() != Some(true)) {
            tui.tabs.focused.set(Some(true));
            acknowledge(&tui);
        }
    });
    tui.app.on_terminal_focus(bind!(tui, |tui, _, focused| {
        tui.tabs.focused.set(Some(focused));
        acknowledge(&tui);
    }));
    install_commands(tui);
}

struct Reload;
struct Written(u64, Persisted);

fn load(storage: &Storage) -> Persisted {
    storage
        .load("tabs", &serde_json::json!({}))
        .ok()
        .and_then(|value| serde_json::from_value(value).ok())
        .unwrap_or_default()
}

fn install_commands(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let command = |id: &str, title: &str, palette: bool, run: Rc<dyn Fn(&Tui)>| {
        let target = weak.clone();
        let command = TuiCommand::new(id, bind!(target, |tui, _, _| run(&tui)))
            .bind(Bind::Off)
            .title(title)
            .group("Session")
            .enabled(enabled(&weak));
        if palette { command.palette() } else { command }
    };
    let mut commands = vec![
        command("session.tab.next", "Next tab", false, Rc::new(|tui| cycle(tui, true, false))),
        command("session.tab.previous", "Previous tab", false, Rc::new(|tui| cycle(tui, false, false))),
        command("session.tab.next_unread", "Next unread tab", false, Rc::new(|tui| cycle(tui, true, true))),
        command("session.tab.previous_unread", "Previous unread tab", false, Rc::new(|tui| cycle(tui, false, true))),
        command("session.tab.close", "Close tab", true, Rc::new(|tui| close(tui, None))),
        command("session.tab.reopen", "Reopen closed tab", true, Rc::new(|tui| reopen(tui, None))),
    ];
    commands.extend((0..10).map(|index| {
        command(
            &format!("session.tab.select.{}", index + 1),
            &format!("Switch to tab {}", index + 1),
            false,
            Rc::new(move |tui| select_index(tui, index)),
        )
    }));
    let names: Vec<String> = commands.iter().filter_map(|command| command.id.clone()).collect();
    let layers = [
        KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands, ..KeymapLayer::default() },
        // `sessionTabBindingCommands`, bound only while tabs are on.
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            enabled: enabled(&weak),
            bindings: names,
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        // The layers live as long as the keymap, which the TUI owns.
        if let Err(error) = tui.keymap.layer(layer).map(Disposer::forget) {
            log::error!("tab keymap layer: {error}");
        }
    }
}

fn enabled(weak: &std::rc::Weak<Tui>) -> Condition {
    let weak = weak.clone();
    Condition::when(move || weak.upgrade().is_some_and(|tui| Tabs::enabled(&tui)))
}

/// After a route change: admit the routed session as a tab and record it in the history.
pub fn route_changed(tui: &Tui) {
    let tabs = &tui.tabs;
    let routed = match tui.route() {
        Route::Session { id } => Some(id),
        _ => None,
    };
    let open = tabs.tabs(tui);
    let previous = tabs.new_tab.get();
    let root = routed.as_ref().map(|id| tui.data.read(|state| state.root(id)).0);
    tabs.new_tab.set(match &root {
        None => matches!(tui.route(), Route::Home),
        Some(root) => previous && !open.iter().any(|tab| &tab.session_id == root),
    });
    let Some(root) = root.filter(|_| Tabs::enabled(tui)) else {
        tabs.routed.replace(None);
        acknowledge(tui);
        return;
    };
    if tabs.routed.replace(Some(root.clone())).as_ref() == Some(&root) {
        return;
    }
    tabs.cancelled.borrow_mut().remove(&root);
    tabs.history.borrow_mut().record(&root);
    if !open.iter().any(|tab| tab.session_id == root) {
        let fallback = tabs.new_tab.get().then(|| NEW_SESSION_TAB_TITLE.to_owned());
        let known = title_of(tui, &root, None, None);
        let session = root.clone();
        update(tui, move |scope| {
            let persisted = scope.tabs.iter().find(|tab| tab.session_id == session).and_then(|tab| tab.title.clone());
            let title = known.clone().or(persisted).or(fallback.clone());
            if let Some(tabs) = model::open(&scope.tabs, Tab::new(session.clone(), title)) {
                scope.tabs = tabs;
            }
        });
        tabs.new_tab.set(false);
    }
    acknowledge(tui);
}

/// After the store changed: refresh titles and roots of open tabs (`normalize`), count prompt pulses, and
/// acknowledge what the user sees.
pub fn sync(tui: &Tui, changes: &Changes) {
    prefetch(tui);
    if Tabs::enabled(tui) && changes.sessions() {
        let open = tui.tabs.tabs(tui);
        // `normalize`: each tab under its root session, once, with the store's title.
        let mapping: Vec<(String, Tab)> = open
            .iter()
            .map(|tab| {
                let root = tui.data.read(|state| state.root(&SessionID(tab.session_id.clone()))).0;
                let title = title_of(tui, &root, tab.title.clone(), None);
                (tab.session_id.clone(), Tab::new(root, title))
            })
            .collect();
        let normalize = move |tabs: &[Tab]| {
            tabs.iter().fold(Vec::new(), |next, tab| {
                let tab = mapping
                    .iter()
                    .find(|(id, _)| *id == tab.session_id)
                    .map_or_else(|| tab.clone(), |(_, tab)| tab.clone());
                model::open(&next, tab).unwrap_or(next)
            })
        };
        if normalize(&open) != open {
            // Applied again to the file, which may hold another client's tabs.
            update(tui, move |scope| scope.tabs = normalize(&scope.tabs));
        }
    }
    acknowledge(tui);
}

/// Reads each open tab's session and its children once, so persisted tabs show current titles and states
/// (the first half of the TS prefetch effect; the delayed message, inbox, permission, and form reads are not
/// ported).
fn prefetch(tui: &Tui) {
    if !Tabs::enabled(tui) {
        return;
    }
    let tabs = tui.tabs.tabs(tui);
    let missing: Vec<SessionID> = tui.data.read(|state| {
        tabs.iter().map(|tab| SessionID(tab.session_id.clone())).filter(|id| state.session(id).is_none()).collect()
    });
    for id in missing {
        if tui.tabs.fetched.borrow_mut().insert(id.0.clone()) {
            let task = tui.data.session_sync(&id, true);
            tui.app.spawn(task, |_, _| {});
        }
    }
}

/// `title`: the store's title, else the persisted one, else the fallback, else the timestamped default.
fn title_of(tui: &Tui, session: &str, persisted: Option<String>, fallback: Option<String>) -> Option<String> {
    let info = tui.data.read(|state| state.session(&SessionID(session.to_owned())).cloned());
    info.as_ref()
        .and_then(|info| info.title.clone())
        .or(persisted)
        .or(fallback)
        .or_else(|| info.as_ref().map(crate::dialogs::session_list::title))
}

/// A server event the tabs follow. Returns whether it navigated away from a deleted session.
pub fn event(tui: &Tui, event: &V2Event) -> bool {
    match event {
        V2Event::SessionDeleted(event) => {
            let target = tui.data.read(|state| state.root(&event.data.session_id)).0;
            tui.tabs.closed.borrow_mut().retain(|entry| entry.tab.session_id != target);
            let before = tui.route();
            remove(tui, &event.data.session_id.0, Tabs::enabled(tui));
            before != tui.route()
        }
        V2Event::SessionInboxEnqueued(event) => {
            if !Tabs::enabled(tui) || !matches!(event.data.item, SessionInboxItem::User(_)) {
                return false;
            }
            let session = tui.data.read(|state| state.root(&event.data.session_id)).0;
            if tui.tabs.current(tui).as_ref() == Some(&session)
                || !tui.tabs.tabs(tui).iter().any(|tab| tab.session_id == session)
            {
                return false;
            }
            *tui.tabs.pulses.borrow_mut().entry(session).or_default() += 1;
            changed(tui);
            false
        }
        _ => false,
    }
}

/// `remove`: drops the tab, and with `navigate`, leaves it when it is open.
fn remove(tui: &Tui, session: &str, navigate: bool) {
    let tabs = &tui.tabs;
    let target = tui.data.read(|state| state.root(&SessionID(session.to_owned()))).0;
    tabs.cancelled.borrow_mut().insert(target.clone());
    let family: Vec<String> = tui.data.read(|state| {
        let root = SessionID(target.clone());
        std::iter::once(root.0.clone()).chain(state.family(&root).iter().map(|id| id.0.clone())).collect()
    });
    for id in &family {
        tabs.groups.borrow_mut().remove(id);
        tabs.anchors.borrow_mut().remove(id);
    }
    let open = tabs.tabs(tui);
    let closed = model::close(&open, &target);
    let selected = navigate && tabs.current(tui).as_ref() == Some(&target);
    if closed.is_none() && !selected {
        return;
    }
    let (rest, neighbour) = closed.unwrap_or((open, None));
    let next = if selected {
        let mut history = tabs.history.borrow_mut();
        history.record(&target);
        history.step(&rest, Some(&target), false).or(neighbour)
    } else {
        neighbour
    };
    let removed = target.clone();
    update(tui, move |scope| {
        if let Some((tabs, _)) = model::close(&scope.tabs, &removed) {
            scope.tabs = tabs;
        }
    });
    tabs.pulses.borrow_mut().remove(&target);
    if selected {
        tui.navigate(match next {
            Some(id) => Route::Session { id: SessionID(id) },
            None => Route::Home,
        });
    }
    changed(tui);
}

/// `select`.
pub fn select(tui: &Tui, session: &str) {
    if !Tabs::enabled(tui) {
        return;
    }
    let root = tui.data.read(|state| state.root(&SessionID(session.to_owned())));
    tui.navigate(Route::Session { id: root });
}

/// `add`: the new-session page, in the location `session.new_location` picks.
pub fn add(tui: &Tui) {
    if !Tabs::enabled(tui) {
        return;
    }
    crate::features::clear::navigate_new(tui);
}

/// `close`: the given tab, else the open one; on the new-session page, back to the last tab.
pub fn close(tui: &Tui, session: Option<&str>) {
    if !Tabs::enabled(tui) {
        return;
    }
    let tabs = &tui.tabs;
    let target = match session {
        Some(session) => Some(tui.data.read(|state| state.root(&SessionID(session.to_owned()))).0),
        None => tabs.current(tui),
    };
    let open = tabs.tabs(tui);
    let Some(target) = target else {
        let previous = tabs.history.borrow_mut().step(&open, None, false);
        let session = previous.or_else(|| open.last().map(|tab| tab.session_id.clone()));
        if let (Route::Home, Some(session)) = (tui.route(), session) {
            tui.navigate(Route::Session { id: SessionID(session) });
        }
        return;
    };
    if let Some(index) = open.iter().position(|tab| tab.session_id == target) {
        model::record_closed(&mut tabs.closed.borrow_mut(), open[index].clone(), index);
    }
    remove(tui, &target, true);
}

/// `reopen`.
pub fn reopen(tui: &Tui, session: Option<&str>) {
    if !Tabs::enabled(tui) {
        return;
    }
    let open = tui.tabs.tabs(tui);
    let Some((next, session)) = model::reopen(&mut tui.tabs.closed.borrow_mut(), &open, session) else {
        return;
    };
    tui.tabs.cancelled.borrow_mut().remove(&session);
    update(tui, move |scope| scope.tabs = next.clone());
    tui.navigate(Route::Session { id: SessionID(session) });
}

/// `move`.
pub fn reorder(tui: &Tui, session: &str, index: usize) {
    if !Tabs::enabled(tui) {
        return;
    }
    let root = tui.data.read(|state| state.root(&SessionID(session.to_owned()))).0;
    if model::reorder(&tui.tabs.tabs(tui), &root, index).is_none() {
        return;
    }
    update(tui, move |scope| {
        if let Some(tabs) = model::reorder(&scope.tabs, &root, index) {
            scope.tabs = tabs;
        }
    });
}

/// `cycle` and `cycleUnread`.
fn cycle(tui: &Tui, forward: bool, unread: bool) {
    let open = tui.tabs.tabs(tui);
    let current = tui.tabs.current(tui);
    let target = model::cycle(&open, current.as_deref(), forward, |tab| {
        !unread || {
            let status = tui.tabs.status(tui, &tab.session_id);
            status.unread.is_some() || status.attention.is_some()
        }
    })
    .map(|tab| tab.session_id.clone());
    if let Some(session) = target {
        tui.navigate(Route::Session { id: SessionID(session) });
    }
}

fn select_index(tui: &Tui, index: usize) {
    if let Some(tab) = tui.tabs.tabs(tui).get(index) {
        tui.navigate(Route::Session { id: SessionID(tab.session_id.clone()) });
    }
}

/// Applies `mutation` to the scope in memory now, and to `tabs.json` under the storage lock on a blocking
/// thread. The written file then replaces the memory copy, unless a newer write was sent meanwhile.
///
/// Blocking tasks can run in any order, so each one writes every pending mutation, in the order they were
/// made, while it holds the queue: a title that lands just after its tab opened must not reach the file
/// before the tab does.
fn update(tui: &Tui, mutation: impl Fn(&mut Scope) + Send + Sync + 'static) {
    let mutation: Mutation = Arc::new(mutation);
    let cwd = tui.tabs.cwd.borrow().clone();
    let scoped = matches!(tui.config().tabs.scope, opencode_local::cli_config::TabsScope::Cwd);
    let apply = {
        let mutation = mutation.clone();
        move |file: &mut Persisted| {
            if scoped {
                mutation(file.cwd.entry(cwd.clone()).or_default());
            } else {
                mutation(&mut file.global);
            }
        }
    };
    apply(&mut tui.tabs.file.borrow_mut());
    let revision = tui.tabs.writes.get() + 1;
    tui.tabs.writes.set(revision);
    changed(tui);
    let Some(storage) = tui.storage() else { return };
    if let Ok(mut pending) = tui.tabs.pending.lock() {
        pending.push((revision, Arc::new(apply)));
    }
    let pending = tui.tabs.pending.clone();
    let proxy = tui.app.proxy();
    tui.app.runtime().spawn_blocking(move || {
        let Ok(mut pending) = pending.lock() else {
            return;
        };
        // An earlier task already wrote this one.
        let Some(&(revision, _)) = pending.last() else {
            return;
        };
        let batch = std::mem::take(&mut *pending);
        let result = storage.update("tabs", &serde_json::json!({}), |value| {
            let mut file: Persisted = serde_json::from_value(value.clone()).unwrap_or_default();
            for (_, write) in &batch {
                write(&mut file);
            }
            *value = serde_json::to_value(&file).unwrap_or_default();
        });
        match result {
            Ok(value) => {
                let file = serde_json::from_value(value).unwrap_or_default();
                let _ = proxy.send(Written(revision, file));
            }
            // A failed write loses only the tab layout, but silence would hide tabs resetting every launch.
            Err(error) => log::error!("Failed to persist session tabs: {error}"),
        }
    });
}

/// Repaints what shows the tabs.
fn changed(tui: &Tui) {
    crate::frame::refresh(tui);
    crate::features::attention::program_status::sync(tui);
}

/// `status` over a store snapshot.
pub fn status(state: &State, session: &SessionID, prompt_pulse: u32) -> Status {
    let root = state.root(session);
    let members: Vec<SessionID> = {
        let family = state.family(&root);
        if family.contains(&root) {
            family.to_vec()
        } else {
            std::iter::once(root.clone()).chain(family.iter().cloned()).collect()
        }
    };
    let info = state.session(&root);
    let unread = info.and_then(|info| {
        let idle = info.time.idle?;
        let viewed = info.time.viewed.is_none_or(|viewed| idle > viewed);
        viewed.then_some(if info.outcome == Some(SessionInfoOutcome::Failed) {
            Unread::Error
        } else {
            Unread::Activity
        })
    });
    let attention = if members.iter().any(|id| state.permissions(id).is_some_and(|list| !list.is_empty())) {
        Some(Attention::Permission)
    } else if members.iter().any(|id| state.forms(&id.0, None).is_some_and(|list| !list.is_empty())) {
        Some(Attention::Question)
    } else {
        None
    };
    let busy = members.iter().any(|id| {
        state.status(id) == SessionStatus::Running
            || state.pending(id).iter().any(|item| !matches!(item, SessionInboxInfo::Synthetic(_)))
    });
    Status { unread, prompt_pulse, attention, busy }
}

/// Posts `session.view` for the open root session once per idle watermark, while the terminal has focus.
/// Viewed state is server-global, so this runs with tabs off too.
fn acknowledge(tui: &Tui) {
    let tabs = &tui.tabs;
    if tabs.focused.get() != Some(true) {
        return;
    }
    let Some(session) = tabs.current(tui) else {
        return;
    };
    let id = SessionID(session.clone());
    let Some(idle) = tui.data.read(|state| {
        let info = state.session(&id)?;
        let idle = info.time.idle?;
        info.time.viewed.is_none_or(|viewed| idle > viewed).then_some(idle)
    }) else {
        return;
    };
    if tabs.acknowledged.borrow().get(&session) == Some(&idle) {
        return;
    }
    // Recorded before the request, so event-driven syncs do not post the same watermark again.
    tabs.acknowledged.borrow_mut().insert(session.clone(), idle);
    let client = tui.data.client().clone();
    tui.app.spawn(
        async move { client.session_view(&SessionViewInput { session_id: id, idle }, &Default::default()).await },
        bind!(tui, |tui, cx, result| {
            let tabs = &tui.tabs;
            if result.is_ok() {
                if let Some(timer) = tabs.retry.take() {
                    cx.cancel_timer(timer);
                }
                tabs.attempt.set(0);
                return;
            }
            if tabs.acknowledged.borrow().get(&session) != Some(&idle) {
                return;
            }
            tabs.acknowledged.borrow_mut().remove(&session);
            if tabs.retry.get().is_some() {
                return;
            }
            let delay = (VIEW_RETRY_DELAY * 2u32.saturating_pow(tabs.attempt.get())).min(VIEW_RETRY_MAX_DELAY);
            tabs.attempt.set(tabs.attempt.get() + 1);
            tabs.retry.set(Some(cx.set_timeout(
                delay,
                bind!(tui, |tui, _| {
                    tui.tabs.retry.set(None);
                    acknowledge(&tui);
                }),
            )));
        }),
    );
}
