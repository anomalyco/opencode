//! Dialog stack and layout (U.3): `packages/tui/src/ui/dialog.tsx`.
//!
//! [`Dialogs`] is the `DialogProvider`: one host over the whole screen that shows the top entry inside the dimmed
//! backdrop and panel, pushes the `modal` input mode while a dialog is open, and binds Escape and Ctrl+C to close
//! it. A dialog's content is built by a closure that receives a [`DialogCx`]: the app, the keymap, the dialog
//! surface of the theme, and layer registration tied to the entry's lifetime. [`header`], [`layout`], and
//! [`footer`] are `DialogHeader`, `DialogLayout`, and `DialogFooter`.
//!
//! The kit draws the dialogs as the TUI does with the `new-designs` experiment on (`config/index.tsx:394-397`),
//! the only design the Rust client implements.

use crate::keymap::{KeymapLayer, TuiKeymap};
use crate::theme::{Surface, Theme};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

/// What the dialog kit's keymap focuses: widget ids ([`Widget::id`]).
pub type FocusId = u32;
/// The keymap dialogs register their layers with.
pub type DialogKeymap = TuiKeymap<FocusId>;

/// The input mode a dialog pushes; dialog layers declare it.
pub const MODAL_MODE: &str = "modal";
pub const DIALOG_INSET: u32 = 3;
/// List rows reserve a 1-cell gutter for the `▌` bar or `●` marker.
pub const DIALOG_LIST_INSET: u32 = DIALOG_INSET + 1;

/// `DialogSize`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DialogSize {
    #[default]
    Medium,
    Large,
    XLarge,
}

impl DialogSize {
    /// `dialogWidth`.
    pub fn width(self) -> u32 {
        match self {
            Self::XLarge => 116,
            Self::Large => 88,
            Self::Medium => 60,
        }
    }
}

/// Options of [`Dialogs::replace`].
#[derive(Clone, Debug, Default)]
pub struct DialogOptions {
    pub size: DialogSize,
    /// Identifies the dialog, so callers can tell which one is open ([`Dialogs::key`]).
    pub key: Option<String>,
}

type OnClose = Box<dyn FnOnce()>;

struct Entry {
    on_close: Option<OnClose>,
    key: Option<String>,
    content: View,
    cx: Rc<DialogCx>,
}

struct Inner {
    app: App,
    keymap: Rc<DialogKeymap>,
    theme: RefCell<Theme>,
    host: View,
    backdrop: View,
    panel: View,
    stack: RefCell<Vec<Entry>>,
    size: Cell<DialogSize>,
    centered: Cell<bool>,
    mode: RefCell<Option<Disposer>>,
    layer: RefCell<Option<Disposer>>,
    focus: RefCell<Option<AnyWidget>>,
    dismiss: Cell<bool>,
}

/// The dialog stack (`DialogProvider` and `useDialog()`). Cloning is cheap.
#[derive(Clone)]
pub struct Dialogs(Rc<Inner>);

impl Dialogs {
    /// Creates the host above everything else on `app.root()`. `theme` is the page theme; dialogs draw on its
    /// dialog surface.
    pub fn new(app: &App, keymap: Rc<DialogKeymap>, theme: Theme) -> Self {
        let host = View::new(app).absolute().z_index(3000);
        let backdrop = View::new(app)
            .absolute()
            .position(Edge::Left, 0)
            .position(Edge::Top, 0)
            .align_items(Align::Center)
            .bg(Color::rgba(0, 0, 0, 150))
            .visible(false);
        let panel = View::new(app).padding_edge(Edge::Top, 1);
        backdrop.add(&panel);
        host.add(&backdrop);
        app.root().add(&host);
        let dialogs = Self(Rc::new(Inner {
            app: app.clone(),
            keymap,
            theme: RefCell::new(theme),
            host,
            backdrop,
            panel,
            stack: RefCell::new(Vec::new()),
            size: Cell::new(DialogSize::Medium),
            centered: Cell::new(false),
            mode: RefCell::new(None),
            layer: RefCell::new(None),
            focus: RefCell::new(None),
            dismiss: Cell::new(false),
        }));
        dialogs.install();
        dialogs
    }

