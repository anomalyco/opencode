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

// Expected: the time the thread waited on a run queue during a call is the machine's load, not the plugin's, so it is
// not charged: 150 ms with 50 ms of it queued is 100 ms and no overrun, with 50 ms less a nanosecond it is one. Time
// queued before the call is not the call's.
#[test]
fn time_on_a_run_queue_is_not_charged() {
    for (waited, overrun) in [(Duration::from_millis(50), false), (Duration::from_millis(50) - NS, true)] {
        let bench = Bench::new();
        let queued = Rc::new(Cell::new(Duration::from_secs(7)));
        let read = queued.clone();
        *bench.monitor.queued.borrow_mut() = Rc::new(move || read.get());
        let slot = bench.monitor.slot(&Artifact::builtin("p"));
        let now = bench.now.clone();
        let ((), timed) = bench.monitor.call(slot, "run-command", || {
            now.set(now.get() + Duration::from_millis(150));
            queued.set(queued.get() + waited);
        });
        assert_eq!(timed.took, Duration::from_millis(150) - waited);
        assert_eq!(timed.overrun, overrun, "{waited:?}");
    }
}

// Expected (FT-13): the overrun judges the CPU time the call used, where the OS tells it. A call that blocks for 250 ms
// without the CPU (a sleep, as a page fault served from swap, a lock or a slow disk is) is no overrun, though its wall
// time is over the limit; that wall time stays in what the frame budget and the slow report count. One that keeps the
// CPU for 150 ms is an overrun. On the real clocks.
#[cfg(any(unix, windows))]
#[test]
fn an_overrun_is_judged_by_cpu_time_not_wall_time() {
    let monitor = Monitor::default();
    let slot = monitor.slot(&Artifact::builtin("p"));
    let ((), blocked) = monitor.call(slot, "run-command", || std::thread::sleep(Duration::from_millis(250)));
    assert!(blocked.took >= Duration::from_millis(250), "{blocked:?}");
    assert!(blocked.cpu.is_some_and(|cpu| cpu < Duration::from_millis(100)), "{blocked:?}");
    assert!(!blocked.overrun, "{blocked:?}");
    // Its wall time still counts where the slow report and `/plugins`' details read it.
    assert!(monitor.calls_time("p") >= Duration::from_millis(250));
    let ((), busy) = monitor.call(slot, "run-command", || {
        let start = thread_cpu().unwrap();
        while thread_cpu().unwrap() - start < Duration::from_millis(150) {
            std::hint::spin_loop();
        }
    });
    assert!(busy.cpu.is_some_and(|cpu| cpu >= Duration::from_millis(150)) && busy.overrun, "{busy:?}");
}

// Expected (Linux): what the kernel says this thread waited on a run queue grows while another thread holds its only
// CPU, and the call that waited is charged less than its wall time by about that much.
#[cfg(target_os = "linux")]
#[test]
fn the_kernel_tells_the_time_on_a_run_queue() {
    use std::sync::atomic::{AtomicBool, Ordering};
    // SAFETY: `sched_getcpu` takes nothing.
    #[allow(unsafe_code)]
    let cpu = unsafe { libc::sched_getcpu() } as usize;
    pin(cpu);
    let stop = Arc::new(AtomicBool::new(false));
    let spinner = {
        let stop = stop.clone();
        std::thread::spawn(move || {
            pin(cpu);
            while !stop.load(Ordering::Relaxed) {}
        })
    };
    let monitor = Monitor::default();
    let slot = monitor.slot(&Artifact::builtin("p"));
    let before = queued();
    let started = Instant::now();
    // Busy for 200 ms of wall time, which the spinner shares.
    let ((), timed) = monitor.call(slot, "run-command", || while started.elapsed() < Duration::from_millis(200) {});
    let waited = queued() - before;
    stop.store(true, Ordering::Relaxed);
    spinner.join().unwrap();
    assert!(waited > Duration::from_millis(20), "{waited:?}");
    assert!(timed.took < started.elapsed() - waited / 2, "{timed:?} {waited:?}");
}

/// Pins the calling thread to `cpu`.
#[cfg(target_os = "linux")]
#[allow(unsafe_code)]
fn pin(cpu: usize) {
    // SAFETY: a zeroed set is a valid empty one, `CPU_SET` writes inside it, and the call only reads it.
    unsafe {
        let mut set: libc::cpu_set_t = std::mem::zeroed();
        libc::CPU_SET(cpu, &mut set);
        assert_eq!(libc::sched_setaffinity(0, std::mem::size_of::<libc::cpu_set_t>(), &set), 0);
    }
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
    // A paint starting in the frame open does not end it; the next paint, a frame on, does (review carbon 4.1).
    assert!(bench.monitor.close().is_empty());
    bench.frame.set(bench.frame.get() + 1);
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

// Expected (review carbon-4): the monitor says each time a plugin becomes slow or stops being slow, also after the one
// news a session the toast tells, and nothing while it stays as it was.
#[test]
fn every_change_of_slow_is_said_once() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    bench.frames(slot, 12, 0);
    assert!(!bench.monitor.take_flipped());
    bench.frames(slot, 2, 0);
    assert!(bench.monitor.take_flipped() && bench.monitor.is_slow("p"));
    bench.frames(slot, 0, 1);
    assert!(!bench.monitor.take_flipped());
    // The slow frames leave the window of 120: it recovers, then becomes slow again, with no second news.
    let news = bench.frames(slot, 0, 120);
    assert!(news.is_empty() && !bench.monitor.is_slow("p") && bench.monitor.take_flipped());
    let news = bench.frames(slot, 14, 0);
    assert!(news.is_empty() && bench.monitor.is_slow("p") && bench.monitor.take_flipped());
    assert!(!bench.monitor.take_flipped());
}

