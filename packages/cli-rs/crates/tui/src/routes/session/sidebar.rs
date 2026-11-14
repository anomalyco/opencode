//! The session sidebar (E.14, row V19, `routes/session/sidebar.tsx`, `component/session-frame.tsx:106-130,
//! 325-397`): the title, the `sidebar.content` slot in a scroll box, and the `sidebar.footer` slot, on the
//! raised background, 42 columns wide.
//!
//! It is the frame's right pane while the terminal is wider than 120 columns beside the tab rail, and an
//! overlay over a dimmed session otherwise. `session.sidebar` in `cli.json` (`auto` or `hide`) decides
//! whether it shows by itself; `session.sidebar.toggle` (`<leader>b`) writes it and opens or closes it. A child
//! session never shows it. An open panel takes the right pane instead.

use opencode_local::cli_config::Sidebar as SidebarSetting;
use opencode_plugin::{SlotInput, SlotMount, slot};

use crate::frame::layout::SESSION_SIDEBAR_WIDTH;
use crate::prelude::*;

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
    content: View,
    footer: View,
    /// The `sidebar.content` and `sidebar.footer` slots, mounted while the sidebar shows (TS `<Show>`).
    slots: RefCell<Vec<SlotMount>>,
    /// `sidebarOpen`: opened with the toggle, beyond what `session.sidebar` shows by itself.
    open: Cell<bool>,
    /// Where the panel is now.
    placed: Cell<Place>,
    /// Whether a plugin panel of this session showed at the last layout.
    panel_shown: Cell<bool>,
    /// The terminal of this session shown at the last layout.
    terminal: RefCell<Option<String>>,
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
    let title = Text::new(app, "").bold();
    let content = View::new(app).column().shrink(0.0).gap(1).padding_edge(Edge::Right, 1);
    let scroll = ScrollBox::new(app)
        .axes(false, true)
        // TS draws the bar over the content's right padding; this keeps the content at its width.
        .scrollbars(false)
        .grow(1.0)
        .min_height(0);
    scroll.add(&content);
    let footer = View::new(app).column().shrink(0.0).gap(1).padding_edge(Edge::Top, 1);
    let panel = View::new(app)
        .column()
        .width(SESSION_SIDEBAR_WIDTH)
        .height(Length::percent(100.0))
        .shrink(0.0)
        .padding_y(1)
        .padding_x(2)
        .child(&View::new(app).shrink(0.0).padding_edge(Edge::Right, 2).padding_edge(Edge::Bottom, 1).child(&title))
        .child(&scroll)
        .child(&footer);
    let docked =
        View::new(app).column().shrink(0.0).width(SESSION_SIDEBAR_WIDTH).min_width(0).min_height(0).visible(false);
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
        content,
        footer,
        slots: RefCell::default(),
        open: Cell::new(false),
        placed: Cell::new(Place::Hidden),
        panel_shown: Cell::new(false),
        terminal: RefCell::default(),
        layers: RefCell::default(),
    });
    let weak = Rc::downgrade(&inner);
    let owner = tui.weak();
    let size = Cell::new(app.size());
    row.on_resize(move |cx, _| {
        let (Some(inner), Some(tui)) = (weak.upgrade(), owner.upgrade()) else { return };
        if size.replace(cx.app().size()) == cx.app().size() {
            return;
        }
        inner.layout(&tui);
    });
    let settings = tui.settings.subscribe(bind!(inner, |inner, tui| inner.layout(tui)));
    inner.layers.borrow_mut().push(settings);
    install_layers(tui, &inner);
    let sidebar = Sidebar { inner };
    sidebar.inner.paint(&tui.page());
    sidebar.inner.layout(tui);
    sidebar.inner.retitle(tui);
    sidebar
}

impl Sidebar {
    /// Paints in the page theme again, keeping where it is and its scroll position. The plugin sections take the
    /// theme in place; when one cannot, they mount again.
    pub fn restyle(&self, tui: &Tui) {
        let inner = &self.inner;
        inner.paint(&tui.page());
        let restyled = inner.slots.borrow().iter().fold(true, |done, slot| slot.restyle(tui) && done);
        if !restyled && inner.placed.get() != Place::Hidden {
            inner.slots.borrow_mut().clear();
            inner.content.clear();
            inner.footer.clear();
            *inner.slots.borrow_mut() = inner.mount_slots(tui);
        }
    }

    pub fn sync(&self, tui: &Tui, changes: &Changes) {
        if changes.session(&self.inner.session) {
            self.inner.retitle(tui);
        }
        self.inner.layout(tui);
        crate::plugins::host::changed(tui, changes, |changed| {
            self.inner.slots.borrow().iter().for_each(|slot| slot.sync(tui, changed));
        });
    }

    /// Whether the sidebar is the right pane (`sidebarVisible` of the session view).
    pub fn shown(&self) -> bool {
        self.inner.placed.get() != Place::Hidden
    }
}

