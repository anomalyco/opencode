//! Layout and focus for the main route and its adjacent panes.

pub mod layout;
pub mod resize;

use std::sync::OnceLock;

use opencode_local::cli_config::TabsLayout;
use opencode_local::serial::Serial;
use opencode_local::storage::Storage;
use opencode_plugin::{SlotInput, SlotMount, slot};

use crate::panel::{Host, Presentation};
use crate::prelude::*;
use crate::tabs::{Tabs, rail, strip};
use layout::SESSION_SIDEBAR_WIDTH;
use resize::{PaneResize, Rules};

pub struct Frame {
    body: View,
    pub(crate) rail: Custom<rail::Rail>,
    rail_handle: Custom<resize::Handle>,
    pub(crate) strip: Custom<strip::Strip>,
    main: View,
    /// The column under the routes that holds the `app` slot.
    column: View,
    app: RefCell<Option<(View, Rc<SlotMount>)>>,
    tabs_resize: Rc<PaneResize>,
    pane_resize: Rc<PaneResize>,
    /// The `layout` storage key as last read or written.
    layout: RefCell<Value>,
    session: RefCell<Option<Weak<SessionState>>>,
    markers: Cell<bool>,
}

impl Frame {
    /// The frame's widgets; [`install`] places them once the TUI exists.
    pub fn new(app: &App, tui: Weak<Tui>) -> Self {
        let main = View::new(app).column().grow(1.0).basis(Length::Auto).min_height(0);
        let strip = strip::new(app, tui.clone());
        let routes = View::new(app).column().grow(1.0).min_height(0).child(&strip).child(&main);
        let column = View::new(app).column().grow(1.0).min_width(0).min_height(0).child(&routes);
        let rail = rail::new(app, tui.clone());
        let tabs_resize = PaneResize::new(tabs_rules());
        let pane_resize = PaneResize::new(pane_rules());
        let rail_handle = resize::handle(app, tui, tabs_resize.clone(), false);
        let body = View::new(app)
            .row()
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .child(&rail)
            .child(&column)
            .child(&rail_handle);
        let strip_hover = strip.clone();
        strip.on_hover(move |cx, hovered| {
            if !hovered {
                strip::leave(cx.app(), &strip_hover);
            }
        });
        let rail_hover = rail.clone();
        rail.on_hover(move |cx, hovered| {
            if !hovered {
                rail::leave(cx.app(), &rail_hover);
            }
        });
        Self {
            body,
            rail,
            rail_handle,
            strip,
            main,
            column,
            app: RefCell::default(),
            tabs_resize,
            pane_resize,
            layout: RefCell::new(json!({})),
            session: RefCell::default(),
            markers: Cell::new(false),
        }
    }

    pub fn body(&self) -> View {
        self.body.clone()
    }

    pub fn main(&self) -> View {
        self.main.clone()
    }

    /// The vertical rail's width while it shows (`verticalTabsWidth` in `SessionFrame`), else 0.
    pub fn rail_width(&self, tui: &Tui) -> u16 {
        if visible(tui) && vertical(tui) { self.tabs_resize.size(tui) } else { 0 }
    }

    fn session(&self) -> Option<Rc<SessionState>> {
        self.session.borrow().as_ref().and_then(Weak::upgrade)
    }

    pub fn remount_panel(&self, tui: &Tui) {
        let Some(state) = self.session() else { return };
        let Some(old) = state.host.borrow_mut().take() else { return };
        let target = old.target().clone();
        old.root.detach();
        drop(old);
        state.mount_host(tui, target);
        if state.active.get() == Pane::Right {
            state.focus_right(tui);
        }
    }
}

fn tabs_rules() -> Rules {
    Rules {
        default: Box::new(|_| SESSION_SIDEBAR_WIDTH),
        clamp: Box::new(|tui, width| layout::clamp_tabs_width(width, i64::from(tui.app.size().0))),
        from_mouse: Box::new(|_, x| i64::from(x) + 1),
        commit: Box::new(|tui, width| save_layout(&tui.frame.tabs_resize, tui, "verticalTabsWidth", width)),
    }
}

fn pane_rules() -> Rules {
    Rules {
        default: Box::new(|tui| (tui.panels.width() / 2).max(1) as u16),
        clamp: Box::new(|tui, width| layout::clamp_pane_width(width, tui.panels.width())),
        from_mouse: Box::new(|tui, x| i64::from(tui.app.size().0) - i64::from(x) - 1),
        commit: Box::new(|tui, width| save_layout(&tui.frame.pane_resize, tui, "paneWidth", width)),
    }
}

