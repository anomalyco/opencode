//! Suspending a run, saving its state, and resuming it in a brand-new runtime, mirroring the reference's
//! `suspend.test.ts`.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, Waker};
use std::thread;
use std::time::Duration;

use psychoscript::{
    Extension, Hooks, HostFunction, HostValue, Json, Limits, Program, RunOutcome, Runtime, Schema,
    Snapshot, Suspended, Suspender, Tool, ToolError,
};
use serde_json::json;

fn value_schema() -> Schema {
    Schema::validated(json!({
        "type": "object",
        "properties": { "value": { "type": "number" } },
        "required": ["value"],
        "additionalProperties": false
    }))
}

/// A future the test finishes by hand, and a flag that says it was entered.
#[derive(Clone, Default)]
struct Gate {
    inner: Arc<(Mutex<GateState>, Condvar)>,
}

#[derive(Default)]
struct GateState {
    value: Option<Json>,
    entered: usize,
    dropped: usize,
    waker: Option<Waker>,
}

impl Gate {
    fn wait(&self) -> GateFuture {
        {
            let (m, c) = &*self.inner;
            m.lock().unwrap().entered += 1;
            c.notify_all();
        }
        GateFuture {
            gate: self.clone(),
            done: false,
        }
    }

    /// Counts an entry without waiting.
    fn mark(&self) {
        let (m, c) = &*self.inner;
        m.lock().unwrap().entered += 1;
        c.notify_all();
    }

    fn open(&self, v: Json) {
        let (m, c) = &*self.inner;
        let mut s = m.lock().unwrap();
        s.value = Some(v);
        if let Some(w) = s.waker.take() {
            w.wake();
        }
        c.notify_all();
    }

    /// Waits until the gate was entered `n` times.
    fn entered(&self, n: usize) {
        let (m, c) = &*self.inner;
        let mut s = m.lock().unwrap();
        while s.entered < n {
            s = c.wait_timeout(s, Duration::from_millis(10)).unwrap().0;
        }
    }

    fn dropped(&self) -> usize {
        self.inner.0.lock().unwrap().dropped
    }

    fn reset(&self) {
        let mut s = self.inner.0.lock().unwrap();
        s.value = None;
        s.entered = 0;
    }
}

struct GateFuture {
    gate: Gate,
    done: bool,
}

impl Future for GateFuture {
    type Output = Json;
    fn poll(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Json> {
        let mut s = self.gate.inner.0.lock().unwrap();
        if let Some(v) = s.value.take() {
            drop(s);
            self.done = true;
            return Poll::Ready(v);
        }
        s.waker = Some(cx.waker().clone());
        Poll::Pending
    }
}

impl Drop for GateFuture {
    fn drop(&mut self) {
        if !self.done {
            self.gate.inner.0.lock().unwrap().dropped += 1;
        }
    }
}

/// A tool that doubles its input at once.
fn step() -> Tool {
    Tool::new("Doubles", |input, _| {
        Ok(json!({ "value": input["value"].as_f64().unwrap_or(0.0) * 2.0 }))
    })
    .input(value_schema())
    .output(value_schema())
}

/// The doubling tool, marking `gate` on every call so a test can suspend right after it.
fn marked(gate: &Gate) -> Tool {
    let gate = gate.clone();
    Tool::new("Doubles", move |input, _| {
        gate.mark();
        Ok(json!({ "value": input["value"].as_f64().unwrap_or(0.0) * 2.0 }))
    })
    .input(value_schema())
    .output(value_schema())
}

/// Runs `program` on this thread while `during` runs on another with its suspender.
fn background<'a, T: Send>(
    program: Program<'a>,
    during: impl FnOnce(Suspender) -> T + Send,
) -> (RunOutcome, T) {
    let suspender = program.suspender();
    thread::scope(|s| {
        let handle = s.spawn(move || during(suspender));
        let outcome = program.run_resumable().expect("not interrupted");
        (outcome, handle.join().unwrap())
    })
}

/// Suspends, trying again while a synchronous host call is running: a suspend that lands inside one is refused.
fn suspend_soon(
    s: &Suspender,
    max_bytes: Option<usize>,
) -> Result<RunOutcome, psychoscript::SuspendError> {
    for _ in 0..1000 {
        match s.suspend(max_bytes) {
            Err(e) if !e.running.is_empty() => thread::sleep(Duration::from_millis(1)),
            other => return other,
        }
    }
    s.suspend(max_bytes)
}

