//! The host's side of a canvas ([`v2::Node::Canvas`], P5): a widget that paints the display list its plugin drew
//! ([`opencode_plugin_abi::canvas`]) and keeps it, so a frame the plugin did not draw replays it with no call.
//!
//! The host asks the surface's draw for a list from the canvas's paint, which OpenTUI runs after the last layout
//! round, with the size the canvas has in that frame; at most once a frame:
//!
//! - when the canvas shows at a size or a version it has no list for: first, after a resize, after a new `version`;
//! - while it animates: in each frame after one that showed it. The driver is OpenTUI's `App::animate`, as the
//!   host's own spinners and shimmer have ([`opencode_ui::motion`]), with their rules: a canvas the last frame did not
//!   show (hidden, scrolled out of view, under a closed route, or covered by what is drawn over it: none of a few
//!   samples of it is the canvas's in that frame's hit grid) stops at the driver's next tick and costs no frame and no
//!   wakeup; it starts again once a frame shows it, and the time between is not counted. With the `animations` switch
//!   off it does not run, and the canvas keeps its last list. A canvas without a draw does not animate. The time the
//!   terminal is handed to another program ([`handover`]) is not counted either.
//!
//! What lists cost the host is bounded: each list by its recording and the cells it touches at the size it is drawn
//! at (what lands outside the canvas is culled), the lists a plugin's canvases hold and all canvases hold, and the
//! recording of a frame's canvases. Over a bound a canvas shows a placeholder; the frame goes on.
//!
//! A canvas that does not show (out of view, or with no room: a dimension of none, which only the painter sees, since
//! OpenTUI's `rect()` and resize report one cell) is not drawn; it is drawn in the paint that shows it again.
//!
//! A draw inside a paint is a plugin call like any other, timed and caught at the host's edge, and it can only read:
//! it returns a list or nothing. What a failure does (the plugin fails, its mounts end, the budget's reports) is
//! deferred until the frame is done, so the paint changes no widget but the canvas's own list.
//!
//! A list is checked whole before it is kept. One the host cannot read fails the plugin and the canvas keeps its last
//! list until the mount ends; one over a limit is dropped and the canvas shows a placeholder.
//!
//! What canvases hold is counted per thread outside any mount ([`ledger`]), and what they cost ([`work`]).

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::time::{Duration, Instant};

use opencode_plugin_abi::canvas::{self as list, Op};
use opencode_plugin_abi::v2::{Cause, Frame};
use opencode_plugin_abi::{self as abi};
use opentui::native::BoxSpec;
use opentui::prelude::*;

/// How a mount's canvases call their plugin: `draw` runs the surface's draw for a canvas id, which gives a list or
/// nothing (the canvas keeps its list; also when the call failed, and the host then ends the mount), and `fail` fails
/// the plugin for a list the host cannot read.
pub struct Drawer {
    /// The plugin whose lists these are: what its canvases hold is charged to it.
    pub(crate) owner: Rc<str>,
    pub(crate) draw: Draw,
    pub(crate) fail: Box<dyn Fn(String)>,
}

/// The most list bytes the canvases of one plugin may hold together.
pub const PLUGIN_BYTES: i64 = 4 << 20;
/// The most list bytes all canvases may hold together.
pub const TOTAL_BYTES: i64 = 16 << 20;
/// The most renderer recording, in bytes, that one list may ask for at the size it is drawn at.
pub const LIST_RECORDING: usize = 4 << 20;
/// The most cells one list may touch at that size, a fill counting each cell of it in the canvas.
pub const LIST_CELLS: usize = 1 << 18;
/// The most renderer recording the canvases of one frame may ask for together: half of what OpenTUI records in a
/// frame (`OT_SCENE_RECORD_BYTES_MAX`, 64 MiB), the rest left to the host's own widgets.
pub const FRAME_RECORDING: usize = 32 << 20;
/// What the renderer records for one drawn operation, a text's bytes aside: a draw head and the largest draw record.
/// A record of cells costs it too, before its cells.
pub const RECORD: usize = 128;
/// What a cell costs a record of cells, and what the canvas holds for each cell of its list once prepared.
pub const CELL: usize = size_of::<PaintCell>();