// Expected (4.4, Pl: "host time for plugin X"): the host's own work for a plugin's nodes is timed apart from the
// plugin's calls. It is the plugin's host time, beside its calls in a slow plugin's details, and it is not in the
// plugin's frame budget: a frame whose host work is 5 ms and whose calls are 0.5 ms is under the budget.
#[test]
fn host_time_is_counted_beside_the_calls_and_not_in_the_budget() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let work = |took: Duration| {
        let now = bench.now.clone();
        bench.monitor.host(slot, &mut || now.set(now.get() + took));
    };
    for _ in 0..120 {
        bench.frame.set(bench.frame.get() + 1);
        work(Duration::from_millis(5));
        bench.call(slot, "render-slot", Duration::from_micros(500));
    }
    bench.frame(slot, &[US]);
    assert_eq!(bench.monitor.host_time("p"), Duration::from_millis(600), "every host work counts");
    assert!(!bench.monitor.is_slow("p"), "host work is not the plugin's frame budget");
    // A slow plugin's details show its host time beside its calls.
    bench.frames(slot, 13, 0);
    bench.frame(slot, &[US]);
    let report = bench.monitor.report("p").expect("slow");
    assert!(report.contains("host 5.0/5.0/5.0 ms"), "{report}");
    assert!(report.contains("render-slot"), "{report}");
}

// Expected (fixed row; review carbon 5.2): host work for plugin p that runs a nested slot of plugin q, whose view and
// host work run inside it, counts p's own 1 ms; q's view is q's call and its host work q's 2 ms.
#[test]
fn nested_host_work_is_its_own_plugins() {
    let bench = Bench::new();
    let (outer, inner) = (bench.monitor.slot(&Artifact::builtin("p")), bench.monitor.slot(&Artifact::builtin("q")));
    let advance = |took: Duration| bench.now.set(bench.now.get() + took);
    bench.monitor.host(outer, &mut || {
        advance(Duration::from_millis(1));
        bench.call(inner, "render-slot", Duration::from_millis(3));
        bench.monitor.host(inner, &mut || advance(Duration::from_millis(2)));
    });
    assert_eq!(bench.monitor.host_time("p"), Duration::from_millis(1), "p's own host time");
    assert_eq!(bench.monitor.host_time("q"), Duration::from_millis(2), "q's host time");
}

/// A backlog of `frames` frames in a row at the end of which the mailbox of `slot` was full: the news of each.
fn backlogged(bench: &Bench, slot: Slot, frames: usize) -> Vec<(String, String)> {
    (0..frames)
        .filter_map(|_| {
            bench.frame.set(bench.frame.get() + 1);
            bench.monitor.backlog(slot, true, 7)
        })
        .collect()
}

// Expected (4.14 `reported-once`; final review big-boi 10): the user is told a plugin is slow once a plugin and session,
// whichever cause comes first: slow by its calls and then by its backlog is one news; so is the backlog first and its
// calls after; and a plugin set up again, or rebuilt, that is slow again tells nothing more. Its state still follows
// each cause and each build.
#[test]
fn slow_is_told_once_a_plugin_and_session_across_causes_and_activations() {
    // Calls first, then the backlog.
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let mut news = bench.frames(slot, 13, 1);
    assert_eq!(news.len(), 1);
    news.extend(backlogged(&bench, slot, 13).into_iter().map(|(_, news)| news));
    assert_eq!(news.len(), 1, "a second cause told again: {news:?}");
    assert!(bench.monitor.is_slow("p"));
    // Set up again (disabled and enabled), then slow again by either cause: nothing more.
    bench.call(slot, "setup", US);
    assert!(!bench.monitor.is_slow("p"));
    assert!(bench.frames(slot, 13, 1).is_empty() && bench.monitor.is_slow("p"));
    bench.call(slot, "setup", US);
    assert!(backlogged(&bench, slot, 13).is_empty() && bench.monitor.is_slow("p"));
    // A new build of the same plugin.
    let new = bench.monitor.slot(&Artifact::external("p", "/p", "0000000000000002"));
    bench.call(new, "setup", US);
    assert!(bench.frames(new, 13, 1).is_empty() && bench.monitor.is_slow("p"));
    // The backlog first, then the calls; another plugin is told of its own.
    let bench = Bench::new();
    let (slot, other) = (bench.monitor.slot(&Artifact::builtin("p")), bench.monitor.slot(&Artifact::builtin("q")));
    assert_eq!(backlogged(&bench, slot, 13).len(), 1);
    assert!(bench.frames(slot, 13, 1).is_empty());
    assert_eq!(bench.frames(other, 13, 1).len(), 1);
}

