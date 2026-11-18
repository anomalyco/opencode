//! The Go upsell's art (E.16): `component/go-upsell-art.ts`. Rings radiate from the GO logo while a shimmer crosses
//! it, at 30 frames a second while animations run; with them off it shows the frame halfway through the period.
//!
//! Colors are quantized after every mix, as Core 0.8.4's `RGBA` setters store bytes. TS takes its half-block path
//! only when the terminal reports 24-bit color; OpenTUI's Rust crates expose no color depth, so this always takes it
//! (DLG07).

use std::cell::OnceCell;
use std::f64::consts::PI;

use opentui::widget::WeakWidget;

use crate::prelude::*;

const PERIOD: f64 = 4600.0;
const RINGS: usize = 3;
const WIDTH: f64 = 3.8;
const TAIL: f64 = 9.5;
const AMP: f64 = 0.55;
const TAIL_AMP: f64 = 0.16;
const BREATH_AMP: f64 = 0.05;
const BREATH_SPEED: f64 = 0.0008;
// Offset so the background ring emits from the GO center when the logo shimmer peaks.
const PHASE_OFFSET: f64 = 0.29;
const STILL: f64 = PERIOD * 0.5;
const FPS: f64 = 30.0;
const LOGO: [&str; 4] = ["         ", "█▀▀▀ █▀▀█", "█_^█ █__█", "▀▀▀▀ ▀▀▀▀"];
const LOGO_LEFT_WIDTH: usize = 4;
const LOGO_WIDTH: usize = 9;
const LOGO_HEIGHT: usize = LOGO.len();
const WHITE: Color = Color::rgb(255, 255, 255);

#[derive(Clone, Copy, PartialEq)]
enum Glyph {
    None,
    Shadow,
    ShadowTop,
    ShadowBottom,
    Block,
    Other,
}

fn glyph(character: char) -> Glyph {
    match character {
        ' ' => Glyph::None,
        '_' => Glyph::Shadow,
        '^' => Glyph::ShadowTop,
        '~' => Glyph::ShadowBottom,
        '█' => Glyph::Block,
        _ => Glyph::Other,
    }
}

pub struct Colors {
    pub background: Color,
    pub primary: Color,
    pub logo_base: Color,
}

pub struct Art {
    app: App,
    colors: Colors,
    anchor: View,
    this: OnceCell<WeakWidget>,
    elapsed: Rc<Cell<f64>>,
    tick: RefCell<Option<AnimationTick>>,
}

pub fn new(app: &App, colors: Colors, anchor: &View) -> Custom<Art> {
    let elapsed = Rc::new(Cell::new(if opencode_ui::motion::running() { 0.0 } else { STILL }));
    let art = Custom::new(
        app,
        Art {
            app: app.clone(),
            colors,
            anchor: anchor.clone(),
            this: OnceCell::new(),
            elapsed,
            tick: RefCell::default(),
        },
    )
    .absolute()
    .position(Edge::Top, -1)
    .position(Edge::Left, 0)
    .position(Edge::Right, 0)
    .position(Edge::Bottom, 0);
    let weak = art.downgrade();
    art.with(|art| {
        let _ = art.this.set(weak);
    });
    art
}

impl Art {
    /// Runs the 30 fps clock while animations run, and parks on the still frame while they are off.
    fn follow_motion(&self) {
        let mut tick = self.tick.borrow_mut();
        if !opencode_ui::motion::running() {
            *tick = None;
            self.elapsed.set(STILL);
            return;
        }
        if tick.is_some() {
            return;
        }
        let Some(widget) = self.this.get().and_then(WeakWidget::upgrade) else { return };
        let elapsed = self.elapsed.clone();
        let next = self.app.on_animation_tick(FPS, move |cx, tick| {
            elapsed.set((elapsed.get() + tick.elapsed.as_secs_f64() * 1000.0) % PERIOD);
            cx.app().request_redraw();
        });
        next.follow(&widget);
        *tick = Some(next);
    }
}

