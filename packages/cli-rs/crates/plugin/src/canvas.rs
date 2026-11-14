//! The host's side of a canvas ([`v2::Node::Canvas`], P5): a widget that paints the display list its plugin drew
//! ([`opencode_plugin_abi::canvas`]) and keeps it, so a frame the plugin did not draw replays it with no call.
//!
//! The host asks the surface's draw for a list, as one call of the plugin, after the frame's layout and before its
//! paint, with the size the canvas has in that frame; at most once a frame unless the size changes again:
//!
//! - when the canvas is laid out at a size it has no list for, first or after a resize: from its own resize;
//! - when its `version` changes: in the next frame;
//! - while it animates: in each frame after one that painted it. The driver is OpenTUI's `App::animate`, as the
//!   host's own spinners and shimmer have ([`opencode_ui::motion`]), with their rules: a canvas that a frame did not
//!   paint (hidden, scrolled out of view, under a closed route) stops at the driver's next tick and costs no frame and
//!   no wakeup; its next paint starts it again, and the time between is not counted. With the `animations` switch off
//!   it does not run, and the canvas keeps its last list.
//!
//! OpenTUI's `App` calls nothing between its layout and its paint but resize handlers, so a version or a frame of the
//! animation arms a hook, as S0's post-solve hook does: an absolute child of no height whose width flips, so the
//! layout resizes it and its handler draws with the frame's geometry. It comes after the canvas in the layout's walk,
//! so the canvas's own size is already the frame's.
//!
//! A list is checked whole before it is kept. One the host cannot read fails the plugin and the canvas keeps its last
//! list until the mount ends; one over a limit is dropped and the canvas shows a placeholder.
//!
//! What canvases hold is counted per thread outside any mount ([`ledger`]), and what they cost ([`work`]).

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::Duration;

use opencode_plugin_abi::canvas::{self as list, Op};
use opencode_plugin_abi::v2::{Cause, Frame};
use opencode_plugin_abi::{self as abi};
use opentui::native::BoxSpec;
use opentui::prelude::*;

/// How a mount's canvases call their plugin: `draw` runs the surface's draw for a canvas id, which gives a list or
/// nothing (the canvas keeps its list; also when the call failed, and the host then ends the mount), and `fail` fails
/// the plugin for a list the host cannot read.
pub struct Drawer {
    pub(crate) draw: Draw,
    pub(crate) fail: Box<dyn Fn(String)>,
}

pub(crate) type Draw = Box<dyn Fn(&str, Frame) -> Option<Vec<u8>>>;

/// What the canvases on this thread hold now.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Ledger {
    /// Canvases mounted.
    pub canvases: i64,
    /// Lists kept, and their bytes.
    pub lists: i64,
    pub bytes: i64,
    /// Canvases whose animation runs.
    pub driving: i64,
}

/// What canvases did on this thread, counted since it started.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Work {
    /// Calls of a plugin's draw.
    pub draws: u64,
    /// Lists the host checked and kept, and their bytes.
    pub lists: u64,
    pub bytes: u64,
    /// Lists dropped for a limit.
    pub over: u64,
    /// Lists refused as malformed.
    pub refused: u64,
    /// Paints of a kept list, and the operations they replayed.
    pub replays: u64,
    pub ops: u64,
}

impl Work {
    /// What happened between `before` and `self`.
    pub fn since(self, before: Work) -> Work {
        Work {
            draws: self.draws - before.draws,
            lists: self.lists - before.lists,
            bytes: self.bytes - before.bytes,
            over: self.over - before.over,
            refused: self.refused - before.refused,
            replays: self.replays - before.replays,
            ops: self.ops - before.ops,
        }
    }
}

thread_local! {
    static LEDGER: Cell<Ledger> = Cell::new(Ledger::default());
    static WORK: Cell<Work> = Cell::new(Work::default());
}

pub fn ledger() -> Ledger {
    LEDGER.with(Cell::get)
}

pub fn work() -> Work {
    WORK.with(Cell::get)
}

fn book(f: impl FnOnce(&mut Ledger)) {
    LEDGER.with(|cell| {
        let mut ledger = cell.get();
        f(&mut ledger);
        cell.set(ledger);
    });
}

fn count(f: impl FnOnce(&mut Work)) {
    WORK.with(|cell| {
        let mut work = cell.get();
        f(&mut work);
        cell.set(work);
    });
}

