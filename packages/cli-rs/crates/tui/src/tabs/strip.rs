//! Horizontal session tab strip.

use std::time::{Duration, Instant};

use opencode_ui::theme::tint;
use opentui::app::{AnimationTick, Tick};
use opentui::input::{MouseButton, MouseEvent, MouseEventKind};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::marquee::{self, Marquee};
use super::model::{self, NEW_SESSION_TAB_TITLE, Tab};
use super::pulse::{self, Pulse};
use super::{Attention, Status, Unread};

use crate::prelude::*;

const ADD_TAB_WIDTH: usize = 3;
/// A long title fades out over its last cells.
pub(super) const FADE_WIDTH: usize = 4;
pub(super) const NEW_TAB: &str = "new";
pub(super) const UNREAD_MARKER: &str = "•";

pub struct Strip {
    tui: Weak<Tui>,
    start: Cell<usize>,
    hovered: Option<String>,
    close_hovered: bool,
    plus_hovered: bool,
    pressed: Option<String>,
    plus_pressed: bool,
    dragged: bool,
    preview: Option<(String, usize)>,
    /// The last painted slots, for hit tests: `(x, width, session)`.
    slots: RefCell<Vec<(usize, usize, String)>>,
    plus: Cell<Option<usize>>,
    pulses: RefCell<HashMap<String, Pulse>>,
    fades: RefCell<HashMap<String, MarkerFade>>,
    spins: RefCell<HashMap<String, u64>>,
    /// The strip's ticks while a spinner shows and while a pulse moves.
    spin: RefCell<Option<AnimationTick>>,
    pulse: RefCell<Option<AnimationTick>>,
    /// The hovered tab's scrolling title.
    marquee: Marquee,
    /// Per painted tab: its title and the cells it has while hovered.
    titles: RefCell<HashMap<String, (String, usize)>>,
    /// The title of each item of the strip, kept until the items or a session's info change.
    names: RefCell<Option<Names>>,
}

/// The items the strip last named, and the title of each.
type Names = (Rc<[Tab]>, Vec<String>);

pub fn new(app: &App, tui: Weak<Tui>) -> Custom<Strip> {
    let strip = Custom::new(
        app,
        Strip {
            tui,
            start: Cell::new(0),
            hovered: None,
            close_hovered: false,
            plus_hovered: false,
            pressed: None,
            plus_pressed: false,
            dragged: false,
            preview: None,
            slots: RefCell::default(),
            plus: Cell::new(None),
            pulses: RefCell::default(),
            fades: RefCell::default(),
            spins: RefCell::default(),
            spin: RefCell::default(),
            pulse: RefCell::default(),
            marquee: Marquee::default(),
            titles: RefCell::default(),
            names: RefCell::default(),
        },
    )
    .height(1)
    .shrink(0.0)
    .z_index(1);
    // Runs before `Strip::mouse`, so it may read the component.
    let hover = strip.clone();
    strip.on_mouse(move |_, event| {
        if event.kind == MouseEventKind::Moved {
            let x = i32::from(event.x) - hover.element().rect().screen_x.floor() as i32;
            let clickable = hover.with(|strip| strip.slot_at(x).is_some() || strip.on_plus(x));
            hover.mouse_pointer(opencode_ui::click_pointer(clickable));
        }
    })
}

pub fn leave(app: &App, strip: &Custom<Strip>) {
    strip.update(|strip| {
        strip.marquee.reset(app);
        strip.hovered = None;
        strip.close_hovered = false;
        strip.plus_hovered = false;
    });
}

/// Drops the pulses and spinners while the strip is hidden, as its tabs unmount. Its ticks park while it is hidden,
/// and its next paint keeps or drops them.
pub fn forget(strip: &Custom<Strip>) {
    strip.with(|strip| {
        strip.pulses.borrow_mut().clear();
        strip.fades.borrow_mut().clear();
        strip.spins.borrow_mut().clear();
    });
}

pub fn fading(strip: &Custom<Strip>, now: Instant) -> bool {
    strip.with(|strip| strip.fades.borrow().values().any(|marker| marker.moving(now)))
}

