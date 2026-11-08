//! What a plugin of the one API (O-67) returns, turned into widgets, on both paths: fences ([`Fenced`]) with the keys
//! the host mints for them, slot claims ([`Mount`] of a [`abi::Node`]), and rows ([`Line`]).

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::atomic::{AtomicU64, Ordering};

use opencode_plugin_abi::{self as abi, Fence, Fenced, Line};
use opencode_ui::theme::Theme;
use opentui::input::{MouseButton, MouseEventKind};
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::style::Color;
use opentui::widget::CodeBlock;

use crate::{CodeBlockRender, Host, SlotInput, SlotMount, Slotted, slot};

/// A slot claim's render on either path: in process it reads the host directly, over the C ABI it asks the plugin.
pub type SlotRender<H> = Rc<dyn Fn(&H, &abi::SlotInput, &abi::Changed) -> abi::Render>;

/// A mounted slot claim of the one API: the node its render returned, rendered again with each change batch, each
/// change the host pushes ([`Host::watch`]), and each wake. Its widgets are rebuilt only when the node differs. The
/// slots its node nests ([`abi::Node::Slot`]) stay mounted until then, and get each change batch it gets.
pub struct Mount<H: Host> {
    root: View,
    owner: Weak<H>,
    render: SlotRender<H>,
    /// The slot it renders in.
    path: String,
    slot_input: SlotInput,
    input: abi::SlotInput,
    /// What it shows: `None` before the first render, `Some(None)` while hidden.
    shown: RefCell<Option<Option<abi::Node>>>,
    /// The slots its node nests.
    slots: RefCell<Vec<SlotMount<H>>>,
    /// The texts its node's hover handlers change, which hold them weakly so the texts drop with the node.
    hovers: RefCell<Vec<Rc<Text>>>,
    /// Refilled with each change batch, so a batch like the one before costs no allocation.
    changed: RefCell<abi::Changed>,
    watch: RefCell<Option<Disposer>>,
}

impl<H: Host> Mount<H> {
    pub fn new(host: &H, owner: Weak<H>, path: &str, input: &SlotInput, render: SlotRender<H>) -> Rc<Self> {
        let mount = Rc::new(Self {
            root: View::new(host.app()).column().shrink(0.0).visible(false),
            owner: owner.clone(),
            render,
            path: path.to_owned(),
            slot_input: input.clone(),
            input: abi::SlotInput { session_id: input.session_id.clone() },
            shown: RefCell::new(None),
            slots: RefCell::default(),
            hovers: RefCell::default(),
            changed: RefCell::default(),
            watch: RefCell::new(None),
        });
        let weak = Rc::downgrade(&mount);
        let watch = host.watch(Rc::new(move |changed| {
            if let (Some(mount), Some(host)) = (weak.upgrade(), owner.upgrade()) {
                mount.draw(&host, changed);
            }
        }));
        *mount.watch.borrow_mut() = watch;
        mount.draw(host, &abi::Changed::everything());
        mount
    }

    pub fn draw(&self, host: &H, changed: &abi::Changed) {
        let node = match (self.render)(host, &self.input, changed) {
            abi::Render::Keep => return,
            abi::Render::Hide => None,
            abi::Render::Show(node) => Some(node),
        };
        if self.shown.borrow().as_ref() == Some(&node) {
            return;
        }
        self.root.clear();
        let mut slots = Vec::new();
        let mut hovers = Vec::new();
        if let Some(node) = &node {
            let owner = self.owner.clone();
            let act: Act = Rc::new(move |action| act(&owner, action));
            add(host.app(), &host.theme(), &self.root, node, &act, &mut hovers, &mut |parent, path| {
                if !nests(&self.path, path) {
                    log::warn!("a claim in slot {} cannot show slot {path}: it is not a slot inside it", self.path);
                    return;
                }
                slots.extend(host.slot(parent, path, &self.slot_input));
            });
        }
        *self.slots.borrow_mut() = slots;
        *self.hovers.borrow_mut() = hovers;
        self.root.visible(node.is_some());
        *self.shown.borrow_mut() = Some(node);
        host.app().request_redraw();
    }
}

/// Whether a claim in slot `path` may show slot `nested`: a published slot inside it.
fn nests(path: &str, nested: &str) -> bool {
    slot::PATHS.contains(&nested) && slot::contains(path, nested)
}

impl<H: Host> Slotted<H> for Rc<Mount<H>> {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, host: &H, changes: &H::Changes) {
        if H::unchanged(changes) {
            return;
        }
        let mut changed = self.changed.take();
        H::changed(changes, &mut changed);
        self.draw(host, &changed);
        self.changed.replace(changed);
        self.slots.borrow().iter().for_each(|slots| slots.sync(host, changes));
    }
}

