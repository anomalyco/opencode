//! `budget` (synthesis 4.14): the slow state, the overrun and the hang follow the rule of 4.4 exactly at each
//! boundary. The clock and the frame counter are injected, so nothing sleeps.

use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

use super::watchdog::{Action, action, decide};
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
        let slot = bench.monitor.slot(&Artifact::builtin("p"));
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
        let slot = bench.monitor.slot(&Artifact::builtin("p"));
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
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let other = bench.monitor.slot(&Artifact::builtin("q"));
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
    // The window is 120 frames exactly: 13 over, then 107 under, is slow; one more and the first over leaves it.
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    bench.frames(slot, 13, 107);
    bench.frame(slot, &[US]);
    assert!(bench.monitor.is_slow("p"));
    bench.frame(slot, &[US]);
    assert!(!bench.monitor.is_slow("p"));
}

// Expected: the record stamps a call with the monotonic clock, which the watchdog reads, also while a test injects the
// budget's clock: a call that started now has run for no time, however far the injected clock is.
#[test]
fn the_record_keeps_the_watchdogs_clock() {
    let bench = Bench::new();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    bench.monitor.attach(record.clone()).unwrap();
    bench.now.set(Duration::from_secs(3600));
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let (started, _) = bench.monitor.call(slot, "run-command", || record.running().map(|running| running.started));
    assert!(started.is_some_and(|started| started < 60_000), "{started:?}");
}

// Expected (4.4): one call over 100 ms is an overrun, 100 ms is not. The first call after `setup` is exempt, as its
// pages are cold, and only that one; `setup` and `dispose` never are overruns and count for no frame.
#[test]
fn an_overrun_is_one_call_over_100_ms_and_a_cold_first_call_is_exempt() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let long = Duration::from_millis(100);
    assert!(!bench.call(slot, "run-command", long).overrun);
    assert!(bench.call(slot, "run-command", long + NS).overrun);
    assert!(!bench.call(slot, "setup", Duration::from_secs(1)).overrun);
    assert_eq!(bench.monitor.load("p").1, Some(Duration::from_secs(1)));
    assert!(!bench.call(slot, "render-slot", Duration::from_millis(500)).overrun);
    assert!(bench.call(slot, "render-slot", long + NS).overrun);
    assert!(!bench.call(slot, "dispose", Duration::from_secs(1)).overrun);
    // The exemption is the first call's, fast or not.
    bench.call(slot, "setup", US);
    assert!(!bench.call(slot, "render-slot", US).overrun);
    assert!(bench.call(slot, "run-command", long + NS).overrun);
    // `setup` and `dispose` put nothing in a frame.
    let fresh = Bench::new();
    let slot = fresh.monitor.slot(&Artifact::builtin("p"));
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
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
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
        let slots: Vec<Slot> =
            ["a", "b", "c", "d"].iter().map(|id| bench.monitor.slot(&Artifact::builtin(id))).collect();
        bench.frame.set(1);
        slots.iter().for_each(|slot| drop(bench.call(*slot, "render-slot", each)));
        bench.frame.set(2);
        bench.call(slots[0], "render-slot", US);
        assert_eq!(bench.monitor.frames_over_all(), over, "{each:?}");
        // Each frame starts from nothing.
        bench.frame.set(3);
        bench.call(slots[0], "render-slot", US);
        assert_eq!(bench.monitor.frames_over_all(), over, "{each:?}, a frame later");
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

// Expected (bigboi, carbon 7): a frame ends at the paint, not at the plugin's next call. Thirteen expensive frames and
// then silence make the plugin slow when the next paint closes the last one, with the news once.
#[test]
fn the_last_expensive_frame_closes_at_the_paint() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    for _ in 0..13 {
        bench.frame.set(bench.frame.get() + 1);
        assert!(bench.call(slot, "render-slot", Duration::from_millis(99)).opened);
        if bench.frame.get() < 13 {
            bench.monitor.close();
        }
    }
    assert!(!bench.monitor.is_slow("p"));
    assert_eq!(bench.monitor.close(), [("p".to_owned(), "99.0 ms a frame".to_owned())]);
    assert!(bench.monitor.is_slow("p"));
    assert!(bench.monitor.close().is_empty());
    // A call in the frame a close already ended opens a new one; within a frame, only the first call opens it.
    bench.frame.set(bench.frame.get() + 1);
    assert!(bench.call(slot, "render-slot", US).opened);
    assert!(!bench.call(slot, "render-slot", US).opened);
    assert!(bench.monitor.wants_close());
    assert!(!bench.monitor.wants_close());
    bench.monitor.close();
    assert!(bench.monitor.wants_close());
}

