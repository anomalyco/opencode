//! The app frame and the session frame (E.12, rows W04 and W05). Layout: `docs/E.12.md`.
//!
//! [`Frame`] is the body of `app.tsx:1425-1472`: the vertical tab rail and its resize handle, or the
//! horizontal strip above the route. [`SessionFrame`] is `component/session-frame.tsx`: the session pane, the
//! right pane (a plugin panel here; the terminal is E.13a's and the sidebar E.14's), and the handle between.

pub mod layout;
pub mod resize;

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::SessionID;
use opencode_local::cli_config::TabsLayout;
use opencode_local::storage::Storage;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opentui::keymap::Condition;
use opentui::prelude::*;
use serde_json::{Value, json};

use crate::app::Tui;
use crate::panel::{Host, Presentation};
use crate::routes::Route;
use crate::tabs::{Tabs, rail, strip};
use layout::SESSION_SIDEBAR_WIDTH;
use resize::{PaneResize, Rules};

pub struct Frame {
    body: View,
    rail: Custom<rail::Rail>,
    rail_handle: Custom<resize::Handle>,
    strip: Custom<strip::Strip>,
    main: View,
    tabs_resize: Rc<PaneResize>,
    pane_resize: Rc<PaneResize>,
    /// The `layout` storage key as last read or written.
    layout: RefCell<Value>,
    session: RefCell<Option<Weak<SessionState>>>,
    ticking: Cell<bool>,
}

impl Frame {
    /// The frame's widgets; [`install`] places them once the TUI exists.
    pub fn new(app: &App, tui: Weak<Tui>) -> Self {
        let main = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0);
        let strip = strip::new(app, tui.clone());
        let column = View::new(app)
            .column()
            .grow(1.0)
            .min_width(0)
            .min_height(0)
            .child(&strip)
            .child(&main);
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
        strip.on_hover(move |_, hovered| {
            if !hovered {
                strip::leave(&strip_hover);
            }
        });
        let rail_hover = rail.clone();
        rail.on_hover(move |_, hovered| {
            if !hovered {
                rail::leave(&rail_hover);
            }
        });
        Self {
            body,
            rail,
            rail_handle,
            strip,
            main,
            tabs_resize,
            pane_resize,
            layout: RefCell::new(json!({})),
            session: RefCell::default(),
            ticking: Cell::new(false),
        }
    }

    pub fn body(&self) -> View {
        self.body.clone()
    }

    /// Where the route view mounts.
    pub fn main(&self) -> View {
        self.main.clone()
    }

    /// The vertical rail's width while it shows (`verticalTabsWidth` in `SessionFrame`), else 0.
    pub fn rail_width(&self, tui: &Tui) -> u16 {
        if visible(tui) && vertical(tui) {
            self.tabs_resize.size(tui)
        } else {
            0
        }
    }

    fn session(&self) -> Option<Rc<SessionState>> {
        self.session.borrow().as_ref().and_then(Weak::upgrade)
    }
}

fn tabs_rules() -> Rules {
    Rules {
        default: Box::new(|_| SESSION_SIDEBAR_WIDTH),
        clamp: Box::new(|tui, width| layout::clamp_tabs_width(width, i64::from(tui.app.size().0))),
        from_mouse: Box::new(|_, x| i64::from(x) + 1),
        commit: Box::new(|tui, width| save_layout(tui, "verticalTabsWidth", width)),
    }
}

fn pane_rules() -> Rules {
    Rules {
        default: Box::new(|tui| (tui.panels.width() / 2).max(1) as u16),
        clamp: Box::new(|tui, width| layout::clamp_pane_width(width, tui.panels.width())),
        from_mouse: Box::new(|tui, x| i64::from(tui.app.size().0) - i64::from(x) - 1),
        commit: Box::new(|tui, width| save_layout(tui, "paneWidth", width)),
    }
}

/// Places the frame under the shell, reads `layout`, and registers the pane commands.
pub fn install(tui: &Rc<Tui>, shell: &View) {
    shell.insert(0, &tui.frame.body);
    if let Some(storage) = tui.storage() {
        reload(tui, &storage);
    }
    let weak = tui.weak();
    tui.app.on_resize(move |_, _, _| {
        if let Some(tui) = weak.upgrade() {
            refresh(&tui);
        }
    });
    install_commands(tui);
    refresh(tui);
}