/// One draw: `None` when the plugin was not called (it failed, or its activation ended); else the list's bytes, or
/// `None` to keep the list (also when the call panicked).
pub(crate) type Draw = Box<dyn Fn(&str, Frame) -> Option<Option<Vec<u8>>>>;

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
    /// Paints that showed the placeholder because the frame's recording was spent.
    pub squeezed: u64,
    /// The recording replays spent, as their lists' cost at the size they were painted at.
    pub recorded: u64,
    /// Time in the plugin's draws, in the host's checks of their lists, and in replays.
    pub draw_ns: u64,
    pub check_ns: u64,
    pub replay_ns: u64,
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
            squeezed: self.squeezed - before.squeezed,
            recorded: self.recorded - before.recorded,
            draw_ns: self.draw_ns - before.draw_ns,
            check_ns: self.check_ns - before.check_ns,
            replay_ns: self.replay_ns - before.replay_ns,
        }
    }
}

thread_local! {
    static LEDGER: Cell<Ledger> = Cell::new(Ledger::default());
    static WORK: Cell<Work> = Cell::new(Work::default());
    /// The list bytes each plugin's canvases hold.
    static HELD: RefCell<std::collections::HashMap<Rc<str>, i64>> = RefCell::default();
    /// The frame whose recording the canvases spend now, and what they spent of it.
    static FRAME: Cell<(u64, usize)> = const { Cell::new((0, 0)) };
    /// When the terminal was last handed to another program ([`handover`]).
    static HANDOVER: Cell<Option<std::time::Instant>> = const { Cell::new(None) };
}

/// The list bytes the canvases of plugin `owner` hold now.
pub fn held(owner: &str) -> i64 {
    HELD.with_borrow(|held| held.get(owner).copied().unwrap_or(0))
}

/// The terminal goes to another program now (a suspend, an external editor): the time until it comes back is not an
/// animation's, so the frame after it counts only the time before this.
pub fn handover(app: &App) {
    HANDOVER.set(Some(app.now()));
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

/// What a canvas keeps while its id stays in the mount, also when its widget is built again.
struct State {
    id: String,
    app: App,
    drawer: Option<Rc<Drawer>>,
    shown: RefCell<Shown>,
    /// The size and version the plugin was last asked to draw for.
    asked: Cell<Option<((u16, u16), u64)>>,
    version: Cell<u64>,
    animate: Cell<bool>,
    /// The time of the animation's frame that waits for the paint.
    frame: Cell<Option<Duration>>,
    /// The part of the canvas the last paint showed, in screen cells.
    visible: Cell<(i32, i32, u32, u32)>,
    driving: Cell<bool>,
    /// The driver stopped because something covered the canvas: it starts again once nothing does.
    rested: Cell<bool>,
    /// The canvas's widget, for its coverage: given up when the widget goes, so it holds no cycle past it.
    widget: RefCell<Option<AnyWidget>>,
}

enum Shown {
    Empty,
    List(Kept),
    /// The last list was over a limit.
    Over,
}

/// A list the canvas keeps: its bytes, what it costs at the size it was last costed for, and its cells as OpenTUI
/// records them, each of one column, made by the first paint that replays it.
struct Kept {
    bytes: Rc<[u8]>,
    costed: Cell<((u16, u16), Cost)>,
    cells: std::cell::OnceCell<Box<[PaintCell]>>,
}

impl Kept {
    /// What the canvas holds for it: its bytes and its prepared cells.
    fn held(&self) -> i64 {
        held_for(&self.bytes)
    }
}

/// What a canvas holds for the list `bytes`: the bytes, and a [`PaintCell`] for each of its cells.
fn held_for(bytes: &[u8]) -> i64 {
    let cells: usize = list::ops(bytes)
        .map(|op| match op {
            Op::Cell { .. } => 1,
            Op::Cells { cells, .. } => cells.len(),
            _ => 0,
        })
        .sum();
    (bytes.len() + cells * CELL) as i64
}

/// What replaying a list at a size asks of the renderer: its recording, in bytes, and the cells it touches.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Cost {
    recording: usize,
    cells: usize,
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
            asked: Cell::new(None),
            version: Cell::new(version),
            animate: Cell::new(animate),
            frame: Cell::new(None),
            visible: Cell::new((0, 0, 0, 0)),
            driving: Cell::new(false),
            rested: Cell::new(false),
            widget: RefCell::new(None),
        });
        book(|ledger| ledger.canvases += 1);
        Self::around(app, state)
    }

    /// A new widget for the same state: the canvas is built again with its list.
    pub fn rebuilt(&self, app: &App) -> Self {
        Self::around(app, self.state.clone())
    }

    fn around(app: &App, state: Rc<State>) -> Self {
        let widget = Custom::new(app, Board(state.clone()));
        *state.widget.borrow_mut() = Some(widget.as_any());
        Self { widget, state }
    }

    pub fn widget(&self) -> AnyWidget {
        self.widget.as_any()
    }

    /// Takes a revision's `version` and `animate`. The adoption that sets them asks for the frame whose paint draws a
    /// new version, starts the driver, or lets the one that stops end at its next tick.
    pub fn set(&self, version: u64, animate: bool) {
        self.state.animate.set(animate);
        self.state.version.set(version);
    }
}