/// A mounted canvas: its widget and the state it keeps under its id.
pub(crate) struct Canvas {
    widget: Custom<Board>,
    state: Rc<State>,
}

/// A frame of the animation or a version, waiting for the layout.
#[derive(Clone, Copy)]
struct Pending {
    cause: Cause,
    dt: Duration,
}

/// What a canvas keeps while its id stays in the mount, also when its widget is built again.
struct State {
    id: String,
    app: App,
    drawer: Option<Rc<Drawer>>,
    shown: RefCell<Shown>,
    /// The size laid out last, as OpenTUI's resize reports it: a dimension of none reads as one cell.
    size: Cell<(u16, u16)>,
    /// Whether the canvas has room across and down: from its last paint, which sees a dimension of none as none, or
    /// from a resize to more than one cell.
    room: Cell<(bool, bool)>,
    /// The size and version the plugin was last asked to draw for.
    asked: Cell<Option<((u16, u16), u64)>>,
    version: Cell<u64>,
    animate: Cell<bool>,
    /// A draw that waits for the hook, and the widget's hook.
    pending: Cell<Option<Pending>>,
    hook: RefCell<Option<View>>,
    /// A frame painted the canvas since its driver's last tick.
    painted: Cell<bool>,
    driving: Cell<bool>,
}

enum Shown {
    Empty,
    List(Rc<[u8]>),
    /// The last list was over a limit.
    Over,
}

struct Board(Rc<State>);

impl Canvas {
    /// A canvas `id` that `drawer` draws, at `version`, animating or not.
    pub fn new(app: &App, id: &str, drawer: Option<Rc<Drawer>>, version: u64, animate: bool) -> Self {
        let state = Rc::new(State {
            id: id.to_owned(),
            app: app.clone(),
            drawer,
            shown: RefCell::new(Shown::Empty),
            size: Cell::new((0, 0)),
            room: Cell::new((true, true)),
            asked: Cell::new(None),
            version: Cell::new(version),
            animate: Cell::new(animate),
            pending: Cell::new(None),
            hook: RefCell::new(None),
            painted: Cell::new(false),
            driving: Cell::new(false),
        });
        book(|ledger| ledger.canvases += 1);
        Self::around(app, state)
    }

    /// A new widget for the same state: the canvas is built again with its list.
    pub fn rebuilt(&self, app: &App) -> Self {
        Self::around(app, self.state.clone())
    }

    fn around(app: &App, state: Rc<State>) -> Self {
        let weak = Rc::downgrade(&state);
        let widget = Custom::new(app, Board(state.clone())).on_resize(move |_, rect| {
            if let Some(state) = weak.upgrade() {
                let (width, height) = (rect.width.max(0.0) as u16, rect.height.max(0.0) as u16);
                let (across, down) = state.room.get();
                state.room.set((across || width > 1, down || height > 1));
                state.size.set((width, height));
                state.resized();
            }
        });
        let weak = Rc::downgrade(&state);
        let hook = View::new(app).absolute().width(1).height(0).on_resize(move |_, _| {
            // A draw from the canvas's own resize in this frame took the pending one.
            if let Some(state) = weak.upgrade()
                && let Some(pending) = state.pending.get()
            {
                state.draw(pending.cause);
            }
        });
        widget.add(&hook);
        *state.hook.borrow_mut() = Some(hook);
        Self { widget, state }
    }

    pub fn widget(&self) -> AnyWidget {
        self.widget.as_any()
    }

    /// Takes a revision's `version` and `animate`.
    /// A paint starts the driver, and one that stops ends at its next tick: the adoption that sets them asks for the
    /// frame.
    pub fn set(&self, version: u64, animate: bool) {
        let state = &self.state;
        state.animate.set(animate);
        if state.version.replace(version) != version {
            state.arm(Cause::Version, Duration::ZERO);
        }
    }
}

impl State {
    /// Laid out at a new size: a list for it, in this frame, unless it has one for that size and its version, as a
    /// canvas built again or back at its size does.
    fn resized(&self) {
        if let Some(cause) = self.stale() {
            self.draw(cause);
        }
    }

