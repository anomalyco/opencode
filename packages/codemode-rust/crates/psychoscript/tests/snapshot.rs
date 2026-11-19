//! Suspending a run, saving its state, and resuming it in a brand-new runtime, mirroring the reference's
//! `suspend.test.ts` on the language layer: host functions instead of tools.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, Waker};
use std::thread;
use std::time::Duration;

use psychoscript::{
    DurableFunction, HostError, HostFunction, HostValue, Json, Limits, Namespace, Program,
    ProgramOptions, RunOutcome, Runtime, Snapshot, Suspended, Suspender,
};
use serde_json::json;

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
        self.mark();
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

    /// Blocks the calling thread until the gate opens, as a synchronous host function would.
    fn block(&self) -> Json {
        self.mark();
        let (m, c) = &*self.inner;
        let mut s = m.lock().unwrap();
        loop {
            if let Some(v) = s.value.take() {
                return v;
            }
            s = c.wait_timeout(s, Duration::from_millis(5)).unwrap().0;
        }
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

/// `step(n)`: an async host function that doubles `n` at once, marking `gate` on every call so a test can suspend
/// right after it.
fn step(gate: Option<&Gate>) -> HostFunction {
    let gate = gate.cloned();
    HostFunction::new_async(move |args, _| {
        if let Some(g) = &gate {
            g.mark();
        }
        let n = args[0].as_f64().unwrap_or(0.0);
        async move { Ok(HostValue::Number(n * 2.0)) }
    })
    .length(1)
}

/// A runtime whose only global is `step`, marking `gate`.
fn stepping(gate: &Gate) -> Runtime {
    let gate = gate.clone();
    Runtime::make().globals(move |_| [("step", step(Some(&gate)))])
}

/// A runtime whose only global is `step`, marking nothing: the same host globals as [`stepping`].
fn fresh() -> Runtime {
    Runtime::make().globals(|_| [("step", step(None))])
}

fn options(run_id: &str) -> ProgramOptions {
    ProgramOptions::new().run_id(run_id)
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

/// The message a runtime with other host globals refuses a state with.
const OTHER_GLOBALS: &str =
    "This state was saved by a runtime with other host globals; resume it with the same ones.";

#[test]
fn a_run_suspended_between_calls_resumes_from_state_and_from_bytes() {
    let code = format!(
        r#"const log = ["before"]
        const a = await step(20)
        {BUSY}
        const b = await step(1)
        log.push("after " + (a + b))
        console.log("resumed")
        return {{ log, total: a + b }}"#
    );
    let gate = Gate::default();
    let rt = stepping(&gate);
    let (outcome, from_suspend) = background(rt.program(&code, &ProgramOptions::new()), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert_eq!(suspended(from_suspend.unwrap()).state, state);
    let fresh = fresh();
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
    }
}

#[test]
fn a_suspend_fails_while_a_call_is_running_and_the_run_goes_on() {
    let gate = Gate::default();
    let g = gate.clone();
    let rt = Runtime::make().globals(move |_| {
        let g = g.clone();
        [(
            "tools",
            Namespace::new(
                |_| Ok(vec!["slow".into()]),
                move |_| {
                    let g = g.clone();
                    HostFunction::new_async(move |_, _| {
                        let f = g.wait();
                        async move { Ok(HostValue::from_json(&f.await)) }
                    })
                },
            ),
        )]
    });
    let (outcome, error) = background(
        rt.program("return await tools.slow(1)", &options("b")),
        |s| {
            gate.entered(1);
            let error = s.suspend(None).unwrap_err();
            gate.open(json!(5));
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
    let rt = Runtime::make().globals(move |_| {
        let g = g.clone();
        [(
            "now",
            HostFunction::new(move |_, _| HostValue::Number(g.block().as_f64().unwrap_or(0.0))),
        )]
    });
    let (outcome, error) = background(rt.program("return now() + 1", &options("s")), |s| {
        gate.entered(1);
        let error = s.suspend(None).unwrap_err();
        gate.open(json!(7));
        error
    });
    assert_eq!(error.running[0].path, "now");
    assert_eq!(
        error.message,
        "The run can't be suspended while now is running."
    );
    assert_eq!(done(outcome).result.unwrap(), json!(8));
}

#[test]
fn a_loop_of_synchronous_calls_can_be_suspended_and_resumed() {
    let gate = Gate::default();
    let draw = |gate: Gate| {
        Runtime::make().globals(move |_| {
            let gate = gate.clone();
            [(
                "draw",
                HostFunction::new(move |args, _| {
                    gate.mark();
                    args[0].clone()
                }),
            )]
        })
    };
    let rt = draw(gate.clone());
    let code = "let n = 0\nwhile (n < 200000) draw(n++)\nreturn n";
    let (outcome, _) = background(rt.program(code, &ProgramOptions::new()), |s| {
        gate.entered(500);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert!(gate.inner.0.lock().unwrap().entered < 200000);
    let o = done(
        draw(Gate::default())
            .resume_bytes(&psychoscript::to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(o.result.unwrap(), json!(200000));
}

#[test]
fn a_suspend_after_the_run_ended_gives_its_result() {
    let rt = Runtime::make();
    let program = rt.program("return 1 + 1", &ProgramOptions::new());
    let suspender = program.suspender();
    let o = done(program.run_resumable().unwrap());
    assert_eq!(o.result.unwrap(), json!(2));
    let again = done(suspender.suspend(None).unwrap());
    assert_eq!(again.result.unwrap(), json!(2));
}

#[test]
fn a_suspend_issued_before_the_run_starts_stops_a_busy_loop() {
    let code = "let n = 0; for (let i = 0; i < 2000000; i++) n = (n + i) % 1000003; return n";
    let rt = Runtime::make();
    let expected = rt.execute(code).result.unwrap();
    let program = rt.program(code, &ProgramOptions::new());
    let suspender = program.suspender();
    let (outcome, answer) = thread::scope(|s| {
        let h = s.spawn(move || suspender.suspend(None));
        thread::sleep(Duration::from_millis(5));
        (program.run_resumable().unwrap(), h.join().unwrap())
    });
    let state = suspended(outcome).state;
    assert_eq!(suspended(answer.unwrap()).state, state);
    let o = done(
        Runtime::make()
            .resume_bytes(&psychoscript::to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(o.result.unwrap(), expected);
}

#[test]
fn a_state_over_the_byte_budget_fails_the_suspend_and_the_run_goes_on() {
    let code = format!(r#"const big = "x".repeat(1000); await step(1); {BUSY} return big.length"#);
    let gate = Gate::default();
    let rt = stepping(&gate);
    let (outcome, error) = background(rt.program(&code, &ProgramOptions::new()), |s| {
        gate.entered(1);
        suspend_soon(&s, Some(100))
    });
    let error = error.unwrap_err();
    assert!(error.running.is_empty());
    assert!(
        error.message.starts_with("The run's state takes ")
            && error
                .message
                .ends_with(" bytes, more than the 100-byte limit, so it couldn't be suspended."),
        "{}",
        error.message
    );
    assert_eq!(done(outcome).result.unwrap(), json!(1000));
}

/// Suspends `code` in the busy loop after its first `step` call; `rt` marks `gate` there.
fn suspend_mid_loop(rt: &Runtime, gate: &Gate, code: &str) -> Snapshot {
    let (outcome, _) = background(rt.program(code, &ProgramOptions::new()), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    suspended(outcome).state
}

#[test]
fn a_resumed_run_keeps_its_limits_and_counts_time_across_resumes() {
    let code = format!(r#"await step(1); {BUSY} return "x".repeat(100)"#);
    let gate = Gate::default();
    let g = gate.clone();
    let rt = Runtime::make()
        .globals(move |_| [("step", step(Some(&g)))])
        .limits(Limits {
            max_output_bytes: Some(10),
            timeout_ms: None,
        });
    let state = suspend_mid_loop(&rt, &gate, &code);
    assert_eq!(
        header(&state)["limits"],
        json!({ "timeoutMs": null, "maxOutputBytes": 10 })
    );
    // A runtime without limits resumes it with the ones it was saved with.
    let o = done(fresh().resume(&state).unwrap().run_resumable().unwrap());
    assert!(o.truncated);
    assert_eq!(
        o.result.unwrap(),
        json!(
            "\"xxxxxxxxx [result truncated: 102 bytes exceeds the 10-byte output limit; return a smaller value]"
        )
    );

    let gate = Gate::default();
    let g = gate.clone();
    let timed = Runtime::make()
        .globals(move |_| [("step", step(Some(&g)))])
        .limits(Limits {
            timeout_ms: Some(400),
            ..Limits::default()
        });
    let code = "await step(1); const a = Date.now(); while (Date.now() - a < 250) {} const b = Date.now(); while (Date.now() - b < 250) {} return 1";
    let (outcome, _) = background(timed.program(code, &ProgramOptions::new()), |s| {
        gate.entered(1);
        thread::sleep(Duration::from_millis(200));
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert!(header(&state)["budget"]["activeMs"].as_u64().unwrap() >= 150);
    let o = done(timed.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap_err().kind,
        psychoscript::DiagnosticKind::TimeoutExceeded
    );
}

#[test]
fn a_state_is_refused_by_another_build_other_host_globals_or_a_changed_source() {
    let gate = Gate::default();
    let rt = stepping(&gate);
    let state = suspend_mid_loop(&rt, &gate, &format!("await step(1); {BUSY} return 1"));
    let mut other = state.clone();
    other.0["header"]["build"] = json!("0.0.0+0");
    let e = rt.resume(&other).err().unwrap();
    // The reference names itself "Code Mode" where this build names itself "PsychoScript".
    assert!(
        e.message.starts_with("This state was saved by another ")
            && e.message.contains(" build (0.0.0+0); this runtime is ")
            && e.message.ends_with(", so it can't resume it."),
        "{}",
        e.message
    );
    let others = Runtime::make().globals(|_| {
        [
            ("step", step(None)),
            ("f", HostFunction::new(|_, _| HostValue::Number(1.0))),
        ]
    });
    assert_eq!(others.resume(&state).err().unwrap().message, OTHER_GLOBALS);
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
    for bad in ["é", "abc", "zz"] {
        let mut bytes = state.clone();
        bytes.0["state"]["buffers"] = json!([bad]);
        assert!(rt.resume(&bytes).is_err(), "{bad}");
    }
}

#[test]
fn a_run_resumes_with_the_globals_made_for_it_in_the_same_order() {
    let number = |n: f64| HostFunction::new(move |_, _| HostValue::Number(n));
    let gate = Gate::default();
    let g = gate.clone();
    // Each run gets its own choice of globals: `later` only for the run named "both".
    let rt = Runtime::make().globals(move |run| {
        let mut globals = vec![("step", step(Some(&g))), ("now", number(7.0))];
        if run.id() == "both" {
            globals.push(("later", number(8.0)));
        }
        globals
    });
    let code = format!("await step(1); {BUSY} return [now(), later(), typeof unused]");
    let (outcome, _) = background(rt.program(&code, &options("both")), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    let fewer = Runtime::make().globals(move |_| [("step", step(None)), ("now", number(7.0))]);
    let reordered = Runtime::make().globals(move |_| {
        [
            ("step", step(None)),
            ("later", number(8.0)),
            ("now", number(7.0)),
        ]
    });
    for refused in [fewer.resume(&state).err(), reordered.resume(&state).err()] {
        assert_eq!(refused.expect("refused").message, OTHER_GLOBALS);
    }
    let o = done(rt.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(o.result.unwrap(), json!([7, 8, "undefined"]));
}

#[test]
fn a_function_a_host_function_returned_is_lost_on_resume() {
    let globals = |gate: Option<Gate>| {
        move |_: &psychoscript::Run| {
            [
                ("step", step(gate.as_ref())),
                (
                    "make",
                    HostFunction::new(|_, _| {
                        HostValue::Function(
                            HostFunction::new(|args, _| {
                                HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0)
                            })
                            .named("inc"),
                        )
                    }),
                ),
            ]
        }
    };
    let gate = Gate::default();
    let rt = Runtime::make().globals(globals(Some(gate.clone())));
    let code = format!(
        "const inc = make(); const before = inc(1); await step(0); {BUSY} try {{ return {{ before, after: inc(1) }} }} catch (error) {{ return {{ before, error: String(error) }} }}"
    );
    let state = suspend_mid_loop(&rt, &gate, &code);
    let fresh = Runtime::make().globals(globals(None));
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
      await step(1)
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
    let state = suspend_mid_loop(&stepping(&gate), &gate, &code);
    let o = done(
        fresh()
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
      await step(1)
      {BUSY}
      await step(2)
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
    let rt = stepping(&gate);
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

#[test]
fn an_idempotent_call_in_flight_suspends_and_reruns_on_resume_with_the_same_key() {
    let gate = Gate::default();
    let keys = Arc::new(Mutex::new(Vec::new()));
    let (g, k) = (gate.clone(), keys.clone());
    let rt = Runtime::make().globals(move |_| {
        let (g, k) = (g.clone(), k.clone());
        [(
            "read",
            HostFunction::new_async(move |_, call| {
                k.lock().unwrap().push(call.key());
                let f = g.wait();
                async move { Ok(HostValue::from_json(&f.await)) }
            })
            .idempotent(),
        )]
    });
    let code = "const a = await read(20); const b = await read(22); return a + b";
    let (outcome, _) = background(rt.program(code, &options("rr")), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let state = suspended(outcome).state;
    assert_eq!(gate.dropped(), 1);
    assert_eq!(*keys.lock().unwrap(), ["rr:0"]);
    gate.reset();
    let (outcome, _) = background(rt.resume(&state).unwrap(), |_| {
        gate.entered(1);
        gate.open(json!(20));
        gate.entered(2);
        gate.open(json!(22));
    });
    assert_eq!(done(outcome).result.unwrap(), json!(42));
    assert_eq!(*keys.lock().unwrap(), ["rr:0", "rr:0", "rr:1"]);
}

/// A durable function over a job table that outlives any one run.
#[derive(Clone, Default)]
struct Jobs {
    log: Arc<Mutex<Vec<String>>>,
    cancelled: Arc<Mutex<Vec<String>>>,
    start_gate: Gate,
    result: Gate,
}

impl Jobs {
    fn function(&self, gated: bool) -> DurableFunction {
        let (start_log, wait_log, cancelled) =
            (self.log.clone(), self.log.clone(), self.cancelled.clone());
        let (start_gate, result) = (self.start_gate.clone(), self.result.clone());
        DurableFunction::new(
            move |args, call| {
                let key = call.key();
                start_log.lock().unwrap().push(format!("start {key}"));
                let wait = gated.then(|| start_gate.wait());
                let input = args
                    .first()
                    .and_then(HostValue::to_json)
                    .unwrap_or_default();
                async move {
                    if let Some(w) = wait {
                        w.await;
                    }
                    Ok(json!({ "job": key, "input": input }).into())
                }
            },
            move |data, call| {
                wait_log.lock().unwrap().push(format!(
                    "wait {} {}",
                    call.key(),
                    data.to_json()["job"].as_str().unwrap_or("")
                ));
                let f = result.wait();
                async move { Ok(HostValue::from_json(&f.await)) }
            },
            move |data, _| {
                cancelled
                    .lock()
                    .unwrap()
                    .push(data.to_json()["job"].as_str().unwrap_or("").to_owned());
                async {}
            },
        )
    }

    fn runtime(&self, gated: bool) -> Runtime {
        let jobs = self.clone();
        Runtime::make().globals(move |_| [("job", jobs.function(gated))])
    }
}

#[test]
fn a_durable_function_refuses_suspend_during_start_and_waits_on_its_data_on_resume() {
    let jobs = Jobs::default();
    let rt = jobs.runtime(true);
    let code = "const a = await job(41); return a + 1";
    let (outcome, during_start) = background(rt.program(code, &options("rec")), |s| {
        jobs.start_gate.entered(1);
        let refused = s.suspend(None).unwrap_err();
        jobs.start_gate.open(Json::Null);
        jobs.result.entered(1);
        let _ = s.suspend(None);
        refused
    });
    assert_eq!(during_start.running[0].key, "rec:0");
    assert_eq!(during_start.running[0].path, "job");
    let state = suspended(outcome).state;
    assert!(jobs.cancelled.lock().unwrap().is_empty());
    jobs.result.reset();
    let resumed = rt.resume_bytes(&psychoscript::to_bytes(&state)).unwrap();
    let (outcome, _) = background(resumed, |_| {
        jobs.result.entered(1);
        jobs.result.open(json!(41));
    });
    assert_eq!(
        *jobs.log.lock().unwrap(),
        ["start rec:0", "wait rec:0 rec:0", "wait rec:0 rec:0"]
    );
    assert_eq!(done(outcome).result.unwrap(), json!(42));
    assert!(jobs.cancelled.lock().unwrap().is_empty());
}

#[test]
fn a_durable_function_is_cancelled_when_the_run_ends_with_it_running_not_on_suspend() {
    let jobs = Jobs::default();
    let o = jobs
        .runtime(false)
        .execute_with(r#"job(1); return "left""#, &options("c"));
    assert_eq!(o.result.unwrap(), json!("left"));
    assert_eq!(*jobs.cancelled.lock().unwrap(), ["c:0"]);
}

fn response(url: &str) -> HostValue {
    let body = format!("body of {url}");
    HostValue::object([
        ("url", HostValue::from(url)),
        (
            "text",
            HostFunction::new(move |_, _| HostValue::from(body.clone()))
                .named("text")
                .into(),
        ),
    ])
}

#[test]
fn methods_on_a_returned_value_survive_with_snapshot_hooks() {
    let fetch = || {
        HostFunction::new(|args, _| response(args[0].as_str().unwrap_or("")))
            .length(1)
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
    let g = gate.clone();
    let rt = Runtime::make().globals(move |_| [("step", step(Some(&g))), ("fetch", fetch())]);
    let code = format!(
        r#"const res = fetch("https://a.test/"); await step(1); {BUSY} return [res.url, res.text()]"#
    );
    let state = suspend_mid_loop(&rt, &gate, &code);
    let fresh = Runtime::make().globals(move |_| [("step", step(None)), ("fetch", fetch())]);
    let o = done(fresh.resume(&state).unwrap().run_resumable().unwrap());
    assert_eq!(
        o.result.unwrap(),
        json!(["https://a.test/", "body of https://a.test/"])
    );
    // Without the function's hooks the state is refused.
    let bare = Runtime::make().globals(|_| {
        [
            ("step", step(None)),
            ("fetch", HostFunction::new(|_, _| HostValue::Null)),
        ]
    });
    assert_eq!(bare.resume(&state).err().unwrap().message, OTHER_GLOBALS);
}

#[test]
fn a_suspend_fails_when_an_encode_hook_fails_and_the_run_goes_on() {
    let gate = Gate::default();
    let g = gate.clone();
    let rt = Runtime::make().globals(move |_| {
        [
            ("step", step(Some(&g))),
            (
                "make",
                HostFunction::new(|_, _| {
                    HostValue::object([(
                        "f",
                        HostFunction::new(|_, _| HostValue::Number(1.0)).into(),
                    )])
                })
                .snapshot(|_| Err(HostError::new("no")), |v| v),
            ),
        ]
    });
    let code = format!("const v = make(); await step(1); {BUSY} return v.f()");
    let (outcome, error) = background(rt.program(&code, &ProgramOptions::new()), |s| {
        gate.entered(1);
        suspend_soon(&s, None)
    });
    let error = error.unwrap_err();
    assert!(error.running.is_empty());
    assert_eq!(
        error.message,
        "The run's state couldn't be saved: The host function make couldn't save a value it returned: no"
    );
    assert_eq!(done(outcome).result.unwrap(), json!(1));
}