/// A layout width's write landed: a reload may now take whatever the file holds.
#[derive(Clone, Copy)]
struct LayoutWritten(u64);

pub fn install(tui: &Rc<Tui>, shell: &View) {
    shell.insert(0, &tui.frame.body);
    if let Some(storage) = tui.storage() {
        reload(tui, &storage);
    }
    tui.app.on_message(bind!(tui, |tui, _, written: &LayoutWritten| {
        tui.frame.tabs_resize.written(written.0);
        tui.frame.pane_resize.written(written.0);
    }));
    tui.app.on_resize(bind!(tui, |tui, _, _, _| refresh(&tui)));
    install_commands(tui);
    refresh(tui);
}

/// Remount the app slot with its route so its claims follow theme and plugin changes.
pub fn mount_app(tui: &Tui, remount: bool) {
    if !remount && tui.frame.app.borrow().is_some() {
        return;
    }
    if let Some((old, _)) = tui.frame.app.borrow_mut().take() {
        old.detach();
    }
    let holder = View::new(&tui.app).column().shrink(0.0);
    let slot = crate::plugins::host::slot(tui, &holder, slot::APP, &SlotInput::default(), |_| {});
    tui.frame.column.add(&holder);
    *tui.frame.app.borrow_mut() = Some((holder, Rc::new(slot)));
    sync_app(tui, &opencode_store::Changes::everything());
}

/// Restyles the `app` slot's claims in place, or mounts the slot again when one cannot.
pub fn restyle_app(tui: &Tui) {
    let slot = tui.frame.app.borrow().as_ref().map(|(_, slot)| slot.clone());
    if !slot.is_some_and(|slot| slot.restyle(tui)) {
        mount_app(tui, true);
    }
}

pub fn sync_app(tui: &Tui, changes: &opencode_store::Changes) {
    // A claim's handler may remount the slot while it syncs.
    let slot = tui.frame.app.borrow().as_ref().map(|(_, slot)| slot.clone());
    if let Some(slot) = slot {
        crate::plugins::host::changed(tui, changes, |changed| slot.sync(tui, changed));
    }
}

/// Rereads `layout` after the storage directory changed.
pub fn reload(tui: &Tui, storage: &Storage) {
    let value = storage.load("layout", &json!({})).unwrap_or_else(|_| json!({}));
    let width = |key: &str| value.get(key).and_then(Value::as_u64).map(|width| width as u16);
    tui.frame.tabs_resize.set_value(width("verticalTabsWidth"));
    tui.frame.pane_resize.set_value(width("paneWidth").or_else(|| width("terminalWidth")));
    *tui.frame.layout.borrow_mut() = value;
    refresh(tui);
}

/// Writes one `layout` width under the storage lock, on one worker thread so the writes land in order. The worker
/// then tells the pane which committed the width that its write completed.
fn save_layout(resize: &Rc<PaneResize>, tui: &Tui, key: &'static str, width: u16) {
    tui.frame.layout.borrow_mut()[key] = json!(width);
    let Some(storage) = tui.storage() else { return };
    let commit = resize.writing();
    let proxy = tui.app.proxy();
    static WRITER: OnceLock<Serial> = OnceLock::new();
    WRITER.get_or_init(|| Serial::new("layout")).run(move || {
        let result = storage.update("layout", &json!({}), |value| {
            if let Some(object) = value.as_object_mut() {
                object.insert(key.to_owned(), json!(width));
            }
        });
        if let Err(error) = result {
            log::error!("Failed to persist TUI layout: {error}");
        }
        if let Some(commit) = commit {
            let _ = proxy.send(LayoutWritten(commit));
        }
    });
}

/// `tabsAvailable`: tabs are on, one is open, and the route is not a plugin's.
fn available(tui: &Tui) -> bool {
    Tabs::enabled(tui) && !tui.tabs.tabs(tui).is_empty() && !matches!(tui.route(), Route::Plugin { .. })
}

pub(crate) fn fullscreen_panel(tui: &Tui) -> bool {
    matches!(tui.route(), Route::Session { id } if tui.panels.current().is_some_and(|panel| panel.session == id.0))
        && tui.panels.presentation() == Presentation::Fullscreen
}

