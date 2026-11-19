//! One run of a program, the counterpart of the reference's `runtime.program(...)`: nothing runs until it is driven,
//! and it is driven to its end, or to a suspend, on the calling thread or as a future.

use std::borrow::Cow;
use std::fmt;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::task::{Context, Poll, Waker};
use std::time::{Duration, Instant};

use crate::exec;
use crate::offload;
use crate::run;
use crate::runtime::ProgramOptions;
use crate::snapshot::{self, Refusal, Snapshot};
use crate::vm::Vm;
use crate::{Interrupted, Outcome, Runtime};

enum State {
    Running(Box<Running>),
    /// Computing on the program's worker thread.
    Away,
    /// It ended before running: the program did not compile.
    Failed(Box<Outcome>),
    Done,
}

pub(crate) struct Running {
    pub vm: Vm,
    pub code: String,
    started: bool,
    timer_armed: bool,
    /// Active time earlier runs of the same execution used, before a resume.
    pub active_before: Duration,
    /// Back-edges until the next round trip, in the round-trip test mode.
    round_trip_every: u32,
    /// Round trips still to skip after one that saved a large state.
    skip: u32,
}

/// How a run ended: with its outcome, or suspended with its saved state.
#[derive(Clone, Debug)]
pub enum RunOutcome {
    Done(Outcome),
    Suspended(Suspended),
}

/// A suspended run: its state, which [`Runtime::resume`] continues, here or in another process built from the same
/// version.
#[derive(Clone, Debug)]
pub struct Suspended {
    pub state: Snapshot,
}

/// A call that keeps a run from suspending.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunningCall {
    /// The call's key, `<runId>:<callId>`.
    pub key: String,
    /// How the program names the function: `fetch`, `fs.readFile`, `api.issues.list`.
    pub path: String,
}

/// Why a suspend was refused: a host call that can't be detached is running, or the state can't be saved. The run
/// goes on untouched.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SuspendError {
    pub message: String,
    pub running: Vec<RunningCall>,
}

impl fmt::Display for SuspendError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SuspendError {}

impl SuspendError {
    fn running(running: Vec<RunningCall>) -> Self {
        let paths: Vec<&str> = running.iter().map(|c| c.path.as_str()).collect();
        let verb = if paths.len() == 1 { "is" } else { "are" };
        Self {
            message: format!(
                "The run can't be suspended while {} {verb} running.",
                paths.join(", ")
            ),
            running,
        }
    }

    fn other(message: String) -> Self {
        Self {
            message,
            running: Vec::new(),
        }
    }
}

/// What a run shares with its suspenders: the pending request, the synchronous call in progress, and the answer.
#[derive(Default)]
pub struct Shared {
    pub(crate) requested: AtomicBool,
    /// Whether anyone can suspend the run, so synchronous calls only record themselves when it matters.
    watched: AtomicBool,
    inner: Mutex<Inner>,
    answered: Condvar,
}

#[derive(Default)]
struct Inner {
    /// `Some(max_bytes)` while a suspend waits for the run.
    request: Option<Option<usize>>,
    reply: Option<Result<RunOutcome, SuspendError>>,
    sync_call: Option<RunningCall>,
    waker: Option<Waker>,
    finished: Option<RunOutcome>,
}

impl Shared {
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn set_waker(&self, waker: &Waker) {
        if self.watched.load(Ordering::Relaxed) {
            self.lock().waker = Some(waker.clone());
        }
    }

    /// The pending request, if any: its byte limit.
    fn take_request(&self) -> Option<Option<usize>> {
        let mut inner = self.lock();
        let r = inner.request.take();
        if r.is_some() {
            self.requested.store(false, Ordering::Relaxed);
        }
        r
    }

    fn answer(&self, reply: Result<RunOutcome, SuspendError>) {
        self.lock().reply = Some(reply);
        self.answered.notify_all();
    }

    fn finish(&self, outcome: &RunOutcome) {
        let mut inner = self.lock();
        inner.finished = Some(outcome.clone());
        if inner.request.take().is_some() {
            inner.reply = Some(Ok(outcome.clone()));
        }
        self.requested.store(false, Ordering::Relaxed);
        drop(inner);
        self.answered.notify_all();
    }
}

impl crate::host::SuspendWatch for Shared {
    fn requested(&self) -> bool {
        self.requested.load(Ordering::Relaxed)
    }

    fn watched(&self) -> bool {
        self.watched.load(Ordering::Relaxed)
    }

