//! Host functions against the reference's behaviour recorded in `conformance/host.json` by `bun conformance/host.ts`:
//! call keys, sync, async and sync-thenable functions, constructible ones, functions that take functions, idempotent
//! and durable calls across a suspend, failures, namespaces, run metadata, translation and limits. The globals are the
//! generator's.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Wake, Waker};
use std::time::Duration;

use psychoscript::{
    Diagnostic, DurableFunction, Failure, HostFunction, HostValue, Json, Limits, Namespace,
    Outcome, ProgramOptions, Resolved, Returned, RunOutcome, Runtime, Translate,
    TranslateFunctions, TranslatePromises, to_bytes,
};
use serde_json::json;

#[path = "../../../conformance/reference.rs"]
mod reference;

use reference::describe;

type Log = Arc<Mutex<Vec<Json>>>;

/// What an entry's globals share: the log, whether the entry resumed, how often the globals were made, and whether a
/// call reached a point that never settles before the resume.
#[derive(Clone, Default)]
struct State {
    log: Log,
    resumed: Arc<AtomicBool>,
    made: Arc<AtomicUsize>,
    started: Arc<AtomicBool>,
    wakers: Arc<Mutex<Vec<Waker>>>,
}

impl State {
    fn push(&self, entry: Json) {
        self.log.lock().unwrap().push(entry);
    }

    /// Settles with `value` once the entry resumed; until then it never settles, and says a call reached it.
    fn pending(&self, value: f64) -> Pending {
        if !self.resumed.load(Ordering::SeqCst) {
            self.started.store(true, Ordering::SeqCst);
        }
        Pending {
            state: self.clone(),
            value,
        }
    }
}

struct Pending {
    state: State,
    value: f64,
}

impl Future for Pending {
    type Output = psychoscript::HostResult;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Self::Output> {
        if self.state.resumed.load(Ordering::SeqCst) {
            return Poll::Ready(Ok(HostValue::Number(self.value)));
        }
        self.state.wakers.lock().unwrap().push(cx.waker().clone());
        Poll::Pending
    }
}

fn described(args: &[HostValue]) -> Json {
    Json::Array(args.iter().map(describe).collect())
}

fn num(v: Option<&HostValue>) -> f64 {
    v.and_then(HostValue::as_f64).unwrap_or(f64::NAN)
}

