//! Memory benchmarks for long-lived runs: a program looping on `await nextEvent()`, driven as a future on this
//! thread the way an OpenTUI host drives its plugins. Build with `--features gc-stats`.
//!
//! Usage:
//! - `gc_bench loop PROGRAM [--events N]`: one run of `bench/gc/PROGRAM.js` handling N events.
//! - `gc_bench many [--heaps 50] [--active 5] [--frames N]`: 50 runs in one process; 5 get an event each frame and the
//!   rest wait, idle.
//! - `gc_bench all [--events N] [--frames N]`: every program, then `many`, each in a fresh process.
//!
//! Each prints one JSON line: event (or frame) latency percentiles, live and peak bytes the allocator counted, the
//! process's physical footprint, the run's heap counts and collection pauses (`Run::heap_stats`), and the allocation
//! rate. A run that fails, for example at its memory limit, reports how many events it handled first.

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::time::{Duration, Instant};

use psychoscript::{
    HostFunction, HostValue, Interrupted, Limits, Outcome, ProgramOptions, Run, Runtime,
};
use serde_json::{Value as Json, json};

#[path = "../src/counters.rs"]
mod counters;

const PROGRAMS: [&str; 6] = [
    "palette",
    "growing",
    "map-churn",
    "strings",
    "closures",
    "generators",
];
const QUERIES: [&str; 8] = ["1", "12", "Com", "k3", "group2", "number 2", "x", "C"];

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_else(|| "all".into());
    let mut program = String::from("palette");
    let (mut events, mut frames, mut heaps, mut active) =
        (20_000usize, 20_000usize, 50usize, 5usize);
    while let Some(arg) = args.next() {
        let mut num = || args.next().and_then(|n| n.parse().ok()).expect("a number");
        match arg.as_str() {
            "--events" => events = num(),
            "--frames" => frames = num(),
            "--heaps" => heaps = num(),
            "--active" => active = num(),
            name if mode == "loop" => program = name.into(),
            other => panic!("unknown argument {other}"),
        }
    }
    match mode.as_str() {
        "loop" => println!("{}", one_loop(&program, events)),
        "many" => println!("{}", many(heaps, active, frames)),
        "all" => {
            let me = std::env::current_exe().expect("own path");
            let mut runs: Vec<Vec<String>> = PROGRAMS
                .iter()
                .map(|p| {
                    vec![
                        "loop".into(),
                        p.to_string(),
                        "--events".into(),
                        events.to_string(),
                    ]
                })
                .collect();
            runs.push(vec!["many".into(), "--frames".into(), frames.to_string()]);
            for run in runs {
                let out = std::process::Command::new(&me)
                    .args(&run)
                    .output()
                    .expect("spawn");
                print!("{}", String::from_utf8_lossy(&out.stdout));
                if !out.status.success() {
                    eprintln!("{run:?} failed: {}", String::from_utf8_lossy(&out.stderr));
                }
            }
        }
        other => panic!("unknown mode {other}"),
    }
}

fn one_loop(program: &str, events: usize) -> Json {
    let mut live = LiveRun::start(program);
    let total_before = TOTAL.load(Ordering::Relaxed);
    let start = Instant::now();
    let mut latencies = Vec::with_capacity(events);
    let mut max_live = 0;
    let mut curve = Vec::new();
    let mut handled = 0;
    for i in 0..events {
        let t = Instant::now();
        if !live.event(event(i)) {
            break;
        }
        latencies.push(t.elapsed().as_nanos() as u64);
        handled += 1;
        let now = LIVE.load(Ordering::Relaxed);
        max_live = max_live.max(now);
        if (i + 1) % (events / 10).max(1) == 0 {
            curve.push(now / 1024);
        }
    }
    let wall = start.elapsed();
    let allocated = TOTAL.load(Ordering::Relaxed) - total_before;
    let stats = live.stats();
    let live_end = LIVE.load(Ordering::Relaxed);
    let failure = live.finish();
    json!({
        "scenario": format!("loop {program}"),
        "events": handled,
        "failure": failure,
        "wall_ms": wall.as_secs_f64() * 1e3,
        "event_us": percentiles(&mut latencies, 1e3),
        "alloc_mb_per_s": allocated as f64 / wall.as_secs_f64() / (1 << 20) as f64,
        "live_kib_end": live_end / 1024,
        "live_kib_max": max_live / 1024,
        "live_kib_curve": curve,
        "peak_kib": PEAK.load(Ordering::Relaxed) / 1024,
        "footprint": footprint(),
        "heap": heap_json(&stats),
    })
}