    fn enter_sync(&self, key: String, path: String) {
        self.lock().sync_call = Some(RunningCall { key, path });
    }

    fn leave_sync(&self) {
        if self.watched.load(Ordering::Relaxed) {
            self.lock().sync_call = None;
        }
    }
}

/// Suspends a run from another thread, the counterpart of the reference's `program.suspend()`.
#[derive(Clone)]
pub struct Suspender(Arc<Shared>);

impl Suspender {
    /// Saves the run's state and stops it at its next step boundary; the run then returns the same
    /// [`RunOutcome::Suspended`]. It waits for the run to start and to reach that boundary. It fails with a
    /// [`SuspendError`], leaving the run running, while a host call that can't be suspended is in progress (a
    /// synchronous one, an async one that isn't idempotent, a durable one still in `start`, or one holding host
    /// functions), or when the state can't be saved or takes more than `max_bytes`. A run that already ended gives
    /// its outcome.
    pub fn suspend(&self, max_bytes: Option<usize>) -> Result<RunOutcome, SuspendError> {
        let shared = &self.0;
        let mut inner = shared.lock();
        if let Some(done) = &inner.finished {
            return Ok(done.clone());
        }
        if let Some(call) = &inner.sync_call {
            return Err(SuspendError::running(vec![call.clone()]));
        }
        inner.request = Some(max_bytes);
        inner.reply = None;
        shared.requested.store(true, Ordering::Relaxed);
        if let Some(w) = inner.waker.take() {
            w.wake();
        }
        loop {
            if let Some(reply) = inner.reply.take() {
                return reply;
            }
            if let Some(done) = &inner.finished {
                return Ok(done.clone());
            }
            if let Some(call) = &inner.sync_call {
                let call = call.clone();
                inner.request = None;
                shared.requested.store(false, Ordering::Relaxed);
                return Err(SuspendError::running(vec![call]));
            }
            inner = shared
                .answered
                .wait_timeout(inner, Duration::from_millis(5))
                .map(|(g, _)| g)
                .unwrap_or_else(|e| e.into_inner().0);
        }
    }
}

/// A program ready to run once. Dropping it interrupts the run and cancels every host call in flight.
pub struct Program<'a> {
    rt: &'a Runtime,
    state: State,
    shared: Arc<Shared>,
    /// Driven as a future, so a long stretch of compute moves to a worker thread instead of holding the executor's.
    offload: bool,
    worker: Option<offload::Worker>,
    /// The stretch of compute in progress continues on the worker.
    move_away: bool,
}

impl<'a> Program<'a> {
    /// Compiles the program and sets up its globals; nothing runs yet.
    pub(crate) fn new(rt: &'a Runtime, code: &'a str, options: &ProgramOptions) -> Self {
        let started = run::start(rt, Cow::Borrowed(code), options);
        let state = match started {
            Ok(r) => State::Running(r),
            Err(outcome) => State::Failed(outcome),
        };
        Self::with(rt, state)
    }

    fn with(rt: &'a Runtime, mut state: State) -> Self {
        let shared = Arc::<Shared>::default();
        if let State::Running(r) = &mut state {
            r.vm.host.shared = shared.clone();
        }
        Self {
            rt,
            state,
            shared,
            offload: false,
            worker: None,
            move_away: false,
        }
    }

    /// A program continuing a suspended run's state, checked against this runtime.
    pub(crate) fn resume(
        rt: &'a Runtime,
        state: &Snapshot,
    ) -> Result<Self, snapshot::SnapshotError> {
        let running = restore(rt, state)?;
        Ok(Self::with(rt, State::Running(running)))
    }

    /// What suspends this run from another thread.
    pub fn suspender(&self) -> Suspender {
        self.shared.watched.store(true, Ordering::Relaxed);
        Suspender(self.shared.clone())
    }

    /// Runs the program to its end on the calling thread, blocking on asynchronous host work. A host call can
    /// interrupt the run instead ([`HostFunction`](crate::HostFunction)). A program suspended through a
    /// [`Suspender`] needs [`Program::run_resumable`], which returns its state; this one reports a failure.
    pub fn run(self) -> Result<Outcome, Interrupted> {
        self.run_resumable().map(done_or_suspended)
    }