impl Drop for Sidebar {
    fn drop(&mut self) {
        let layers = std::mem::take(&mut *self.inner.layers.borrow_mut());
        self.inner.app.defer(move |_| drop(layers));
    }
}

impl Inner {
    fn paint(&self, theme: &Theme) {
        self.title.fg(theme.text.base);
        self.panel.bg(theme.background.raised.base);
    }

    /// The `sidebar.content` and `sidebar.footer` slots.
    fn mount_slots(&self, tui: &Tui) -> Vec<SlotMount> {
        let input = SlotInput { session_id: Some(self.session.0.clone()), ..SlotInput::default() };
        vec![
            crate::plugins::host::slot(tui, &self.content, slot::SIDEBAR_CONTENT, &input, |_| {}),
            crate::plugins::host::slot(tui, &self.footer, slot::SIDEBAR_FOOTER, &input, |_| {}),
        ]
    }

    fn retitle(&self, tui: &Tui) {
        let title = tui.data.read(|state| state.session(&self.session).map(crate::dialogs::session_list::title));
        self.title.set_text(title.unwrap_or_default());
        tui.app.request_redraw();
    }

    /// `wide`: the terminal beside the tab rail is wider than 120 columns.
    fn wide(tui: &Tui) -> bool {
        i64::from(tui.app.size().0) - i64::from(tui.frame.rail_width(tui)) > WIDE
    }

    /// `rightPane() === "sidebar"`.
    fn wanted(&self, tui: &Tui) -> bool {
        let panel = tui.panels.current().is_some_and(|panel| panel.session == self.session.0);
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
        // So does a terminal that opens; it takes the pane unless the toggle opened the sidebar.
        let terminal = tui.terminals.selected(&self.session.0);
        if terminal.is_some() && self.terminal.replace(terminal.clone()) != terminal {
            self.open.set(false);
        }
        if terminal.is_none() {
            self.terminal.replace(None);
        }
        let child =
            tui.data.read(|state| state.session(&self.session).is_some_and(|session| session.parent_id.is_some()));
        if child {
            return false;
        }
        self.open.get() || (terminal.is_none() && setting(tui) == SidebarSetting::Auto && Self::wide(tui))
    }

    fn layout(&self, tui: &Tui) {
        let place = match (self.wanted(tui), Self::wide(tui)) {
            (false, _) => Place::Hidden,
            (true, true) => Place::Docked,
            (true, false) => Place::Overlay,
        };
        let before = self.placed.replace(place);
        if before == place {
            return;
        }
        // The sections mount as the sidebar shows and unmount as it hides, so a hidden sidebar renders nothing.
        if before == Place::Hidden {
            *self.slots.borrow_mut() = self.mount_slots(tui);
        }
        if place == Place::Hidden {
            self.slots.borrow_mut().clear();
            self.content.clear();
            self.footer.clear();
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
        if !visible && tui.panels.current().is_some_and(|panel| panel.session == self.session.0) {
            tui.panels.close(tui);
            self.panel_shown.set(false);
        }
        if !visible && tui.terminals.selected(&self.session.0).is_some() {
            crate::terminal::select(tui, &self.session.0, None, true);
        }
        self.layout(tui);
    }
}

fn setting(tui: &Tui) -> SidebarSetting {
    tui.settings.info().session.and_then(|session| session.sidebar).unwrap_or(SidebarSetting::Auto)
}

/// `session.sidebar.toggle` in the palette, and Escape or Ctrl+C to close the overlay while no dialog is open.
fn install_layers(tui: &Tui, inner: &Rc<Inner>) {
    let toggle = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let (Some(inner), Some(tui)) = (weak.upgrade(), tui.upgrade()) else { return };
            inner.toggle(&tui);
            tui.dialogs.clear();
        }
    };
    let close = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let (Some(inner), Some(tui)) = (weak.upgrade(), tui.upgrade()) else { return };
            inner.toggle(&tui);
        }
    };
    let overlay = {
        let weak = Rc::downgrade(inner);
        let tui = tui.weak();
        Condition::when(move || {
            weak.upgrade().is_some_and(|inner| inner.placed.get() == Place::Overlay)
                && tui.upgrade().is_some_and(|tui| !tui.dialogs.is_open())
        })
    };
    let layers = [
        KeymapLayer::global(vec![
            TuiCommand::new("session.sidebar.toggle", toggle)
                .title("Toggle sidebar")
                .group("Session")
                .palette()
                .bind(Bind::Default),
        ]),
        KeymapLayer::new(vec![TuiCommand::inline("escape,ctrl+c", close).title("Close sidebar").group("Session")])
            .enabled(overlay),
    ];
    for layer in layers {
        match tui.keymap.layer(layer) {
            Ok(disposer) => inner.layers.borrow_mut().push(disposer),
            Err(error) => log::error!("sidebar keymap layer: {error}"),
        }
    }
}
