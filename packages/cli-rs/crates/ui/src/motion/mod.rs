//! Spinners, shimmer, and fade (U.6): ports of the TUI's motion components (`packages/tui/src/component/spinner*`,
//! `shimmer-text.tsx`, `fade-in-text.tsx`, `ui/spinner.ts`, `ui/one-cell-motion.ts`).
//!
//! Each widget keeps the time it has animated for and derives its frame from it, so a frame is a function of an
//! instant: [`spinner_frame`], [`shimmer_strength`], and [`fade_strength`] give the same values the widgets paint.
//! Stepped spinners advance on an app interval timer; shimmer and fade advance on [`App::animate`], every frame.
//! Both follow the app clock, so `TestApp::advance` drives them. A spinner or shimmer that is not drawn stops until
//! it paints again, and keeps no time meanwhile, as Core's `animationFps` does; a fade runs to its end.
//!
//! The `animations` config switch is one per UI thread, as the TypeScript components all read
//! `config.animations ?? true`: the app sets it with [`set_running`] at start and on every config change, and every
//! widget here follows it at once. With it off a widget shows its still form and its driver stops; turning it back
//! on resumes the drivers. [`enabled`] applies the config default.

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

use crate::bind;
use opentui::App;
use opentui::style::Color;
use opentui::widget::Painter;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

/// Whether motion runs for a config `animations` value: on unless set to `false`.
pub fn enabled(animations: Option<bool>) -> bool {
    animations.unwrap_or(true)
}

/// The palette title of `app.toggle.animations` for the current switch (TS `app.tsx`).
pub fn toggle_title(animations: Option<bool>) -> &'static str {
    if enabled(animations) { "Disable animations" } else { "Enable animations" }
}

thread_local! {
    static SWITCH: Switch = Switch::default();
}

/// The thread's `animations` switch and the drivers it stopped, to resume when it turns back on.
#[derive(Default)]
struct Switch {
    off: Cell<bool>,
    parked: RefCell<Vec<(Weak<Cell<Duration>>, Resume)>>,
}

type Resume = Box<dyn FnOnce(&App)>;

/// Whether motion runs on this thread.
pub fn running() -> bool {
    SWITCH.with(|switch| !switch.off.get())
}

/// Turns motion on or off for every widget of this kit on this thread, and asks for a frame that shows it.
pub fn set_running(app: &App, running: bool) {
    let resumed = SWITCH.with(|switch| {
        if switch.off.replace(!running) == !running || !running {
            return Vec::new();
        }
        switch.parked.take()
    });
    for (_, resume) in resumed {
        resume(app);
    }
    app.request_redraw();
}

/// Keeps a stopped driver of `clock` to resume when motion turns back on, dropping those whose widget is gone.
fn park(clock: &Weak<Cell<Duration>>, resume: impl FnOnce(&App) + 'static) {
    SWITCH.with(|switch| {
        let mut parked = switch.parked.borrow_mut();
        parked.retain(|(clock, _)| clock.strong_count() > 0);
        parked.push((Weak::clone(clock), Box::new(resume)));
    });
}

/// How long a widget has animated. Its driver holds it weakly, so dropping it, with the widget or by replacing it
/// with a new clock, stops the driver at its next tick.
type Clock = Rc<Cell<Duration>>;

/// Whether a widget is drawn, for its driver: a widget that is hidden, scrolled out of view, or under a collapsed
/// parent is not painted, and its driver stops at its first tick after a frame that did not paint it. The widget's
/// next paint resumes it, so an undrawn widget costs no frames and no wakeups.
#[derive(Default)]
struct Drawn {
    painted: Cell<bool>,
    parked: Cell<Option<Unpark>>,
}

type Unpark = Box<dyn FnOnce(&Rc<Drawn>)>;

impl Drawn {
    /// Called from the widget's paint. A paint clipped away entirely does not count: a scroll box with few rows
    /// paints the ones out of view too.
    fn paint(self: &Rc<Self>, painter: &Painter<'_>) {
        let (_, _, width, height) = painter.visible_rect();
        if width == 0 || height == 0 {
            return;
        }
        self.painted.set(true);
        if let Some(resume) = self.parked.take() {
            resume(self);
        }
    }

