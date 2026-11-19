//! Streaming HTTP responses through a host function, how host-call arguments cross, and suspending a run that holds a
//! response or waits in a crossing, against the reference's behaviour recorded in `conformance/streaming.json` by
//! `bun conformance/streaming.ts` (the reference has no tests of its own for them). The globals are the generator's.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};
use std::thread;
use std::time::Duration;

use psychoscript::{
    Failure, HostError, HostFunction, HostValue, HttpBody, Json, Program, ProgramOptions,
    RunOutcome, Runtime, StreamingResponse, Suspender, Translate, TranslateFunctions,
    TranslatePromises,
};
use serde_json::json;

#[path = "../../../conformance/reference.rs"]
mod reference;

use reference::{describe, same};

type Log = Arc<Mutex<Vec<Json>>>;

/// The fake body of `conformance/streaming.ts`: `chunks` one per read, `fail` erroring the read at that index with
/// `new Error("boom")`, `delay` holding each read back for that many milliseconds.
struct Fake {
    chunks: VecDeque<Vec<u8>>,
    index: usize,
    fail: Option<usize>,
    delay: Option<u64>,
    waiting: Option<Arc<AtomicBool>>,
    log: Log,
}

impl HttpBody for Fake {
    fn poll_chunk(&mut self, cx: &mut Context<'_>) -> Poll<Option<Result<Vec<u8>, HostValue>>> {
        if let Some(ms) = self.delay {
            match &self.waiting {
                None => {
                    let done = Arc::new(AtomicBool::new(false));
                    self.waiting = Some(done.clone());
                    let waker = cx.waker().clone();
                    thread::spawn(move || {
                        thread::sleep(Duration::from_millis(ms));
                        done.store(true, Ordering::SeqCst);
                        waker.wake();
                    });
                    return Poll::Pending;
                }
                Some(done) if !done.load(Ordering::SeqCst) => return Poll::Pending,
                Some(_) => self.waiting = None,
            }
        }
        if self.fail == Some(self.index) {
            return Poll::Ready(Some(Err(HostValue::Error(Box::new(HostError::new(
                "boom",
            ))))));
        }
        self.index += 1;
        Poll::Ready(self.chunks.pop_front().map(Ok))
    }

    fn cancel(&mut self, reason: HostValue) {
        self.log
            .lock()
            .unwrap()
            .push(json!(["cancel", reason.to_json().unwrap_or(Json::Null)]));
    }
}

fn respond(spec: &HostValue, log: &Log) -> HostValue {
    let get = |k: &str| spec.get(k).cloned().unwrap_or_default();
    let body = match get("chunks") {
        HostValue::Array(chunks) => Some(Box::new(Fake {
            chunks: chunks
                .into_iter()
                .flatten()
                .map(|c| match c {
                    HostValue::String(s) => s.to_string_lossy().into_owned().into_bytes(),
                    HostValue::Array(bytes) => bytes
                        .into_iter()
                        .flatten()
                        .map(|b| b.as_f64().unwrap() as u8)
                        .collect(),
                    other => panic!("unexpected chunk {other:?}"),
                })
                .collect(),
            index: 0,
            fail: get("fail").as_f64().map(|n| n as usize),
            delay: get("delay").as_f64().map(|n| n as u64),
            waiting: None,
            log: log.clone(),
        }) as Box<dyn HttpBody>),
        _ => None,
    };
    let mut response = StreamingResponse::new(get("status").as_f64().unwrap_or(200.0) as u16, body)
        .with_redirected(matches!(get("redirected"), HostValue::Bool(true)));
    if let Some(text) = get("statusText").as_str() {
        response = response.with_status_text(text);
    }
    if let HostValue::Object(headers) = get("headers") {
        for (k, v) in headers {
            response = response.with_header(k.to_string_lossy(), v.as_str().unwrap());
        }
    }
    HostValue::Response(response)
}

