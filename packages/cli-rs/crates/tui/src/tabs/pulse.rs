//! The tab pulse (W08, `component/tab-pulse.tsx`): the running sweep, the unread glow, the edge flash, and the
//! completion pulse under a tab. Without animations only the glow shows, held still, as in TS.

use std::time::Duration;

use opentui::prelude::Color;

const RUN_DURATION: f64 = 2_800.0;
const RUN_ATTACK: f64 = 450.0;
const RUN_HEAD: f64 = 4.0;
const RUN_TAIL: f64 = 18.0;
const RUN_FADE_OUT: f64 = 500.0;
const COMPLETION_DURATION: f64 = 1_200.0;
const COMPLETION_ATTACK: f64 = 0.12;
const COMPLETION_OPACITY: f64 = 0.18;
const EDGE_FLASH_DURATION: f64 = 800.0;
const EDGE_FLASH_ATTACK: f64 = 0.1;
const EDGE_FLASH_OPACITY: f64 = 0.1;
const PROMPT_FLASH_SCALE: f64 = 2.0;
const GLOW_IGNITION_DURATION: f64 = 600.0;
const GLOW_IGNITION_PEAK: f64 = 1.5;
const GLOW_IGNITION_ATTACK: f64 = 0.3;
const GLOW_FADE_OUT: f64 = 200.0;
const GLOW_RELEASE_DURATION: f64 = 900.0;
const GLOW_RELEASE_ATTACK: f64 = 0.12;
const GLOW_RELEASE_PEAK: f64 = 1.25;
pub const GLOW_TAIL: usize = 12;
const GLOW_OPACITY: f64 = 0.16;
/// The pulse ticks at 20 fps while it animates.
pub const FRAME: Duration = Duration::from_millis(50);

