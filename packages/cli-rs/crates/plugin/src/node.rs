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

use crate::{Claimed, Host, SlotInput, SlotMount, slot};

/// A slot claim's render on either path: in process it reads the host directly, over the C ABI it asks the plugin.
pub(crate) type SlotRender = Rc<dyn Fn(&dyn Host, &abi::SlotInput, &abi::Changed) -> abi::Render>;
/// A slot claim's mount handler on either path: `true` as a claim mounts, before its first render, `false` as it goes.
pub(crate) type MountFn = Rc<dyn Fn(&dyn Host, &abi::SlotInput, bool)>;

/// A mounted slot claim of the one API: the node its render returned, rendered again with each change batch, each
/// change the host pushes ([`Host::watch`]), and each wake. Its widgets are rebuilt only when the node differs. The
/// slots its node nests ([`abi::Node::Slot`]) stay mounted until then, and get each change batch it gets.
pub(crate) struct Mount {
    root: View,
    owner: Weak<dyn Host>,
    render: SlotRender,
    mount: Option<MountFn>,
    /// The slot it renders in.
    path: String,
    slot_input: SlotInput,
    input: abi::SlotInput,
    /// What it shows: `None` before the first render, `Some(None)` while hidden.
    shown: RefCell<Option<Option<abi::Node>>>,
    /// The slots its node nests.
    slots: RefCell<Vec<SlotMount>>,
    /// The texts its node's hover handlers change, which hold them weakly so the texts drop with the node.
    hovers: RefCell<Vec<Rc<Text>>>,
    watch: RefCell<Option<Disposer>>,
}

impl Mount {
    pub fn new(
        host: &dyn Host,
        owner: Weak<dyn Host>,
        path: &str,
        slot_input: &SlotInput,
        render: SlotRender,
        on_mount: Option<MountFn>,
    ) -> Rc<Self> {
        let input = abi::SlotInput {
            session_id: slot_input.session_id.clone(),
            prompt: slot_input
                .prompt
                .as_ref()
                .map(|prompt| abi::PromptInput { shell: prompt.shell, show_details: prompt.show_details }),
        };
        if let Some(on_mount) = &on_mount {
            on_mount(host, &input, true);
        }
        let mount = Rc::new(Self {
            root: View::new(host.app()).column().shrink(0.0).visible(false),
            owner: owner.clone(),
            render,
            mount: on_mount,
            path: path.to_owned(),
            slot_input: slot_input.clone(),
            input,
            shown: RefCell::new(None),
            slots: RefCell::default(),
            hovers: RefCell::default(),
            watch: RefCell::new(None),
        });
        let weak = Rc::downgrade(&mount);
        let watch = host.watch(Rc::new(move |changed| {
            if let (Some(mount), Some(host)) = (weak.upgrade(), owner.upgrade()) {
                mount.draw(&*host, changed);
            }
        }));
        *mount.watch.borrow_mut() = watch;
        mount.draw(host, &abi::Changed::everything());
        mount
    }

