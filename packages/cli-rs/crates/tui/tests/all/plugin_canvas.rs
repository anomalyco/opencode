//! Compare replayed canvas lists with an independently painted frame. Track which draws and lists are live across
//! animation, clipping, and teardown.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::canvas::{self as list, List};
use opencode_plugin::abi::{self, v2};
use opencode_plugin::canvas::{self as host, Ledger};
use opencode_tui::{Deps, Route};
use opentui::native::BoxSpec;
use opentui::prelude::{Component, Container, Custom, Length, Painter, View, Widget};
use opentui::testing::{Capture, TestApp};

const ID: &str = "test.pad";
/// The row the canvas sits in, a color no theme has.
const BG: abi::Rgba = abi::Rgba::new(16, 32, 48, 255);
/// The text left of the canvas, which the model finds on screen.
const MARK: &str = "§";
const PLACEHOLDER: &str = "canvas over its limit";

/// A shape of the plugin's, which its draw writes as a list and the twin paints directly.
#[derive(Clone, Debug, PartialEq)]
enum Shape {
    Fill(i16, i16, u16, u16, abi::Rgba),
    Text(i16, i16, &'static str, Pen),
    Cell(i16, i16, char, Pen),
    Cells(i16, i16, u16, Vec<(char, Pen)>),
    Rect(i16, i16, u16, u16, abi::BorderStyle, abi::Rgba, Option<abi::Rgba>),
    Clip(i16, i16, u16, u16, Vec<Shape>),
}

/// A foreground or none, a background or none, and the style's bits: bold 1, dim 2, italic 4, underline 8, inverse
/// 16, strikethrough 32.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Pen(Option<abi::Rgba>, Option<abi::Rgba>, u8);

/// What the plugin's next draw returns.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Next {
    Art(u8),
    Keep,
    Over,
    Bad,
    Panic,
}

/// What one draw returned.
#[derive(Clone, Debug, PartialEq)]
enum Returned {
    Art(Vec<Shape>),
    Kept,
    Over,
    Bad,
    Panic,
}

#[derive(Clone, Debug)]
struct Drawn {
    generation: u64,
    frame: v2::Frame,
    returned: Returned,
}

struct Pad {
    shown: bool,
    size: (u16, u16),
    version: u64,
    animate: bool,
    next: Next,
    draws: Vec<Drawn>,
    views: usize,
    /// The view leaves the canvas's id out.
    unkeyed: bool,
    /// The canvas sits in a box of its own, or takes no minimum width: a move, and a layout of the same size.
    wrap: bool,
    loose: bool,
    /// The canvas has no width of its own.
    auto: bool,
    /// The columns, from the row's left, and the rows, from the canvas's bottom, that a box drawn after it covers.
    cover: (u16, u16),
    /// The generation the last view had.
    generation: u64,
}

impl Default for Pad {
    fn default() -> Self {
        Self {
            shown: true,
            size: (12, 4),
            version: 0,
            animate: false,
            next: Next::Art(0),
            draws: Vec::new(),
            views: 0,
            unkeyed: false,
            wrap: false,
            loose: false,
            auto: false,
            cover: (0, 0),
            generation: 0,
        }
    }
}

thread_local! {
    static PAD: RefCell<Pad> = RefCell::default();
}

fn pad<T>(f: impl FnOnce(&mut Pad) -> T) -> T {
    PAD.with(|pad| f(&mut pad.borrow_mut()))
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("pad.set"), |_, input| {
        let Some((key, value)) = input.and_then(|input| input.split_once('=')) else { return };
        pad(|pad| match key {
            "shown" => pad.shown = value == "1",
            "size" => {
                let (width, height) = value.split_once('x').unwrap();
                pad.size = (width.parse().unwrap(), height.parse().unwrap());
            }
            "version" => pad.version += 1,
            "animate" => pad.animate = value == "1",
            "wrap" => pad.wrap = value == "1",
            "loose" => pad.loose = value == "1",
            "cover" => {
                let (columns, rows) = value.split_once('x').unwrap();
                pad.cover = (columns.parse().unwrap(), rows.parse().unwrap());
            }
            _ => {}
        });
    });
    setup.surface(v2::Surface::new("pad", v2::Place::Route("pad".into()), view).draw(draw));
    Ok(())
}

fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let (shown, (width, height), version, animate, unkeyed, wrap, loose, auto, cover) = pad(|pad| {
        pad.views += 1;
        pad.generation = cx.mount.generation;
        (pad.shown, pad.size, pad.version, pad.animate, pad.unkeyed, pad.wrap, pad.loose, pad.auto, pad.cover)
    });
    let fixed = abi::Layout {
        width: (!auto).then_some(abi::Width::Cells(width)),
        height: Some(abi::Width::Cells(height)),
        shrink: Some(false),
        min_width: loose.then_some(abi::Width::Cells(0)),
        ..abi::Layout::default()
    };
    let mut row = vec![v2::Node::text(vec![abi::Span::new(MARK)]).layout(abi::Layout::default().shrink(false))];
    if shown {
        let canvas = v2::Node::canvas("art").version(version).animate(animate).layout(fixed);
        let canvas = if unkeyed { v2::Node::Canvas { id: None, layout: fixed, version, animate } } else { canvas };
        row.push(if wrap { v2::Node::column(vec![canvas]) } else { canvas });
    }
    let mut page = vec![v2::Node::row(row).bg(abi::Color::Rgba(BG))];
    let (columns, cover) = cover;
    if cover > 0 {
        // An opaque box that takes the pointer, drawn over the canvas's last `cover` rows and the first `columns`.
        let click = abi::Click { action: abi::Action::command("pad.set"), on: abi::Press::Down };
        page.push(
            v2::Node::row(Vec::new())
                .bg(abi::Color::Rgba(abi::Rgba::new(90, 0, 0, 255)))
                .on_click(click)
                .layout(abi::Layout {
                    width: Some(abi::Width::Cells(columns)),
                    height: Some(abi::Width::Cells(cover)),
                    margin: Some(abi::Edges { top: -(cover as i16), ..abi::Edges::default() }),
                    shrink: Some(false),
                    ..abi::Layout::default()
                })
                .with_id("cover"),
        );
    }
    v2::Node::column(page).with_id("page")
}

fn draw(cx: &mut v2::Draw<'_>) -> Option<List> {
    let (next, count) = pad(|pad| (pad.next, pad.draws.len()));
    let returned = match next {
        Next::Art(seed) => Returned::Art(
            FIXED
                .with(|fixed| fixed.borrow().clone())
                .unwrap_or_else(|| art(seed, count, cx.frame.width, cx.frame.height)),
        ),
        Next::Keep => Returned::Kept,
        Next::Over => Returned::Over,
        Next::Bad => Returned::Bad,
        Next::Panic => Returned::Panic,
    };
    pad(|pad| pad.draws.push(Drawn { generation: cx.mount.generation, frame: cx.frame, returned: returned.clone() }));
    match returned {
        Returned::Art(shapes) => Some(encode(&shapes)),
        Returned::Kept => None,
        Returned::Over => Some(over()),
        // A fill without its payload.
        Returned::Bad => Some(List::from_bytes(vec![list::VERSION, 1, 0, 0, 0, 0])),
        Returned::Panic => panic!("the pad's draw panics"),
    }
}

/// A list one byte over the limit.
fn over() -> List {
    let mut over = List::new();
    over.text(0, 0, &"x".repeat(list::MAX_BYTES - 15 + 1), list::Style::new());
    over
}

/// Shapes for a canvas of `width` x `height`, some partly or wholly outside it.
fn art(seed: u8, count: usize, width: u16, height: u16) -> Vec<Shape> {
    let mut rng = Rng::new(u64::from(seed) * 7919 + count as u64);
    shapes(&mut rng, width, height, 0, false)
}

fn shapes(rng: &mut Rng, width: u16, height: u16, depth: u8, opaque: bool) -> Vec<Shape> {
    const COLORS: [abi::Rgba; 5] = [
        abi::Rgba::new(200, 40, 40, 255),
        abi::Rgba::new(40, 200, 90, 255),
        abi::Rgba::new(230, 230, 230, 255),
        abi::Rgba::new(250, 200, 0, 255),
        abi::Rgba::new(90, 90, 250, 128),
    ];
    const TEXTS: [&str; 6] = ["ab", "score 120", "█▓░", "x", "界x", "e\u{301}"];
    const CHARS: [char; 6] = ['#', '@', '█', '·', 'o', '─'];
    let colors = if opaque { &COLORS[..4] } else { COLORS.as_slice() };
    let texts: &[&str] = if opaque { &["ab", "a b", "█▓", "x"] } else { &TEXTS };
    let chars: &[char] = if opaque { &['#', '@', '█', ' ', 'o'] } else { &CHARS };
    let x = |rng: &mut Rng| rng.below(usize::from(width) + 4) as i16 - 2;
    let y = |rng: &mut Rng| rng.below(usize::from(height) + 2) as i16 - 1;
    let size = |rng: &mut Rng, of: u16| {
        if opaque { 2 + rng.below(usize::from(of)) as u16 } else { rng.below(usize::from(of) + 3) as u16 }
    };
    let color = |rng: &mut Rng| *rng.pick(colors);
    let pen = |rng: &mut Rng| {
        let fg = (rng.below(if opaque { 4 } else { 5 }) > 0).then(|| color(rng));
        Pen(
            fg,
            (rng.below(2) == 0).then(|| color(rng)),
            if opaque || rng.below(3) == 0 { rng.below(64) as u8 } else { 0 },
        )
    };
    (0..1 + rng.below(5))
        .map(|_| match rng.below(if depth < 2 { 6 } else { 5 }) {
            0 => Shape::Fill(x(rng), y(rng), size(rng, width), size(rng, height), color(rng)),
            1 => Shape::Text(x(rng), y(rng), rng.pick(texts), pen(rng)),
            2 => Shape::Cell(x(rng), y(rng), *rng.pick(chars), pen(rng)),
            3 => {
                let columns = 1 + rng.below(5) as u16;
                let at = opaque.then(|| (x(rng), y(rng)));
                let cells = (0..rng.below(12)).map(|_| (*rng.pick(chars), pen(rng))).collect();
                let (x, y) = at.unwrap_or_else(|| (x(rng), y(rng)));
                Shape::Cells(x, y, columns, cells)
            }
            4 => {
                let border = *rng.pick(&[
                    abi::BorderStyle::Single,
                    abi::BorderStyle::Double,
                    abi::BorderStyle::Rounded,
                    abi::BorderStyle::Heavy,
                ]);
                let background = (rng.below(2) == 0).then(|| color(rng));
                Shape::Rect(x(rng), y(rng), size(rng, width), size(rng, height), border, color(rng), background)
            }
            _ => {
                let (left, top) = (x(rng), y(rng));
                let (clip_width, clip_height) = (size(rng, width), size(rng, height));
                Shape::Clip(left, top, clip_width, clip_height, shapes(rng, width, height, depth + 1, opaque))
            }
        })
        .collect()
}

