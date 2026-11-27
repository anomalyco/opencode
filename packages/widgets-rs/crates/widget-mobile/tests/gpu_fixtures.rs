//! The GPU conformance fixtures (`packages/widget/test/fixtures/gpu`, read in place) as live runs: each program with the preludes, its posts through the real `__host.post` and the widget
//! encoder, its batches replayed on this machine's device. Each must post the fixture's `batches` (ops, and bytes
//! from psychoscript's `Math`), give its GPU program errors (message and canvases) and end as it says. The driver is the spec's (`widgets-gpu.md`, Conformance); a device loss among
//! the inputs is the host's own (`gpu_lose_device`), so this runs in a process of its own. `GPU_FIXTURES` names
//! another directory of them (on a device the tests are copied to).

#![cfg(feature = "gpu")]

mod gpu_support;

use std::time::{Duration, Instant};

use gpu_support::*;
use psychoscript_mobile::{
    GpuCanvasState, LiveExit, gpu_input_format, gpu_lose_device, gpu_lose_device_at_frame_end,
    gpu_wait_idle,
};
use serde_json::{Value, json};
use widget_mobile::gpu_record_batches;
use widget_wire::Post;

fn fixtures() -> Vec<Value> {
    let dir = std::env::var("GPU_FIXTURES").unwrap_or_else(|_| {
        concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../widget/test/fixtures/gpu"
        )
        .into()
    });
    let mut list: Vec<Value> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{dir}: {e}"))
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .map(|p| serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap())
        .collect();
    list.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    list
}

/// What the host gives the program for an input: a canvas size clamped, a device loss of its own (the host has
/// told the program of it, then the app, before the driver goes on: the spec's driver loses the device first).
fn input(r: &mut Run, i: &Value) {
    match i["type"].as_str() {
        Some("canvas") => {
            let size = |k: &str| i[k].as_u64().unwrap() as u32;
            let (w, h) = psychoscript_gpu::clamp_size(size("width"), size("height"));
            let m = json!({ "type": "canvas", "key": i["key"], "width": w, "height": h });
            r.run.deliver(m.to_string()).unwrap();
        }
        // `inFlight`: lost at the last frame's end, its work in flight (`drive` asked for it then); else with the work
        // all seen finished first, unless `finished` is false. A strike is a loss with work in flight and work seen
        // finished since the last (`finished`, default true). The program has the loss when the app is told (a canvas
        // `lost`, or every canvas stopped by a second strike).
        Some("gpu") if i.get("lost").is_some() => {
            if i["inFlight"] != true {
                if i["finished"] != false {
                    gpu_wait_idle();
                }
                gpu_lose_device();
            }
            // This loss's event, not an earlier one's: each loss tells one (the fixtures with losses have one
            // canvas). An `inFlight` one may have come before this input, or come late: lost at the end of a frame
            // replayed on a device still being made (a slow one, a phone's).
            let n = LOSSES.get() + 1;
            LOSSES.set(n);
            let told = |seen: &[Event]| {
                (seen.iter())
                    .filter(|e| {
                        matches!(
                            e,
                            Event::Gpu(
                                _,
                                GpuCanvasState::Lost { .. } | GpuCanvasState::Stopped { .. }
                            )
                        )
                    })
                    .count()
            };
            while told(&r.seen) < n {
                match r.rx.recv_timeout(Duration::from_secs(30)) {
                    Ok(e) => r.seen.push(e),
                    Err(_) => panic!("loss {n} was never told, after {:?}", r.seen),
                }
            }
        }
        _ => r.run.deliver(i.to_string()).unwrap(),
    }
}

/// A fixture's numbers as one kind (JSON's integers and floats are the same number), for comparing.
fn canon(v: &Value) -> Value {
    match v {
        Value::Number(n) => json!(n.as_f64().unwrap()),
        Value::Array(a) => Value::Array(a.iter().map(canon).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), canon(v))).collect()),
        v => v.clone(),
    }
}

