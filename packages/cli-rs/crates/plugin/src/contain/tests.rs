//! `budget` (synthesis 4.14): the slow state, the overrun and the hang follow the rule of 4.4 exactly at each
//! boundary. The clock and the frame counter are injected, so nothing sleeps.

use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::watchdog::{Action, action};
use super::*;

const US: Duration = Duration::from_micros(1);
const NS: Duration = Duration::from_nanos(1);

/// A monitor whose clock moves only when a call says so, and whose frame is set by the test.
struct Bench {
    monitor: Monitor,
    now: Rc<Cell<Duration>>,
    frame: Rc<Cell<u64>>,
}

impl Bench {
    fn new() -> Self {
        let monitor = Monitor::default();
        let (now, frame) = (Rc::new(Cell::new(Duration::ZERO)), Rc::new(Cell::new(0)));
        let base = Instant::now();
        let clock = now.clone();
        monitor.set_clock(move || base + clock.get());
        let counter = frame.clone();
        monitor.set_frames(move || counter.get());
        Self { monitor, now, frame }
    }

    /// A call of `kind` that takes `took` on the injected clock.
    fn call(&self, slot: Slot, kind: &'static str, took: Duration) -> Timed {
        let now = self.now.clone();
        self.monitor.call(slot, kind, move || now.set(now.get() + took)).1
    }

    /// One frame in which the plugin's calls take `took` each; returns the news of the frame it ends.
    fn frame(&self, slot: Slot, took: &[Duration]) -> Option<String> {
        self.frame.set(self.frame.get() + 1);
        took.iter().map(|took| self.call(slot, "render-slot", *took).slow).fold(None, |news, slow| news.or(slow))
    }

    /// `over` frames over the budget, then `under` under it, then one more frame to close the last.
    fn frames(&self, slot: Slot, over: usize, under: usize) -> Vec<String> {
        let mut news: Vec<String> = Vec::new();
        for _ in 0..over {
            news.extend(self.frame(slot, &[Duration::from_millis(2)]));
        }
        for _ in 0..under {
            news.extend(self.frame(slot, &[Duration::from_micros(500)]));
        }
        news
    }
}

// Expected (4.4): slow is over the frame budget in more than 12 of the last 120 frames the plugin ran in. 12 is not
// slow and 13 is; the news comes once, as the frame that makes it slow ends, and says what a slow frame costs.
#[test]
fn twelve_slow_frames_of_120_are_not_slow_and_thirteen_are() {
    for (over, slow) in [(12, false), (13, true)] {
        let bench = Bench::new();
        let slot = bench.monitor.slot("p");
        let mut news = bench.frames(slot, over, 120 - over);
        news.extend(bench.frame(slot, &[US]));
        assert_eq!(bench.monitor.is_slow("p"), slow, "{over} over");
        assert_eq!(news, if slow { vec!["2.0 ms a frame".to_owned()] } else { Vec::new() }, "{over} over");
        assert_eq!(bench.monitor.report("p").is_some(), slow);
    }
}

// Expected: the frame budget is per frame, summed over the calls: exactly 1 ms is in it, 1 ms and 1 ns is over it,
// and two calls of 0.6 ms in one frame are over it.
#[test]
fn the_frame_budget_is_a_sum_and_its_limit_is_inside() {
    for (calls, over) in [
        (vec![Duration::from_millis(1)], false),
        (vec![Duration::from_millis(1) + NS], true),
        (vec![Duration::from_micros(600), Duration::from_micros(600)], true),
        (vec![Duration::from_micros(500), Duration::from_micros(500)], false),
    ] {
        let bench = Bench::new();
        let slot = bench.monitor.slot("p");
        for _ in 0..13 {
            bench.frame(slot, &calls);
        }
        bench.frame(slot, &[US]);
        assert_eq!(bench.monitor.is_slow("p"), over, "{calls:?}");
    }
}

// Expected: the window is the last 120 frames the plugin ran in. Frames without a call of it do not count, old ones
// fall out and the flag clears, and a plugin that is slow again is not told twice in a session.
#[test]
fn the_window_rolls_and_the_news_comes_once_a_session() {
    let bench = Bench::new();
    let slot = bench.monitor.slot("p");
    let other = bench.monitor.slot("q");
    let mut news = bench.frames(slot, 13, 0);
    // Frames in which only another plugin runs are not the plugin's.
    for _ in 0..200 {
        bench.frame(other, &[US]);
    }
    news.extend(bench.frame(slot, &[US]));
    assert_eq!(news.len(), 1);
    assert!(bench.monitor.is_slow("p"));
    assert!(bench.frames(slot, 0, 120).is_empty());
    bench.frame(slot, &[US]);
    assert!(!bench.monitor.is_slow("p"));
    assert!(bench.frames(slot, 13, 1).is_empty());
    assert!(bench.monitor.is_slow("p"));
    assert!(!bench.monitor.is_slow("q"));
}