    fn install(&self) {
        let weak = Rc::downgrade(&self.0);
        let open = {
            let weak = weak.clone();
            Condition::When(Rc::new(move || {
                weak.upgrade()
                    .is_some_and(|inner| !inner.stack.borrow().is_empty())
            }))
        };
        let close = |ctrl_c: bool, weak: Weak<Inner>| {
            move |_: Option<&str>, _: Option<&KeyEvent>| {
                let Some(inner) = weak.upgrade() else { return };
                let dialogs = Dialogs(inner);
                if dialogs.0.app.selected_text().is_some() {
                    dialogs.0.app.clear_selection();
                    return;
                }
                if ctrl_c && dialogs.clear_editor() {
                    return;
                }
                dialogs.pop();
            }
        };
        let layer = self.0.keymap.layer(KeymapLayer {
            mode: Some(MODAL_MODE.to_owned()),
            enabled: open,
            commands: vec![
                crate::keymap::TuiCommand::inline("escape", close(false, weak.clone()))
                    .title("Close dialog")
                    .group("Dialog"),
                crate::keymap::TuiCommand::inline("ctrl+c", close(true, weak.clone()))
                    .title("Close dialog")
                    .group("Dialog"),
            ],
            ..KeymapLayer::default()
        });
        *self.0.layer.borrow_mut() = layer.ok();

        let backdrop_weak = weak.clone();
        self.0.backdrop.on_mouse(move |_cx, event| {
            let Some(inner) = backdrop_weak.upgrade() else {
                return;
            };
            match event.kind {
                // TS asks whether a selection exists. A press on text has started a drag by now, so a drag that
                // starts inside the panel keeps the dialog open.
                MouseEventKind::Down(_) => inner
                    .dismiss
                    .set(inner.app.is_selecting() || inner.app.selected_text().is_some()),
                MouseEventKind::Up(_) => {
                    if inner.dismiss.replace(false) {
                        return;
                    }
                    Dialogs(inner).clear();
                }
                _ => {}
            }
        });
        self.0.panel.on_mouse(move |cx, event| {
            let Some(inner) = weak.upgrade() else { return };
            if !matches!(event.kind, MouseEventKind::Up(_)) {
                return;
            }
            // A selection release bubbles on to the copy-on-select handler; the backdrop's flag keeps it open.
            if inner
                .app
                .selected_text()
                .is_some_and(|text| !text.is_empty())
            {
                return;
            }
            inner.dismiss.set(false);
            cx.stop_propagation();
        });
        let resize = Rc::downgrade(&self.0);
        self.0.app.on_resize(move |_cx, _, _| {
            if let Some(inner) = resize.upgrade() {
                Dialogs(inner).layout_frame();
            }
        });
    }

    /// Replaces the stack with one dialog, closing the ones open before (TS `replace`).
    pub fn replace(
        &self,
        build: impl FnOnce(&Rc<DialogCx>) -> View,
        on_close: Option<OnClose>,
        options: DialogOptions,
    ) {
        if self.0.stack.borrow().is_empty() {
            let focused = self.0.app.focused();
            if focused.is_some() {
                self.0.app.blur();
            }
            *self.0.focus.borrow_mut() = focused;
        }
        self.close_all();
        self.0.size.set(options.size);
        self.0.centered.set(false);
        let cx = Rc::new(DialogCx {
            app: self.0.app.clone(),
            dialogs: self.clone(),
            keymap: self.0.keymap.clone(),
            theme: self.0.theme.borrow().surface(Surface::Dialog),
            layers: RefCell::new(Vec::new()),
            editors: RefCell::new(Vec::new()),
            focus: RefCell::new(None),
        });
        // The mode goes first, so layers registered while building see it.
        if self.0.mode.borrow().is_none() {
            *self.0.mode.borrow_mut() =
                Some(self.0.keymap.push_mode(MODAL_MODE, Condition::Always));
        }
        let content = build(&cx);
        self.0.panel.add(&content);
        let focus = cx.focus.borrow_mut().take();
        self.0.stack.borrow_mut().push(Entry {
            on_close,
            key: options.key,
            content,
            cx,
        });
        self.layout_frame();
        if let Some(widget) = focus {
            widget.focus();
        }
    }

