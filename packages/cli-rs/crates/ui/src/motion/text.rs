//! Shimmering and fading text: `component/shimmer-text.tsx` and `component/fade-in-text.tsx`, both on
//! `component/masked-text.ts`. The text is painted, then each cell's foreground moves toward a target color by a
//! per-column strength, through the same native color matrix the TypeScript renderables use.

use super::curve::{clamp, coast, intensity_at, smootherstep};
use super::{Clock, channels, millis, tick_frames};
use opentui::App;
use opentui::prelude::*;
use opentui::widget::{Component, Constraint, Custom, Element, Painter, Widget};
use std::cell::Cell;
use std::time::Duration;

const SHIMMER_DURATION: f64 = 1200.0;
const FADE_DURATION: Duration = Duration::from_millis(200);
const FADE_FEATHER: f64 = 8.0;

/// How far a shimmer pulls the cell at `column` toward its shimmer color after running for `elapsed`, from 0 to 1.
/// `end` is the width of the painted text without trailing blanks.
pub fn shimmer_strength(elapsed: Duration, column: u32, end: u32) -> f32 {
    shimmer_strength_at(millis(elapsed), column, end)
}

pub(super) fn shimmer_strength_at(elapsed: f64, column: u32, end: u32) -> f32 {
    let front = -4.0 + coast((elapsed % SHIMMER_DURATION) / SHIMMER_DURATION) * (f64::from(end) + 22.0);
    intensity_at(f64::from(column), front, 4.0, 18.0) as f32
}

/// How hidden (pulled toward the backdrop) the cell at `column` of a fade-in is after `elapsed`: 1 hidden, 0
/// shown. The sweep crosses `sweep_width` columns (default `end`), shifted by `sweep_offset`.
pub fn fade_strength(elapsed: Duration, column: u32, end: u32, sweep_offset: f64, sweep_width: Option<f64>) -> f32 {
    let progress = millis(elapsed.min(FADE_DURATION)) / millis(FADE_DURATION);
    let front = -FADE_FEATHER + coast(progress) * (sweep_width.unwrap_or(f64::from(end)) + FADE_FEATHER * 2.0);
    (1.0 - smootherstep(clamp((front - (sweep_offset + f64::from(column))) / FADE_FEATHER))) as f32
}

/// Paints one line of `text` in `fg`, then shades every cell of the widget's first row toward `target`.
pub(super) fn paint_shaded(
    painter: &mut Painter<'_>,
    text: &str,
    fg: Color,
    target: Color,
    strength: impl Fn(u32, u32) -> f32,
) {
    // A transparent background blends an alpha color into the cell, as a TS `<text>` does.
    painter.text(0, 0, text, Style::new().fg(fg).bg(Color::TRANSPARENT));
    let end = painter.text_width(text.trim_end());
    let [r, g, b, _] = channels(target).map(|channel| channel as f32);
    let mut matrix = ColorMatrix {
        rows: [[0.0, 0.0, 0.0, r], [0.0, 0.0, 0.0, g], [0.0, 0.0, 0.0, b], [0.0, 0.0, 0.0, 1.0]],
        strength: 0.0,
        channels: Channels::Foreground,
    };
    // Trailing cells of a wide glyph keep the strength of its first cell.
    let mut heads = Vec::new();
    for glyph in text.chars() {
        let head = heads.len() as u32;
        let width = painter.text_width(glyph.encode_utf8(&mut [0; 4]));
        heads.extend((0..width).map(|_| head));
    }
    for column in 0..painter.width() {
        matrix.strength = strength(heads.get(column as usize).copied().unwrap_or(column), end);
        if matrix.strength != 0.0 {
            painter.color_matrix(column as i32, 0, 1, 1, &matrix);
        }
    }
}

fn text_width(text: &str) -> f32 {
    unicode_width::UnicodeWidthStr::width(text) as f32
}

/// Text that a soft highlight sweeps across, again and again (`ShimmerText`).
#[derive(Clone)]
pub struct ShimmerText {
    widget: Custom<ShimmerView>,
}

struct ShimmerView {
    text: String,
    fg: Color,
    shimmer: Color,
    clock: Clock,
}

