//! Canvases (P5; synthesis 4.2, 4.4, 4.11 and 4.14) on linked test plugins in the real TUI.
//!
//! The model's plugin, `test.pad`, shows one canvas on a route and draws it from shapes of its own, which it logs with
//! each draw: the generation, the frame, and what it returned. The properties:
//!
//! - **a replayed frame equals a drawn one**: on every frame, the canvas's cells equal a twin that paints the last
//!   list the plugin returned straight onto OpenTUI's `Painter`, from the plugin's own shapes, with none of the list's
//!   format, its check or the host's replay;
//! - **`work`**: a frame with no animation and no change makes no plugin call (no view, no draw) and checks no list,
//!   and replays the one it keeps; an animating canvas that shows gets one draw a frame;
//! - **`ledger`** for lists: the host holds one canvas while it shows, the list it was last given (its bytes, which
//!   the model computes), and an animation only while it runs; nothing once the canvas or its mount goes.
//!
//! Two wild plugins of 4.11 run beside it: an animated chart and a game of snake on its own timer and keys.

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

/// A foreground, a background or none, and bold.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Pen(abi::Rgba, Option<abi::Rgba>, bool);

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
    setup.command(abi::Command { name: "pad.set".into(), ..abi::Command::default() }, |_, input| {
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
            _ => {}
        });
    });
    setup.surface(v2::Surface::new("pad", v2::Place::Route("pad".into()), view).draw(draw));
    Ok(())
}

fn view(cx: &mut v2::View<'_>) -> v2::Node {
    let (shown, (width, height), version, animate, unkeyed, wrap, loose, auto) = pad(|pad| {
        pad.views += 1;
        pad.generation = cx.mount.generation;
        (pad.shown, pad.size, pad.version, pad.animate, pad.unkeyed, pad.wrap, pad.loose, pad.auto)
    });
    let fixed = abi::Layout {
        width: (!auto).then_some(abi::Width::Cells(width)),
        height: Some(abi::Width::Cells(height)),
        shrink: Some(false),
        min_width_zero: loose,
        ..abi::Layout::default()
    };
    let mut row = vec![v2::Node::text(vec![abi::Span::new(MARK)]).layout(abi::Layout::default().shrink(false))];
    if shown {
        let canvas = v2::Node::canvas("art").version(version).animate(animate).layout(fixed);
        let canvas = if unkeyed { v2::Node::Canvas { id: None, layout: fixed, version, animate } } else { canvas };
        row.push(if wrap { v2::Node::column(vec![canvas]) } else { canvas });
    }
    v2::Node::column(vec![v2::Node::row(row).bg(abi::Color::Rgba(BG))]).with_id("page")
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
    shapes(&mut rng, width, height, 0)
}

fn shapes(rng: &mut Rng, width: u16, height: u16, depth: u8) -> Vec<Shape> {
    const COLORS: [abi::Rgba; 5] = [
        abi::Rgba::new(200, 40, 40, 255),
        abi::Rgba::new(40, 200, 90, 255),
        abi::Rgba::new(230, 230, 230, 255),
        abi::Rgba::new(250, 200, 0, 255),
        abi::Rgba::new(90, 90, 250, 128),
    ];
    const TEXTS: [&str; 4] = ["ab", "score 120", "█▓░", "x"];
    const CHARS: [char; 6] = ['#', '@', '█', '·', 'o', '─'];
    let x = |rng: &mut Rng| rng.below(usize::from(width) + 4) as i16 - 2;
    let y = |rng: &mut Rng| rng.below(usize::from(height) + 2) as i16 - 1;
    let size = |rng: &mut Rng, of: u16| rng.below(usize::from(of) + 3) as u16;
    let color = |rng: &mut Rng| *rng.pick(&COLORS);
    let pen = |rng: &mut Rng| Pen(color(rng), (rng.below(2) == 0).then(|| color(rng)), rng.below(3) == 0);
    (0..1 + rng.below(5))
        .map(|_| match rng.below(if depth < 2 { 6 } else { 5 }) {
            0 => Shape::Fill(x(rng), y(rng), size(rng, width), size(rng, height), color(rng)),
            1 => Shape::Text(x(rng), y(rng), rng.pick(&TEXTS), pen(rng)),
            2 => Shape::Cell(x(rng), y(rng), *rng.pick(&CHARS), pen(rng)),
            3 => {
                let columns = 1 + rng.below(5) as u16;
                let cells = (0..rng.below(12)).map(|_| (*rng.pick(&CHARS), pen(rng))).collect();
                Shape::Cells(x(rng), y(rng), columns, cells)
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
                Shape::Clip(left, top, clip_width, clip_height, shapes(rng, width, height, depth + 1))
            }
        })
        .collect()
}