    /// While a dialog is open: focuses `widget` once the last dialog closes, instead of what had focus before the
    /// first opened (a prompt that shows again under a dialog reclaims focus afterwards).
    pub fn refocus(&self, widget: &impl Widget) {
        if !self.0.stack.borrow().is_empty() {
            *self.0.focus.borrow_mut() = Some(widget.as_any());
        }
    }

    /// Closes every dialog, calling their close handlers (TS `clear`).
    pub fn clear(&self) {
        self.close_all();
        self.0.size.set(DialogSize::Medium);
        self.0.centered.set(false);
        self.finish();
    }

    /// Closes the top dialog, as Escape does.
    pub fn pop(&self) {
        let entry = self.0.stack.borrow_mut().pop();
        if let Some(entry) = entry {
            close(entry);
        }
        self.finish();
    }

    fn close_all(&self) {
        let entries = std::mem::take(&mut *self.0.stack.borrow_mut());
        for entry in entries {
            close(entry);
        }
    }

    fn finish(&self) {
        if !self.0.stack.borrow().is_empty() {
            self.layout_frame();
            return;
        }
        if let Some(mode) = self.0.mode.borrow_mut().take() {
            mode.dispose();
        }
        self.0.backdrop.visible(false);
        let focus = self.0.focus.borrow_mut().take();
        if let Some(widget) = focus.filter(|widget| widget.is_shown()) {
            widget.focus();
        }
    }

    // Ctrl+C clears the focused editor of the top dialog before it closes the dialog.
    fn clear_editor(&self) -> bool {
        let cx = self.0.stack.borrow().last().map(|entry| entry.cx.clone());
        cx.is_some_and(|cx| cx.editors.borrow().iter().any(|clear| clear()))
    }

    fn layout_frame(&self) {
        let open = !self.0.stack.borrow().is_empty();
        let (width, height) = self.0.app.size();
        let centered = self.0.centered.get();
        self.0
            .backdrop
            .size(u32::from(width), u32::from(height))
            .justify(if centered {
                Justify::Center
            } else {
                Justify::Start
            })
            .padding_edge(
                Edge::Top,
                if centered {
                    0.0
                } else {
                    f32::from(height) / 4.0
                },
            )
            .visible(open);
        self.0
            .panel
            .width(self.0.size.get().width())
            .max_width(i32::from(width) - 2)
            .bg(self
                .0
                .theme
                .borrow()
                .surface(Surface::Dialog)
                .background
                .base);
    }

    pub fn is_open(&self) -> bool {
        !self.0.stack.borrow().is_empty()
    }

    pub fn len(&self) -> usize {
        self.0.stack.borrow().len()
    }

    pub fn is_empty(&self) -> bool {
        !self.is_open()
    }

    /// The top dialog's key.
    pub fn key(&self) -> Option<String> {
        self.0
            .stack
            .borrow()
            .last()
            .and_then(|entry| entry.key.clone())
    }

    pub fn size(&self) -> DialogSize {
        self.0.size.get()
    }

    pub fn set_size(&self, size: DialogSize) {
        self.0.size.set(size);
        self.layout_frame();
    }

    pub fn centered(&self) -> bool {
        self.0.centered.get()
    }

    pub fn set_centered(&self, centered: bool) {
        self.0.centered.set(centered);
        self.layout_frame();
    }

