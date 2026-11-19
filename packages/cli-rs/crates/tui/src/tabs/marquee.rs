//! A hovered tab's overflowing title scrolls once around: `createMarquee` and `createTabMarquee`
//! (`component/session-tabs.tsx`) with `util/marquee.ts`. The rail and the strip each hold one, so at most one title
//! scrolls in each. It waits [`DELAY`], then steps a cell every [`INTERVAL`] on the app's shared animation clock, and
//! after one cycle it stops on the title's start until the pointer enters another tab. The leading edge fades in while
//! it scrolls. As in TypeScript the scroll runs with animations off too; only that fade jumps instead of easing.

use std::time::Instant;

use opentui::app::{AnimationTick, Tick, TimerId};
use unicode_width::UnicodeWidthStr;

use super::strip::take_width;
use crate::prelude::*;

const DELAY: Duration = Duration::from_millis(600);
const INTERVAL: Duration = Duration::from_millis(80);
/// `tween({ duration: 0.25 })` of the leading fade.
const LEADING: Duration = Duration::from_millis(250);
const GAP: &str = " · ";

/// One marquee. Clones share it, so the timer and the ticks reach it without the widget.
#[derive(Clone, Default)]
pub struct Marquee(Rc<RefCell<State>>);

#[derive(Default)]
struct State {
    active: Option<String>,
    offset: usize,
    cycle: usize,
    animations: bool,
    delay: Option<TimerId>,
    scroll: Option<AnimationTick>,
    leading: Leading,
    leading_tick: Option<AnimationTick>,
}

/// `createAnimatable({ opacity: 0 }, tween)`, eased by smoothstep.
#[derive(Clone, Copy, Default)]
struct Leading {
    from: f64,
    target: f64,
    started: Option<Instant>,
}

impl Leading {
    fn progress(&self, now: Instant) -> Option<f64> {
        let started = self.started?;
        Some((now.saturating_duration_since(started).as_secs_f64() / LEADING.as_secs_f64()).min(1.0))
    }

    fn value(&self, now: Instant) -> f64 {
        self.progress(now).map_or(self.from, |p| self.from + (self.target - self.from) * p * p * (3.0 - 2.0 * p))
    }

    fn jump(value: f64) -> Self {
        Self { from: value, target: value, started: None }
    }
}

impl Marquee {
    /// The pointer is over `session`, whose `title` shows in `width` cells while hovered. A title that fits ends any
    /// scroll; the tab that already scrolls goes on.
    pub fn enter(&self, app: &App, session: &str, title: &str, width: usize, animations: bool) {
        if !overflows(title, width) {
            return self.reset(app);
        }
        if self.0.borrow().active.as_deref() == Some(session) {
            return;
        }
        self.clear(app);
        let weak = Rc::downgrade(&self.0);
        let delay = app.set_timeout(DELAY, move |cx| {
            let Some(state) = weak.upgrade() else { return };
            let marquee = Marquee(state);
            marquee.0.borrow_mut().delay = None;
            marquee.0.borrow_mut().offset = 1;
            marquee.animate_leading(cx.app(), 1.0);
            marquee.scroll(cx.app());
            cx.request_redraw();
        });
        let mut state = self.0.borrow_mut();
        state.cycle = cycle_width(title);
        state.active = Some(session.to_owned());
        state.offset = 0;
        state.animations = animations;
        state.leading = Leading::jump(0.0);
        state.leading_tick = None;
        state.delay = Some(delay);
    }

    /// The pointer left `session`: its scroll ends and the title shows from its start.
    pub fn leave(&self, app: &App, session: &str) {
        if self.0.borrow().active.as_deref() == Some(session) {
            self.reset(app);
        }
    }

    pub fn reset(&self, app: &App) {
        self.clear(app);
        let mut state = self.0.borrow_mut();
        state.active = None;
        state.offset = 0;
        state.leading = Leading::jump(0.0);
        state.leading_tick = None;
    }

    /// The session whose title the marquee owns, scrolling or waiting.
    pub fn active(&self) -> Option<String> {
        self.0.borrow().active.clone()
    }

    pub fn offset(&self) -> usize {
        self.0.borrow().offset
    }

    /// How far the leading edge fades, from 0 to 1.
    pub fn leading(&self, now: Instant) -> f64 {
        self.0.borrow().leading.value(now)
    }

    /// Stops the wait and the scroll; the offset and the leading fade stay.
    fn clear(&self, app: &App) {
        let (delay, scroll) = {
            let mut state = self.0.borrow_mut();
            (state.delay.take(), state.scroll.take())
        };
        if let Some(delay) = delay {
            app.cancel_timer(delay);
        }
        drop(scroll);
    }