fn visible(tui: &Tui) -> bool {
    available(tui) && !fullscreen_panel(tui)
}

fn vertical(tui: &Tui) -> bool {
    tui.config().tabs.layout == TabsLayout::Vertical
        && layout::tabs_fit_vertically(i64::from(tui.app.size().0), tui.frame.tabs_resize.size(tui))
}

/// Lays the frame out again after the tabs, the route, the panel, or the terminal size changed.
pub fn refresh(tui: &Tui) {
    let frame = &tui.frame;
    let width = i64::from(tui.app.size().0);
    let vertical = vertical(tui);
    let rail_width = frame.tabs_resize.size(tui);
    // The split is measured even while a full-screen panel hides the tabs.
    tui.panels.set_width(width - if available(tui) && vertical { i64::from(rail_width) } else { 0 });
    if let Some(panel) = tui.panels.current()
        && !matches!(tui.route(), Route::Session { id } if id.0 == panel.session)
    {
        tui.panels.close(tui);
        return;
    }
    let visible = visible(tui);
    frame.strip.visible(visible && !vertical);
    frame.rail.visible(visible && vertical);
    frame.rail.width(rail_width);
    frame.rail_handle.visible(visible && vertical);
    frame.rail_handle.position(Edge::Left, rail_width.saturating_sub(1));
    if let Some(session) = frame.session() {
        session.layout(tui);
    }
    if !visible || vertical {
        strip::forget(&frame.strip);
    }
    if !visible || !vertical {
        rail::forget(&frame.rail);
    }
    tui.app.request_redraw();
}

/// Brings the tabs' unread markers up to the store after a flush.
pub(crate) fn observe_markers(tui: &Tui) {
    strip::observe(&tui.frame.strip, tui);
    rail::observe(&tui.frame.rail, tui);
}