    /// The page theme for dialogs opened from now on.
    pub fn set_theme(&self, theme: Theme) {
        *self.0.theme.borrow_mut() = theme;
        self.layout_frame();
    }

    pub fn keymap(&self) -> &Rc<DialogKeymap> {
        &self.0.keymap
    }

    /// The host widget over the screen, for tests and for the TUI's paint order.
    pub fn host(&self) -> &View {
        &self.0.host
    }
}

fn close(entry: Entry) {
    entry.content.detach();
    for layer in entry.cx.layers.borrow_mut().drain(..) {
        layer.dispose();
    }
    entry.cx.editors.borrow_mut().clear();
    if let Some(on_close) = entry.on_close {
        on_close();
    }
}

/// What a dialog's content sees while it is built and while it is open.
pub struct DialogCx {
    pub app: App,
    pub dialogs: Dialogs,
    pub keymap: Rc<DialogKeymap>,
    /// The dialog surface of the theme (TS `useTheme().surface("dialog")`).
    pub theme: Theme,
    layers: RefCell<Vec<Disposer>>,
    editors: RefCell<Vec<Box<dyn Fn() -> bool>>>,
    focus: RefCell<Option<AnyWidget>>,
}

impl DialogCx {
    /// Registers a keymap layer for as long as the dialog is open. A layer without a mode gets [`MODAL_MODE`].
    pub fn layer(&self, mut layer: KeymapLayer<FocusId>) {
        if layer.mode.is_none() {
            layer.mode = Some(MODAL_MODE.to_owned());
        }
        match self.keymap.layer(layer) {
            Ok(disposer) => self.layers.borrow_mut().push(disposer),
            Err(error) => self.app.fail(opentui::Error::other(error)),
        }
    }

    /// Ties a disposer to the dialog's lifetime.
    pub fn on_close(&self, disposer: Disposer) {
        self.layers.borrow_mut().push(disposer);
    }

    /// Registers an editor for Ctrl+C: `clear` empties it and returns `true` when it has focus and text.
    pub fn editor(&self, clear: impl Fn() -> bool + 'static) {
        self.editors.borrow_mut().push(Box::new(clear));
    }

    /// Focuses `widget` once the dialog is on screen (TS focuses inputs on a 1 ms timer after mount).
    pub fn focus(&self, widget: &impl Widget) {
        *self.focus.borrow_mut() = Some(widget.as_any());
    }

    /// Terminal width, for layouts that narrow.
    pub fn width(&self) -> u16 {
        self.app.size().0
    }
}

/// `DialogHeader` props.
#[derive(Default)]
pub struct HeaderProps {
    pub title: String,
    /// Replaces the title text, for example with a search input.
    pub title_view: Option<AnyWidget>,
    /// The close label; `esc` by default.
    pub close_label: Option<String>,
    /// Runs when the close label is clicked; [`Dialogs::clear`] by default.
    pub on_close: Option<Rc<dyn Fn()>>,
    pub gap: Option<u32>,
    /// Muted line below the title.
    pub description: Option<String>,
}

/// `DialogHeader`.
pub fn header(cx: &DialogCx, props: HeaderProps) -> View {
    let theme = &cx.theme;
    let row = View::new(&cx.app).row().justify(Justify::SpaceBetween);
    if let Some(gap) = props.gap {
        row.gap(gap);
    }
    match props.title_view {
        Some(view) => {
            row.add(&view);
        }
        None => {
            row.add(&Text::new(&cx.app, props.title).fg(theme.text.base));
        }
    }
    let close = Text::new(&cx.app, props.close_label.as_deref().unwrap_or("esc"))
        .fg(theme.text.muted)
        .shrink(0.0);
    let dialogs = cx.dialogs.clone();
    let on_close = props.on_close;
    close.on_mouse(move |_cx, event| {
        if matches!(event.kind, MouseEventKind::Up(_)) {
            match &on_close {
                Some(on_close) => on_close(),
                None => dialogs.clear(),
            }
        }
    });
    row.add(&close);
    match props
        .description
        .filter(|description| !description.is_empty())
    {
        Some(description) => View::new(&cx.app).child(&row).child(
            &Text::new(&cx.app, description)
                .fg(theme.text.muted)
                .wrap(WrapMode::Word),
        ),
        None => row,
    }
}