    /// One cell a tick, `ticks` after a late frame, until the cycle ends.
    fn scroll(&self, app: &App) {
        let weak = Rc::downgrade(&self.0);
        let tick = app.on_animation_tick(1.0 / INTERVAL.as_secs_f64(), move |cx, tick: Tick| {
            let Some(state) = weak.upgrade() else { return };
            let marquee = Marquee(state);
            let (offset, cycle) = {
                let state = marquee.0.borrow();
                (state.offset, state.cycle)
            };
            let next = offset + tick.ticks as usize;
            if next < cycle {
                marquee.0.borrow_mut().offset = next;
            } else {
                marquee.clear(cx.app());
                marquee.animate_leading(cx.app(), 0.0);
                marquee.0.borrow_mut().offset = 0;
            }
            cx.request_redraw();
        });
        self.0.borrow_mut().scroll = Some(tick);
    }

    /// Eases the leading fade to `target`, at the app's frame rate, or jumps there with animations off.
    fn animate_leading(&self, app: &App, target: f64) {
        let now = app.now();
        let mut state = self.0.borrow_mut();
        if !state.animations {
            state.leading = Leading::jump(target);
            state.leading_tick = None;
            return;
        }
        let from = state.leading.value(now);
        state.leading =
            if from == target { Leading::jump(target) } else { Leading { from, target, started: Some(now) } };
        if state.leading.started.is_none() {
            state.leading_tick = None;
            return;
        }
        let weak = Rc::downgrade(&self.0);
        state.leading_tick = Some(app.on_animation_tick(60.0, move |cx, _| {
            let Some(state) = weak.upgrade() else { return };
            let done = state.borrow().leading.progress(cx.app().now()).is_none_or(|p| p >= 1.0);
            if done {
                drop(state.borrow_mut().leading_tick.take());
            }
            cx.request_redraw();
        }));
    }
}

fn cycle_width(value: &str) -> usize {
    format!("{value}{GAP}").width()
}

pub fn overflows(value: &str, width: usize) -> bool {
    value.width() > width
}

/// `marqueeTextParts`: the characters of `value` that show in `width` cells `offset` cells into its cycle, each with
/// whether it is the separator dot.
pub fn text_parts(value: &str, width: usize, offset: usize) -> Vec<(char, bool)> {
    if width == 0 {
        return Vec::new();
    }
    if value.width() <= width || offset == 0 {
        return take_width(value, width).into_iter().map(|character| (character, false)).collect();
    }
    let lap: Vec<(char, bool)> = value.chars().map(|c| (c, false)).chain(GAP.chars().map(|c| (c, c == '·'))).collect();
    let cursor = offset % cycle_width(value);
    let parts: Vec<(char, bool)> = lap.iter().chain(lap.iter()).copied().collect();
    let cell = |c: char| unicode_width::UnicodeWidthChar::width(c).unwrap_or(1);
    let mut start = 0;
    let mut used = 0;
    while used < cursor && start < parts.len() {
        used += cell(parts[start].0);
        start += 1;
    }
    let mut shown = 0;
    parts[start..]
        .iter()
        .take_while(|(character, _)| {
            shown += cell(*character);
            shown <= width
        })
        .copied()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(value: &str, width: usize, offset: usize) -> String {
        text_parts(value, width, offset).into_iter().map(|(character, _)| character).collect()
    }

    // The cases of TS's `test/util/marquee.test.ts`.
    #[test]
    fn marquee_text_follows_typescript() {
        assert_eq!(text("Short", 10, 8), "Short");
        assert!(!overflows("Exact fit", 9));
        assert!(overflows("Exact fit", 8));
        let title = "A long session title";
        assert_eq!(text(title, 8, 0), "A long s");
        assert_eq!(text(title, 8, 2), "long ses");
        assert_eq!(text(title, 8, 15), "title · ");
        assert_eq!(text(title, 8, 20), " · A lon");
        assert_eq!(text(title, 8, cycle_width(title) - 3), " · A lon");
        assert_eq!(text(title, 8, cycle_width(title)), "A long s");
        let parts = text_parts("A · title", 6, 7);
        assert_eq!(parts, [('l', false), ('e', false), (' ', false), ('·', true), (' ', false), ('A', false)]);
        assert_eq!(text_parts("A · title", 6, 2)[0], ('·', false));
        let frame = text("Plan 🧭 the release", 8, 5);
        assert_eq!(frame, "🧭 the r");
        assert!(frame.width() <= 8);
    }
}