/// The first batch that differs from the fixture's, readably.
fn batches_differ(posted: &[Value], expected: &[Value]) -> Option<String> {
    let n = posted.len().max(expected.len());
    (0..n).find_map(|i| {
        let (p, e) = (posted.get(i).map(canon), expected.get(i).map(canon));
        (p != e).then(|| {
            let short = |v: Option<Value>| {
                v.map_or("none".into(), |v| {
                    v.to_string().chars().take(400).collect::<String>()
                })
            };
            format!(
                "batch {i} of {n}:\n    posted   {}\n    expected {}",
                short(p),
                short(e)
            )
        })
    })
}

/// The GPU errors a run told, as the fixtures write them: each once, for every canvas (`None`), or for each canvas it
/// stops, the first one to report.
fn errors_of(seen: &[Event]) -> Vec<Value> {
    let mut errors: Vec<Value> = Vec::new();
    for e in seen {
        let Event::Gpu(
            key,
            GpuCanvasState::Stopped {
                message, report, ..
            },
        ) = e
        else {
            continue;
        };
        match key {
            None => errors.push(json!({ "message": message, "canvases": "all" })),
            Some(k) if *report || errors.is_empty() => {
                errors.push(json!({ "message": message, "canvases": [k] }))
            }
            Some(k) => errors.last_mut().unwrap()["canvases"]
                .as_array_mut()
                .unwrap()
                .push(json!(k)),
        }
    }
    errors
}