/// The list of `shapes`, written with the SDK's builder.
/// What the host holds for the list of `shapes`: its bytes, and a cell as OpenTUI records it for each cell.
fn held_for(shapes: &[Shape]) -> i64 {
    fn cells(shapes: &[Shape]) -> usize {
        shapes
            .iter()
            .map(|shape| match shape {
                Shape::Cell(..) => 1,
                Shape::Cells(_, _, _, run) => run.len(),
                Shape::Clip(_, _, _, _, inner) => cells(inner),
                _ => 0,
            })
            .sum()
    }
    (encode(shapes).as_bytes().len() + cells(shapes) * opencode_plugin::canvas::CELL) as i64
}

fn encode(shapes: &[Shape]) -> List {
    fn write(list: &mut List, shapes: &[Shape]) {
        for shape in shapes {
            match shape {
                Shape::Fill(x, y, width, height, color) => {
                    list.fill(*x, *y, *width, *height, *color);
                }
                Shape::Text(x, y, text, pen) => {
                    list.text(*x, *y, text, style(pen));
                }
                Shape::Cell(x, y, char, pen) => {
                    list.cell(*x, *y, *char, style(pen));
                }
                Shape::Cells(x, y, width, cells) => {
                    list.cells(*x, *y, *width, cells.iter().map(|(char, pen)| (*char, style(pen))));
                }
                Shape::Rect(x, y, width, height, border, color, background) => {
                    list.rect(*x, *y, *width, *height, *border, *color, *background);
                }
                Shape::Clip(x, y, width, height, inner) => {
                    list.clip(*x, *y, *width, *height);
                    write(list, inner);
                    list.pop();
                }
            }
        }
    }
    fn style(pen: &Pen) -> list::Style {
        let on = |bit: u8| pen.2 & bit != 0;
        list::Style {
            fg: pen.0,
            bg: pen.1,
            bold: on(1),
            dim: on(2),
            italic: on(4),
            underline: on(8),
            inverse: on(16),
            strikethrough: on(32),
        }
    }
    let mut list = List::new();
    write(&mut list, shapes);
    list
}

/// What the twin paints: shapes straight onto the painter, or the placeholder.
#[derive(Clone, Debug, PartialEq)]
enum Held {
    Art(Vec<Shape>),
    Over,
}

struct Twin(Option<Held>);

impl Component for Twin {
    fn paint(&self, painter: &mut Painter<'_>) {
        match &self.0 {
            Some(Held::Art(shapes)) => paint(shapes, painter),
            Some(Held::Over) => painter.text(0, 0, PLACEHOLDER, opentui::style::Style::new().dim()),
            None => {}
        }
    }
}

fn paint(shapes: &[Shape], painter: &mut Painter<'_>) {
    let rgba = |color: abi::Rgba| opentui::style::Color::rgba(color.r, color.g, color.b, color.a);
    let style = |pen: &Pen| {
        use opentui::style::Attributes;
        let mut style = opentui::style::Style::new();
        if let Some(fg) = pen.0 {
            style = style.fg(rgba(fg));
        }
        if let Some(bg) = pen.1 {
            style = style.bg(rgba(bg));
        }
        let bits = [
            Attributes::BOLD,
            Attributes::DIM,
            Attributes::ITALIC,
            Attributes::UNDERLINE,
            Attributes::INVERSE,
            Attributes::STRIKETHROUGH,
        ];
        for (index, attribute) in bits.into_iter().enumerate() {
            if pen.2 & (1 << index) != 0 {
                style = style.add(attribute);
            }
        }
        style
    };
    for shape in shapes {
        match shape {
            Shape::Fill(x, y, width, height, color) => {
                painter.fill((*x).into(), (*y).into(), (*width).into(), (*height).into(), rgba(*color))
            }
            Shape::Text(x, y, text, pen) => painter.text((*x).into(), (*y).into(), text, style(pen)),
            Shape::Cell(x, y, char, pen) => painter.cell((*x).into(), (*y).into(), *char, style(pen)),
            Shape::Cells(x, y, width, cells) => {
                for (index, (char, pen)) in cells.iter().enumerate() {
                    let (column, row) = (index % usize::from(*width), index / usize::from(*width));
                    painter.cell(i32::from(*x) + column as i32, i32::from(*y) + row as i32, *char, style(pen));
                }
            }
            Shape::Rect(x, y, width, height, border, color, background) => {
                let style = match border {
                    abi::BorderStyle::Single => opentui::style::BorderStyle::Single,
                    abi::BorderStyle::Double => opentui::style::BorderStyle::Double,
                    abi::BorderStyle::Rounded => opentui::style::BorderStyle::Rounded,
                    abi::BorderStyle::Heavy => opentui::style::BorderStyle::Heavy,
                };
                let spec = BoxSpec {
                    style,
                    border_color: rgba(*color),
                    background: background.map_or(opentui::style::Color::TRANSPARENT, rgba),
                    fill: background.is_some(),
                    ..BoxSpec::default()
                };
                painter.draw_box((*x).into(), (*y).into(), (*width).into(), (*height).into(), &spec);
            }
            Shape::Clip(x, y, width, height, inner) => {
                painter
                    .clip((*x).into(), (*y).into(), (*width).into(), (*height).into(), |painter| paint(inner, painter));
            }
        }
    }
}

/// The cells the twin paints for `held` in a canvas of `width` x `height` on [`BG`].
fn twin(held: Option<&Held>, width: u16, height: u16) -> Capture {
    let app = TestApp::new(width, height);
    let canvas = Custom::new(&app, Twin(held.cloned())).width(width).height(height);
    let back = View::new(&app)
        .width(Length::percent(100.0))
        .height(Length::percent(100.0))
        .bg(opentui::style::Color::rgba(BG.r, BG.g, BG.b, BG.a));
    back.add(&canvas);
    app.root().add(&back);
    app.render()
}

/// Where the canvas's top-left cell is in `frame`: right of the mark.
fn origin(frame: &Capture) -> Option<(u32, u32)> {
    (0..frame.height)
        .find_map(|y| (0..frame.width).find(|x| frame.cell(*x, y).unwrap().symbol == MARK).map(|x| (x + 1, y)))
}

/// The first cell of the canvas that differs from the twin's, if any.
fn differs(frame: &Capture, held: Option<&Held>, (width, height): (u16, u16)) -> Option<String> {
    let Some((left, top)) = origin(frame) else { return Some("the mark is not on screen".into()) };
    let expected = twin(held, width, height);
    // Nothing a list draws reaches the row right of the canvas, which is blank on the row's background.
    let blank = opentui::style::Color::rgba(BG.r, BG.g, BG.b, BG.a);
    for y in 0..u32::from(height) {
        let beside = frame.cell(left + u32::from(width), top + y);
        if beside.is_some_and(|cell| cell.symbol != " " || cell.bg != blank) {
            return Some(format!("the cell right of the canvas's row {y} is {beside:?}"));
        }
    }
    for y in 0..u32::from(height) {
        for x in 0..u32::from(width) {
            let (got, want) = (frame.cell(left + x, top + y), expected.cell(x, y));
            if got != want {
                return Some(format!("cell ({x}, {y}) is {got:?}, the twin's {want:?}; row {:?}", frame.row(top + y)));
            }
        }
    }
    None
}

fn open_tui(width: u16, height: u16, plugins: Vec<opencode_plugin::Builtin>) -> Harness {
    let deps = Deps { route: Route::Home, builtins: plugins, ..support::deps(Arc::new(support::empty())) };
    let harness = support::mount(width, height, deps);
    // The budget is not what these rows check. On the wall clock a loaded machine's stall in a plugin call (memory
    // reclaim, swap), which is no wait on a run queue, is charged: a view or draw over the budget in a paint keeps its
    // frame open for the paint after, which asks for one more frame at idle, and enough of them make the plugin slow,
    // whose toast covers the screen and wants frames. A call here takes no time; the containment row sets its own.
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    harness.app.advance(Duration::from_millis(1));
    harness.app.render();
    harness
}

fn status(harness: &Harness, id: &str) -> opencode_plugin::Status {
    harness.tui.plugins.entries().into_iter().find(|entry| entry.id == id).unwrap().status
}

/// One frame after the clock moves `by`.
fn frame(harness: &Harness, by: Duration) -> Capture {
    harness.app.advance(by);
    harness.app.render()
}

/// Describe outstanding frame requests when the idle check fails.
fn wanting(harness: &Harness) -> String {
    let toast = harness.tui.toasts.current().map(|toast| format!("{:?} {}", toast.title, toast.message));
    let plugins: Vec<String> = harness
        .tui
        .plugins
        .entries()
        .into_iter()
        .filter(|entry| entry.slow.is_some() || entry.status != opencode_plugin::Status::Active)
        .map(|entry| format!("{} {:?}", entry.id, entry.status))
        .collect();
    let synced = harness.tui.synced();
    frame(harness, Duration::from_millis(16));
    let again = harness.app.needs_frame();
    format!("toast {toast:?}, plugins {plugins:?}, synced {synced}, the next frame wants another: {again}")
}

#[derive(Clone, Debug)]
enum Command {
    Open,
    Home,
    Show(bool),
    Wrap(bool),
    Loose(bool),
    Size(u16, u16),
    Version,
    Animate(bool),
    Next(Next),
    /// The `animations` switch.
    Motion(bool),
    Resize(u16, u16),
    Theme(usize),
}

const MODES: [opencode_ui::theme::ThemeMode; 2] =
    [opencode_ui::theme::ThemeMode::Dark, opencode_ui::theme::ThemeMode::Light];

fn apply(harness: &Harness, command: &Command) {
    let tui = &harness.tui;
    let set = |input: String| {
        let _ = tui.keymap.dispatch("pad.set", Some(&input));
    };
    match command {
        Command::Open => tui.navigate(Route::Plugin { id: ID.to_owned(), name: "pad".to_owned() }),
        Command::Home => tui.navigate(Route::Home),
        Command::Show(shown) => set(format!("shown={}", u8::from(*shown))),
        Command::Wrap(on) => set(format!("wrap={}", u8::from(*on))),
        Command::Loose(on) => set(format!("loose={}", u8::from(*on))),
        Command::Size(width, height) => set(format!("size={width}x{height}")),
        Command::Version => set("version=".into()),
        Command::Animate(on) => set(format!("animate={}", u8::from(*on))),
        Command::Next(next) => pad(|pad| pad.next = *next),
        Command::Motion(on) => opencode_ui::motion::set_running(&harness.app, *on),
        Command::Resize(width, height) => harness.app.resize(*width, *height),
        Command::Theme(index) => {
            tui.theme.borrow_mut().set_mode(Some(MODES[index % MODES.len()]), false);
            tui.theme_changed();
        }
    }
}

