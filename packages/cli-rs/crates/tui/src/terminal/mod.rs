//! The terminal pane on the persistent PTY socket (E.13a, rows W06 and A04).
//!
//! [`Terminals`] is `context/session-terminals.tsx`: whether the server offers terminals, each session's terminals,
//! and the selected one per session in the `session-terminal-selection` storage key. The session frame shows the
//! selected terminal in its right pane ([`pane::Pane`]). The commands are those of `component/session-frame.tsx`:
//! `terminal.toggle`, `terminal.select`, `terminal.close`, and `session.terminal` (`/terminal`).

pub mod palette;
pub mod pane;

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;

use indexmap::IndexMap;
use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    ExperimentalPersistentPtyCreateInput, ExperimentalPersistentPtyListInput, PersistentPtyInfo,
    SessionID, V2Event,
};
use opencode_api::pty::{Connector, Tungstenite};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opentui::keymap::{Condition, Disposer};
use serde_json::{Value, json};

use crate::app::Tui;

const SELECTION: &str = "session-terminal-selection";

/// Shows the composer's terminal list (E.13b's `onTerminalPicker`).
pub type Picker = Rc<dyn Fn(&Tui)>;

/// Sends bytes to one terminal's input.
pub type Writer = Rc<dyn Fn(&[u8])>;

pub struct Terminals {
    available: Cell<bool>,
    /// The terminal to focus when its pane mounts; a terminal the user did not open shows without it.
    focus: RefCell<Option<String>>,
    /// Focus the next terminal pane, or the session once none is selected, after a focused terminal disconnected.
    restore: Cell<bool>,
    lists: RefCell<HashMap<String, Vec<PersistentPtyInfo>>>,
    /// `{ sessions: { [sessionID]: ptyID | null } }`.
    selection: RefCell<Value>,
    writers: RefCell<HashMap<String, Writer>>,
    pending: RefCell<HashMap<String, Vec<Vec<u8>>>>,
    connector: RefCell<Arc<dyn Connector>>,
    picker: RefCell<Option<Picker>>,
    layer: RefCell<Option<(bool, bool, Disposer)>>,
}

impl Default for Terminals {
    fn default() -> Self {
        Self {
            available: Cell::new(false),
            focus: RefCell::default(),
            restore: Cell::new(false),
            lists: RefCell::default(),
            selection: RefCell::new(json!({ "sessions": {} })),
            writers: RefCell::default(),
            pending: RefCell::default(),
            connector: RefCell::new(Arc::new(Tungstenite)),
            picker: RefCell::default(),
            layer: RefCell::default(),
        }
    }
}

impl Terminals {
    pub fn available(&self) -> bool {
        self.available.get()
    }

    /// The session's terminals as last listed.
    pub fn list(&self, session: &str) -> Vec<PersistentPtyInfo> {
        self.lists
            .borrow()
            .get(session)
            .cloned()
            .unwrap_or_default()
    }

    /// The selected terminal, if any, whether or not it is still listed.
    pub fn selected_id(&self, session: &str) -> Option<String> {
        self.selection.borrow()["sessions"][session]
            .as_str()
            .map(str::to_owned)
    }

    /// The selected terminal of a session, while the server offers terminals and lists it.
    pub fn selected(&self, session: &str) -> Option<String> {
        let id = self.selected_id(session).filter(|_| self.available())?;
        self.lists
            .borrow()
            .get(session)?
            .iter()
            .any(|terminal| terminal.id.0 == id)
            .then_some(id)
    }

    /// Replaces how sockets open; tests serve fake ones.
    pub fn set_connector(&self, connector: Arc<dyn Connector>) {
        *self.connector.borrow_mut() = connector;
    }

    pub(crate) fn connector(&self) -> Arc<dyn Connector> {
        self.connector.borrow().clone()
    }

    /// Sets how `terminal.select` shows the composer's terminal list (E.13b).
    pub fn set_picker(&self, picker: Option<Picker>) {
        *self.picker.borrow_mut() = picker;
    }

