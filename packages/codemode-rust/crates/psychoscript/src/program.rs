//! One run of a program, the counterpart of the reference's `runtime.program(...)`: nothing runs until it is driven,
//! and it is driven to its end on the calling thread or as a future.

use std::task::{Context, Poll};
use std::time::Duration;

use crate::exec;
use crate::run;
use crate::vm::Vm;
use crate::{Json, Outcome, Runtime};

enum State<'a> {
    Running(Box<Running<'a>>),
    /// It ended before running: the program did not compile.
    Failed(Box<Outcome>),
    Done,
}

pub(crate) struct Running<'a> {
    pub vm: Vm<'a>,
    pub code: &'a str,
    started: bool,
    timer_armed: bool,
}

/// A program ready to run once. Dropping it interrupts the run and cancels every host call in flight.
pub struct Program<'a> {
    state: State<'a>,
    /// How much of the native stack below the point it is driven from the run may use.
    pub(crate) stack_budget: usize,
}

impl<'a> Program<'a> {
    /// Compiles the program and sets up its globals; nothing runs yet.
    pub(crate) fn new(
        rt: &'a Runtime,
        code: &'a str,
        bindings: &serde_json::Map<String, Json>,
        run_id: Option<&str>,
    ) -> Self {
        let state = match run::start(rt, code, bindings, run_id.map(str::to_owned)) {
            Ok(r) => State::Running(r),
            Err(outcome) => State::Failed(outcome),
        };
        Self {
            state,
            stack_budget: run::INLINE_STACK_BUDGET,
        }
    }

    /// Runs the program to its end on the calling thread, blocking on asynchronous host work.
    pub fn run(mut self) -> Outcome {
        exec::block_on(std::future::poll_fn(|cx| self.advance(cx)))
    }

    /// Runs the program as a future on any executor. Asynchronous host calls run on that executor; a timeout wakes
    /// the run from a shared timer thread. Dropping the future interrupts the run and every host call in flight.
    pub async fn run_async(mut self) -> Outcome {
        std::future::poll_fn(|cx| self.advance(cx)).await
    }

    fn advance(&mut self, cx: &mut Context<'_>) -> Poll<Outcome> {
        let probe = 0u8;
        if let State::Failed(_) = self.state {
            let State::Failed(outcome) = std::mem::replace(&mut self.state, State::Done) else {
                unreachable!()
            };
            return Poll::Ready(*outcome);
        }
        let State::Running(r) = &mut self.state else {
            return Poll::Pending;
        };
        // Between jobs no native frame of the run is on the stack, so it may continue from wherever it is polled.
        r.vm.stack_base = &probe as *const u8 as usize;
        r.vm.stack_budget = self.stack_budget;
        loop {
            if r.vm.check_time().is_err() {
                break;
            }
            if !r.started {
                r.started = true;
                run::call_main(&mut r.vm);
            }
            for (p, s) in r.vm.host.tasks.poll_ready() {
                r.vm.inbox.push_back((p, s));
            }
            let _ = r.vm.drive();
            if r.vm.outcome.is_some() || r.vm.fatal.is_some() {
                break;
            }
            if r.vm.host.tasks.has_ready() {
                continue;
            }
            r.vm.host.tasks.set_parent(Some(cx.waker()));
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
        Poll::Ready(run::finish(*r))
    }
}

impl<'a> Running<'a> {
    pub fn new(vm: Vm<'a>, code: &'a str) -> Self {
        Self {
            vm,
            code,
            started: false,
            timer_armed: false,
        }
    }
}