/// Sets `list` to `items` through `set`, reusing its elements, so a host that refills one [`abi::Changed`] with a
/// batch like the last one allocates nothing.
pub fn refill<T: Default, I>(list: &mut Vec<T>, items: impl IntoIterator<Item = I>, mut set: impl FnMut(&mut T, I)) {
    let mut len = 0;
    for item in items {
        if len == list.len() {
            list.push(T::default());
        }
        set(&mut list[len], item);
        len += 1;
    }
    list.truncate(len);
}

/// Sets `text` to `value`, keeping its buffer.
pub fn assign(text: &mut String, value: &str) {
    text.clear();
    text.push_str(value);
}

/// What runs a node's click: the host's side of an [`abi::Action`].
pub type Act = Rc<dyn Fn(&abi::Action)>;

/// Runs `action` on `host` once the event that caused it is handled, outside every plugin callback.
fn act<H: Host>(host: &Weak<H>, action: &abi::Action) {
    let Some(strong) = host.upgrade() else { return };
    let (host, action) = (host.clone(), action.clone());
    strong.app().defer(move |_| {
        let Some(host) = host.upgrade() else { return };
        match action {
            abi::Action::Command { name, input } => host.dispatch(&name, input.as_deref()),
        }
    });
}

/// Adds the widgets of `node` to `parent`; a click runs through `act`, and `slot` mounts a nested slot straight into
/// the parent, as TS's `<Slot>` fragment does. A text that changes on hover goes into `hovers`, whose owner keeps it
/// for its hover handler until the widgets are replaced.
pub fn add(
    app: &App,
    theme: &Theme,
    parent: &View,
    node: &abi::Node,
    act: &Act,
    hovers: &mut Vec<Rc<Text>>,
    slot: &mut dyn FnMut(&View, &str),
) {
    match node {
        abi::Node::Slot { path } => slot(parent, path),
        abi::Node::Box { row, gap, padding, justify, bg, layout, on_click, children } => {
            let view = View::new(app);
            if *row {
                view.row();
            }
            if *gap > 0 {
                view.gap(*gap);
            }
            if padding.0 > 0 {
                view.padding_x(padding.0);
            }
            if padding.1 > 0 {
                view.padding_y(padding.1);
            }
            match justify {
                abi::Justify::Start => {}
                abi::Justify::End => drop(view.justify(Justify::End)),
                abi::Justify::Center => drop(view.justify(Justify::Center)),
                abi::Justify::SpaceBetween => drop(view.justify(Justify::SpaceBetween)),
            }
            if let Some(bg) = color(theme, bg.as_ref()) {
                view.bg(bg);
            }
            for child in children {
                add(app, theme, &view, child, act, hovers, slot);
            }
            clickable(&view, on_click.as_ref(), act);
            parent.add(&lay_out(&view, layout));
        }
        abi::Node::Text { spans, fg, wrap, truncate, selectable, hover_fg, layout, on_click } => {
            let fg = color(theme, fg.as_ref()).unwrap_or(theme.text.base);
            // Spans without a color of their own take the text's, which a hover changes.
            let text = Text::new(app, spans.iter().map(|span| styled(theme, span, None)).collect::<Vec<_>>())
                .fg(fg)
                .wrap(match wrap {
                    abi::Wrap::Word => WrapMode::Word,
                    abi::Wrap::Char => WrapMode::Char,
                    abi::Wrap::None => WrapMode::None,
                })
                .truncate(*truncate)
                .selectable(*selectable);
            if let Some(hover) = color(theme, hover_fg.as_ref()) {
                // The text owns its handler, so the handler holding the text would keep both alive once replaced.
                let held = Rc::new(text.clone());
                let this = Rc::downgrade(&held);
                hovers.push(held);
                text.on_hover(move |cx, hovered| {
                    if let Some(this) = this.upgrade() {
                        this.fg(if hovered { hover } else { fg });
                        cx.app().request_redraw();
                    }
                });
            }
            clickable(&text, on_click.as_ref(), act);
            parent.add(&lay_out(&text, layout));
        }
    }
}

/// Shows the hand over `widget` and runs `click` on the press or the release of the left button.
fn clickable(widget: &impl Widget, click: Option<&abi::Click>, act: &Act) {
    let Some(click) = click.cloned() else { return };
    let act = act.clone();
    widget.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        let hit = match event.kind {
            MouseEventKind::Down(MouseButton::Left) => click.on == abi::Press::Down,
            MouseEventKind::Up(MouseButton::Left) => click.on == abi::Press::Up,
            _ => false,
        };
        if hit {
            act(&click.action);
        }
    });
}