impl ShimmerText {
    pub fn new(app: &App, text: impl Into<String>) -> Self {
        let clock = Clock::default();
        tick_frames(app, &clock, None);
        let view =
            ShimmerView { text: text.into(), fg: Color::DEFAULT_FOREGROUND, shimmer: Color::DEFAULT_FOREGROUND, clock };
        Self { widget: Custom::measured(app, view) }
    }

    pub fn fg(self, fg: Color) -> Self {
        self.widget.update(|view| view.fg = fg);
        self
    }

    pub fn shimmer(self, shimmer: Color) -> Self {
        self.widget.update(|view| view.shimmer = shimmer);
        self
    }

    pub fn set_text(&self, text: impl Into<String>) {
        let text = text.into();
        self.widget.update(|view| view.text = text);
    }
}

impl Component for ShimmerView {
    fn paint(&self, painter: &mut Painter<'_>) {
        let elapsed = millis(self.clock.get());
        paint_shaded(painter, &self.text, self.fg, self.shimmer, |column, end| {
            shimmer_strength_at(elapsed, column, end)
        });
    }

    fn measure(&self, width: Constraint, height: Constraint) -> (f32, f32) {
        (width.apply(text_width(&self.text)), height.apply(1.0))
    }
}

impl Widget for ShimmerText {
    fn element(&self) -> &Element {
        self.widget.element()
    }
}

/// Text that sweeps in from its backdrop over 200 ms when it appears (`FadeInText`). Disabled, it shows at once.
#[derive(Clone)]
pub struct FadeInText {
    widget: Custom<FadeView>,
}

struct FadeView {
    text: String,
    fg: Color,
    backdrop: Color,
    enabled: bool,
    sweep_offset: f64,
    sweep_width: Option<f64>,
    clock: Clock,
    /// Whether the frame that reached the end of the fade was painted; the TypeScript renderable paints that one
    /// frame shaded and plain text after it.
    finished: Cell<bool>,
}

impl FadeInText {
    pub fn new(app: &App, text: impl Into<String>) -> Self {
        let clock = Clock::default();
        tick_frames(app, &clock, Some(FADE_DURATION));
        let view = FadeView {
            text: text.into(),
            fg: Color::DEFAULT_FOREGROUND,
            backdrop: Color::DEFAULT_BACKGROUND,
            enabled: true,
            sweep_offset: 0.0,
            sweep_width: None,
            clock,
            finished: Cell::new(false),
        };
        Self { widget: Custom::measured(app, view) }
    }

    pub fn fg(self, fg: Color) -> Self {
        self.widget.update(|view| view.fg = fg);
        self
    }

    /// The color the text fades in from, usually the background behind it.
    pub fn backdrop(self, backdrop: Color) -> Self {
        self.widget.update(|view| view.backdrop = backdrop);
        self
    }

    /// `animate && animations` in TypeScript.
    pub fn enabled(self, enabled: bool) -> Self {
        self.widget.update(|view| view.enabled = enabled);
        self
    }

    /// Lines up the sweep of several texts: this one starts `offset` columns into a sweep `width` columns wide.
    pub fn sweep(self, offset: f64, width: Option<f64>) -> Self {
        self.widget.update(|view| {
            view.sweep_offset = offset;
            view.sweep_width = width;
        });
        self
    }

    pub fn set_text(&self, text: impl Into<String>) {
        let text = text.into();
        self.widget.update(|view| view.text = text);
    }
}

impl Component for FadeView {
    fn paint(&self, painter: &mut Painter<'_>) {
        let elapsed = self.clock.get();
        if !self.enabled || self.finished.get() {
            painter.text(0, 0, &self.text, Style::new().fg(self.fg).bg(Color::TRANSPARENT));
            return;
        }
        self.finished.set(elapsed >= FADE_DURATION);
        paint_shaded(painter, &self.text, self.fg, self.backdrop, |column, end| {
            fade_strength(elapsed, column, end, self.sweep_offset, self.sweep_width)
        });
    }

    fn measure(&self, width: Constraint, height: Constraint) -> (f32, f32) {
        (width.apply(text_width(&self.text)), height.apply(1.0))
    }
}

impl Widget for FadeInText {
    fn element(&self) -> &Element {
        self.widget.element()
    }
}
