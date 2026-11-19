//! A run driven as a future moves long stretches of compute to a worker thread; host code never runs there.

use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll, Waker};
use std::thread::{self, ThreadId};
use std::time::{Duration, Instant};

use psychoscript::{
    Data, DurableFunction, HostFunction, HostString, HostValue, HttpBody, Namespace,
    ProgramOptions, Returned, RunOutcome, Runtime, StreamingResponse,
};
use serde_json::json;

/// Counts the host code that ran, and how much of it ran off the thread that drives the run.
#[derive(Clone)]
struct Witness {
    driver: ThreadId,
    ran: Arc<AtomicUsize>,
    strays: Arc<AtomicUsize>,
}

impl Witness {
    fn new() -> Self {
        Self {
            driver: thread::current().id(),
            ran: Arc::default(),
            strays: Arc::default(),
        }
    }

    fn check(&self) {
        self.ran.fetch_add(1, Ordering::SeqCst);
        if thread::current().id() != self.driver {
            self.strays.fetch_add(1, Ordering::SeqCst);
        }
    }
}

fn first(args: Vec<HostValue>) -> HostValue {
    args.into_iter().next().unwrap_or_default()
}

/// Every kind of host code a program can reach, each noting where it runs: synchronous functions, one blocking the
/// program on work and one leaving work pending, an asynchronous function, a durable one, and a namespace.
fn runtime(w: &Witness) -> Runtime {
    let w = w.clone();
    Runtime::make().globals(move |_| {
        let (a, b, c, d, e, f) = (
            w.clone(),
            w.clone(),
            w.clone(),
            w.clone(),
            w.clone(),
            w.clone(),
        );
        let (start, wait) = (w.clone(), w.clone());
        let (keys, resolve) = (w.clone(), w.clone());
        vec![
            (
                "sync",
                HostValue::from(HostFunction::new(move |args, _| {
                    a.check();
                    Ok::<_, HostValue>(first(args))
                })),
            ),
            (
                "slow",
                HostFunction::new_async(move |args, _| {
                    let b = b.clone();
                    async move {
                        b.check();
                        Ok(later(5, first(args)).await)
                    }
                })
                .into(),
            ),
            (
                "block",
                HostFunction::new(move |args, _| {
                    c.check();
                    let c = c.clone();
                    Returned::Block(Box::pin(async move {
                        c.check();
                        Ok(later(5, first(args)).await)
                    }))
                })
                .into(),
            ),
            (
                "pending",
                HostFunction::new(move |args, _| {
                    d.check();
                    let d = d.clone();
                    Returned::Pending(Box::pin(async move {
                        d.check();
                        Ok(first(args))
                    }))
                })
                .into(),
            ),
            (
                "durable",
                DurableFunction::new(
                    move |_, _| {
                        let start = start.clone();
                        async move {
                            start.check();
                            Ok(Data::Null)
                        }
                    },
                    move |_, _| {
                        let wait = wait.clone();
                        async move {
                            wait.check();
                            Ok(HostValue::Number(7.0))
                        }
                    },
                    |_, _| async {},
                )
                .into(),
            ),
            (
                "ns",
                Namespace::new(
                    move |_| {
                        keys.check();
                        Ok(vec![HostString::from("f")])
                    },
                    move |_| {
                        resolve.check();
                        let e = e.clone();
                        HostFunction::new(move |args, _| {
                            e.check();
                            Ok::<_, HostValue>(first(args))
                        })
                    },
                )
                .into(),
            ),
            (
                "spare",
                HostFunction::new(move |_, _| {
                    f.check();
                    Ok::<_, HostValue>(HostValue::Undefined)
                })
                .into(),
            ),
        ]
    })
}

/// Each host call follows a stretch of compute long enough to move to the worker.
const BUSY_THEN_HOST: &str = "
    const spin = (k) => { let n = 0; for (let i = 0; i < k; i++) n += i % 7; return n > 0 }
    const a = spin(2e6) && sync(1)
    const b = spin(2e6) && await slow(2)
    const c = spin(2e6) && block(3)
    const d = spin(2e6) && await pending(4)
    const e = spin(2e6) && await durable()
    const f = spin(2e6) && ns.f(5)
    const g = spin(2e6) && Object.keys(ns).length
    const h = spin(2e6) && await Promise.all([slow(6), sync(7)])
    return [a, b, c, d, e, f, g, h, spin(1e6)]";

#[test]
fn long_compute_leaves_the_executor_while_host_code_stays_on_it() {
    let w = Witness::new();
    let rt = runtime(&w);
    let options = ProgramOptions::new();
    let expected = json!([1, 2, 3, 4, 7, 5, 1, [6, 7], true]);
    let started = Instant::now();
    let blocking = rt.execute(BUSY_THEN_HOST);
    let whole = started.elapsed();
    assert_eq!(blocking.json().unwrap(), expected);
    let ran_blocking = w.ran.swap(0, Ordering::SeqCst);

    let mut run = Box::pin(rt.execute_async(BUSY_THEN_HOST, &options));
    let started = Instant::now();
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
    );
    assert!(
        started.elapsed() < whole / 4,
        "the first poll held the executor for {:?} of {whole:?}",
        started.elapsed()
    );
    let outcome = drive(run).unwrap();
    assert_eq!(outcome.json().unwrap(), expected);
    assert_eq!(w.ran.load(Ordering::SeqCst), ran_blocking);
    assert_eq!(w.strays.load(Ordering::SeqCst), 0);
}