    /// Whether the pane of `pty` should take focus when it mounts; clears the wish.
    pub(crate) fn take_focus(&self, pty: &str) -> bool {
        let wanted = self.focus.borrow().as_deref() == Some(pty) || self.restore.get();
        if wanted {
            self.focus.borrow_mut().take();
            self.restore.set(false);
        }
        wanted
    }

    /// After a focused terminal's socket ended.
    pub(crate) fn disconnected(&self, tui: &Tui) {
        self.restore.set(true);
        crate::frame::refresh(tui);
    }

    /// Whether the session should get focus back: a focused terminal disconnected and none is selected now.
    pub(crate) fn take_restore(&self, selected: bool) -> bool {
        if !self.restore.get() || selected {
            return false;
        }
        self.restore.set(false);
        true
    }

    /// Writes to a terminal's input, or keeps it until its pane mounts (the client MCP, E.13b).
    pub fn write(&self, pty: &str, data: &[u8]) {
        let writer = self.writers.borrow().get(pty).cloned();
        match writer {
            Some(writer) => writer(data),
            None => self
                .pending
                .borrow_mut()
                .entry(pty.to_owned())
                .or_default()
                .push(data.to_vec()),
        }
    }

    pub(crate) fn attach_writer(&self, pty: &str, writer: Writer) {
        self.writers
            .borrow_mut()
            .insert(pty.to_owned(), writer.clone());
        let pending = self.pending.borrow_mut().remove(pty).unwrap_or_default();
        pending.iter().for_each(|data| writer(data));
    }

    pub(crate) fn detach_writer(&self, pty: &str) {
        self.writers.borrow_mut().remove(pty);
    }
}

/// Reads the selection and registers the commands. `app::mount_with` calls it once.
pub fn install(tui: &Rc<Tui>) {
    if let Some(storage) = tui.storage() {
        let value = storage
            .load(SELECTION, &json!({ "sessions": {} }))
            .unwrap_or_else(|_| json!({ "sessions": {} }));
        if value["sessions"].is_object() {
            *tui.terminals.selection.borrow_mut() = value;
        }
    }
    apply_layer(tui);
}

/// The capture handler that sends keys to a focused terminal before the keymap sees them, unless they are the leader
/// or part of a leader sequence (`keymap.intercept` at priority 100). `app::install_keys` calls it before the
/// keymap's own handler.
pub fn install_keys(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.app.on_key_capture(move |cx, key| {
        let Some(tui) = weak.upgrade() else { return };
        let Some(pane) = crate::frame::terminal(&tui) else {
            return;
        };
        let Some(view) = pane.focused() else { return };
        if tui.keymap.is_leader(key) || tui.keymap.leader_active() {
            return;
        }
        cx.prevent_default();
        cx.stop_propagation();
        pane.key(&view, key);
    });
}

/// Server events: support on every `server.connected`, and fresh lists when a session's terminals change.
pub fn event(tui: &Tui, event: &V2Event) {
    let session = match event {
        V2Event::ServerConnected(_) => return check(tui),
        V2Event::PersistentPtyAdded(event) => &event.data.session_id,
        V2Event::PersistentPtyRemoved(event) => &event.data.session_id,
        V2Event::PersistentPtyUpdated(event) => &event.data.session_id,
        _ => return,
    };
    if tui.terminals.available() && tui.terminals.lists.borrow().contains_key(&session.0) {
        refresh(tui, session, |_| {});
    }
}

/// The session frame of `session` mounted: list its terminals (`createResource` in the frame).
pub fn session_mounted(tui: &Tui, session: &SessionID) {
    if tui.terminals.available() {
        refresh(tui, session, |_| {});
    }
}