/// Rereads `layout` after the storage directory changed.
pub fn reload(tui: &Tui, storage: &Storage) {
    let value = storage
        .load("layout", &json!({}))
        .unwrap_or_else(|_| json!({}));
    let width = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_u64)
            .map(|width| width as u16)
    };
    tui.frame.tabs_resize.set_value(width("verticalTabsWidth"));
    tui.frame
        .pane_resize
        .set_value(width("paneWidth").or_else(|| width("terminalWidth")));
    *tui.frame.layout.borrow_mut() = value;
    refresh(tui);
}

/// Writes one `layout` width under the storage lock, off the UI thread.
fn save_layout(tui: &Tui, key: &'static str, width: u16) {
    tui.frame.layout.borrow_mut()[key] = json!(width);
    let Some(storage) = tui.storage() else { return };
    tui.app.runtime().spawn_blocking(move || {
        let result = storage.update("layout", &json!({}), |value| {
            if let Some(object) = value.as_object_mut() {
                object.insert(key.to_owned(), json!(width));
            }
        });
        if let Err(error) = result {
            log::error!("Failed to persist TUI layout: {error}");
        }
    });
}

/// The stored layout, for tests and the P-FILE proof.
pub fn stored_layout(tui: &Tui) -> Value {
    tui.frame.layout.borrow().clone()
}

/// `tabsAvailable`: tabs are on, one is open, and the route is not a plugin's.
fn available(tui: &Tui) -> bool {
    Tabs::enabled(tui)
        && !tui.tabs.tabs(tui).is_empty()
        && !matches!(tui.route(), Route::Plugin { .. })
}

fn fullscreen_panel(tui: &Tui) -> bool {
    matches!(tui.route(), Route::Session { id } if tui.panels.current().is_some_and(|panel| panel.session == id.0))
        && tui.panels.presentation() == Presentation::Fullscreen
}

fn visible(tui: &Tui) -> bool {
    available(tui) && !fullscreen_panel(tui)
}

fn vertical(tui: &Tui) -> bool {
    tui.config.tabs.layout == TabsLayout::Vertical
        && layout::tabs_fit_vertically(i64::from(tui.app.size().0), tui.frame.tabs_resize.size(tui))
}

/// Lays the frame out again after the tabs, the route, the panel, or the terminal size changed.
pub fn refresh(tui: &Tui) {
    let frame = &tui.frame;
    let width = i64::from(tui.app.size().0);
    let vertical = vertical(tui);
    let rail_width = frame.tabs_resize.size(tui);
    // The split is measured even while a full-screen panel hides the tabs.
    tui.panels.set_width(
        width
            - if available(tui) && vertical {
                i64::from(rail_width)
            } else {
                0
            },
    );
    // A panel closes when its session is no longer the open one.
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
    frame
        .rail_handle
        .position(Edge::Left, rail_width.saturating_sub(1));
    if let Some(session) = frame.session() {
        session.layout(tui);
    }
    tick(tui);
    tui.app.request_redraw();
}

/// Runs the pulses at 20 fps while any moves.
fn tick(tui: &Tui) {
    let frame = &tui.frame;
    if frame.ticking.get() || !(strip::animating(&frame.strip) || rail::animating(&frame.rail)) {
        return;
    }
    frame.ticking.set(true);
    let weak = tui.weak();
    tui.app.set_timeout(crate::tabs::pulse::FRAME, move |_| {
        let Some(tui) = weak.upgrade() else { return };
        tui.frame.ticking.set(false);
        strip::tick(&tui.frame.strip, crate::tabs::pulse::FRAME);
        rail::tick(&tui.frame.rail, crate::tabs::pulse::FRAME);
        tick(&tui);
    });
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pane {
    Session,
    Right,
}

/// The parts of the open session frame the pane commands reach.
struct SessionState {
    session: SessionID,
    pane: View,
    right: View,
    handle: Custom<resize::Handle>,
    host: RefCell<Option<Host>>,
    active: Cell<Pane>,
}

/// The session frame of one session route.
pub struct SessionFrame {
    root: View,
    state: Rc<SessionState>,
}

impl SessionFrame {
    /// Wraps the session route's column.
    pub fn new(tui: &Tui, session: &SessionID, column: &View) -> Self {
        let app = &tui.app;
        let pane = View::new(app)
            .column()
            .grow(1.0)
            .basis(0)
            .min_width(0)
            .min_height(0)
            .child(column);
        let right = View::new(app)
            .column()
            .shrink(0.0)
            .min_width(0)
            .min_height(0)
            .visible(false);
        let handle =
            resize::handle(app, tui.weak(), tui.frame.pane_resize.clone(), true).visible(false);
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
            active: Cell::new(Pane::Session),
        });
        *tui.frame.session.borrow_mut() = Some(Rc::downgrade(&state));
        state.layout(tui);
        Self { root, state }
    }

    pub fn root(&self) -> View {
        self.root.clone()
    }

    /// Whether the session pane has the input (`activePane() === "session"`).
    pub fn session_active(&self) -> bool {
        self.state.active.get() == Pane::Session
    }
}