/// The model's reference: what is mounted and what the canvas holds, from the plugin's own log.
#[derive(Default)]
struct Reference {
    mounted: Option<u64>,
    highest: u64,
    /// The canvas shows in the mounted tree.
    shown: bool,
    size: (u16, u16),
    animate: bool,
    motion: bool,
    held: Option<Held>,
    dead: bool,
    version: u64,
    /// The size and version of the canvas's last draw.
    asked: Option<((u16, u16), u64)>,
}

impl Reference {
    fn showing(&self) -> bool {
        self.mounted.is_some() && self.shown && !self.dead
    }

    /// The canvas shows and has a size: a canvas of none is not drawn, nor painted, so it does not animate.
    fn drawable(&self) -> bool {
        self.showing() && self.size.0 > 0 && self.size.1 > 0
    }

    fn animating(&self) -> bool {
        self.drawable() && self.animate && self.motion
    }

    fn laid_out(&self) -> Option<v2::Cause> {
        match self.asked {
            _ if !self.drawable() => None,
            Some(asked) if asked == (self.size, self.version) => None,
            Some((size, _)) if size == self.size => Some(v2::Cause::Version),
            Some(_) => Some(v2::Cause::Resized),
            None => Some(v2::Cause::First),
        }
    }

    /// Takes the draws of a frame; the first failure of `lifecycle`.
    fn take(&mut self, draws: &[Drawn]) -> Result<(), String> {
        for drawn in draws {
            if !self.showing() || Some(drawn.generation) != self.mounted {
                return Err(format!(
                    "a draw of generation {} while {:?} shows: {drawn:?}",
                    drawn.generation, self.mounted
                ));
            }
            if (drawn.frame.width, drawn.frame.height) != self.size {
                return Err(format!("a draw for {:?} of a canvas of {:?}", drawn.frame, self.size));
            }
            self.asked = Some((self.size, self.version));
            match &drawn.returned {
                Returned::Art(shapes) => self.held = Some(Held::Art(shapes.clone())),
                Returned::Over => self.held = Some(Held::Over),
                Returned::Kept => {}
                Returned::Bad | Returned::Panic => self.dead = true,
            }
        }
        Ok(())
    }
}

struct Canvases;

impl Model for Canvases {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let mut commands = vec![Command::Open];
        commands.extend((1..steps).map(|_| match rng.below(100) {
            0..8 => Command::Open,
            8..14 => Command::Home,
            14..20 => Command::Show(rng.below(3) > 0),
            20..22 => Command::Wrap(rng.below(2) == 0),
            22..24 => Command::Loose(rng.below(2) == 0),
            24..36 => Command::Size(1 + rng.below(30) as u16, 1 + rng.below(8) as u16),
            36..48 => Command::Version,
            48..60 => Command::Animate(rng.below(2) == 0),
            60..78 => Command::Next(match rng.below(20) {
                0..13 => Next::Art(rng.below(256) as u8),
                13..16 => Next::Keep,
                16..18 => Next::Over,
                18 => Next::Bad,
                _ => Next::Panic,
            }),
            78..84 => Command::Motion(rng.below(3) > 0),
            84..92 => Command::Resize(40 + rng.below(60) as u16, 12 + rng.below(18) as u16),
            _ => Command::Theme(rng.below(2)),
        }));
        commands
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Next(Next::Art(seed)) if *seed > 0 => vec![Command::Next(Next::Art(0))],
            Command::Size(width, height) if (*width, *height) != (1, 1) => vec![Command::Size(1, 1)],
            _ => Vec::new(),
        }
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        PAD.with(|cell| *cell.borrow_mut() = Pad::default());
        opencode_ui::motion::set_running(&TestApp::new(1, 1), true);
        let baseline = host::ledger();
        let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
        let mut reference = Reference { shown: true, size: (12, 4), motion: true, ..Reference::default() };
        for (step, command) in commands.iter().enumerate() {
            let fail = |property: &'static str, site: &'static str, detail: String| {
                (!model::skipped(property)).then_some(Failure { property, site, step, detail })
            };
            let (seen, work) = (pad(|pad| pad.draws.len()), host::work());
            // The draw a command asks for in its frame, from the canvas as it showed before it.
            let was_animating = reference.animating();
            apply(&harness, command);
            match command {
                Command::Open | Command::Home => {
                    (reference.held, reference.asked) = (None, None);
                    let on_route = matches!(harness.tui.route(), Route::Plugin { .. });
                    reference.mounted = (on_route && !reference.dead).then_some(0);
                }
                Command::Show(shown) => {
                    if *shown != reference.shown {
                        (reference.held, reference.asked) = (None, None);
                    }
                    reference.shown = *shown;
                }
                Command::Version => reference.version += 1,
                Command::Size(width, height) => reference.size = (*width, *height),
                Command::Animate(on) => reference.animate = *on,
                Command::Motion(on) => reference.motion = *on,
                _ => {}
            }
            let first = frame(&harness, Duration::from_millis(1));
            if matches!(command, Command::Open | Command::Home)
                && let Some(mounted) = reference.mounted.as_mut()
            {
                *mounted = pad(|pad| pad.generation);
                if *mounted <= reference.highest {
                    return fail("lifecycle", "mount", format!("generation {mounted} opened again"));
                }
                reference.highest = *mounted;
            }
            let draws: Vec<Drawn> = pad(|pad| pad.draws[seen..].to_vec());
            let animating = was_animating && reference.animating();
            let asked = match command {
                Command::Open | Command::Show(true) | Command::Size(..) => reference.laid_out(),
                Command::Version if reference.drawable() => Some(v2::Cause::Version),
                _ => None,
            }
            .or(animating.then_some(v2::Cause::Animate));
            // A frame of the animation carries its time, whatever else asks for the draw in it.
            let dt = match asked {
                Some(v2::Cause::First) | None => Duration::ZERO,
                Some(_) if animating => Duration::from_millis(1),
                Some(_) => Duration::ZERO,
            };
            let got: Vec<(v2::Cause, Duration)> =
                draws.iter().map(|drawn| (drawn.frame.cause, drawn.frame.dt)).collect();
            let want: Vec<(v2::Cause, Duration)> = asked.map(|cause| (cause, dt)).into_iter().collect();
            if got != want {
                return fail("lifecycle", "asked", format!("{command:?} drew {got:?}, not {want:?}"));
            }
            let done = host::work().since(work);
            let made = |kind: fn(&Returned) -> bool| draws.iter().filter(|drawn| kind(&drawn.returned)).count() as u64;
            let counted = (
                made(|returned| matches!(returned, Returned::Art(_))),
                made(|returned| matches!(returned, Returned::Over)),
                draws.len() as u64,
            );
            if (done.lists, done.over, done.draws) != counted {
                return fail("work", "counted", format!("the host counted {done:?} for {draws:?}"));
            }
            if let Err(detail) = reference.take(&draws) {
                return fail("lifecycle", "draw", detail);
            }
            if reference.dead {
                reference.mounted = None;
                if !matches!(status(&harness, ID), opencode_plugin::Status::Failed(_)) {
                    return fail(
                        "lifecycle",
                        "failed",
                        format!("a bad list or a panic left {:?}", status(&harness, ID)),
                    );
                }
            }
            if reference.showing()
                && let Some(detail) = differs(&first, reference.held.as_ref(), reference.size)
            {
                return fail("replay", "first", detail);
            }
            // A frame with no change: no view, and a draw only for a canvas that animates.
            let (views, work) = (pad(|pad| pad.views), host::work());
            let seen = pad(|pad| pad.draws.len());
            let still = frame(&harness, Duration::from_millis(16));
            let draws: Vec<Drawn> = pad(|pad| pad.draws[seen..].to_vec());
            let done = host::work().since(work);
            let views = pad(|pad| pad.views) - views;
            let expected = usize::from(reference.animating());
            let animated =
                |drawn: &Drawn| drawn.frame.cause == v2::Cause::Animate && drawn.frame.dt == Duration::from_millis(16);
            if views != 0 || draws.len() != expected || !draws.iter().all(animated) {
                return fail("work", "still", format!("{views} views and draws {draws:?}; {expected} expected"));
            }
            if expected == 0 && (done.lists != 0 || done.bytes != 0) {
                return fail("work", "checked", format!("a still frame checked a list: {done:?}"));
            }
            let painted = u64::from(reference.drawable() && matches!(reference.held, Some(Held::Art(_))));
            if expected == 0 && done.replays != painted {
                return fail("work", "replays", format!("{} replays, {painted} expected: {done:?}", done.replays));
            }
            if let Err(detail) = reference.take(&draws) {
                return fail("lifecycle", "animate", detail);
            }
            if reference.showing()
                && let Some(detail) = differs(&still, reference.held.as_ref(), reference.size)
            {
                return fail("replay", "still", detail);
            }
            if expected == 0 && harness.app.needs_frame() {
                let detail = format!("a frame with nothing to animate wants another; {}", wanting(&harness));
                return fail("work", "idle", detail);
            }
            let bytes = match &reference.held {
                Some(Held::Art(shapes)) if reference.showing() => Some(held_for(shapes)),
                _ => None,
            };
            let expected = Ledger {
                canvases: baseline.canvases + i64::from(reference.showing()),
                lists: baseline.lists + i64::from(bytes.is_some()),
                bytes: baseline.bytes + bytes.unwrap_or(0),
                driving: baseline.driving + i64::from(reference.animating()),
            };
            if host::ledger() != expected {
                return fail("ledger", "held", format!("the host holds {:?}, expected {expected:?}", host::ledger()));
            }
        }
        drop(harness);
        if host::ledger() != baseline {
            let detail = format!("a closed TUI holds {:?}", host::ledger());
            return (!model::skipped("ledger")).then_some(Failure {
                property: "ledger",
                site: "closed",
                step: commands.len(),
                detail,
            });
        }
        None
    }
}

#[test]
fn canvases_hold_their_properties() {
    model::check(&Canvases, 64, 24);
}

/// Expected cell; a fill's blank foreground is not observable.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Raster {
    char: char,
    fg: Option<abi::Rgba>,
    bg: abi::Rgba,
    bits: u8,
    glyph: bool,
}

