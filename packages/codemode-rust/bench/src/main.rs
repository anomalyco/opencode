//! Interpreter benchmarks, mirroring the reference `script/bench.ts`: median and fastest wall-clock milliseconds per
//! program. Each iteration calls `execute` on the source, with one warm-up run that also checks the program succeeds.
//! Usage: psychoscript-bench [--iterations N] [--filter name] [--json] [--cases DIR] [--async]
//! `--iterations 0` runs only the warm-up, for one-shot measurements such as peak RSS.
//!
//! `psychoscript-bench --plugin [--runs N] SOURCE...` is the plugin-event benchmark instead: the conformance
//! reducer handling a `git.status` command, N warm-up runs then N timed runs, as JSON lines of µs per execute.

use std::path::PathBuf;
use std::time::Instant;

use psychoscript::{HostValue, Json, ProgramOptions, Runtime};
use serde_json::json;

#[path = "../../conformance/reference.rs"]
mod reference;

/// Case files and reference names, in the reference order.
const CASES: [(&str, &str); 9] = [
    ("numeric-loop", "numeric loop"),
    ("closure-recursion", "closure recursion (fib 22)"),
    ("array-callbacks", "array callbacks (50k)"),
    ("promise-fan-out", "promise fan-out (5k)"),
    ("tool-fan-out", "tool fan-out (1k)"),
    ("json-round-trip", "JSON round-trip"),
    ("generator-iteration", "generator iteration"),
    ("string-building", "string building"),
    ("map-set-ops", "Map/Set ops"),
];

/// The bench runtime, as the reference drivers make it: one host global, the `tools` namespace of
/// `conformance/reference.rs` (`tools.echo`, `tools.git.status`, ... all async).
fn runtime() -> Runtime {
    Runtime::make().globals(|_| [("tools", HostValue::from(reference::tools()))])
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--plugin") {
        return plugin(std::env::args().skip(2));
    }
    let mut iterations = 11usize;
    let mut filter = String::new();
    let mut json = false;
    let mut future = false;
    let mut dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../conformance/cases");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--iterations" => {
                iterations = args
                    .next()
                    .and_then(|n| n.parse().ok())
                    .expect("--iterations N")
            }
            "--filter" => filter = args.next().expect("--filter name"),
            "--json" => json = true,
            "--async" => future = true,
            "--cases" => dir = args.next().expect("--cases DIR").into(),
            other => panic!("unknown argument {other}"),
        }
    }

    let runtime = runtime();
    let options = psychoscript::ProgramOptions::new();
    // `--async` drives each run as a future, where a long one computes on a worker thread.
    let execute = |code: &str| {
        if future {
            return block_on(runtime.execute_async(code, &options)).expect("not interrupted");
        }
        runtime.execute(code)
    };
    let mut report = Vec::new();
    for (slug, name) in CASES {
        if !(slug.contains(&filter) || name.contains(&filter)) {
            continue;
        }
        let path = dir.join(format!("bench-{slug}.js"));
        let code =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let value = match execute(&code).result {
            Ok(value) => value,
            Err(d) => panic!("{name} failed: {d:?}"),
        };
        let times: Vec<f64> = (0..iterations)
            .map(|_| {
                let start = Instant::now();
                let _ = execute(&code);
                start.elapsed().as_secs_f64() * 1e3
            })
            .collect();
        if times.is_empty() {
            continue;
        }
        let mut sorted = times.clone();
        sorted.sort_by(f64::total_cmp);
        let (median, min) = (sorted[sorted.len() / 2], sorted[0]);
        if json {
            report.push(json!({ "slug": slug, "name": name, "value": value.to_json(), "median_ms": median, "min_ms": min, "times_ms": times }));
        } else {
            println!("{name:<28} {median:>8.1} ms  (min {min:.1} ms)");
        }
    }
    if json {
        println!("{}", Json::from(report));
    }
}

fn plugin(mut args: impl Iterator<Item = String>) {
    let mut runs = 2000usize;
    let mut sources = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--runs" => runs = args.next().and_then(|n| n.parse().ok()).expect("--runs N"),
            _ => sources.push(arg),
        }
    }
    let runtime = runtime();
    let bindings =
        json!({ "event": { "type": "command", "name": "git.status" }, "state": { "runs": 2 } });
    let options = ProgramOptions::new().bindings(bindings.as_object().cloned().unwrap_or_default());
    let expected =
        json!({ "state": { "runs": 3 }, "slots": { "statusbar": { "text": "main *" } } });
    for source in sources {
        let code = std::fs::read_to_string(&source).unwrap_or_else(|e| panic!("{source}: {e}"));
        match runtime.execute_with(&code, &options).result {
            Ok(value) if value == expected => {}
            other => panic!("{source}: unexpected outcome {other:?}"),
        }
        for _ in 1..runs {
            let _ = runtime.execute_with(&code, &options);
        }
        let times: Vec<f64> = (0..runs)
            .map(|_| {
                let start = Instant::now();
                let _ = runtime.execute_with(&code, &options);
                start.elapsed().as_secs_f64() * 1e6
            })
            .collect();
        let mut sorted = times.clone();
        sorted.sort_by(f64::total_cmp);
        let mean = times.iter().sum::<f64>() / runs.max(1) as f64;
        println!(
            "{}",
            json!({ "source": source, "bytes": code.len(), "median_us": sorted[runs / 2], "min_us": sorted[0], "mean_us": mean })
        );
    }
}

/// Polls a future to its end on this thread, parking until it is woken.
fn block_on<F: std::future::Future>(future: F) -> F::Output {
    struct Unpark(std::thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: std::sync::Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = std::task::Waker::from(std::sync::Arc::new(Unpark(std::thread::current())));
    let mut cx = std::task::Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let std::task::Poll::Ready(v) = future.as_mut().poll(&mut cx) {
            return v;
        }
        std::thread::park();
    }
}