/// `DialogLayout`: header, body, and footer, one blank row between each and one at the bottom, with the side
/// padding.
pub fn layout(
    cx: &DialogCx,
    header: &impl Widget,
    body: &impl Widget,
    footer: Option<FooterProps>,
) -> View {
    layout_with(cx, header, body, footer, DIALOG_INSET, 1)
}

/// [`layout`] with the side padding and the blank rows between the body and the footer (`footerGap`).
pub fn layout_with(
    cx: &DialogCx,
    header: &impl Widget,
    body: &impl Widget,
    footer: Option<FooterProps>,
    inset: u32,
    footer_gap: u32,
) -> View {
    let footer = footer.map(|props| self::footer(cx, props));
    layout_view(cx, header, body, footer.as_ref(), inset, footer_gap)
}

/// [`layout_with`] with a footer the caller built, such as a view it refills.
pub fn layout_view(
    cx: &DialogCx,
    header: &impl Widget,
    body: &impl Widget,
    footer: Option<&View>,
    inset: u32,
    footer_gap: u32,
) -> View {
    let root = View::new(&cx.app)
        .padding_x(inset)
        .padding_edge(Edge::Bottom, 1)
        .gap(1);
    root.add(header);
    let wrapper = View::new(&cx.app).child(body);
    if footer.is_some() {
        wrapper.padding_edge(Edge::Bottom, footer_gap.saturating_sub(1));
    }
    root.add(&wrapper);
    if let Some(footer) = footer {
        root.add(footer);
    }
    root
}

/// `DialogFooterAction`.
#[derive(Clone, Default)]
pub struct FooterAction {
    pub title: String,
    /// Literal key label, such as `enter`.
    pub key: Option<String>,
    /// A command whose first shortcut is shown when `key` is not set; the action hides without one.
    pub command: Option<String>,
    pub on_trigger: Option<Rc<dyn Fn()>>,
    pub disabled: bool,
    /// Overrides the title and key color.
    pub color: Option<Color>,
}

impl FooterAction {
    pub fn new(title: impl Into<String>) -> Self {
        Self {
            title: title.into(),
            ..Self::default()
        }
    }

    pub fn key(mut self, key: impl Into<String>) -> Self {
        self.key = Some(key.into());
        self
    }

    pub fn command(mut self, command: impl Into<String>) -> Self {
        self.command = Some(command.into());
        self
    }

    pub fn on_trigger(mut self, run: impl Fn() + 'static) -> Self {
        self.on_trigger = Some(Rc::new(run));
        self
    }

    pub fn disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }
}

/// `DialogFooterProps`.
#[derive(Default)]
pub struct FooterProps {
    /// Dialog-level actions on the left.
    pub secondary: Vec<FooterAction>,
    /// Actions on the selected item, or the dialog's main action, on the right.
    pub primary: Vec<FooterAction>,
    pub inset: Option<u32>,
    /// Content before the secondary actions.
    pub children: Vec<AnyWidget>,
}