impl Drop for Canvas {
    fn drop(&mut self) {
        let mut widget = self.state.widget.borrow_mut();
        if widget.as_ref().is_some_and(|widget| widget.id() == self.widget.id()) {
            *widget = None;
        }
    }
}

impl State {
    /// Why the list the canvas holds is not the one for `size` and its version, if it is not.
    fn stale(&self, size: (u16, u16)) -> Option<Cause> {
        match self.asked.get() {
            Some(asked) if asked == (size, self.version.get()) => None,
            Some((asked, _)) if asked == size => Some(Cause::Version),
            Some(_) => Some(Cause::Resized),
            None => Some(Cause::First),
        }
    }

    /// Asks the plugin for a list for this frame at `size`, and keeps it. A frame of the animation that waits is this
    /// draw: its time goes with it, whatever else asked.
    fn draw(&self, drawer: &Drawer, size: (u16, u16), cause: Cause, dt: Duration) {
        self.asked.set(Some((size, self.version.get())));
        let started = Instant::now();
        let Some(bytes) = (drawer.draw)(&self.id, Frame { width: size.0, height: size.1, cause, dt }) else { return };
        let took = started.elapsed().as_nanos() as u64;
        count(|work| {
            work.draws += 1;
            work.draw_ns += took;
        });
        // What the call left for after the frame (a failure, the budget's reports) waits on the app's deferred queue,
        // which OpenTUI's event loop drains once the frame is presented.
        if let Some(bytes) = bytes {
            self.present(drawer, bytes, size);
        }
    }

    /// Keeps `bytes`, drawn for `size`, once they are checked: a list over a limit (its own, at that size, or what its
    /// plugin or all canvases may hold) shows the placeholder, one the host cannot read fails the plugin and keeps the
    /// list before.
    fn present(&self, drawer: &Drawer, bytes: Vec<u8>, size: (u16, u16)) {
        let started = Instant::now();
        let checked = list::check(&bytes).map(|_| cost(&bytes, size));
        let old = match &*self.shown.borrow() {
            Shown::List(old) => old.held(),
            _ => 0,
        };
        let new = checked.as_ref().map_or(0, |_| held_for(&bytes));
        let (mine, all) = (held(&drawer.owner) - old, ledger().bytes - old);
        let next = match checked {
            Ok(cost)
                if cost.recording <= LIST_RECORDING
                    && cost.cells <= LIST_CELLS
                    && mine + new <= PLUGIN_BYTES
                    && all + new <= TOTAL_BYTES =>
            {
                count(|work| {
                    work.lists += 1;
                    work.bytes += bytes.len() as u64;
                });
                let cells = std::cell::OnceCell::new();
                Shown::List(Kept { bytes: Rc::from(bytes), costed: Cell::new((size, cost)), cells })
            }
            Ok(_) | Err(list::Error::Over(_)) => {
                count(|work| work.over += 1);
                Shown::Over
            }
            Err(error) => {
                count(|work| work.refused += 1);
                (drawer.fail)(format!("canvas {}: {error}", self.id));
                return;
            }
        };
        let took = started.elapsed().as_nanos() as u64;
        count(|work| work.check_ns += took);
        let kept = match &next {
            Shown::List(kept) => kept.held(),
            _ => 0,
        };
        self.shown.replace(next);
        hold(&drawer.owner, kept - old, i64::from(kept > 0) - i64::from(old > 0));
    }