/// `heaps` runs of the six programs in turn; the first `active` get an event each frame.
fn many(heaps: usize, active: usize, frames: usize) -> Json {
    let mut runs: Vec<LiveRun> = (0..heaps)
        .map(|k| LiveRun::start(PROGRAMS[k % PROGRAMS.len()]))
        .collect();
    let idle_before: Vec<u64> = runs[active..].iter().map(|r| r.stats().steps).collect();
    let live_setup = LIVE.load(Ordering::Relaxed);
    let total_before = TOTAL.load(Ordering::Relaxed);
    let start = Instant::now();
    let mut latencies = Vec::with_capacity(frames);
    let mut handled = 0;
    let mut failures = Vec::new();
    'frames: for f in 0..frames {
        let t = Instant::now();
        for (k, run) in runs[..active].iter_mut().enumerate() {
            if !run.event(event(f * active + k)) {
                failures.push(json!({ "run": k, "frame": f, "failure": run.failure() }));
                break 'frames;
            }
        }
        latencies.push(t.elapsed().as_nanos() as u64);
        handled += 1;
    }
    let wall = start.elapsed();
    let allocated = TOTAL.load(Ordering::Relaxed) - total_before;
    let all: Vec<_> = runs.iter().map(|r| r.stats()).collect();
    let idle_steps: u64 = all[active..]
        .iter()
        .zip(&idle_before)
        .map(|(s, b)| s.steps - b)
        .sum();
    let mut pauses: Vec<u64> = all
        .iter()
        .flat_map(|s| s.pauses_ns.iter().map(|p| *p as u64))
        .collect();
    json!({
        "scenario": format!("many {heaps} heaps, {active} active"),
        "frames": handled,
        "failures": failures,
        "wall_ms": wall.as_secs_f64() * 1e3,
        "frame_us": percentiles(&mut latencies, 1e3),
        "alloc_mb_per_s": allocated as f64 / wall.as_secs_f64() / (1 << 20) as f64,
        "live_kib_after_setup": live_setup / 1024,
        "live_kib_end": LIVE.load(Ordering::Relaxed) / 1024,
        "peak_kib": PEAK.load(Ordering::Relaxed) / 1024,
        "footprint": footprint(),
        "objects": all.iter().map(|s| s.objects).sum::<u64>(),
        "peak_objects": all.iter().map(|s| s.peak_objects).sum::<u64>(),
        "strings": all.iter().map(|s| s.strings).sum::<u64>(),
        "gc_steps": all.iter().map(|s| s.steps).sum::<u64>(),
        "gc_ms": all.iter().map(|s| s.gc_ns).sum::<u64>() as f64 / 1e6,
        "gc_steps_while_idle": idle_steps,
        "pause_us": percentiles(&mut pauses, 1e3),
    })
}

fn event(i: usize) -> HostValue {
    HostValue::Object(vec![
        ("i".into(), HostValue::from(i as f64)),
        ("query".into(), HostValue::from(QUERIES[i % QUERIES.len()])),
    ])
}

fn heap_json(s: &psychoscript::HeapStats) -> Json {
    let mut pauses: Vec<u64> = s.pauses_ns.iter().map(|p| *p as u64).collect();
    json!({
        "objects": s.objects, "peak_objects": s.peak_objects,
        "cells": s.cells, "peak_cells": s.peak_cells,
        "strings": s.strings, "peak_strings": s.peak_strings,
        "gc_steps": s.steps, "gc_ms": s.gc_ns as f64 / 1e6,
        "pause_us": percentiles(&mut pauses, 1e3),
    })
}

fn percentiles(samples: &mut [u64], unit: f64) -> Json {
    if samples.is_empty() {
        return Json::Null;
    }
    samples.sort_unstable();
    let at = |q: f64| samples[((samples.len() - 1) as f64 * q).round() as usize] as f64 / unit;
    json!({ "p50": at(0.5), "p99": at(0.99), "max": at(1.0), "n": samples.len() })
}

fn footprint() -> Json {
    counters::usage().map_or(
        Json::Null,
        |u| json!({ "kib": u.footprint / 1024, "peak_kib": u.peak_footprint / 1024 }),
    )
}

/// A long-lived run and its event queue.
struct LiveRun {
    feed: Arc<Feed>,
    run: Arc<Mutex<Option<Run>>>,
    future: Pin<Box<dyn Future<Output = Result<Outcome, Interrupted>> + 'static>>,
    woken: Arc<Woken>,
    done: Option<Result<Outcome, Interrupted>>,
}

#[derive(Default)]
struct Feed {
    inner: Mutex<FeedInner>,
}

#[derive(Default)]
struct FeedInner {
    events: VecDeque<HostValue>,
    /// The run is waiting in `nextEvent`.
    waiting: Option<Waker>,
}