fn clamp(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn smootherstep(value: f64) -> f64 {
    value * value * value * (value * (value * 6.0 - 15.0) + 10.0)
}

fn intensity_at(index: f64, front: f64, head: f64, tail: f64) -> f64 {
    let distance = front - index;
    if distance < 0.0 { smootherstep(clamp(1.0 + distance / head)) } else { smootherstep(clamp(1.0 - distance / tail)) }
}

fn coast(value: f64) -> f64 {
    let ramp = 0.2;
    if value < ramp {
        return value * value / (2.0 * ramp * (1.0 - ramp));
    }
    if value > 1.0 - ramp {
        return 1.0 - (1.0 - value) * (1.0 - value) / (2.0 * ramp * (1.0 - ramp));
    }
    (value - ramp / 2.0) / (1.0 - ramp)
}

fn fade_out(progress: f64) -> f64 {
    1.0 - smootherstep(progress)
}

fn attack_decay(progress: f64, attack: f64, peak: f64, rest: f64) -> f64 {
    if progress < attack {
        peak * smootherstep(clamp(progress / attack))
    } else {
        peak - (peak - rest) * smootherstep(clamp((progress - attack) / (1.0 - attack)))
    }
}

fn glow_intensity_at(index: usize, tail: f64) -> f64 {
    smootherstep(clamp(1.0 - (index as f64 - 1.0).max(0.0) / tail))
}

/// `unreadGlowIntensity`: how strongly a cell of a `width`-wide tab sits in the glow.
pub fn unread_glow_intensity(index: usize, width: usize) -> f64 {
    let tail = GLOW_TAIL.min(width.saturating_sub(2).max(1));
    glow_intensity_at(index, tail as f64)
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Shape {
    Smoother,
    FadeOut,
    Ignition,
    Drain,
    Completion,
    Flash,
}

impl Shape {
    fn level(self, progress: f64) -> f64 {
        match self {
            Shape::Smoother => smootherstep(progress),
            Shape::FadeOut => fade_out(progress),
            Shape::Ignition => attack_decay(progress, GLOW_IGNITION_ATTACK, GLOW_IGNITION_PEAK, 1.0),
            // The resting glow drains over the leading fraction of the release, the old 200 ms fade.
            Shape::Drain => fade_out(clamp(progress / (GLOW_FADE_OUT / GLOW_RELEASE_DURATION))),
            Shape::Completion => attack_decay(progress, COMPLETION_ATTACK, 1.0, 0.0),
            Shape::Flash => attack_decay(progress, EDGE_FLASH_ATTACK, 1.0, 0.0),
        }
    }
}

/// A one-shot clock (`Envelope`).
#[derive(Clone, Copy, Debug)]
struct Envelope {
    clock: Option<f64>,
    scale: f64,
    duration: f64,
    shape: Shape,
}

impl Envelope {
    fn new(duration: f64, shape: Shape) -> Self {
        Self { clock: None, scale: 1.0, duration, shape }
    }

    fn start(&mut self, scale: f64) {
        if self.clock.is_none() {
            self.restart(scale);
        }
    }

    fn restart(&mut self, scale: f64) {
        self.clock = Some(0.0);
        self.scale = scale;
    }

    fn advance(&mut self, delta: f64) {
        if let Some(clock) = self.clock.as_mut() {
            *clock += delta;
            if *clock >= self.duration {
                self.clock = None;
            }
        }
    }

    fn level(&self) -> f64 {
        self.clock.map_or(0.0, |clock| self.scale * self.shape.level(clock / self.duration))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Idle,
    Attack,
    Sustain,
    Release,
}

/// A gated stage (`GatedEnvelope`): attack, sustain at 1, release from the note-off level.
#[derive(Clone, Copy, Debug)]
struct Gate {
    phase: Phase,
    clock: f64,
    release_scale: f64,
    attack: (f64, Shape),
    release: (f64, Shape),
}

impl Gate {
    fn new(attack: (f64, Shape), release: (f64, Shape), sustain: bool) -> Self {
        Self {
            phase: if sustain { Phase::Sustain } else { Phase::Idle },
            clock: 0.0,
            release_scale: 1.0,
            attack,
            release,
        }
    }

    fn trigger(&mut self) {
        self.phase = Phase::Attack;
        self.clock = 0.0;
    }

    fn release(&mut self) {
        if self.phase == Phase::Idle {
            return;
        }
        self.release_scale = self.level();
        self.phase = Phase::Release;
        self.clock = 0.0;
    }

    fn settle(&mut self, sustain: bool) {
        self.phase = if sustain { Phase::Sustain } else { Phase::Idle };
        self.clock = 0.0;
    }

    fn advance(&mut self, delta: f64) {
        let duration = match self.phase {
            Phase::Attack => self.attack.0,
            Phase::Release => self.release.0,
            Phase::Idle | Phase::Sustain => return,
        };
        self.clock += delta;
        if self.clock >= duration {
            self.phase = if self.phase == Phase::Attack { Phase::Sustain } else { Phase::Idle };
            self.clock = 0.0;
        }
    }

    fn level(&self) -> f64 {
        match self.phase {
            Phase::Idle => 0.0,
            Phase::Sustain => 1.0,
            Phase::Attack => self.attack.1.level(self.clock / self.attack.0),
            Phase::Release => self.release_scale * self.release.1.level(self.clock / self.release.0),
        }
    }

    fn animating(&self) -> bool {
        matches!(self.phase, Phase::Attack | Phase::Release)
    }

    fn release_progress(&self) -> Option<f64> {
        (self.phase == Phase::Release).then(|| self.clock / self.release.0)
    }
}

/// What a pulse shows, set from the tab's status.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Input {
    pub active: bool,
    pub prompt_pulse: u32,
    pub complete: bool,
    pub glow: bool,
}

/// One voice of the pulse (`PulseState`).
#[derive(Clone, Debug)]
pub struct Pulse {
    enabled: bool,
    input: Input,
    completion_pending: bool,
    sweep: f64,
    run: Gate,
    glow: Gate,
    completion: Envelope,
    flash: Envelope,
}

impl Pulse {
    pub fn new(enabled: bool, input: Input) -> Self {
        let mut run = Gate::new((RUN_ATTACK, Shape::Smoother), (RUN_FADE_OUT, Shape::FadeOut), false);
        if enabled && input.active {
            run.trigger();
        }
        Self {
            enabled,
            input,
            completion_pending: false,
            sweep: 0.0,
            run,
            // A glow that exists at mount holds without an ignition flash.
            glow: Gate::new(
                (GLOW_IGNITION_DURATION, Shape::Ignition),
                (GLOW_RELEASE_DURATION, Shape::Drain),
                input.glow,
            ),
            completion: Envelope::new(COMPLETION_DURATION, Shape::Completion),
            flash: Envelope::new(EDGE_FLASH_DURATION, Shape::Flash),
        }
    }

    /// Whether the pulse moves and needs ticks.
    pub fn live(&self) -> bool {
        self.enabled
            && (self.input.active
                || self.run.animating()
                || self.glow.animating()
                || self.completion.clock.is_some()
                || self.flash.clock.is_some())
    }

    pub fn set(&mut self, input: Input) {
        let previous = self.input;
        self.input = input;
        if input.active != previous.active && self.enabled {
            if input.active {
                self.sweep = 0.0;
                self.run.trigger();
                self.completion.clock = None;
                self.completion_pending = false;
            } else {
                self.run.release();
                self.completion_pending = true;
            }
            self.flash.start(1.0);
        }
        if input.prompt_pulse != previous.prompt_pulse && self.enabled {
            self.flash.restart(PROMPT_FLASH_SCALE);
        }
        if input.complete != previous.complete {
            if !input.complete {
                self.completion.clock = None;
                self.completion_pending = false;
            }
            if input.complete && self.completion_pending {
                self.completion_pending = false;
                if self.enabled {
                    self.completion.start(1.0);
                }
            }
        }
        if input.glow != previous.glow {
            match (self.enabled, input.glow) {
                (false, glow) => self.glow.settle(glow),
                (true, true) => self.glow.trigger(),
                (true, false) => self.glow.release(),
            }
        }
    }

    pub fn advance(&mut self, delta: Duration) {
        if !self.live() {
            return;
        }
        let delta = delta.as_secs_f64() * 1000.0;
        if self.run.phase != Phase::Idle {
            self.sweep += delta;
        }
        self.run.advance(delta);
        self.glow.advance(delta);
        self.completion.advance(delta);
        self.flash.advance(delta);
        if !self.completion_pending {
            return;
        }
        if self.input.complete {
            self.completion_pending = false;
            self.completion.start(1.0);
            return;
        }
        if self.run.release_progress().is_none() {
            self.completion_pending = false;
        }
    }

    fn fronts(&self, width: usize) -> [f64; 2] {
        let cycles = self.sweep / RUN_DURATION;
        let start = -RUN_HEAD;
        let end = width as f64 - 1.0 + RUN_TAIL;
        let second = if cycles < 0.5 { 0.0 } else { (cycles + 0.5) % 1.0 };
        [start + coast(cycles % 1.0) * (end - start), start + coast(second) * (end - start)]
    }

    /// The sweep's level under the number cell (`onLevel`), quantized to 1/32.
    pub fn level(&self, width: usize) -> f64 {
        let running = self.run.level();
        if running == 0.0 || width == 0 {
            return 0.0;
        }
        let [a, b] = self.fronts(width);
        let level = intensity_at(1.0, a, RUN_HEAD, RUN_TAIL).max(intensity_at(1.0, b, RUN_HEAD, RUN_TAIL)) * running;
        (level * 32.0).round() / 32.0
    }

    /// Whether any stage has something to draw.
    fn visible(&self) -> bool {
        self.glow.level() != 0.0
            || self.glow.release_progress().is_some()
            || self.run.level() != 0.0
            || self.completion.level() != 0.0
            || self.flash.level() != 0.0
    }

    /// The background of each cell, or `None` when the pulse draws nothing there.
    fn colors(&self, width: usize, colors: &Colors) -> Vec<Color> {
        let running = self.run.level();
        let completion = self.completion.level() * COMPLETION_OPACITY;
        let flash = self.flash.level() * EDGE_FLASH_OPACITY;
        let glow = self.glow.level();
        let fronts = self.fronts(width);
        let clamp_tail = |tail: usize| tail.min(width.saturating_sub(2).max(1)) as f64;
        let glow_tail = clamp_tail(colors.glow_tail);
        let flash_tail = colors.flash_tail.map(clamp_tail);
        let swell = self.glow.release_progress().map_or(0.0, |progress| {
            attack_decay(progress, GLOW_RELEASE_ATTACK, GLOW_RELEASE_PEAK, 0.0) * self.glow.release_scale.max(1.0)
        });
        let spread =
            self.glow.release_progress().map_or(0.0, |progress| glow_tail + smootherstep(progress) * width as f64);
        (0..width)
            .map(|index| {
                let sweep = if running == 0.0 {
                    0.0
                } else {
                    intensity_at(index as f64, fronts[0], RUN_HEAD, RUN_TAIL).max(intensity_at(
                        index as f64,
                        fronts[1],
                        RUN_HEAD,
                        RUN_TAIL,
                    )) * 0.14
                        * running
                };
                let glow = (if glow == 0.0 { 0.0 } else { glow_intensity_at(index, glow_tail) * GLOW_OPACITY * glow })
                    .max(if swell == 0.0 { 0.0 } else { glow_intensity_at(index, spread) * GLOW_OPACITY * swell });
                let flash = flash_tail.map_or(flash, |tail| flash * glow_intensity_at(index, tail));
                blend(colors, glow, sweep, flash, completion)
            })
            .collect()
    }
}

/// The colors of one voice.
#[derive(Clone, Copy, Debug)]
pub struct Colors {
    pub background: Color,
    pub color: Color,
    pub glow: Color,
    pub flash: Color,
    pub completion: Color,
    pub glow_tail: usize,
    pub flash_tail: Option<usize>,
}

/// `blendTabPulseColor`, in floats from the background, rounded once at the end as `RGBA` does when drawn.
fn blend(colors: &Colors, glow: f64, running: f64, flash: f64, completion: f64) -> Color {
    let unit = |color: Color| [color.r as f64 / 255.0, color.g as f64 / 255.0, color.b as f64 / 255.0];
    let mut output = unit(colors.background);
    for (color, amount) in
        [(colors.glow, glow), (colors.color, running), (colors.flash, flash), (colors.completion, completion)]
    {
        if amount == 0.0 {
            continue;
        }
        let target = unit(color);
        // The glow mixes from the background; the other stages from the running result.
        output.iter_mut().zip(target).for_each(|(value, target)| *value += (target - *value) * amount);
    }
    let byte = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
    Color::rgb(byte(output[0]), byte(output[1]), byte(output[2]))
}

/// The cells one pulse paints across a `width`-wide row: a background per cell, or, with an outer voice, the
/// `▄` or `▀` half block that splits the cell between the two. `None` where nothing is drawn.
pub fn paint(
    inner: &Pulse,
    inner_colors: &Colors,
    outer: Option<(&Pulse, &Colors, bool)>,
    width: usize,
) -> Option<Vec<(Option<char>, Color, Color)>> {
    let outer_visible = outer.is_some_and(|(pulse, _, _)| pulse.visible());
    if !inner.visible() && !outer_visible {
        return None;
    }
    let cells = inner.colors(width, inner_colors);
    let Some((outer, colors, above)) = outer else {
        return Some(cells.into_iter().map(|bg| (None, bg, bg)).collect());
    };
    let outer = outer.colors(width, colors);
    let glyph = if above { '▄' } else { '▀' };
    Some(cells.into_iter().zip(outer).map(|(fg, bg)| (Some(glyph), fg, bg)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn colors() -> Colors {
        Colors {
            background: Color::rgb(0, 0, 0),
            color: Color::rgb(100, 100, 100),
            glow: Color::rgb(255, 0, 0),
            flash: Color::rgb(200, 200, 200),
            completion: Color::rgb(0, 0, 255),
            glow_tail: GLOW_TAIL,
            flash_tail: None,
        }
    }

    #[test]
    fn a_still_pulse_draws_only_its_glow() {
        let idle = Pulse::new(false, Input { active: true, ..Input::default() });
        assert!(paint(&idle, &colors(), None, 10).is_none(), "no sweep without animations");
        assert!(!idle.live());
        let glow = Pulse::new(false, Input { glow: true, ..Input::default() });
        let cells = paint(&glow, &colors(), None, 10).unwrap();
        // Full strength over the first two cells, fading along the tail.
        assert_eq!(cells[0].1, Color::rgb(41, 0, 0));
        assert_eq!(cells[1].1, Color::rgb(41, 0, 0));
        assert!(cells[5].1.r < 41 && cells[9].1.r < cells[5].1.r);
    }

    #[test]
    fn a_glow_set_without_animations_holds_at_once() {
        let mut pulse = Pulse::new(false, Input::default());
        pulse.set(Input { glow: true, ..Input::default() });
        assert!(paint(&pulse, &colors(), None, 4).is_some());
        pulse.set(Input::default());
        assert!(paint(&pulse, &colors(), None, 4).is_none());
    }

    #[test]
    fn the_sweep_runs_while_active_and_fades_after() {
        let mut pulse = Pulse::new(true, Input { active: true, ..Input::default() });
        assert!(pulse.live());
        pulse.advance(Duration::from_millis(1_000));
        assert!(pulse.level(20) > 0.0 || paint(&pulse, &colors(), None, 20).is_some());
        pulse.set(Input { complete: true, ..Input::default() });
        pulse.advance(Duration::from_millis(5_000));
        pulse.advance(Duration::from_millis(5_000));
        assert!(!pulse.live());
        assert!(paint(&pulse, &colors(), None, 20).is_none());
    }

    #[test]
    fn unread_glow_intensity_follows_the_tab_width() {
        assert_eq!(unread_glow_intensity(1, 30), 1.0);
        assert!(unread_glow_intensity(12, 30) < 0.1);
        assert_eq!(unread_glow_intensity(3, 3), 0.0);
    }
}