/// The list of `shapes`, written with the SDK's builder.
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
        list::Style { fg: Some(pen.0), bg: pen.1, bold: pen.2, ..list::Style::new() }
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
        let mut style = opentui::style::Style::new().fg(rgba(pen.0));
        if let Some(bg) = pen.1 {
            style = style.bg(rgba(bg));
        }
        if pen.2 { style.bold() } else { style }
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

    /// What a canvas laid out now asks for: nothing when it has a list for its size and version.
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
                    reference.mounted = (on_route && !reference.dead).then(|| pad(|pad| pad.generation));
                    if let Some(generation) = reference.mounted {
                        if generation <= reference.highest {
                            return fail("lifecycle", "mount", format!("generation {generation} opened again"));
                        }
                        reference.highest = generation;
                    }
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
            let draws: Vec<Drawn> = pad(|pad| pad.draws[seen..].to_vec());
            let animating = was_animating && reference.animating();
            let asked = match command {
                Command::Open | Command::Show(true) | Command::Size(..) => reference.laid_out(),
                Command::Version if reference.drawable() && animating => Some(v2::Cause::Animate),
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
                return fail("work", "idle", "a frame with nothing to animate wants another".into());
            }
            let bytes = match &reference.held {
                Some(Held::Art(shapes)) if reference.showing() => Some(encode(shapes).as_bytes().len() as i64),
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

// Expected: the properties of P5 over random runs of the pad: a replayed frame equals a drawn one, `work` for a still
// frame, `ledger` for lists, and `lifecycle` for draws: a draw only for the mount that shows, at the canvas's size.
#[test]
fn canvases_hold_their_properties() {
    model::check(&Canvases, 64, 24);
}

/// The cells of a canvas by a rasterizer of this test's own, for opaque fills, text and cells under clips: a second
/// oracle, which shares no code with OpenTUI's painter either.
fn raster(shapes: &[Shape], width: u16, height: u16) -> Vec<Vec<(char, abi::Rgba)>> {
    /// A clip as left, top, right and bottom.
    type Clip = (i32, i32, i32, i32);
    struct Grid(Vec<Vec<(char, abi::Rgba)>>);
    impl Grid {
        fn set(&mut self, clip: Clip, x: i32, y: i32, char: char, bg: Option<abi::Rgba>) {
            if x < clip.0 || y < clip.1 || x >= clip.2 || y >= clip.3 {
                return;
            }
            let cell = &mut self.0[y as usize][x as usize];
            cell.0 = char;
            if let Some(bg) = bg {
                cell.1 = bg;
            }
        }

        fn walk(&mut self, shapes: &[Shape], clip: Clip) {
            for shape in shapes {
                match shape {
                    Shape::Fill(x, y, width, height, color) => {
                        for row in 0..i32::from(*height) {
                            for column in 0..i32::from(*width) {
                                self.set(clip, i32::from(*x) + column, i32::from(*y) + row, ' ', Some(*color));
                            }
                        }
                    }
                    Shape::Text(x, y, text, pen) => {
                        for (index, char) in text.chars().enumerate() {
                            self.set(clip, i32::from(*x) + index as i32, i32::from(*y), char, pen.1);
                        }
                    }
                    Shape::Cell(x, y, char, pen) => self.set(clip, i32::from(*x), i32::from(*y), *char, pen.1),
                    Shape::Clip(x, y, width, height, inner) => {
                        let (x, y) = (i32::from(*x), i32::from(*y));
                        let inner_clip = (
                            clip.0.max(x),
                            clip.1.max(y),
                            clip.2.min(x + i32::from(*width)),
                            clip.3.min(y + i32::from(*height)),
                        );
                        self.walk(inner, inner_clip);
                    }
                    Shape::Cells(..) | Shape::Rect(..) => unreachable!("the raster draws fills, text, cells and clips"),
                }
            }
        }
    }
    let mut grid = Grid(vec![vec![(' ', BG); usize::from(width)]; usize::from(height)]);
    grid.walk(shapes, (0, 0, i32::from(width), i32::from(height)));
    grid.0
}

// Expected (a replayed frame equals a drawn one, a second oracle): the canvas on screen holds the characters and the
// backgrounds a plain rasterizer computes for opaque fills, text and cells under nested clips, on the frame the
// plugin drew and on later frames that replay the list.
#[test]
fn a_list_on_screen_has_the_cells_a_rasterizer_computes() {
    let red = abi::Rgba::new(200, 0, 0, 255);
    let green = abi::Rgba::new(0, 200, 0, 255);
    let white = abi::Rgba::new(255, 255, 255, 255);
    let shapes = vec![
        Shape::Fill(1, 0, 6, 3, red),
        Shape::Text(-1, 1, "score 120", Pen(white, None, false)),
        Shape::Clip(
            2,
            0,
            4,
            4,
            vec![
                Shape::Fill(0, 2, 12, 1, green),
                Shape::Clip(3, 0, 9, 9, vec![Shape::Cell(4, 3, '@', Pen(white, Some(red), true))]),
                Shape::Cell(1, 3, '#', Pen(white, None, false)),
            ],
        ),
        Shape::Cell(11, 3, '█', Pen(green, Some(white), false)),
    ];
    PAD.with(|cell| *cell.borrow_mut() = Pad::default());
    FIXED.with(|cell| *cell.borrow_mut() = Some(shapes.clone()));
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let expected = raster(&shapes, 12, 4);
    for step in 0..3 {
        let frame = frame(&harness, Duration::from_millis(16));
        let (left, top) = origin(&frame).unwrap();
        for (y, row) in expected.iter().enumerate() {
            for (x, (char, bg)) in row.iter().enumerate() {
                let cell = frame.cell(left + x as u32, top + y as u32).unwrap();
                assert_eq!(
                    (cell.symbol.chars().next().unwrap_or(' '), cell.bg),
                    (*char, opentui::style::Color::rgba(bg.r, bg.g, bg.b, bg.a)),
                    "frame {step}, cell ({x}, {y}): row {:?}",
                    frame.row(top + y as u32)
                );
            }
        }
    }
    assert_eq!(pad(|pad| pad.draws.len()), 1, "the frames after the first replay the list");
    FIXED.with(|cell| *cell.borrow_mut() = None);
}

thread_local! {
    /// Shapes the pad's next drawings use instead of its generator's.
    static FIXED: RefCell<Option<Vec<Shape>>> = const { RefCell::new(None) };
}

// Expected: a canvas without an id is refused as a scroll without one is, since a node with state must have one:
// the host asks again for a whole tree, and a second refusal in a row fails the plugin, which never drew.
#[test]
fn a_canvas_without_an_id_is_refused() {
    PAD.with(|cell| *cell.borrow_mut() = Pad { unkeyed: true, ..Pad::default() });
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    assert!(
        matches!(status(&harness, ID), opencode_plugin::Status::Failed(ref error) if error.contains("a scroll or a canvas has no id")),
        "{:?}",
        status(&harness, ID)
    );
    assert_eq!(pad(|pad| (pad.views, pad.draws.len())), (2, 0));
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
    let scoped = |name: &str, key: &str| abi::Command {
        name: name.into(),
        keybind: Some(key.into()),
        scope: abi::Scope::Route("chart".into()),
        ..abi::Command::default()
    };
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

// Expected (4.11, the animated chart): the chart is drawn once a painted frame with the frame's time; on a frame
// with nothing to draw the host replays its list. Away from its route it costs no draw, no frame and no wakeup, and
// the time away is not counted when it shows again. In its still mode a frame makes no call, and a new data point
// draws it once.
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

/// The game of 4.11: a snake on a board, stepped every 100 ms of the host's frame time, turned by the route's keys,
/// paused with space. It moves only by its frames, so it runs no timer of its own.
struct Snake {
    body: std::collections::VecDeque<(i16, i16)>,
    heading: (i16, i16),
    /// The time since the last step.
    pending: Duration,
    paused: bool,
    frames: Vec<v2::Frame>,
}

const BOARD: (u16, u16) = (20, 10);
const STEP: Duration = Duration::from_millis(100);

impl Default for Snake {
    fn default() -> Self {
        Self {
            body: [(5, 5), (4, 5), (3, 5)].into(),
            heading: (1, 0),
            pending: Duration::ZERO,
            paused: false,
            frames: Vec::new(),
        }
    }
}

thread_local! {
    static SNAKE: RefCell<Snake> = RefCell::default();
}

fn snake<T>(f: impl FnOnce(&mut Snake) -> T) -> T {
    SNAKE.with(|snake| f(&mut snake.borrow_mut()))
}

fn snake_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let scoped = |name: &str, key: &str| abi::Command {
        name: name.into(),
        keybind: Some(key.into()),
        scope: abi::Scope::Route("snake".into()),
        ..abi::Command::default()
    };
    for (name, key, heading) in [
        ("snake.up", "up", (0, -1)),
        ("snake.down", "down", (0, 1)),
        ("snake.left", "left", (-1, 0)),
        ("snake.right", "right", (1, 0)),
    ] {
        setup.command(scoped(name, key), move |_, _| snake(|snake| snake.heading = heading));
    }
    setup.command(scoped("snake.pause", "space"), |_, _| snake(|snake| snake.paused = !snake.paused));
    let view = |_: &mut v2::View<'_>| {
        let paused = snake(|snake| snake.paused);
        let board = v2::Node::canvas("board").version(u64::from(paused)).animate(!paused).layout(abi::Layout {
            width: Some(abi::Width::Cells(BOARD.0)),
            height: Some(abi::Width::Cells(BOARD.1)),
            shrink: Some(false),
            ..abi::Layout::default()
        });
        v2::Node::column(vec![v2::Node::row(vec![v2::Node::text(vec![abi::Span::new(MARK)]), board])]).with_id("snake")
    };
    setup.surface(v2::Surface::new("snake", v2::Place::Route("snake".into()), view).draw(|cx| {
        let frame = cx.frame;
        let (body, paused) = snake(|snake| {
            snake.frames.push(frame);
            snake.pending += frame.dt;
            while snake.pending >= STEP {
                snake.pending -= STEP;
                let head = snake.body[0];
                let next = (
                    (head.0 + snake.heading.0).rem_euclid(BOARD.0 as i16),
                    (head.1 + snake.heading.1).rem_euclid(BOARD.1 as i16),
                );
                snake.body.push_front(next);
                snake.body.pop_back();
            }
            (snake.body.clone(), snake.paused)
        });
        let mut list = List::new();
        list.fill(0, 0, frame.width, frame.height, abi::Rgba::new(0, 40, 0, 255));
        let pen = list::Style::new().fg(abi::Rgba::new(250, 250, 120, 255));
        for (index, (x, y)) in body.iter().enumerate() {
            list.cell(*x, *y, if index == 0 { '@' } else { 'o' }, pen);
        }
        if paused {
            list.text(0, 0, "paused", pen);
        }
        Some(list)
    }));
    Ok(())
}