/// Request frames until the unread marker stops fading.
pub(crate) fn wake_markers(tui: &Tui) {
    if tui.frame.markers.replace(true) {
        return;
    }
    tui.app.animate(bind!(tui.weak(), |tui, cx, _| {
        let now = tui.app.now();
        let fading = strip::fading(&tui.frame.strip, now) || rail::fading(&tui.frame.rail, now);
        tui.frame.markers.set(fading);
        cx.request_redraw();
        fading
    }));
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pane {
    Session,
    Right,
}

struct SessionState {
    session: SessionID,
    pane: View,
    right: View,
    handle: Custom<resize::Handle>,
    host: RefCell<Option<Host>>,
    /// Selected terminal pane when no panel is open.
    terminal: RefCell<Option<Rc<crate::terminal::pane::Pane>>>,
    /// The panel and terminal of the last layout, to tell which of them just opened.
    shown: RefCell<(Option<crate::panel::Target>, Option<String>)>,
    active: Cell<Pane>,
}

pub struct SessionFrame {
    root: View,
    state: Rc<SessionState>,
}

impl SessionFrame {
    pub fn new(tui: &Tui, session: &SessionID, column: &View) -> Self {
        let app = &tui.app;
        let pane = View::new(app).column().grow(1.0).basis(0).min_width(0).min_height(0).child(column);
        let right = View::new(app).column().shrink(0.0).min_width(0).min_height(0).visible(false);
        let handle = resize::handle(app, tui.weak(), tui.frame.pane_resize.clone(), true).visible(false);
        let root = View::new(app)
            .row()
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(0)
            .min_height(0)
            .child(&pane)
            .child(&right)
            .child(&handle);
        let state = Rc::new(SessionState {
            session: session.clone(),
            pane,
            right,
            handle,
            host: RefCell::default(),
            terminal: RefCell::default(),
            shown: RefCell::default(),
            active: Cell::new(Pane::Session),
        });
        *tui.frame.session.borrow_mut() = Some(Rc::downgrade(&state));
        // A click in the session pane takes input back from the right pane.
        let weak = Rc::downgrade(&state);
        let owner = tui.weak();
        state.pane.on_mouse(move |_, event| {
            if event.kind != MouseEventKind::Up(MouseButton::Left) {
                return;
            }
            if let (Some(state), Some(tui)) = (weak.upgrade(), owner.upgrade())
                && state.active.get() == Pane::Right
                && !tui.frame.pane_resize.resizing()
            {
                state.focus_session(&tui);
            }
        });
        state.layout(tui);
        crate::terminal::session_mounted(tui, session);
        Self { root, state }
    }

    pub fn root(&self) -> View {
        self.root.clone()
    }

    /// Paints in the page theme again: the terminal pane keeps its connection and screen. A plugin panel takes the
    /// theme when it renders, so its host renders it again where it is, as a plugin route mounts again.
    pub fn restyle(&self, tui: &Tui) {
        let state = &self.state;
        if let Some(pane) = state.terminal.borrow().as_ref() {
            pane.restyle(tui);
        }
        if state.host.borrow().as_ref().is_some_and(|host| host.restyle(tui)) {
            return;
        }
        let Some(old) = state.host.borrow_mut().take() else { return };
        let target = old.target().clone();
        old.root.detach();
        drop(old);
        state.mount_host(tui, target);
        if state.active.get() == Pane::Right {
            state.focus_right(tui);
        }
    }

    pub fn session_active(&self) -> bool {
        self.state.active.get() == Pane::Session
    }
}

impl SessionState {
    fn mount_host(&self, tui: &Tui, target: crate::panel::Target) {
        let host = Host::new(tui, target);
        host.root.on_mouse(bind!(tui, |tui, _, event| {
            if matches!(event.kind, MouseEventKind::Down(_))
                && let Some(session) = tui.frame.session()
            {
                session.focus_right(&tui);
            }
        }));
        self.right.add(&host.root);
        *self.host.borrow_mut() = Some(host);
    }

    fn layout(&self, tui: &Tui) {
        let panel = tui.panels.current().filter(|panel| panel.session == self.session.0);
        let fullscreen = panel.is_some() && tui.panels.presentation() == Presentation::Fullscreen;
        let available = (i64::from(tui.app.size().0) - i64::from(tui.frame.rail_width(tui))).max(0);
        let size = tui.frame.pane_resize.size(tui);
        let host = self.host.borrow().as_ref().map(|host| host.target().clone());
        let mut focus = false;
        if host != panel {
            if let Some(old) = self.host.borrow_mut().take() {
                old.root.detach();
            }
            if let Some(target) = panel.clone() {
                self.mount_host(tui, target);
                focus = true;
            }
        }
        let selected = tui.terminals.selected(&self.session.0);
        let previous = self.shown.replace((panel.clone(), selected.clone()));
        if panel.is_some() && panel != previous.0 {
            if selected.is_some() {
                crate::terminal::select(tui, &self.session.0, None, true);
            }
        } else if selected.is_some() && selected != previous.1 && panel.is_some() {
            tui.panels.close(tui);
            return;
        }
        let terminal = selected.filter(|_| panel.is_none());
        let current = self.terminal.borrow().as_ref().map(|pane| pane.pty().to_owned());
        if current != terminal {
            if let Some(old) = self.terminal.borrow_mut().take() {
                old.dispose();
                old.root().detach();
            }
            if let Some(pty) = &terminal {
                let pane = crate::terminal::pane::Pane::new(tui, pty);
                self.right.add(pane.root());
                focus = tui.terminals.take_focus(pty);
                *self.terminal.borrow_mut() = Some(pane);
            }
        }
        if tui.terminals.take_restore(terminal.is_some()) {
            self.focus_session(tui);
        }
        if let Some(pane) = self.terminal.borrow().as_ref()
            && tui.frame.pane_resize.resizing()
        {
            pane.interact();
        }
        let shown = panel.is_some() || terminal.is_some();
        self.right.visible(shown);
        self.right.width(if fullscreen { available as u16 } else { size });
        self.pane.visible(!fullscreen);
        let handle = shown && !fullscreen && available >= 3;
        self.handle.visible(handle);
        self.handle.position(Edge::Left, (available - i64::from(size) - 1).max(0) as u16);
        if fullscreen || focus {
            self.focus_right(tui);
        } else if !shown {
            self.set_active(tui, Pane::Session);
        }
    }

    fn set_active(&self, tui: &Tui, pane: Pane) -> Pane {
        let before = self.active.replace(pane);
        if before != pane {
            tui.app.defer(bind!(tui, |tui, _| tui.resync()));
            crate::plugins::host::local_changed(tui);
        }
        before
    }

    fn focus_session(&self, tui: &Tui) {
        if tui.panels.current().is_some_and(|panel| panel.session == self.session.0)
            && tui.panels.presentation() == Presentation::Fullscreen
        {
            return;
        }
        if self.set_active(tui, Pane::Session) == Pane::Right {
            tui.app.blur();
        }
        let textarea = tui.textarea.borrow().clone();
        if let Some(textarea) = textarea {
            tui.app.focus(&textarea);
        }
    }

    fn focus_right(&self, tui: &Tui) {
        self.set_active(tui, Pane::Right);
        if let Some(host) = self.host.borrow().as_ref() {
            tui.app.focus(&host.root);
            return;
        }
        let terminal = self.terminal.borrow().clone();
        if let Some(terminal) = terminal {
            terminal.focus();
        }
    }
}

impl Drop for SessionState {
    fn drop(&mut self) {
        if let Some(terminal) = self.terminal.get_mut().take() {
            terminal.dispose();
        }
    }
}

pub(crate) fn terminal(tui: &Tui) -> Option<Rc<crate::terminal::pane::Pane>> {
    tui.frame.session()?.terminal.borrow().clone()
}

pub(crate) fn terminal_host(tui: &Tui) -> bool {
    tui.frame.session().is_some()
}

pub(crate) fn terminal_shown(tui: &Tui) -> bool {
    terminal(tui).is_some()
}

/// Notify the panel when plugin-controlled focus crosses the pane boundary.
pub(crate) fn follow_focus(tui: &Tui) {
    let Some(session) = tui.frame.session() else { return };
    let Some(focused) = tui.app.focused() else { return };
    let path: Vec<u32> =
        std::iter::successors(Some(focused), |widget| widget.parent()).map(|widget| widget.id()).collect();
    let within = |id: u32| path.contains(&id);
    // A focus moved while the panel's host is replaced: the layout that replaces it sets the pane.
    let Ok(host) = session.host.try_borrow() else { return };
    let in_panel = host.as_ref().is_some_and(|host| within(host.root.id()));
    drop(host);
    if in_panel {
        session.set_active(tui, Pane::Right);
    } else if within(session.pane.id()) {
        session.set_active(tui, Pane::Session);
    }
}

pub(crate) fn right_focused(tui: &Tui) {
    if let Some(session) = tui.frame.session() {
        session.set_active(tui, Pane::Right);
    }
}

/// Whether the session pane owns the input (`useInteractivity`): no right pane has it and no panel is full screen.
/// The width of the panel `target` shows in, and whether it has the input; `None` while it does not show.
pub(crate) fn panel_state(tui: &Tui, target: &crate::panel::Target) -> Option<(u16, bool)> {
    let session = tui.frame.session()?;
    let host = session.host.borrow();
    let host = host.as_ref().filter(|host| host.target() == target)?;
    let width = match host.root.rect().width as u16 {
        0 => tui.panels.width().clamp(0, i64::from(u16::MAX)) as u16,
        width => width,
    };
    Some((width, session.active.get() == Pane::Right))
}

pub(crate) fn session_interactive(tui: &Tui) -> bool {
    tui.frame.session().is_none_or(|session| session.active.get() == Pane::Session) && !fullscreen_panel(tui)
}

pub(crate) fn activate_session(tui: &Tui) {
    if let Some(session) = tui.frame.session() {
        session.set_active(tui, Pane::Session);
    }
}

pub(crate) fn focus_session(tui: &Tui) {
    if let Some(session) = tui.frame.session() {
        session.focus_session(tui);
    }
}

/// `pane.focus.left` and `pane.focus.right`, enabled while the right pane is a panel or a terminal and no dialog
/// is open.
fn install_commands(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let run = |focus: fn(&SessionState, &Tui)| {
        bind!(weak, |tui, _: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            if let Some(session) = tui.frame.session() {
                focus(&session, &tui);
            }
        })
    };
    let right_pane = Condition::when(bind!(weak, |tui| {
        !tui.dialogs.is_open()
            && tui
                .frame
                .session()
                .is_some_and(|session| session.host.borrow().is_some() || session.terminal.borrow().is_some())
    }));
    let not_fullscreen = Condition::when(bind!(weak, |tui| !fullscreen_panel(&tui)));
    let commands = vec![
        TuiCommand::new("pane.focus.left", run(SessionState::focus_session))
            .title("Focus session pane")
            .enabled(not_fullscreen),
        TuiCommand::new("pane.focus.right", run(SessionState::focus_right)).title("Focus right pane"),
    ]
    .into_iter()
    .map(|command| command.bind(Bind::Default))
    .collect();
    tui.keymap.install("pane", [KeymapLayer::global(commands).enabled(right_pane)]);
}