/// Resolve one cell in drawing order, independently of OpenTUI. Nested clips can only exclude this point.
fn raster(shapes: &[Shape], x: i16, y: i16, mut cell: Raster) -> Raster {
    let inside = |left: i16, top: i16, width: u16, height: u16| {
        (0..i32::from(width)).contains(&(i32::from(x) - i32::from(left)))
            && (0..i32::from(height)).contains(&(i32::from(y) - i32::from(top)))
    };
    for shape in shapes {
        let glyph = match shape {
            Shape::Fill(l, t, w, h, bg) if inside(*l, *t, *w, *h) => {
                cell = Raster { char: ' ', fg: None, bg: *bg, bits: 0, glyph: false };
                continue;
            }
            Shape::Clip(l, t, w, h, children) if inside(*l, *t, *w, *h) => {
                cell = raster(children, x, y, cell);
                continue;
            }
            Shape::Text(l, t, text, pen) if *t == y && *l <= x => {
                text.chars().nth((x - l) as usize).map(|ch| (ch, *pen, false))
            }
            Shape::Cell(l, t, ch, pen) if (*l, *t) == (x, y) => Some((*ch, *pen, true)),
            Shape::Cells(l, t, w, cells) if x >= *l && y >= *t && i32::from(x - l) < i32::from(*w) => {
                let at = (y - t) as usize * usize::from(*w) + (x - l) as usize;
                cells.get(at).map(|(ch, pen)| (*ch, *pen, true))
            }
            Shape::Rect(l, t, w, h, border, fg, bg) if inside(*l, *t, *w, *h) => {
                let edges = match border {
                    abi::BorderStyle::Single => ['┌', '┐', '└', '┘', '─', '│'],
                    abi::BorderStyle::Double => ['╔', '╗', '╚', '╝', '═', '║'],
                    abi::BorderStyle::Rounded => ['╭', '╮', '╰', '╯', '─', '│'],
                    abi::BorderStyle::Heavy => ['┏', '┓', '┗', '┛', '━', '┃'],
                };
                let edge = match (x == *l, (x - l) as u16 + 1 == *w, y == *t, (y - t) as u16 + 1 == *h) {
                    (true, _, true, _) => 0,
                    (_, true, true, _) => 1,
                    (true, _, _, true) => 2,
                    (_, true, _, true) => 3,
                    (_, _, true, _) | (_, _, _, true) => 4,
                    (true, _, _, _) | (_, true, _, _) => 5,
                    _ => {
                        if let Some(bg) = bg {
                            cell = Raster { char: ' ', fg: None, bg: *bg, bits: 0, glyph: false };
                        }
                        continue;
                    }
                };
                Some((edges[edge], Pen(Some(*fg), *bg, 0), false))
            }
            _ => None,
        };
        // A transparent cell-space keeps the existing glyph; a space in a text operation replaces it.
        if let Some((ch, pen, blend)) = glyph
            && !(blend && ch == ' ' && pen.1.is_none() && cell.char != ' ')
        {
            cell = Raster { char: ch, fg: pen.0, bg: pen.1.unwrap_or(cell.bg), bits: pen.2, glyph: true };
        }
    }
    cell
}

/// The first cell of the canvas in `frame` that differs from what [`raster`] computes for `shapes`, if any.
fn unlike_raster(frame: &Capture, shapes: &[Shape], (width, height): (u16, u16)) -> Option<String> {
    use opentui::style::{Attributes, Color};
    let (left, top) = origin(frame)?;
    let color = |color: abi::Rgba| Color::rgba(color.r, color.g, color.b, color.a);
    let bits = [
        Attributes::BOLD,
        Attributes::DIM,
        Attributes::ITALIC,
        Attributes::UNDERLINE,
        Attributes::INVERSE,
        Attributes::STRIKETHROUGH,
    ];
    let blank = Raster { char: ' ', fg: None, bg: BG, bits: 0, glyph: false };
    for y in 0..height {
        for x in 0..width {
            let want = raster(shapes, x as i16, y as i16, blank);
            let got = frame.cell(left + x as u32, top + y as u32).unwrap();
            let mut same = got.symbol.chars().next().unwrap_or(' ') == want.char && got.bg == color(want.bg);
            if want.glyph {
                let attributes = bits
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| want.bits & (1 << index) != 0)
                    .fold(Attributes::NONE, |all, (_, bit)| all.union(*bit));
                same &= got.fg == want.fg.map_or(Color::DEFAULT_FOREGROUND, color) && got.attributes == attributes;
            }
            if !same {
                return Some(format!(
                    "cell ({x}, {y}) is {got:?}, the raster's {want:?}; row {:?}",
                    frame.row(top + y as u32)
                ));
            }
        }
    }
    None
}

#[test]
fn a_list_on_screen_has_the_cells_a_rasterizer_computes() {
    let red = abi::Rgba::new(200, 0, 0, 255);
    let green = abi::Rgba::new(0, 200, 0, 255);
    let white = abi::Rgba::new(255, 255, 255, 255);
    let shapes = vec![
        Shape::Fill(1, 0, 6, 3, red),
        Shape::Text(-1, 1, "score 120", Pen(Some(white), None, 0)),
        Shape::Clip(
            2,
            0,
            4,
            4,
            vec![
                Shape::Fill(0, 2, 12, 1, green),
                Shape::Clip(3, 0, 9, 9, vec![Shape::Cell(4, 3, '@', Pen(Some(white), Some(red), 1))]),
                Shape::Cell(1, 3, '#', Pen(Some(white), None, 0)),
            ],
        ),
        Shape::Cell(11, 3, '█', Pen(Some(green), Some(white), 0)),
    ];
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    FIXED.with(|cell| *cell.borrow_mut() = Some(shapes.clone()));
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    for step in 0..3 {
        let frame = frame(&harness, Duration::from_millis(16));
        assert_eq!(unlike_raster(&frame, &shapes, (12, 4)), None, "frame {step}");
    }
    assert_eq!(pad(|pad| pad.draws.len()), 1, "the frames after the first replay the list");
    FIXED.with(|cell| *cell.borrow_mut() = None);
}

thread_local! {
    /// Shapes the pad's next drawings use instead of its generator's.
    static FIXED: RefCell<Option<Vec<Shape>>> = const { RefCell::new(None) };
}

#[test]
fn a_canvas_without_an_id_is_refused() {
    PAD.with(|cell| *cell.borrow_mut() = Pad { unkeyed: true, ..Pad::default() });
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    assert!(
        matches!(status(&harness, ID), opencode_plugin::Status::Failed(ref error) if error.contains("a node with state has no id")),
        "{:?}",
        status(&harness, ID)
    );
    assert_eq!(pad(|pad| (pad.views, pad.draws.len())), (1, 0));
    assert_eq!(host::ledger(), Ledger::default());
}

/// The canvas's top-left cell, and its cells as text rows of `width`.
fn canvas_rows(frame: &Capture, width: u32, height: u32) -> Vec<String> {
    let (left, top) = origin(frame).expect("the mark is on screen");
    (0..height)
        .map(|y| (0..width).map(|x| frame.cell(left + x, top + y).map_or(" ", |cell| cell.symbol.as_str())).collect())
        .collect()
}

/// The animated chart of 4.11: bars that move with the host's clock, and a still mode whose bars change only with
/// its data, by version.
#[derive(Default)]
struct Chart {
    /// The animation's own clock: the sum of the frames' `dt`.
    clock: Duration,
    frames: Vec<v2::Frame>,
    points: u64,
    still: bool,
}

thread_local! {
    static CHART: RefCell<Chart> = RefCell::default();
}

fn chart<T>(f: impl FnOnce(&mut Chart) -> T) -> T {
    CHART.with(|chart| f(&mut chart.borrow_mut()))
}

fn chart_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let scoped = |name: &str, key: &str| abi::Command::new(name).keybind(key).scope(abi::Scope::Route("chart".into()));
    setup.command(scoped("chart.point", "n"), |_, _| chart(|chart| chart.points += 1));
    setup.command(scoped("chart.still", "s"), |_, _| chart(|chart| chart.still = !chart.still));
    let view = |_: &mut v2::View<'_>| {
        let (points, still) = chart(|chart| (chart.points, chart.still));
        let bars = v2::Node::canvas("bars").version(points).animate(!still).layout(abi::Layout {
            grow: true,
            shrink: Some(false),
            ..abi::Layout::default()
        });
        let row = v2::Node::row(vec![v2::Node::text(vec![abi::Span::new(MARK)]), bars])
            .layout(abi::Layout { grow: true, ..abi::Layout::default() });
        v2::Node::column(vec![row]).layout(abi::Layout { grow: true, ..abi::Layout::default() }).with_id("chart")
    };
    setup.surface(v2::Surface::new("chart", v2::Place::Route("chart".into()), view).draw(|cx| {
        let (width, height) = (cx.frame.width, cx.frame.height);
        let (clock, points) = chart(|chart| {
            chart.clock += cx.frame.dt;
            chart.frames.push(cx.frame);
            (chart.clock, chart.points)
        });
        let mut list = List::new();
        list.fill(0, 0, width, height, abi::Rgba::new(10, 10, 30, 255));
        for column in 0..width {
            let phase = clock.as_secs_f64() * 4.0 + f64::from(column) * 0.5 + points as f64;
            let level = ((phase.sin() + 1.0) / 2.0 * f64::from(height)).round() as u16;
            let pen = list::Style::new().fg(abi::Rgba::new(80, 200, 120, 255));
            list.cells(column as i16, (height - level) as i16, 1, (0..level).map(|_| ('█', pen)));
        }
        Some(list)
    }));
    Ok(())
}

fn chart_route() -> Route {
    Route::Plugin { id: "test.chart".to_owned(), name: "chart".to_owned() }
}