// Expected (review carbon-12): the backlog cause changes slow as the calls do: the plugin list hears it when the
// backlog makes the plugin slow, also once its news was told, and when the backlog leaves the window with no mail
// since, at the paint that closes the frames.
#[test]
fn a_backlog_that_starts_or_ends_is_a_change_of_slow() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    backlogged(&bench, slot, 12);
    assert!(!bench.monitor.take_flipped() && !bench.monitor.is_slow("p"));
    backlogged(&bench, slot, 1);
    assert!(bench.monitor.take_flipped() && bench.monitor.is_slow("p"));
    assert!(bench.monitor.open_over(), "the paints must close the frames until the backlog ends");
    // No mail for a window: the paints close the frames and see it end.
    bench.frame.set(bench.frame.get() + 120);
    bench.monitor.close();
    assert!(bench.monitor.take_flipped() && !bench.monitor.is_slow("p"));
    assert!(!bench.monitor.open_over());
    // Backlogged a second time, with its news told already: a change all the same.
    backlogged(&bench, slot, 13);
    assert!(bench.monitor.take_flipped() && bench.monitor.is_slow("p"));
}

// Expected (final review big-boi 11): a build keeps one slot from its load, before its ID is known, to its activation:
// a crash in either names the same artifact, by its ID once it is known; a later load of the same build finds that
// slot, and a new build gets its own. An ID too long for the record leaves the build named by its target and digest,
// never unnamed.
#[test]
fn a_build_keeps_one_slot_from_its_load_to_its_activation() {
    let bench = Bench::new();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    bench.monitor.attach(record.clone()).unwrap();
    let (anonymous, named) =
        (Artifact::external("", "/p", "0000000000000001"), Artifact::external("p", "/p", "0000000000000001"));
    let load = bench.monitor.slot(&anonymous);
    assert!(bench.monitor.attributed(load));
    bench.call(load, "load", Duration::from_millis(3));
    let active = bench.monitor.slot(&named);
    assert_eq!(active, load, "the activation took another slot");
    assert_eq!(record.named(active.0), Some(named.clone()));
    assert_eq!(bench.monitor.load("p").0, Some(Duration::from_millis(3)));
    assert_eq!(bench.monitor.slot(&anonymous), load, "a load of the same build again");
    let crashed = |slot: Slot, kind: &str| {
        record.enter(slot.0, record::kind(kind), 0);
        record.crash().artifact
    };
    assert_eq!(crashed(active, "setup"), Some(named.clone()));
    let other = bench.monitor.slot(&Artifact::external("", "/p", "0000000000000002"));
    assert_ne!(other, load, "a new build shares a slot");
    // An ID the record cannot hold beside its target.
    let long = Artifact::external(&"x".repeat(record::NAME_BYTES), "/p", "0000000000000002");
    assert_eq!(bench.monitor.slot(&long), other);
    assert_eq!(crashed(other, "setup"), Some(Artifact::external("", "/p", "0000000000000002")));
    // The same build loaded again, before its ID is known: its build names it, so it is admitted (re-review big-boi
    // 11), and it is the same slot.
    let again = bench.monitor.slot(&Artifact::external("", "/p", "0000000000000002"));
    assert_eq!(again, other);
    assert!(bench.monitor.attributed(again), "the same build is refused on its reload");
    assert!(bench.monitor.attributed(active), "a build named with its ID");
}

// Expected (final review big-boi 11): a build whose identity the record cannot hold, by its length or past the record's
// slots, is not attributed, so the loader does not admit it; without a record every build is.
#[test]
fn a_build_the_record_cannot_name_is_not_attributed() {
    let bench = Bench::new();
    let long = Artifact::external("", &"/p".repeat(record::NAME_BYTES), "0000000000000001");
    assert!(bench.monitor.attributed(bench.monitor.slot(&long)), "no record");
    let bench = Bench::new();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = Arc::new(Record::create(dir.path()).unwrap());
    bench.monitor.attach(record.clone()).unwrap();
    let snapshot = Snapshot { session: Some("ses_a".into()), draft: "kept".into(), dropped: false };
    record.publish(&snapshot);
    assert!(!bench.monitor.attributed(bench.monitor.slot(&long)), "too long");
    for index in 1..record::NAMES {
        let slot = bench.monitor.slot(&Artifact::builtin(&format!("b{index}")));
        assert!(bench.monitor.attributed(slot), "{index}");
    }
    let past = bench.monitor.slot(&Artifact::external("", "/q", "0000000000000001"));
    assert!(!bench.monitor.attributed(past), "past the record's slots");
    // Nothing was written past the names: the snapshot after them reads back.
    assert_eq!(record.snapshot(), Some(snapshot));
}