/// A future that never ends and notes the thread it is dropped on.
struct Forever(Arc<Mutex<Option<ThreadId>>>);

impl Future for Forever {
    type Output = Result<HostValue, HostValue>;

    fn poll(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Self::Output> {
        Poll::Pending
    }
}

impl Drop for Forever {
    fn drop(&mut self) {
        *self.0.lock().unwrap() = Some(thread::current().id());
    }
}

#[test]
fn dropping_a_run_away_on_its_worker_ends_it_here() {
    let dropped = Arc::new(Mutex::new(None));
    let seen = dropped.clone();
    let rt = Runtime::make().globals(move |_| {
        let seen = seen.clone();
        [(
            "never",
            HostFunction::new_async(move |_, _| Forever(seen.clone())),
        )]
    });
    let options = ProgramOptions::new();
    let mut run = Box::pin(rt.execute_async("never(); while (true) {}", &options));
    let waker = Waker::noop();
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(waker))
            .is_pending()
    );
    thread::sleep(Duration::from_millis(10));
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(waker))
            .is_pending()
    );
    drop(run);
    assert_eq!(*dropped.lock().unwrap(), Some(thread::current().id()));
}

#[test]
fn a_run_away_on_its_worker_suspends_and_resumes() {
    let rt = Runtime::make();
    let code = "let n = 0; for (let i = 0; i < 2e9; i++) n++; return n > 0";
    let program = rt.program(code, &ProgramOptions::new());
    let suspender = program.suspender();
    let mut run = Box::pin(program.run_resumable_async());
    assert!(
        run.as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending()
    );
    let asked = thread::spawn(move || suspender.suspend(None));
    let outcome = drive(run).unwrap();
    let answer = asked.join().unwrap().unwrap();
    let (RunOutcome::Suspended(state), RunOutcome::Suspended(_)) = (outcome, answer) else {
        panic!("expected a suspended run");
    };
    assert!(rt.resume(&state.state).is_ok());
}

/// A body whose `cancel` notes where it ran.
struct Cancelled(Witness);

impl HttpBody for Cancelled {
    fn poll_chunk(&mut self, _: &mut Context<'_>) -> Poll<Option<Result<Vec<u8>, HostValue>>> {
        Poll::Ready(None)
    }

    fn cancel(&mut self, _: HostValue) {
        self.0.check();
    }
}

#[test]
fn a_body_cancelled_while_its_run_is_on_a_worker_cancels_on_the_executor() {
    let w = Witness::new();
    let body = w.clone();
    let rt = Runtime::make().globals(move |_| {
        let body = body.clone();
        [(
            "fetch",
            HostFunction::new_async(move |_, _| {
                let body = Cancelled(body.clone());
                async move {
                    Ok(HostValue::Response(StreamingResponse::new(
                        200,
                        Some(Box::new(body) as Box<dyn HttpBody>),
                    )))
                }
            }),
        )]
    });
    // A loop long enough to move to the worker, then a cancel queued there, which starts when the program next looks
    // at the body after the run has handed calls over: at the `bodyUsed` getter, still on the worker.
    let code = "const r = await fetch(); let n = 0
        for (let i = 0; i < 3e6; i++) n += i % 3
        r.body.cancel('stop')
        for (let i = 0; i < 1e5; i++) n += i % 3
        return r.bodyUsed && n > 0";
    let outcome = drive(rt.execute_async(code, &ProgramOptions::new())).unwrap();
    assert_eq!(outcome.json().unwrap(), json!(true));
    assert_eq!(w.ran.load(Ordering::SeqCst), 1);
    assert_eq!(w.strays.load(Ordering::SeqCst), 0);
}

/// A value that arrives after `ms` from another thread: an asynchronous host operation without an executor.
fn later<T: Send + 'static>(ms: u64, value: T) -> impl Future<Output = T> {
    let state = Arc::new(Mutex::new((None, None::<Waker>)));
    let shared = state.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(ms));
        let mut s = shared.lock().unwrap();
        s.0 = Some(value);
        if let Some(w) = s.1.take() {
            w.wake();
        }
    });
    std::future::poll_fn(move |cx| {
        let mut s = state.lock().unwrap();
        match s.0.take() {
            Some(v) => Poll::Ready(v),
            None => {
                s.1 = Some(cx.waker().clone());
                Poll::Pending
            }
        }
    })
}

/// Polls a future to its end on this thread, parking until it is woken.
fn drive<F: Future>(future: F) -> F::Output {
    struct Unpark(thread::Thread);
    impl std::task::Wake for Unpark {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let waker = Waker::from(Arc::new(Unpark(thread::current())));
    let mut cx = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    loop {
        if let Poll::Ready(v) = future.as_mut().poll(&mut cx) {
            return v;
        }
        thread::park();
    }
}