impl SessionState {
    /// The right pane and the handle, from the panel state and the room there is.
    fn layout(&self, tui: &Tui) {
        let panel = tui
            .panels
            .current()
            .filter(|panel| panel.session == self.session.0);
        let fullscreen = panel.is_some() && tui.panels.presentation() == Presentation::Fullscreen;
        let available = (i64::from(tui.app.size().0) - i64::from(tui.frame.rail_width(tui))).max(0);
        let size = tui.frame.pane_resize.size(tui);
        let host = self
            .host
            .borrow()
            .as_ref()
            .map(|host| host.target().clone());
        if host != panel {
            if let Some(old) = self.host.borrow_mut().take() {
                old.root.detach();
            }
            if let Some(target) = panel.clone() {
                let width = if fullscreen { available as u16 } else { size };
                let host = Host::new(tui, target, width, self.active.get() == Pane::Right);
                self.right.add(&host.root);
                *self.host.borrow_mut() = Some(host);
            }
        }
        let shown = panel.is_some();
        self.right.visible(shown);
        self.right
            .width(if fullscreen { available as u16 } else { size });
        self.pane.visible(!fullscreen);
        let handle = shown && !fullscreen && available >= 3;
        self.handle.visible(handle);
        self.handle
            .position(Edge::Left, (available - i64::from(size) - 1).max(0) as u16);
        if fullscreen {
            self.focus_right(tui);
        } else if !shown {
            self.active.set(Pane::Session);
        }
    }

    fn focus_session(&self, tui: &Tui) {
        if tui
            .panels
            .current()
            .is_some_and(|panel| panel.session == self.session.0)
            && tui.panels.presentation() == Presentation::Fullscreen
        {
            return;
        }
        if self.active.replace(Pane::Session) == Pane::Right {
            tui.app.blur();
        }
        let textarea = tui.textarea.borrow().clone();
        if let Some(textarea) = textarea {
            tui.app.focus(&textarea);
        }
    }

    fn focus_right(&self, tui: &Tui) {
        self.active.set(Pane::Right);
        if let Some(host) = self.host.borrow().as_ref() {
            tui.app.focus(&host.root);
        }
    }
}

/// `pane.focus.left` and `pane.focus.right`, enabled while the right pane is a panel (or, with E.13a, a
/// terminal) and no dialog is open.
fn install_commands(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let run = |focus: fn(&SessionState, &Tui)| {
        let weak = weak.clone();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let Some(tui) = weak.upgrade() else { return };
            if let Some(session) = tui.frame.session() {
                focus(&session, &tui);
            }
        }
    };
    let right_pane = {
        let weak = weak.clone();
        Condition::when(move || {
            weak.upgrade().is_some_and(|tui| {
                !tui.dialogs.is_open()
                    && tui
                        .frame
                        .session()
                        .is_some_and(|session| session.host.borrow().is_some())
            })
        })
    };
    let not_fullscreen = {
        let weak = weak.clone();
        Condition::when(move || weak.upgrade().is_some_and(|tui| !fullscreen_panel(&tui)))
    };
    let commands = vec![
        TuiCommand::new("pane.focus.left", run(SessionState::focus_session))
            .title("Focus session pane")
            .enabled(not_fullscreen),
        TuiCommand::new("pane.focus.right", run(SessionState::focus_right))
            .title("Focus right pane"),
    ]
    .into_iter()
    .map(|command| command.bind(Bind::Default))
    .collect();
    let layer = KeymapLayer {
        mode: Some(GLOBAL_MODE.to_owned()),
        enabled: right_pane,
        commands,
        ..KeymapLayer::default()
    };
    // The layer lives as long as the keymap, which the TUI owns.
    if let Err(error) = tui.keymap.layer(layer) {
        log::error!("pane keymap layer: {error}");
    }
}