/// Where the snake's head is on the board in `frame`.
fn head(frame: &Capture) -> (usize, usize) {
    let rows = canvas_rows(frame, u32::from(BOARD.0), u32::from(BOARD.1));
    rows.iter()
        .enumerate()
        .find_map(|(y, row)| row.chars().position(|char| char == '@').map(|x| (x, y)))
        .unwrap_or_else(|| panic!("no head on the board:\n{}", rows.join("\n")))
}

// Expected (4.11, the game): the snake steps on the host's frames, 100 ms of frame time a step; a key of its route
// turns it and the frames that follow draw the turn; space pauses it, and a paused game costs no draw, no frame and
// no wakeup, and does not count the pause when it goes on.
#[test]
fn the_game_steps_on_the_hosts_frames_and_turns_on_its_keys() {
    SNAKE.with(|cell| *cell.borrow_mut() = Snake::default());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.snake", setup: snake_setup }.into()]);
    harness.tui.navigate(Route::Plugin { id: "test.snake".to_owned(), name: "snake".to_owned() });
    let first = frame(&harness, Duration::from_millis(1));
    assert_eq!(head(&first), (5, 5));
    let mut last = first;
    for _ in 0..7 {
        last = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(head(&last), (6, 5), "seven frames of 16 ms are one step");
    harness.app.press("down");
    for _ in 0..13 {
        last = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(head(&last), (6, 7), "two steps down after the key");
    assert_eq!(snake(|snake| snake.frames.len()), 21, "one draw a frame");

    harness.app.press("space");
    let paused = frame(&harness, Duration::from_millis(1));
    assert!(canvas_rows(&paused, u32::from(BOARD.0), 1)[0].starts_with("paused"));
    let drawn = snake(|snake| snake.frames.len());
    for _ in 0..5 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    harness.app.advance(Duration::from_secs(2));
    assert_eq!(snake(|snake| snake.frames.len()), drawn, "a paused game was drawn");
    assert!(!harness.app.needs_frame(), "a paused game asks for frames");
    assert_eq!(host::ledger().driving, 0);

    harness.app.press("space");
    for _ in 0..7 {
        last = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(head(&last), (6, 8), "the pause was counted as time to step");
}

/// What the gate's full-screen canvas does: animate a new screen of cells each frame, animate the same screen each
/// frame (so the terminal gets no output), keep its list, or have none.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Mode {
    #[default]
    Animate,
    Same,
    Still,
    Empty,
}

#[derive(Default)]
struct Full {
    mode: Mode,
    frame: u64,
    /// The plugin's own time to build each list, and the last list's bytes.
    built: Vec<Duration>,
    last: Vec<u8>,
    /// Keys of the route that asked for a new screen.
    version: u64,
}

thread_local! {
    static FULL: RefCell<Full> = RefCell::default();
}

fn full_setup(setup: &mut abi::Setup) -> Result<(), String> {
    let key = abi::Command {
        name: "full.next".into(),
        keybind: Some("k".into()),
        scope: abi::Scope::Route("full".into()),
        ..abi::Command::default()
    };
    setup.command(key, |_, _| FULL.with(|full| full.borrow_mut().version += 1));
    let view = |_: &mut v2::View<'_>| {
        let (mode, version) = FULL.with(|full| (full.borrow().mode, full.borrow().version));
        let canvas = v2::Node::canvas("screen")
            .version(version)
            .animate(matches!(mode, Mode::Animate | Mode::Same))
            .layout(abi::Layout { grow: true, shrink: Some(false), ..abi::Layout::default() });
        v2::Node::column(vec![canvas]).layout(abi::Layout { grow: true, ..abi::Layout::default() }).with_id("full")
    };
    setup.surface(v2::Surface::new("full", v2::Place::Route("full".into()), view).draw(|cx| {
        let started = std::time::Instant::now();
        let (mode, frame) = FULL.with(|full| {
            let mut full = full.borrow_mut();
            full.frame += 1;
            (full.mode, full.frame)
        });
        if mode == Mode::Empty {
            return None;
        }
        let frame = if mode == Mode::Same { 0 } else { frame };
        // A new screen each frame: every cell's character and colors change, as a simulation's would.
        let (width, height) = (cx.frame.width, cx.frame.height);
        let cells = (0..u32::from(width) * u32::from(height)).map(|index| {
            let seed = (index as u64 ^ frame.wrapping_mul(0x9e37_79b9)).wrapping_mul(0x2545_f491_4f6c_dd1d) >> 40;
            let char = ['█', '▓', '▒', '░', ' ', '·'][(seed % 6) as usize];
            let fg = abi::Rgba::new(seed as u8, (seed >> 8) as u8, (seed >> 16) as u8, 255);
            (char, list::Style::new().fg(fg).bg(abi::Rgba::new(0, 0, (seed >> 4) as u8, 255)))
        });
        let mut list = List::new();
        list.cells(0, 0, width, cells);
        let built = started.elapsed();
        FULL.with(|full| {
            let mut full = full.borrow_mut();
            full.built.push(built);
            full.last = list.as_bytes().to_vec();
        });
        Some(list)
    }));
    Ok(())
}

fn percentile(samples: &mut [Duration], at: f64) -> f64 {
    samples.sort();
    let index = ((samples.len() - 1) as f64 * at).round() as usize;
    samples[index].as_secs_f64() * 1e6
}

/// Times `frames` frames of 16 ms each: the frame (`App::present`, with its output) and the plugin's own build.
fn timed(harness: &Harness, frames: usize) -> (Vec<Duration>, Vec<Duration>) {
    FULL.with(|full| full.borrow_mut().built.clear());
    let mut times = Vec::with_capacity(frames);
    for _ in 0..frames {
        harness.app.advance(Duration::from_millis(16));
        let started = std::time::Instant::now();
        harness.app.present().unwrap();
        times.push(started.elapsed());
    }
    (times, FULL.with(|full| std::mem::take(&mut full.borrow_mut().built)))
}

// The gate of P5 (synthesis 4.4, 6; S2's limit): host time a frame for a full-screen canvas that draws a new screen
// of cells at 60 fps, at the parity harness's size and at 200x60, against 1 ms. Ignored; a release build runs it with
// `--ignored plugin_canvas::a_full_screen_canvas --nocapture` and prints, in µs, p50 and p99 of: the whole frame
// animating a new screen each frame, the plugin's own build of its list, the same for a screen that does not change
// (the frame then writes nothing to the terminal), the frame replaying a kept list, the frame of a canvas with no
// list, a key of the route to the frame whose cells show the screen it asked for (with the frame's copy of its
// cells), and the host's check of one list.
#[test]
#[ignore]
fn a_full_screen_canvas_at_60_fps() {
    const FRAMES: usize = 600;
    for (width, height) in [(100, 30), (200, 60)] {
        FULL.with(|full| *full.borrow_mut() = Full::default());
        let harness = open_tui(width, height, vec![abi::Plugin { id: "test.full", setup: full_setup }.into()]);
        let route = Route::Plugin { id: "test.full".to_owned(), name: "full".to_owned() };
        harness.tui.navigate(route.clone());
        let _ = timed(&harness, 60);
        let work = host::work();
        let (mut animated, mut built) = timed(&harness, FRAMES);
        let done = host::work().since(work);
        assert_eq!(done.draws, FRAMES as u64, "one draw a frame");
        let bytes = FULL.with(|full| full.borrow().last.clone());
        FULL.with(|full| full.borrow_mut().mode = Mode::Same);
        harness.tui.navigate(Route::Home);
        harness.tui.navigate(route.clone());
        let _ = timed(&harness, 60);
        let (mut same, mut same_built) = timed(&harness, FRAMES);
        FULL.with(|full| full.borrow_mut().mode = Mode::Still);
        harness.tui.navigate(Route::Home);
        harness.tui.navigate(route.clone());
        let _ = timed(&harness, 60);
        let work = host::work();
        let (mut replayed, _) = timed(&harness, FRAMES);
        let still = host::work().since(work);
        assert_eq!((still.draws, still.replays), (0, FRAMES as u64), "a still canvas is replayed, not drawn");
        // A key of the route asks for a new screen: from the key to the frame that shows it, the cells read back.
        let mut keyed: Vec<Duration> = (0..FRAMES / 4)
            .map(|_| {
                harness.app.advance(Duration::from_millis(16));
                let started = std::time::Instant::now();
                harness.app.press("k");
                let frame = harness.app.render();
                let took = started.elapsed();
                let shown = FULL.with(|full| full.borrow().last.clone());
                let first = list::ops(&shown).find_map(|op| match op {
                    list::Op::Cells { cells, .. } => cells.iter().next(),
                    _ => None,
                });
                let cell = frame.cell(0, 0).unwrap();
                assert_eq!(cell.symbol.chars().next(), first.map(|(_, char)| char), "the key's screen is on screen");
                took
            })
            .collect();
        FULL.with(|full| full.borrow_mut().mode = Mode::Empty);
        harness.tui.navigate(Route::Home);
        harness.tui.navigate(route);
        let _ = timed(&harness, 60);
        let (mut empty, _) = timed(&harness, FRAMES);
        let mut checks: Vec<Duration> = (0..FRAMES)
            .map(|_| {
                let started = std::time::Instant::now();
                std::hint::black_box(list::check(std::hint::black_box(&bytes)).unwrap());
                started.elapsed()
            })
            .collect();
        let line = |name: &str, samples: &mut [Duration]| {
            format!("{name} {:.1} {:.1}", percentile(samples, 0.5), percentile(samples, 0.99))
        };
        eprintln!(
            "canvas-gate {width}x{height} bytes={} | {} | {} | {} | {} | {} | {} | {} | {}",
            bytes.len(),
            line("animated", &mut animated),
            line("built", &mut built),
            line("same", &mut same),
            line("same-built", &mut same_built),
            line("replayed", &mut replayed),
            line("empty", &mut empty),
            line("key", &mut keyed),
            line("check", &mut checks),
        );
    }
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
        };
        v2::Node::column(vec![scroll]).with_id("tall")
    };
    setup.surface(v2::Surface::new("tall", v2::Place::Route("tall".into()), view).draw(|cx| {
        TALL.with(|frames| frames.borrow_mut().push(cx.frame.cause));
        let mut list = List::new();
        list.fill(0, 0, cx.frame.width, cx.frame.height, abi::Rgba::new(200, 0, 0, 255));
        Some(list)
    }));
    Ok(())
}