// Expected: the report is the plugin's p50, p99 and worst per call kind, and the news names the median of its slow
// frames, not the first or the worst.
#[test]
fn the_report_says_the_percentiles_and_the_news_the_median() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let costs: Vec<u64> = (1..=13).map(|n| n * 2).collect();
    let mut news = Vec::new();
    for cost in costs.iter().rev() {
        news.extend(bench.frame(slot, &[Duration::from_millis(*cost)]));
    }
    news.extend(bench.frame(slot, &[US]));
    assert_eq!(news, ["14.0 ms a frame"]);
    assert_eq!(bench.monitor.report("p").as_deref(), Some("slow (p50/p99/worst): render-slot 14.0/26.0/26.0 ms"));
}

// Expected (carbon 7): each build has its own statistics. A new build of a slow plugin starts fresh, and the report of
// an ID is its newest build's.
#[test]
fn a_new_build_starts_with_fresh_statistics() {
    let bench = Bench::new();
    let old = bench.monitor.slot(&Artifact::external("p", "/p", "0000000000000001"));
    bench.frames(old, 13, 1);
    assert!(bench.monitor.is_slow("p"));
    let new = bench.monitor.slot(&Artifact::external("p", "/p", "0000000000000002"));
    assert_ne!(old, new);
    bench.call(new, "setup", US);
    assert!(!bench.monitor.is_slow("p"));
    assert_eq!(bench.monitor.report("p"), None);
}

// Expected (carbon 1): a call that unwinds still leaves the record and the nesting, so the next call is timed and the
// watchdog sees no call running.
#[test]
fn a_call_that_unwinds_leaves_the_record() {
    let bench = Bench::new();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    bench.monitor.attach(record.clone()).unwrap();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        bench.monitor.call(slot, "run-command", || panic!("boom"));
    }));
    assert!(unwound.is_err());
    assert_eq!(record.running(), None);
    assert!(bench.call(slot, "run-command", Duration::from_millis(150)).overrun);
}

// Expected (bigboi 6): a call whose notice the watchdog painted tells the host as it returns, with the plugin and its
// time, so the host can repaint the line; another call does not.
#[test]
fn a_call_that_was_noticed_tells_the_host() {
    let bench = Bench::new();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    bench.monitor.attach(record.clone()).unwrap();
    let told: Rc<std::cell::RefCell<Vec<(Artifact, Duration)>>> = Rc::default();
    let seen = told.clone();
    bench.monitor.set_on_notice(move |artifact, took| seen.borrow_mut().push((artifact.clone(), took)));
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let now = bench.now.clone();
    let inner = record.clone();
    bench.monitor.call(slot, "run-command", || {
        let running = inner.running().unwrap();
        inner.noticed(running.generation);
        now.set(now.get() + Duration::from_millis(700));
    });
    bench.call(slot, "run-command", US);
    assert_eq!(*told.borrow(), [(Artifact::builtin("p"), Duration::from_millis(700))]);
}

// Expected (bigboi 6): the watchdog's decision reads the record: no call, no action; a call that returned is not the
// running one; a running call over the limit is to be claimed.
#[test]
fn the_watchdog_decides_from_the_record() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Record::create(dir.path()).unwrap();
    let limits = Limits::default();
    let s = Duration::from_secs;
    assert_eq!(decide(&limits, &record, s(10), 0).0, Action::Wait);
    let generation = record.enter(0, 1, 1000);
    assert_eq!(decide(&limits, &record, Duration::from_millis(1400), 0).0, Action::Wait);
    assert_eq!(decide(&limits, &record, Duration::from_millis(1500), 0).0, Action::Notice);
    assert_eq!(decide(&limits, &record, Duration::from_millis(1500), generation).0, Action::Wait);
    assert_eq!(decide(&limits, &record, s(3), generation).0, Action::Hang);
    assert!(record.leave(generation));
    assert_eq!(decide(&limits, &record, s(3), generation).0, Action::Wait);
}

// Expected (reload-fresh): a build set up again (disabled and enabled) starts with fresh statistics, as a new build
// does.
#[test]
fn a_build_set_up_again_starts_fresh() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    bench.frames(slot, 13, 1);
    assert!(bench.monitor.is_slow("p"));
    bench.call(slot, "setup", US);
    assert!(!bench.monitor.is_slow("p"));
    assert_eq!(bench.monitor.report("p"), None);
}

// Expected (bigboi 6): the notice thread paints only a call that still runs: one that returned before its turn is not
// marked noticed, so the host does not say it responded.
#[test]
fn the_notice_is_only_for_a_running_call() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    record.name(0, &Artifact::builtin("p"));
    let paint = |running| {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        send.send(running).unwrap();
        drop(send);
        watchdog::paint(Arc::downgrade(&record), receive, Limits::default(), None, Instant::now());
    };
    let returned = record.enter(0, 1, 0);
    let stale = record.running().unwrap();
    assert!(record.leave(returned));
    paint(stale);
    assert!(!record.was_noticed(returned));
    let live = record.enter(0, 1, 0);
    paint(record.running().unwrap());
    assert!(record.was_noticed(live));
    assert!(record.leave(live));
}