pub fn observe(strip: &Custom<Strip>, tui: &Tui, changes: &Changes) {
    strip.with(|strip| {
        if changes.sessions() {
            strip.names.take();
        }
        observe_markers(&strip.fades, tui);
    });
}

/// `TabIndicator`'s `createComputed` runs on every status change, not on paint: a marker that a `session.view`
/// clears before the next paint still fades out.
pub(super) fn observe_markers(markers: &RefCell<HashMap<String, MarkerFade>>, tui: &Tui) {
    let theme = tui.page();
    let animations = opencode_ui::motion::enabled(tui.config().info.animations);
    let now = tui.app.now();
    let mut markers = markers.borrow_mut();
    for (session, marker) in markers.iter_mut().filter(|(session, _)| *session != NEW_TAB) {
        let status = tui.tabs.status(tui, session);
        marker.set(&status, feedback(&status, &theme).unwrap_or(theme.accent().step(200)), animations, now);
    }
    if markers.values().any(|marker| marker.moving(now)) {
        crate::frame::wake_markers(tui);
    }
}

/// Holds `handle` while `wanted`, made by `start` when it is missing; drops it otherwise.
pub(super) fn hold(handle: &RefCell<Option<AnimationTick>>, wanted: bool, start: impl FnOnce() -> AnimationTick) {
    if !wanted {
        drop(handle.take());
    } else if handle.borrow().is_none() {
        *handle.borrow_mut() = Some(start());
    }
}

pub(super) fn step(spins: &RefCell<HashMap<String, u64>>, ticks: u64) {
    spins.borrow_mut().values_mut().for_each(|step| *step += ticks);
}

pub(super) fn spinner_fps() -> f64 {
    1.0 / opencode_ui::motion::SPINNER_INTERVAL.as_secs_f64()
}

pub(super) struct Palette {
    pub unread: Color,
    pub active_number: Color,
    pub idle_number: Color,
}

pub(super) fn feedback(status: &Status, theme: &Theme) -> Option<Color> {
    if status.attention.is_some() {
        return Some(theme.accent().step(200));
    }
    (status.unread == Some(Unread::Error)).then_some(theme.text.feedback.error.base)
}

/// `TabIndicator`'s unread fade, `createAnimatable({ opacity }, tween({ duration: 0.18 }))`: once the session is
/// viewed, its unread marker stays and dissolves into the tab background instead of vanishing.
#[derive(Clone, Copy, Debug)]
pub(super) struct MarkerFade {
    from: f64,
    target: f64,
    started: Option<Instant>,
    /// The unread color the marker last showed (`unreadColor`'s latch).
    color: Color,
}

const MARKER_FADE: Duration = Duration::from_millis(180);

impl MarkerFade {
    pub(super) fn new(status: &Status, color: Color) -> Self {
        let opacity = f64::from(u8::from(Self::unread(status)));
        Self { from: opacity, target: opacity, started: None, color }
    }

    fn unread(status: &Status) -> bool {
        status.unread.is_some() && !status.busy && status.attention.is_none()
    }

    /// The indicator's `createComputed`: unread jumps to full, pending to none, and anything else eases out from
    /// where it is. Without animations the tween jumps to its target, as `createAnimatable` does.
    pub(super) fn set(&mut self, status: &Status, color: Color, animations: bool, now: Instant) {
        if Self::unread(status) {
            self.color = color;
            return self.jump(1.0);
        }
        if status.busy || status.attention.is_some() || !animations {
            return self.jump(0.0);
        }
        if self.target == 0.0 {
            return;
        }
        let from = self.opacity(now);
        self.target = 0.0;
        if from == 0.0 {
            return self.jump(0.0);
        }
        self.from = from;
        self.started = Some(now);
    }

    fn jump(&mut self, opacity: f64) {
        *self = Self { from: opacity, target: opacity, started: None, color: self.color };
    }

    fn progress(&self, now: Instant) -> Option<f64> {
        self.started
            .map(|started| (now.saturating_duration_since(started).as_secs_f64() / MARKER_FADE.as_secs_f64()).min(1.0))
    }

