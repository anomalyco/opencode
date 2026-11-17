//! Streaming HTTP responses through an extension, against the reference's behaviour recorded in
//! `conformance/streaming.json` by `bun conformance/streaming.ts` (the reference has no tests of its own for them).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll};
use std::thread;
use std::time::Duration;

use psychoscript::{
    Extension, HostError, HostFunction, HostValue, HttpBody, Json, Program, RunOutcome, Runtime,
    Schema, StreamingResponse, Suspender, Tool,
};
use serde_json::json;

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
                    HostValue::String(s) => s.into_bytes(),
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
            response = response.with_header(k, v.as_str().unwrap());
        }
    }
    HostValue::Response(response)
}

/// `fetched`, when given, is told each time `fetch` answered.
fn web(log: &Log, fetched: Option<Waiting>) -> Extension {
    let log = log.clone();
    Extension::new("web")
        .function(
            "fetch",
            HostFunction::new_async("fetch", 1, move |args| {
                let response = respond(&args[0], &log);
                if let Some(w) = &fetched {
                    w.enter();
                }
                async move { Ok(response) }
            }),
        )
        .function(
            "echo",
            HostFunction::new("echo", 1, |args| {
                Ok(args.into_iter().next().unwrap_or_default())
            }),
        )
}

/// JSON equality where numbers compare by value.
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
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/streaming.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

/// `t.echo` of `conformance/streaming.ts`: answers its input, logging that it started.
fn echo(log: &Log) -> Tool {
    let log = log.clone();
    Tool::new_async("Echoes its input", move |input: Json, _| {
        log.lock().unwrap().push(json!(["echo", input.clone()]));
        async move { Ok(input) }
    })
    .output(Schema::validated(json!({})))
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
        Ok(value) if o.logs.is_empty() => json!({ "ok": true, "value": value }),
        Ok(value) => json!({ "ok": true, "value": value, "logs": o.logs }),
        Err(d) => json!({ "ok": false, "kind": d.kind.name(), "message": d.message }),
    }
}

#[test]
fn streaming_responses_match_the_reference() {
    let fixture = fixture();
    let programs = fixture["programs"].as_array().unwrap();
    assert!(programs.len() >= 60);
    let mut failures = Vec::new();
    for program in programs {
        let log: Log = Arc::default();
        let rt = Runtime::new()
            .with_tool("t.echo", echo(&log))
            .extension(web(&log, None));
        let code = program["code"].as_str().unwrap();
        let o = rt.execute(code, &serde_json::Map::new());
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

/// Set once the program entered `tools.wait`, which answers only after the run resumed.
#[derive(Clone, Default)]
struct Waiting(Arc<(Mutex<bool>, Condvar, AtomicBool)>);

impl Waiting {
    fn tool(&self) -> Tool {
        let this = self.clone();
        Tool::idempotent("Waits until the run resumed", move |_, _| {
            let resumed = this.0.2.load(Ordering::SeqCst);
            if !resumed {
                this.enter();
            }
            async move {
                if !resumed {
                    std::future::pending::<()>().await;
                }
                Ok(json!(1))
            }
        })
        .input(Schema::validated(json!({ "type": "object" })))
        .output(Schema::validated(json!({ "type": "number" })))
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
        // Without `tools.wait`, the suspend comes once the response has arrived, while a busy loop holds the run.
        let busy = !code.contains("tools.wait");
        let rt = Runtime::new()
            .with_tool("wait", waiting.tool())
            .with_tool("t.echo", echo(&log))
            .extension(web(&log, busy.then(|| waiting.clone())));
        let (run, suspend) = background(rt.program(code, &Default::default(), None), |s| {
            waiting.entered();
            if busy {
                thread::sleep(Duration::from_millis(20));
            }
            loop {
                match s.suspend(None) {
                    Err(e) if !e.running.is_empty() => thread::sleep(Duration::from_millis(1)),
                    other => return other.map(|_| ()).map_err(|e| e.message),
                }
            }
        });
        let mut actual = json!({ "suspend": { "ok": suspend.is_ok() } });
        if let Err(message) = suspend {
            actual["suspend"]["message"] = json!(message);
        }
        if let RunOutcome::Suspended(s) = run {
            waiting.0.2.store(true, Ordering::SeqCst);
            actual["resume"] = match rt.resume(&s.state) {
                Err(e) => json!({ "ok": false, "message": e.to_string() }),
                Ok(program) => match program.run_resumable().expect("not interrupted") {
                    RunOutcome::Done(o) => outcome(&o),
                    RunOutcome::Suspended(_) => json!("suspended again"),
                },
            };
        }
        actual["log"] = Json::Array(log.lock().unwrap().clone());
        let mut expected = json!({ "suspend": case["suspend"], "log": cancels(&case["log"]) });
        if let Some(resume) = case.get("resume") {
            expected["resume"] = resume.clone();
        }
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
