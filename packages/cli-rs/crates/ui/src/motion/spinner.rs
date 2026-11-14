//! The spinner: `component/spinner.tsx` and `component/spinner-renderable.ts`.

use super::text::{paint_shaded, shimmer_strength_at};
use super::{Clock, Drawn, OneCellMotion, channels, millis, one_cell_frame, rgba, running, tick_every, tick_frames};
use opentui::App;
use opentui::prelude::*;
use opentui::widget::{Component, Constraint, Custom, Element, Painter, Widget};
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

/// The braille dots every TUI spinner uses (`component/spinner-frames.ts`).
pub const SPINNER_FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
pub const SPINNER_INTERVAL: Duration = Duration::from_millis(80);

/// The frame index a spinner shows after running for `elapsed`.
pub fn spinner_frame(frames: usize, interval: Duration, elapsed: Duration) -> usize {
    if frames == 0 || interval.is_zero() {
        return 0;
    }
    (elapsed.as_nanos() / interval.as_nanos()) as usize % frames
}

/// A color per glyph: `(frame, glyph, frames, glyphs)`, as the TypeScript `ColorGenerator`.
pub type ColorFn = Rc<dyn Fn(usize, usize, usize, usize) -> Color>;

#[derive(Clone)]
pub enum SpinnerColor {
    Solid(Color),
    Each(ColorFn),
}

impl From<Color> for SpinnerColor {
    fn from(color: Color) -> Self {
        Self::Solid(color)
    }
}

impl SpinnerColor {
    fn base(&self) -> Color {
        match self {
            Self::Solid(color) => *color,
            Self::Each(_) => Color::DEFAULT_FOREGROUND,
        }
    }
}

/// A spinner with an optional label, the TUI's `Spinner`: glyph, a gap, then the label, in one color. With a
/// shimmer color the whole line shimmers. With animations off it shows the still glyph (`⋯`) and the label.
///
/// ```ignore
/// let working = Spinner::new(&app).color(theme.text.muted).label("Thinking");
/// row.add(&working);
/// ```
#[derive(Clone)]
pub struct Spinner {
    widget: Custom<SpinnerView>,
    app: App,
}

struct SpinnerView {
    glyphs: Vec<Vec<String>>,
    interval: Duration,
    color: SpinnerColor,
    label: Option<String>,
    shimmer: Option<Color>,
    animations: bool,
    still: String,
    clock: Clock,
    /// A sequenced one-cell motion and the age it starts at: its frame and level follow the time, not the glyphs.
    sequence: Option<(OneCellMotion, Duration)>,
    drawn: Rc<Drawn>,
}

impl Spinner {
    pub fn new(app: &App) -> Self {
        let view = SpinnerView {
            glyphs: split(&SPINNER_FRAMES),
            interval: SPINNER_INTERVAL,
            color: SpinnerColor::Solid(Color::DEFAULT_FOREGROUND),
            label: None,
            shimmer: None,
            animations: true,
            still: "⋯".to_owned(),
            clock: Clock::default(),
            sequence: None,
            drawn: Rc::default(),
        };
        let spinner = Self { widget: Custom::measured(app, view).shrink(0.0), app: app.clone() };
        spinner.restart();
        spinner
    }

    /// A one-cell motion (`OneCellSpinner`), each frame at its level's share of `color`'s alpha. A [sequenced]
    /// motion plays its intro and pace from [`Self::age`] on, ticking as often as TS does.
    ///
    /// [sequenced]: OneCellMotion::sequenced
    pub fn one_cell(app: &App, motion: &OneCellMotion, color: Color) -> Self {
        let clip = &motion.clip;
        let interval = match motion.sequenced() {
            true => (clip.interval / motion.pace.map_or(1.0, |pace| pace.initial)).clamp(1000.0 / 60.0, 40.0),
            false => clip.interval,
        };
        let spinner = Self::new(app)
            .frames(&clip.frames)
            .interval(Duration::from_secs_f64(interval / 1000.0))
            .color(one_cell_color(motion, color))
            .still("\u{25aa}");
        let sequence = motion.sequenced().then(|| (motion.clone(), Duration::ZERO));
        spinner.widget.update(|view| view.sequence = sequence);
        spinner
    }

