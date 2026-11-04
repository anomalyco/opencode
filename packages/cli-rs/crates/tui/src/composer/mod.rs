//! Composer tabs (E.13b, row V20): `routes/session/composer/index.tsx` and its tabs.
//!
//! The composer takes the prompt's place under the transcript: a raised panel with the Subagents, Shell, and (while
//! the server offers terminals) Terminals tabs. `session.child.first` (Down on an empty prompt) opens it on the
//! Subagents tab, `terminal.select` on the Terminals tab, and a child session shows it instead of a prompt. While it is
//! open it pushes the `composer` input mode: Left and Right switch tabs, Escape and Ctrl+C close it (a child session
//! goes to its parent instead), and each tab binds its `composer.*` commands.

mod shell;
mod subagents;
mod terminals;

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::SessionID;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use crate::app::Tui;

/// The input mode the composer pushes while it is open.
const MODE: &str = "composer";
/// `maxHeight={5}` of each tab's list.
const ROWS: usize = 5;

/// What outlives a session view (`useStorage().memory`): the Subagents tab's filter.
pub struct Memory {
    active: Cell<bool>,
}

impl Default for Memory {
    fn default() -> Self {
        Self {
            active: Cell::new(true),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tab {
    Subagents,
    Shell,
    Terminals,
}

impl Tab {
    fn label(self) -> &'static str {
        match self {
            Tab::Subagents => "Subagents",
            Tab::Shell => "Shell",
            Tab::Terminals => "Terminals",
        }
    }
}

/// Runs when the composer opens (true) or closes (false), so the session view hides or shows what it replaces.
pub type OnToggle = Rc<dyn Fn(&Tui, bool)>;

/// The composer of one session view. Dropping it removes its key layers and the terminal picker.
pub struct Composer(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    session: SessionID,
    root: View,
    header: View,
    body: View,
    footer: View,
    /// `composer.open`.
    requested: Cell<bool>,
    /// `composer.tab`.
    tab: Cell<Option<Tab>>,
    /// The session is a child; it shows the composer instead of a prompt while it has no form.
    child: Cell<bool>,
    forms: Cell<bool>,
    /// The open state and tab list the last refresh applied.
    open: Cell<bool>,
    tabs: RefCell<Vec<Tab>>,
    default: Cell<Option<Tab>>,
    active: Cell<Tab>,
    subagents: RefCell<subagents::State>,
    shell: RefCell<shell::State>,
    terminals: RefCell<terminals::State>,
    on_toggle: OnToggle,
    mode: RefCell<Option<Disposer>>,
    layers: RefCell<Vec<Disposer>>,
}

impl Composer {
    pub fn new(tui: &Tui, session: &SessionID, on_toggle: OnToggle) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let header = View::new(app)
            .row()
            .justify(Justify::SpaceBetween)
            .padding_edge(Edge::Left, 1);
        // A tab's scroll box takes all of its `maxHeight`, whatever the rows.
        let body = View::new(app).column().shrink(0.0).height(ROWS as u32);
        let footer = View::new(app)
            .row()
            .gap(2)
            .padding_edge(Edge::Left, 1)
            .shrink(0.0);
        let panel = View::new(app)
            .column()
            .border_sides(Sides::LEFT)
            .border_chars(Some(split_border()))
            .border_color(theme.border.base)
            .bg(theme.background.raised.base)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 2)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(
                &View::new(app)
                    .column()
                    .gap(1)
                    .child(&header)
                    .child(&body)
                    .child(&footer),
            );
        let root = View::new(app)
            .column()
            .shrink(0.0)
            .visible(false)
            .child(&panel);
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            session: session.clone(),
            root,
            header,
            body,
            footer,
            requested: Cell::new(false),
            tab: Cell::new(None),
            child: Cell::new(false),
            forms: Cell::new(false),
            open: Cell::new(false),
            tabs: RefCell::new(Vec::new()),
            default: Cell::new(None),
            // `register` makes the first tab active.
            active: Cell::new(Tab::Subagents),
            subagents: RefCell::default(),
            shell: RefCell::default(),
            terminals: RefCell::default(),
            on_toggle,
            mode: RefCell::default(),
            layers: RefCell::default(),
        });
        inner.register(tui);
        let weak = Rc::downgrade(&inner);
        tui.terminals.set_picker(Some(Rc::new(move |tui| {
            if let Some(inner) = weak.upgrade() {
                inner.show(tui, Some(Tab::Terminals));
            }
        })));
        let weak = Rc::downgrade(&inner);
        tui.terminals.set_listener(Some(Rc::new(move |tui| {
            if let Some(inner) = weak.upgrade() {
                inner.refresh(tui);
            }
        })));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// Whether the composer shows, in place of the permission, form, and prompt.
    pub fn open(&self) -> bool {
        self.0.open.get()
    }

    /// Follows the session (`parentID`), its forms, its subagents and shells. `forms` is whether the session has a
    /// form; `muted` is whether the right pane has focus, which closes the composer (`promptMuted`).
    pub fn sync(&self, tui: &Tui, forms: bool, muted: bool) {
        let inner = &self.0;
        let child = tui.data.read(|state| {
            state
                .session(&inner.session)
                .is_some_and(|info| info.parent_id.is_some())
        });
        inner.child.set(child);
        inner.forms.set(forms);
        if muted {
            inner.requested.set(false);
        }
        inner.refresh(tui);
    }
}

