//! The session sidebar (E.14, row V19, `routes/session/sidebar.tsx`, `component/session-frame.tsx:106-130,
//! 325-397`): the title, the `sidebar.content` slot in a scroll box, and the `sidebar.footer` slot, on the
//! raised background, 42 columns wide.
//!
//! It is the frame's right pane while the terminal is wider than 120 columns beside the tab rail, and an
//! overlay over a dimmed session otherwise. `session.sidebar` in `cli.json` (`auto` or `hide`) decides
//! whether it shows by itself; `session.sidebar.toggle` (`<leader>b`) writes it and opens or closes it. A child
//! session never shows it. An open panel takes the right pane instead.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::SessionID;
use opencode_local::cli_config::Sidebar as SidebarSetting;
use opencode_plugin::{SlotInput, SlotMount, Slotted, slot};
use opencode_store::Changes;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde_json::json;

use crate::app::Tui;
use crate::frame::layout::SESSION_SIDEBAR_WIDTH;

/// The terminal width beside the tab rail above which the sidebar docks (`wide`).
const WIDE: i64 = 120;

pub struct Sidebar {
    inner: Rc<Inner>,
}

struct Inner {
    app: App,
    session: SessionID,
    /// The sidebar itself; it moves between `docked` and `overlay`.
    panel: View,
    title: Text,
    docked: View,
    overlay: View,
    slots: RefCell<Vec<SlotMount<Tui>>>,
    /// `sidebarOpen`: opened with the toggle, beyond what `session.sidebar` shows by itself.
    open: Cell<bool>,
    /// Where the panel is now.
    placed: Cell<Place>,
    /// Whether a plugin panel of this session showed at the last layout.
    panel_shown: Cell<bool>,
    layers: RefCell<Vec<Disposer>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Place {
    Hidden,
    Docked,
    Overlay,
}

/// Mounts the sidebar into the session frame's row; the session route keeps it and syncs it.
pub fn mount(tui: &Tui, row: &View, session: &SessionID) -> Sidebar {
    let app = &tui.app;
    let theme = tui.page();
    let raised = theme.background.raised.base;
    let title = Text::new(app, "").fg(theme.text.base).bold();
    let content = View::new(app)
        .column()
        .shrink(0.0)
        .gap(1)
        .padding_edge(Edge::Right, 1);
    let scroll = ScrollBox::new(app)
        .axes(false, true)
        // TS draws the bar over the content's right padding; this keeps the content at its width.
        .scrollbars(false)
        .grow(1.0)
        .min_height(0);
    scroll.add(&content);
    let footer = View::new(app)
        .column()
        .shrink(0.0)
        .gap(1)
        .padding_edge(Edge::Top, 1);
    let panel = View::new(app)
        .column()
        .bg(raised)
        .width(SESSION_SIDEBAR_WIDTH)
        .height(Length::percent(100.0))
        .shrink(0.0)
        .padding_y(1)
        .padding_x(2)
        .child(
            &View::new(app)
                .shrink(0.0)
                .padding_edge(Edge::Right, 2)
                .padding_edge(Edge::Bottom, 1)
                .child(&title),
        )
        .child(&scroll)
        .child(&footer);
    let input = SlotInput {
        session_id: Some(session.0.clone()),
        ..SlotInput::default()
    };
    let slots = vec![
        crate::plugins::host::slot(tui, &content, slot::SIDEBAR_CONTENT, &input, |_| {}),
        crate::plugins::host::slot(tui, &footer, slot::SIDEBAR_FOOTER, &input, |_| {}),
    ];
    let docked = View::new(app)
        .column()
        .shrink(0.0)
        .width(SESSION_SIDEBAR_WIDTH)
        .min_width(0)
        .min_height(0)
        .visible(false);
    let overlay = View::new(app)
        .absolute()
        .position(Edge::Top, 0)
        .position(Edge::Left, 0)
        .width(Length::percent(100.0))
        .height(Length::percent(100.0))
        .align_items(Align::End)
        .bg(Color::rgba(0, 0, 0, 70))
        .z_index(10)
        .visible(false);
    row.add(&docked);
    row.add(&overlay);
    let inner = Rc::new(Inner {
        app: app.clone(),
        session: session.clone(),
        panel,
        title,
        docked,
        overlay,
        slots: RefCell::new(slots),
        open: Cell::new(false),
        placed: Cell::new(Place::Hidden),
        panel_shown: Cell::new(false),
        layers: RefCell::default(),
    });
    let weak = Rc::downgrade(&inner);
    let owner = tui.weak();
    let size = Cell::new(app.size());
    row.on_resize(move |cx, _| {
        let (Some(inner), Some(tui)) = (weak.upgrade(), owner.upgrade()) else {
            return;
        };
        if size.replace(cx.app().size()) != cx.app().size() {
            inner.layout(&tui);
        }
    });
    let weak = Rc::downgrade(&inner);
    tui.settings.on_change(move |tui| {
        if let Some(inner) = weak.upgrade() {
            inner.layout(tui);
        }
    });
    install_layers(tui, &inner);
    let sidebar = Sidebar { inner };
    sidebar.inner.layout(tui);
    sidebar.inner.retitle(tui);
    sidebar
}

impl Sidebar {
    pub fn sync(&self, tui: &Tui, changes: &Changes) {
        if changes.session(&self.inner.session) {
            self.inner.retitle(tui);
        }
        self.inner.layout(tui);
        if self.inner.placed.get() != Place::Hidden {
            self.inner
                .slots
                .borrow()
                .iter()
                .for_each(|slot| slot.sync(tui, changes));
        }
    }