    fn opacity(&self, now: Instant) -> f64 {
        self.progress(now).map_or(self.from, |p| self.from + (self.target - self.from) * p * p * (3.0 - 2.0 * p))
    }

    pub(super) fn moving(&self, now: Instant) -> bool {
        self.progress(now).is_some_and(|progress| progress < 1.0)
    }

    /// The marker's color while it fades out, or `None` when it does not: it brightens toward `flash` over the
    /// first fifth, then dissolves into `background`.
    pub(super) fn color(&self, status: &Status, background: Color, flash: Color, now: Instant) -> Option<Color> {
        let opacity = self.opacity(now);
        if status.unread.is_some() || opacity <= 0.0 {
            return None;
        }
        let lift = (1.0 - (opacity - 0.8).abs() / 0.2).max(0.0);
        Some(tint(background, tint(self.color, flash, lift * 0.3), (opacity / 0.8).min(1.0)))
    }
}

pub(super) fn indicator<'a>(
    status: &Status,
    label: &'a str,
    idle: &'a str,
    numbers: bool,
    animations: bool,
    fading: bool,
    step: u64,
) -> (&'a str, bool) {
    let pending = status.busy || status.attention.is_some();
    let unread = status.unread.is_some() && !pending;
    let text = if numbers {
        label
    } else if status.attention == Some(Attention::Permission) {
        "!"
    } else if status.attention == Some(Attention::Question) {
        "?"
    } else if status.runs() {
        let frames = opencode_ui::motion::SPINNER_FRAMES;
        let frame = if animations { (step % frames.len() as u64) as usize } else { 0 };
        frames[frame]
    } else if label == "+" {
        "+"
    } else if status.unread.is_some() || fading {
        UNREAD_MARKER
    } else {
        idle
    };
    (text, unread)
}

pub(super) fn fade(color: Color, background: Color, index: usize, length: usize, leading: f64) -> Color {
    let step = |position: f64| {
        if position <= 0.0 { 0.0 } else { 0.2 + 0.72 * ((position - 1.0) / (FADE_WIDTH as f64 - 1.0).max(1.0)) }
    };
    // Narrow titles shorten both fades so they never overlap and the middle cell stays fully opaque.
    let width = FADE_WIDTH.min(length.saturating_sub(1) / 2);
    let start = if index < width { (FADE_WIDTH - index) as f64 } else { 0.0 };
    let end = if index >= length - width { index as f64 - (length as f64 - FADE_WIDTH as f64) + 1.0 } else { 0.0 };
    let opacity = (step(start) * leading).max(step(end));
    if opacity == 0.0 { color } else { tint(color, background, opacity) }
}

pub(super) fn take_width(text: &str, width: usize) -> impl Iterator<Item = char> + '_ {
    let mut used = 0;
    text.chars().take_while(move |character| {
        let next = char_width(*character);
        if used + next > width {
            return false;
        }
        used += next;
        true
    })
}

pub(super) fn paint_pulse(painter: &mut Painter<'_>, x: i32, y: i32, cells: Option<Vec<(Option<char>, Color, Color)>>) {
    for (column, (glyph, fg, bg)) in cells.into_iter().flatten().enumerate() {
        let (glyph, fg) = glyph.map_or((' ', Color::DEFAULT_FOREGROUND), |glyph| (glyph, fg));
        painter.cell(x + column as i32, y, glyph, Style::new().fg(fg).bg(bg));
    }
}

pub(super) fn draw_chars(
    painter: &mut Painter<'_>,
    x: i32,
    y: i32,
    characters: impl IntoIterator<Item = char>,
    style: impl Fn(usize) -> Style,
) {
    let mut column = x;
    let mut buffer = [0; 4];
    for (index, character) in characters.into_iter().enumerate() {
        painter.text(column, y, character.encode_utf8(&mut buffer), style(index));
        column += char_width(character) as i32;
    }
}

fn char_width(character: char) -> usize {
    character.width().unwrap_or(1)
}