fn suspended(o: RunOutcome) -> Suspended {
    match o {
        RunOutcome::Suspended(s) => s,
        RunOutcome::Done(o) => panic!("expected a suspended run, got {:?}", o.result),
    }
}

fn done(o: RunOutcome) -> psychoscript::Outcome {
    match o {
        RunOutcome::Done(o) => o,
        RunOutcome::Suspended(_) => panic!("expected an ended run"),
    }
}

fn header(state: &Snapshot) -> &Json {
    &state.0["header"]
}

/// Busy-waits in the program after its first host call, so a suspend lands mid-loop.
const BUSY: &str = "const t = Date.now(); while (Date.now() - t < 300) {}";

#[test]
fn a_run_suspended_between_calls_resumes_from_state_and_from_bytes() {
    let code = format!(
        r#"const log = ["before"]
        const a = await tools.step({{ value: 20 }})
        {BUSY}
        const b = await tools.step({{ value: 1 }})
        log.push("after " + (a.value + b.value))
        console.log("resumed")
        return {{ log, total: a.value + b.value }}"#
    );
    let gate = Gate::default();
    let rt = Runtime::new().with_tool("step", marked(&gate));
    let (outcome, from_suspend) = background(rt.program(&code, &Default::default(), None), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert_eq!(suspended(from_suspend.unwrap()).state, state);
    let fresh = Runtime::new().with_tool("step", step());
    for program in [
        fresh.resume(&state).unwrap(),
        fresh.resume_bytes(&psychoscript::to_bytes(&state)).unwrap(),
    ] {
        let o = done(program.run_resumable().unwrap());
        assert_eq!(
            o.result.unwrap(),
            json!({ "log": ["before", "after 42"], "total": 42 })
        );
        assert_eq!(o.logs, ["resumed"]);
        assert_eq!(o.tool_calls.len(), 2);
    }
}

#[test]
fn a_suspend_fails_while_a_tool_is_running_and_the_run_goes_on() {
    let gate = Gate::default();
    let g = gate.clone();
    let slow = Tool::new_async("Waits", move |_, _| {
        let f = g.wait();
        async move { Ok(f.await) }
    })
    .input(value_schema())
    .output(value_schema());
    let rt = Runtime::new().with_tool("slow", slow);
    let (outcome, error) = background(
        rt.program(
            "return (await tools.slow({ value: 1 })).value",
            &Default::default(),
            Some("b"),
        ),
        |s| {
            gate.entered(1);
            let error = s.suspend(None).unwrap_err();
            gate.open(json!({ "value": 5 }));
            error
        },
    );
    assert_eq!(error.running.len(), 1);
    assert_eq!(error.running[0].key, "b:0");
    assert_eq!(error.running[0].path, "tools.slow");
    assert_eq!(
        error.message,
        "The run can't be suspended while tools.slow is running."
    );
    assert_eq!(done(outcome).result.unwrap(), json!(5));
}

#[test]
fn a_suspend_fails_while_a_synchronous_call_runs() {
    let gate = Gate::default();
    let g = gate.clone();
    let ext = Extension::new("clock").function(
        "now",
        HostFunction::new("now", 0, move |_| {
            let mut f = Box::pin(g.wait());
            Ok(HostValue::Number(
                psychoscript_block_on(&mut f).as_f64().unwrap_or(0.0),
            ))
        }),
    );
    let rt = Runtime::new().extension(ext);
    let (outcome, error) = background(
        rt.program("return now() + 1", &Default::default(), Some("s")),
        |s| {
            gate.entered(1);
            let error = s.suspend(None).unwrap_err();
            gate.open(json!(7));
            error
        },
    );
    assert_eq!(error.running[0].path, "now");
    assert_eq!(done(outcome).result.unwrap(), json!(8));
}

/// Blocks on a gate future from inside a synchronous host function.
fn psychoscript_block_on(f: &mut Pin<Box<GateFuture>>) -> Json {
    let gate = f.gate.clone();
    let (m, c) = &*gate.inner;
    let mut s = m.lock().unwrap();
    loop {
        if let Some(v) = s.value.take() {
            f.done = true;
            return v;
        }
        s = c.wait_timeout(s, Duration::from_millis(5)).unwrap().0;
    }
}

#[test]
fn a_loop_of_synchronous_extension_calls_can_be_suspended_and_resumed() {
    let gate = Gate::default();
    let ext = || {
        let gate = gate.clone();
        Extension::new("draw").function(
            "draw",
            HostFunction::new("draw", 1, move |args| {
                gate.mark();
                Ok(args[0].clone())
            }),
        )
    };
    let rt = Runtime::new().extension(ext());
    let code = "let n = 0\nwhile (n < 200000) draw(n++)\nreturn n";
    let (outcome, _) = background(rt.program(code, &Default::default(), None), |s| {
        gate.entered(500);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert!(gate.inner.0.lock().unwrap().entered < 200000);
    let o = done(
        Runtime::new()
            .extension(ext())
            .resume_bytes(&psychoscript::to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(o.result.unwrap(), json!(200000));
}

#[test]
fn a_suspend_after_the_run_ended_gives_its_result() {
    let rt = Runtime::new();
    let program = rt.program("return 1 + 1", &Default::default(), None);
    let suspender = program.suspender();
    let o = done(program.run_resumable().unwrap());
    assert_eq!(o.result.unwrap(), json!(2));
    let again = done(suspender.suspend(None).unwrap());
    assert_eq!(again.result.unwrap(), json!(2));
}

#[test]
fn a_suspend_issued_before_the_run_starts_stops_a_busy_loop() {
    let code = "let n = 0; for (let i = 0; i < 2000000; i++) n = (n + i) % 1000003; return n";
    let rt = Runtime::new();
    let expected = rt.execute(code, &Default::default()).result.unwrap();
    let program = rt.program(code, &Default::default(), None);
    let suspender = program.suspender();
    let (outcome, answer) = thread::scope(|s| {
        let h = s.spawn(move || suspender.suspend(None));
        thread::sleep(Duration::from_millis(5));
        (program.run_resumable().unwrap(), h.join().unwrap())
    });
    let state = suspended(outcome).state;
    assert_eq!(suspended(answer.unwrap()).state, state);
    let fresh = Runtime::new();
    let o = done(
        fresh
            .resume_bytes(&psychoscript::to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(o.result.unwrap(), expected);
}

#[test]
fn a_state_over_the_byte_budget_fails_the_suspend_and_the_run_goes_on() {
    let code = format!(
        r#"const big = "x".repeat(1000); await tools.step({{ value: 1 }}); {BUSY} return big.length"#
    );
    let gate = Gate::default();
    let rt = Runtime::new().with_tool("step", marked(&gate));
    let (outcome, error) = background(rt.program(&code, &Default::default(), None), |s| {
        gate.entered(1);
        suspend_soon(&s, Some(100))
    });
    let error = error.unwrap_err();
    assert!(error.running.is_empty());
    assert!(
        error.message.starts_with("The run's state takes ")
            && error.message.ends_with("more than the 100-byte limit."),
        "{}",
        error.message
    );
    assert_eq!(done(outcome).result.unwrap(), json!(1000));
}

/// Suspends `code` in the busy loop after its first `tools.step` call; `rt` marks `gate` there.
fn suspend_mid_loop(rt: &Runtime, gate: &Gate, code: &str) -> Snapshot {
    let (outcome, _) = background(rt.program(code, &Default::default(), None), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    suspended(outcome).state
}

#[test]
fn a_resumed_run_keeps_its_limits_and_counts_time_and_calls_across_resumes() {
    let code = format!(
        "await tools.step({{ value: 1 }}); {BUSY} await tools.step({{ value: 2 }}); await tools.step({{ value: 3 }}); return \"done\""
    );
    let gate = Gate::default();
    let rt = Runtime::new()
        .with_tool("step", marked(&gate))
        .limits(Limits {
            max_tool_calls: Some(2),
            max_output_bytes: Some(10),
            timeout_ms: None,
        });
    let state = suspend_mid_loop(&rt, &gate, &code);
    assert_eq!(
        header(&state)["limits"],
        json!({ "timeoutMs": null, "maxToolCalls": 2, "maxOutputBytes": 10 })
    );
    let fresh = Runtime::new().with_tool("step", step());
    let o = done(fresh.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap_err().kind,
        psychoscript::DiagnosticKind::ToolCallLimitExceeded
    );

    let gate = Gate::default();
    let timed = Runtime::new()
        .with_tool("step", marked(&gate))
        .limits(Limits {
            timeout_ms: Some(400),
            ..Limits::default()
        });
    let code = "await tools.step({ value: 1 }); const a = Date.now(); while (Date.now() - a < 250) {} const b = Date.now(); while (Date.now() - b < 250) {} return 1";
    let (outcome, _) = background(timed.program(code, &Default::default(), None), |s| {
        gate.entered(1);
        thread::sleep(Duration::from_millis(200));
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert!(header(&state)["budget"]["activeMs"].as_u64().unwrap() >= 150);
    assert_eq!(header(&state)["budget"]["toolCalls"], json!(1));
    let o = done(timed.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap_err().kind,
        psychoscript::DiagnosticKind::TimeoutExceeded
    );
}

#[test]
fn a_state_is_refused_by_another_build_other_extensions_or_a_changed_source() {
    let gate = Gate::default();
    let rt = Runtime::new().with_tool("step", marked(&gate));
    let state = suspend_mid_loop(
        &rt,
        &gate,
        &format!("await tools.step({{ value: 1 }}); {BUSY} return 1"),
    );
    let mut other = state.clone();
    other.0["header"]["build"] = json!("0.0.0+0");
    let e = rt.resume(&other).err().unwrap();
    assert!(
        e.message
            .contains("saved by another PsychoScript build (0.0.0+0)"),
        "{}",
        e.message
    );
    let ext = Runtime::new().extension(Extension::new("x").function(
        "f",
        HostFunction::new("f", 0, |_| Ok(HostValue::Number(1.0))),
    ));
    assert!(
        ext.resume(&state)
            .err()
            .unwrap()
            .message
            .contains("saved by a runtime with other host globals")
    );
    let mut changed = state.clone();
    let code = changed.0["header"]["source"]["code"]
        .as_str()
        .unwrap()
        .to_owned();
    changed.0["header"]["source"]["code"] = json!(format!("{code} "));
    assert_eq!(
        rt.resume(&changed).err().unwrap().message,
        "Source main does not match its hash."
    );
    assert!(rt.resume_bytes(b"{").is_err());
    let mut broken = state.clone();
    broken.0["state"]["heap"] = json!([{ "t": "Nope" }]);
    assert!(
        rt.resume(&broken)
            .err()
            .unwrap()
            .message
            .contains("Invalid snapshot")
    );
}

#[test]
fn a_function_an_extension_returned_is_lost_on_resume() {
    let ext = Extension::new("maker").function(
        "make",
        HostFunction::new("make", 0, |_| {
            Ok(HostValue::Function(HostFunction::new("inc", 1, |args| {
                Ok(HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0))
            })))
        }),
    );
    let gate = Gate::default();
    let rt = Runtime::new()
        .with_tool("step", marked(&gate))
        .extension(ext.clone());
    let code = format!(
        "const inc = make(); const before = inc(1); await tools.step({{ value: 0 }}); {BUSY} try {{ return {{ before, after: inc(1) }} }} catch (error) {{ return {{ before, error: String(error) }} }}"
    );
    let state = suspend_mid_loop(&rt, &gate, &code);
    let fresh = Runtime::new().with_tool("step", step()).extension(ext);
    let o = done(fresh.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap(),
        json!({ "before": 2, "error": "TypeError: The function inc came from the host and was lost when the run was suspended; get it again after resuming." })
    );
}

#[test]
fn program_state_of_every_kind_survives_a_suspend() {
    let code = format!(
        r#"const shared = {{ n: 1 }}
      const map = new Map([[shared, "a"], ["k", shared]])
      const set = new Set([1, shared])
      const it = map.keys()
      it.next()
      const url = new URL("https://example.com/a?x=1")
      const params = url.searchParams
      const bytes = new Uint8Array([1, 2, 3, 4])
      const view = bytes.subarray(1, 3)
      const re = /a(b)/g
      re.test("abab")
      const date = new Date(0)
      const weak = new WeakMap([[shared, 5]])
      function* counter() {{ let i = 0; while (true) yield i++ }}
      const gen = counter()
      gen.next()
      const bound = ((a, b) => a + b).bind(null, 10)
      const sparse = []
      sparse[5000] = "far"
      const pending = new Promise((resolve) => (globalResolve = resolve))
      var globalResolve
      Array.prototype.extra = "patched"
      await tools.step({{ value: 1 }})
      {BUSY}
      params.append("y", "2")
      view[0] = 9
      globalResolve("later")
      return {{
        same: map.get("k") === shared && set.has(shared) && weak.get(shared) === 5,
        next: it.next().value,
        url: url.href,
        bytes: [...bytes],
        lastIndex: re.lastIndex,
        date: date.getTime(),
        gen: [gen.next().value, gen.next().value],
        bound: bound(5),
        sparse: [sparse.length, sparse[5000]],
        pending: await pending,
        extra: [].extra,
        negative: Object.is(-0, -0 * 1),
      }}"#
    );
    let gate = Gate::default();
    let rt = Runtime::new().with_tool("step", marked(&gate));
    let state = suspend_mid_loop(&rt, &gate, &code);
    let fresh = Runtime::new().with_tool("step", step());
    let o = done(
        fresh
            .resume_bytes(&psychoscript::to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(
        o.result.unwrap(),
        json!({
            "same": true,
            "next": "k",
            "url": "https://example.com/a?x=1&y=2",
            "bytes": [1, 9, 3, 4],
            "lastIndex": 2,
            "date": 0,
            "gen": [1, 2],
            "bound": 15,
            "sparse": [5001, "far"],
            "pending": "later",
            "extra": "patched",
            "negative": true,
        })
    );
}

#[test]
fn changes_to_built_ins_survive_a_second_suspend() {
    let code = format!(
        r#"Array.prototype.extra = "patched"
      delete Math.max
      Object.freeze(JSON)
      Object.seal(Number.prototype)
      Object.preventExtensions(Date.prototype)
      await tools.step({{ value: 1 }})
      {BUSY}
      await tools.step({{ value: 2 }})
      const t2 = Date.now()
      while (Date.now() - t2 < 300) {{}}
      return {{
        extra: [].extra,
        max: typeof Math.max,
        frozen: Object.isFrozen(JSON),
        sealed: Object.isSealed(Number.prototype) && !Object.isFrozen(Number.prototype),
        extensible: Object.isExtensible(Date.prototype),
        untouched: Object.isExtensible(Map.prototype) && typeof Math.min,
      }}"#
    );
    let gate = Gate::default();
    let rt = Runtime::new().with_tool("step", marked(&gate));
    let first = suspend_mid_loop(&rt, &gate, &code);
    let (outcome, _) = background(rt.resume(&first).unwrap(), |s| {
        gate.entered(2);
        suspend_soon(&s, None)
    });
    let second = suspended(outcome).state;
    let o = done(rt.resume(&second).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap(),
        json!({
            "extra": "patched",
            "max": "undefined",
            "frozen": true,
            "sealed": true,
            "extensible": false,
            "untouched": "function",
        })
    );
}

fn events_hooks(events: &Arc<Mutex<Vec<String>>>) -> Hooks {
    let (b, a) = (events.clone(), events.clone());
    Hooks::new()
        .tool_before(move |call| {
            b.lock()
                .unwrap()
                .push(format!("before {} {}", call.name, call.key));
            Ok(())
        })
        .tool_after(move |call, result| {
            a.lock().unwrap().push(format!(
                "after {} {} {}",
                call.name,
                call.key,
                result.status()
            ));
        })
}

#[test]
fn an_idempotent_tool_in_flight_suspends_and_reruns_on_resume_with_the_same_key() {
    let gate = Gate::default();
    let keys = Arc::new(Mutex::new(Vec::new()));
    let (g, k) = (gate.clone(), keys.clone());
    let read = Tool::idempotent("Safe to rerun", move |_, ctx| {
        k.lock().unwrap().push(ctx.key());
        let f = g.wait();
        async move { Ok(f.await) }
    })
    .input(value_schema())
    .output(value_schema());
    let events = Arc::new(Mutex::new(Vec::new()));
    let rt = Runtime::new()
        .with_tool("read", read)
        .hooks(events_hooks(&events));
    let code = "const a = await tools.read({ value: 20 }); const b = await tools.read({ value: 22 }); return a.value + b.value";
    let (outcome, _) = background(rt.program(code, &Default::default(), Some("rr")), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert_eq!(gate.dropped(), 1);
    assert_eq!(*events.lock().unwrap(), ["before read rr:0"]);
    gate.reset();
    let (outcome, _) = background(rt.resume(&state).unwrap(), |_| {
        gate.entered(1);
        gate.open(json!({ "value": 20 }));
        gate.entered(2);
        gate.open(json!({ "value": 22 }));
    });
    let o = done(outcome);
    assert_eq!(o.result.unwrap(), json!(42));
    assert_eq!(o.tool_calls.len(), 2);
    assert_eq!(*keys.lock().unwrap(), ["rr:0", "rr:0", "rr:1"]);
    assert_eq!(
        *events.lock().unwrap(),
        [
            "before read rr:0",
            "before read rr:0",
            "after read rr:0 success",
            "before read rr:1",
            "after read rr:1 success"
        ]
    );
}

#[test]
fn max_tool_calls_is_not_double_counted_when_an_idempotent_call_reruns() {
    let gate = Gate::default();
    let g = gate.clone();
    let read = Tool::idempotent("Safe", move |_, _| {
        let f = g.wait();
        async move { Ok(f.await) }
    })
    .input(value_schema())
    .output(value_schema());
    let rt = Runtime::new().with_tool("read", read).limits(Limits {
        max_tool_calls: Some(1),
        ..Limits::default()
    });
    let (outcome, _) = background(
        rt.program(
            "return (await tools.read({ value: 7 })).value",
            &Default::default(),
            Some("lim"),
        ),
        |s| {
            gate.entered(1);
            suspend_soon(&s, None)
        },
    );
    let state = suspended(outcome).state;
    assert_eq!(header(&state)["budget"]["toolCalls"], json!(1));
    gate.reset();
    let (outcome, _) = background(rt.resume(&state).unwrap(), |_| {
        gate.entered(1);
        gate.open(json!({ "value": 7 }));
    });
    let o = done(outcome);
    assert_eq!(o.result.unwrap(), json!(7));
    assert_eq!(o.tool_calls.len(), 1);
}

/// A durable tool over a job table that outlives any one run.
#[derive(Clone, Default)]
struct Jobs {
    log: Arc<Mutex<Vec<String>>>,
    cancelled: Arc<Mutex<Vec<String>>>,
    start_gate: Gate,
    result: Gate,
}

impl Jobs {
    fn tool(&self, gated: bool) -> Tool {
        let (start_log, wait_log, cancelled) =
            (self.log.clone(), self.log.clone(), self.cancelled.clone());
        let (start_gate, result) = (self.start_gate.clone(), self.result.clone());
        Tool::durable(
            "Runs a durable job",
            move |input, ctx| {
                start_log
                    .lock()
                    .unwrap()
                    .push(format!("start {}", ctx.key()));
                let key = ctx.key();
                let wait = gated.then(|| start_gate.wait());
                async move {
                    if let Some(w) = wait {
                        w.await;
                    }
                    Ok(json!({ "job": key, "input": input["value"] }))
                }
            },
            move |data, ctx| {
                wait_log.lock().unwrap().push(format!(
                    "wait {} {}",
                    ctx.key(),
                    data["job"].as_str().unwrap_or("")
                ));
                let f = result.wait();
                async move { Ok(f.await) }
            },
            move |data| {
                cancelled
                    .lock()
                    .unwrap()
                    .push(data["job"].as_str().unwrap_or("").to_owned());
                async {}
            },
        )
        .input(value_schema())
        .output(value_schema())
    }
}

#[test]
fn a_durable_tool_refuses_suspend_during_start_and_waits_on_its_data_on_resume() {
    let jobs = Jobs::default();
    let events = Arc::new(Mutex::new(Vec::new()));
    let rt = Runtime::new()
        .with_tool("job", jobs.tool(true))
        .hooks(events_hooks(&events));
    let code = r#"const a = await tools.job({ value: 41 }); return a.value + 1"#;
    let (outcome, during_start) =
        background(rt.program(code, &Default::default(), Some("rec")), |s| {
            jobs.start_gate.entered(1);
            let refused = s.suspend(None).unwrap_err();
            jobs.start_gate.open(Json::Null);
            jobs.result.entered(1);
            let _ = s.suspend(None);
            refused
        });
    assert_eq!(during_start.running[0].key, "rec:0");
    assert_eq!(during_start.running[0].path, "tools.job");
    let state = suspended(outcome).state;
    assert!(jobs.cancelled.lock().unwrap().is_empty());
    assert_eq!(*events.lock().unwrap(), ["before job rec:0"]);
    jobs.result.reset();
    let resumed = rt.resume_bytes(&psychoscript::to_bytes(&state)).unwrap();
    let (outcome, _) = background(resumed, |_| {
        jobs.result.entered(1);
        jobs.result.open(json!({ "value": 41 }));
    });
    assert_eq!(
        *jobs.log.lock().unwrap(),
        ["start rec:0", "wait rec:0 rec:0", "wait rec:0 rec:0"]
    );
    assert_eq!(done(outcome).result.unwrap(), json!(42));
    assert_eq!(
        *events.lock().unwrap(),
        ["before job rec:0", "after job rec:0 success"]
    );
    assert!(jobs.cancelled.lock().unwrap().is_empty());
}

#[test]
fn a_durable_tool_is_cancelled_when_the_run_ends_with_it_running_not_on_suspend() {
    let jobs = Jobs::default();
    let rt = Runtime::new().with_tool("job", jobs.tool(false));
    let o = rt.execute(
        r#"tools.job({ value: 1 }); return "left""#,
        &Default::default(),
    );
    assert_eq!(o.result.unwrap(), json!("left"));
    assert_eq!(jobs.cancelled.lock().unwrap().len(), 1);
}

#[test]
fn methods_on_an_extension_returned_value_survive_with_snapshot_hooks() {
    fn response(url: &str) -> HostValue {
        let body = format!("body of {url}");
        HostValue::object([
            ("url", HostValue::from(url)),
            (
                "text",
                HostValue::Function(HostFunction::new("text", 0, move |_| {
                    Ok(HostValue::from(body.clone()))
                })),
            ),
        ])
    }
    let ext = || {
        Extension::new("web")
            .function(
                "fetch",
                HostFunction::new("fetch", 1, |args| {
                    Ok(response(args[0].as_str().unwrap_or("")))
                }),
            )
            .snapshot(
                |v| {
                    Ok(HostValue::from(
                        v.get("url").and_then(HostValue::as_str).unwrap_or(""),
                    ))
                },
                |data| response(data.as_str().unwrap_or("")),
            )
    };
    let gate = Gate::default();
    let rt = Runtime::new()
        .with_tool("step", marked(&gate))
        .extension(ext());
    let code = format!(
        r#"const res = fetch("https://a.test/"); await tools.step({{ value: 1 }}); {BUSY} return [res.url, res.text()]"#
    );
    let state = suspend_mid_loop(&rt, &gate, &code);
    let fresh = Runtime::new().with_tool("step", step()).extension(ext());
    let o = done(fresh.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap(),
        json!(["https://a.test/", "body of https://a.test/"])
    );
    // Without the extension's hooks the state is refused.
    let bare = Runtime::new()
        .with_tool("step", step())
        .extension(Extension::new("web").function(
            "fetch",
            HostFunction::new("fetch", 1, |_| Ok(HostValue::Null)),
        ));
    assert!(bare.resume(&state).is_err());
}

#[test]
fn a_suspend_fails_when_an_encode_hook_fails_and_the_run_goes_on() {
    let ext = Extension::new("web")
        .function(
            "make",
            HostFunction::new("make", 0, |_| {
                Ok(HostValue::object([(
                    "f",
                    HostValue::Function(HostFunction::new("f", 0, |_| Ok(HostValue::Number(1.0)))),
                )]))
            }),
        )
        .snapshot(
            |_| {
                Err(psychoscript::HostError {
                    name: "Error".into(),
                    message: "no".into(),
                    cause: None,
                    fields: Vec::new(),
                })
            },
            |v| v,
        );
    let gate = Gate::default();
    let rt = Runtime::new()
        .with_tool("step", marked(&gate))
        .extension(ext);
    let code = format!("const v = make(); await tools.step({{ value: 1 }}); {BUSY} return v.f()");
    let (outcome, error) = background(rt.program(&code, &Default::default(), None), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    assert!(error.unwrap_err().message.contains("encode"));
    assert_eq!(done(outcome).result.unwrap(), json!(1));
}

#[test]
fn a_tool_interrupt_still_ends_the_run() {
    let rt = Runtime::new().with_tool(
        "stop",
        Tool::new("Stops", |_, _| Err(ToolError::interrupt())).input(value_schema()),
    );
    let program = rt.program(
        "await tools.stop({ value: 1 }); return 1",
        &Default::default(),
        None,
    );
    assert!(program.run_resumable().is_err());
}
