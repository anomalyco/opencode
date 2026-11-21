//! `budget`: the slow state and the overrun follow the rule of 4.4 exactly at each boundary. The clock and
//! the frame counter are injected, so nothing sleeps.

use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

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

#[test]
fn an_overrun_is_one_call_over_100_ms_and_a_cold_first_call_is_exempt() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let long = Duration::from_millis(100);
    assert!(!bench.call(slot, "run-command", long).overrun);
    assert!(bench.call(slot, "run-command", long + NS).overrun);
    assert!(!bench.call(slot, "setup", Duration::from_secs(1)).overrun);
    assert_eq!(bench.monitor.setup_time("p"), Some(Duration::from_secs(1)));
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

#[cfg(any(unix, windows))]
#[test]
fn an_overrun_is_judged_by_cpu_time_not_wall_time() {
    let monitor = Monitor::default();
    // The run queue is not this test's: with delayed dequeues, the scheduler can add a sleeper's whole sleep, when it
    // lands on another CPU, to `schedstat`'s run-queue wait (a known upstream `sched_info` over-count), taking the wall
    // time below the sleep. The CPU clock stays real, which is what the overrun judges.
    *monitor.queued.borrow_mut() = Rc::new(|| Duration::ZERO);
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

#[cfg(target_os = "linux")]
#[test]
fn the_kernel_tells_the_time_on_a_run_queue() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    // SAFETY: `sched_getcpu` takes nothing.
    #[allow(unsafe_code)]
    let cpu = unsafe { libc::sched_getcpu() } as usize;
    pin(cpu);
    let stop = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(false));
    let spinner = {
        let stop = stop.clone();
        let running = running.clone();
        std::thread::spawn(move || {
            pin(cpu);
            running.store(true, Ordering::Relaxed);
            while !stop.load(Ordering::Relaxed) {}
        })
    };
    // The window opens with the spinner spinning on the same CPU, so the kernel has two runnable threads to report,
    // and it is the thread's CPU time, so a stall (a page fault, a wake that lands elsewhere) lengthens the window
    // instead of shrinking the wait in it. Two runnable threads on one CPU share it: half the window is a wait.
    let deadline = Instant::now() + Duration::from_secs(5);
    while !running.load(Ordering::Relaxed) {
        assert!(Instant::now() < deadline, "the spinner never ran");
        std::hint::spin_loop();
    }
    let monitor = Monitor::default();
    let slot = monitor.slot(&Artifact::builtin("p"));
    let used = thread_cpu().unwrap();
    let before = queued();
    let started = Instant::now();
    let ((), timed) =
        monitor.call(slot, "run-command", || while thread_cpu().unwrap() - used < Duration::from_millis(100) {});
    let waited = queued() - before;
    stop.store(true, Ordering::Relaxed);
    spinner.join().unwrap();
    assert!(waited > Duration::from_millis(20), "{waited:?} of {:?}, {timed:?}", started.elapsed());
    assert!(timed.took < started.elapsed().saturating_sub(waited / 2), "{timed:?} {waited:?}");
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

#[test]
fn the_limits_parse_from_text() {
    let limits = Limits::parse("frame=2ms, overrun=250ms,window=60,slow=6,all=8ms").unwrap();
    assert_eq!(
        limits,
        Limits {
            frame: Duration::from_millis(2),
            all: Duration::from_millis(8),
            overrun: Duration::from_millis(250),
            window: 60,
            slow: 6,
        }
    );
    assert_eq!(Limits::parse(""), Ok(Limits::default()));
    for bad in ["frame", "frame=2", "frame=xms", "speed=1ms", "window=many"] {
        assert!(Limits::parse(bad).is_err(), "{bad}");
    }
}

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
    // A paint starting in the frame open does not end it; the next paint, a frame on, does.
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

#[test]
fn a_call_that_unwinds_ends_the_call() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let unwound = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        bench.monitor.call(slot, "run-command", || panic!("boom"));
    }));
    assert!(unwound.is_err());
    assert!(bench.call(slot, "run-command", Duration::from_millis(150)).overrun);
}

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

#[test]
fn an_idle_close_leaves_a_frame_with_other_work_for_its_paint() {
    let bench = Bench::new();
    let slot = bench.monitor.slot(&Artifact::builtin("p"));
    let painted = bench.monitor.painted();
    crate::ticking(true, || bench.call(slot, "on-reply", Duration::from_micros(50)));
    bench.call(slot, "run-command", Duration::from_millis(2));
    assert!(bench.monitor.close_idle(painted).is_none(), "the idle close ended a frame with a command in it");
    assert_eq!(bench.monitor.spent(slot), (Duration::from_micros(2050), Duration::from_micros(2050)));
    // A paint ends it; a later tick alone ends as a frame of its own, with no paint.
    bench.frame.set(bench.frame.get() + 1);
    bench.monitor.close();
    let painted = bench.monitor.painted();
    crate::ticking(true, || bench.call(slot, "on-reply", Duration::from_micros(50)));
    assert_eq!(bench.monitor.spent(slot).0, Duration::from_micros(50));
    assert!(bench.monitor.close_idle(painted).is_some());
    assert_eq!(bench.monitor.spent(slot), (Duration::ZERO, Duration::ZERO), "the tick's frame did not end");
}