    /// Whether the sidebar is the right pane (`sidebarVisible` of the session view).
    pub fn shown(&self) -> bool {
        self.inner.placed.get() != Place::Hidden
    }
}

impl Drop for Sidebar {
    fn drop(&mut self) {
        let layers = std::mem::take(&mut *self.inner.layers.borrow_mut());
        self.inner
            .app
            .defer(move |_| layers.into_iter().for_each(Disposer::dispose));
    }
}

impl Inner {
    fn retitle(&self, tui: &Tui) {
        let title = tui.data.read(|state| {
            state
                .session(&self.session)
                .map(crate::dialogs::session_list::title)
        });
        self.title.set_text(title.unwrap_or_default());
        tui.app.request_redraw();
    }

    /// `wide`: the terminal beside the tab rail is wider than 120 columns.
    fn wide(tui: &Tui) -> bool {
        i64::from(tui.app.size().0) - i64::from(tui.frame.rail_width(tui)) > WIDE
    }

    /// `rightPane() === "sidebar"`.
    fn wanted(&self, tui: &Tui) -> bool {
        let panel = tui
            .panels
            .current()
            .is_some_and(|panel| panel.session == self.session.0);
        // A panel that opens closes the sidebar it replaces.
        if panel && !self.panel_shown.replace(true) {
            self.open.set(false);
        }
        if !panel {
            self.panel_shown.set(false);
        }
        if panel {
            return false;
        }
        let child = tui.data.read(|state| {
            state
                .session(&self.session)
                .is_some_and(|session| session.parent_id.is_some())
        });
        if child {
            return false;
        }
        self.open.get() || (setting(tui) == SidebarSetting::Auto && Self::wide(tui))
    }

    fn layout(&self, tui: &Tui) {
        let place = match (self.wanted(tui), Self::wide(tui)) {
            (false, _) => Place::Hidden,
            (true, true) => Place::Docked,
            (true, false) => Place::Overlay,
        };
        if self.placed.replace(place) == place {
            return;
        }
        self.panel.detach();
        if place == Place::Docked {
            self.docked.add(&self.panel);
        }
        if place == Place::Overlay {
            self.overlay.add(&self.panel);
        }
        self.docked.visible(place == Place::Docked);
        self.overlay.visible(place == Place::Overlay);
        tui.app.request_redraw();
    }

