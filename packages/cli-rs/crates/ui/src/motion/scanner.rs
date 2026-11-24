//! Bidirectional scanner for a streaming reply.

use super::spinner::SpinnerColor;
use super::{channels, int_pow, rgba};
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
}

/// One string per frame: lit cells and unlit dots.
pub fn scanner_frames(options: &ScannerOptions) -> Vec<String> {
    let trail = options.trail_steps as i64;
    (0..options.width + options.hold_end + (options.width - 1) + options.hold_start)
        .map(|frame| {
            let state = State::at(frame as i64, options);
            (0..options.width as i64)
                .map(|char| {
                    let index = state.color_index(char, trail);
                    let lit = index >= 0 && index < trail;
                    match options.style {
                        ScannerStyle::Diamonds if lit => ["⬥", "◆", "⬩", "⬪"][index.min(3) as usize],
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
        let options = ScannerOptions { width: chars, ..options };
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
                _ => (int_pow(0.65, step as u32 - 1), 1.0),
            };
            let scale = |channel: f64| (channel * brightness).min(1.0);
            rgba(scale(r), scale(g), scale(b), alpha)
        })
        .collect()
}

/// `getScannerState` for the bidirectional scanner.
struct State {
    position: i64,
    forward: bool,
    phase: Phase,
}

/// What the head does, and how far through it the frame is.
enum Phase {
    Holding { progress: i64, total: i64 },
    Moving { progress: i64, total: i64 },
}

impl State {
    fn at(frame: i64, options: &ScannerOptions) -> Self {
        let chars = options.width as i64;
        let (hold_end, hold_start) = (options.hold_end as i64, options.hold_start as i64);
        let backward = chars - 1;
        let state = |position, forward, phase| Self { position, forward, phase };
        if frame < chars {
            return state(frame, true, Phase::Moving { progress: frame, total: chars });
        }
        if frame < chars + hold_end {
            return state(chars - 1, true, Phase::Holding { progress: frame - chars, total: hold_end });
        }
        if frame < chars + hold_end + backward {
            let index = frame - chars - hold_end;
            return state(chars - 2 - index, false, Phase::Moving { progress: index, total: backward });
        }
        state(0, false, Phase::Holding { progress: frame - chars - hold_end - backward, total: hold_start })
    }

    /// `calculateColorIndex`: 0 at the head, the distance behind it along the trail, or -1 when unlit.
    fn color_index(&self, char: i64, trail: i64) -> i64 {
        let distance = if self.forward { self.position - char } else { char - self.position };
        if let Phase::Holding { progress, .. } = self.phase {
            return distance + progress;
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
        match self.phase {
            Phase::Holding { progress, total } if total > 0 => {
                min.max(1.0 - (progress as f64 / total as f64).min(1.0) * (1.0 - min))
            }
            Phase::Moving { progress, total } if total > 0 => {
                min + (progress as f64 / 1.max(total - 1) as f64).min(1.0) * (1.0 - min)
            }
            _ => 1.0,
        }
    }
}