/// The generator's runtime: its globals, with functions dropped and promises awaited in host-call arguments.
/// `fetched`, when given, is told each time `fetch` answered.
fn runtime(log: &Log, waiting: &Waiting, fetched: Option<Waiting>) -> Runtime {
    let (log, waiting) = (log.clone(), waiting.clone());
    Runtime::make()
        .translate(Translate {
            functions: TranslateFunctions::Drop,
            promises: TranslatePromises::Await,
        })
        .globals(move |_| {
            let (fetch_log, send_log, refuse_log) = (log.clone(), log.clone(), log.clone());
            let fetched = fetched.clone();
            [
                ("tools", HostValue::from(reference::tools())),
                (
                    "fetch",
                    HostFunction::new_async(move |args, _| {
                        let response = respond(&args[0], &fetch_log);
                        if let Some(w) = &fetched {
                            w.enter();
                        }
                        async move { Ok(response) }
                    })
                    .takes_functions()
                    .length(1)
                    .into(),
                ),
                (
                    "echo",
                    HostFunction::new(|args, _| args.into_iter().next().unwrap_or_default())
                        .takes_functions()
                        .length(1)
                        .into(),
                ),
                (
                    "send",
                    HostFunction::new_async(move |args, _| {
                        let log = send_log.clone();
                        async move {
                            log.lock().unwrap().push(json!(["send", described(&args)]));
                            Ok(args.into_iter().next().unwrap_or_default())
                        }
                    })
                    .length(1)
                    .into(),
                ),
                (
                    "refuse",
                    HostFunction::new_async(move |args, _| {
                        let log = refuse_log.clone();
                        async move {
                            log.lock()
                                .unwrap()
                                .push(json!(["refuse", described(&args)]));
                            Err(Failure::new("HostFailure", "boom").into())
                        }
                    })
                    .length(1)
                    .into(),
                ),
                (
                    "hold",
                    HostFunction::new(|args, _| {
                        HostValue::object([("items", HostValue::array(args))])
                    })
                    .thenable()
                    .length(1)
                    .into(),
                ),
                ("wait", waiting.function().into()),
            ]
        })
}

fn described(args: &[HostValue]) -> Json {
    Json::Array(args.iter().map(describe).collect())
}

fn fixture() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/streaming.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// The host's side of the log the reference recorded: what the program cancelled with. How often the host runtime
/// pulls ahead is its own buffering.
fn cancels(log: &Json) -> Json {
    Json::Array(
        log.as_array()
            .unwrap()
            .iter()
            .filter(|e| e[0] != "pull")
            .cloned()
            .collect(),
    )
}

fn outcome(o: &psychoscript::Outcome) -> Json {
    match &o.result {
        Ok(value) if o.logs.is_empty() => json!({ "ok": true, "value": value.to_json() }),
        Ok(value) => json!({ "ok": true, "value": value.to_json(), "logs": o.log_lines() }),
        Err(d) => json!({ "ok": false, "kind": d.kind.name(), "message": d.message_lossy() }),
    }
}

/// A finished run's outcome as the reference's result object writes it.
fn ended(o: &psychoscript::Outcome) -> Json {
    let mut out = match &o.result {
        Ok(value) => json!({ "ok": true, "value": value.to_json() }),
        Err(d) => {
            let mut error = json!({ "kind": d.kind.name(), "message": d.message_lossy() });
            if !d.suggestions.is_empty() {
                error["suggestions"] = json!(d.suggestions_lossy());
            }
            json!({ "ok": false, "error": error })
        }
    };
    if !o.logs.is_empty() {
        out["logs"] = json!(o.log_lines());
    }
    out["metadata"] = o.metadata.to_json();
    out
}