    /// Where a sequenced one-cell motion starts: the time its work has run so far.
    pub fn age(self, age: Duration) -> Self {
        self.widget.update(|view| {
            if let Some(sequence) = view.sequence.as_mut() {
                sequence.1 = age;
            }
        });
        self
    }

    /// Replaces the frames and starts over at the first.
    pub fn frames<S: AsRef<str>>(self, frames: &[S]) -> Self {
        self.widget.update(|view| {
            view.glyphs = split(frames);
            view.clock = Clock::default();
        });
        self.restart();
        self
    }

    pub fn interval(self, interval: Duration) -> Self {
        self.widget.update(|view| view.interval = interval);
        self.restart();
        self
    }

    pub fn color(self, color: impl Into<SpinnerColor>) -> Self {
        self.set_color(color);
        self
    }

    pub fn set_color(&self, color: impl Into<SpinnerColor>) {
        let color = color.into();
        self.widget.update(|view| view.color = color);
    }

    pub fn label(self, label: impl Into<String>) -> Self {
        self.set_label(Some(label.into()));
        self
    }

    pub fn set_label(&self, label: Option<String>) {
        // A labeled spinner may shrink to wrap its text; a bare one must not round to zero width beside a sibling.
        self.widget.shrink(if label.is_some() { 1.0 } else { 0.0 });
        self.widget.update(|view| view.label = label);
    }

    /// Shimmers the glyph and label toward `color`, as `<Spinner shimmer>` does.
    pub fn shimmer(self, color: Option<Color>) -> Self {
        self.set_shimmer(color);
        self
    }

    pub fn set_shimmer(&self, color: Option<Color>) {
        self.widget.update(|view| view.shimmer = color);
        self.restart();
    }

    /// The glyph shown with animations off; `⋯` by default.
    pub fn still(self, still: impl Into<String>) -> Self {
        let still = still.into();
        self.widget.update(|view| view.still = still);
        self
    }

    /// Its own switch, over the thread's ([`running`](super::running)): off holds it still whatever the thread's.
    pub fn animations(self, enabled: bool) -> Self {
        self.set_animations(enabled);
        self
    }

    pub fn set_animations(&self, enabled: bool) {
        if self.widget.with(|view| view.animations) == enabled {
            return;
        }
        self.widget.update(|view| view.animations = enabled);
        self.restart();
    }

    /// The frame index on screen.
    pub fn frame(&self) -> usize {
        self.widget.with(SpinnerView::frame)
    }

    /// Replaces the clock, which stops the old driver, and starts the one the settings need.
    fn restart(&self) {
        let (clock, interval, every_frame, drawn) = self.widget.update(|view| {
            view.clock = Rc::new(Cell::new(view.clock.get()));
            let moving = view.animations && (view.glyphs.len() > 1 || view.shimmer.is_some());
            (moving.then(|| Rc::clone(&view.clock)), view.interval, view.shimmer.is_some(), Rc::clone(&view.drawn))
        });
        let Some(clock) = clock else { return };
        if every_frame {
            tick_frames(&self.app, &clock, None, Some(&drawn));
            return;
        }
        if !interval.is_zero() {
            tick_every(&self.app, interval, &clock, &drawn);
        }
    }
}

impl SpinnerView {
    /// Whether it moves: its own switch and the thread's.
    fn moving(&self) -> bool {
        self.animations && running()
    }

    fn frame(&self) -> usize {
        spinner_frame(self.glyphs.len(), self.interval, self.clock.get())
    }