impl Feed {
    fn lock(&self) -> std::sync::MutexGuard<'_, FeedInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

struct Next(Arc<Feed>);

impl Future for Next {
    type Output = Result<HostValue, HostValue>;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        let mut inner = self.0.lock();
        match inner.events.pop_front() {
            Some(e) => {
                inner.waiting = None;
                Poll::Ready(Ok(e))
            }
            None => {
                inner.waiting = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// Wakes the driving thread.
struct Woken {
    flag: AtomicBool,
    thread: std::thread::Thread,
}

impl Wake for Woken {
    fn wake(self: Arc<Self>) {
        self.flag.store(true, Ordering::Release);
        self.thread.unpark();
    }
}

impl LiveRun {
    /// A runtime whose `nextEvent` serves `feed`, and which hands each run's handle to `slot`.
    fn runtime(feed: &Arc<Feed>, slot: &Arc<Mutex<Option<Run>>>) -> Runtime {
        let (feed, slot) = (feed.clone(), slot.clone());
        Runtime::make()
            .limits(Limits {
                timeout_ms: None,
                max_output_bytes: None,
            })
            .globals(move |run| {
                *slot.lock().unwrap() = Some(run.clone());
                let feed = feed.clone();
                [
                    (
                        "nextEvent",
                        HostFunction::new_async(move |_, _| Next(feed.clone())),
                    ),
                    ("render", HostFunction::new(|_, _| HostValue::Undefined)),
                ]
            })
    }

    /// Starts `bench/gc/PROGRAM.js` and runs it until it waits for its first event.
    /// The runtime, source and options live as long as the process, which ends after one scenario.
    fn start(program: &str) -> Self {
        let path = format!("{}/gc/{program}.js", env!("CARGO_MANIFEST_DIR"));
        let code = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
        let feed = Arc::new(Feed::default());
        let run = Arc::new(Mutex::new(None));
        let runtime: &'static Runtime = Box::leak(Box::new(Self::runtime(&feed, &run)));
        let code: &'static str = Box::leak(code.into_boxed_str());
        let options: &'static ProgramOptions = Box::leak(Box::new(ProgramOptions::new()));
        let mut live = LiveRun {
            feed,
            run,
            future: Box::pin(runtime.program(code, options).run_async()),
            woken: Arc::new(Woken {
                flag: AtomicBool::new(false),
                thread: std::thread::current(),
            }),
            done: None,
        };
        live.pump();
        assert!(
            live.done.is_none(),
            "{program} ended during setup: {:?}",
            live.failure()
        );
        live
    }

    /// Delivers one event and runs until the program waits for the next; false once the run has ended.
    fn event(&mut self, e: HostValue) -> bool {
        let waker = {
            let mut inner = self.feed.lock();
            inner.events.push_back(e);
            inner.waiting.take()
        };
        if let Some(w) = waker {
            w.wake();
        }
        self.pump();
        self.done.is_none()
    }

    fn pump(&mut self) {
        let waker = Waker::from(self.woken.clone());
        let mut cx = Context::from_waker(&waker);
        loop {
            self.woken.flag.store(false, Ordering::Release);
            if let Poll::Ready(o) = self.future.as_mut().poll(&mut cx) {
                self.done = Some(o);
                return;
            }
            let idle = {
                let inner = self.feed.lock();
                inner.waiting.is_some() && inner.events.is_empty()
            };
            if idle {
                return;
            }
            // Away on its worker for a long stretch: wait for it to come back.
            while !self.woken.flag.load(Ordering::Acquire) {
                std::thread::park_timeout(Duration::from_millis(1));
            }
        }
    }

    fn stats(&self) -> psychoscript::HeapStats {
        self.run
            .lock()
            .unwrap()
            .as_ref()
            .map(|r| r.heap_stats())
            .unwrap_or_default()
    }

    fn failure(&self) -> Json {
        match &self.done {
            None => Json::Null,
            Some(Err(_)) => json!("interrupted"),
            Some(Ok(o)) => match &o.result {
                Ok(v) => json!({ "returned": v.to_json() }),
                Err(d) => json!(d.message_lossy()),
            },
        }
    }

    /// Ends the program with a `null` event; its failure, if it had one.
    fn finish(mut self) -> Json {
        if self.done.is_none() {
            self.event(HostValue::Null);
        }
        match &self.done {
            Some(Ok(o)) if o.result.is_ok() => Json::Null,
            _ => self.failure(),
        }
    }
}

/// Counts the bytes the process holds and has allocated, for live and peak heap and the allocation rate.
struct Counting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
static TOTAL: AtomicUsize = AtomicUsize::new(0);

fn grew(n: usize) {
    let now = LIVE.fetch_add(n, Ordering::Relaxed) + n;
    PEAK.fetch_max(now, Ordering::Relaxed);
    TOTAL.fetch_add(n, Ordering::Relaxed);
}

// SAFETY: every call forwards to the system allocator unchanged; the counters only observe sizes.
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        grew(layout.size());
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        grew(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;