impl Component for Art {
    fn paint(&self, painter: &mut Painter<'_>) {
        self.follow_motion();
        let (width, height) = painter.size();
        if width == 0 || height == 0 {
            return;
        }
        let top = self.this.get().and_then(WeakWidget::upgrade).map_or(0.0, |art| art.rect().screen_y);
        let logo_y = self.anchor.rect().screen_y - top;
        let cells: Vec<PaintCell> =
            frame(&self.colors, self.elapsed.get(), width as usize, height as usize, logo_y as i64)
                .into_iter()
                .map(|(character, style)| PaintCell::new(character, style))
                .collect();
        painter.cells(0, 0, width, &cells);
    }
}

pub fn frame(colors: &Colors, t: f64, width: usize, height: usize, raw_logo_y: i64) -> Vec<(char, Style)> {
    let logo_x = width.saturating_sub(LOGO_WIDTH) / 2;
    let logo_y = raw_logo_y.min(height.saturating_sub(LOGO_HEIGHT) as i64).max(0) as usize;
    let center_x = logo_x as f64 + LOGO_WIDTH as f64 / 2.0;
    let center_y = logo_y as f64 + LOGO_HEIGHT as f64 / 2.0;
    let reach = (center_x.max(width as f64 - center_x)).hypot(center_y.max(height as f64 - center_y) * 2.0) + TAIL;
    let logo_reach = (LOGO_WIDTH as f64).hypot(LOGO_HEIGHT as f64 * 2.0) + 3.0;

    let breath = (0.5 + 0.5 * (t * BREATH_SPEED).sin()) * BREATH_AMP;
    let rings: [(f64, f64); RINGS] = std::array::from_fn(|ring| {
        let phase = (t / PERIOD + ring as f64 / RINGS as f64 - PHASE_OFFSET + 1.0) % 1.0;
        (phase * reach, ease(phase))
    });
    let logo_phases = [(t / PERIOD) % 1.0, (t / PERIOD + 0.5) % 1.0];
    let logo_heads = logo_phases.map(|phase| (phase * logo_reach, ease(phase)));
    let shadow = mix(colors.background, colors.logo_base, 0.25);
    let tint = |base: Color, glow: f64, peak: f64| mix(mix(base, colors.primary, glow), WHITE, peak);
    let logo: Vec<Vec<char>> = LOGO.iter().map(|line| line.chars().collect()).collect();

    let mut cells = Vec::with_capacity(width * height);
    for y in 0..height {
        for x in 0..width {
            let dist = (x as f64 + 0.5 - center_x).hypot((y as f64 + 0.5 - center_y) * 2.0);
            let falloff = (1.0 - square(dist / (reach * 0.85))).max(0.0);
            let level: f64 = rings
                .iter()
                .map(|&(head, eased)| {
                    let delta = dist - head;
                    let crest = if delta.abs() < WIDTH { 0.5 + 0.5 * (delta / WIDTH * PI).cos() } else { 0.0 };
                    let tail = if delta < 0.0 && delta > -TAIL { (1.0 + delta / TAIL).powf(2.3) } else { 0.0 };
                    (crest * AMP + tail * TAIL_AMP) * eased
                })
                .sum();
            let pulse =
                mix(colors.background, colors.primary, ((level / RINGS as f64 + breath) * falloff).min(1.0) * 0.7);

            let in_logo = (logo_y..logo_y + LOGO_HEIGHT).contains(&y) && (logo_x..logo_x + LOGO_WIDTH).contains(&x);
            let (lx, ly) = (x.wrapping_sub(logo_x), y.wrapping_sub(logo_y));
            let character = if in_logo { logo[ly][lx] } else { ' ' };
            let kind = glyph(character);
            if kind == Glyph::None {
                cells.push((' ', Style::new().fg(pulse).bg(pulse)));
                continue;
            }
            let half = |row: f64| {
                let dist = (lx as f64 + 0.5 - LOGO_WIDTH as f64 / 2.0).hypot(row - LOGO_HEIGHT as f64);
                logo_pulse(&logo_heads, dist)
            };
            let (top_peak, top_glow) = half(ly as f64 * 2.0);
            let (bottom_peak, bottom_glow) = half(ly as f64 * 2.0 + 1.0);
            let style = if lx > LOGO_LEFT_WIDTH { Style::new().bold() } else { Style::new() };
            let (character, fg, bg) = match kind {
                Glyph::Shadow => {
                    let bg = mix(shadow, WHITE, top_peak.max(bottom_peak) * 0.18);
                    (' ', bg, bg)
                }
                Glyph::ShadowTop => {
                    ('▀', tint(colors.logo_base, top_glow, top_peak), mix(shadow, WHITE, bottom_peak * 0.18))
                }
                Glyph::ShadowBottom => ('▀', mix(shadow, WHITE, top_peak * 0.18), pulse),
                Glyph::Block => {
                    ('▀', tint(colors.logo_base, top_glow, top_peak), tint(colors.logo_base, bottom_glow, bottom_peak))
                }
                _ => (
                    character,
                    tint(colors.logo_base, (top_glow + bottom_glow) / 2.0, (top_peak + bottom_peak) / 2.0),
                    pulse,
                ),
            };
            cells.push((character, style.fg(fg).bg(bg)));
        }
    }
    cells
}

