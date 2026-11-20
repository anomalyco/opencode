//! Session composer tabs for subagents, shells, scripts, and terminals. The open composer owns the input until a permission
//! prompt takes it.

mod scripts;
mod shell;
mod subagents;
mod terminals;

use crate::prelude::*;
use opencode_store::SessionStatus;

/// The input mode the composer pushes while it is open.
pub(crate) const MODE: &str = "composer";
const ROWS: usize = 5;

pub struct Memory {
    active: Cell<bool>,
}

impl Default for Memory {
    fn default() -> Self {
        Self { active: Cell::new(true) }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tab {
    Subagents,
    Shell,
    Scripts,
    Terminals,
}

impl Tab {
    fn label(self) -> &'static str {
        match self {
            Tab::Subagents => "Subagents",
            Tab::Shell => "Shell",
            Tab::Scripts => "Scripts",
            Tab::Terminals => "Terminals",
        }
    }
}

/// Runs when the composer opens (true) or closes (false), so the session view hides or shows what it replaces.
pub type OnToggle = Rc<dyn Fn(&Tui, bool)>;

pub struct Composer(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    session: SessionID,
    root: View,
    panel: View,
    header: View,
    body: View,
    footer: View,
    requested: Cell<bool>,
    tab: Cell<Option<Tab>>,
    /// The session is a child; it shows the composer instead of a prompt while it has no form.
    child: Cell<bool>,
    forms: Cell<bool>,
    permissions: Cell<bool>,
    /// The open state and tab list the last refresh applied.
    open: Cell<bool>,
    tabs: RefCell<Vec<Tab>>,
    default: Cell<Option<Tab>>,
    active: Cell<Tab>,
    /// The user picked a tab, so a requested tab that shows late no longer takes over.
    chosen: Cell<bool>,
    subagents: RefCell<subagents::State>,
    shell: RefCell<shell::State>,
    scripts: RefCell<scripts::State>,
    terminals: RefCell<terminals::State>,
    on_toggle: OnToggle,
    mode: RefCell<Option<Disposer>>,
    layers: RefCell<Vec<Disposer>>,
}

impl Composer {
    pub fn new(tui: &Tui, session: &SessionID, on_toggle: OnToggle) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let header = View::new(app).row().justify(Justify::SpaceBetween).padding_edge(Edge::Left, 1);
        let body = View::new(app).column().shrink(0.0).height(ROWS as u32);
        let footer = View::new(app).row().gap(2).padding_edge(Edge::Left, 1).shrink(0.0);
        let panel = View::new(app)
            .column()
            .border_sides(Sides::LEFT)
            .border_chars(Some(split_border()))
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(&View::new(app).column().gap(1).child(&header).child(&body).child(&footer));
        let root = View::new(app).column().shrink(0.0).visible(false).child(&panel);
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            session: session.clone(),
            root,
            panel,
            header,
            body,
            footer,
            requested: Cell::new(false),
            tab: Cell::new(None),
            child: Cell::new(false),
            forms: Cell::new(false),
            permissions: Cell::new(false),
            open: Cell::new(false),
            tabs: RefCell::new(Vec::new()),
            default: Cell::new(None),
            // `register` makes the first tab active.
            active: Cell::new(Tab::Subagents),
            chosen: Cell::new(false),
            subagents: RefCell::default(),
            shell: RefCell::default(),
            scripts: RefCell::default(),
            terminals: RefCell::default(),
            on_toggle,
            mode: RefCell::default(),
            layers: RefCell::default(),
        });
        inner.paint(&theme);
        inner.register(tui);
        tui.terminals.set_picker(Some(Rc::new(bind!(inner, |inner, tui| inner.show(tui, Some(Tab::Terminals))))));
        tui.terminals.set_listener(Some(Rc::new(bind!(inner, |inner, tui| inner.refresh(tui)))));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn open(&self) -> bool {
        self.0.open.get()
    }

    pub fn restyle(&self, tui: &Tui) {
        self.0.paint(&tui.page());
        if self.0.open.get() {
            self.0.draw(tui);
        }
    }

    pub fn sync(&self, tui: &Tui, forms: bool, permissions: bool, muted: bool) {
        let inner = &self.0;
        let child = tui.data.read(|state| state.session(&inner.session).is_some_and(|info| info.parent_id.is_some()));
        inner.child.set(child);
        inner.forms.set(forms);
        inner.permissions.set(permissions);
        if muted {
            inner.requested.set(false);
        }
        inner.refresh(tui);
    }
}