/// The generator's globals for a run.
fn globals(state: &State, run: &psychoscript::Run) -> Vec<(String, HostValue)> {
    state.made.fetch_add(1, Ordering::SeqCst);
    let s = state.clone();
    let one = |f: HostFunction| HostValue::from(f.length(1));
    let read = || {
        HostFunction::new(|_, _| HostValue::from("called"))
            .named("read")
            .takes_functions()
    };
    let (note, post, never, grab, wait) = (s.clone(), s.clone(), s.clone(), s.clone(), s.clone());
    let (start, waited, cancel) = (s.clone(), s.clone(), s.clone());
    let counting = run.clone();
    vec![
        (
            "double".into(),
            one(HostFunction::new(|args, _| {
                HostValue::Number(num(args.first()) * 2.0)
            })),
        ),
        (
            "inc".into(),
            one(HostFunction::new(|args, _| {
                HostValue::Number(num(args.first()) + 1.0)
            })),
        ),
        (
            "promised".into(),
            one(HostFunction::new(|args, _| {
                let n = args.first().cloned().unwrap_or_default();
                Returned::Pending(Box::pin(async move { Ok(n) }))
            })),
        ),
        (
            "load".into(),
            one(HostFunction::new_async(|args, _| async move {
                Ok(args.into_iter().next().unwrap_or_default())
            })),
        ),
        (
            "find".into(),
            one(HostFunction::new(|_, _| {
                HostValue::object([("items", HostValue::array([1.0.into(), 2.0.into()]))])
            })
            .thenable()),
        ),
        (
            "note".into(),
            HostFunction::new(move |args, call| {
                note.push(json!(["note", call.key(), described(&args)]));
                HostValue::Undefined
            })
            .length(2)
            .into(),
        ),
        (
            "post".into(),
            HostFunction::new_async(move |args, call| {
                let post = post.clone();
                async move {
                    post.push(json!(["post", call.key(), described(&args)]));
                    Ok(HostValue::Undefined)
                }
            })
            .length(2)
            .into(),
        ),
        (
            "never".into(),
            HostFunction::new_async(move |_, call| {
                never.push(json!(["never", call.key()]));
                let pending = never.pending(f64::NAN);
                async move {
                    let _ = pending.await;
                    std::future::pending().await
                }
            })
            .length(2)
            .into(),
        ),
        (
            "open".into(),
            one(HostFunction::new(move |_, _| {
                HostValue::object([("read", read().into())])
            })),
        ),
        (
            "takes".into(),
            one(HostFunction::new(|args, _| {
                let read = args.first().and_then(|a| a.get("read"));
                HostValue::Bool(matches!(read, Some(HostValue::Function(f)) if f.name() == "read"))
            })
            .takes_functions()),
        ),
        (
            "refuses".into(),
            one(HostFunction::new(|_, _| HostValue::Bool(true))),
        ),
        (
            "grab".into(),
            HostFunction::new_async(move |_, call| {
                grab.push(json!(["grab", call.key()]));
                grab.pending(3.0)
            })
            .idempotent()
            .takes_functions()
            .length(2)
            .into(),
        ),
        (
            "Box".into(),
            one(HostFunction::new(|args, _| {
                HostValue::object([("item", args.into_iter().next().unwrap_or_default())])
            })
            .constructible()),
        ),
        (
            "Later".into(),
            one(HostFunction::new(|args, _| {
                HostValue::object([("item", args.into_iter().next().unwrap_or_default())])
            })
            .constructible()),
        ),
        (
            "refuse".into(),
            one(HostFunction::new(|_, _| -> psychoscript::HostResult {
                Err(Failure::new("Refused", "Not today")
                    .suggestions(["Ask again."])
                    .into())
            })),
        ),
        (
            "api".into(),
            Namespace::new(
                |path| {
                    Ok(match path.len() {
                        0 => vec!["issues".into()],
                        _ => vec!["list".into()],
                    })
                },
                |path| -> Resolved {
                    if reference::joined(path) == "issues.list" {
                        return HostFunction::new_async(|_, _| async {
                            Ok(HostValue::array(["#1".into()]))
                        })
                        .length(1)
                        .into();
                    }
                    Failure::missing(format!("No api.{}", reference::joined(path)))
                        .suggestions(["Try api.issues.list."])
                        .kind("NotFound")
                        .into()
                },
            )
            .into(),
        ),
        (
            "count".into(),
            one(HostFunction::new(move |_, _| {
                counting.update_metadata(|m| {
                    let mut j = m.to_json();
                    if j.is_null() {
                        j = json!({ "count": 0 });
                    }
                    let n = j["count"].as_i64().unwrap_or(0) + 1;
                    j["count"] = json!(n);
                    *m = j.into();
                    HostValue::Number(n as f64)
                })
            })),
        ),
        (
            "wait".into(),
            HostFunction::new_async(move |_, call| {
                wait.push(json!(["wait", call.key()]));
                wait.pending(7.0)
            })
            .idempotent()
            .length(2)
            .into(),
        ),
        (
            "job".into(),
            DurableFunction::new(
                move |args, call| {
                    start.push(json!(["job.start", call.key(), described(&args)]));
                    let key = call.key();
                    async move { Ok(key.into()) }
                },
                move |data, call| {
                    waited.push(json!([
                        "job.wait",
                        data.to_json(),
                        call.key(),
                        described(&call.args)
                    ]));
                    waited.pending(41.0)
                },
                move |data, call| {
                    cancel.push(json!(["job.cancel", data.to_json(), call.key()]));
                    async {}
                },
            )
            .into(),
        ),
    ]
}

fn runtime(entry: &Json, state: &State) -> Runtime {
    let translate = Translate {
        functions: match entry["translate"]["functions"].as_str() {
            Some("drop") => TranslateFunctions::Drop,
            _ => TranslateFunctions::Error,
        },
        promises: match entry["translate"]["promises"].as_str() {
            Some("await") => TranslatePromises::Await,
            _ => TranslatePromises::Error,
        },
    };
    let limits = Limits {
        timeout_ms: entry["limits"]["timeoutMs"].as_u64(),
        max_output_bytes: entry["limits"]["maxOutputBytes"]
            .as_u64()
            .map(|n| n as usize),
    };
    let state = state.clone();
    Runtime::make()
        .translate(translate)
        .limits(limits)
        .globals(move |run| globals(&state, run))
}

fn diagnostic(d: &Diagnostic) -> Json {
    let mut out = json!({ "kind": d.kind.name(), "message": d.message_lossy() });
    if let Some((line, column)) = d.location {
        out["location"] = json!({ "line": line, "column": column });
    }
    if !d.suggestions.is_empty() {
        out["suggestions"] = json!(d.suggestions_lossy());
    }
    out
}

/// The run's `Result` as the reference gives it.
fn result(o: &Outcome) -> Json {
    let mut out = match &o.result {
        Ok(value) => json!({ "ok": true, "value": value.to_json() }),
        Err(d) => json!({ "ok": false, "error": diagnostic(d) }),
    };
    if !o.warnings.is_empty() {
        out["warnings"] = Json::Array(o.warnings.iter().map(diagnostic).collect());
    }
    if !o.logs.is_empty() {
        out["logs"] = json!(o.log_lines());
    }
    if o.truncated {
        out["truncated"] = json!(true);
    }
    out["metadata"] = o.metadata.to_json();
    out
}

/// JSON equality where numbers compare by value and object keys in any order.
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}

