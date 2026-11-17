//! Interpreter benchmarks, mirroring the reference `script/bench.ts`: median and fastest wall-clock milliseconds per
//! program. Each iteration calls `execute` on the source, with one warm-up run that also checks the program succeeds.
//! Usage: psychoscript-bench [--iterations N] [--filter name] [--json] [--cases DIR]
//! `--iterations 0` runs only the warm-up, for one-shot measurements such as peak RSS.
//!
//! `psychoscript-bench --plugin [--runs N] SOURCE...` is the plugin-event benchmark instead: the conformance
//! reducer handling a `git.status` command, N warm-up runs then N timed runs, as JSON lines of µs per execute.

use std::path::PathBuf;
use std::time::Instant;

use psychoscript::{Json, Runtime};
use serde_json::json;

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

/// Registers the bench tools: this is the switch for schema fairness. The reference decodes `echo`'s input and output
/// through Effect Schema (`{ id: number }` in, `number` out) and `git.status`'s likewise (`{}` in,
/// `{ branch: string, dirty: boolean }` out); these Rust tools do not validate yet. Once `Runtime` takes tool schemas,
/// register both with the equivalent validating schemas here, so each side pays for validation.
fn tools(runtime: Runtime) -> Runtime {
    runtime
        .tool("echo", |input| {
            Ok(input.get("id").cloned().unwrap_or(Json::Null))
        })
        .tool("git.status", |_| {
            Ok(json!({ "branch": "main", "dirty": true }))
        })
}

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--plugin") {
        return plugin(std::env::args().skip(2));
    }
    let mut iterations = 11usize;
    let mut filter = String::new();
    let mut json = false;
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
            "--cases" => dir = args.next().expect("--cases DIR").into(),
            other => panic!("unknown argument {other}"),
        }
    }

    let runtime = tools(Runtime::new());
    let bindings = serde_json::Map::new();
    let mut report = Vec::new();
    for (slug, name) in CASES {
        if !(slug.contains(&filter) || name.contains(&filter)) {
            continue;
        }
        let path = dir.join(format!("bench-{slug}.js"));
        let code =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let value = match runtime.execute(&code, &bindings).result {
            Ok(value) => value,
            Err(d) => panic!("{name} failed: {d:?}"),
        };
        let times: Vec<f64> = (0..iterations)
            .map(|_| {
                let start = Instant::now();
                let _ = runtime.execute(&code, &bindings);
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
            report.push(json!({ "slug": slug, "name": name, "value": value, "median_ms": median, "min_ms": min, "times_ms": times }));
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
    let runtime = tools(Runtime::new());
    let bindings =
        json!({ "event": { "type": "command", "name": "git.status" }, "state": { "runs": 2 } });
    let bindings = bindings.as_object().cloned().unwrap_or_default();
    let expected =
        json!({ "state": { "runs": 3 }, "slots": { "statusbar": { "text": "main *" } } });
    for source in sources {
        let code = std::fs::read_to_string(&source).unwrap_or_else(|e| panic!("{source}: {e}"));
        match runtime.execute(&code, &bindings).result {
            Ok(value) if value == expected => {}
            other => panic!("{source}: unexpected outcome {other:?}"),
        }
        for _ in 1..runs {
            let _ = runtime.execute(&code, &bindings);
        }
        let times: Vec<f64> = (0..runs)
            .map(|_| {
                let start = Instant::now();
                let _ = runtime.execute(&code, &bindings);
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
