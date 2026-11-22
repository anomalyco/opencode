//! Register update actions only when an updater is available. Keep dismissed notices in shared storage.

use opencode_api::generated::{EventKind, V2Event};
use opencode_ui::motion::FadeInText;

use crate::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Available,
    Installed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClientNotice {
    pub kind: Kind,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Check {
    Notice(ClientNotice),
    /// The install method cannot update here; the message says why.
    Unavailable(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UpdateState {
    Available(String),
    Installed(String),
    Installing(String),
    Failed(String),
}

pub trait Source {
    /// The TUI talks to a server on another machine (`--server`), whose updates this client cannot install.
    fn remote(&self) -> bool;
    fn check(&self, installing: Box<dyn Fn(String)>, done: Box<dyn FnOnce(Result<Option<Check>, String>)>);
    fn apply(&self, version: &str, done: Box<dyn FnOnce(Result<(), String>)>);
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Notice {
    kind: Kind,
    version: String,
    by: By,
}

/// Who announced an update: this client, or its server on this machine or on another.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum By {
    Client,
    Server,
    RemoteServer,
}

impl Notice {
    fn key(&self) -> String {
        let source = if self.by == By::Client { "client" } else { "server" };
        format!("{source}:{}", self.version)
    }
}

#[derive(Default)]
pub struct Updates {
    source: RefCell<Option<Rc<dyn Source>>>,
    pub(crate) state: RefCell<Option<UpdateState>>,
    notification: RefCell<Option<Notice>>,
    /// The home's notice row while a home is mounted.
    slot: RefCell<Option<View>>,
    /// The notice row its hover handler restyles. The handler holds it weakly: a widget whose handler holds the
    /// widget is never freed.
    row: RefCell<Option<Rc<View>>>,
    parts: RefCell<Vec<(FadeInText, bool)>>,
    hovered: Cell<bool>,
    pub(crate) dialog: RefCell<Option<Weak<dyn Fn()>>>,
    /// Ignore results from a check whose dialog has closed.
    pub(crate) generation: Cell<u64>,
}

pub fn set_source(tui: &Rc<Tui>, source: Rc<dyn Source>) {
    *tui.updates.source.borrow_mut() = Some(source);
    let command = TuiCommand::new("opencode.update", bind!(tui, |tui, _, _| open(&tui, Origin::Manual)))
        .bind(Bind::Off)
        .title("Update OpenCode")
        .group("System")
        .palette()
        .slash("update");
    tui.keymap
        .install("update", [KeymapLayer::global(vec![command]), KeymapLayer::default().bindings(["opencode.update"])]);
    let kinds = [EventKind::InstallationUpdateAvailable, EventKind::InstallationUpdated];
    crate::features::events::subscribe(tui, kinds, |tui, event| {
        let (kind, version) = match event {
            V2Event::InstallationUpdateAvailable(event) => (Kind::Available, event.data.version.clone()),
            V2Event::InstallationUpdated(event) => (Kind::Installed, event.data.version.clone()),
            _ => return,
        };
        let by = if tui.updates.source().is_some_and(|source| source.remote()) { By::RemoteServer } else { By::Server };
        notify(tui, Notice { kind, version, by });
    })
    .forget();
}

impl Updates {
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

pub fn client_notice(tui: &Tui, notice: ClientNotice) {
    notify(tui, Notice { kind: notice.kind, version: notice.version, by: By::Client });
}

fn notify(tui: &Tui, notice: Notice) {
    if tui.updates.source().is_none() {
        return;
    }
    // Every way out of the TUI after a local install tells the user to start the new version.
    if notice.kind == Kind::Installed && notice.by != By::RemoteServer {
        tui.epilogue.updated_version(notice.version.clone());
    }
    let dismissed = dismissed(tui);
    if dismissed.contains(&notice.key()) || (notice.by == By::Client && dismissed.contains(&notice.version)) {
        return;
    }
    {
        let mut current = tui.updates.notification.borrow_mut();
        let keep = notice.by != By::Client && current.as_ref().is_some_and(|current| current.by == By::Client);
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
    let Some(current) = tui.updates.notification.borrow_mut().take() else { return };
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

pub(crate) fn install(tui: &Tui) {
    let Some(source) = tui.updates.source() else { return };
    let Some(UpdateState::Available(version)) = tui.updates.state.borrow().clone() else { return };
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
    let Some(source) = tui.updates.source() else { return done(Ok(None)) };
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

pub fn open(tui: &Tui, origin: Origin) {
    if tui.updates.source().is_none() {
        return;
    }
    let known = tui.updates.notification.borrow().clone().filter(|notice| notice.by != By::RemoteServer);
    if origin == Origin::Notification && known.is_none() {
        return;
    }
    if let Some(known) = known {
        let active = tui.updates.state.borrow().clone();
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

/// Paints the home's notice in the page theme in place, so its texts keep fading in where they are.
pub fn restyle(tui: &Tui) {
    let theme = tui.page();
    let hovered = tui.updates.hovered.get();
    if let Some(row) = &*tui.updates.row.borrow()
        && hovered
    {
        row.bg(theme.background.action.primary.hovered);
    }
    let backdrop = if hovered { theme.background.action.primary.hovered } else { theme.background.base };
    for (part, command) in tui.updates.parts.borrow().iter() {
        part.clone()
            .fg(if *command { theme.text.action.primary.selected } else { theme.text.muted })
            .backdrop(backdrop);
    }
}

pub fn mount(tui: &Tui, home: &View) {
    *tui.updates.slot.borrow_mut() = Some(home.clone());
    tui.updates.hovered.set(false);
    render(tui);
}

fn render(tui: &Tui) {
    let Some(slot) = tui.updates.slot.borrow().clone() else { return };
    slot.clear();
    tui.updates.row.take();
    tui.updates.parts.borrow_mut().clear();
    let Some(notice) = tui.updates.notification.borrow().clone() else { return };
    let remote = notice.by == By::RemoteServer;
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
        text.add(&part.clone().backdrop(backdrop));
    }
    *tui.updates.parts.borrow_mut() =
        parts.iter().enumerate().map(|(index, part)| (part.clone(), !remote && index == 0)).collect();
    row.add(&text);
    let row = Rc::new(row);
    let (weak, styled) = (tui.weak(), Rc::downgrade(&row));
    // Restyled in place: a row built again between press and release would lose the click.
    row.on_hover(bind!(weak, |tui, _, over| {
        tui.updates.hovered.set(over);
        let theme = tui.page();
        let hovered = theme.background.action.primary.hovered;
        if let Some(row) = styled.upgrade() {
            row.bg(if over { hovered } else { Color::TRANSPARENT });
        }
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
    slot.add(&*row);
    *tui.updates.row.borrow_mut() = Some(row);
}

fn logo_width(width: u16, height: u16) -> u32 {
    match (width, height) {
        (_, height) if height < 12 => 0,
        (width, _) if width < 22 => 4,
        (width, _) if width < 44 => 19,
        _ => 39,
    }
}