fn fixture() -> Json {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../conformance/host.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn roundtrip() -> bool {
    std::env::var_os("PSYCHOSCRIPT_ROUNDTRIP").is_some_and(|v| v == "1")
}

#[test]
fn host_functions_match_the_reference() {
    let fixture = fixture();
    let executes = fixture["executes"].as_array().unwrap();
    assert!(executes.len() >= 50);
    let mut failures = Vec::new();
    for entry in executes {
        let state = State::default();
        let rt = runtime(entry, &state);
        let code = entry["code"].as_str().unwrap();
        let options = ProgramOptions::new().run_id(entry["runId"].as_str().unwrap());
        let o = rt.execute_with(code, &options);
        let actual = json!({ "outcome": result(&o), "log": *state.log.lock().unwrap() });
        let expected = json!({ "outcome": entry["outcome"], "log": entry["log"] });
        if !same(&actual, &expected) {
            failures.push(format!(
                "{code}\n  expected {expected}\n  actual   {actual}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/// Wakes the thread that drives a run.
struct Unpark(std::thread::Thread);

impl Wake for Unpark {
    fn wake(self: Arc<Self>) {
        self.0.unpark();
    }
}

#[test]
fn suspending_runs_that_call_host_functions_matches_the_reference() {
    let fixture = fixture();
    let suspensions = fixture["suspensions"].as_array().unwrap();
    assert!(suspensions.len() >= 10);
    let mut failures = Vec::new();
    for entry in suspensions {
        let state = State::default();
        let rt = runtime(entry, &state);
        let code = entry["code"].as_str().unwrap();
        let options = ProgramOptions::new().run_id(entry["runId"].as_str().unwrap());
        let program = rt.program(code, &options);
        let suspender = program.suspender();
        // This thread drives the run, as the reference's fiber; another suspends it once a call reached a point that
        // never settles before the resume. A failed suspend interrupts the run, which drops it.
        let (suspend, ran) = std::thread::scope(|s| {
            let started = state.started.clone();
            let asking = s.spawn(move || {
                while !started.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                suspender.suspend(None)
            });
            let waker = Waker::from(Arc::new(Unpark(std::thread::current())));
            let mut cx = Context::from_waker(&waker);
            let mut run = Box::pin(program.run_resumable_async());
            loop {
                if let Poll::Ready(ran) = run.as_mut().poll(&mut cx) {
                    break (asking.join().unwrap(), Some(ran.unwrap()));
                }
                if asking.is_finished() {
                    let answer = asking.join().unwrap();
                    if answer.is_err() {
                        drop(run);
                        break (answer, None);
                    }
                    let ran = loop {
                        if let Poll::Ready(ran) = run.as_mut().poll(&mut cx) {
                            break ran.unwrap();
                        }
                        std::thread::park_timeout(Duration::from_millis(1));
                    };
                    break (answer, Some(ran));
                }
                std::thread::park_timeout(Duration::from_millis(1));
            }
        });
        let mut actual = json!({});
        match (&suspend, ran) {
            (Err(e), _) => {
                actual["suspend"] = json!({
                    "ok": false,
                    "message": e.message,
                    "running": e.running.iter().map(|c| json!({ "key": c.key, "path": c.path })).collect::<Vec<_>>(),
                });
            }
            (Ok(RunOutcome::Done(o)), _) => {
                actual["suspend"] = json!({ "ok": false, "outcome": result(o) });
            }
            (Ok(RunOutcome::Suspended(answer)), Some(RunOutcome::Suspended(saved))) => {
                actual["suspend"] = json!({
                    "ok": true,
                    "metadata": answer.state.0["header"]["metadata"],
                    "same": answer.state == saved.state,
                });
                state.resumed.store(true, Ordering::SeqCst);
                for w in state.wakers.lock().unwrap().drain(..) {
                    w.wake();
                }
                let resumed = rt
                    .resume_bytes(&to_bytes(&answer.state))
                    .unwrap()
                    .run_resumable()
                    .unwrap();
                actual["resume"] = match resumed {
                    RunOutcome::Done(o) => result(&o),
                    RunOutcome::Suspended(_) => json!("suspended again"),
                };
            }
            (Ok(_), _) => actual["suspend"] = json!("suspended, but the run went on"),
        }
        // The reference's round-trip mode makes the globals more often.
        if !roundtrip() {
            actual["made"] = json!(state.made.load(Ordering::SeqCst));
        }
        actual["log"] = Json::Array(state.log.lock().unwrap().clone());
        let mut expected = json!({ "suspend": entry["suspend"] });
        if let Some(resume) = entry.get("resume") {
            expected["resume"] = resume.clone();
        }
        if !roundtrip() {
            expected["made"] = entry["made"].clone();
        }
        expected["log"] = entry["log"].clone();
        if !same(&actual, &expected) {
            failures.push(format!(
                "{code}\n  expected {expected}\n  actual   {actual}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
