//! Spinners, shimmer, and fade (U.6): ports of the TUI's motion components (`packages/tui/src/component/spinner*`,
//! `shimmer-text.tsx`, `fade-in-text.tsx`, `ui/spinner.ts`, `ui/one-cell-motion.ts`).
//!
//! Each widget keeps the time it has animated for and derives its frame from it, so a frame is a function of an
//! instant: [`spinner_frame`], [`shimmer_strength`], and [`fade_strength`] give the same values the widgets paint.
//! Stepped spinners advance on an app interval timer; shimmer and fade advance on [`App::animate`], every frame.
//! Both follow the app clock, so `TestApp::advance` drives them.
//!
//! The `animations` config switch is read by the caller and passed to each widget (`animations(false)`), as the
//! TypeScript components read `config.animations ?? true`; [`enabled`] applies that default.

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
pub use spinner::{ColorFn, SPINNER_FRAMES, SPINNER_INTERVAL, Spinner, SpinnerColor, spinner_frame};
pub use text::{FadeInText, ShimmerText, fade_strength, shimmer_strength};

use opentui::App;
use opentui::style::Color;
use std::cell::Cell;
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

/// How long a widget has animated. Its driver holds it weakly, so dropping it, with the widget or by replacing it
/// with a new clock, stops the driver at its next tick.
type Clock = Rc<Cell<Duration>>;

/// Advances `clock` by `interval` on every tick of an app interval timer.
fn tick_every(app: &App, interval: Duration, clock: &Clock) {
    let weak = Rc::downgrade(clock);
    let id = Rc::new(Cell::new(None));
    let own = Rc::clone(&id);
    id.set(Some(app.set_interval(interval, move |cx| {
        let Some(clock) = weak.upgrade() else {
            if let Some(id) = own.take() {
                cx.cancel_timer(id);
            }
            return;
        };
        clock.set(clock.get() + interval);
        cx.request_redraw();
    })));
}

/// Advances `clock` by the time between frames until `limit` (if any) is reached.
fn tick_frames(app: &App, clock: &Clock, limit: Option<Duration>) {
    let weak: Weak<Cell<Duration>> = Rc::downgrade(clock);
    app.animate(move |cx, elapsed| {
        let Some(clock) = weak.upgrade() else {
            return false;
        };
        let next = clock.get() + elapsed;
        clock.set(limit.map_or(next, |limit| next.min(limit)));
        cx.request_redraw();
        limit.is_none_or(|limit| next < limit)
    });
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

/// A color's channels as the `f32` floats of a TypeScript `RGBA` made from it.
fn channels(color: Color) -> [f64; 4] {
    let float = |byte: u8| f64::from((f64::from(byte) / 255.0) as f32);
    [float(color.r), float(color.g), float(color.b), float(color.a)]
}