#[test]
fn the_chart_animates_once_a_frame_and_rests_while_hidden() {
    CHART.with(|cell| *cell.borrow_mut() = Chart::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.chart", setup: chart_setup }.into()]);
    let baseline = host::ledger();
    harness.tui.navigate(chart_route());
    let first = frame(&harness, Duration::from_millis(1));
    let frames = chart(|chart| chart.frames.clone());
    assert_eq!(frames.iter().map(|frame| frame.cause).collect::<Vec<_>>(), [v2::Cause::First]);
    let (width, height) = (u32::from(frames[0].width), u32::from(frames[0].height));
    assert!(width > 70 && height > 20, "the chart grows to its route: {frames:?}");
    let mut seen = canvas_rows(&first, width, height);
    for step in 0..10 {
        let frame = frame(&harness, Duration::from_millis(16));
        let frames = chart(|chart| chart.frames[1..].to_vec());
        assert_eq!(frames.len(), step + 1, "one draw a frame");
        let last = frames.last().unwrap();
        assert_eq!((last.cause, last.dt), (v2::Cause::Animate, Duration::from_millis(16)));
        let rows = canvas_rows(&frame, width, height);
        assert!(rows.iter().any(|row| row.contains('█')));
        assert_ne!(rows, seen, "frame {step} shows the bars of its own time");
        seen = rows;
    }
    assert_eq!(host::ledger().driving, baseline.driving + 1);

    harness.tui.navigate(Route::Home);
    let drawn = chart(|chart| chart.frames.len());
    for _ in 0..5 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(chart(|chart| chart.frames.len()), drawn, "a hidden chart was drawn");
    assert!(!harness.app.needs_frame(), "a hidden chart asks for frames");
    assert_eq!(host::ledger(), baseline);

    let clock = chart(|chart| chart.clock);
    harness.app.advance(Duration::from_secs(5));
    harness.tui.navigate(chart_route());
    let _ = frame(&harness, Duration::from_millis(1));
    let _ = frame(&harness, Duration::from_millis(16));
    let frames = chart(|chart| chart.frames[drawn..].to_vec());
    assert_eq!(
        frames.iter().map(|frame| (frame.cause, frame.dt)).collect::<Vec<_>>(),
        [(v2::Cause::First, Duration::ZERO), (v2::Cause::Animate, Duration::from_millis(16)),]
    );
    assert_eq!(chart(|chart| chart.clock) - clock, Duration::from_millis(16), "the time away was counted");

    harness.app.press("s");
    let still = frame(&harness, Duration::from_millis(1));
    let drawn = chart(|chart| chart.frames.len());
    for _ in 0..3 {
        let frame = frame(&harness, Duration::from_millis(16));
        assert_eq!(canvas_rows(&frame, width, height), canvas_rows(&still, width, height), "a still chart moved");
    }
    assert_eq!(chart(|chart| chart.frames.len()), drawn, "a still chart was drawn");
    assert!(!harness.app.needs_frame());
    harness.app.press("n");
    let point = frame(&harness, Duration::from_millis(16));
    let frames = chart(|chart| chart.frames[drawn..].to_vec());
    assert_eq!(frames.iter().map(|frame| frame.cause).collect::<Vec<_>>(), [v2::Cause::Version]);
    assert_ne!(canvas_rows(&point, width, height), canvas_rows(&still, width, height), "a new point is drawn");
}

/// A plugin whose animating canvas is the last row of a scroll four rows high, under six rows of text.
fn tall_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |_: &mut v2::View<'_>| {
        let mut rows: Vec<v2::Node> =
            (0..6).map(|row| v2::Node::text(vec![abi::Span::new(format!("row {row}"))])).collect();
        rows.push(v2::Node::canvas("c").animate(true).layout(abi::Layout {
            width: Some(abi::Width::Cells(10)),
            height: Some(abi::Width::Cells(2)),
            shrink: Some(false),
            ..abi::Layout::default()
        }));
        let scroll = v2::Node::Scroll {
            id: Some("s".into()),
            height: Some(4),
            follow: false,
            layout: abi::Layout::default(),
            children: rows,
            notify_top: None,
            user_scroll: false,
            scrollbar: false,
        };
        v2::Node::column(vec![scroll]).with_id("tall")
    };
    setup.surface(v2::Surface::new("tall", v2::Place::Route("tall".into()), view).draw(|cx| {
        TALL.with(|frames| frames.borrow_mut().push((cx.frame.cause, cx.frame.width, cx.frame.height)));
        let mut list = List::new();
        list.fill(0, 0, cx.frame.width, cx.frame.height, abi::Rgba::new(200, 0, 0, 255));
        Some(list)
    }));
    Ok(())
}

thread_local! {
    static TALL: RefCell<Vec<(v2::Cause, u16, u16)>> = const { RefCell::new(Vec::new()) };
}

#[test]
fn an_animating_canvas_out_of_view_rests() {
    TALL.with(|frames| frames.borrow_mut().clear());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.tall", setup: tall_setup }.into()]);
    harness.tui.navigate(Route::Plugin { id: "test.tall".to_owned(), name: "tall".to_owned() });
    let causes = || TALL.with(|frames| frames.borrow().iter().map(|(cause, _, _)| *cause).collect::<Vec<_>>());
    for _ in 0..4 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(causes(), [], "a canvas out of view was drawn");
    assert!(!harness.app.needs_frame());
    let row = (0..24).find(|y| harness.app.render().row(*y).contains("row 0")).unwrap() as u16;
    // One row at a time, so the canvas shows in part before it shows whole: it is drawn at its whole size.
    for _ in 0..10 {
        harness.app.scroll(2, row + 1, true);
        let _ = frame(&harness, Duration::from_millis(16));
    }
    let sizes: Vec<(u16, u16)> = TALL.with(|frames| frames.borrow().iter().map(|(_, w, h)| (*w, *h)).collect());
    assert!(sizes.iter().all(|size| *size == (10, 2)), "{sizes:?}");
    assert_eq!(causes().first(), Some(&v2::Cause::First), "drawn in the paint that shows it");
    assert!(causes().iter().filter(|cause| **cause == v2::Cause::Animate).count() >= 3, "{:?}", causes());
    for _ in 0..10 {
        harness.app.scroll(2, row + 1, false);
    }
    let _ = frame(&harness, Duration::from_millis(16));
    let _ = frame(&harness, Duration::from_millis(16));
    let drawn = causes().len();
    for _ in 0..4 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(causes().len(), drawn, "a canvas scrolled out of view was animated");
    assert!(!harness.app.needs_frame());
    assert_eq!(host::ledger().driving, 0);
}

#[test]
fn a_draw_that_fails_is_reported_by_its_call() {
    for (next, says) in [
        (Next::Panic, "draw panicked: the pad's draw panics"),
        (Next::Bad, "canvas art: a canvas list the host cannot read"),
    ] {
        PAD.with(|cell| *cell.borrow_mut() = Pad { next, ..Pad::default() });
        let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
        apply(&harness, &Command::Open);
        let _ = frame(&harness, Duration::from_millis(1));
        let _ = frame(&harness, Duration::from_millis(16));
        let status = status(&harness, ID);
        assert!(matches!(status, opencode_plugin::Status::Failed(ref error) if error.contains(says)), "{status:?}");
        assert_eq!(pad(|pad| pad.draws.len()), 1);
        assert_eq!(host::ledger(), Ledger::default());
    }
}

thread_local! {
    static SLOT: RefCell<Vec<v2::Frame>> = const { RefCell::new(Vec::new()) };
}

fn slot_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let place = v2::Place::Slot(abi::Placement::append("home.footer.status"));
    let view = |_: &mut v2::View<'_>| {
        v2::Node::canvas("badge").layout(abi::Layout {
            grow: true,
            min_width: Some(abi::Width::Cells(0)),
            height: Some(abi::Width::Cells(2)),
            ..abi::Layout::default()
        })
    };
    setup.surface(v2::Surface::new("badge", place, view).draw(|cx| {
        SLOT.with(|frames| frames.borrow_mut().push(cx.frame));
        let mut list = List::new();
        list.text(0, 0, "§badge§", list::Style::new().fg(abi::Rgba::new(255, 255, 255, 255)));
        Some(list)
    }));
    Ok(())
}

#[test]
fn a_canvas_at_a_slots_root_takes_its_layout() {
    SLOT.with(|frames| frames.borrow_mut().clear());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.badge", setup: slot_setup }.into()]);
    let screen = frame(&harness, Duration::from_millis(16)).text();
    let frames = SLOT.with(|frames| frames.borrow().clone());
    assert_eq!(frames.iter().map(|frame| (frame.height, frame.cause)).collect::<Vec<_>>(), [(2, v2::Cause::First)]);
    assert!(frames[0].width >= 10, "the slot's room, not the canvas's own: {frames:?}");
    assert!(screen.contains("§badge§"), "{screen}");
}

thread_local! {
    static FOOTER_VIEWS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A plugin whose canvas, of 12 by 2 cells, is the root of a claim on `home.footer`.
fn footer_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let place = v2::Place::Slot(abi::Placement::append("home.footer"));
    let view = |_: &mut v2::View<'_>| {
        FOOTER_VIEWS.set(FOOTER_VIEWS.get() + 1);
        v2::Node::canvas("badge").layout(abi::Layout {
            width: Some(abi::Width::Cells(12)),
            height: Some(abi::Width::Cells(2)),
            ..abi::Layout::default()
        })
    };
    setup.surface(v2::Surface::new("badge", place, view).draw(|cx| {
        SLOT.with(|frames| frames.borrow_mut().push(cx.frame));
        let mut list = List::new();
        list.text(0, 1, "§footer§", list::Style::new().fg(abi::Rgba::new(255, 255, 255, 255)));
        Some(list)
    }));
    Ok(())
}

#[test]
fn a_slot_root_canvas_keeps_its_layout_through_a_theme_switch() {
    SLOT.with(|frames| frames.borrow_mut().clear());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.footer", setup: footer_setup }.into()]);
    let _ = frame(&harness, Duration::from_millis(16));
    let (page, views) = (harness.tui.page(), FOOTER_VIEWS.get());
    for mode in MODES {
        harness.tui.theme.borrow_mut().set_mode(Some(mode), false);
        harness.tui.theme_changed();
        let screen = frame(&harness, Duration::from_millis(16)).text();
        assert!(screen.contains("§footer§"), "{mode:?}:\n{screen}");
    }
    assert_ne!(harness.tui.page(), page, "the theme did not change");
    assert_eq!(FOOTER_VIEWS.get(), views, "a restyle calls no view");
    let frames = SLOT.with(|frames| frames.borrow().clone());
    assert_eq!(frames.iter().map(|frame| (frame.width, frame.height)).collect::<Vec<_>>(), [(12, 2)]);
}

#[test]
fn a_canvas_with_no_width_is_not_drawn() {
    PAD.with(|cell| *cell.borrow_mut() = Pad { auto: true, ..Pad::default() });
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    for _ in 0..3 {
        apply(&harness, &Command::Version);
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(pad(|pad| pad.draws.len()), 0);
}

#[test]
fn a_canvas_without_room_is_not_drawn_and_catches_up() {
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    let causes = |from: usize| -> Vec<(u16, v2::Cause)> {
        pad(|pad| pad.draws[from..].iter().map(|drawn| (drawn.frame.width, drawn.frame.cause)).collect())
    };
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    apply(&harness, &Command::Size(0, 4));
    let _ = frame(&harness, Duration::from_millis(16));
    apply(&harness, &Command::Version);
    for _ in 0..3 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(causes(0), [(12, v2::Cause::First)], "a canvas with no room was drawn");
    apply(&harness, &Command::Size(1, 4));
    let shown = frame(&harness, Duration::from_millis(16));
    assert_eq!(causes(1), [(1, v2::Cause::Resized)], "a canvas with room again is drawn in the paint that shows it");
    let held = pad(|pad| match &pad.draws.last().unwrap().returned {
        Returned::Art(shapes) => Held::Art(shapes.clone()),
        other => panic!("{other:?}"),
    });
    assert_eq!(differs(&shown, Some(&held), (1, 4)), None);

    apply(&harness, &Command::Size(0, 4));
    let _ = frame(&harness, Duration::from_millis(16));
    let seen = pad(|pad| pad.draws.len());
    apply(&harness, &Command::Size(0, 6));
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!(causes(seen), [], "a canvas with no room across was drawn");
    apply(&harness, &Command::Version);
    apply(&harness, &Command::Size(1, 4));
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!(causes(seen), [(1, v2::Cause::Version)], "a canvas back at its size draws the version it missed");
    apply(&harness, &Command::Size(12, 6));
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!(causes(seen + 1), [(12, v2::Cause::Resized)]);
}

/// How the contained canvas's next draw fails: a panic, or 150 ms on the monitor's clock.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    Panic,
    Overrun,
}

