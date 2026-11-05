//! The update notification (E.18b, row T29): `packages/tui/src/context/update-notification.tsx` and the home
//! notice of `routes/home.tsx:125-176`.
//!
//! The updater belongs to the CLI (TS `UpdateSource`: background checks every 10 minutes, `/update` lookups, and
//! installs). D.2 provides one through [`set_source`]; until then the TUI has none and, as in TS without an updater,
//! there is no `/update` and no home notice. With a source, client notices ([`client_notice`]) and the server's
//! `installation.update-available` and `installation.updated` events show the notice; a notice dismissed once is
//! kept in the `update-notifications` storage and not shown again.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::V2Event;
use opencode_ui::bind;
use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
use opencode_ui::motion::FadeInText;
use opentui::prelude::*;
use serde_json::{Value, json};

use crate::app::Tui;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Available,
    Installed,
}

/// `ClientNotice`: what the CLI's updater found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientNotice {
    pub kind: Kind,
    pub version: String,
}

/// What a `/update` check found.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Check {
    Notice(ClientNotice),
    /// The install method cannot update here; the message says why.
    Unavailable(String),
}

/// `UpdateState`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateState {
    Available(String),
    Installed(String),
    Installing(String),
    Failed(String),
}

/// The updater (TS `UpdateSource`), called on the UI thread; it reports back through the callbacks.
pub trait Source {
    /// The TUI talks to a server on another machine (`--server`), whose updates this client cannot install.
    fn remote(&self) -> bool;
    /// Checks for an update. `installing` reports an install a background check started meanwhile.
    fn check(&self, installing: Box<dyn Fn(String)>, done: Box<dyn FnOnce(Result<Option<Check>, String>)>);
    /// Installs `version`.
    fn apply(&self, version: &str, done: Box<dyn FnOnce(Result<(), String>)>);
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Notice {
    kind: Kind,
    version: String,
    /// `None` for the client, else whether the server is remote.
    server: Option<bool>,
}

impl Notice {
    fn remote(&self) -> bool {
        self.server == Some(true)
    }

    fn key(&self) -> String {
        let source = if self.server.is_some() { "server" } else { "client" };
        format!("{source}:{}", self.version)
    }
}

/// The notification state, on `Tui::updates`.
#[derive(Default)]
pub struct Updates {
    source: RefCell<Option<Rc<dyn Source>>>,
    pub(crate) state: RefCell<Option<UpdateState>>,
    notification: RefCell<Option<Notice>>,
    /// The home's notice row while a home is mounted.
    slot: RefCell<Option<View>>,
    hovered: Cell<bool>,
    /// Redraws the open update dialog.
    pub(crate) dialog: RefCell<Option<Weak<dyn Fn()>>>,
    /// Counts dialog openings, so a check of a closed dialog is ignored (TS aborts it).
    pub(crate) generation: Cell<u64>,
}

/// Installs the updater: `/update` and the server's installation events.
pub fn set_source(tui: &Rc<Tui>, source: Rc<dyn Source>) {
    *tui.updates.source.borrow_mut() = Some(source);
    let command = TuiCommand::new("opencode.update", bind!(tui, |tui, _, _| open(&tui, Origin::Manual)))
        .bind(Bind::Off)
        .title("Update OpenCode")
        .group("System")
        .palette()
        .slash("update");
    tui.keymap.install(
        "update",
        [
            KeymapLayer::global(vec![command]),
            // `appBindingCommands`: the configured keybind (`none` by default).
            KeymapLayer::default().bindings(["opencode.update"]),
        ],
    );
    listen(tui, tui.data.signals());
}

/// `installation.update-available` and `installation.updated` from the server.
fn listen(tui: &Tui, mut signals: tokio::sync::broadcast::Receiver<V2Event>) {
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            loop {
                let notice = match signals.recv().await {
                    Ok(V2Event::InstallationUpdateAvailable(event)) => (Kind::Available, event.data.version),
                    Ok(V2Event::InstallationUpdated(event)) => (Kind::Installed, event.data.version),
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                };
                return Some((notice, signals));
            }
        },
        move |_, next| {
            let (Some(tui), Some(((kind, version), signals))) = (weak.upgrade(), next) else {
                return;
            };
            let remote = tui.updates.source().is_some_and(|source| source.remote());
            notify(&tui, Notice { kind, version, server: Some(remote) });
            listen(&tui, signals);
        },
    );
}

impl Updates {
    /// What `/update` found or did so far.
    pub fn state(&self) -> Option<UpdateState> {
        self.state.borrow().clone()
    }

    fn source(&self) -> Option<Rc<dyn Source>> {
        self.source.borrow().clone()
    }

    pub(crate) fn redraw_dialog(&self) {
        let draw = self.dialog.borrow().as_ref().and_then(Weak::upgrade);
        if let Some(draw) = draw {
            draw();
        }
    }
}