    fn set_driving(&self, on: bool) {
        if self.driving.replace(on) != on {
            book(|ledger| ledger.driving += if on { 1 } else { -1 });
        }
    }

    /// Whether the last frame did not show the canvas: at no sample of its part `visible` (screen cells) does that
    /// frame's hit grid hold it. So a canvas hidden, scrolled away or covered by what is drawn over it is not shown; a
    /// dialog's backdrop, which takes the pointer from all below it, covers a canvas under the dialog too.
    fn covered(&self, visible: (i32, i32, u32, u32)) -> bool {
        let Some(widget) = self.widget.borrow().clone() else { return false };
        let samples = |length: u32| {
            let count = length.min(COVER_SAMPLES);
            (0..count).map(move |index| (index * (length - 1)).checked_div(count - 1).unwrap_or(0) as i32)
        };
        let mine = |x: i32, y: i32| {
            let (Ok(x), Ok(y)) = (u16::try_from(x), u16::try_from(y)) else { return false };
            // A widget the last frame hit and that is gone since, such as this canvas's own before it was built
            // again, tells nothing.
            self.app.widget_at(x, y).is_none_or(|hit| hit.id() == widget.id())
        };
        !samples(visible.2).any(|x| samples(visible.3).any(|y| mine(visible.0 + x, visible.1 + y)))
    }
}

/// The samples a side of a canvas's coverage takes at most: a part left uncovered between them reads as covered.
const COVER_SAMPLES: u32 = 5;

/// Books `bytes` and `lists` more held by `owner`'s canvases.
fn hold(owner: &Rc<str>, bytes: i64, lists: i64) {
    book(|ledger| {
        ledger.bytes += bytes;
        ledger.lists += lists;
    });
    HELD.with_borrow_mut(|held| {
        let entry = held.entry(owner.clone()).or_default();
        *entry += bytes;
        if *entry == 0 {
            held.remove(owner);
        }
    });
}

/// Runs a canvas's animation: a frame for its paint to draw, until the last frame did not show it, it stops animating,
/// or the `animations` switch is off. Its time is the time between its ticks, less what follows a [`handover`].
fn drive(state: &Rc<State>) {
    state.set_driving(true);
    let weak = Rc::downgrade(state);
    let mut last = state.app.now();
    state.app.animate(move |cx, _| {
        let Some(state) = weak.upgrade() else { return false };
        let app = cx.app();
        // A frame left waiting is not drawn: the paint draws one only while the canvas animates.
        if !state.animate.get() || !opencode_ui::motion::running() {
            state.set_driving(false);
            return false;
        }
        if state.covered(state.visible.get()) {
            state.frame.set(None);
            state.rested.set(true);
            state.set_driving(false);
            return false;
        }
        let now = app.now();
        let until = HANDOVER.get().filter(|handover| *handover >= last).unwrap_or(now);
        // A running animation asks for the frame.
        state.frame.set(Some(until.saturating_duration_since(last)));
        last = now;
        true
    });
}

/// Starts the animation of a canvas that shows, unless it stopped because it was covered and still is. The hit grid
/// a paint reads is the last frame's, so a covered canvas reads it again once this frame is presented, and asks for a
/// frame only when nothing covers it then: a covered canvas asks for no frame.
fn resume(state: &Rc<State>) {
    if !state.rested.get() {
        drive(state);
        return;
    }
    if !state.covered(state.visible.get()) {
        state.rested.set(false);
        drive(state);
        return;
    }
    let weak = Rc::downgrade(state);
    state.app.defer(move |cx| {
        if let Some(state) = weak.upgrade()
            && state.rested.get()
            && !state.covered(state.visible.get())
        {
            cx.request_redraw();
        }
    });
}