thread_local! {
    static PAINT_FAULT: std::cell::Cell<Option<Fault>> = const { std::cell::Cell::new(None) };
    /// Whether a panic would unwind to the host's catch, in each draw.
    static PAINT_SEEN: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
    static PAINT_CLOCK: std::cell::Cell<Duration> = const { std::cell::Cell::new(Duration::ZERO) };
}

/// A built-in with one animating canvas on route `paint`, whose draw notes whether it is caught and fails as armed.
fn paint_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |_: &mut v2::View<'_>| {
        v2::Node::column(vec![v2::Node::canvas("c").animate(true).layout(abi::Layout {
            width: Some(abi::Width::Cells(8)),
            height: Some(abi::Width::Cells(2)),
            ..abi::Layout::default()
        })])
    };
    setup.surface(v2::Surface::new("paint", v2::Place::Route("paint".into()), view).draw(|_| {
        PAINT_SEEN.with_borrow_mut(|seen| seen.push(opencode_plugin::contain::catching()));
        match PAINT_FAULT.take() {
            Some(Fault::Panic) => panic!("the canvas's draw panics"),
            Some(Fault::Overrun) => PAINT_CLOCK.set(PAINT_CLOCK.get() + Duration::from_millis(150)),
            None => {}
        }
        let mut list = List::new();
        list.text(0, 0, "painted", list::Style::new().fg(abi::Rgba::new(255, 255, 255, 255)));
        Some(list)
    }));
    Ok(())
}

#[test]
fn a_canvas_draw_is_contained() {
    PAINT_SEEN.take();
    PAINT_FAULT.set(None);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![abi::Plugin { id: "test.paint", setup: paint_setup }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
    let (app, tui) = (&harness.app, &harness.tui);
    let base = std::time::Instant::now();
    tui.plugins.monitor().set_clock(move || base + PAINT_CLOCK.get());
    let status = || tui.plugins.entries().into_iter().find(|entry| entry.id == "test.paint").unwrap().status;
    let baseline = host::ledger();
    tui.navigate(Route::Plugin { id: "test.paint".to_owned(), name: "paint".to_owned() });
    for _ in 0..3 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert!(app.render().text().contains("painted"));

    PAINT_FAULT.set(Some(Fault::Overrun));
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!((tui.plugins.monitor().host_overruns(), status()), (1, opencode_plugin::Status::Active));
    let seen = PAINT_SEEN.take();
    assert!(seen.len() >= 4 && seen.iter().all(|caught| *caught), "{seen:?}");

    PAINT_FAULT.set(Some(Fault::Panic));
    let _ = frame(&harness, Duration::from_millis(16));
    let _ = frame(&harness, Duration::from_millis(16));
    let status = status();
    assert!(
        matches!(status, opencode_plugin::Status::Failed(ref error) if error.contains("draw panicked: the canvas's draw panics")),
        "{status:?}"
    );
    let drawn = PAINT_SEEN.with_borrow(Vec::len);
    for _ in 0..3 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(PAINT_SEEN.with_borrow(Vec::len), drawn, "a failed plugin's canvas was drawn");
    assert!(!app.render().text().contains("painted"));
    assert!(!app.needs_frame(), "a failed plugin's canvas animates");
    assert_eq!(host::ledger(), baseline);
}

thread_local! {
    /// The list `test.cells` draws, which a test sets.
    static CELLS: RefCell<Option<List>> = const { RefCell::new(None) };
    static CELLS_DRAWS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A plugin with one canvas of 12 x 3 right of the mark, on a row of [`BG`], drawn with the list [`CELLS`] holds.
fn cells_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |_: &mut v2::View<'_>| {
        let canvas = v2::Node::canvas("c").layout(abi::Layout {
            width: Some(abi::Width::Cells(12)),
            height: Some(abi::Width::Cells(3)),
            shrink: Some(false),
            ..abi::Layout::default()
        });
        let mark = v2::Node::text(vec![abi::Span::new(MARK)]).layout(abi::Layout::default().shrink(false));
        v2::Node::column(vec![v2::Node::row(vec![mark, canvas]).bg(abi::Color::Rgba(BG))]).with_id("cells")
    };
    setup.surface(v2::Surface::new("cells", v2::Place::Route("cells".into()), view).draw(|_| {
        CELLS_DRAWS.set(CELLS_DRAWS.get() + 1);
        CELLS.with_borrow(Clone::clone)
    }));
    Ok(())
}

/// The TUI on route `test.cells`, drawing `list`, after its first frame.
fn cells_tui(list: List) -> Harness {
    CELLS.set(Some(list));
    CELLS_DRAWS.set(0);
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.cells", setup: cells_setup }.into()]);
    harness.tui.navigate(Route::Plugin { id: "test.cells".to_owned(), name: "cells".to_owned() });
    harness
}

#[test]
fn a_text_the_renderer_cannot_record_is_over_the_limit() {
    assert_eq!(list::MAX_TEXT_BYTES, opentui::sys::OT_BUFFER_TEXT_BYTES_MAX as usize);
    for (bytes, shown) in [(list::MAX_TEXT_BYTES, "xxxxxxxxxxxx"), (list::MAX_TEXT_BYTES + 1, "canvas over")] {
        let mut text = List::new();
        text.text(0, 0, &"x".repeat(bytes), list::Style::new().fg(abi::Rgba::new(255, 255, 255, 255)));
        let harness = cells_tui(text);
        let frame = harness.app.try_render().expect("the frame goes on");
        let rows = canvas_rows(&frame, 12, 1);
        assert!(rows[0].starts_with(shown), "{bytes} bytes: {rows:?}");
        assert!(frame.text().contains(MARK));
        assert_eq!(status(&harness, "test.cells"), opencode_plugin::Status::Active);
    }
}

#[test]
fn clips_past_the_bound_show_the_placeholder() {
    let mut deep = List::new();
    for _ in 0..=list::MAX_CLIPS {
        deep.clip(0, 0, 12, 3);
    }
    let harness = cells_tui(deep);
    let frame = harness.app.render();
    assert!(canvas_rows(&frame, 12, 1)[0].starts_with("canvas over"));
    assert!(frame.text().contains(MARK));
    assert_eq!(status(&harness, "test.cells"), opencode_plugin::Status::Active);
    let harness = cells_tui(List::new().pop().clone());
    harness.app.render();
    let _ = frame_after_one(&harness);
    assert!(matches!(status(&harness, "test.cells"), opencode_plugin::Status::Failed(_)));
}

fn frame_after_one(harness: &Harness) -> Capture {
    frame(harness, Duration::from_millis(16))
}

#[test]
fn a_list_draws_the_cells_its_table_says() {
    use opentui::style::{Attributes, Color};
    let white = abi::Rgba::new(255, 255, 255, 255);
    let pen = list::Style::new().fg(white);
    let mut list = List::new();
    list.text(0, 0, "界a", pen)
        .cell(3, 0, '界', pen)
        .text(4, 0, "e\u{301}", pen)
        .cell(6, 0, '#', pen)
        .clip(8, 0, 1, 1)
        .text(7, 0, "界", pen)
        .pop()
        .cell(9, 0, 'S', pen)
        .text(0, 1, "ab", pen)
        .cell(1, 1, 'X', pen)
        .fill(2, 1, 2, 1, abi::Rgba::new(255, 0, 0, 128))
        .cell(5, 1, 'm', list::Style::new());
    let bits = [
        (list::Style { bold: true, ..pen }, Attributes::BOLD),
        (list::Style { dim: true, ..pen }, Attributes::DIM),
        (list::Style { italic: true, ..pen }, Attributes::ITALIC),
        (list::Style { underline: true, ..pen }, Attributes::UNDERLINE),
        (list::Style { inverse: true, ..pen }, Attributes::INVERSE),
        (list::Style { strikethrough: true, ..pen }, Attributes::STRIKETHROUGH),
    ];
    for (index, (style, _)) in bits.iter().enumerate() {
        list.cell(index as i16, 2, 's', *style);
    }
    let harness = cells_tui(list);
    let bg = Color::rgba(BG.r, BG.g, BG.b, BG.a);
    for step in ["drawn", "replayed"] {
        let work = host::work();
        let frame = frame_after_one(&harness);
        // Ten operations and six cells, the clip and the pop aside.
        assert_eq!(host::work().since(work).ops, 16, "{step}");
        let (left, top) = origin(&frame).unwrap();
        let cell = |x: u32, y: u32| frame.cell(left + x, top + y).unwrap().clone();
        let symbols: Vec<String> = (0..10).map(|x| cell(x, 0).symbol).collect();
        assert_eq!(symbols, ["界", "", "a", "\u{FFFD}", "e\u{301}", " ", "#", " ", " ", "S"], "{step}");
        let symbols: Vec<String> = (0..6).map(|x| cell(x, 1).symbol).collect();
        assert_eq!(symbols, ["a", "X", " ", " ", " ", "m"], "{step}");
        // Red at alpha 128 over the row's background, channel by channel: 255 a + c (1 - a), a = 128 / 255.
        let blend = |over: u8, under: u8| f64::from(over) * 128.0 / 255.0 + f64::from(under) * 127.0 / 255.0;
        let fill = cell(2, 1).bg;
        for (got, want) in [(fill.r, blend(255, BG.r)), (fill.g, blend(0, BG.g)), (fill.b, blend(0, BG.b))] {
            assert!((f64::from(got) - want).abs() <= 1.0, "{step}: the fill is {fill:?}, not about {want}");
        }
        assert_eq!(cell(5, 1).bg, bg, "{step}: a cell without a background keeps the row's");
        assert_eq!(
            cell(5, 1).fg,
            Color::DEFAULT_FOREGROUND,
            "{step}: a cell without a foreground takes the terminal's"
        );
        for (index, (_, attribute)) in bits.iter().enumerate() {
            let got = cell(index as u32, 2).attributes;
            assert_eq!(got, *attribute, "{step}: style bit {index}");
            assert_eq!(cell(index as u32, 2).symbol, "s");
        }
    }
    assert_eq!(CELLS_DRAWS.get(), 1);
}

#[test]
fn a_kept_list_is_replayed_at_a_new_size_until_replaced() {
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    let held = |pad: &Pad| match &pad.draws.last().unwrap().returned {
        Returned::Art(shapes) => Held::Art(shapes.clone()),
        other => panic!("{other:?}"),
    };
    let first = pad(|pad| held(pad));
    apply(&harness, &Command::Next(Next::Keep));
    apply(&harness, &Command::Size(16, 4));
    let kept = frame(&harness, Duration::from_millis(16));
    assert_eq!(pad(|pad| pad.draws.last().unwrap().frame.cause), v2::Cause::Resized);
    assert_eq!(differs(&kept, Some(&first), (16, 4)), None, "the list before is replayed at the new size");
    apply(&harness, &Command::Next(Next::Art(9)));
    apply(&harness, &Command::Version);
    let replaced = frame(&harness, Duration::from_millis(16));
    let next = pad(|pad| held(pad));
    assert_ne!(next, first);
    assert_eq!(differs(&replaced, Some(&next), (16, 4)), None);
}

