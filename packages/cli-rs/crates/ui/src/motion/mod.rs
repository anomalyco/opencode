mod curve;
mod one_cell;
mod scanner;
mod spinner;
mod text;

pub use curve::{clamp, coast, intensity_at, smootherstep};
pub use one_cell::{
    OneCellClip, OneCellFrame, OneCellMotion, Pace, WORK_SPINNER_NAMES, octant_glyph, one_cell_frame, seed_launch,
    seed_mono, work_spinner,
};
pub use scanner::{ScannerOptions, ScannerStyle, scanner_colors, scanner_frames};
pub use spinner::{ColorFn, SPINNER_FRAMES, SPINNER_INTERVAL, Spinner, SpinnerColor, one_cell_color, spinner_frame};
pub use text::{FadeInText, ShimmerText, fade_strength, shimmer_strength};

use opentui::App;
use opentui::app::{AnimationTick, Cx};
use opentui::style::Color;
use opentui::widget::{Painter, WeakWidget, Widget};
use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::time::Duration;

/// Whether motion runs for a config `animations` value: on unless set to `false`.
pub fn enabled(animations: Option<bool>) -> bool {
    animations.unwrap_or(true)
}

pub fn toggle_title(animations: Option<bool>) -> &'static str {
    if enabled(animations) { "Disable animations" } else { "Enable animations" }
}

thread_local! {
    static OFF: Cell<bool> = const { Cell::new(false) };
}

/// Whether motion runs on this thread.
pub fn running() -> bool {
    !OFF.get()
}

/// Turns motion on or off for every widget of this kit on this thread, and asks for a frame that shows it. A
/// widget's motion stops at its next tick after the switch turns off, and starts again when it paints after the
/// switch turns on.
pub fn set_running(app: &App, running: bool) {
    OFF.set(!running);
    app.request_redraw();
}

/// The time a widget has animated for, moved on the app's shared animation clock while the widget is drawn and
/// motion runs. With a `step` below the app's frame rate it ticks `1 / step` times a second and moves one step per
/// tick; otherwise it moves on every frame ([`App::animate`]) by the time between frames. It stops at `limit`.
///
/// The ticks follow the widget, so OpenTUI parks them while no frame draws it: hidden, detached, culled, or scrolled
/// fully out of view. A parked widget wakes the app at most twice more, and its next draw resumes the ticks. The
/// per-frame form follows no widget, so a frame that did not paint the widget in view stops it, and the widget's next
/// paint starts it again. So an undrawn widget costs no frames and no wakeups. A still motion never moves. With the
/// switch off the motion stops, and the widget's first paint after it turns on starts it again. Dropping the motion
/// ends it.
struct Motion {
    app: App,
    /// The widget that paints the motion, from [`Self::follow`].
    widget: OnceCell<WeakWidget>,
    moving: bool,
    step: Option<Duration>,
    limit: Option<Duration>,
    clock: Cell<Duration>,
    /// Per frame: the last frame that painted the widget in view, or the frame count when the motion started.
    drawn: Cell<u64>,
    tick: RefCell<Option<AnimationTick>>,
    framing: Cell<bool>,
}

impl Motion {
    /// A motion from `clock`, which starts once [`Self::follow`] names its widget.
    fn new(app: &App, moving: bool, step: Option<Duration>, limit: Option<Duration>, clock: Duration) -> Rc<Self> {
        let frame = Duration::from_secs(1) / app.options().max_fps.max(1);
        // A tick at the frame rate would wake the loop for the tick and again for the frame slot after it.
        let step = step.filter(|step| *step > frame + Duration::from_micros(1));
        Rc::new(Self {
            app: app.clone(),
            widget: OnceCell::new(),
            moving,
            step,
            limit,
            clock: Cell::new(clock),
            drawn: Cell::new(0),
            tick: RefCell::default(),
            framing: Cell::new(false),
        })
    }

    /// Binds the motion to the widget that paints it, and starts it unless it is still or the switch is off.
    fn follow(self: &Rc<Self>, widget: &impl Widget) {
        let _ = self.widget.set(widget.downgrade());
        self.start();
    }

    /// Called from the widget's paint.
    fn paint(self: &Rc<Self>, painter: &Painter<'_>) {
        let (_, _, width, height) = painter.visible_rect();
        if width == 0 || height == 0 {
            return;
        }
        self.drawn.set(self.app.frame_number());
        if self.tick.borrow().is_none() && !self.framing.get() {
            self.start();
        }
    }

    fn start(self: &Rc<Self>) {
        if !self.moving || !running() || self.limit.is_some_and(|limit| self.clock.get() >= limit) {
            return;
        }
        let weak = Rc::downgrade(self);
        let Some(step) = self.step else {
            self.drawn.set(self.app.frame_number());
            self.framing.set(true);
            return self.app.animate(move |cx, elapsed| {
                weak.upgrade().is_some_and(|motion| {
                    let moving = motion.advance(cx, elapsed);
                    motion.framing.set(moving);
                    moving
                })
            });
        };
        let Some(widget) = self.widget.get().and_then(WeakWidget::upgrade) else { return };
        let tick = self.app.on_animation_tick(1.0 / step.as_secs_f64(), move |cx, tick| {
            let Some(motion) = weak.upgrade() else { return };
            if !motion.advance(cx, step * tick.ticks as u32) {
                drop(motion.tick.take());
            }
        });
        tick.follow(&widget);
        *self.tick.borrow_mut() = Some(tick);
    }

    /// Moves the clock by `by`, unless the switch is off or, per frame, the last frame did not paint the widget in
    /// view. Returns whether to keep moving. It runs in the frame that paints the move, so it asks for none.
    fn advance(&self, cx: &mut Cx<'_>, by: Duration) -> bool {
        if !running() {
            // A fade jumps to its end, as `createAnimatable` does without animations.
            if let Some(limit) = self.limit {
                self.clock.set(limit);
            }
            return false;
        }
        if self.step.is_none() && self.drawn.get() < cx.app().frame_number() {
            return false;
        }
        let next = self.clock.get() + by;
        self.clock.set(self.limit.map_or(next, |limit| next.min(limit)));
        self.limit.is_none_or(|limit| next < limit)
    }
}

/// Milliseconds, as the TypeScript clocks count.
fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1000.0
}

/// A color from float channels, quantized as native code quantizes `RGBA` floats (an `f32` scaled by 255 and
/// rounded half up).
fn rgba(r: f64, g: f64, b: f64, a: f64) -> Color {
    let byte = |value: f64| {
        let scaled = (value as f32).clamp(0.0, 1.0) * 255.0;
        let whole = scaled as u8;
        whole + u8::from(scaled - f32::from(whole) >= 0.5)
    };
    Color::rgba(byte(r), byte(g), byte(b), byte(a))
}

/// `x ** n` for a small `n` as JavaScriptCore computes it, by repeated squaring. Not `powi`: on MSVC targets LLVM
/// lowers that to the C runtime's `pow`, which rounds once and so can differ from JavaScript in the last bit.
fn int_pow(mut x: f64, mut n: u32) -> f64 {
    let mut result = 1.0;
    while n > 0 {
        if n & 1 == 1 {
            result *= x;
        }
        x *= x;
        n >>= 1;
    }
    result
}

/// A color's channels as the `f32` floats of a TypeScript `RGBA` made from it.
fn channels(color: Color) -> [f64; 4] {
    let float = |byte: u8| f64::from((f64::from(byte) / 255.0) as f32);
    [float(color.r), float(color.g), float(color.b), float(color.a)]
}