fn lay_out<W: Widget>(widget: &W, layout: &abi::Layout) -> W {
    match layout.width {
        Some(abi::Width::Cells(cells)) => drop(widget.width(cells)),
        Some(abi::Width::Percent(percent)) => drop(widget.width(Length::percent(percent))),
        None => {}
    }
    if layout.grow {
        widget.grow(1.0).basis(Length::Auto);
    }
    if let Some(shrink) = layout.shrink {
        widget.shrink(if shrink { 1.0 } else { 0.0 });
    }
    if layout.min_width_zero {
        widget.min_width(0);
    }
    widget.clone()
}

/// `span` styled in `theme`, in `fg` without a color of its own.
fn styled(theme: &Theme, span: &abi::Span, fg: Option<Color>) -> Span<'static> {
    let mut attributes = Attributes::NONE;
    for (set, attribute) in [
        (span.bold, Attributes::BOLD),
        (span.italic, Attributes::ITALIC),
        (span.underline, Attributes::UNDERLINE),
        (span.dim, Attributes::DIM),
        (span.strikethrough, Attributes::STRIKETHROUGH),
    ] {
        if set {
            attributes |= attribute;
        }
    }
    let mut style = Style::new();
    if let Some(fg) = color(theme, span.fg.as_ref()).or(fg) {
        style = style.fg(fg);
    }
    if let Some(bg) = color(theme, span.bg.as_ref()) {
        style = style.bg(bg);
    }
    Span::styled(span.text.clone(), Style { attributes, ..style })
}

/// One fence registration's keys, by the ID of the widget that shows the block. A key moves to the widget that
/// replaces its block's widget, so it stays the same while the block streams.
#[derive(Default)]
pub struct Fences {
    keys: RefCell<HashMap<u32, u64>>,
}

impl Fences {
    /// Renders `block` through `render`, which gets the block with its key.
    pub fn render(
        &self,
        block: &CodeBlock<'_>,
        theme: &Theme,
        render: impl FnOnce(Fence) -> Fenced,
    ) -> Option<AnyWidget> {
        // Keys are unique across registrations, so a plugin that renders several languages keeps one map.
        static NEXT: AtomicU64 = AtomicU64::new(1);
        let previous = block.previous.map(Widget::id);
        let key = previous
            .and_then(|id| self.keys.borrow_mut().remove(&id))
            .unwrap_or_else(|| NEXT.fetch_add(1, Ordering::Relaxed));
        let fence = Fence {
            language: block.language.to_owned(),
            info: block.info.to_owned(),
            code: block.code.to_owned(),
            streaming: block.streaming,
            closed: block.closed,
            key,
            width: block.app.size().0,
        };
        let widget = match render(fence) {
            Fenced::Code => return None,
            Fenced::Keep => block.previous?.clone(),
            Fenced::Lines { lines, fg, drag } => {
                let scroll = if drag { Scroll::Drag } else { Scroll::Wheel };
                lines_widget(block.app, theme, &lines, fg.as_ref(), scroll)
            }
        };
        self.keys.borrow_mut().insert(widget.id(), key);
        Some(widget)
    }
}

/// The code-block render of fence render `render` run in process, reading through `host`.
pub fn code_block<H: Host>(host: Weak<H>, render: abi::FenceFn) -> CodeBlockRender {
    let fences = Fences::default();
    Rc::new(move |block, theme| {
        let mode = host.upgrade().map_or(ThemeMode::Dark, |host| host.theme_mode());
        fences.render(block, theme, |fence| render(&Reader::new(theme, mode), &fence))
    })
}

/// The host as a render reads it in process: the theme it draws in, and the theme's mode.
pub struct Reader<'a> {
    theme: &'a Theme,
    mode: ThemeMode,
}

impl<'a> Reader<'a> {
    pub fn new(theme: &'a Theme, mode: ThemeMode) -> Self {
        Self { theme, mode }
    }
}

impl abi::Read for Reader<'_> {
    fn theme_mode(&self) -> abi::ThemeMode {
        match self.mode {
            ThemeMode::Light => abi::ThemeMode::Light,
            _ => abi::ThemeMode::Dark,
        }
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        theme_color(self.theme, token)
    }
}

/// [`abi::Read::color`] on both paths.
pub fn theme_color(theme: &Theme, token: &str) -> Option<abi::Rgba> {
    resolve(theme, token).map(|color| abi::Rgba::new(color.r, color.g, color.b, color.a))
}