    /// Why the list the canvas holds is not the one for its size and version, if it is not.
    fn stale(&self) -> Option<Cause> {
        let (size, version) = (self.size.get(), self.version.get());
        match self.asked.get() {
            Some(asked) if asked == (size, version) => None,
            Some((asked, _)) if asked == size => Some(Cause::Version),
            Some(_) => Some(Cause::Resized),
            None => Some(Cause::First),
        }
    }

    /// Asks for a draw after the next layout: an animation's frame takes the place of a version, whose list it draws.
    fn arm(&self, cause: Cause, dt: Duration) {
        let pending = match self.pending.get() {
            Some(pending) if cause != Cause::Animate => pending,
            _ => Pending { cause, dt },
        };
        self.pending.set(Some(pending));
        if let Some(hook) = &*self.hook.borrow() {
            let width = if hook.rect().width >= 1.5 { 1 } else { 2 };
            hook.width(width);
        }
        self.app.request_redraw();
    }

    /// Asks the plugin for a list for this frame, and keeps it. A frame of the animation that waits is this draw:
    /// its time goes with it, whatever else asked.
    fn draw(&self, cause: Cause) {
        let pending = self.pending.take();
        let (width, height) = self.size.get();
        // A canvas with no room has nothing to draw; its paint asks again once it has room.
        let Some(drawer) = self.drawer.clone().filter(|_| width > 0 && height > 0 && self.room.get() == (true, true))
        else {
            return;
        };
        let dt = match pending {
            Some(Pending { cause: Cause::Animate, dt }) => dt,
            _ => Duration::ZERO,
        };
        self.asked.set(Some(((width, height), self.version.get())));
        count(|work| work.draws += 1);
        if let Some(bytes) = (drawer.draw)(&self.id, Frame { width, height, cause, dt }) {
            self.present(&drawer, bytes);
        }
    }

    /// Keeps `bytes` once they are checked: a list over a limit shows the placeholder, one the host cannot read
    /// fails the plugin and keeps the list before.
    fn present(&self, drawer: &Drawer, bytes: Vec<u8>) {
        let next = match list::check(&bytes) {
            Ok(_) => {
                count(|work| {
                    work.lists += 1;
                    work.bytes += bytes.len() as u64;
                });
                Shown::List(Rc::from(bytes))
            }
            Err(list::Error::Over { .. }) => {
                count(|work| work.over += 1);
                Shown::Over
            }
            Err(error) => {
                count(|work| work.refused += 1);
                (drawer.fail)(format!("canvas {}: {error}", self.id));
                return;
            }
        };
        let old = self.shown.replace(next);
        book(|ledger| {
            if let Shown::List(bytes) = &old {
                ledger.lists -= 1;
                ledger.bytes -= bytes.len() as i64;
            }
            if let Shown::List(bytes) = &*self.shown.borrow() {
                ledger.lists += 1;
                ledger.bytes += bytes.len() as i64;
            }
        });
        self.app.request_redraw();
    }

    /// Whether a frame ran since the tick that saw frame `seen` without painting the canvas. Moves `seen` on.
    fn missed(&self, app: &App, seen: &mut u64) -> bool {
        let frame = app.frame_number();
        let ran = std::mem::replace(seen, frame) != frame;
        ran && !self.painted.replace(false)
    }

    fn set_driving(&self, on: bool) {
        if self.driving.replace(on) != on {
            book(|ledger| ledger.driving += if on { 1 } else { -1 });
        }
    }
}

/// Runs a canvas's animation: a draw in each frame, until a frame did not paint it, it stops animating, its
/// plugin failed, or the `animations` switch is off.
fn drive(state: &Rc<State>) {
    state.set_driving(true);
    let weak = Rc::downgrade(state);
    let mut seen = state.app.frame_number();
    state.app.animate(move |cx, elapsed| {
        let Some(state) = weak.upgrade() else { return false };
        let app = cx.app();
        if !state.animate.get() || !opencode_ui::motion::running() || state.missed(app, &mut seen) {
            state.set_driving(false);
            return false;
        }
        state.arm(Cause::Animate, elapsed);
        true
    });
}

impl Drop for State {
    fn drop(&mut self) {
        let bytes = match &*self.shown.borrow() {
            Shown::List(bytes) => Some(bytes.len() as i64),
            _ => None,
        };
        let driving = self.driving.get();
        book(|ledger| {
            ledger.canvases -= 1;
            if let Some(bytes) = bytes {
                ledger.lists -= 1;
                ledger.bytes -= bytes;
            }
            if driving {
                ledger.driving -= 1;
            }
        });
    }
}