// Expected (4.4): one call over 100 ms is an overrun, 100 ms is not. The first call after `setup` is exempt, as its
// pages are cold, and only that one; `setup` and `dispose` never are overruns and count for no frame.
#[test]
fn an_overrun_is_one_call_over_100_ms_and_a_cold_first_call_is_exempt() {
    let bench = Bench::new();
    let slot = bench.monitor.slot("p");
    let long = Duration::from_millis(100);
    assert!(!bench.call(slot, "run-command", long).overrun);
    assert!(bench.call(slot, "run-command", long + NS).overrun);
    assert!(!bench.call(slot, "setup", Duration::from_secs(1)).overrun);
    assert_eq!(bench.monitor.load("p"), Some(Duration::from_secs(1)));
    assert!(!bench.call(slot, "render-slot", Duration::from_millis(500)).overrun);
    assert!(bench.call(slot, "render-slot", long + NS).overrun);
    assert!(!bench.call(slot, "dispose", Duration::from_secs(1)).overrun);
    // `setup` and `dispose` put nothing in a frame.
    let fresh = Bench::new();
    let slot = fresh.monitor.slot("p");
    for _ in 0..20 {
        fresh.frame.set(fresh.frame.get() + 1);
        fresh.call(slot, "setup", Duration::from_millis(5));
        fresh.call(slot, "dispose", Duration::from_millis(5));
    }
    fresh.frame(slot, &[US]);
    fresh.frame(slot, &[US]);
    assert!(!fresh.monitor.is_slow("p"));
}

// Expected: a call within a call is part of the outer one: it is not timed apart, and the outer one counts all.
#[test]
fn a_nested_call_is_part_of_the_outer_one() {
    let bench = Bench::new();
    let slot = bench.monitor.slot("p");
    let now = bench.now.clone();
    let (inner, outer) = bench.monitor.call(slot, "run-command", || {
        let inner = bench.call(slot, "on-event", Duration::from_millis(150));
        now.set(now.get() + Duration::from_millis(1));
        inner
    });
    assert_eq!(inner, Timed::default());
    assert_eq!(outer.took, Duration::from_millis(151));
    assert!(outer.overrun);
}

// Expected (4.4): 4 ms for all plugins together in a frame; exactly 4 ms is in it.
#[test]
fn all_plugins_share_four_ms_a_frame() {
    for (each, over) in [(Duration::from_millis(1), 0), (Duration::from_millis(1) + US, 1)] {
        let bench = Bench::new();
        let slots: Vec<Slot> = ["a", "b", "c", "d"].iter().map(|id| bench.monitor.slot(id)).collect();
        bench.frame.set(1);
        slots.iter().for_each(|slot| drop(bench.call(*slot, "render-slot", each)));
        bench.frame.set(2);
        bench.call(slots[0], "render-slot", US);
        assert_eq!(bench.monitor.frames_over_all(), over, "{each:?}");
    }
}

// Expected (4.5): the watchdog paints its notice at 0.5 s, once a call, and ends the client at 2 s.
#[test]
fn the_watchdog_notices_at_half_a_second_and_acts_at_two() {
    let limits = Limits::default();
    let ms = Duration::from_millis;
    for (running, noticed, expected) in [
        (ms(499), false, Action::Wait),
        (ms(500), false, Action::Notice),
        (ms(500), true, Action::Wait),
        (ms(1999), true, Action::Wait),
        (ms(2000), true, Action::Hang),
        (ms(2000), false, Action::Hang),
    ] {
        assert_eq!(action(&limits, running, noticed), expected, "{running:?} noticed {noticed}");
    }
}

// Expected: the limits are starting values the environment can change, entry by entry.
#[test]
fn the_limits_parse_from_text() {
    let limits = Limits::parse("frame=2ms, overrun=250ms,hang=3s,notice=750000us,window=60,slow=6,all=8ms").unwrap();
    assert_eq!(
        limits,
        Limits {
            frame: Duration::from_millis(2),
            all: Duration::from_millis(8),
            overrun: Duration::from_millis(250),
            window: 60,
            slow: 6,
            notice: Duration::from_millis(750),
            hang: Duration::from_secs(3),
        }
    );
    assert_eq!(Limits::parse(""), Ok(Limits::default()));
    for bad in ["frame", "frame=2", "frame=xms", "speed=1ms", "window=many"] {
        assert!(Limits::parse(bad).is_err(), "{bad}");
    }
}