impl Drop for State {
    fn drop(&mut self) {
        let bytes = match &*self.shown.borrow() {
            Shown::List(kept) => kept.held(),
            _ => 0,
        };
        if let Some(drawer) = &self.drawer {
            hold(&drawer.owner, -bytes, -i64::from(bytes > 0));
        }
        let driving = self.driving.get();
        book(|ledger| {
            ledger.canvases -= 1;
            if driving {
                ledger.driving -= 1;
            }
        });
    }
}

impl Component for Board {
    fn paint(&self, painter: &mut Painter<'_>) {
        let state = &self.0;
        // A frame that does not show the canvas drops the animation's frame: its time is not counted. So does a canvas
        // that stopped animating meanwhile.
        let frame = state.frame.take().filter(|_| state.animate.get() && opencode_ui::motion::running());
        let visible = painter.visible_rect();
        let size = (painter.width().min(u16::MAX.into()) as u16, painter.height().min(u16::MAX.into()) as u16);
        if let Some(drawer) = state.drawer.clone().filter(|_| visible.2 > 0 && visible.3 > 0) {
            if let Some(cause) = state.stale(size).or(frame.map(|_| Cause::Animate)) {
                state.draw(&drawer, size, cause, frame.unwrap_or_default());
            }
            let origin = state.widget.borrow().as_ref().map(|widget| widget.rect());
            let (left, top) =
                origin.map_or((0, 0), |rect| (rect.screen_x.floor() as i32, rect.screen_y.floor() as i32));
            state.visible.set((left + visible.0, top + visible.1, visible.2, visible.3));
            if state.animate.get() && !state.driving.get() && opencode_ui::motion::running() {
                resume(state);
            }
        }
        let started = Instant::now();
        match &*state.shown.borrow() {
            Shown::Empty => {}
            Shown::List(kept) => {
                let (at, mut cost) = kept.costed.get();
                if at != size {
                    cost = self::cost(&kept.bytes, size);
                    kept.costed.set((size, cost));
                }
                if !spend(&state.app, cost.recording) {
                    count(|work| work.squeezed += 1);
                    painter.text(0, 0, PLACEHOLDER, Style::new().dim());
                    return;
                }
                let cells = kept.cells.get_or_init(|| prepare(painter, &kept.bytes));
                let ops = replay(painter, &mut list::ops(&kept.bytes), size, &mut &cells[..]);
                let took = started.elapsed().as_nanos() as u64;
                count(|work| {
                    work.replays += 1;
                    work.recorded += cost.recording as u64;
                    work.ops += ops;
                    work.replay_ns += took;
                });
            }
            Shown::Over => painter.text(0, 0, PLACEHOLDER, Style::new().dim()),
        }
    }
}

const PLACEHOLDER: &str = "canvas over its limit";

/// Spends `recording` of the frame's; `false` when the frame has not that much left.
fn spend(app: &App, recording: usize) -> bool {
    let (frame, spent) = FRAME.get();
    let spent = if frame == app.frame_number() { spent } else { 0 };
    let total = spent + recording;
    if total > FRAME_RECORDING {
        FRAME.set((app.frame_number(), spent));
        return false;
    }
    FRAME.set((app.frame_number(), total));
    true
}

/// Whether a rectangle reaches into a canvas of `size`.
fn inside(x: i16, y: i16, width: u32, height: u32, size: (u16, u16)) -> bool {
    let (x, y) = (i64::from(x), i64::from(y));
    x < i64::from(size.0) && y < i64::from(size.1) && x + i64::from(width) > 0 && y + i64::from(height) > 0
}

/// The cells of a rectangle inside a canvas of `size`.
fn area(x: i16, y: i16, width: u16, height: u16, size: (u16, u16)) -> usize {
    let span = |start: i16, length: u16, limit: u16| {
        let (from, to) = (i64::from(start).max(0), (i64::from(start) + i64::from(length)).min(i64::from(limit)));
        (to - from).max(0) as usize
    };
    span(x, width, size.0) * span(y, height, size.1)
}