impl Drop for Composer {
    fn drop(&mut self) {
        let Some(tui) = self.0.tui.upgrade() else {
            return;
        };
        tui.terminals.set_picker(None);
        tui.terminals.set_listener(None);
        // A command may drop the view while the keymap runs it (a subagent navigates), so the layers go afterwards.
        let mut layers = std::mem::take(&mut *self.0.layers.borrow_mut());
        layers.extend(self.0.mode.borrow_mut().take());
        tui.app
            .defer(move |_| layers.into_iter().for_each(Disposer::dispose));
    }
}

impl Inner {
    fn register(self: &Rc<Self>, tui: &Tui) {
        let open = self.condition(|inner| inner.open.get());
        let run = |action: fn(&Rc<Inner>, &Tui)| {
            let weak = Rc::downgrade(self);
            move |_: Option<&str>, _: Option<&KeyEvent>| {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                action(&inner, &tui);
            }
        };
        let tab = |tab: Tab, commands: Vec<TuiCommand>| KeymapLayer {
            mode: Some(MODE.to_owned()),
            enabled: self.condition(move |inner| inner.open.get() && inner.active.get() == tab),
            priority: 1,
            commands,
            ..KeymapLayer::default()
        };
        let child_first = TuiCommand::new("session.child.first", run(Inner::toggle))
            .title("Toggle subagent picker")
            .group("Session")
            .bind(Bind::Off)
            .palette();
        let layers = [
            KeymapLayer {
                mode: Some(MODE.to_owned()),
                enabled: open,
                priority: 1,
                commands: vec![
                    TuiCommand::inline("left", run(|inner, tui| inner.switch(tui, -1)))
                        .title("Previous tab")
                        .group("Composer"),
                    TuiCommand::inline("right", run(|inner, tui| inner.switch(tui, 1)))
                        .title("Next tab")
                        .group("Composer"),
                    TuiCommand::inline("escape", run(Inner::close))
                        .title("Close composer")
                        .group("Composer"),
                    TuiCommand::inline("ctrl+c", run(Inner::close))
                        .title("Close composer")
                        .group("Composer"),
                ],
                ..KeymapLayer::default()
            },
            tab(Tab::Subagents, subagents::commands(self)),
            tab(Tab::Shell, shell::commands(self)),
            tab(Tab::Terminals, terminals::commands(self)),
            // The session route's command list and its base-mode binding (`routes/session/index.tsx:1399-1407`).
            KeymapLayer {
                mode: Some(GLOBAL_MODE.to_owned()),
                commands: vec![child_first],
                ..KeymapLayer::default()
            },
            KeymapLayer {
                bindings: vec!["session.child.first".to_owned()],
                ..KeymapLayer::default()
            },
        ];
        for layer in layers {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("composer keymap layer: {error}"),
            }
        }
    }

    /// A keymap condition on the composer's own cells: conditions must not lock the store.
    fn condition(self: &Rc<Self>, check: impl Fn(&Inner) -> bool + 'static) -> Condition {
        let weak = Rc::downgrade(self);
        Condition::when(move || weak.upgrade().is_some_and(|inner| check(&inner)))
    }

    /// `session.child.first`.
    fn toggle(self: &Rc<Self>, tui: &Tui) {
        if self.open.get() || self.child.get() {
            self.requested.set(false);
            self.refresh(tui);
        } else {
            self.show(tui, Some(Tab::Subagents));
        }
        tui.dialogs.clear();
    }

    /// `setComposer({ open: true, tab })`.
    fn show(self: &Rc<Self>, tui: &Tui, tab: Option<Tab>) {
        self.requested.set(true);
        self.tab.set(tab);
        self.refresh(tui);
    }

    /// `onClose`: a child session goes to its parent; otherwise the composer closes.
    fn close(self: &Rc<Self>, tui: &Tui) {
        let parent = tui.data.read(|state| {
            state
                .session(&self.session)
                .and_then(|info| info.parent_id.clone())
        });
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
        let index = tabs
            .iter()
            .position(|tab| *tab == self.active.get())
            .unwrap_or(0) as isize;
        let next = (index + direction).rem_euclid(tabs.len() as isize) as usize;
        self.active.set(tabs[next]);
        self.refresh(tui);
    }

    fn is_active(&self, tab: Tab) -> bool {
        self.open.get() && self.active.get() == tab
    }

    /// Applies the open state and the tab list, updates each tab, and redraws.
    fn refresh(self: &Rc<Self>, tui: &Tui) {
        let open = self.requested.get() || (self.child.get() && !self.forms.get());
        let mut tabs = vec![Tab::Subagents, Tab::Shell];
        if tui.terminals.available() {
            tabs.push(Tab::Terminals);
        }
        let default = self
            .tab
            .get()
            .or_else(|| self.child.get().then_some(Tab::Subagents));
        // The effect that picks the default tab runs when the composer opens, its tabs change, or the default changes.
        let reset = open
            && (!self.open.get() || *self.tabs.borrow() != tabs || self.default.get() != default);
        if reset {
            self.active.set(
                default
                    .filter(|tab| tabs.contains(tab))
                    .unwrap_or(tabs[0]),
            );
        }
        *self.tabs.borrow_mut() = tabs;
        self.default.set(default);
        let toggled = self.open.replace(open) != open;
        if toggled {
            self.toggled(tui, open);
        }
        subagents::update(self, tui);
        shell::update(self, tui);
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
        } else if let Some(mode) = self.mode.borrow_mut().take() {
            mode.dispose();
        }
        (self.on_toggle)(tui, open);
        // The session view hides the queued dock while the composer shows; a key that toggled it changed no store state.
        let weak = tui.weak();
        tui.app.defer(move |_| {
            if let Some(tui) = weak.upgrade() {
                tui.sync_view();
            }
        });
    }

    /// Redraws on the next turn, outside the mouse handler of a row it replaces.
    fn redraw_later(self: &Rc<Self>, tui: &Tui) {
        let weak = Rc::downgrade(self);
        tui.app.defer(move |_| {
            let Some(inner) = weak.upgrade() else { return };
            if let Some(tui) = inner.tui.upgrade() {
                inner.refresh(&tui);
            }
        });
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
                let label = Text::new(app, tab.label()).fg(if active {
                    theme.text.base
                } else {
                    theme.text.muted
                });
                if active {
                    label.bold();
                }
                labels.add(&label);
            }
            self.header.add(&labels);
        } else {
            let label = tabs.first().map_or("", |tab| tab.label());
            self.header
                .add(&Text::new(app, label).fg(theme.text.base).bold());
        }
        let esc = Text::new(app, "esc").fg(theme.text.muted);
        let weak = Rc::downgrade(self);
        esc.on_mouse(move |_, event| {
            if !matches!(event.kind, MouseEventKind::Up(_)) {
                return;
            }
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            let weak = Rc::downgrade(&inner);
            tui.app.defer(move |_| {
                let Some(inner) = weak.upgrade() else { return };
                if let Some(tui) = inner.tui.upgrade() {
                    inner.close(&tui);
                }
            });
        });
        self.header.add(&esc);

        self.body.clear();
        let hints = match self.active.get() {
            Tab::Subagents => subagents::draw(self, tui, &theme),
            Tab::Shell => shell::draw(self, tui, &theme),
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

/// How a list row looks: focused (the selection), selected (the current session or shown terminal), or neither.
#[derive(Clone, Copy, PartialEq, Eq)]
enum RowState {
    Focused,
    Selected,
    Base,
}

/// A row's text: the label, clipped to the width (with `…` when `truncate`), and an optional status on the right.
struct Label {
    text: String,
    status: Option<String>,
    truncate: bool,
}

/// One list row: a row box with the action colors and its [`Label`]. `hover` runs when the pointer enters it,
/// `click` on release.
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
        RowState::Focused => (
            theme.background.action.primary.focused,
            theme.text.action.primary.focused,
        ),
        RowState::Selected => (
            theme.background.action.primary.selected,
            theme.text.action.primary.selected,
        ),
        RowState::Base => (
            theme.background.action.primary.base,
            theme.text.action.primary.base,
        ),
    };
    let text = Text::new(app, label.text)
        .fg(foreground)
        .wrap(WrapMode::None)
        .truncate(label.truncate);
    if state == RowState::Focused {
        text.bold();
    }
    let view = View::new(app)
        .row()
        .padding_edge(Edge::Left, 1)
        .padding_edge(Edge::Right, 1)
        .bg(background)
        .child(
            &View::new(app)
                .row()
                .grow(1.0)
                .min_width(0)
                .child(&text),
        );
    if let Some(status) = label.status {
        view.add(
            &Text::new(app, status)
                .fg(if state == RowState::Focused {
                    theme.text.action.primary.focused
                } else {
                    theme.text.muted
                })
                .wrap(WrapMode::None),
        );
    }
    view.on_hover(move |_, over| {
        if over {
            hover();
        }
    });
    view.on_mouse(move |_, event| {
        if matches!(event.kind, MouseEventKind::Up(_)) {
            click();
        }
    });
    view
}

/// The window of `rows` list rows from `offset`, as a scroll box of at most [`ROWS`] rows shows them.
fn window<T>(rows: &[T], offset: usize) -> std::ops::Range<usize> {
    let start = offset.min(rows.len().saturating_sub(ROWS));
    start..(start + ROWS).min(rows.len())
}

/// `scrollTo(y)` of a list of `len` rows in a box of at most [`ROWS`]: clamped to the last full window.
fn clamp_offset(y: isize, len: usize) -> usize {
    y.clamp(0, len.saturating_sub(ROWS) as isize) as usize
}

/// The empty-list line, such as ` No shell commands`.
fn empty(tui: &Tui, theme: &Theme, text: String) -> Text {
    Text::new(&tui.app, text).fg(theme.text.muted)
}

/// `SplitBorder`'s `┃` sides.
fn split_border() -> [char; 11] {
    [' ', ' ', ' ', ' ', ' ', '┃', ' ', ' ', ' ', ' ', ' ']
}