    fn line(&self) -> String {
        let glyph = if self.moving() { self.glyphs.get(self.frame()).map(|glyphs| glyphs.concat()) } else { None };
        let glyph = glyph.unwrap_or_else(|| self.still.clone());
        match &self.label {
            Some(label) => format!("{glyph} {label}"),
            None => glyph,
        }
    }
}

impl Component for SpinnerView {
    fn paint(&self, painter: &mut Painter<'_>) {
        self.drawn.paint(painter);
        let base = self.color.base();
        if !self.moving() {
            painter.text(0, 0, &self.line(), Style::new().fg(base).bg(Color::TRANSPARENT));
            return;
        }
        if let Some(shimmer) = self.shimmer {
            let elapsed = millis(self.clock.get());
            paint_shaded(painter, &self.line(), base, shimmer, |column, end| shimmer_strength_at(elapsed, column, end));
            return;
        }
        if let Some((motion, age)) = &self.sequence {
            let frame = one_cell_frame(motion, millis(*age + self.clock.get()));
            let [r, g, b, a] = channels(base);
            painter.text(0, 0, &frame.glyph, Style::new().fg(rgba(r, g, b, a * frame.level)).bg(Color::TRANSPARENT));
            return;
        }
        let index = self.frame();
        let Some(glyphs) = self.glyphs.get(index) else { return };
        let mut x = 0;
        for (char, glyph) in glyphs.iter().enumerate() {
            let color = match &self.color {
                SpinnerColor::Solid(color) => *color,
                SpinnerColor::Each(color) => color(index, char, self.glyphs.len(), glyphs.len()),
            };
            // An explicit transparent background makes OpenTUI blend an alpha glyph into the cell
            // (`spinner-renderable.ts` draws on `"transparent"`); without one the alpha reaches the terminal
            // as a full-strength color.
            painter.text(x, 0, glyph, Style::new().fg(color).bg(Color::TRANSPARENT));
            x += painter.text_width(glyph) as i32;
        }
        if let Some(label) = &self.label {
            painter.text(
                frame_width(painter, &self.glyphs) as i32 + 1,
                0,
                label,
                Style::new().fg(base).bg(Color::TRANSPARENT),
            );
        }
    }

    fn measure(&self, width: Constraint, height: Constraint) -> (f32, f32) {
        let text = |text: &str| unicode_width::UnicodeWidthStr::width(text) as f32;
        let glyph = if self.moving() {
            self.glyphs.iter().map(|glyphs| text(&glyphs.concat())).fold(0.0, f32::max)
        } else {
            text(&self.still)
        };
        let label = self.label.as_deref().map_or(0.0, |label| 1.0 + text(label));
        (width.apply(glyph + label), height.apply(1.0))
    }
}

/// The color of a [`Spinner::one_cell`] in `color`: a sequenced motion applies its levels as it paints.
pub fn one_cell_color(motion: &OneCellMotion, color: Color) -> SpinnerColor {
    match motion.clip.levels.clone().filter(|_| !motion.sequenced()) {
        Some(levels) => {
            let [r, g, b, a] = channels(color);
            SpinnerColor::Each(Rc::new(move |frame, _, _, _| rgba(r, g, b, a * levels[frame])))
        }
        None => SpinnerColor::Solid(color),
    }
}

fn frame_width(painter: &Painter<'_>, glyphs: &[Vec<String>]) -> u32 {
    glyphs.iter().map(|glyphs| glyphs.iter().map(|glyph| painter.text_width(glyph)).sum()).max().unwrap_or(0)
}

/// Each frame as its characters. Spinner frames are single code points or simple sequences of them.
fn split<S: AsRef<str>>(frames: &[S]) -> Vec<Vec<String>> {
    frames.iter().map(|frame| frame.as_ref().chars().map(String::from).collect()).collect()
}

impl Widget for Spinner {
    fn element(&self) -> &Element {
        self.widget.element()
    }
}