/// What [`replay`] asks of the renderer for `bytes` at `size`: an operation it culls costs nothing, a clip a little.
fn cost(bytes: &[u8], size: (u16, u16)) -> Cost {
    let mut cost = Cost::default();
    for op in list::ops(bytes) {
        let (recording, cells) = match op {
            Op::Fill { x, y, width, height, .. } | Op::Rect { x, y, width, height, .. } => {
                match inside(x, y, width.into(), height.into(), size) {
                    true => (RECORD, area(x, y, width, height, size)),
                    false => (0, 0),
                }
            }
            Op::Text { x, y, text, .. } => match inside(x, y, text.len() as u32, 1, size) {
                // The renderer records the whole text and draws the columns it reaches.
                true => (RECORD + text.len(), area(x, y, text.chars().count().min(u16::MAX.into()) as u16, 1, size)),
                false => (0, 0),
            },
            Op::Cell { x, y, .. } => match inside(x, y, 1, 1, size) {
                true => (RECORD + CELL, 1),
                false => (0, 0),
            },
            Op::Cells { x, y, width, cells } => {
                let spans = rows(x, y, width, cells.len(), size);
                let shown: usize = spans.clone().map(|(_, _, from, to)| to - from).sum();
                (RECORD * spans.count() + CELL * shown, shown)
            }
            Op::Clip { .. } | Op::Pop => (RECORD / 4, 0),
        };
        cost.recording += recording;
        cost.cells += cells;
    }
    cost
}

/// The parts of a run of `count` cells from `(x, y)` in rows of `width` that land inside a canvas of `size`, a row
/// each: the row's first column and its line, and the run's cells `from..to` that it shows.
fn rows(
    x: i16,
    y: i16,
    width: u16,
    count: usize,
    size: (u16, u16),
) -> impl Iterator<Item = (i32, i32, usize, usize)> + Clone {
    let width = usize::from(width.max(1));
    let (left, right) = ((-i64::from(x)).max(0) as usize, (i64::from(size.0) - i64::from(x)).max(0) as usize);
    (0..count.div_ceil(width)).filter_map(move |row| {
        let line = i32::from(y) + row as i32;
        let start = row * width;
        let (from, to) = (start + left.min(width), start + right.min(width).min(count - start));
        ((0..i32::from(size.1)).contains(&line) && from < to).then_some((i32::from(x) + left as i32, line, from, to))
    })
}

/// Which characters are one column wide by OpenTUI's measure, for a cell: the renderer writes a cell's character as
/// one column, and one of another width (wide, combining, zero-width, a bidirectional control) would move the
/// terminal's cursor off the row it draws. A direct-mapped cache of the last measures, as a list of thousands of cells
/// is prepared at once and a hash a cell cost that a sixth.
struct Widths([Option<(char, bool)>; 64]);

impl Default for Widths {
    fn default() -> Self {
        Self([None; 64])
    }
}

impl Widths {
    /// The character a cell draws: `char` when it is one column wide, else U+FFFD.
    fn single(&mut self, painter: &Painter<'_>, char: char) -> char {
        if char.is_ascii_graphic() || char == ' ' {
            return char;
        }
        let slot = &mut self.0[char as usize % 64];
        let one = match *slot {
            Some((cached, one)) if cached == char => one,
            _ => {
                let one = painter.text_width(char.encode_utf8(&mut [0; 4])) == 1;
                *slot = Some((char, one));
                one
            }
        };
        if one { char } else { char::REPLACEMENT_CHARACTER }
    }
}

/// Paints `ops` up to their end or the `pop` that closes the clip they are in, at `size`, culling what does not reach
/// into the canvas; returns how many it painted. The one place a list becomes paint calls.
/// The cells of the list `bytes`, a cell's and each of a run's, in order, as OpenTUI records them: a character of
/// another width than one column is U+FFFD.
fn prepare(painter: &Painter<'_>, bytes: &[u8]) -> Box<[PaintCell]> {
    let mut widths = Widths::default();
    let mut cell = |style, char| PaintCell::new(widths.single(painter, char), styled(style));
    list::ops(bytes)
        .flat_map(|op| match op {
            Op::Cell { style, char, .. } => vec![cell(style, char)],
            Op::Cells { cells, .. } => cells.iter().map(|(style, char)| cell(style, char)).collect(),
            _ => Vec::new(),
        })
        .collect()
}