fn square(value: f64) -> f64 {
    value * value
}

fn ease(phase: f64) -> f64 {
    let envelope = (phase * PI).sin();
    envelope * envelope * (3.0 - 2.0 * envelope)
}

fn logo_pulse(heads: &[(f64, f64); 2], dist: f64) -> (f64, f64) {
    let (peak, glow) = heads.iter().fold((0.04, 0.0), |(peak, glow), &(head, eased)| {
        let delta = dist - head;
        let core = (-(delta / 1.2).abs().powf(1.8)).exp();
        let soft = (-(delta / 7.0).abs().powf(1.6)).exp();
        let tail = if delta < 0.0 && delta > -7.0 { (1.0 + delta / 7.0).powf(2.6) } else { 0.0 };
        (peak + core * 0.65 * eased, glow + (soft * 0.16 + tail * 0.22) * eased)
    });
    (peak.min(1.0), glow.min(1.0))
}

/// `a` moved toward `b` by `amount`, each channel stored as a byte as Core's `RGBA` setters store it; opaque.
fn mix(a: Color, b: Color, amount: f64) -> Color {
    let t = amount.clamp(0.0, 1.0);
    let channel = |from: u8, to: u8| {
        let (from, to) = (f64::from(from) / 255.0, f64::from(to) / 255.0);
        ((from + (to - from) * t).clamp(0.0, 1.0) * 255.0 + 0.5).floor() as u8
    };
    Color::rgb(channel(a.r, b.r), channel(a.g, b.g), channel(a.b, b.b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colors() -> Colors {
        Colors {
            background: Color::rgb(10, 10, 10),
            primary: Color::rgb(250, 178, 131),
            logo_base: Color::rgb(150, 150, 150),
        }
    }

    #[test]
    fn mixes_as_core_stores_bytes() {
        assert_eq!(mix(Color::rgb(0, 0, 0), Color::rgb(255, 255, 255), 0.5), Color::rgb(128, 128, 128));
        assert_eq!(mix(Color::rgb(10, 20, 30), Color::rgb(200, 100, 0), 2.0), Color::rgb(200, 100, 0));
        assert_eq!(mix(Color::rgb(10, 20, 30), Color::rgb(200, 100, 0), -1.0), Color::rgb(10, 20, 30));
    }

    #[test]
    fn draws_the_logo_on_its_anchor_row() {
        let cells = frame(&colors(), STILL, 40, 12, 3);
        assert_eq!(cells.len(), 40 * 12);
        let row = |y: usize| -> String { (0..40).map(|x| cells[y * 40 + x].0).collect() };
        assert_eq!(row(4).trim(), "▀▀▀▀ ▀▀▀▀");
        assert_eq!(row(5).trim(), "▀ ▀▀ ▀  ▀");
        assert_eq!(row(6).trim(), "▀▀▀▀ ▀▀▀▀");
        assert_eq!(row(3).trim(), "");
        let low = frame(&colors(), STILL, 40, 12, 20);
        assert_eq!((0..40).map(|x| low[11 * 40 + x].0).collect::<String>().trim(), "▀▀▀▀ ▀▀▀▀");
    }
}