#[test]
fn streaming_responses_match_the_reference() {
    let fixture = fixture();
    let programs = fixture["programs"].as_array().unwrap();
    assert!(programs.len() >= 60);
    let mut failures = Vec::new();
    for program in programs {
        let log: Log = Arc::default();
        let rt = runtime(&log, &Waiting::default(), None);
        let code = program["code"].as_str().unwrap();
        let o = rt.execute(code);
        let actual = json!({ "outcome": outcome(&o), "log": *log.lock().unwrap() });
        let expected = json!({ "outcome": program["outcome"], "log": cancels(&program["log"]) });
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

/// Set once the program called `wait`, which answers only after the run resumed.
#[derive(Clone, Default)]
struct Waiting(Arc<(Mutex<bool>, Condvar, AtomicBool)>);

impl Waiting {
    /// The generator's `wait`: async and idempotent, settling with `1` only once called after the resume.
    fn function(&self) -> HostFunction {
        let this = self.clone();
        HostFunction::new_async(move |_, _| {
            let resumed = this.0.2.load(Ordering::SeqCst);
            if !resumed {
                this.enter();
            }
            async move {
                if !resumed {
                    std::future::pending::<()>().await;
                }
                Ok(HostValue::Number(1.0))
            }
        })
        .idempotent()
        .length(1)
    }

    fn enter(&self) {
        *self.0.0.lock().unwrap() = true;
        self.0.1.notify_all();
    }

    fn entered(&self) {
        let mut entered = self.0.0.lock().unwrap();
        while !*entered {
            entered = self
                .0
                .1
                .wait_timeout(entered, Duration::from_millis(10))
                .unwrap()
                .0;
        }
    }
}

/// Runs `program` on this thread while `during` runs on another with its suspender.
fn background<T: Send>(
    program: Program<'_>,
    during: impl FnOnce(Suspender) -> T + Send,
) -> (RunOutcome, T) {
    let suspender = program.suspender();
    thread::scope(|s| {
        let handle = s.spawn(move || during(suspender));
        let outcome = program.run_resumable().expect("not interrupted");
        (outcome, handle.join().unwrap())
    })
}

#[test]
fn suspending_a_run_that_holds_a_streaming_response_matches_the_reference() {
    let fixture = fixture();
    let suspensions = fixture["suspensions"].as_array().unwrap();
    assert!(suspensions.len() >= 9);
    let mut failures = Vec::new();
    for case in suspensions {
        let log: Log = Arc::default();
        let waiting = Waiting::default();
        let code = case["code"].as_str().unwrap();
        // Without `wait`, the suspend comes once the response has arrived, while a busy loop holds the run.
        let busy = !code.contains("wait(");
        let rt = runtime(&log, &waiting, busy.then(|| waiting.clone()));
        let (run, suspend) = background(rt.program(code, &ProgramOptions::new()), |s| {
            waiting.entered();
            if busy {
                thread::sleep(Duration::from_millis(20));
            }
            loop {
                match s.suspend(None) {
                    Err(e) if !e.running.is_empty() => thread::sleep(Duration::from_millis(1)),
                    other => return other.map_err(|e| e.message),
                }
            }
        });
        let mut actual = match &suspend {
            // The run ended before the suspend came: the suspend gives its outcome.
            Ok(RunOutcome::Done(o)) => json!({ "suspend": { "ok": false, "outcome": ended(o) } }),
            Ok(_) => json!({ "suspend": { "ok": true } }),
            Err(message) => json!({ "suspend": { "ok": false, "message": message } }),
        };
        if let RunOutcome::Suspended(s) = run {
            waiting.0.2.store(true, Ordering::SeqCst);
            let bytes = psychoscript::to_bytes(&s.state);
            actual["resume"] = match rt.resume_bytes(&bytes) {
                Err(e) => json!({ "ok": false, "message": e.to_string() }),
                Ok(program) => match program.run_resumable().expect("not interrupted") {
                    RunOutcome::Done(o) => outcome(&o),
                    RunOutcome::Suspended(_) => json!("suspended again"),
                },
            };
        }
        actual["log"] = Json::Array(log.lock().unwrap().clone());
        let mut expected = json!({ "suspend": case["suspend"] });
        if let Some(resume) = case.get("resume") {
            expected["resume"] = resume.clone();
        }
        expected["log"] = cancels(&case["log"]);
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