/// The next `count` of `cells`.
fn take<'c>(cells: &mut &'c [PaintCell], count: usize) -> &'c [PaintCell] {
    let (taken, rest) = cells.split_at(count);
    *cells = rest;
    taken
}

/// Replays `ops` at `size`, taking the cells of `cells` as its cells and runs come: a run is a record of cells for
/// each row it shows in. What lands outside the canvas is not recorded. Returns the operations and cells painted.
fn replay<'a>(
    painter: &mut Painter<'_>,
    ops: &mut impl Iterator<Item = Op<'a>>,
    size: (u16, u16),
    cells: &mut &[PaintCell],
) -> u64 {
    let mut painted = 0;
    while let Some(op) = ops.next() {
        match op {
            Op::Fill { x, y, width, height, color } if inside(x, y, width.into(), height.into(), size) => {
                painter.fill(x.into(), y.into(), width.into(), height.into(), rgba(color));
                painted += 1;
            }
            Op::Text { x, y, style, text } if inside(x, y, text.len() as u32, 1, size) => {
                painter.text(x.into(), y.into(), text, styled(style));
                painted += 1;
            }
            Op::Cell { x, y, .. } => {
                let cell = take(cells, 1);
                if inside(x, y, 1, 1, size) {
                    painter.cells(x.into(), y.into(), 1, cell);
                    painted += 1;
                }
            }
            Op::Cells { x, y, width, cells: run } => {
                let run = take(cells, run.len());
                for (column, line, from, to) in rows(x, y, width, run.len(), size) {
                    painter.cells(column, line, (to - from) as u32, &run[from..to]);
                    painted += (to - from) as u64;
                }
            }
            Op::Rect { x, y, width, height, border, color, background }
                if inside(x, y, width.into(), height.into(), size) =>
            {
                let spec = BoxSpec {
                    style: border_style(border),
                    border_color: rgba(color),
                    background: background.map_or(Color::TRANSPARENT, rgba),
                    fill: background.is_some(),
                    ..BoxSpec::default()
                };
                painter.draw_box(x.into(), y.into(), width.into(), height.into(), &spec);
                painted += 1;
            }
            Op::Clip { x, y, width, height } => {
                painter.clip(x.into(), y.into(), width.into(), height.into(), |painter| {
                    painted += replay(painter, ops, size, cells)
                });
            }
            Op::Pop => return painted,
            _ => {}
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

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use opentui::app::HeadlessOptions;

    use super::*;

    // Expected (carbon-4 (1), OpenTUI #2118): work a draw defers while the canvas paints, as a plugin's failure defers
    // its revocation, runs once the frame is presented, on OpenTUI's own event loop, with no input and no timer to wake
    // it: here a list the host cannot read fails the canvas, whose failure defers the end of the run. Were the work to
    // wait for input, the watchdog would end the run after 5 s.
    #[test]
    fn work_a_draw_defers_runs_without_input() {
        let app = App::headless(HeadlessOptions { width: 20, height: 4, ..HeadlessOptions::default() }).unwrap();
        let quitting = app.clone();
        let drawer = Rc::new(Drawer {
            owner: Rc::from("test.headless"),
            draw: Box::new(|_, _| Some(Some(vec![0xff]))),
            fail: Box::new(move |_| quitting.defer(|cx| cx.quit())),
        });
        let canvas = Canvas::new(&app, "c", Some(drawer), 0, false);
        app.root().add(&canvas.widget().width(10).height(2));
        let proxy = app.proxy();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(5));
            let _ = proxy.post(|cx| cx.quit());
        });
        let started = Instant::now();
        app.run().unwrap();
        assert!(started.elapsed() < Duration::from_secs(2), "the failure waited {:?}", started.elapsed());
        assert_eq!(work().refused, 1);
    }
}
