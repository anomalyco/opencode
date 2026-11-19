//! The language layer on its own: host functions, namespaces, failures, per-run state and translation, mirroring the
//! reference's `test/language.test.ts`.

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::Duration;

use psychoscript::{
    DurableFunction, Failure, HostFunction, HostString, HostValue, Json, Limits, Namespace,
    Outcome, ProgramOptions, Returned, RunOutcome, Runtime, Translate, TranslateFunctions,
    TranslatePromises, to_bytes,
};
use serde_json::json;

fn value(rt: &Runtime, code: &str) -> Json {
    match rt.execute(code).result {
        Ok(v) => v.to_json(),
        Err(e) => panic!("expected success, got {}: {}", e.kind, e.message),
    }
}

fn error(rt: &Runtime, code: &str) -> psychoscript::Diagnostic {
    match rt.execute(code).result {
        Ok(v) => panic!("expected a failure, got {v}"),
        Err(e) => e,
    }
}

fn num(v: &HostValue) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}

/// A latch the test opens by hand: a future that waits for it, and a way to wait until a call reached it.
#[derive(Clone, Default)]
struct Latch(Arc<(Mutex<LatchState>, Condvar)>);

#[derive(Default)]
struct LatchState {
    value: Option<HostValue>,
    reached: usize,
    wakers: Vec<Waker>,
}

impl Latch {
    /// Marks that a call reached the latch, and waits for it to open.
    fn wait(&self) -> LatchFuture {
        let (m, c) = &*self.0;
        m.lock().unwrap().reached += 1;
        c.notify_all();
        LatchFuture(self.clone())
    }

    fn open(&self, v: HostValue) {
        let (m, c) = &*self.0;
        let mut s = m.lock().unwrap();
        s.value = Some(v);
        for w in s.wakers.drain(..) {
            w.wake();
        }
        c.notify_all();
    }

    /// Waits until a call reached the latch.
    fn reached(&self) {
        let (m, c) = &*self.0;
        let mut s = m.lock().unwrap();
        while s.reached == 0 {
            s = c.wait_timeout(s, Duration::from_millis(10)).unwrap().0;
        }
    }
}

struct LatchFuture(Latch);