#[test]
fn a_canvas_without_a_draw_does_not_animate() {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let view = |_: &mut v2::View<'_>| {
            v2::Node::column(vec![v2::Node::canvas("c").animate(true).layout(abi::Layout {
                width: Some(abi::Width::Cells(6)),
                height: Some(abi::Width::Cells(2)),
                ..abi::Layout::default()
            })])
        };
        setup.surface(v2::Surface::new("bare", v2::Place::Route("bare".into()), view));
        Ok(())
    }
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.bare", setup }.into()]);
    harness.tui.navigate(Route::Plugin { id: "test.bare".to_owned(), name: "bare".to_owned() });
    for _ in 0..12 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(host::ledger().driving, 0);
    assert!(!harness.app.needs_frame());
}

#[test]
fn a_covered_canvas_rests() {
    PAD.with(|cell| *cell.borrow_mut() = Pad { animate: true, ..Pad::default() });
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let draws = || pad(|pad| pad.draws.len());
    let frames = |count: usize| {
        for _ in 0..count {
            let _ = frame(&harness, Duration::from_millis(16));
        }
    };
    let rests = |what: &str| {
        frames(3);
        let drawn = draws();
        frames(5);
        assert_eq!(draws(), drawn, "{what}: a covered canvas was drawn");
        assert!(!harness.app.needs_frame(), "{what}: a covered canvas asks for frames");
        assert_eq!(host::ledger().driving, 0, "{what}");
    };
    let animates = |what: &str| {
        frames(2);
        let drawn = draws();
        frames(4);
        assert_eq!(draws(), drawn + 4, "{what}: the canvas does not animate");
        let last = pad(|pad| pad.draws.last().unwrap().frame);
        assert_eq!((last.cause, last.dt), (v2::Cause::Animate, Duration::from_millis(16)), "{what}");
    };
    animates("open");
    let _ = harness.tui.keymap.dispatch("command.palette.show", None);
    assert!(harness.tui.dialogs.is_open());
    rests("under the palette");
    harness.tui.dialogs.clear();
    let _ = frame(&harness, Duration::from_millis(16));
    assert!(harness.app.needs_frame(), "an uncovered canvas asks for the frame that starts it");
    animates("the palette closed");
    let set = |input: &str| {
        let _ = harness.tui.keymap.dispatch("pad.set", Some(input));
    };
    set("cover=13x4");
    rests("under a box over all of it");
    set("cover=13x2");
    animates("under a box over half its rows");
    set("cover=4x4");
    animates("under a box over its first columns");
    set("cover=0x0");
    animates("uncovered");
}

#[test]
fn the_time_the_terminal_is_away_is_not_counted() {
    // Windows has no suspend command; only test the ordinary stall there.
    for suspend in [false, true].into_iter().filter(|suspend| !(cfg!(windows) && *suspend)) {
        CHART.with(|cell| *cell.borrow_mut() = Chart::default());
        let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.chart", setup: chart_setup }.into()]);
        harness.tui.navigate(chart_route());
        for _ in 0..3 {
            let _ = frame(&harness, Duration::from_millis(16));
        }
        if suspend {
            let _ = harness.tui.keymap.dispatch("terminal.suspend", None);
        }
        harness.app.advance(Duration::from_secs(5));
        let _ = harness.app.render();
        let dt = chart(|chart| chart.frames.last().unwrap().dt);
        match suspend {
            true => assert!(dt < Duration::from_millis(20), "the suspend was counted: {dt:?}"),
            false => assert!(dt >= Duration::from_secs(5), "a stall is the animation's time: {dt:?}"),
        }
    }
}

/// What each `test.load` plugin draws in each of its canvases.
#[derive(Clone, Copy, Debug)]
enum Load {
    /// Texts of 65,000 bytes, this many, at the canvas's left.
    Texts(usize),
    /// 1 x 1 fills at the canvas's corner, this many.
    Fills(usize),
}

thread_local! {
    /// How many canvases each `test.load` plugin shows, and what it draws in them.
    static LOAD: std::cell::Cell<(usize, Load)> = const { std::cell::Cell::new((1, Load::Fills(1))) };
    /// A version every canvas takes, which a test bumps for a draw of the same lists.
    static LOAD_VERSION: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
    static LOAD_DRAWS: RefCell<Vec<v2::Cause>> = const { RefCell::new(Vec::new()) };
}

const LOADS: [&str; 5] = ["test.load.a", "test.load.b", "test.load.c", "test.load.d", "test.load.e"];

/// A plugin with a row of canvases of 3 x 1 in the home footer's status, drawn as [`LOAD`] says.
fn load_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |_: &mut v2::View<'_>| {
        let (count, _) = LOAD.get();
        let canvases = (0..count)
            .map(|index| {
                v2::Node::canvas(format!("c{index}")).version(LOAD_VERSION.get()).layout(abi::Layout {
                    width: Some(abi::Width::Cells(3)),
                    height: Some(abi::Width::Cells(1)),
                    shrink: Some(false),
                    ..abi::Layout::default()
                })
            })
            .collect();
        v2::Node::row(canvases)
    };
    setup.command(abi::Command::new(format!("{}.bump", setup.id())), |_, _| {
        LOAD_VERSION.set(LOAD_VERSION.get() + 1);
    });
    let place = v2::Place::Slot(abi::Placement::append("home.footer.status"));
    setup.surface(v2::Surface::new("load", place, view).draw(|cx| {
        LOAD_DRAWS.with_borrow_mut(|draws| draws.push(cx.frame.cause));
        let mut list = List::new();
        match LOAD.get().1 {
            Load::Texts(count) => {
                let text = "x".repeat(65_000);
                for _ in 0..count {
                    list.text(0, 0, &text, list::Style::new());
                }
            }
            Load::Fills(count) => {
                for _ in 0..count {
                    list.fill(0, 0, 1, 1, abi::Rgba::new(0, 200, 0, 255));
                }
            }
        }
        Some(list)
    }));
    Ok(())
}

/// The TUI on home with `plugins` of the `test.load` plugins, each showing `canvases` canvases of `load`.
fn load_tui(plugins: usize, canvases: usize, load: Load) -> Harness {
    LOAD.set((canvases, load));
    LOAD_VERSION.set(0);
    let plugins = LOADS[..plugins].iter().map(|id| abi::Plugin { id, setup: load_setup }.into()).collect();
    let harness = open_tui(200, 30, plugins);
    let _ = frame(&harness, Duration::from_millis(16));
    harness
}

/// The bytes of one `Texts(14)` list.
fn texts_bytes() -> i64 {
    let mut list = List::new();
    for _ in 0..14 {
        list.text(0, 0, &"x".repeat(65_000), list::Style::new());
    }
    list.as_bytes().len() as i64
}

#[test]
fn one_plugin_holds_at_most_its_bytes() {
    let bytes = texts_bytes();
    let harness = load_tui(1, 5, Load::Texts(14));
    let owner = LOADS[0];
    assert_eq!((opencode_plugin::canvas::held(owner), host::ledger().lists), (4 * bytes, 4));
    let row = |frame: &Capture| (0..frame.height).map(|y| frame.row(y)).find(|row| row.contains("xxxcan"));
    assert!(row(&harness.app.render()).is_some_and(|row| row.contains("xxxxxxxxxxxxcan")), "the fifth is over");
    LOAD_DRAWS.take();
    let _ = harness.tui.keymap.dispatch(&format!("{owner}.bump"), None);
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!(LOAD_DRAWS.take(), [v2::Cause::Version; 5], "each canvas drew its new version in place");
    assert_eq!((opencode_plugin::canvas::held(owner), host::ledger().lists), (4 * bytes, 4));
    assert_eq!(host::ledger().canvases, 5);
    let shown = harness.app.render();
    assert!(row(&shown).is_some_and(|row| row.contains("xxxxxxxxxxxxcan")), "the four keep their places");
    assert_eq!(status(&harness, owner), opencode_plugin::Status::Active);
    harness.tui.navigate(Route::Plugin { id: "test.chart".to_owned(), name: "none".to_owned() });
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!((opencode_plugin::canvas::held(owner), host::ledger()), (0, Ledger::default()));
}

#[test]
fn all_canvases_hold_at_most_the_total() {
    let bytes = texts_bytes();
    let _harness = load_tui(5, 4, Load::Texts(14));
    let fit = opencode_plugin::canvas::TOTAL_BYTES / bytes;
    assert_eq!(host::ledger().lists, fit);
    assert_eq!(host::ledger().bytes, fit * bytes);
    assert!(LOADS.iter().all(|owner| opencode_plugin::canvas::held(owner) <= opencode_plugin::canvas::PLUGIN_BYTES));
}

#[test]
fn a_frame_records_at_most_its_bound() {
    let harness = load_tui(3, 3, Load::Fills(32_000));
    assert_eq!(host::ledger().lists, 9);
    for _ in 0..3 {
        let work = host::work();
        let frame = harness.app.try_render().expect("the frame goes on");
        let done = host::work().since(work);
        assert_eq!((done.replays, done.squeezed), (8, 1), "{done:?}");
        assert!(frame.text().contains("can"), "the ninth shows the placeholder");
    }
}

#[test]
fn a_list_is_charged_by_the_cells_it_touches() {
    let per = 12 * 3;
    let fit = opencode_plugin::canvas::LIST_CELLS / per;
    for (fills, over) in [(fit, false), (fit + 1, true)] {
        let mut list = List::new();
        for _ in 0..fills {
            list.fill(-5, -5, 40, 40, abi::Rgba::new(0, 0, 200, 255));
        }
        let harness = cells_tui(list);
        let shown = canvas_rows(&harness.app.render(), 12, 1)[0].starts_with("canvas over");
        assert_eq!(shown, over, "{fills} fills");
    }
    let fit = opencode_plugin::canvas::LIST_RECORDING / opencode_plugin::canvas::RECORD;
    for (fills, over) in [(fit, false), (fit + 1, true)] {
        let mut list = List::new();
        for _ in 0..fills {
            list.fill(0, 0, 1, 1, abi::Rgba::new(0, 0, 200, 255));
        }
        let harness = cells_tui(list);
        let shown = canvas_rows(&harness.app.render(), 12, 1)[0].starts_with("canvas over");
        assert_eq!(shown, over, "{fills} fills");
    }
    let mut outside = List::new();
    outside.cells(40, 0, 100, (0..60_000).map(|_| ('o', list::Style::new()))).fill(
        -9,
        0,
        9,
        3,
        abi::Rgba::new(9, 9, 9, 255),
    );
    let harness = cells_tui(outside);
    let _ = harness.app.render();
    let work = host::work();
    let _ = harness.app.render();
    let done = host::work().since(work);
    assert_eq!((done.replays, done.ops, done.recorded), (1, 0, 0), "{done:?}");
}