impl Component for Board {
    fn paint(&self, painter: &mut Painter<'_>) {
        let state = &self.0;
        // Room comes back without a resize when a dimension of none grows to one cell, which OpenTUI reports as the
        // same size: the list the canvas missed is drawn in the next frame.
        let room = (painter.width() > 0, painter.height() > 0);
        if state.room.replace(room) != room && room == (true, true) && state.stale().is_some() {
            let weak = Rc::downgrade(state);
            state.app.animate(move |_, _| {
                if let Some(state) = weak.upgrade()
                    && let Some(cause) = state.stale()
                {
                    state.arm(cause, Duration::ZERO);
                }
                false
            });
        }
        let (_, _, width, height) = painter.visible_rect();
        if width > 0 && height > 0 {
            state.painted.set(true);
            if state.animate.get() && !state.driving.get() && opencode_ui::motion::running() {
                drive(state);
            }
        }
        match &*state.shown.borrow() {
            Shown::Empty => {}
            Shown::List(bytes) => {
                let ops = replay(painter, &mut list::ops(bytes));
                count(|work| {
                    work.replays += 1;
                    work.ops += ops;
                });
            }
            Shown::Over => painter.text(0, 0, "canvas over its limit", Style::new().dim()),
        }
    }
}

/// Paints `ops` up to their end or the `pop` that closes the clip they are in; returns how many it painted.
fn replay<'a>(painter: &mut Painter<'_>, ops: &mut impl Iterator<Item = Op<'a>>) -> u64 {
    let mut painted = 0;
    while let Some(op) = ops.next() {
        painted += 1;
        match op {
            Op::Fill { x, y, width, height, color } => {
                painter.fill(x.into(), y.into(), width.into(), height.into(), rgba(color))
            }
            Op::Text { x, y, style, text } => painter.text(x.into(), y.into(), text, styled(style)),
            Op::Cell { x, y, style, char } => painter.cell(x.into(), y.into(), char, styled(style)),
            Op::Cells { x, y, width, cells } => {
                let width = usize::from(width.max(1));
                for (index, (style, char)) in cells.iter().enumerate() {
                    let (column, row) = ((index % width) as i32, (index / width) as i32);
                    painter.cell(i32::from(x) + column, i32::from(y) + row, char, styled(style));
                }
            }
            Op::Rect { x, y, width, height, border, color, background } => {
                let spec = BoxSpec {
                    style: border_style(border),
                    border_color: rgba(color),
                    background: background.map_or(Color::TRANSPARENT, rgba),
                    fill: background.is_some(),
                    ..BoxSpec::default()
                };
                painter.draw_box(x.into(), y.into(), width.into(), height.into(), &spec);
            }
            Op::Clip { x, y, width, height } => {
                painter
                    .clip(x.into(), y.into(), width.into(), height.into(), |painter| painted += replay(painter, ops));
            }
            Op::Pop => return painted,
        }
    }
    painted
}

fn rgba(color: abi::Rgba) -> Color {
    Color::rgba(color.r, color.g, color.b, color.a)
}

fn styled(style: list::Style) -> Style {
    let mut out = Style::new();
    if let Some(fg) = style.fg {
        out = out.fg(rgba(fg));
    }
    if let Some(bg) = style.bg {
        out = out.bg(rgba(bg));
    }
    for (on, attribute) in [
        (style.bold, Attributes::BOLD),
        (style.dim, Attributes::DIM),
        (style.italic, Attributes::ITALIC),
        (style.underline, Attributes::UNDERLINE),
        (style.inverse, Attributes::INVERSE),
        (style.strikethrough, Attributes::STRIKETHROUGH),
    ] {
        if on {
            out = out.add(attribute);
        }
    }
    out
}

fn border_style(border: abi::BorderStyle) -> BorderStyle {
    match border {
        abi::BorderStyle::Single => BorderStyle::Single,
        abi::BorderStyle::Double => BorderStyle::Double,
        abi::BorderStyle::Rounded => BorderStyle::Rounded,
        abi::BorderStyle::Heavy => BorderStyle::Heavy,
    }
}