impl Future for LatchFuture {
    type Output = HostValue;
    fn poll(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<HostValue> {
        let mut s = (self.0).0.0.lock().unwrap();
        match &s.value {
            Some(v) => Poll::Ready(v.clone()),
            None => {
                s.wakers.push(cx.waker().clone());
                Poll::Pending
            }
        }
    }
}

/// A future that never completes.
fn never() -> std::future::Pending<psychoscript::HostResult> {
    std::future::pending()
}

/// Runs `code` on another thread, waits until `reached` was reached, and suspends it: the suspend's answer, and what
/// the run returned. When the suspend fails, `after` lets the run go on to its end.
fn suspend_at(
    rt: &Runtime,
    code: &str,
    options: &ProgramOptions,
    reached: &Latch,
    after: impl FnOnce(),
) -> (Result<RunOutcome, psychoscript::SuspendError>, RunOutcome) {
    std::thread::scope(|s| {
        let (tx, rx) = std::sync::mpsc::channel();
        let running = s.spawn(move || {
            let program = rt.program(code, options);
            tx.send(program.suspender()).unwrap();
            program.run_resumable().unwrap()
        });
        let suspender = rx.recv().unwrap();
        reached.reached();
        let answer = suspender.suspend(None);
        if answer.is_err() {
            after();
        }
        (answer, running.join().unwrap())
    })
}

fn suspended(o: RunOutcome) -> psychoscript::Suspended {
    match o {
        RunOutcome::Suspended(s) => s,
        RunOutcome::Done(o) => panic!("expected a suspended run, got {:?}", o.result),
    }
}

fn done(o: RunOutcome) -> Outcome {
    match o {
        RunOutcome::Done(o) => o,
        RunOutcome::Suspended(_) => panic!("expected the run to end"),
    }
}

// ---------- Host.fn ----------

#[test]
fn a_sync_function_returns_its_value_or_its_pending_work_as_a_promise() {
    let rt = Runtime::make().globals(|_| {
        [
            (
                "double",
                HostFunction::new(|args, _| HostValue::Number(num(&args[0]) * 2.0)),
            ),
            (
                "later",
                HostFunction::new(|args, _| {
                    let n = num(&args[0]);
                    Returned::Pending(Box::pin(async move { Ok(HostValue::Number(n + 1.0)) }))
                }),
            ),
        ]
    });
    assert_eq!(
        value(
            &rt,
            "const a = double(2); const b = later(a); return [a, b instanceof Promise, await b, typeof double]"
        ),
        json!([4, true, 5, "function"])
    );
}

#[test]
fn an_async_function_hands_the_program_a_promise() {
    let rt = Runtime::make().globals(|_| {
        [(
            "load",
            HostFunction::new_async(|args, _| async move { Ok(args[0].clone()) }),
        )]
    });
    assert_eq!(
        value(
            &rt,
            "const p = load(1); return [p instanceof Promise, await p]"
        ),
        json!([true, 1])
    );
}

#[test]
fn a_sync_thenable_result_can_be_used_directly_awaited_or_chained() {
    let rt = Runtime::make().globals(|_| {
        [(
            "find",
            HostFunction::new(|_, _| {
                HostValue::object([("items", HostValue::array([1.0.into(), 2.0.into()]))])
            })
            .thenable(),
        )]
    });
    assert_eq!(
        value(
            &rt,
            "return [find().items.length, (await find()).items.length, await find().then((r) => r.items[1]), Object.keys(find())]"
        ),
        json!([2, 2, 2, ["items"]])
    );
}

#[test]
fn every_call_gets_its_key() {
    let keys = Arc::new(Mutex::new(Vec::new()));
    let seen = keys.clone();
    let rt = Runtime::make().globals(move |_| {
        let seen = seen.clone();
        [(
            "note",
            HostFunction::new(move |_, call| {
                seen.lock().unwrap().push(call.key());
                HostValue::Undefined
            }),
        )]
    });
    rt.program("note(); note()", &ProgramOptions::new().run_id("r"))
        .run()
        .unwrap();
    assert_eq!(*keys.lock().unwrap(), ["r:0", "r:1"]);
}

#[test]
fn arguments_and_results_cross_as_structured_copies() {
    let seen = Arc::new(Mutex::new(None));
    let kept = seen.clone();
    let rt = Runtime::make().globals(move |_| {
        let kept = kept.clone();
        [(
            "keep",
            HostFunction::new(move |args, _| {
                *kept.lock().unwrap() = Some(args[0].clone());
                HostValue::object([
                    ("when", HostValue::Date(0.0)),
                    ("tags", HostValue::Set(vec!["a".into()])),
                    (
                        "read",
                        HostFunction::new(|_, _| HostValue::from("called")).into(),
                    ),
                ])
            }),
        )]
    });
    assert_eq!(
        value(
            &rt,
            r#"const r = keep({ at: new Date(5), m: new Map([["k", 1]]) }); return [r.when.getTime(), r.tags.has("a"), r.read()]"#
        ),
        json!([0, true, "called"])
    );
    let seen = seen.lock().unwrap().clone().unwrap();
    assert!(matches!(seen.get("at"), Some(HostValue::Date(t)) if *t == 5.0));
    assert!(
        matches!(seen.get("m"), Some(HostValue::Map(m)) if m.len() == 1 && m[0].0.as_str() == Some("k") && m[0].1.as_f64() == Some(1.0))
    );
}

#[test]
fn a_function_inside_a_result_crosses_back_as_itself_only_to_a_function_that_takes_functions() {
    let rt = Runtime::make().globals(|_| {
        [
            (
                "open",
                HostFunction::new(|_, _| {
                    HostValue::object([(
                        "read",
                        HostFunction::new(|_, _| HostValue::from("called"))
                            .named("read")
                            .into(),
                    )])
                }),
            ),
            (
                "takes",
                HostFunction::new(|args, _| {
                    let read = args[0].get("read");
                    HostValue::Bool(
                        matches!(read, Some(HostValue::Function(f)) if f.name() == "read"),
                    )
                })
                .takes_functions(),
            ),
            ("refuses", HostFunction::new(|_, _| HostValue::Bool(true))),
        ]
    });
    assert_eq!(
        value(&rt, "return takes({ read: open().read })"),
        json!(true)
    );
    for code in ["refuses(open().read)", "takes(takes)", "takes(() => 1)"] {
        let e = error(&rt, code);
        assert!(
            e.message_lossy()
                .contains("contains a function, which cannot be passed to the host"),
            "{code}: {}",
            e.message
        );
    }
}

#[test]
fn a_constructible_function_is_called_by_new_and_gives_what_it_returns() {
    let rt = Runtime::make().globals(|_| {
        [
            (
                "Box",
                HostFunction::new(|args, _| HostValue::object([("item", args[0].clone())]))
                    .constructible(),
            ),
            (
                "Later",
                HostFunction::new(|args, _| {
                    let item = args[0].clone();
                    Returned::Pending(Box::pin(
                        async move { Ok(HostValue::object([("item", item)])) },
                    ))
                })
                .constructible(),
            ),
            ("plain", HostFunction::new(|_, _| HostValue::Number(1.0))),
        ]
    });
    assert_eq!(
        value(
            &rt,
            "return [new Box(1).item, (await new Later(2)).item, (await new Later(...[3])).item]"
        ),
        json!([1, 2, 3])
    );
    assert!(rt.execute("new plain()").result.is_err());
}

#[test]
#[should_panic(expected = "idempotent applies only to async functions")]
fn idempotent_applies_only_to_async_functions() {
    assert!(
        HostFunction::new_async(|_, _| async { Ok(HostValue::Undefined) })
            .idempotent()
            .is_idempotent()
    );
    let _ = HostFunction::new(|_, _| HostValue::Undefined).idempotent();
}

// ---------- Host.namespace and Host.fail ----------

fn api_runtime() -> Runtime {
    Runtime::make().globals(|_| {
        [
            (
                "api",
                HostValue::from(Namespace::new(
                    |path| {
                        Ok(match path.len() {
                            0 => vec!["issues".into()],
                            _ => vec!["list".into()],
                        })
                    },
                    |path| -> psychoscript::Resolved {
                        if path
                            .iter()
                            .map(|k| k.to_string())
                            .collect::<Vec<_>>()
                            .join(".")
                            == "issues.list"
                        {
                            return HostFunction::new_async(|_, _| async {
                                Ok(HostValue::array(["#1".into()]))
                            })
                            .into();
                        }
                        Failure::missing(format!(
                            "No api.{}",
                            path.iter()
                                .map(|k| k.to_string())
                                .collect::<Vec<_>>()
                                .join(".")
                        ))
                        .suggestions(["Try api.issues.list."])
                        .kind("NotFound")
                        .into()
                    },
                )),
            ),
            (
                "refuse",
                HostFunction::new(|_, _| -> psychoscript::HostResult {
                    Err(Failure::new("Refused", "Not today")
                        .suggestions(["Ask again."])
                        .into())
                })
                .into(),
            ),
        ]
    })
}

#[test]
fn a_namespace_is_a_lazy_path_addressed_object_of_functions() {
    assert_eq!(
        value(
            &api_runtime(),
            "return [await api.issues.list(), Object.keys(api), Object.keys(api.issues), typeof api.x]"
        ),
        json!([["#1"], ["issues"], ["list"], "function"])
    );
}

#[test]
fn a_missing_function_and_a_host_failure_keep_their_kind_and_suggestions() {
    let rt = api_runtime();
    let e = error(&rt, "return api.issues.nope()");
    assert_eq!(
        (e.kind.name(), e.message_lossy(), e.suggestions_lossy()),
        (
            "NotFound",
            "No api.issues.nope".to_owned(),
            vec!["Try api.issues.list.".to_owned()]
        )
    );
    let e = error(&rt, "refuse()");
    assert_eq!(
        (e.kind.name(), e.message_lossy(), e.suggestions_lossy()),
        (
            "Refused",
            "Not today".to_owned(),
            vec!["Ask again.".to_owned()]
        )
    );
}

// ---------- per-run state ----------

#[test]
fn run_metadata_is_the_results_and_a_resumed_run_gets_it_back_with_fresh_globals() {
    let gate = Latch::default();
    let made = Arc::new(Mutex::new(0));
    let (g, m) = (gate.clone(), made.clone());
    let rt = Runtime::make().globals(move |run| {
        *m.lock().unwrap() += 1;
        if run.metadata().is_null() {
            run.set_metadata(json!({ "count": 0 }));
        }
        let (counting, g) = (run.clone(), g.clone());
        [
            (
                "count",
                HostFunction::new(move |_, _| {
                    counting.update_metadata(|m| {
                        let mut j = m.to_json();
                        let n = j["count"].as_f64().unwrap_or(0.0) + 1.0;
                        j["count"] = json!(n as i64);
                        *m = j.into();
                        HostValue::Number(n)
                    })
                }),
            ),
            (
                "wait",
                HostFunction::new_async(move |_, _| {
                    let wait = g.wait();
                    async move { Ok(wait.await) }
                })
                .idempotent(),
            ),
        ]
    });
    let (answer, ran) = suspend_at(
        &rt,
        "count(); count(); await wait(); return count()",
        &ProgramOptions::new().run_id("m"),
        &gate,
        || {},
    );
    let suspended = suspended(ran);
    assert_eq!(self::suspended(answer.unwrap()).state, suspended.state);
    assert_eq!(
        suspended.state.0["header"]["metadata"],
        json!({ "count": 2 })
    );
    gate.open(HostValue::Undefined);
    let outcome = done(
        rt.resume_bytes(&to_bytes(&suspended.state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(outcome.result.unwrap(), json!(3));
    assert_eq!(outcome.metadata, json!({ "count": 3 }));
    // Made at the start and at the resume (and at every step in the round-trip test mode).
    assert!(*made.lock().unwrap() >= 2);
}

#[test]
fn a_suspend_fails_while_a_call_that_isnt_idempotent_runs() {
    let called = Latch::default();
    let c = called.clone();
    let rt = Runtime::make().globals(move |_| {
        let c = c.clone();
        [(
            "slow",
            HostFunction::new_async(move |_, _| {
                let wait = c.wait();
                async move { Ok(wait.await) }
            }),
        )]
    });
    let (answer, ran) = suspend_at(&rt, "await slow()", &ProgramOptions::new(), &called, || {
        called.open(HostValue::Undefined)
    });
    let error = answer.unwrap_err();
    assert_eq!(
        error
            .running
            .iter()
            .map(|c| c.path.as_str())
            .collect::<Vec<_>>(),
        ["slow"]
    );
    assert!(done(ran).result.is_ok());
}

#[test]
fn a_suspend_fails_while_a_call_holds_a_host_function_even_an_idempotent_one() {
    let called = Latch::default();
    let c = called.clone();
    let rt = Runtime::make().globals(move |_| {
        let c = c.clone();
        [
            (
                "open",
                HostFunction::new(|_, _| {
                    HostValue::object([(
                        "read",
                        HostFunction::new(|_, _| HostValue::from("called")).into(),
                    )])
                }),
            ),
            (
                "slow",
                HostFunction::new_async(move |_, _| {
                    let wait = c.wait();
                    async move { Ok(wait.await) }
                })
                .idempotent()
                .takes_functions(),
            ),
        ]
    });
    let (answer, ran) = suspend_at(
        &rt,
        "await slow(open().read)",
        &ProgramOptions::new(),
        &called,
        || called.open(HostValue::Undefined),
    );
    let error = answer.unwrap_err();
    assert_eq!(
        error
            .running
            .iter()
            .map(|c| c.path.as_str())
            .collect::<Vec<_>>(),
        ["slow"]
    );
    assert!(done(ran).result.is_ok());
}

#[test]
fn a_durable_function_keeps_running_across_a_suspend_and_is_waited_on_again() {
    let jobs: Arc<Mutex<Vec<(String, Latch)>>> = Arc::default();
    let waiting = Latch::default();
    let (j, w) = (jobs.clone(), waiting.clone());
    let rt = Runtime::make().globals(move |_| {
        let (started, waited, w) = (j.clone(), j.clone(), w.clone());
        [(
            "job",
            DurableFunction::new(
                move |_, call| {
                    let key = call.key();
                    started
                        .lock()
                        .unwrap()
                        .push((key.clone(), Latch::default()));
                    async move { Ok(key.into()) }
                },
                move |key, _| {
                    let latch = waited
                        .lock()
                        .unwrap()
                        .iter()
                        .find(|(k, _)| key.as_string().is_some_and(|s| s == k))
                        .map(|(_, l)| l.clone())
                        .unwrap();
                    let reached = w.wait();
                    async move {
                        drop(reached);
                        Ok(latch.wait().await)
                    }
                },
                |_, _| async {},
            ),
        )]
    });
    // Suspended in `wait`, so the call is started and its data saved.
    let (answer, ran) = suspend_at(
        &rt,
        "return (await job()) + 1",
        &ProgramOptions::new().run_id("d"),
        &waiting,
        || {},
    );
    answer.unwrap();
    let suspended = suspended(ran);
    let latch = jobs.lock().unwrap()[0].1.clone();
    assert_eq!(jobs.lock().unwrap()[0].0, "d:0");
    latch.open(HostValue::Number(41.0));
    let outcome = done(
        rt.resume(&suspended.state)
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(outcome.result.unwrap(), json!(42));
}

// ---------- translate ----------

type Calls = Arc<Mutex<Vec<Vec<HostValue>>>>;

fn translating(translate: Translate, limits: Limits) -> (Runtime, Calls) {
    let calls: Calls = Arc::default();
    let kept = calls.clone();
    let rt = Runtime::make()
        .translate(translate)
        .limits(limits)
        .globals(move |_| {
            let (keep, send) = (kept.clone(), kept.clone());
            [
                (
                    "keep",
                    HostFunction::new(move |args, _| {
                        keep.lock().unwrap().push(args);
                        HostValue::Undefined
                    }),
                ),
                (
                    "send",
                    HostFunction::new_async(move |args, _| {
                        send.lock().unwrap().push(args);
                        async { Ok(HostValue::Undefined) }
                    }),
                ),
                (
                    "later",
                    HostFunction::new_async(|args, _| async move { Ok(args[0].clone()) }),
                ),
                ("never", HostFunction::new_async(|_, _| never())),
            ]
        });
    (rt, calls)
}

fn json_of(calls: &Calls) -> Json {
    Json::Array(
        calls
            .lock()
            .unwrap()
            .iter()
            .map(|args| {
                Json::Array(
                    args.iter()
                        .map(|a| a.to_json().unwrap_or(json!("undefined")))
                        .collect(),
                )
            })
            .collect(),
    )
}

#[test]
fn by_default_a_function_or_a_promise_inside_an_argument_fails_the_call() {
    let (strict, _) = translating(Translate::default(), Limits::default());
    for (code, message) in [
        (
            "keep({ f() {} })",
            "Argument 1 to keep contains a function, which cannot be passed to the host.",
        ),
        (
            "keep([Promise.resolve(1)])",
            "Argument 1 to keep contains an un-awaited Promise, which cannot be passed",
        ),
        (
            "await send(() => 1)",
            "Argument 1 to send contains a function",
        ),
    ] {
        let e = error(&strict, code);
        assert!(e.message_lossy().contains(message), "{code}: {}", e.message);
    }
}

#[test]
fn functions_drop_leaves_functions_out_as_json_stringify_does() {
    let (rt, calls) = translating(
        Translate {
            functions: TranslateFunctions::Drop,
            ..Translate::default()
        },
        Limits::default(),
    );
    value(
        &rt,
        r#"keep({ q: "x", format(v) { return v }, nested: { f: Math.max } }, [1, () => 2, keep], () => 3, new Map([["k", () => 1]]))"#,
    );
    let args = calls.lock().unwrap()[0].clone();
    assert_eq!(args[0].to_json(), Some(json!({ "q": "x", "nested": {} })));
    assert_eq!(args[1].to_json(), Some(json!([1, null, null])));
    assert!(matches!(args[2], HostValue::Undefined));
    assert!(
        matches!(&args[3], HostValue::Map(m) if m.len() == 1 && matches!(m[0].1, HostValue::Undefined))
    );
    let e = error(&rt, "keep({ p: Promise.resolve(1) })");
    assert!(
        e.message_lossy().contains("un-awaited Promise"),
        "{}",
        e.message
    );
}

#[test]
fn promises_await_waits_for_every_promise_inside_the_arguments_and_uses_its_value() {
    let (rt, calls) = translating(
        Translate {
            promises: TranslatePromises::Await,
            ..Translate::default()
        },
        Limits::default(),
    );
    assert_eq!(
        value(
            &rt,
            r#"
              const slow = (async () => { await null; await null; return "slow" })()
              const a = keep({ n: Promise.resolve(5), list: [later(1), slow] }, later({ deep: later(2) }))
              const b = await send(slow, new Promise((resolve) => resolve(later(3))))
              return [a, b]
            "#
        ),
        json!([null, null])
    );
    assert_eq!(
        json_of(&calls),
        json!([[{ "n": 5, "list": [1, "slow"] }, { "deep": 2 }], ["slow", 3]])
    );
    let e = error(&rt, "keep({ f() {} })");
    assert!(
        e.message_lossy().contains("contains a function"),
        "{}",
        e.message
    );
}

#[test]
fn promises_await_fails_the_call_with_a_rejections_reason() {
    let (rt, calls) = translating(
        Translate {
            promises: TranslatePromises::Await,
            ..Translate::default()
        },
        Limits::default(),
    );
    assert_eq!(
        value(
            &rt,
            r#"
              const failing = () => Promise.reject(new RangeError("nope"))
              let thrown
              try { keep({ n: failing() }) } catch (error) { thrown = error }
              const sent = send([later(1), failing()])
              return [thrown instanceof RangeError, thrown.message, sent instanceof Promise, await sent.catch((e) => e.message)]
            "#
        ),
        json!([true, "nope", true, "nope"])
    );
    assert!(calls.lock().unwrap().is_empty());
}

#[test]
fn promises_await_waits_on_a_promise_that_never_settles_until_the_timeout() {
    let (rt, _) = translating(
        Translate {
            promises: TranslatePromises::Await,
            ..Translate::default()
        },
        Limits {
            timeout_ms: Some(50),
            ..Limits::default()
        },
    );
    assert_eq!(
        error(&rt, "keep({ n: never() })").kind.name(),
        "TimeoutExceeded"
    );
}

#[test]
fn promises_await_keeps_waiting_across_a_suspend() {
    let gate = Latch::default();
    let calls: Calls = Arc::default();
    let (g, kept) = (gate.clone(), calls.clone());
    let rt = Runtime::make()
        .translate(Translate {
            promises: TranslatePromises::Await,
            ..Translate::default()
        })
        .globals(move |_| {
            let (g, kept) = (g.clone(), kept.clone());
            [
                (
                    "keep",
                    HostFunction::new(move |args, _| {
                        kept.lock().unwrap().push(args);
                        HostValue::from("kept")
                    }),
                ),
                (
                    "slow",
                    HostFunction::new_async(move |_, _| {
                        let wait = g.wait();
                        async move { Ok(wait.await) }
                    })
                    .idempotent(),
                ),
            ]
        });
    let (answer, ran) = suspend_at(
        &rt,
        "return [keep({ n: slow() }), await slow()]",
        &ProgramOptions::new(),
        &gate,
        || {},
    );
    answer.unwrap();
    let suspended = suspended(ran);
    assert!(calls.lock().unwrap().is_empty());
    gate.open(HostValue::Number(7.0));
    let outcome = done(
        rt.resume(&suspended.state)
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(outcome.result.unwrap(), json!(["kept", 7]));
    assert_eq!(json_of(&calls), json!([[{ "n": 7 }]]));
}

#[test]
fn metadata_and_durable_data_keep_unpaired_surrogates_across_a_suspend() {
    let lone = HostString::from_utf16(&[u16::from(b'a'), 0xd800]);
    let waiting = Latch::default();
    let (w, kept) = (waiting.clone(), lone.clone());
    let seen: Arc<Mutex<Vec<psychoscript::Data>>> = Arc::default();
    let saw = seen.clone();
    let rt = Runtime::make().globals(move |run| {
        let (run, w, kept, saw) = (run.clone(), w.clone(), kept.clone(), saw.clone());
        [
            (
                "remember",
                HostValue::from(HostFunction::new(move |args, _| {
                    run.set_metadata(psychoscript::Data::String(
                        args[0].as_host_string().unwrap(),
                    ));
                    HostValue::Undefined
                })),
            ),
            (
                "job",
                DurableFunction::new(
                    move |_, _| {
                        let data = psychoscript::Data::String(kept.clone());
                        async move { Ok(data) }
                    },
                    move |data, _| {
                        saw.lock().unwrap().push(data.clone());
                        let wait = w.wait();
                        async move { Ok(wait.await) }
                    },
                    |_, _| async {},
                )
                .into(),
            ),
        ]
    });
    let (answer, ran) = suspend_at(
        &rt,
        r#"remember("a\ud800"); return await job()"#,
        &ProgramOptions::new(),
        &waiting,
        || {},
    );
    answer.unwrap();
    let state = suspended(ran).state;
    waiting.open(HostValue::Number(1.0));
    let outcome = done(
        rt.resume_bytes(&to_bytes(&state))
            .unwrap()
            .run_resumable()
            .unwrap(),
    );
    assert_eq!(outcome.metadata, psychoscript::Data::String(lone.clone()));
    assert_eq!(
        *seen.lock().unwrap(),
        vec![psychoscript::Data::String(lone.clone()); 2]
    );
}