#[test]
fn a_kept_list_is_charged_at_its_new_size() {
    let pen = Pen(Some(abi::Rgba::new(255, 255, 255, 255)), None, 0);
    FIXED.with(|cell| *cell.borrow_mut() = Some(vec![Shape::Cells(0, 0, 30, vec![('#', pen); 30])]));
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let recorded = || {
        let _ = frame(&harness, Duration::from_millis(16));
        let work = host::work();
        let _ = frame(&harness, Duration::from_millis(16));
        host::work().since(work).recorded
    };
    // One record of the cells the row shows.
    let (record, cell) = (opencode_plugin::canvas::RECORD as u64, opencode_plugin::canvas::CELL as u64);
    assert_eq!(recorded(), record + 12 * cell);
    apply(&harness, &Command::Next(Next::Keep));
    apply(&harness, &Command::Size(20, 4));
    assert_eq!(recorded(), record + 20 * cell);
    FIXED.with(|cell| *cell.borrow_mut() = None);
}

#[test]
fn a_cell_draws_one_column() {
    let pen = list::Style::new().fg(abi::Rgba::new(255, 255, 255, 255));
    let odd = ['\u{301}', '\u{200B}', '\u{202E}', '🦀', '\u{7}', 'A'];
    let mut list = List::new();
    // 'â' takes the width cache's slot of '漢' (U+00E2 and U+6F22 are both 34 modulo 64), after it.
    list.cell(11, 0, '漢', pen).cell(0, 2, 'â', pen).cells(6, 1, 6, odd.map(|char| (char, pen)));
    let harness = cells_tui(list);
    for step in ["drawn", "replayed"] {
        let frame = frame_after_one(&harness);
        let (left, top) = origin(&frame).unwrap();
        let symbol = |x: u32, y: u32| frame.cell(left + x, top + y).unwrap().symbol.clone();
        assert_eq!((symbol(11, 0), symbol(12, 0), symbol(0, 2)), ("\u{FFFD}".into(), " ".into(), "â".into()), "{step}");
        let row: Vec<String> = (6..13).map(|x| symbol(x, 1)).collect();
        let replaced = "\u{FFFD}".to_owned();
        assert_eq!(row, [&replaced, &replaced, &replaced, &replaced, &replaced, "A", " "], "{step}");
    }
}

#[test]
fn a_canvas_hidden_by_an_ancestor_draws_no_stale_frame() {
    // Hidden for one frame, the frame its driver left waits; for three, the driver has stopped.
    for (bumped, pause, hidden) in [(true, true, 1), (false, true, 1), (false, true, 3), (false, false, 3)] {
        PAD.with(|cell| *cell.borrow_mut() = Pad { animate: true, ..Pad::default() });
        let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
        apply(&harness, &Command::Open);
        for _ in 0..3 {
            let _ = frame(&harness, Duration::from_millis(16));
        }
        let (left, top) = origin(&harness.app.render()).unwrap();
        let canvas = harness.app.widget_at(left as u16, top as u16).expect("the canvas is on screen");
        let row = canvas.parent().expect("the canvas's row");
        let _ = row.visible(false);
        for _ in 0..hidden {
            let _ = frame(&harness, Duration::from_millis(16));
        }
        if pause {
            apply(&harness, &Command::Animate(false));
        }
        if bumped {
            apply(&harness, &Command::Version);
        }
        let seen = pad(|pad| pad.draws.len());
        let _ = row.visible(true);
        let _ = frame(&harness, Duration::from_millis(16));
        let draws: Vec<(v2::Cause, Duration)> =
            pad(|pad| pad.draws[seen..].iter().map(|drawn| (drawn.frame.cause, drawn.frame.dt)).collect());
        // Still animating, it starts again once a presented frame shows it; the frame that shows it draws nothing.
        let expected: &[(v2::Cause, Duration)] = if bumped { &[(v2::Cause::Version, Duration::ZERO)] } else { &[] };
        assert_eq!(draws, expected, "bumped {bumped}, paused {pause}, hidden {hidden}");
    }
}

thread_local! {
    static PAIR_CALLS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// A plugin of two canvases whose first draws a list the host cannot read.
fn pair_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |_: &mut v2::View<'_>| {
        let canvas = |id: &str| {
            v2::Node::canvas(id).layout(abi::Layout {
                width: Some(abi::Width::Cells(4)),
                height: Some(abi::Width::Cells(1)),
                ..abi::Layout::default()
            })
        };
        v2::Node::column(vec![canvas("c0"), canvas("c1")])
    };
    setup.surface(v2::Surface::new("pair", v2::Place::Route("pair".into()), view).draw(|cx| {
        PAIR_CALLS.set(PAIR_CALLS.get() + 1);
        match cx.canvas {
            "c0" => Some(List::from_bytes(vec![list::VERSION, 1, 0, 0, 0, 0])),
            _ => Some(List::new()),
        }
    }));
    Ok(())
}

#[test]
fn a_draw_the_plugin_did_not_make_is_not_counted() {
    PAIR_CALLS.set(0);
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.pair", setup: pair_setup }.into()]);
    let work = host::work();
    harness.tui.navigate(Route::Plugin { id: "test.pair".to_owned(), name: "pair".to_owned() });
    let _ = frame(&harness, Duration::from_millis(16));
    let done = host::work().since(work);
    assert!(matches!(status(&harness, "test.pair"), opencode_plugin::Status::Failed(_)));
    assert_eq!((PAIR_CALLS.get(), done.draws, done.refused), (1, 1, 1), "{done:?}");
}

#[test]
fn a_still_draw_leaves_the_app_idle() {
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    for _ in 0..3 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert!(!harness.app.needs_frame());
    apply(&harness, &Command::Version);
    let seen = pad(|pad| pad.draws.len());
    let _ = frame(&harness, Duration::from_millis(16));
    assert_eq!(pad(|pad| pad.draws.len()), seen + 1);
    let _ = frame(&harness, Duration::from_millis(16));
    assert!(!harness.app.needs_frame(), "a still draw keeps the app awake");
}

/// A plugin whose route shows a canvas `depth` boxes deep, of `width`, memoized under the key `art`.
fn deep_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let view = |cx: &mut v2::View<'_>| {
        let (depth, width, version) = DEEP.get();
        let canvas = cx.memo("art", (width.to_bits(), version), |_| {
            v2::Node::canvas("unnamed").version(version).layout(abi::Layout {
                width: Some(abi::Width::Percent(width)),
                height: Some(abi::Width::Cells(1)),
                ..abi::Layout::default()
            })
        });
        (0..depth).fold(canvas, |inner, _| v2::Node::column(vec![inner]))
    };
    setup.surface(v2::Surface::new("deep", v2::Place::Route("deep".into()), view).draw(|_| Some(List::new())));
    setup.command(abi::Command::new("deep.redraw"), |_, _| {});
    Ok(())
}

thread_local! {
    /// The boxes around the deep plugin's canvas, its width in percent, and its version.
    static DEEP: std::cell::Cell<(usize, f32, u64)> = const { std::cell::Cell::new((0, 50.0, 0)) };
}

#[test]
fn a_canvas_counts_in_the_trees_bounds() {
    use opencode_plugin::reconcile;
    let open = |depth: usize, width: f32| {
        DEEP.set((depth, width, 0));
        let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.deep", setup: deep_setup }.into()]);
        harness.tui.navigate(Route::Plugin { id: "test.deep".to_owned(), name: "deep".to_owned() });
        let _ = frame(&harness, Duration::from_millis(16));
        harness
    };
    let failed = |harness: &Harness| matches!(status(harness, "test.deep"), opencode_plugin::Status::Failed(_));
    assert!(!failed(&open(reconcile::MAX_DEPTH as usize - 1, 50.0)), "63 boxes and a canvas");
    assert!(failed(&open(reconcile::MAX_DEPTH as usize, 50.0)), "64 boxes and a canvas");
    assert!(failed(&open(1, f32::NAN)), "a width that is not a number");
    assert_eq!(v2::Node::canvas("a").with_id("b").id(), Some("b"));

    let harness = open(1, 50.0);
    let redraw = |depth: usize, width: f32, version: u64| {
        DEEP.set((depth, width, version));
        let work = reconcile::work();
        let _ = harness.tui.keymap.dispatch("deep.redraw", None);
        let _ = frame(&harness, Duration::from_millis(16));
        reconcile::work().since(work)
    };
    let kept = redraw(1, 50.0, 0);
    assert_eq!((kept.kept, kept.touched()), (1, 0), "a memoized canvas is kept: {kept:?}");
    let set = redraw(1, 50.0, 1);
    assert_eq!((set.set, set.created, set.removed), (1, 0, 0), "a version in place: {set:?}");
    let built = redraw(1, 40.0, 1);
    assert_eq!((built.created, built.removed), (1, 1), "a layout builds it again: {built:?}");
}

#[test]
fn seeded_lists_have_the_cells_a_rasterizer_computes() {
    for seed in 0..model::seeds_or(40) {
        let shapes = shapes(&mut Rng::new(seed.wrapping_mul(31) + 7), 12, 4, 0, true);
        FIXED.with(|cell| *cell.borrow_mut() = Some(shapes.clone()));
        PAD.with(|cell| *cell.borrow_mut() = Pad::default());
        let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
        apply(&harness, &Command::Open);
        for step in ["drawn", "replayed"] {
            let frame = frame(&harness, Duration::from_millis(16));
            if let Some(detail) = unlike_raster(&frame, &shapes, (12, 4)) {
                FIXED.with(|cell| *cell.borrow_mut() = None);
                panic!("seed {seed}, {step}: {detail}\n{shapes:?}");
            }
        }
    }
    FIXED.with(|cell| *cell.borrow_mut() = None);
}

#[test]
fn a_run_is_a_record_a_row() {
    let mut list = List::new();
    list.cells(5, 1, 10, (0..30).map(|index| (char::from(b'a' + index as u8 % 26), list::Style::new())));
    list.cell(0, 0, 'z', list::Style::new());
    let harness = cells_tui(list);
    let (record, cell) = (opencode_plugin::canvas::RECORD as u64, opencode_plugin::canvas::CELL as u64);
    for step in ["drawn", "replayed"] {
        let work = host::work();
        let frame = frame_after_one(&harness);
        let done = host::work().since(work);
        assert_eq!((done.recorded, done.ops), (3 * record + 15 * cell, 15), "{step}: {done:?}");
        let rows = canvas_rows(&frame, 12, 3);
        assert_eq!(rows, ["z           ", "     abcdefg", "     klmnopq"], "{step}");
    }
}

thread_local! {
    /// The first byte of the 2 MiB list `test.huge`'s draw returns.
    static HUGE: std::cell::Cell<u8> = const { std::cell::Cell::new(list::VERSION) };
}