    pub fn draw(&self, host: &dyn Host, changed: &abi::Changed) {
        let node = match (self.render)(host, &self.input, changed) {
            abi::Render::Keep => return,
            abi::Render::Hide => None,
            abi::Render::Show(node) => Some(node),
        };
        if self.shown.borrow().as_ref() == Some(&node) {
            return;
        }
        self.root.clear();
        // TS's `<Slot>` is a fragment, so the node's own layout places it in the slot's parent: the root takes it, and
        // the node fills the root, which stretches it across. Each draw starts the root's layout over, so nothing of an
        // earlier node's stays.
        self.root
            .width(Length::Auto)
            .grow(0.0)
            .shrink(0.0)
            .min_width(Length::Undefined)
            .height(Length::Auto)
            .min_height(Length::Undefined)
            .max_height(Length::Undefined);
        [Edge::Top, Edge::Right, Edge::Bottom, Edge::Left]
            .into_iter()
            .for_each(|edge| drop(self.root.margin_edge(edge, 0)));
        let mut slots = Vec::new();
        let mut hovers = Vec::new();
        if let Some(node) = &node {
            let mut inner = node.clone();
            if let abi::Node::Box { layout, .. } | abi::Node::Text { layout, .. } = &mut inner {
                lay_out(&self.root, layout);
                layout.width = None;
                layout.grow = false;
                layout.margin = None;
                // The root takes the heights too, so a percent is of the slot's parent once; the node fills the root's
                // height, and with a maximum it may shrink below its content to the root's.
                let (sized, capped) =
                    (layout.height.is_some() || layout.min_height.is_some(), layout.max_height.is_some());
                (layout.height, layout.min_height, layout.max_height) = (None, None, None);
                if sized {
                    layout.grow = true;
                }
                if capped {
                    layout.shrink = Some(true);
                    layout.min_height = Some(abi::Width::Cells(0));
                }
            }
            let owner = self.owner.clone();
            let act: Act = Rc::new(move |action| act(&owner, action));
            let markdown = |text: &str| host.markdown(text);
            add(host.app(), &host.theme(), &self.root, &inner, &act, &mut hovers, &markdown, &mut |parent, path| {
                if !nests(&self.path, path) {
                    log::warn!("a claim in slot {} cannot show slot {path}: it is not a slot inside it", self.path);
                    return;
                }
                slots.extend(host.slot(parent, path, &self.slot_input));
            });
        }
        let dropped = self.slots.replace(slots);
        let live = dropped.iter().chain(self.slots.borrow().iter()).find_map(|slot| slot.live().cloned());
        drop(dropped);
        *self.hovers.borrow_mut() = hovers;
        self.root.visible(node.is_some());
        *self.shown.borrow_mut() = Some(node);
        // The slots it nests may have mounted or gone, which moves the claims that degrade onto their ancestors.
        if let Some(live) = live {
            crate::settle(host, &live);
        }
        host.app().request_redraw();
    }
}

impl Drop for Mount {
    fn drop(&mut self) {
        if let (Some(on_mount), Some(host)) = (&self.mount, self.owner.upgrade()) {
            on_mount(&*host, &self.input, false);
        }
    }
}

/// Whether a claim in slot `path` may show slot `nested`: a published slot inside it.
fn nests(path: &str, nested: &str) -> bool {
    slot::PATHS.contains(&nested) && slot::contains(path, nested)
}