thread_local! {
    /// The device losses `drive` gave the run in progress.
    static LOSSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

fn drive(f: &Value) -> (Vec<Value>, String, String, Vec<Value>) {
    gpu_input_format(f["gpu"]["format"].as_str().unwrap());
    LOSSES.set(0);
    let losses =
        (f["inputs"].as_array().into_iter().flatten()).any(|i| i["input"]["lost"].is_string());
    assert!(
        !losses || f["canvases"].as_array().unwrap().len() == 1,
        "{}: a loss tells each canvas; the driver counts one a loss",
        f["name"]
    );
    let mut r = start(
        &live_program(f["source"].as_str().unwrap()),
        f["data"].clone(),
    );
    for c in f["canvases"].as_array().unwrap() {
        input(
            &mut r,
            &json!({ "type": "canvas", "key": c["key"], "width": c["width"], "height": c["height"] }),
        );
    }
    let inputs = f["inputs"].as_array().cloned().unwrap_or_default();
    let now = |frame: usize, after: bool| {
        inputs
            .iter()
            .filter(move |i| i["frame"] == frame && (i["after"] == true) == after)
            .map(|i| i["input"].clone())
            .collect::<Vec<_>>()
    };
    // What the run will do, from the fixture: its frame requests (`frame: true` entries, answered up to 10), its
    // batches and errors. A run that stays open (`stop`) is stopped once it has done all of it. Every wait is on
    // events, capped generously: nothing here counts on the machine's speed.
    let batches = batches_of(f);
    let requests = batches.map_or(10, |b| {
        b.iter().filter(|b| b["frame"] == true).count().min(10)
    });
    let stays_open = f["end"] == "stop";
    let cap = Instant::now() + Duration::from_secs(120);
    let mut end = None;
    let mut frame = 0;
    while end.is_none() {
        if stays_open && frame >= requests {
            let (posted, errors) = (
                batches.map_or(0, Vec::len),
                f["errors"].as_array().unwrap().len(),
            );
            while r.run.gpu_posted().len() < posted || errors_of(&r.seen).len() < errors {
                if Instant::now() > cap {
                    break;
                }
                if let Ok(e) = r.rx.recv_timeout(Duration::from_millis(10)) {
                    r.seen.push(e);
                }
            }
            r.run.stop();
            end = Some("stop".to_owned());
            break;
        }
        // A frame request or the run's end.
        let next = loop {
            if let Some(i) = r.seen.iter().position(|e| {
                matches!(e, Event::Posts(p) if p.contains(&Post::Frame))
                    || matches!(e, Event::Exit(_))
            }) {
                break Some(r.seen.remove(i));
            }
            let left = cap.saturating_duration_since(Instant::now());
            match r.rx.recv_timeout(left) {
                Ok(e) => r.seen.push(e),
                Err(_) => break None,
            }
        };
        match next {
            Some(Event::Exit(LiveExit::Finished { .. })) => end = Some("return".to_owned()),
            Some(Event::Exit(LiveExit::Failed { error })) => {
                end = Some(format!("error: {error:?}"))
            }
            Some(Event::Exit(LiveExit::Stopped)) => end = Some("stopped".to_owned()),
            Some(_) if frame < 10 => {
                for i in now(frame, false) {
                    input(&mut r, &i);
                }
                // The next frame's `inFlight` loss comes at this frame's end.
                let next = now(frame + 1, false);
                if let Some(i) = next
                    .iter()
                    .find(|i| i["lost"].is_string() && i["inFlight"] == true)
                {
                    gpu_lose_device_at_frame_end(i["finished"] != false);
                }
                r.run.deliver(gpu_support::frame(frame)).unwrap();
                for i in now(frame, true) {
                    input(&mut r, &i);
                }
                frame += 1;
            }
            Some(_) => {
                r.run.stop();
                end = Some("stop".to_owned());
            }
            None => {
                r.run.stop();
                end = Some("timed out".to_owned());
            }
        }
    }
    let errors = errors_of(&r.seen);
    let events = format!("{:?}", r.seen);
    let posted = (r.run.gpu_posted().iter())
        .map(|b| serde_json::from_str(b).unwrap())
        .collect();
    (errors, end.unwrap(), events, posted)
}

/// A fixture's `batches`: the recorded ones; none to compare without (a `raw-` one's), or when it says
/// `"from-source"` (its batches are what its source posts: the errors and the end are still checked, and it must post
/// some).
fn batches_of(f: &Value) -> Option<&Vec<Value>> {
    match &f["batches"] {
        Value::Array(b) => Some(b),
        Value::Null => None,
        Value::String(s) if s == "from-source" => None,
        other => panic!("{}: `batches` is {other}", f["name"]),
    }
}

#[test]
fn every_gpu_fixture_as_a_live_run() {
    gpu_record_batches();
    let mut failures = Vec::new();
    let mut ran = 0;
    for f in fixtures() {
        let name = f["name"].as_str().unwrap();
        let started = std::time::Instant::now();
        let (errors, end, events, posted) = drive(&f);
        let took = started.elapsed();
        // The batches as posted: the same ops and, from psychoscript's `Math`, the same bytes.
        let expected = batches_of(&f);
        if let Some(d) = expected.and_then(|e| batches_differ(&posted, e)) {
            failures.push(format!("{name}: {d}"));
        }
        if f["batches"] == "from-source" && posted.is_empty() {
            failures.push(format!("{name}: its source posted no batch"));
        }
        ran += 1;
        if errors.as_slice() != f["errors"].as_array().unwrap().as_slice() || end != f["end"] {
            failures.push(format!(
                "{name} ({took:?}):\n  got      {errors:?}, {end}\n  expected {:?}, {}\n  events {}",
                f["errors"],
                f["end"],
                events.chars().take(600).collect::<String>()
            ));
        } else {
            let batches = match expected {
                Some(e) => format!("{} batches the same", e.len()),
                None if f["batches"] == "from-source" => {
                    format!("{} batches posted from its source", posted.len())
                }
                None => "0 batches the same".to_owned(),
            };
            eprintln!("{name}: ok ({} errors, {end}, {batches})", errors.len());
        }
    }
    assert_eq!(ran, 53);
    assert!(failures.is_empty(), "\n{}", failures.join("\n"));
}