    /// `toggleSidebar`: writes `session.sidebar` and opens or closes the sidebar; opening closes a panel.
    fn toggle(&self, tui: &Tui) {
        let visible = self.placed.get() != Place::Hidden;
        let value = if visible { "hide" } else { "auto" };
        crate::dialogs::settings::update(tui, move |draft| {
            crate::dialogs::settings::set_path(draft, &["session", "sidebar"], json!(value));
        });
        self.open.set(!visible);
        if !visible
            && tui
                .panels
                .current()
                .is_some_and(|panel| panel.session == self.session.0)
        {
            tui.panels.close(tui);
            self.panel_shown.set(false);
        }
        self.layout(tui);
    }
}

fn setting(tui: &Tui) -> SidebarSetting {
    tui.settings
        .info()
        .session
        .and_then(|session| session.sidebar)
        .unwrap_or(SidebarSetting::Auto)
}

/// `session.sidebar.toggle` in the palette, and Escape or Ctrl+C to close the overlay while no dialog is open.
fn install_layers(tui: &Tui, inner: &Rc<Inner>) {
    let toggle = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let (Some(inner), Some(tui)) = (weak.upgrade(), tui.upgrade()) else {
                return;
            };
            inner.toggle(&tui);
            tui.dialogs.clear();
        }
    };
    let close = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let (Some(inner), Some(tui)) = (weak.upgrade(), tui.upgrade()) else {
                return;
            };
            inner.toggle(&tui);
        }
    };
    let overlay = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        Condition::when(move || {
            weak.upgrade()
                .is_some_and(|inner| inner.placed.get() == Place::Overlay)
                && tui.upgrade().is_some_and(|tui| !tui.dialogs.is_open())
        })
    };
    let layers = [
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![
                TuiCommand::new("session.sidebar.toggle", toggle)
                    .title("Toggle sidebar")
                    .group("Session")
                    .palette()
                    .bind(Bind::Default),
            ],
            ..KeymapLayer::default()
        },
        KeymapLayer {
            enabled: overlay,
            commands: vec![
                TuiCommand::inline("escape,ctrl+c", close)
                    .title("Close sidebar")
                    .group("Session"),
            ],
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => inner.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("sidebar keymap layer: {error}"),
        }
    }
}

/// One sidebar section of a built-in plugin: `render` reads what it needs and returns its view, or `None` to
/// hide it. It renders again after every change batch while the sidebar shows.
pub struct Section {
    root: View,
    render: Render,
}

type Render = Box<dyn Fn(&Tui) -> Option<View>>;

impl Section {
    pub fn new(tui: &Tui, render: impl Fn(&Tui) -> Option<View> + 'static) -> Self {
        let section = Self {
            root: View::new(&tui.app).column().shrink(0.0),
            render: Box::new(render),
        };
        section.refresh(tui);
        section
    }

    pub fn refresh(&self, tui: &Tui) {
        self.root.clear();
        match (self.render)(tui) {
            Some(view) => {
                self.root.add(&view);
                self.root.visible(true);
            }
            None => {
                self.root.visible(false);
            }
        }
        tui.app.request_redraw();
    }
}

impl Slotted<Tui> for Section {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        if !changes.is_empty() {
            self.refresh(tui);
        }
    }
}

/// A plugin's stored `{ open: true }` (`storage.store("view")`), as the MCP and todo sections keep it. Without
/// TUI storage it lives in memory.
pub struct Fold {
    key: String,
    open: Cell<bool>,
}

impl Fold {
    pub fn load(tui: &Tui, key: String) -> Rc<Self> {
        let open = tui
            .storage()
            .and_then(|storage| storage.load(&key, &json!({ "open": true })).ok())
            .and_then(|value| value.get("open").and_then(serde_json::Value::as_bool))
            .unwrap_or(true);
        Rc::new(Self {
            key,
            open: Cell::new(open),
        })
    }

    pub fn open(&self) -> bool {
        self.open.get()
    }

    /// Flips the flag, writes it off the UI thread, and renders the sidebar again.
    pub fn toggle(&self, tui: &Tui) {
        let open = !self.open.get();
        self.open.set(open);
        tui.resync();
        let Some(storage) = tui.storage() else { return };
        let key = self.key.clone();
        tui.app.runtime().spawn_blocking(move || {
            let result = storage.update(&key, &json!({ "open": true }), |value| {
                value["open"] = json!(open);
            });
            if let Err(error) = result {
                log::error!("Failed to persist sidebar state: {error}");
            }
        });
    }
}

/// A row that runs `run` on a press (`onMouseDown`) or a release (`onMouseUp`) of the left button.
pub fn on_click(view: &impl Widget, down: bool, run: impl Fn() + 'static) {
    view.on_mouse(move |_, event| {
        let hit = match event.kind {
            MouseEventKind::Down(MouseButton::Left) => down,
            MouseEventKind::Up(MouseButton::Left) => !down,
            _ => false,
        };
        if hit {
            run();
        }
    });
}

/// Reads the session location's `catalogs` once per invalidation: TS reads a catalog the first time a view asks
/// for it, and the sections ask before the session's location is known.
pub fn sync_catalogs(tui: &Tui, session: &SessionID, catalogs: &[opencode_store::Catalog]) {
    let location = tui.data.read(|state| {
        state
            .session(session)
            .map(|info| opencode_store::Location::from(&info.location))
    });
    let Some(location) = location else { return };
    for catalog in catalogs {
        drop(tui.data.catalog_sync(*catalog, Some(&location)));
    }
}