/// The updater's own result (TS `updater.subscribe`).
pub fn client_notice(tui: &Tui, notice: ClientNotice) {
    notify(tui, Notice { kind: notice.kind, version: notice.version, server: None });
}

fn notify(tui: &Tui, notice: Notice) {
    if tui.updates.source().is_none() {
        return;
    }
    // Every way out of the TUI after a local install tells the user to start the new version.
    if notice.kind == Kind::Installed && !notice.remote() {
        tui.epilogue.updated_version(notice.version.clone());
    }
    let dismissed = dismissed(tui);
    if dismissed.contains(&notice.key()) || (notice.server.is_none() && dismissed.contains(&notice.version)) {
        return;
    }
    {
        let mut current = tui.updates.notification.borrow_mut();
        let keep = notice.server.is_some() && current.as_ref().is_some_and(|current| current.server.is_none());
        if !keep {
            *current = Some(notice);
        }
    }
    tui.updates.hovered.set(false);
    render(tui);
}

fn dismissed(tui: &Tui) -> Vec<String> {
    tui.storage()
        .and_then(|storage| storage.load("update-notifications", &json!({ "versions": [] })).ok())
        .and_then(|value| {
            value
                .get("versions")?
                .as_array()
                .map(|versions| versions.iter().filter_map(|version| version.as_str().map(str::to_owned)).collect())
        })
        .unwrap_or_default()
}

/// Hides the notice and remembers it; only the automatic notice's interactions update the history.
pub fn dismiss(tui: &Tui) {
    let Some(current) = tui.updates.notification.borrow_mut().take() else {
        return;
    };
    render(tui);
    let Some(storage) = tui.storage() else { return };
    let key = current.key();
    tui.app.runtime().spawn_blocking(move || {
        let result = storage.update("update-notifications", &json!({ "versions": [] }), |draft| {
            let mut versions: Vec<Value> = draft.get("versions").and_then(Value::as_array).cloned().unwrap_or_default();
            versions.push(Value::from(key));
            let start = versions.len().saturating_sub(100);
            draft["versions"] = Value::Array(versions.split_off(start));
        });
        if let Err(error) = result {
            log::error!("failed to persist update notification: {error}");
        }
    });
}

/// Installs the available version.
pub(crate) fn install(tui: &Tui) {
    let Some(source) = tui.updates.source() else {
        return;
    };
    let Some(UpdateState::Available(version)) = tui.updates.state.borrow().clone() else {
        return;
    };
    set_state(tui, Some(UpdateState::Installing(version.clone())));
    source.apply(
        &version.clone(),
        Box::new(bind!(tui, |tui, result| {
            match result {
                Ok(()) => {
                    tui.epilogue.updated_version(version.clone());
                    set_state(&tui, Some(UpdateState::Installed(version)));
                }
                Err(error) => set_state(&tui, Some(UpdateState::Failed(error))),
            }
        })),
    );
}

/// `check`: the result, or the unavailable message for the dialog, through `done`. A check of a dialog that
/// closed is dropped.
pub(crate) fn check(tui: &Tui, done: Box<dyn FnOnce(Result<Option<String>, String>)>) {
    let Some(source) = tui.updates.source() else {
        return done(Ok(None));
    };
    if matches!(*tui.updates.state.borrow(), Some(UpdateState::Installing(_))) {
        return done(Ok(None));
    }
    let generation = tui.updates.generation.get();
    let current = {
        let weak = tui.weak();
        move || weak.upgrade().filter(|tui| tui.updates.generation.get() == generation)
    };
    let installing = {
        let current = current.clone();
        Box::new(move |version: String| {
            if let Some(tui) = current() {
                set_state(&tui, Some(UpdateState::Installing(version)));
            }
        })
    };
    source.check(
        installing,
        Box::new(bind!(tui, |tui, result| {
            if matches!(*tui.updates.state.borrow(), Some(UpdateState::Installing(_))) {
                set_state(&tui, None);
            }
            if current().is_none() {
                return;
            }
            match result {
                Ok(Some(Check::Unavailable(message))) => done(Ok(Some(message))),
                Ok(notice) => {
                    let state = notice.map(|check| match check {
                        Check::Notice(ClientNotice { kind: Kind::Installed, version }) => {
                            tui.epilogue.updated_version(version.clone());
                            UpdateState::Installed(version)
                        }
                        Check::Notice(ClientNotice { version, .. }) => UpdateState::Available(version),
                        Check::Unavailable(message) => UpdateState::Failed(message),
                    });
                    set_state(&tui, state);
                    done(Ok(None));
                }
                Err(error) => done(Err(error)),
            }
        })),
    );
}