    /// Runs the program as a future on any executor. Asynchronous host calls run on that executor; a timeout wakes
    /// the run from a shared timer thread. Dropping the future interrupts the run and every host call in flight. A
    /// stretch of compute longer than a millisecond continues on a worker thread, so the executor's thread is free
    /// meanwhile; every host function, namespace and accessor still runs on the executor.
    pub async fn run_async(self) -> Result<Outcome, Interrupted> {
        self.run_resumable_async().await.map(done_or_suspended)
    }

    /// Runs the program to its end or until a [`Suspender`] stops it, on the calling thread.
    pub fn run_resumable(mut self) -> Result<RunOutcome, Interrupted> {
        exec::block_on(std::future::poll_fn(|cx| self.advance(cx)))
    }

    /// [`Program::run_resumable`] as a future, which moves long stretches of compute as [`Program::run_async`] does.
    pub async fn run_resumable_async(mut self) -> Result<RunOutcome, Interrupted> {
        self.offload = true;
        std::future::poll_fn(|cx| self.advance(cx)).await
    }

    fn advance(&mut self, cx: &mut Context<'_>) -> Poll<Result<RunOutcome, Interrupted>> {
        let probe = 0u8;
        if let State::Failed(_) = self.state {
            let State::Failed(outcome) = std::mem::replace(&mut self.state, State::Done) else {
                unreachable!()
            };
            let outcome = RunOutcome::Done(*outcome);
            self.shared.finish(&outcome);
            return Poll::Ready(Ok(outcome));
        }
        loop {
            // Back from a stretch of compute on the worker, or still away running its host code.
            let computed = matches!(self.state, State::Away);
            if computed {
                let Some(worker) = &self.worker else {
                    unreachable!("a run is only away on its worker")
                };
                match worker.poll(cx) {
                    Poll::Ready(r) => self.state = State::Running(r),
                    Poll::Pending => return Poll::Pending,
                }
            }
            let State::Running(r) = &mut self.state else {
                return Poll::Pending;
            };
            if !computed {
                // Between jobs no native frame of the run is on the stack, so it may continue from wherever it is polled.
                r.vm.stack_base = &probe as *const u8 as usize;
                r.vm.stack_budget = run::RUN_STACK_BUDGET;
                if r.vm.check_time().is_err() {
                    break;
                }
                if self.offload {
                    r.vm.host.offload().at = Some(Instant::now() + offload::OFFLOAD_AFTER);
                }
                if !r.started {
                    r.started = true;
                    r.vm.start = Instant::now()
                        .checked_sub(r.active_before)
                        .unwrap_or_else(Instant::now);
                    if round_trips(&self.shared) {
                        r.vm.start_roundtrip(r.round_trip_every);
                    }
                    snapshot::restart_calls(&mut r.vm);
                    if r.vm.frames.is_empty() && !r.resumed() {
                        run::call_main(&mut r.vm);
                    }
                }
                for (p, s) in r.vm.host.tasks.poll_ready() {
                    r.vm.host.settled(p);
                    if let crate::host::Settlement::Interrupted = s {
                        crate::host::interrupt(&mut r.vm);
                    }
                    r.vm.inbox.push_back((p, s));
                }
                let away = std::mem::take(&mut self.move_away);
                if let Some(worker) = self.worker.as_ref().filter(|_| away) {
                    r.vm.host.offload().at = None;
                    let State::Running(r) = std::mem::replace(&mut self.state, State::Away) else {
                        unreachable!()
                    };
                    worker.compute(r);
                    continue;
                }
                let _ = r.vm.continue_frames();
                if !r.vm.suspended {
                    let _ = r.vm.drive();
                }
                if let Some(o) = &mut r.vm.host.offload {
                    o.at = None;
                }
            }
            // The run stopped: the reference's driver starts the host calls queued so far.
            if !r.vm.host.queued.is_empty() {
                crate::host::launch(&mut r.vm);
                if r.vm.outcome.is_none() && r.vm.fatal.is_none() && !r.vm.suspended {
                    continue;
                }
            }
            if r.vm.outcome.is_some() || r.vm.fatal.is_some() {
                break;
            }
            // A stop to move only: the stretch continues on the worker, and the next one starts here again. A suspend at
            // the same stop goes first.
            if r.vm.suspended
                && r.vm
                    .host
                    .offload
                    .as_mut()
                    .is_some_and(|o| std::mem::take(&mut o.due))
                && !self.shared.requested.load(Ordering::Relaxed)
            {
                r.vm.suspended = false;
                r.vm.suspend_wanted = false;
                if self.worker.is_none() {
                    self.worker = offload::Worker::spawn().ok();
                }
                self.move_away = self.worker.is_some();
                self.offload = self.move_away;
                continue;
            }
            if r.vm.suspended {
                match self.checkpoint() {
                    Some(done) => return Poll::Ready(Ok(done)),
                    None => continue,
                }
            }
            let State::Running(r) = &mut self.state else {
                return Poll::Pending;
            };
            if r.vm.host.tasks.has_ready() {
                continue;
            }
            if round_trips(&self.shared) && !r.vm.host.calls.is_empty() {
                // A host stop: save and restore before waiting.
                r.vm.suspend_wanted = true;
                r.vm.suspended = true;
                if let Some(done) = self.checkpoint() {
                    return Poll::Ready(Ok(done));
                }
                let State::Running(r) = &mut self.state else {
                    return Poll::Pending;
                };
                r.vm.suspended = false;
                r.vm.suspend_wanted = false;
            }
            let State::Running(r) = &mut self.state else {
                return Poll::Pending;
            };
            r.vm.host.tasks.set_parent(Some(cx.waker()));
            self.shared.set_waker(cx.waker());
            if self.shared.requested.load(Ordering::Relaxed) {
                continue;
            }
            if !r.timer_armed
                && let Some(ms) = r.vm.limits.timeout_ms
            {
                r.timer_armed = true;
                exec::wake_at(
                    r.vm.start + Duration::from_millis(ms),
                    &r.vm.host.tasks.parent_waker(),
                );
            }
            // A task may have finished between the poll and handing over the waker.
            if r.vm.host.tasks.has_ready() {
                continue;
            }
            return Poll::Pending;
        }
        let State::Running(r) = std::mem::replace(&mut self.state, State::Done) else {
            unreachable!()
        };
        if r.vm.host.interrupted {
            drop(r);
            self.shared
                .finish(&RunOutcome::Done(run::failed_interrupted()));
            return Poll::Ready(Err(Interrupted));
        }
        let outcome = RunOutcome::Done(run::finish(*r));
        self.shared.finish(&outcome);
        Poll::Ready(Ok(outcome))
    }