/// Reads whether the server offers terminals; servers that predate the field do.
fn check(tui: &Tui) {
    let client = tui.data.client().clone();
    let weak = tui.weak();
    tui.app.spawn(
        async move { client.server_info(&RequestOptions::default()).await },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            let available = match &result {
                Ok(info) => {
                    info.capabilities
                        .as_ref()
                        .and_then(|capabilities| capabilities.persistent_pty)
                        != Some(false)
                }
                Err(error) => {
                    log::error!("Failed to read server terminal support: {error}");
                    false
                }
            };
            tui.terminals.available.set(available);
            update_layer(&tui);
            crate::frame::refresh(&tui);
            if !available {
                return;
            }
            let mut sessions: Vec<String> = tui.terminals.lists.borrow().keys().cloned().collect();
            if let crate::routes::Route::Session { id } = tui.route()
                && !sessions.contains(&id.0)
            {
                sessions.push(id.0);
            }
            for session in sessions {
                refresh(&tui, &SessionID(session), |_| {});
            }
        },
    );
}

/// Lists a session's terminals, and clears its selection when the selected one is gone. `then` runs after.
fn refresh(tui: &Tui, session: &SessionID, then: impl FnOnce(&Tui) + 'static) {
    tui.terminals
        .lists
        .borrow_mut()
        .entry(session.0.clone())
        .or_default();
    let client = tui.data.client().clone();
    let input = ExperimentalPersistentPtyListInput {
        session_id: session.clone(),
    };
    let weak = tui.weak();
    let session = session.0.clone();
    tui.app.spawn(
        async move {
            client
                .experimental_persistent_pty_list(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            let list = match result {
                Ok(list) => list,
                Err(error) => {
                    log::error!("Failed to refresh persistent terminal panes: {error}");
                    tui.toasts.error("Unable to load terminal");
                    return;
                }
            };
            let gone = tui
                .terminals
                .selected_id(&session)
                .is_some_and(|selected| !list.iter().any(|terminal| terminal.id.0 == selected));
            tui.terminals
                .lists
                .borrow_mut()
                .insert(session.clone(), list);
            if gone {
                select(&tui, &session, None, true);
            }
            crate::frame::refresh(&tui);
            update_layer(&tui);
            then(&tui);
        },
    );
}

/// `selectTerminal`: a terminal must be listed; `focus: false` shows it without taking focus.
pub fn select(tui: &Tui, session: &str, pty: Option<&str>, focus: bool) {
    if let Some(pty) = pty
        && !tui
            .terminals
            .list(session)
            .iter()
            .any(|terminal| terminal.id.0 == pty)
    {
        return;
    }
    *tui.terminals.focus.borrow_mut() = pty.filter(|_| focus).map(str::to_owned);
    tui.terminals.selection.borrow_mut()["sessions"][session] = json!(pty);
    if let Some(storage) = tui.storage() {
        let session = session.to_owned();
        let pty = pty.map(str::to_owned);
        tui.app.runtime().spawn_blocking(move || {
            let result = storage.update(SELECTION, &json!({ "sessions": {} }), |value| {
                if !value["sessions"].is_object() {
                    value["sessions"] = json!({});
                }
                value["sessions"][session] = json!(pty);
            });
            if let Err(error) = result {
                log::error!("Failed to persist terminal selection: {error}");
            }
        });
    }
    crate::frame::refresh(tui);
    update_layer(tui);
}

/// `newTerminal`: creates a terminal in the session's directory, then selects it.
fn create(tui: &Tui, session: &SessionID) {
    let directory = tui.data.read(|state| {
        state
            .session(session)
            .map(|session| session.location.directory.0.clone())
    });
    let client = tui.data.client().clone();
    let input = ExperimentalPersistentPtyCreateInput {
        session_id: session.clone(),
        command: None,
        args: Vec::new(),
        cwd: directory,
        title: "Terminal".to_owned(),
        env: IndexMap::new(),
        size: None,
    };
    let weak = tui.weak();
    let session = session.clone();
    tui.app.spawn(
        async move {
            client
                .experimental_persistent_pty_create(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            match result {
                Ok(terminal) => {
                    let id = session.0.clone();
                    refresh(&tui, &session, move |tui| {
                        select(tui, &id, Some(&terminal.id.0), true);
                    });
                }
                Err(error) => {
                    log::error!("Failed to create a terminal: {error}");
                    tui.toasts.error("Unable to load terminal");
                }
            }
        },
    );
}

fn session(tui: &Tui) -> Option<SessionID> {
    match tui.route() {
        crate::routes::Route::Session { id } if crate::frame::terminal_host(tui) => Some(id),
        _ => None,
    }
}

/// `terminal.toggle`: hides the shown terminal, else shows the newest one, else creates one.
fn toggle(tui: &Tui) {
    let Some(id) = session(tui) else { return };
    tui.dialogs.clear();
    if crate::frame::terminal_shown(tui) {
        crate::frame::focus_session(tui);
        select(tui, &id.0, None, true);
        return;
    }
    let session = id.clone();
    refresh(tui, &id, move |tui| {
        match tui.terminals.list(&session.0).last() {
            Some(terminal) => select(tui, &session.0, Some(&terminal.id.0), true),
            None => create(tui, &session),
        }
    });
}

/// `terminal.select`: focuses the session and shows the composer's terminal list.
fn pick(tui: &Tui) {
    let Some(id) = session(tui) else { return };
    tui.dialogs.clear();
    if crate::frame::fullscreen_panel(tui) {
        tui.panels.close(tui);
    }
    crate::frame::focus_session(tui);
    let picker = tui.terminals.picker.borrow().clone();
    if let Some(picker) = picker {
        picker(tui);
    }
    refresh(tui, &id, |_| {});
}

/// `terminal.close`.
fn close(tui: &Tui) {
    let Some(id) = session(tui) else { return };
    tui.dialogs.clear();
    crate::frame::focus_session(tui);
    select(tui, &id.0, None, true);
}

/// `session.terminal` (`/terminal`).
fn new_terminal(tui: &Tui) {
    let Some(id) = session(tui) else { return };
    tui.dialogs.clear();
    create(tui, &id);
}

/// Registers the commands again, after the running command returns, when their titles or `terminal.close`'s enabled
/// state would change.
fn update_layer(tui: &Tui) {
    let weak = tui.weak();
    tui.app.defer(move |_| {
        if let Some(tui) = weak.upgrade() {
            apply_layer(&tui);
        }
    });
}

/// The command layer, which exists while the server offers terminals, as the TS commands do.
fn apply_layer(tui: &Tui) {
    let available = tui.terminals.available();
    let shown = crate::frame::terminal_shown(tui);
    if let Some((was_available, was_shown, _)) = tui.terminals.layer.borrow().as_ref()
        && (*was_available, *was_shown) == (available, shown)
    {
        return;
    }
    // Dropping the old disposer does not unregister it (O-32); dispose it explicitly.
    if let Some((.., disposer)) = tui.terminals.layer.borrow_mut().take() {
        disposer.dispose();
    }
    if !available {
        *tui.terminals.layer.borrow_mut() = Some((available, shown, Disposer::noop()));
        return;
    }
    let weak = tui.weak();
    let command = |id: &str, run: fn(&Tui)| {
        let weak = weak.clone();
        TuiCommand::new(id, move |_, _| {
            if let Some(tui) = weak.upgrade() {
                run(&tui);
            }
        })
        .group("Session")
        .palette()
    };
    let in_session = {
        let weak = weak.clone();
        Condition::when(move || weak.upgrade().is_some_and(|tui| session(&tui).is_some()))
    };
    let commands = vec![
        command("terminal.toggle", toggle).title(if shown {
            "Hide terminal pane"
        } else {
            "Show terminal pane"
        }),
        command("terminal.select", pick).title("Select terminal"),
        command("terminal.close", close)
            .title("Close terminal pane")
            .enabled(if shown {
                Condition::Always
            } else {
                Condition::Never
            }),
        command("session.terminal", new_terminal)
            .title("New terminal")
            .bind(Bind::Off)
            .slash(Slash {
                name: "terminal".to_owned(),
                aliases: Vec::new(),
                arguments: false,
            }),
    ];
    let layer = KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        enabled: in_session,
        commands,
        ..KeymapLayer::default()
    };
    match tui.keymap.layer(layer) {
        Ok(disposer) => *tui.terminals.layer.borrow_mut() = Some((available, shown, disposer)),
        Err(error) => log::error!("terminal keymap layer: {error}"),
    }
}