thread_local! {
    static TALL: RefCell<Vec<v2::Cause>> = const { RefCell::new(Vec::new()) };
}

// Expected (the client's motion rules): an animating canvas that a frame does not paint, because its scroll shows
// other rows, is not drawn and asks for no frame; scrolled into view it animates, and scrolled out again it rests
// within two frames.
#[test]
fn an_animating_canvas_out_of_view_rests() {
    TALL.with(|frames| frames.borrow_mut().clear());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.tall", setup: tall_setup }.into()]);
    harness.tui.navigate(Route::Plugin { id: "test.tall".to_owned(), name: "tall".to_owned() });
    let causes = || TALL.with(|frames| frames.borrow().clone());
    for _ in 0..4 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
    assert_eq!(causes(), [v2::Cause::First], "a canvas out of view was animated");
    assert!(!harness.app.needs_frame());
    let row = (0..24).find(|y| harness.app.render().row(*y).contains("row 0")).unwrap() as u16;
    for _ in 0..10 {
        harness.app.scroll(2, row + 1, true);
    }
    for _ in 0..4 {
        let _ = frame(&harness, Duration::from_millis(16));
    }
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

// Expected (`reported-once` for a draw): a draw that panics fails its plugin once, named as the call it was, and
// what the canvas held goes with the mount; a list the host cannot read fails it too, named by the canvas.
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
            min_width_zero: true,
            height: Some(abi::Width::Cells(1)),
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

// Expected: a canvas at the root of a slot surface takes its own layout there, as a box at a slot's root does: a
// growing canvas grows in the slot's row. It is drawn at that size.
#[test]
fn a_canvas_at_a_slots_root_takes_its_layout() {
    SLOT.with(|frames| frames.borrow_mut().clear());
    let harness = open_tui(80, 24, vec![abi::Plugin { id: "test.badge", setup: slot_setup }.into()]);
    let screen = frame(&harness, Duration::from_millis(16)).text();
    let frames = SLOT.with(|frames| frames.borrow().clone());
    assert_eq!(frames.iter().map(|frame| (frame.height, frame.cause)).collect::<Vec<_>>(), [(1, v2::Cause::First)]);
    assert!(frames[0].width >= 10, "the slot's room, not the canvas's own: {frames:?}");
    assert!(screen.contains("§badge§"), "{screen}");
}

// Expected: arming a canvas's hook for a version moves nothing: a canvas with no width of its own keeps its size,
// so each version draws it once at that size and no resize follows.
#[test]
fn a_version_leaves_the_canvas_its_size() {
    PAD.with(|cell| *cell.borrow_mut() = Pad { auto: true, ..Pad::default() });
    let harness = open_tui(80, 24, vec![abi::Plugin { id: ID, setup }.into()]);
    apply(&harness, &Command::Open);
    let _ = frame(&harness, Duration::from_millis(1));
    for _ in 0..3 {
        apply(&harness, &Command::Version);
        let _ = frame(&harness, Duration::from_millis(16));
        let _ = frame(&harness, Duration::from_millis(16));
    }
    let draws: Vec<(u16, u16, v2::Cause)> =
        pad(|pad| pad.draws.iter().map(|drawn| (drawn.frame.width, drawn.frame.height, drawn.frame.cause)).collect());
    let size = (draws[0].0, draws[0].1);
    let causes = [v2::Cause::First, v2::Cause::Version, v2::Cause::Version, v2::Cause::Version];
    assert_eq!(draws, causes.map(|cause| (size.0, size.1, cause)));
}