    /// Whether a frame ran since the tick that saw frame `seen` without painting the widget. Moves `seen` on.
    fn missed(&self, app: &App, seen: &mut u64) -> bool {
        let frame = app.frame_number();
        let ran = std::mem::replace(seen, frame) != frame;
        ran && !self.painted.replace(false)
    }
}

/// Advances `clock` by `interval` on every tick of an app interval timer, asking for a frame each time, until the
/// widget is not drawn ([`Drawn`]). With motion off the driver parks.
fn tick_every(app: &App, interval: Duration, clock: &Clock, drawn: &Rc<Drawn>) {
    let drawn = Rc::clone(drawn);
    let weak = Rc::downgrade(clock);
    if !running() {
        return park(&Rc::downgrade(clock), move |app| {
            if let Some(clock) = weak.upgrade() {
                tick_every(app, interval, &clock, &drawn);
            }
        });
    }
    let mut seen = app.frame_number();
    let id = Rc::new(Cell::new(None));
    let own = Rc::clone(&id);
    id.set(Some(app.set_interval(interval, move |cx| {
        let clock = weak.upgrade().filter(|_| running());
        let Some(clock) = clock else {
            if let Some(id) = own.take() {
                cx.cancel_timer(id);
            }
            if let Some(clock) = weak.upgrade() {
                tick_every(cx.app(), interval, &clock, &drawn);
            }
            return;
        };
        clock.set(clock.get() + interval);
        if !drawn.missed(cx.app(), &mut seen) {
            cx.request_redraw();
            return;
        }
        if let Some(id) = own.take() {
            cx.cancel_timer(id);
        }
        let (app, weak) = (cx.app().clone(), Weak::clone(&weak));
        drawn.parked.set(Some(Box::new(move |drawn| {
            if let Some(clock) = weak.upgrade() {
                tick_every(&app, interval, &clock, drawn);
                // The loop takes its deadline before it paints, so a timer armed in paint would wait for an
                // unrelated wakeup; an animation makes it come around once.
                app.animate(|_, _| false);
            }
        })));
    })));
}

/// Advances `clock` by the time between frames until `limit` (if any) is reached, or, with `drawn`, until the widget
/// is not drawn. With motion off a looping driver parks, and a limited one jumps to its end.
fn tick_frames(app: &App, clock: &Clock, limit: Option<Duration>, drawn: Option<&Rc<Drawn>>) {
    let weak: Weak<Cell<Duration>> = Rc::downgrade(clock);
    let drawn = drawn.cloned();
    let gate = drawn.clone();
    let stop = move |clock: &Clock| match limit {
        Some(limit) => clock.set(limit),
        None => {
            let (resume, gate) = (Weak::clone(&weak), gate.clone());
            park(&weak, move |app| {
                if let Some(clock) = resume.upgrade() {
                    tick_frames(app, &clock, None, gate.as_ref());
                }
            });
        }
    };
    if !running() {
        return stop(clock);
    }
    let weak = Rc::downgrade(clock);
    let mut seen = app.frame_number();
    app.animate(bind!(weak, |clock, cx, elapsed| {
        if !running() {
            stop(&clock);
            return false;
        }
        let next = clock.get() + elapsed;
        clock.set(limit.map_or(next, |limit| next.min(limit)));
        if let Some(drawn) = drawn.as_ref().filter(|drawn| drawn.missed(cx.app(), &mut seen)) {
            let (app, weak) = (cx.app().clone(), Rc::downgrade(&clock));
            drawn.parked.set(Some(Box::new(move |drawn| {
                if let Some(clock) = weak.upgrade() {
                    tick_frames(&app, &clock, limit, Some(drawn));
                }
            })));
            return false;
        }
        cx.request_redraw();
        limit.is_none_or(|limit| next < limit)
    }));
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
