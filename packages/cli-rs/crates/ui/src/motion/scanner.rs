//! The Knight Rider scanner the prompt shows while a reply streams: `createFrames` and `createColors` of
//! `packages/tui/src/ui/spinner.ts`, bidirectional with holds at both ends. Pair them on a [`Spinner`]:
//!
//! ```ignore
//! let options = ScannerOptions { inactive_factor: 0.6, min_alpha: 0.3, ..ScannerOptions::new(agent_color) };
//! let frames = scanner_frames(&options);
//! Spinner::new(&app).frames(&frames).color(scanner_colors(&options)).interval(Duration::from_millis(40))
//! ```
//!
//! [`Spinner`]: super::Spinner

use super::spinner::SpinnerColor;
use super::{channels, rgba};
use opentui::style::Color;
use std::rc::Rc;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScannerStyle {
    Blocks,
    Diamonds,
}

/// The options the prompt passes (`KnightRiderOptions` with a single `color`).
#[derive(Clone, Copy, Debug)]
pub struct ScannerOptions {
    pub color: Color,
    pub width: usize,
    pub style: ScannerStyle,
    pub hold_start: usize,
    pub hold_end: usize,
    pub trail_steps: usize,
    pub inactive_factor: f64,
    pub enable_fading: bool,
    pub min_alpha: f64,
}

impl ScannerOptions {
    /// The TypeScript defaults for a scanner derived from `color`.
    pub fn new(color: Color) -> Self {
        Self {
            color,
            width: 8,
            style: ScannerStyle::Diamonds,
            hold_start: 30,
            hold_end: 9,
            trail_steps: 6,
            inactive_factor: 0.2,
            enable_fading: true,
            min_alpha: 0.0,
        }
    }

    fn total_frames(&self) -> usize {
        self.width + self.hold_end + (self.width - 1) + self.hold_start
    }
}

/// One string per frame: lit cells and unlit dots.
pub fn scanner_frames(options: &ScannerOptions) -> Vec<String> {
    let trail = options.trail_steps as i64;
    (0..options.total_frames())
        .map(|frame| {
            let state = State::at(frame as i64, options);
            (0..options.width as i64)
                .map(|char| {
                    let index = state.color_index(char, trail);
                    let lit = index >= 0 && index < trail;
                    match options.style {
                        ScannerStyle::Diamonds if lit => {
                            ["⬥", "◆", "⬩", "⬪"][index.min(3) as usize]
                        }
                        ScannerStyle::Diamonds => "·",
                        ScannerStyle::Blocks if lit => "■",
                        ScannerStyle::Blocks => "⬝",
                    }
                })
                .collect()
        })
        .collect()
}

/// The color of each cell of each frame: a bright head with a fading trail, and dimmed unlit cells that fade out
/// during the holds and back in while the head moves.
pub fn scanner_colors(options: &ScannerOptions) -> SpinnerColor {
    let options = *options;
    let colors = trail_colors(options.color, options.trail_steps);
    let [r, g, b, _] = channels(options.color);
    let inactive = f64::from(options.inactive_factor as f32);
    SpinnerColor::Each(Rc::new(move |frame, char, _, chars| {
        let options = ScannerOptions {
            width: chars,
            ..options
        };
        let state = State::at(frame as i64, &options);
        let index = state.color_index(char as i64, colors.len() as i64);
        if index >= 0
            && let Some(color) = colors.get(index as usize)
        {
            return *color;
        }
        rgba(r, g, b, inactive * state.fade(&options))
    }))
}

/// `deriveTrailColors`: full brightness at the head, a slight bloom behind it, then exponential alpha decay.
fn trail_colors(color: Color, steps: usize) -> Vec<Color> {
    let [r, g, b, _] = channels(color);
    (0..steps)
        .map(|step| {
            let (alpha, brightness) = match step {
                0 => (1.0, 1.0),
                1 => (0.9, 1.15),
                _ => (0.65f64.powi(step as i32 - 1), 1.0),
            };
            let scale = |channel: f64| (channel * brightness).min(1.0);
            rgba(scale(r), scale(g), scale(b), alpha)
        })
        .collect()
}

/// `getScannerState` for the bidirectional scanner.
struct State {
    position: i64,
    holding: bool,
    hold_progress: i64,
    hold_total: i64,
    movement_progress: i64,
    movement_total: i64,
    forward: bool,
}

impl State {
    fn at(frame: i64, options: &ScannerOptions) -> Self {
        let chars = options.width as i64;
        let (hold_end, hold_start) = (options.hold_end as i64, options.hold_start as i64);
        let backward = chars - 1;
        let still = |position, progress, total, forward| Self {
            position,
            holding: true,
            hold_progress: progress,
            hold_total: total,
            movement_progress: 0,
            movement_total: 0,
            forward,
        };
        let moving = |position, progress, total, forward| Self {
            position,
            holding: false,
            hold_progress: 0,
            hold_total: 0,
            movement_progress: progress,
            movement_total: total,
            forward,
        };
        if frame < chars {
            return moving(frame, frame, chars, true);
        }
        if frame < chars + hold_end {
            return still(chars - 1, frame - chars, hold_end, true);
        }
        if frame < chars + hold_end + backward {
            let index = frame - chars - hold_end;
            return moving(chars - 2 - index, index, backward, false);
        }
        still(0, frame - chars - hold_end - backward, hold_start, false)
    }

    /// `calculateColorIndex`: 0 at the head, the distance behind it along the trail, or -1 when unlit.
    fn color_index(&self, char: i64, trail: i64) -> i64 {
        let distance = if self.forward {
            self.position - char
        } else {
            char - self.position
        };
        if self.holding {
            return distance + self.hold_progress;
        }
        if distance > 0 && distance < trail {
            return distance;
        }
        if distance == 0 { 0 } else { -1 }
    }

    /// The fade factor of unlit cells.
    fn fade(&self, options: &ScannerOptions) -> f64 {
        let min = options.min_alpha;
        if !options.enable_fading {
            return 1.0;
        }
        if self.holding && self.hold_total > 0 {
            let progress = (self.hold_progress as f64 / self.hold_total as f64).min(1.0);
            return min.max(1.0 - progress * (1.0 - min));
        }
        if !self.holding && self.movement_total > 0 {
            let progress =
                (self.movement_progress as f64 / 1.max(self.movement_total - 1) as f64).min(1.0);
            return min + progress * (1.0 - min);
        }
        1.0
    }
}