impl Drop for Composer {
    fn drop(&mut self) {
        let Some(tui) = self.0.tui.upgrade() else { return };
        tui.terminals.set_picker(None);
        tui.terminals.set_listener(None);
        // A command may drop the view while the keymap runs it (a subagent navigates), so the layers go afterwards.
        let mut layers = std::mem::take(&mut *self.0.layers.borrow_mut());
        layers.extend(self.0.mode.borrow_mut().take());
        tui.app.defer(move |_| drop(layers));
    }
}

impl Inner {
    fn paint(&self, theme: &Theme) {
        self.panel.border_color(theme.border.base).bg(theme.background.raised.base);
    }

    fn register(self: &Rc<Self>, tui: &Tui) {
        let open = self.condition(|inner| inner.open.get());
        let tab = |tab: Tab, commands: Vec<TuiCommand>| {
            KeymapLayer::new(commands)
                .mode(MODE)
                .enabled(self.condition(move |inner| inner.open.get() && inner.active.get() == tab))
                .priority(1)
        };
        let child_first = TuiCommand::new(
            "session.child.first",
            bind!(self, |inner, tab: Option<&str>, _: Option<&KeyEvent>| {
                let Some(tui) = inner.tui.upgrade() else { return };
                inner.toggle(&tui, tab);
            }),
        )
        .title("Toggle subagent picker")
        .group("Session")
        .bind(Bind::Off)
        .palette();
        let layers = [
            KeymapLayer::new(vec![
                TuiCommand::inline("left", self.run(|inner, tui| inner.switch(tui, -1)))
                    .title("Previous tab")
                    .group("Composer"),
                TuiCommand::inline("right", self.run(|inner, tui| inner.switch(tui, 1)))
                    .title("Next tab")
                    .group("Composer"),
                TuiCommand::inline("escape", self.run(Inner::close)).title("Close composer").group("Composer"),
                TuiCommand::inline("ctrl+c", self.run(Inner::close)).title("Close composer").group("Composer"),
            ])
            .mode(MODE)
            .enabled(open)
            .priority(1),
            tab(Tab::Subagents, subagents::commands(self)),
            tab(Tab::Shell, shell::commands(self)),
            tab(Tab::Scripts, scripts::commands(self)),
            tab(Tab::Terminals, terminals::commands(self)),
            KeymapLayer::global(vec![child_first]),
            KeymapLayer::default().bindings(["session.child.first"]),
        ];
        for layer in layers {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("composer keymap layer: {error}"),
            }
        }
    }

    /// A command body that runs `action` while the TUI lives.
    fn run(self: &Rc<Self>, action: fn(&Rc<Inner>, &Tui)) -> impl Fn(Option<&str>, Option<&KeyEvent>) + 'static {
        bind!(self, |inner, _: Option<&str>, _: Option<&KeyEvent>| {
            let Some(tui) = inner.tui.upgrade() else { return };
            action(&inner, &tui);
        })
    }

    /// A named command of one composer tab.
    fn command(self: &Rc<Self>, id: &str, title: &str, action: fn(&Rc<Inner>, &Tui)) -> TuiCommand {
        TuiCommand::new(id, self.run(action)).title(title).group("Composer")
    }

    /// A keymap condition on the composer's own cells: conditions must not lock the store.
    fn condition(self: &Rc<Self>, check: impl Fn(&Inner) -> bool + 'static) -> Condition {
        Condition::when(bind!(self, |inner| check(&inner)))
    }

    /// `session.child.first`: opens on the named tab (the prompt footer names one), else toggles the picker on the
    /// first busy tab.
    fn toggle(self: &Rc<Self>, tui: &Tui, tab: Option<&str>) {
        if let Some(tab) = tab.and_then(|tab| match tab {
            "subagents" => Some(Tab::Subagents),
            "shell" => Some(Tab::Shell),
            "scripts" => Some(Tab::Scripts),
            _ => None,
        }) {
            self.show(tui, Some(tab));
        } else if self.open.get() || self.child.get() {
            self.requested.set(false);
            self.refresh(tui);
        } else {
            self.show(tui, Some(self.busy_tab(tui)));
        }
        tui.dialogs.clear();
    }

    /// The tab the picker opens on when nothing asks for one (TS `busyTab`).
    fn busy_tab(&self, tui: &Tui) -> Tab {
        let (scripts, subagents, shells) = tui.data.read(|state| busy(state, &self.session));
        match busy_tab(scripts, subagents, shells) {
            "scripts" => Tab::Scripts,
            "shell" => Tab::Shell,
            _ => Tab::Subagents,
        }
    }

    fn show(self: &Rc<Self>, tui: &Tui, tab: Option<Tab>) {
        self.requested.set(true);
        self.tab.set(tab);
        self.refresh(tui);
    }

    /// `onClose`: a child session goes to its parent; otherwise the composer closes.
    fn close(self: &Rc<Self>, tui: &Tui) {
        let parent = tui.data.read(|state| state.session(&self.session).and_then(|info| info.parent_id.clone()));
        if let Some(parent) = parent {
            tui.navigate(crate::routes::Route::Session { id: parent });
            return;
        }
        self.requested.set(false);
        self.refresh(tui);
    }

    fn switch(self: &Rc<Self>, tui: &Tui, direction: isize) {
        let tabs = self.tabs.borrow().clone();
        if tabs.len() <= 1 {
            return;
        }
        let index = tabs.iter().position(|tab| *tab == self.active.get()).unwrap_or(0) as isize;
        let next = (index + direction).rem_euclid(tabs.len() as isize) as usize;
        self.active.set(tabs[next]);
        self.chosen.set(true);
        self.refresh(tui);
    }

    fn is_active(&self, tab: Tab) -> bool {
        self.open.get() && self.active.get() == tab
    }

    /// The tabs in a fixed order, and which one is active (TS `createComposerTabs`): opening, or a new requested tab,
    /// picks the requested tab or the first; a requested tab that shows late takes over until the user picks one; and
    /// tabs that come and go, like Scripts, leave the active tab alone unless they remove it.
    fn refresh(self: &Rc<Self>, tui: &Tui) {
        let open = !self.permissions.get() && (self.requested.get() || (self.child.get() && !self.forms.get()));
        let mut tabs = vec![Tab::Subagents, Tab::Shell];
        if scripts::shown(self, tui) {
            tabs.push(Tab::Scripts);
        }
        if tui.terminals.available() {
            tabs.push(Tab::Terminals);
        }
        let default = self.tab.get().or_else(|| self.child.get().then_some(Tab::Subagents));
        let reopened = open != self.open.get() || default != self.default.get();
        if reopened {
            self.chosen.set(false);
        }
        if open && let Some(tab) = pick(&tabs, self.active.get(), default, reopened, self.chosen.get()) {
            self.active.set(tab);
        }
        *self.tabs.borrow_mut() = tabs;
        self.default.set(default);
        let toggled = self.open.replace(open) != open;
        if toggled {
            self.toggled(tui, open);
        }
        subagents::update(self, tui);
        shell::update(self, tui);
        scripts::update(self, tui);
        terminals::update(self, tui);
        self.root.visible(open);
        if open {
            self.draw(tui);
        }
        tui.app.request_redraw();
    }

    fn toggled(&self, tui: &Tui, open: bool) {
        if open {
            *self.mode.borrow_mut() = Some(tui.keymap.push_mode(MODE, Condition::Always));
        } else {
            self.mode.borrow_mut().take();
        }
        (self.on_toggle)(tui, open);
        // The session view hides the queued dock while the composer shows; a key that toggled it changed no store state.
        tui.app.defer(bind!(tui, |tui, _| tui.sync_view()));
    }

    fn redraw_later(self: &Rc<Self>, tui: &Tui) {
        tui.app.defer(bind!(self, |inner, _| {
            if let Some(tui) = inner.tui.upgrade() {
                inner.refresh(&tui);
            }
        }));
    }

    fn draw(self: &Rc<Self>, tui: &Tui) {
        let app = &tui.app;
        let theme = tui.page();
        let tabs = self.tabs.borrow().clone();
        self.header.clear();
        if tabs.len() > 1 {
            let labels = View::new(app).row().gap(2);
            for tab in &tabs {
                let active = *tab == self.active.get();
                let label = Text::new(app, tab.label()).fg(if active { theme.text.base } else { theme.text.muted });
                if active {
                    label.bold();
                }
                let (weak, tab) = (Rc::downgrade(self), *tab);
                label.on_mouse(move |_, event| {
                    if !matches!(event.kind, MouseEventKind::Up(_)) {
                        return;
                    }
                    let Some(inner) = weak.upgrade() else { return };
                    let Some(tui) = inner.tui.upgrade() else { return };
                    inner.active.set(tab);
                    inner.chosen.set(true);
                    inner.redraw_later(&tui);
                });
                labels.add(&label);
            }
            self.header.add(&labels);
        } else {
            let label = tabs.first().map_or("", |tab| tab.label());
            self.header.add(&Text::new(app, label).fg(theme.text.base).bold());
        }
        let esc = Text::new(app, "esc").fg(theme.text.muted);
        let weak = Rc::downgrade(self);
        esc.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
            if !matches!(event.kind, MouseEventKind::Up(_)) {
                return;
            }
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else { return };
            tui.app.defer(bind!(inner, |inner, _| {
                if let Some(tui) = inner.tui.upgrade() {
                    inner.close(&tui);
                }
            }));
        });
        self.header.add(&esc);

        self.body.clear();
        let hints = match self.active.get() {
            Tab::Subagents => subagents::draw(self, tui, &theme),
            Tab::Shell => shell::draw(self, tui, &theme),
            Tab::Scripts => scripts::draw(self, tui, &theme),
            Tab::Terminals => terminals::draw(self, tui, &theme),
        };

        self.footer.clear();
        let mut hints: Vec<(String, String)> = hints;
        if tabs.len() > 1 {
            hints.push(("tabs".to_owned(), "←/→".to_owned()));
        }
        for (label, shortcut) in hints {
            self.footer.add(&Text::new(
                app,
                vec![
                    Span::styled(label, Style::new().fg(theme.text.base).bold()),
                    Span::styled(" ", Style::new().fg(theme.text.base)),
                    Span::styled(shortcut, Style::new().fg(theme.text.muted)),
                ],
            ));
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RowState {
    Focused,
    Selected,
    Base,
}

struct Label {
    text: String,
    status: Option<String>,
    truncate: bool,
    /// Columns between the text and the status.
    gap: u32,
}

fn row(
    tui: &Tui,
    theme: &Theme,
    state: RowState,
    label: Label,
    hover: impl Fn() + 'static,
    click: impl Fn() + 'static,
) -> View {
    let app = &tui.app;
    let (background, foreground) = match state {
        RowState::Focused => (theme.background.action.primary.focused, theme.text.action.primary.focused),
        RowState::Selected => (theme.background.action.primary.selected, theme.text.action.primary.selected),
        RowState::Base => (theme.background.action.primary.base, theme.text.action.primary.base),
    };
    let text = Text::new(app, label.text).fg(foreground).wrap(WrapMode::None).truncate(label.truncate);
    if state == RowState::Focused {
        text.bold();
    }
    let view = View::new(app)
        .row()
        .gap(label.gap)
        .padding_edge(Edge::Left, 1)
        .padding_edge(Edge::Right, 1)
        .bg(background)
        .child(&View::new(app).row().grow(1.0).min_width(0).child(&text));
    if let Some(status) = label.status {
        view.add(
            &Text::new(app, status)
                .fg(if state == RowState::Focused { theme.text.action.primary.focused } else { theme.text.muted })
                .wrap(WrapMode::None),
        );
    }
    view.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| match event.kind {
        MouseEventKind::Moved => hover(),
        MouseEventKind::Up(_) => click(),
        _ => {}
    });
    view
}