/// `DialogFooter`: a raised band across the dialog, flush with its bottom, once it has anything to show. The
/// secondary group wraps instead of overlapping the primary group, which keeps its width.
pub fn footer(cx: &DialogCx, props: FooterProps) -> View {
    let theme = &cx.theme;
    let narrow = cx.width() < 60;
    let resolve = |actions: Vec<FooterAction>| -> Vec<FooterAction> {
        actions
            .into_iter()
            .filter_map(|mut action| {
                // An action with neither shows its title alone; one with a command hides without a shortcut.
                let Some(command) = action.command.as_deref().filter(|_| action.key.is_none())
                else {
                    return Some(action);
                };
                action.key = Some(cx.keymap.shortcut(command)?);
                Some(action)
            })
            .collect()
    };
    let secondary = resolve(props.secondary);
    let primary = resolve(props.primary);
    // A hidden child is content that renders nothing in TS.
    let band = !secondary.is_empty()
        || !primary.is_empty()
        || props.children.iter().any(|child| child.is_visible());
    let root = View::new(&cx.app)
        .row()
        .justify(Justify::SpaceBetween)
        .gap(2)
        .shrink(0.0);
    if band {
        // Hoverable actions carry one cell of padding on each side; the band gives that cell back so labels keep
        // their column.
        let inset = DIALOG_INSET + props.inset.unwrap_or(0) - 1;
        root.margin_edge(Edge::Left, -(DIALOG_INSET as i32))
            .margin_edge(Edge::Right, -(DIALOG_INSET as i32))
            .margin_edge(Edge::Bottom, -1)
            .padding_x(inset)
            .padding_y(1)
            .bg(theme.background.raised.high);
    } else if let Some(inset) = props.inset {
        root.padding_x(inset);
    }
    let left = View::new(&cx.app)
        .direction(if narrow {
            FlexDirection::Column
        } else {
            FlexDirection::Row
        })
        .flex_wrap(Wrap::Wrap)
        .shrink(1.0)
        .min_width(0);
    if !narrow {
        left.column_gap(1);
    }
    for child in &props.children {
        left.add(child);
    }
    for action in secondary {
        left.add(&footer_item(cx, action, false));
    }
    let right = View::new(&cx.app).row().gap(1).shrink(0.0);
    for action in primary {
        right.add(&footer_item(cx, action, true));
    }
    root.child(&left).child(&right)
}

fn footer_item(cx: &DialogCx, action: FooterAction, primary: bool) -> AnyWidget {
    let theme = &cx.theme;
    let disabled = theme.text.action.primary.disabled;
    let title_fg = if action.disabled {
        disabled
    } else {
        action.color.unwrap_or(theme.text.base)
    };
    let mut spans = vec![action.title.clone().fg(title_fg)];
    if let Some(key) = &action.key {
        let key_fg = if action.disabled {
            disabled
        } else {
            action.color.unwrap_or(theme.text.muted)
        };
        spans.push(format!(" {key}").fg(key_fg));
    }
    let text = Text::new(&cx.app, spans);
    let item = View::new(&cx.app).padding_x(1).shrink(0.0).child(&text);
    let hovered = if primary {
        theme.background.action.primary.hovered
    } else {
        theme.background.action.secondary.hovered
    };
    let hover_item = item.clone();
    let enabled = !action.disabled;
    item.on_hover(move |_cx, over| {
        hover_item.bg(if over && enabled {
            hovered
        } else {
            Color::TRANSPARENT
        });
    });
    item.on_mouse(move |_cx, event| {
        if matches!(event.kind, MouseEventKind::Up(_))
            && !action.disabled
            && let Some(run) = &action.on_trigger
        {
            run();
        }
    });
    item.as_any()
}

/// Sends keys to the keymap before any widget, as the TUI's keymap provider does: a key the keymap handles does
/// not reach the focused widget. The keymap's focus follows the app's first, so target layers see it.
pub fn route_keys(app: &App, keymap: Rc<DialogKeymap>) -> HandlerId {
    app.on_key_capture(move |cx, key| {
        keymap.keymap().set_focus(focus_path(cx.app()));
        let result = keymap.handle_key(key);
        if result.prevent_default {
            cx.prevent_default();
        }
        if result.handled || result.stop_propagation {
            cx.stop_propagation();
        }
    })
}

/// The focused widget's id followed by its ancestors' ids, the path `Keymap::set_focus` takes.
pub fn focus_path(app: &App) -> Vec<FocusId> {
    std::iter::successors(app.focused(), |widget| widget.parent())
        .map(|widget| widget.id())
        .collect()
}