    /// The run stopped at a safe point: answer a suspend, or make a round trip. Returns the outcome when the run is
    /// suspended for good; otherwise the run goes on.
    fn checkpoint(&mut self) -> Option<RunOutcome> {
        let State::Running(r) = &mut self.state else {
            return None;
        };
        r.vm.suspended = false;
        r.vm.suspend_wanted = false;
        // The reference hands queued calls to its driver at every stop, before anyone can suspend the run.
        crate::host::launch(&mut r.vm);
        let request = self.shared.take_request();
        if request.is_none() && r.skip > 0 {
            r.skip -= 1;
            return None;
        }
        let start = r.vm.start;
        let active_ms = start.elapsed().max(r.active_before).as_millis() as u64;
        let captured = snapshot::capture(
            &r.vm,
            &snapshot::Capture {
                code: &r.code,
                active_ms,
            },
        );
        match request {
            Some(max_bytes) => {
                let result = captured
                    .map_err(|refusal| match refusal {
                        Refusal::Running(calls) => SuspendError::running(
                            calls
                                .into_iter()
                                .map(|(call, path)| RunningCall {
                                    key: r.vm.host.key(call),
                                    path,
                                })
                                .collect(),
                        ),
                        Refusal::Other(message) => SuspendError::other(format!(
                            "The run's state couldn't be saved: {message}"
                        )),
                    })
                    .and_then(|state| {
                        let size = snapshot::to_bytes(&state).len();
                        match max_bytes {
                            Some(max) if size > max => Err(SuspendError::other(format!(
                                "The run's state takes {size} bytes, more than the {max}-byte limit, so it couldn't be suspended."
                            ))),
                            _ => Ok(state),
                        }
                    });
                match result {
                    Ok(state) => {
                        let outcome = RunOutcome::Suspended(Suspended { state });
                        self.detach();
                        self.shared.answer(Ok(outcome.clone()));
                        self.shared.finish(&outcome);
                        Some(outcome)
                    }
                    Err(e) => {
                        self.shared.answer(Err(e));
                        None
                    }
                }
            }
            None => {
                // The round-trip test mode: continue from the state, in a brand-new VM.
                let Ok(state) = captured else {
                    return None;
                };
                // A call whose function can't be found again holds live host values: as the reference does, the
                // round trip waits until it completes.
                if r.vm.host.calls.iter().any(|c| c.path.is_none()) {
                    return None;
                }
                let bytes = snapshot::to_bytes(&state);
                // A large state skips the next round trips in proportion to its size, as the reference's round-trip
                // mode does (at a quarter of its rate, to keep more points): a deep or heavy run still round-trips
                // its large states without paying for it at every point.
                let saved = r.vm.heap.len().saturating_sub(r.vm.snapshot_base.heap);
                let skip = (saved / 800 + bytes.len() / 400_000) as u32;
                let state = snapshot::from_bytes(&bytes).ok()?;
                match restore(self.rt, &state) {
                    Ok(mut fresh) => {
                        fresh.vm.host.shared = self.shared.clone();
                        // A round trip is not a pause: the run's clock keeps its start, which the header would
                        // round to whole milliseconds.
                        fresh.active_before = start.elapsed();
                        // Twice as long each time, so a long loop takes a few round trips, not thousands.
                        fresh.round_trip_every =
                            r.round_trip_every.saturating_mul(2).min(ROUNDTRIP_MAX);
                        fresh.skip = skip;
                        self.detach();
                        self.state = State::Running(fresh);
                        None
                    }
                    Err(e) => {
                        let State::Running(r) = &mut self.state else {
                            return None;
                        };
                        r.vm.fatal = Some((
                            crate::DiagnosticKind::ExecutionFailure,
                            format!("Round trip failed: {}", e.message),
                        ));
                        None
                    }
                }
            }
        }
    }