/// How a block of rows scrolls when it is wider than its place.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scroll {
    /// Not at all: a slot claim or a route.
    None,
    /// Sideways on a horizontal wheel.
    Wheel,
    /// Sideways under a left drag; a horizontal wheel stops here (TS Mermaid's `StaticDiagramRenderable`).
    Drag,
}

/// Rows of spans as one no-wrap text. `fg` draws spans without their own; by default `text.base`.
pub fn lines_widget(app: &App, theme: &Theme, lines: &[Line], fg: Option<&abi::Color>, scroll: Scroll) -> AnyWidget {
    let width = lines
        .iter()
        .map(|line| line.iter().map(|span| unicode_width::UnicodeWidthStr::width(span.text.as_str())).sum::<usize>())
        .max()
        .unwrap_or(0);
    let fg = color(theme, fg);
    let base = fg.unwrap_or(theme.text.base);
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            spans.push(Span::styled("\n", Style::new().fg(base)));
        }
        spans.extend(line.iter().map(|span| styled(theme, span, Some(base))));
    }
    let text = Text::new(app, spans).width(Length::percent(100.0)).wrap(WrapMode::None).selectable(false);
    let text = match fg {
        Some(fg) => text.fg(fg),
        None => text,
    };
    // A diagram may have no rows; a fence of the other kinds keeps one.
    if scroll == Scroll::Drag {
        return drag(app, text.height(lines.len() as f32), lines.len() as f32, width as f64).as_any();
    }
    let height = lines.len().max(1) as f32;
    let text = text.min_width(width as f32).height(height).shrink(0.0);
    if scroll == Scroll::None {
        return text.as_any();
    }
    ScrollBox::new(app)
        .width(Length::percent(100.0))
        .height(height)
        .shrink(0.0)
        .axes(true, false)
        .scrollbars(false)
        .child(&text)
        .as_any()
}

/// `text`, `height` rows high and `content_width` columns wide, scrolled sideways by a left drag. A view of its size
/// around it owns the handler, since a handler the text owned would keep the text alive once its block is replaced.
fn drag(app: &App, text: Text, height: f32, content_width: f64) -> View {
    let start: Rc<Cell<Option<u16>>> = Rc::default();
    let scroll = Rc::new(Cell::new(0.0));
    let this = text.clone();
    let view = View::new(app).width(Length::percent(100.0)).height(height).child(&text);
    view.on_mouse(move |cx, event| match event.kind {
        MouseEventKind::Down(MouseButton::Left) => {
            cx.app().clear_selection();
            start.set(Some(event.x));
            cx.prevent_default();
            cx.stop_propagation();
        }
        MouseEventKind::Drag(MouseButton::Left) => {
            cx.prevent_default();
            cx.stop_propagation();
            let Some(from) = start.get() else {
                return;
            };
            start.set(Some(event.x));
            let dx = f64::from(event.x) - f64::from(from);
            let max = (content_width - f64::from(this.rect().width)).max(0.0);
            let next = (scroll.get() - dx).clamp(0.0, max);
            if next != scroll.get() {
                scroll.set(next);
                this.scroll_to(next, 0.0);
            }
        }
        MouseEventKind::Up(MouseButton::Left) => {
            start.set(None);
            cx.prevent_default();
            cx.stop_propagation();
        }
        MouseEventKind::ScrollLeft | MouseEventKind::ScrollRight => {
            cx.prevent_default();
            cx.stop_propagation();
        }
        _ => {}
    })
}

/// A theme token path, a scale step (`categorical.3.300`, `interactive.500`), or `#rrggbb[aa]`.
fn resolve(theme: &Theme, token: &str) -> Option<Color> {
    if let Some(rgba) = abi::Rgba::parse(token) {
        return Some(Color::rgba(rgba.r, rgba.g, rgba.b, rgba.a));
    }
    if let Some(color) = theme.get(token) {
        return Some(*color);
    }
    let (scale, step) = token.rsplit_once('.')?;
    let step = step.parse().ok()?;
    let scale = match scale.strip_prefix("categorical.") {
        Some(index) => theme.categorical().get(index.parse::<usize>().ok()?)?,
        None => theme.hue(scale)?,
    };
    Some(scale.step(step))
}

fn color(theme: &Theme, value: Option<&abi::Color>) -> Option<Color> {
    match value? {
        abi::Color::Rgba(rgba) => Some(Color::rgba(rgba.r, rgba.g, rgba.b, rgba.a)),
        abi::Color::Token(token) => resolve(theme, token),
    }
}