impl Strip {
    /// `onMouseOver` of the tab under the pointer, or `onMouseOut` of the one it left.
    fn hover_marquee(&self, app: &App, session: Option<&str>) {
        let Some(tui) = self.tui.upgrade() else { return };
        match session.and_then(|session| self.titles.borrow().get(session).cloned().map(|title| (session, title))) {
            Some((session, (title, width))) => {
                let animations = opencode_ui::motion::enabled(tui.config().info.animations);
                self.marquee.enter(app, session, &title, width, animations);
            }
            None => {
                if let Some(left) = &self.hovered {
                    self.marquee.leave(app, left);
                }
            }
        }
    }

    /// The open tabs, as a drag would reorder them, then the new-session tab while it shows. Shared with
    /// [`super::Tabs::tabs`] unless either changes them.
    fn items(&self, tui: &Tui) -> (Rc<[Tab]>, bool) {
        let tabs = tui.tabs.tabs(tui);
        let new_tab = tui.tabs.new_tab();
        let reordered = self.preview.as_ref().and_then(|(session, index)| model::reorder(&tabs, session, *index));
        if reordered.is_none() && !new_tab {
            return (tabs, new_tab);
        }
        let mut items = reordered.unwrap_or_else(|| tabs.to_vec());
        if new_tab {
            items.push(Tab::new(NEW_TAB, Some(NEW_SESSION_TAB_TITLE.to_owned())));
        }
        (items.into(), new_tab)
    }

    /// Each item's title: the store's, else the tab's, else the default.
    fn names(&self, tui: &Tui, items: &Rc<[Tab]>) -> std::cell::Ref<'_, [String]> {
        if !self.names.borrow().as_ref().is_some_and(|(named, _)| Rc::ptr_eq(named, items)) {
            let titles = tui.data.read(|state| {
                items
                    .iter()
                    .map(|tab| {
                        state
                            .session(&tab.session_id)
                            .and_then(|session| session.title.clone())
                            .or_else(|| tab.title.clone())
                            .unwrap_or_else(|| "Untitled session".to_owned())
                    })
                    .collect()
            });
            *self.names.borrow_mut() = Some((items.clone(), titles));
        }
        std::cell::Ref::map(self.names.borrow(), |names| names.as_ref().map_or(&[][..], |(_, titles)| &titles[..]))
    }

    fn slot_at(&self, x: i32) -> Option<String> {
        self.slots
            .borrow()
            .iter()
            .find(|(start, width, _)| x >= *start as i32 && x < (start + width) as i32)
            .map(|(_, _, session)| session.clone())
    }

    fn on_plus(&self, x: i32) -> bool {
        self.plus.get().is_some_and(|plus| x >= plus as i32 && x < (plus + ADD_TAB_WIDTH) as i32)
    }
}

