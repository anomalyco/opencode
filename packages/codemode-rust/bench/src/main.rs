//! Interpreter benchmarks, mirroring the reference `script/bench.ts`: median and fastest wall-clock milliseconds per
//! program. Each iteration calls `execute` on the source, with one warm-up run that also checks the program succeeds.
//! Usage: psychoscript-bench [--iterations N] [--filter name] [--json] [--cases DIR]
//! `--iterations 0` runs only the warm-up, for one-shot measurements such as peak RSS.

use std::path::PathBuf;
use std::time::Instant;

use psychoscript::{Json, Runtime};

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

fn main() {
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

    let runtime = Runtime::new().tool("echo", |input| {
        Ok(input.get("id").cloned().unwrap_or(Json::Null))
    });
    let bindings = serde_json::Map::new();
    let mut report = Vec::new();
    for (slug, name) in CASES {
        if !(slug.contains(&filter) || name.contains(&filter)) {
            continue;
        }
        let path = dir.join(format!("bench-{slug}.js"));
        let code =
            std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        if let Err(d) = runtime.execute(&code, &bindings).result {
            panic!("{name} failed: {d:?}");
        }
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
            report.push(serde_json::json!({ "slug": slug, "name": name, "median_ms": median, "min_ms": min, "times_ms": times }));
        } else {
            println!("{name:<28} {median:>8.1} ms  (min {min:.1} ms)");
        }
    }
    if json {
        println!("{}", Json::from(report));
    }
}