    /// Detaches the run's calls before its state is dropped for a suspend: idempotent calls are interrupted, durable
    /// ones are left running, and each sees that the run is suspending.
    fn detach(&mut self) {
        let State::Running(r) = &mut self.state else {
            return;
        };
        r.vm.host.suspending.store(true, Ordering::Relaxed);
        for call in &r.vm.host.calls {
            call.detached.store(true, Ordering::Relaxed);
        }
        r.vm.host.calls.clear();
        r.vm.host.tasks.clear();
    }
}

impl Drop for Program<'_> {
    /// A run away on its worker is asked to stop at its next safe point and comes back, so it ends here, where its
    /// host calls are cancelled.
    fn drop(&mut self) {
        let Some(worker) = self.worker.take() else {
            return;
        };
        if let State::Away = self.state {
            self.shared.requested.store(true, Ordering::Relaxed);
            drop(worker.reclaim());
        }
    }
}

fn done_or_suspended(o: RunOutcome) -> Outcome {
    match o {
        RunOutcome::Done(o) => o,
        RunOutcome::Suspended(_) => run::failed_suspended(),
    }
}

/// Rebuilds a suspended run in a fresh VM of this runtime.
fn restore(rt: &Runtime, state: &Snapshot) -> Result<Box<Running>, snapshot::SnapshotError> {
    let restored = snapshot::header(state)?;
    let active_ms = restored.active_ms;
    let mut started = run::start_for_resume(rt, restored)?;
    snapshot::restore(&mut started.running.vm, state, &started.bytecode)?;
    let mut r = started.running;
    r.active_before = Duration::from_millis(active_ms);
    // The program's body already started: what runs next comes from the saved frames and jobs.
    r.mark_resumed();
    Ok(r)
}

impl Running {
    pub fn new(vm: Vm, code: String) -> Self {
        Self {
            vm,
            code,
            started: false,
            timer_armed: false,
            active_before: Duration::ZERO,
            round_trip_every: ROUNDTRIP_TICKS,
            skip: 0,
        }
    }

    fn resumed(&self) -> bool {
        self.vm.resumed
    }

    fn mark_resumed(&mut self) {
        self.vm.resumed = true;
    }
}

/// Round-trip mode leaves alone a program that has a `Suspender`: its owner suspends it.
fn round_trips(shared: &Shared) -> bool {
    roundtrip() && !shared.watched.load(Ordering::Relaxed)
}

/// Whether the round-trip test mode is on: every run is saved to bytes and restored into a brand-new VM at every
/// host stop and after 64 loop iterations, then 128, 256 and so on, proving its state is plain data. Internal; tests turn it on with
/// `PSYCHOSCRIPT_ROUNDTRIP=1`.
fn roundtrip() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("PSYCHOSCRIPT_ROUNDTRIP").is_some_and(|v| v == "1"))
}

const ROUNDTRIP_TICKS: u32 = 64;
const ROUNDTRIP_MAX: u32 = 1 << 16;

// A run's state may move to another thread between steps.
const _: () = {
    const fn send<T: Send>() {}
    send::<Running>()
};