impl Component for Strip {
    fn paint(&self, painter: &mut Painter<'_>) {
        let Some(tui) = self.tui.upgrade() else { return };
        let theme = tui.page();
        let animations = opencode_ui::motion::enabled(tui.config().info.animations);
        let numbers = matches!(tui.config().tabs.indicators, opencode_local::cli_config::TabsIndicators::Numbers);
        let (items, new_tab) = self.items(&tui);
        let active = if new_tab { Some(NEW_TAB.to_owned()) } else { tui.tabs.current(&tui) };
        let show_plus = !new_tab;
        let width = painter.width() as i64;
        let ids: Vec<&str> = items.iter().map(|tab| tab.session_id.as_str()).collect();
        let layout = model::layout(
            &ids,
            active.as_deref(),
            width - if show_plus { ADD_TAB_WIDTH as i64 } else { 0 },
            self.start.get(),
        );
        self.start.set(layout.start);
        let palette = Palette {
            unread: theme.accent().step(200),
            active_number: theme.interactive().step(200),
            idle_number: tint(theme.text.formfield.base, theme.background.base, 0.55),
        };
        let names = self.names(&tui, &items);
        let titles = &names[layout.visible()];

        let mut x = 0usize;
        if layout.before > 0 {
            painter.text(0, 0, &format!("‹{}", layout.before), Style::new().fg(theme.text.muted));
            x += model::overflow_width(layout.before);
        }
        let number_width = items.len().to_string().len().max(2);
        // A marquee whose tab left the strip ends.
        if self.marquee.active().is_some_and(|active| !items.iter().any(|tab| tab.session_id == active)) {
            self.marquee.reset(&tui.app);
        }
        let marquee_session = self.marquee.active();
        let mut marquee_titles = self.titles.borrow_mut();
        // The last paint's slots, overwritten in place: a tab painted again keeps its owned ID.
        let mut slots = self.slots.take();
        let mut pulses = self.pulses.borrow_mut();
        let mut markers = self.fades.borrow_mut();
        let mut spins = self.spins.borrow_mut();
        let mut spinning = Vec::new();
        let now = tui.app.now();
        for (offset, tab) in items[layout.visible()].iter().enumerate() {
            let index = layout.start + offset;
            let tab_width = layout.widths[offset].max(1);
            let session = tab.session_id.as_str();
            let status = if session == NEW_TAB { Status::default() } else { tui.tabs.status(&tui, session) };
            let selected = active.as_deref() == Some(session);
            let hovered = self.hovered.as_deref() == Some(session);
            let dragged = self.dragged && self.pressed.as_deref() == Some(session);
            let selection = f64::from(u8::from(selected));
            let activity = f64::from(u8::from(status.complete()));
            let lifted = (hovered || dragged) && !selected;
            let base = if lifted { theme.background.action.primary.hovered } else { theme.background.base };
            let background =
                tint(base, theme.decrease(&theme.background.raised.base, 1), if dragged { 1.0 } else { selection });
            let feedback = feedback(&status, &theme);
            let glow_level = if selected && status.attention.is_some() { 0.7 } else { 1.0 };
            let glow_color = tint(background, feedback.unwrap_or(palette.unread), glow_level);
            let glows = status.attention.is_some() || (!selected && !status.busy && status.unread.is_some());
            let left = x as i32;
            painter.fill(left, 0, tab_width as u32, 1, background);

            let input = pulse::Input {
                active: status.runs(),
                prompt_pulse: status.prompt_pulse,
                complete: status.complete() && status.attention.is_none(),
                glow: glows,
            };
            // Keyed lookups first: an owned key only for a tab seen for the first time.
            match pulses.get_mut(session) {
                Some(pulse) => {
                    pulse.set_enabled(animations);
                    pulse.set(input);
                }
                None => drop(pulses.insert(session.to_owned(), Pulse::mount(animations, input))),
            }
            let pulse = &pulses[session];
            let colors = pulse::Colors {
                background,
                color: tint(background, theme.text.base, 0.45),
                glow: glow_color,
                flash: tint(background, theme.text.base, 0.65),
                completion: palette.unread,
                glow_tail: pulse::GLOW_TAIL,
                flash_tail: None,
            };
            let sweep = pulse.level(tab_width);
            paint_pulse(painter, left, 0, pulse::paint(pulse, &colors, None, tab_width));

            let foreground = if hovered { theme.text.base } else { tint(theme.text.muted, theme.text.base, selection) };
            let runs = status.runs();
            let number = {
                let base = if hovered && !selected {
                    foreground
                } else {
                    tint(palette.idle_number, tint(theme.text.base, background, 0.25), selection)
                };
                let color = if runs {
                    palette.active_number
                } else {
                    feedback.unwrap_or_else(|| tint(base, palette.unread, activity))
                };
                tint(color, theme.text.base, 0.15 * sweep)
            };
            let bold = selected || dragged;
            let label = if session == NEW_TAB { "+".to_owned() } else { (index + 1).to_string() };
            let unread_color = feedback.unwrap_or(palette.unread);
            if !markers.contains_key(session) {
                markers.insert(session.to_owned(), MarkerFade::new(&status, unread_color));
            }
            let marker = markers.get_mut(session).expect("inserted above");
            marker.set(&status, unread_color, animations, now);
            let faded = marker.color(&status, background, theme.text.base, now);
            // `TabIndicator` mounts a `<spinner>` while the tab runs with animations on and no numbers.
            let spinner = runs && animations && !numbers;
            let step = if spinner { *spins.entry(session.to_owned()).or_insert(0) } else { 0 };
            if spinner {
                spinning.push(session.to_owned());
            }
            let (glyph, unread) = indicator(&status, &label, "", numbers, animations, faded.is_some(), step);
            // The strip's `TabIndicator` takes no `selected`, so a selected tab's marker fades too.
            let indicator_color = if numbers {
                number
            } else if let Some(color) = faded {
                color
            } else if selected {
                number
            } else if unread {
                feedback.unwrap_or(palette.unread)
            } else {
                number
            };
            let glyph_width = glyph.width();
            let mut style = Style::new().fg(indicator_color);
            if bold {
                style = style.bold();
            }
            painter.text(left + number_width as i32 - glyph_width as i32, 0, glyph, style);

            let resting = tab_width.saturating_sub(1 + number_width).max(1);
            let available = if hovered { resting.saturating_sub(2).max(1) } else { resting };
            let title = &titles[offset];
            let hovered_width = resting.saturating_sub(2).max(1);
            match marquee_titles.get_mut(session) {
                Some(entry) => {
                    entry.0.clone_from(title);
                    entry.1 = hovered_width;
                }
                None => drop(marquee_titles.insert(session.to_owned(), (title.clone(), hovered_width))),
            }
            let scrolling = marquee_session.as_deref() == Some(session);
            let parts = if scrolling {
                marquee::text_parts(title, available, self.marquee.offset())
            } else {
                take_width(title, available).map(|character| (character, false)).collect()
            };
            let leading = if scrolling { self.marquee.leading(now) } else { 0.0 };
            let fades = marquee::overflows(title, available) && available > FADE_WIDTH;
            let length = parts.len();
            let visible = parts.iter().map(|(character, _)| *character);
            draw_chars(painter, left + number_width as i32 + 1, 0, visible, |character| {
                let color = if glows {
                    tint(
                        foreground,
                        glow_color,
                        0.12 * pulse::unread_glow_intensity(1 + number_width + character, tab_width),
                    )
                } else {
                    foreground
                };
                let color = if fades { fade(color, background, character, length, leading) } else { color };
                let color = if parts[character].1 { tint(color, background, 0.55) } else { color };
                let style = Style::new().fg(color);
                if bold { style.bold() } else { style }
            });
            if hovered && tab_width >= 2 {
                let color =
                    if self.close_hovered { theme.text.base } else { tint(theme.text.muted, theme.text.base, 0.6) };
                painter.text(left + tab_width as i32 - 2, 0, "✕", Style::new().fg(color));
            }
            match slots.get_mut(offset) {
                Some(slot) if slot.2 == session => (slot.0, slot.1) = (x, tab_width),
                Some(slot) => *slot = (x, tab_width, session.to_owned()),
                None => slots.push((x, tab_width, session.to_owned())),
            }
            x += tab_width;
        }
        slots.truncate(layout.widths.len());
        // A tab's `TabPulse` and spinner unmount with it: drop those of tabs no longer painted.
        pulses.retain(|session, _| slots.iter().any(|(_, _, painted)| painted == session));
        spins.retain(|session, _| spinning.contains(session));
        let (live, spin) = (pulses.values().any(Pulse::live), !spins.is_empty());
        drop((pulses, spins));
        // Both tick only while the strip is drawn. The clock shares their frames: 20 a second while a tab runs.
        hold(&self.spin, spin, || {
            tui.frame.strip.on_animation_tick(
                spinner_fps(),
                bind!(tui.weak(), |tui, _, tick: Tick| {
                    tui.frame.strip.with(|strip| step(&strip.spins, tick.ticks));
                }),
            )
        });
        hold(&self.pulse, live, || {
            tui.frame.strip.on_animation_tick(
                pulse::FPS,
                bind!(tui.weak(), |tui, _, tick: Tick| {
                    let strip = &tui.frame.strip;
                    strip.update(|strip| {
                        strip.pulses.borrow_mut().values_mut().for_each(|pulse| pulse.advance(tick.elapsed))
                    });
                }),
            )
        });
        markers.retain(|session, _| slots.iter().any(|(_, _, painted)| painted == session));
        if markers.values().any(|marker| marker.moving(now)) {
            crate::frame::wake_markers(&tui);
        }
        drop(markers);
        if layout.after > 0 {
            painter.text(x as i32, 0, &format!(" {}›", layout.after), Style::new().fg(theme.text.muted));
            x += model::overflow_width(layout.after);
        }
        self.plus.set(None);
        if show_plus {
            let style = if self.plus_hovered {
                Style::new().fg(theme.text.base).bg(theme.background.action.primary.hovered)
            } else {
                Style::new().fg(theme.text.muted).bg(Color::TRANSPARENT)
            };
            painter.text(x as i32, 0, " + ", style);
            self.plus.set(Some(x));
        }
        marquee_titles.retain(|session, _| slots.iter().any(|(_, _, painted)| painted == session));
        drop(marquee_titles);
        *self.slots.borrow_mut() = slots;
    }