impl Claimed for Rc<Mount> {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, host: &dyn Host, changed: &abi::Changed) {
        self.draw(host, changed);
        self.slots.borrow().iter().for_each(|slots| slots.sync(host, Some(changed)));
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
fn act(host: &Weak<dyn Host>, action: &abi::Action) {
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
/// for its hover handler until the widgets are replaced. `markdown` draws [`abi::Node::Markdown`].
#[allow(clippy::too_many_arguments)]
pub fn add(
    app: &App,
    theme: &Theme,
    parent: &View,
    node: &abi::Node,
    act: &Act,
    hovers: &mut Vec<Rc<Text>>,
    markdown: &dyn Fn(&str) -> AnyWidget,
    slot: &mut dyn FnMut(&View, &str),
) {
    match node {
        abi::Node::Slot { path } => slot(parent, path),
        abi::Node::Markdown { text } => drop(parent.add(&markdown(text))),
        abi::Node::Spinner { label } => {
            let spinner = opencode_ui::motion::Spinner::new(app).color(theme.interactive().step(200)).label(label);
            parent.add(&spinner);
        }
        abi::Node::Box {
            row,
            gap,
            padding,
            justify,
            align,
            bg,
            layout,
            on_click,
            children,
            border,
            padding_sides,
            wrap,
            overflow,
        } => {
            let view = View::new(app);
            if *row {
                view.row();
            }
            if *gap > 0 {
                view.gap(*gap);
            }
            match padding_sides {
                Some(edges) => {
                    for (edge, cells) in edges_of(edges) {
                        view.padding_edge(edge, cells.max(0));
                    }
                }
                None => {
                    if padding.0 > 0 {
                        view.padding_x(padding.0);
                    }
                    if padding.1 > 0 {
                        view.padding_y(padding.1);
                    }
                }
            }
            if let Some(border) = border {
                bordered(&view, theme, border);
            }
            if *wrap {
                view.flex_wrap(Wrap::Wrap);
            }
            if *overflow == abi::Overflow::Hidden {
                view.overflow(Overflow::Hidden);
            }
            match justify {
                abi::Justify::Start => {}
                abi::Justify::End => drop(view.justify(Justify::End)),
                abi::Justify::Center => drop(view.justify(Justify::Center)),
                abi::Justify::SpaceBetween => drop(view.justify(Justify::SpaceBetween)),
                abi::Justify::SpaceAround => drop(view.justify(Justify::SpaceAround)),
            }
            match align {
                abi::Align::Stretch => {}
                abi::Align::Start => drop(view.align_items(Align::Start)),
                abi::Align::Center => drop(view.align_items(Align::Center)),
                abi::Align::End => drop(view.align_items(Align::End)),
            }
            if let Some(bg) = color(theme, bg.as_ref()) {
                view.bg(bg);
            }
            for child in children {
                add(app, theme, &view, child, act, hovers, markdown, slot);
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
    if let Some(height) = layout.height {
        widget.height(length(height));
    }
    if let Some(height) = layout.min_height {
        widget.min_height(length(height));
    }
    if let Some(height) = layout.max_height {
        widget.max_height(length(height));
    }
    if let Some(margin) = &layout.margin {
        for (edge, cells) in edges_of(margin) {
            if cells != 0 {
                widget.margin_edge(edge, cells);
            }
        }
    }
    widget.clone()
}

fn length(value: abi::Width) -> Length {
    match value {
        abi::Width::Cells(cells) => Length::from(cells),
        abi::Width::Percent(percent) => Length::percent(percent),
    }
}

/// The cells of `edges` at each of OpenTUI's edges.
fn edges_of(edges: &abi::Edges) -> [(Edge, i16); 4] {
    [(Edge::Top, edges.top), (Edge::Right, edges.right), (Edge::Bottom, edges.bottom), (Edge::Left, edges.left)]
}

/// Draws `border` on `view`, as TS's `<box border>` draws it: white without a color, and the title in its color.
fn bordered(view: &View, theme: &Theme, border: &abi::Border) {
    let sides = [
        (border.sides.top, Sides::TOP),
        (border.sides.right, Sides::RIGHT),
        (border.sides.bottom, Sides::BOTTOM),
        (border.sides.left, Sides::LEFT),
    ]
    .into_iter()
    .filter(|(set, _)| *set)
    .fold(Sides::NONE, |sides, (_, side)| sides.union(side));
    view.border(match border.style {
        abi::BorderStyle::Single => BorderStyle::Single,
        abi::BorderStyle::Double => BorderStyle::Double,
        abi::BorderStyle::Rounded => BorderStyle::Rounded,
        abi::BorderStyle::Heavy => BorderStyle::Heavy,
    })
    .border_sides(sides)
    .border_color(color(theme, border.color.as_ref()).unwrap_or(Color::rgb(255, 255, 255)));
    if let Some(title) = &border.title {
        // OpenTUI refuses a longer title with an error that ends the TUI; no title that long fits a row anyway.
        let title = &title[..title.floor_char_boundary(opentui::sys::OT_BUFFER_TEXT_BYTES_MAX as usize)];
        view.title(title).title_alignment(match border.title_align {
            abi::TitleAlign::Left => Alignment::Left,
            abi::TitleAlign::Center => Alignment::Center,
            abi::TitleAlign::Right => Alignment::Right,
        });
    }
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

/// What hears of each fence key that goes: the plugin's [`abi::Setup::on_fence_gone`] handlers.
pub type Gone = Rc<dyn Fn(u64)>;

/// One fence registration's keys, by the ID of the widget that shows the block. A key moves to the widget that
/// replaces its block's widget, so it stays the same while the block streams, and goes when that widget is freed or
/// the block falls back to the code view. Only a key whose output was shown goes, once.
#[derive(Default)]
pub struct Fences {
    keys: Rc<RefCell<HashMap<u32, u64>>>,
    gone: Option<Gone>,
}

/// Removes a widget's key once the widget, whose handler holds it, is freed.
struct Forget {
    keys: Weak<RefCell<HashMap<u32, u64>>>,
    id: u32,
    gone: Option<Gone>,
}

impl Drop for Forget {
    fn drop(&mut self) {
        let key = self.keys.upgrade().and_then(|keys| keys.try_borrow_mut().ok()?.remove(&self.id));
        if let (Some(key), Some(gone)) = (key, &self.gone) {
            gone(key);
        }
    }
}

impl Fences {
    /// The keys of a registration whose plugin hears of each key that goes through `gone`.
    pub fn new(gone: Option<Gone>) -> Self {
        Self { keys: Rc::default(), gone }
    }

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
        // The key of plugin output the block shows now, which goes if this render shows none.
        let shown = previous.and_then(|id| self.keys.borrow_mut().remove(&id));
        let key = shown.unwrap_or_else(|| NEXT.fetch_add(1, Ordering::Relaxed));
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
            Fenced::Code => None,
            Fenced::Keep => block.previous.cloned(),
            Fenced::Lines { lines, fg, drag } => {
                let scroll = if drag { Scroll::Drag } else { Scroll::Wheel };
                let widget = lines_widget(block.app, theme, &lines, fg.as_ref(), scroll);
                // A focus handler, which never runs on these rows, is what drops with the widget.
                let forget = Forget { keys: Rc::downgrade(&self.keys), id: widget.id(), gone: self.gone.clone() };
                widget.on_focus(move |_, _| {
                    let _ = &forget;
                });
                Some(widget)
            }
        };
        let Some(widget) = widget else {
            // Once per key: a block that stays in the code view gets a fresh key each render, which nothing showed.
            if let (Some(key), Some(gone)) = (shown, &self.gone) {
                gone(key);
            }
            return None;
        };
        self.keys.borrow_mut().insert(widget.id(), key);
        Some(widget)
    }
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
        abi_mode(self.mode)
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        theme_color(self.theme, token)
    }
}

/// [`abi::Read::theme_mode`] on both paths.
pub fn abi_mode(mode: ThemeMode) -> abi::ThemeMode {
    match mode {
        ThemeMode::Light => abi::ThemeMode::Light,
        _ => abi::ThemeMode::Dark,
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
            let Some(from) = start.get() else { return };
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

/// `color` in `theme`; `None` for a token the theme does not have.
pub fn color_of(theme: &Theme, color: &abi::Color) -> Option<Color> {
    self::color(theme, Some(color))
}

fn color(theme: &Theme, value: Option<&abi::Color>) -> Option<Color> {
    match value? {
        abi::Color::Rgba(rgba) => Some(Color::rgba(rgba.r, rgba.g, rgba.b, rgba.a)),
        abi::Color::Token(token) => resolve(theme, token),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_ui::theme::{Catalog, ThemeMode};
    use opentui::testing::TestApp;

    // Expected: what the 1.5 properties of a box do, read from a fresh layout's rects and cells: a border without a
    // color is white and takes a cell on each side it draws; a negative padding counts as 0; a negative margin moves
    // the box over its neighbor; a height, its minimum and its maximum bound the height its children ask for; and a
    // box that hides its overflow does not draw what is past its height.
    #[test]
    fn a_box_lays_out_its_1_5_properties() {
        let app = TestApp::new(30, 12);
        let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
        let rows = |count: usize| (0..count).map(|_| abi::Node::text([abi::Span::new("x")])).collect::<Vec<_>>();
        // The box's rect, its first child's, and the cell at the box's top left corner.
        let draw = |node: abi::Node| {
            let parent = View::new(app.app()).row();
            parent.add(&Text::new(app.app(), "ab"));
            add(
                app.app(),
                &theme,
                &parent,
                &node,
                &(Rc::new(|_: &abi::Action| {}) as Act),
                &mut Vec::new(),
                &|_| View::new(app.app()).as_any(),
                &mut |_, _| {},
            );
            app.app().root().clear();
            app.app().root().add(&parent);
            let capture = app.render();
            let boxed = parent.children()[1].rect();
            // Where the box's first `x` is.
            let child = (0..capture.height)
                .flat_map(|y| (0..capture.width).map(move |x| (x, y)))
                .find(|(x, y)| capture.cell(*x, *y).is_some_and(|cell| cell.symbol == "x"));
            let corner = capture.cell(boxed.screen_x as u32, boxed.screen_y as u32).cloned().unwrap();
            let drawn = capture.cells.iter().filter(|cell| cell.symbol == "x").count();
            (boxed, child, corner, drawn)
        };
        let (plain, plain_child, _, _) = draw(abi::Node::column(rows(1)));
        let (bordered, child, corner, _) = draw(abi::Node::column(rows(1)).border(abi::Border::new()));
        assert_eq!((corner.symbol.as_str(), corner.fg), ("┌", Color::rgb(255, 255, 255)));
        assert_eq!((bordered.width, bordered.height), (plain.width + 2.0, plain.height + 2.0));
        assert_eq!(child, Some((bordered.screen_x as u32 + 1, bordered.screen_y as u32 + 1)));
        let left = abi::Border::new().sides(abi::Sides { left: true, ..abi::Sides::NONE });
        let (ruled, _, corner, _) = draw(abi::Node::column(rows(1)).border(left));
        assert_eq!((ruled.width, ruled.height, corner.symbol.as_str()), (plain.width + 1.0, plain.height, "│"));
        let (_, padded, _, _) = draw(abi::Node::column(rows(1)).padding_sides(abi::Edges::all(-2)));
        assert_eq!(padded, plain_child);
        let shifted = abi::Layout::default().margin(abi::Edges::new(0, 0, 0, -1));
        let (moved, _, _, _) = draw(abi::Node::column(rows(1)).layout(shifted));
        assert_eq!(moved.screen_x, plain.screen_x - 1.0);
        let at_least = abi::Layout::default().min_height(abi::Width::Cells(4));
        assert_eq!(draw(abi::Node::column(rows(1)).layout(at_least)).0.height, 4.0);
        let at_most = abi::Layout::default().max_height(abi::Width::Cells(2));
        assert_eq!(draw(abi::Node::column(rows(5)).overflow(abi::Overflow::Hidden).layout(at_most)).0.height, 2.0);
        assert_eq!(draw(abi::Node::column(rows(5))).0.height, 5.0);
        let fixed = abi::Layout::default().height(abi::Width::Cells(3));
        assert_eq!(draw(abi::Node::column(rows(1)).layout(fixed)).0.height, 3.0);
        // A box one row high with two rows in it draws the second below itself, unless it hides what overflows.
        let low = abi::Layout::default().height(abi::Width::Cells(1));
        let rigid = || rows(2).into_iter().map(|row| row.layout(abi::Layout::default().shrink(false))).collect();
        assert_eq!(draw(abi::Node::column(rigid()).layout(low)).3, 2);
        assert_eq!(draw(abi::Node::column(rigid()).overflow(abi::Overflow::Hidden).layout(low)).3, 1);
        // A title past OpenTUI's limit for a box's titles is cut, at a character, and the frame still renders.
        let long = format!("{}é", "t".repeat(opentui::sys::OT_BUFFER_TEXT_BYTES_MAX as usize - 1));
        let (_, _, corner, _) = draw(abi::Node::column(rows(1)).border(abi::Border::new().title(long)));
        assert_eq!(corner.symbol.as_str(), "┌");
    }

    // Expected: a fence's key moves to the widget that replaces its block's widget, and goes once that widget is
    // freed, as when its Markdown is destroyed, or once the block falls back to the code view; the plugin hears of
    // each key that goes, once.
    #[test]
    fn a_fence_key_goes_with_its_widget() {
        let app = TestApp::new(40, 10);
        let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
        let gone = Rc::new(RefCell::new(Vec::new()));
        let fences = Fences::new(Some({
            let gone = gone.clone();
            Rc::new(move |key| gone.borrow_mut().push(key))
        }));
        fn block<'a>(app: &'a App, previous: Option<&'a AnyWidget>) -> CodeBlock<'a> {
            CodeBlock {
                app,
                language: "x",
                info: "x",
                code: "a",
                closed: true,
                conceal: true,
                streaming: false,
                previous,
            }
        }
        let lines = || Fenced::Lines { lines: vec![vec![abi::Span::new("a")]], fg: None, drag: false };
        let key = Cell::new(0);
        let first = fences.render(&block(&app, None), &theme, |fence| {
            key.set(fence.key);
            lines()
        });
        let first = first.unwrap();
        let second = fences.render(&block(&app, Some(&first)), &theme, |fence| {
            assert_eq!(fence.key, key.get());
            lines()
        });
        drop(first);
        assert_eq!(fences.keys.borrow().len(), 1);
        assert!(gone.borrow().is_empty());
        drop(second);
        assert!(fences.keys.borrow().is_empty(), "a freed widget keeps its fence key");
        assert_eq!(*gone.borrow(), [key.get()]);
        let shown = fences.render(&block(&app, None), &theme, |_| lines()).unwrap();
        let code = fences.render(&block(&app, Some(&shown)), &theme, |fence| {
            key.set(fence.key);
            Fenced::Code
        });
        assert!(code.is_none());
        assert_eq!(*gone.borrow().last().unwrap(), key.get(), "the code view kept the key");
        assert_eq!(gone.borrow().len(), 2);
        drop(shown);
        assert_eq!(gone.borrow().len(), 2);
        // A block that stays in the code view showed no output, so no key of it goes.
        for _ in 0..3 {
            assert!(fences.render(&block(&app, None), &theme, |_| Fenced::Code).is_none());
        }
        assert_eq!(gone.borrow().len(), 2);
    }
}