/// The tab to make active in an open picker, or `None` to keep it: on opening or a new requested tab, the requested
/// tab or the first; a requested tab that shows late, until the user picked one; the first when the active one went.
fn pick(tabs: &[Tab], active: Tab, requested: Option<Tab>, reopened: bool, chosen: bool) -> Option<Tab> {
    let first = *tabs.first()?;
    let late = !chosen && requested.is_some_and(|tab| tab != active && tabs.contains(&tab));
    (reopened || late || !tabs.contains(&active)).then(|| requested.filter(|tab| tabs.contains(tab)).unwrap_or(first))
}

/// What a session has running (TS `busyCounts`): its own scripts, the subagents in its family that run or own
/// running jobs, and its shells.
pub(crate) fn busy(state: &opencode_store::State, session: &SessionID) -> (usize, usize, usize) {
    let jobs = state.jobs(session);
    let scripts = jobs.iter().filter(|job| crate::plugins::host::is_script(job, session)).count();
    let subagents = state
        .family(session)
        .iter()
        .filter(|id| {
            *id != session && (state.status(id) == SessionStatus::Running || !state.owned_jobs(&jobs, id).is_empty())
        })
        .count();
    (scripts, subagents, state.session_shells(session).len())
}

/// The tab the picker opens on when nothing asks for one (TS `busyTab`): the first that has something running, else
/// Subagents.
pub(crate) fn busy_tab(scripts: usize, subagents: usize, shells: usize) -> &'static str {
    match (scripts, subagents, shells) {
        (1.., _, _) => "scripts",
        (_, 1.., _) => "subagents",
        (_, _, 1..) => "shell",
        _ => "subagents",
    }
}

fn window<T>(rows: &[T], offset: usize) -> std::ops::Range<usize> {
    let start = offset.min(rows.len().saturating_sub(ROWS));
    start..(start + ROWS).min(rows.len())
}

/// `scrollTo(y)` of a list of `len` rows in a box of at most [`ROWS`]: clamped to the last full window.
fn clamp_offset(y: isize, len: usize) -> usize {
    y.clamp(0, len.saturating_sub(ROWS) as isize) as usize
}

fn empty(tui: &Tui, theme: &Theme, text: String) -> Text {
    Text::new(&tui.app, text).fg(theme.text.muted)
}

fn split_border() -> [char; 11] {
    [' ', ' ', ' ', ' ', ' ', '┃', ' ', ' ', ' ', ' ', ' ']
}
