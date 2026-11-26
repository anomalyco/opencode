//! Runs an OpenCode agent widget program the way an app does, and times it:
//!
//! ```sh
//! cargo run --release -p widget-mobile --example widget -- <program.js> '<data JSON>' ['<event JSON>']
//! ```
//!
//! `program.js` is a template program as the server serves it (`prelude + "\n" + source`). The
//! widget step ABI is one call: compile `program + "\nreturn __widget_step(__input())"` once, then
//! run it with each step input (`{ phase: "init", data }`, `{ phase: "event", ... }`,
//! `{ phase: "draw", ... }`) under the step's budget (250 ms; 8 ms for a draw).

use std::error::Error;
use std::time::{Duration, Instant};

use psychoscript_mobile::{Program, PsychoScriptError, RunOptions};
use serde_json::{Value, json};

const STEP: RunOptions = RunOptions {
    timeout_ms: Some(250),
    max_output_bytes: None,
    max_heap_bytes: None,
    program_lines: None,
};
const DRAW: RunOptions = RunOptions {
    timeout_ms: Some(8),
    max_output_bytes: None,
    max_heap_bytes: None,
    program_lines: None,
};

fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    let usage = "usage: widget <program.js> '<data JSON>' ['<event JSON>']";
    let served = std::fs::read_to_string(args.next().ok_or(usage)?)?;
    let data: Value = serde_json::from_str(&args.next().ok_or(usage)?)?;
    let event: Value = match args.next() {
        Some(e) => serde_json::from_str(&e)?,
        None => json!({ "id": "go", "type": "press" }),
    };

    // The whole widget glue: the step ABI's entry point after the served program.
    let start = Instant::now();
    let program = Program::new(
        format!("{served}\nreturn __widget_step(__input())"),
        "__input".into(),
    )?;
    println!(
        "compile: {:?} ({} KB)",
        start.elapsed(),
        served.len() / 1024
    );

    let start = Instant::now();
    let out = program.run(json!({ "phase": "init", "data": data }).to_string(), STEP)?;
    println!("init: {:?}, {} bytes out", start.elapsed(), out.len());
    let out: Value = serde_json::from_str(&out)?;
    let state = &out["state"];

    let input =
        json!({ "phase": "event", "data": data, "state": state, "event": event }).to_string();
    report("event step", 2_000, || {
        program.run(input.clone(), STEP).map(drop)
    })?;

    let mut nodes = Vec::new();
    walk(&out["view"], &mut nodes);
    if let Some(canvas) = nodes.iter().find(|n| n["type"] == "canvas") {
        let frame = |t: f64| {
            json!({ "phase": "draw", "data": data, "state": state, "frame": {
                "id": canvas["id"], "t": t, "dt": 1.0 / 60.0, "width": 360, "height": canvas["height"],
                "scale": 3, "pointer": null, "dark": true } })
            .to_string()
        };
        let drawn: Value = serde_json::from_str(&program.run(frame(0.3), DRAW)?)?;
        println!(
            "draw: {} commands",
            drawn["commands"].as_array().map_or(0, Vec::len)
        );
        let (mut t, mut overruns) = (0.0, 0);
        report("draw step", 3_000, || {
            t += 1.0 / 60.0;
            match program.run(frame(t), DRAW) {
                Err(PsychoScriptError::Timeout { .. }) => {
                    overruns += 1;
                    Ok(())
                }
                out => out.map(drop),
            }
        })?;
        println!("draw steps over 8 ms: {overruns}");
    }
    Ok(())
}

fn walk<'a>(node: &'a Value, out: &mut Vec<&'a Value>) {
    out.push(node);
    for child in node["children"].as_array().into_iter().flatten() {
        walk(child, out);
    }
}

fn report<E: Error + 'static>(
    what: &str,
    runs: usize,
    mut f: impl FnMut() -> Result<(), E>,
) -> Result<(), Box<dyn Error>> {
    let mut times = Vec::with_capacity(runs);
    for _ in 0..runs {
        let start = Instant::now();
        f()?;
        times.push(start.elapsed());
    }
    times.sort();
    let mean = times.iter().sum::<Duration>() / runs as u32;
    println!(
        "{what}: mean {mean:?}, p50 {:?}, p99 {:?} ({runs} runs)",
        times[runs / 2],
        times[runs * 99 / 100]
    );
    Ok(())
}