    fn mouse(&mut self, cx: &mut Cx<'_>, event: &MouseEvent, local: (i32, i32)) -> bool {
        let x = local.0;
        let on_plus = self.on_plus(x);
        let slot = self.slot_at(x);
        let close = |session: &str, slots: &[(usize, usize, String)]| {
            slots
                .iter()
                .find(|(_, _, id)| id == session)
                .is_some_and(|(start, width, _)| x == (start + width) as i32 - 2)
        };
        let defer = |cx: &mut Cx<'_>, run: Box<dyn FnOnce(&Tui)>| {
            cx.defer(bind!(self.tui, |tui, _| run(&tui)));
        };
        match event.kind {
            MouseEventKind::Moved => {
                if slot != self.hovered {
                    self.hover_marquee(cx.app(), slot.as_deref());
                }
                self.hovered = slot.clone();
                self.close_hovered = slot.as_deref().is_some_and(|session| close(session, &self.slots.borrow()));
                self.plus_hovered = on_plus;
                true
            }
            MouseEventKind::Down(MouseButton::Middle) => {
                let Some(session) = slot else { return false };
                self.pressed = None;
                defer(cx, Box::new(move |tui| super::close(tui, (session != NEW_TAB).then_some(session.as_str()))));
                true
            }
            MouseEventKind::Down(MouseButton::Left) => {
                self.dragged = false;
                self.plus_pressed = on_plus;
                self.pressed = slot.clone();
                if slot.is_some() {
                    self.hover_marquee(cx.app(), slot.as_deref());
                    self.hovered = slot;
                }
                true
            }
            MouseEventKind::Drag(MouseButton::Left) => {
                let Some(source) = self.pressed.clone().filter(|source| source != NEW_TAB) else { return false };
                self.dragged = true;
                let Some(tui) = self.tui.upgrade() else { return false };
                let tabs = tui.tabs.tabs(&tui);
                let target = self
                    .slots
                    .borrow()
                    .iter()
                    .position(|(start, width, _)| x < (start + width) as i32)
                    .unwrap_or(self.slots.borrow().len().saturating_sub(1))
                    + self.start.get();
                let target = target.min(tabs.len().saturating_sub(1));
                let from = tabs.iter().position(|tab| tab.session_id == source);
                if from != Some(target) {
                    self.preview = Some((source, target));
                }
                true
            }
            MouseEventKind::Up(MouseButton::Left) => {
                let plus = std::mem::take(&mut self.plus_pressed) && on_plus;
                let source = self.pressed.take();
                let dragged = std::mem::take(&mut self.dragged);
                let preview = self.preview.take();
                if plus {
                    defer(cx, Box::new(super::add));
                    return true;
                }
                let Some(source) = source else { return false };
                let closing = !dragged
                    && self.hovered.as_deref() == Some(source.as_str())
                    && close(&source, &self.slots.borrow());
                defer(
                    cx,
                    Box::new(move |tui| {
                        if closing {
                            super::close(tui, (source != NEW_TAB).then_some(source.as_str()));
                            return;
                        }
                        if let Some((session, index)) = preview.filter(|(session, _)| *session == source) {
                            super::reorder(tui, &session, index);
                        }
                        if source != NEW_TAB {
                            super::select(tui, &source);
                        }
                    }),
                );
                true
            }
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use opentui::prelude::Color;

    use super::{MarkerFade, Status, Unread, fade, indicator};

    const BG: Color = Color::rgb(30, 30, 30);
    const FLASH: Color = Color::rgb(238, 238, 238);
    const UNREAD: Color = Color::rgb(157, 124, 216);

    #[test]
    fn narrow_scrolling_titles_keep_the_middle_opaque() {
        let opaque = |length: usize, leading: f64| -> Vec<bool> {
            (0..length).map(|index| fade(FLASH, BG, index, length, leading) == FLASH).collect()
        };
        assert_eq!(opaque(5, 1.0), [false, false, true, false, false]);
        assert_eq!(opaque(6, 1.0), [false, false, true, true, false, false]);
        assert_eq!(opaque(7, 1.0), [false, false, false, true, false, false, false]);
        assert_eq!(opaque(8, 1.0), [false, false, false, true, true, false, false, false]);
        assert_eq!(fade(FLASH, BG, 0, 5, 1.0), fade(FLASH, BG, 0, 12, 1.0));
        assert_eq!(fade(FLASH, BG, 4, 5, 1.0), fade(FLASH, BG, 11, 12, 1.0));
        assert_eq!(opaque(12, 1.0), [false, false, false, false, true, true, true, true, false, false, false, false]);
        assert_eq!(opaque(12, 0.0), [true, true, true, true, true, true, true, true, false, false, false, false]);
    }

    fn unread() -> Status {
        Status { unread: Some(Unread::Activity), ..Status::default() }
    }

    #[test]
    fn a_viewed_marker_eases_out_over_180_ms_with_smoothstep() {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut marker = MarkerFade::new(&unread(), UNREAD);
        marker.set(&unread(), UNREAD, true, start);
        assert_eq!(marker.color(&unread(), BG, FLASH, start), None, "an unread marker shows the unread color");
        marker.set(&Status::default(), UNREAD, true, start);
        assert_eq!(marker.color(&Status::default(), BG, FLASH, start), Some(UNREAD));
        assert!(marker.moving(at(100)));
        // smoothstep(0.5) = 0.5: half way at 90 ms, so the marker is a blend of background and unread color.
        let half = marker.color(&Status::default(), BG, FLASH, at(90)).unwrap();
        assert_eq!(half, opencode_ui::theme::tint(BG, UNREAD, 0.5 / 0.8));
        let (glyph, _) = indicator(&Status::default(), "1", "", false, true, true, 0);
        assert_eq!(glyph, "•", "a fading marker keeps its glyph");
        assert!(!marker.moving(at(180)));
        assert_eq!(marker.color(&Status::default(), BG, FLASH, at(180)), None, "gone after 180 ms");
        marker.set(&Status::default(), UNREAD, true, at(200));
        assert!(!marker.moving(at(201)));
    }

    #[test]
    fn busy_or_animations_off_drop_the_marker_at_once() {
        let start = Instant::now();
        let mut marker = MarkerFade::new(&unread(), UNREAD);
        marker.set(&Status::default(), UNREAD, false, start);
        assert_eq!(marker.color(&Status::default(), BG, FLASH, start), None);
        let mut marker = MarkerFade::new(&unread(), UNREAD);
        marker.set(&Status { busy: true, ..unread() }, UNREAD, true, start);
        assert_eq!(marker.color(&Status::default(), BG, FLASH, start), None);
        let mut marker = MarkerFade::new(&Status::default(), UNREAD);
        marker.set(&Status::default(), UNREAD, true, start);
        assert!(!marker.moving(start) && marker.color(&Status::default(), BG, FLASH, start).is_none());
    }
}