/// `restart`: after an install, quitting tells the user to start the new version.
pub(crate) fn restart(tui: &Tui) {
    if matches!(*tui.updates.state.borrow(), Some(UpdateState::Installed(_))) {
        tui.keymap.dispatch("app.exit", None);
    }
}

fn set_state(tui: &Tui, state: Option<UpdateState>) {
    *tui.updates.state.borrow_mut() = state;
    tui.updates.redraw_dialog();
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    Manual,
    Notification,
}

/// `open`: the update dialog, from `/update` or the home notice.
pub fn open(tui: &Tui, origin: Origin) {
    if tui.updates.source().is_none() {
        return;
    }
    let known = tui.updates.notification.borrow().clone().filter(|notice| !notice.remote());
    if origin == Origin::Notification && known.is_none() {
        return;
    }
    if let Some(known) = known {
        let active = tui.updates.state.borrow().clone();
        // The notification can predate an installation through /update.
        let stale = matches!(&active, Some(UpdateState::Installing(_)))
            || matches!(&active, Some(UpdateState::Installed(version)) if *version == known.version);
        if !stale {
            *tui.updates.state.borrow_mut() = Some(match known.kind {
                Kind::Available => UpdateState::Available(known.version),
                Kind::Installed => UpdateState::Installed(known.version),
            });
        }
    }
    let checks = matches!(*tui.updates.state.borrow(), None | Some(UpdateState::Failed(_)));
    crate::dialogs::update::show(tui, checks);
}

/// Mounts the notice into the home's row (`UpdateNotification`). The row is drawn again on each change.
pub fn mount(tui: &Tui, home: &View) {
    *tui.updates.slot.borrow_mut() = Some(home.clone());
    tui.updates.hovered.set(false);
    render(tui);
}

fn render(tui: &Tui) {
    let Some(slot) = tui.updates.slot.borrow().clone() else {
        return;
    };
    slot.clear();
    let Some(notice) = tui.updates.notification.borrow().clone() else {
        return;
    };
    let remote = notice.remote();
    if remote && notice.kind != Kind::Available {
        return;
    }
    let app = &tui.app;
    let theme = tui.page();
    let hovered = tui.updates.hovered.get();
    let backdrop = if hovered { theme.background.action.primary.hovered } else { theme.background.base };
    let command = if notice.kind == Kind::Installed { "/exit" } else { "/update" };
    let rest = if remote {
        "remote server update available".to_owned()
    } else if notice.kind == Kind::Installed {
        format!(" restart to use v{}", notice.version)
    } else {
        format!(" to install v{}", notice.version)
    };
    let animations = opencode_ui::motion::enabled(tui.settings.info().animations);
    let total = (if remote { 0 } else { command.len() } + rest.chars().count()) as f64;
    let (width, height) = app.size();
    let row = View::new(app)
        .row()
        .justify(Justify::Center)
        .shrink(0.0)
        .width(logo_width(width, height))
        .max_width(Length::percent(100.0));
    if hovered {
        row.bg(theme.background.action.primary.hovered);
    }
    let text = View::new(app).row();
    let mut parts = Vec::new();
    if !remote {
        parts.push(FadeInText::new(app, command).fg(theme.text.action.primary.selected).sweep(0.0, Some(total)));
    }
    parts.push(
        FadeInText::new(app, rest)
            .fg(theme.text.muted)
            .sweep(if remote { 0.0 } else { command.len() as f64 }, Some(total)),
    );
    for part in &parts {
        text.add(&part.clone().backdrop(backdrop).enabled(animations));
    }
    row.add(&text);
    let (weak, styled) = (tui.weak(), row.clone());
    // Restyled in place: a row built again between press and release would lose the click.
    row.on_hover(bind!(weak, |tui, _, over| {
        tui.updates.hovered.set(over);
        let theme = tui.page();
        let hovered = theme.background.action.primary.hovered;
        styled.bg(if over { hovered } else { Color::TRANSPARENT });
        for part in &parts {
            part.clone().backdrop(if over { hovered } else { theme.background.base });
        }
        tui.app.request_redraw();
    }));
    let weak = tui.weak();
    row.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        if !matches!(event.kind, MouseEventKind::Up(MouseButton::Left)) {
            return;
        }
        let Some(tui) = weak.upgrade() else { return };
        let tui = tui.clone();
        tui.app.clone().defer(move |_| {
            if remote {
                return dismiss(&tui);
            }
            if notice.kind == Kind::Installed {
                tui.keymap.dispatch("app.exit", None);
                return;
            }
            open(&tui, Origin::Notification);
        });
    });
    slot.add(&row);
}

/// The width of the logo the home shows at this size (`routes/home.rs` `paint_logo`).
fn logo_width(width: u16, height: u16) -> u32 {
    match (width, height) {
        (_, height) if height < 12 => 0,
        (width, _) if width < 22 => 4,
        (width, _) if width < 44 => 19,
        _ => 39,
    }
}
