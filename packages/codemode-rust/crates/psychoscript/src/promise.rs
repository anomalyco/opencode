//! Promises and the job queue, following the ECMAScript reaction and thenable-job ordering.

use crate::native::{Frame, Input, Step};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Job, NATIVE_FUEL, REQ_NEXT, REQ_RETURN, REQ_THROW, Reaction, Res, Vm};

/// What a `Settle` frame's call is for (see `settle_step`).
pub(crate) const THEN: usize = 0;
pub(crate) const FINALLY: usize = 1;
pub(crate) const THENABLE: usize = 2;
pub(crate) const EXECUTOR: usize = 3;
pub(crate) const TRY: usize = 4;

// The slots of a `Settle` frame: its kind; the promise it settles (for a thenable job, the resolve function); for a
// thenable job or an executor the reject function, for a `finally` the outcome it restores (its kind, then its value),
// and for `Promise.try` whether its call was counted; then the call: callee, receiver, argument count and arguments.
const SETTLE_KIND: usize = 0;
const SETTLE_TARGET: usize = 1;
const SETTLE_A: usize = 2;
const SETTLE_B: usize = 3;
const SETTLE_F: usize = 4;
const SETTLE_THIS: usize = 5;
const SETTLE_ARGC: usize = 6;
const SETTLE_ARGS: usize = 7;

/// Pushes a `Settle` frame for a promise handler, a `finally` cleanup, a thenable job's `then`, an executor or a
/// `Promise.try` callback: it calls `f` as the reference enters it (`Step::CallSettling`), then settles with how it
/// ended.
#[allow(clippy::too_many_arguments)]
pub(crate) fn enter_settle(
    vm: &mut Vm,
    callee: Value,
    kind: usize,
    target: Value,
    a: Value,
    b: Value,
    f: Value,
    this: Value,
    args: &[Value],
) -> Res {
    let mut slots = vec![
        Value::Num(kind as f64),
        target,
        a,
        b,
        f,
        this,
        Value::Num(args.len() as f64),
    ];
    slots.extend_from_slice(args);
    vm.enter_native_with(
        crate::native::NativeOp::Settle,
        0,
        callee,
        Value::Undef,
        &slots,
    )
}

/// The step of a `Settle` frame.
pub(crate) fn settle_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let kind = fr.index(vm, SETTLE_KIND);
    let target = fr.get(vm, SETTLE_TARGET);
    let outcome = match input {
        Input::Start => {
            let (f, this, argc) = (
                fr.slot(vm, SETTLE_F),
                fr.slot(vm, SETTLE_THIS),
                fr.index(vm, SETTLE_ARGC),
            );
            let at = fr.base() + SETTLE_ARGS;
            let args: Vec<_> = vm.stack[at..at + argc].to_vec();
            return Ok(fr.catching_list(vm, f, this, &args, Step::CallSettling));
        }
        Input::Returned(r) => Ok(r.get()),
        Input::Threw(e) => Err(e),
        Input::Finished(_) => return Ok(Step::Done(Value::Undef)),
    };
    let p = target.as_obj().unwrap_or(0);
    match (kind, outcome) {
        (THEN, Ok(r)) | (TRY, Ok(r)) => vm.resolve_promise(p, r),
        (THEN, Err(e)) | (TRY, Err(e)) | (FINALLY, Err(e)) => vm.reject(p, e),
        (FINALLY, Ok(r)) => {
            // As the spec chains `then(valueThunk)` onto the cleanup's promise, the reference passes its outcome
            // through one more promise, a job later.
            let value = fr.get(vm, SETTLE_B);
            let restored = match fr.index(vm, SETTLE_A) {
                0 => Ok(value),
                _ => Err(value),
            };
            let q = vm.promise_resolve(r);
            let cleaned = vm.new_promise();
            vm.perform_then(q, Reaction::Resolve(cleaned));
            vm.perform_then(
                cleaned,
                Reaction::Restore {
                    derived: p,
                    outcome: restored,
                },
            );
        }
        (THENABLE, Err(e)) => {
            if let Some(q) = vm.take_resolver(p) {
                vm.reject(q, e);
            }
        }
        (EXECUTOR, Err(e)) => {
            let rej = fr.get(vm, SETTLE_A);
            vm.call(&rej, Value::Undef, &[e])?;
        }
        _ => {}
    }
    Ok(Step::Done(match kind {
        EXECUTOR => target,
        TRY => {
            if fr.index(vm, SETTLE_B) != 0 {
                vm.bytecode_builtin();
            }
            target
        }
        _ => Value::Undef,
    }))
}

impl Vm {
    pub fn new_promise(&mut self) -> Id {
        let proto = self.realm.promise_proto;
        self.alloc(Obj::new(
            Some(proto),
            Kind::Promise(Box::new(PromiseData {
                state: PromiseState::Pending,
                reactions: Vec::new(),
            })),
        ))
    }

    pub fn as_promise(&self, v: &Value) -> Option<Id> {
        match v {
            Value::Obj(id) if matches!(self.heap[*id as usize].kind, Kind::Promise(_)) => Some(*id),
            _ => None,
        }
    }

    pub fn is_pending(&self, p: Id) -> bool {
        matches!(&self.heap[p as usize].kind, Kind::Promise(d) if matches!(d.state, PromiseState::Pending))
    }

    pub fn settle(&mut self, p: Id, outcome: Result<Value, Value>) {
        let Kind::Promise(d) = &mut self.heap[p as usize].kind else {
            return;
        };
        if !matches!(d.state, PromiseState::Pending) {
            return;
        }
        d.state = match &outcome {
            Ok(v) => PromiseState::Fulfilled(*v),
            Err(e) => PromiseState::Rejected(*e),
        };
        let reactions = std::mem::take(&mut d.reactions);
        if let Err(e) = outcome
            && reactions.is_empty()
        {
            crate::host::unhandled(self, p, e);
        }
        for r in reactions {
            self.jobs.push_back(Job::Reaction(r, outcome));
        }
    }

    pub fn fulfill(&mut self, p: Id, v: Value) {
        self.settle(p, Ok(v));
    }

    pub fn reject(&mut self, p: Id, e: Value) {
        self.settle(p, Err(e));
    }

    pub fn perform_then(&mut self, p: Id, reaction: Reaction) {
        let Kind::Promise(d) = &mut self.heap[p as usize].kind else {
            return;
        };
        let outcome = match &d.state {
            PromiseState::Pending => {
                d.reactions.push(reaction);
                return;
            }
            PromiseState::Fulfilled(v) => Ok(*v),
            PromiseState::Rejected(e) => Err(*e),
        };
        if outcome.is_err() {
            crate::host::handled(self, p);
        }
        self.jobs.push_back(Job::Reaction(reaction, outcome));
    }

    /// A promise's resolve function: adopts thenables through a job, fulfills with anything else.
    pub fn resolve_promise(&mut self, p: Id, v: Value) {
        if !self.is_pending(p) {
            return;
        }
        if let Value::Obj(id) = v {
            if id == p {
                let e = self.type_error("Chaining cycle detected for promise #<Promise>");
                self.reject(p, e);
                return;
            }
            // A namespace is no object to the reference, so never a thenable, though `then` names a path in it.
            let namespace = matches!(self.heap[id as usize].kind, Kind::Namespace(_));
            let then_key = self.names.then;
            let then = if namespace {
                Value::Undef
            } else {
                self.get_obj(id, then_key)
            };
            if self.is_callable(&then) {
                self.jobs.push_back(Job::Thenable {
                    promise: p,
                    thenable: v,
                    then,
                });
                return;
            }
        }
        self.fulfill(p, v);
    }

    /// `Promise.resolve`: a promise passes through, anything else is wrapped.
    pub fn promise_resolve(&mut self, v: Value) -> Id {
        if let Some(p) = self.as_promise(&v) {
            return p;
        }
        let p = self.new_promise();
        self.resolve_promise(p, v);
        p
    }

    pub fn await_value(&mut self, v: Value, c: u32) {
        let p = self.promise_resolve(v);
        self.perform_then(p, Reaction::Await(c));
    }

    pub fn create_resolvers(&mut self, p: Id) -> (Value, Value) {
        let proto = self.realm.object_proto;
        let state = self.alloc(Obj::new(
            Some(proto),
            Kind::Resolvers {
                promise: p,
                done: false,
            },
        ));
        let resolve = self.native_fn("", 1, resolver_resolve, Value::Obj(state));
        let reject = self.native_fn("", 1, resolver_reject, Value::Obj(state));
        (resolve, reject)
    }

    /// Runs the native frame a job pushed, as the base of a run that may stop for a suspend and continue later.
    fn run_job_frame(&mut self) -> Result<(), Value> {
        self.take_entered();
        self.resumable_run = true;
        let r = self.run();
        self.resumable_run = false;
        r.map(|_| ())
    }

    /// Marks a resolver pair used; returns its promise if this is the first use.
    pub(crate) fn take_resolver(&mut self, callee: Id) -> Option<Id> {
        let Kind::Native {
            data: Value::Obj(state),
            ..
        } = &self.heap[callee as usize].kind
        else {
            return None;
        };
        let state = *state;
        match &mut self.heap[state as usize].kind {
            Kind::Resolvers { promise, done } if !*done => {
                *done = true;
                Some(*promise)
            }
            _ => None,
        }
    }

    pub fn run_job(&mut self, job: Job) -> Result<(), Value> {
        match job {
            Job::Thenable {
                promise,
                thenable,
                then,
            } => {
                let intrinsic = matches!(then, Value::Obj(t) if t == self.realm.promise_then);
                if intrinsic && let Some(q) = self.as_promise(&thenable) {
                    self.perform_then(q, Reaction::Resolve(promise));
                    return Ok(());
                }
                let (res, rej) = self.create_resolvers(promise);
                enter_settle(
                    self,
                    Value::Undef,
                    THENABLE,
                    res,
                    rej,
                    Value::Undef,
                    then,
                    thenable,
                    &[res, rej],
                )?;
                self.run_job_frame()
            }
            Job::Reaction(reaction, outcome) => self.run_reaction(reaction, outcome),
        }
    }

    fn run_reaction(
        &mut self,
        reaction: Reaction,
        outcome: Result<Value, Value>,
    ) -> Result<(), Value> {
        match reaction {
            Reaction::Then {
                on_ful,
                on_rej,
                derived,
            } => {
                let (handler, arg, ok) = match outcome {
                    Ok(v) => (on_ful, v, true),
                    Err(e) => (on_rej, e, false),
                };
                if self.is_callable(&handler) {
                    let d = Value::Obj(derived);
                    enter_settle(
                        self,
                        Value::Undef,
                        THEN,
                        d,
                        Value::Undef,
                        Value::Undef,
                        handler,
                        Value::Undef,
                        &[arg],
                    )?;
                    return self.run_job_frame();
                } else if ok {
                    self.fulfill(derived, arg);
                } else {
                    self.reject(derived, arg);
                }
                Ok(())
            }
            Reaction::Await(c) => {
                self.resumable_run = true;
                let r = self.resume_coroutine(c, outcome);
                self.resumable_run = false;
                r
            }
            Reaction::Resolve(target) => {
                self.settle(target, outcome);
                Ok(())
            }
            Reaction::Comb { comb, index } => {
                self.combinator_step(comb, index as usize, outcome);
                Ok(())
            }
            Reaction::Finally { cleanup, derived } => {
                let (failed, value) = match outcome {
                    Ok(v) => (0.0, v),
                    Err(e) => (1.0, e),
                };
                let d = Value::Obj(derived);
                enter_settle(
                    self,
                    Value::Undef,
                    FINALLY,
                    d,
                    Value::Num(failed),
                    value,
                    cleanup,
                    Value::Undef,
                    &[],
                )?;
                self.run_job_frame()
            }
            Reaction::Restore {
                derived,
                outcome: original,
            } => {
                match outcome {
                    Ok(_) => self.settle(derived, original),
                    Err(e) => self.reject(derived, e),
                }
                Ok(())
            }
            Reaction::AwaitGen(g) => {
                self.resumable_run = true;
                let r = self.run_async_generator(g, REQ_NEXT, outcome, true);
                self.resumable_run = false;
                r
            }
            Reaction::GenReturn(g) => {
                self.async_generator_finish(g, outcome);
                Ok(())
            }
            Reaction::FromSync { made, done, close } => {
                match outcome {
                    Ok(v) => {
                        let r = self.iter_result(v, done);
                        self.resolve_promise(made, r);
                    }
                    Err(e) => {
                        if let Some(sync) = close {
                            let closed = self.iter_close(&Value::Obj(sync));
                            if self.fatal.is_some() {
                                return closed;
                            }
                        }
                        self.reject(made, e);
                    }
                }
                Ok(())
            }
            Reaction::Cross(id) => {
                crate::cross::advance(self, id, Some(outcome))?;
                if self.entered {
                    return self.run_job_frame();
                }
                Ok(())
            }
            Reaction::Program => {
                if self.outcome.is_none() {
                    self.outcome = Some(outcome);
                }
                Ok(())
            }
        }
    }

    fn combinator_step(&mut self, comb: Id, index: usize, outcome: Result<Value, Value>) {
        let status = self.names.status;
        let value_key = self.names.value;
        let reason = self.names.reason;
        let record = match (&self.heap[comb as usize].kind, &outcome) {
            (Kind::Combinator(c), _) if c.kind == CombKind::AllSettled => {
                let o = self.new_object();
                match &outcome {
                    Ok(v) => {
                        let t = self.static_str("fulfilled");
                        self.define(o, status, t);
                        self.define(o, value_key, *v);
                    }
                    Err(e) => {
                        let t = self.static_str("rejected");
                        self.define(o, status, t);
                        self.define(o, reason, *e);
                    }
                }
                Some(Value::Obj(o))
            }
            _ => None,
        };
        let Kind::Combinator(c) = &mut self.heap[comb as usize].kind else {
            return;
        };
        let promise = c.promise;
        let finished = match (c.kind, outcome) {
            (CombKind::All, Ok(v)) => {
                c.values[index] = v;
                c.remaining -= 1;
                c.remaining == 0
            }
            (CombKind::All, Err(e)) => {
                self.reject(promise, e);
                return;
            }
            (CombKind::AllSettled, _) => {
                c.values[index] = record.unwrap_or_default();
                c.remaining -= 1;
                c.remaining == 0
            }
            (CombKind::Any, Ok(v)) => {
                self.resolve_promise(promise, v);
                return;
            }
            (CombKind::Any, Err(e)) => {
                c.values[index] = e;
                c.remaining -= 1;
                c.remaining == 0
            }
        };
        if !finished {
            return;
        }
        let kind = c.kind;
        let values = std::mem::take(&mut c.values);
        let arr = self.new_array(values);
        if kind == CombKind::Any {
            let proto = self.realm.aggregate_error_proto;
            let e = self.make_error(proto, "All promises were rejected");
            if let Value::Obj(eid) = e {
                let errors = self.names.errors;
                self.define_hidden(eid, errors, arr);
            }
            self.reject(promise, e);
        } else {
            self.resolve_promise(promise, arr);
        }
    }
}

/// Natives promises make at run time, which a snapshot names like the built-ins'.
pub fn snapshot_natives() -> [crate::vm::NativeFn; 2] {
    [resolver_resolve, resolver_reject]
}

fn resolver_resolve(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Result<Value, Value> {
    if let Some(p) = vm.take_resolver(callee) {
        vm.resolve_promise(p, args.first().cloned().unwrap_or_default());
    }
    Ok(Value::Undef)
}

fn resolver_reject(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Result<Value, Value> {
    if let Some(p) = vm.take_resolver(callee) {
        vm.reject(p, args.first().cloned().unwrap_or_default());
    }
    Ok(Value::Undef)
}

// ---------- async generators ----------

impl Vm {
    /// Creates the async iterator prototypes. Runs while built-ins are set up.
    pub fn setup_async_iteration(&mut self) {
        let op = self.realm.object_proto;
        let aip = self.alloc(Obj::new(Some(op), Kind::Ordinary));
        let f = self.native_fn("[Symbol.asyncIterator]", 0, async_iter_self, Value::Undef);
        self.define_hidden(aip, SYM_ASYNC_ITERATOR, f);
        let agp = self.alloc(Obj::new(Some(aip), Kind::Ordinary));
        self.method(agp, "next", 1, async_gen_next);
        self.method(agp, "return", 1, async_gen_return);
        self.method(agp, "throw", 1, async_gen_throw);
        self.realm.async_generator_proto = agp;
        self.realm.async_from_sync_proto = self.alloc(Obj::new(Some(aip), Kind::Ordinary));
        let fp = self.realm.function_proto;
        self.realm.generator_function_proto = self.alloc(Obj::new(Some(fp), Kind::Ordinary));
        self.realm.async_function_proto = self.alloc(Obj::new(Some(fp), Kind::Ordinary));
        self.realm.async_generator_function_proto = self.alloc(Obj::new(Some(fp), Kind::Ordinary));
    }

    fn async_gen(&mut self, g: Id) -> Option<&mut AsyncGen> {
        match &mut self.heap[g as usize].kind {
            Kind::AsyncGenerator(a) => Some(a),
            _ => None,
        }
    }

    /// AsyncGenerator.prototype.next/return/throw: queue the request with its promise, and run the body now if it
    /// waits for one. A request that arrives while the body runs is answered when the body reaches it.
    fn async_gen_request(&mut self, this: Value, kind: u8, v: Value) -> Res {
        let p = self.new_promise();
        let g = match this {
            Value::Obj(g) if self.is_async_generator(g) => g,
            _ => {
                let name = ["next", "throw", "return"][kind as usize];
                let e = self.type_error(&format!(
                    "AsyncGenerator.prototype.{name} called on incompatible receiver."
                ));
                self.reject(p, e);
                return Ok(Value::Obj(p));
            }
        };
        let Some(a) = self.async_gen(g) else {
            return Ok(Value::Obj(p));
        };
        let phase = a.phase;
        if kind == REQ_NEXT && phase == AsyncPhase::Completed {
            let r = self.iter_result(Value::Undef, true);
            self.resolve_promise(p, r);
            return Ok(Value::Obj(p));
        }
        if kind == REQ_THROW && matches!(phase, AsyncPhase::Start | AsyncPhase::Completed) {
            if let Some(a) = self.async_gen(g) {
                a.phase = AsyncPhase::Completed;
                a.state = GenState::Done;
            }
            self.reject(p, v);
            return Ok(Value::Obj(p));
        }
        let Some(a) = self.async_gen(g) else {
            return Ok(Value::Obj(p));
        };
        a.queue.push_back(AsyncRequest {
            kind,
            value: v,
            promise: p,
        });
        if kind == REQ_RETURN && matches!(phase, AsyncPhase::Start | AsyncPhase::Completed) {
            a.phase = AsyncPhase::AwaitingReturn;
            a.state = GenState::Done;
            self.await_return(g);
            return Ok(Value::Obj(p));
        }
        if !matches!(phase, AsyncPhase::Start | AsyncPhase::Yield) {
            return Ok(Value::Obj(p));
        }
        a.phase = AsyncPhase::Executing;
        self.run_async_generator(g, kind, Ok(v), false)?;
        Ok(Value::Obj(p))
    }

    /// Answers the oldest request with an iterator result, or rejects it.
    fn complete_step(&mut self, g: Id, outcome: Result<Value, Value>, done: bool) {
        let Some(front) = self.async_gen(g).and_then(|a| a.queue.pop_front()) else {
            return;
        };
        match outcome {
            Ok(v) => {
                let r = self.iter_result(v, done);
                self.resolve_promise(front.promise, r);
            }
            Err(e) => self.reject(front.promise, e),
        }
    }

    /// A `yield` answered the oldest request. Returns the next queued request to continue with, or suspends.
    pub fn async_generator_yielded(&mut self, g: Id, v: Value) -> Option<(u8, Value)> {
        self.complete_step(g, Ok(v), false);
        let a = self.async_gen(g)?;
        match a.queue.front() {
            Some(r) => Some((r.kind, r.value)),
            None => {
                a.phase = AsyncPhase::Yield;
                None
            }
        }
    }

    /// The body returned or threw: answer the oldest request with that, then the rest in order.
    pub fn async_generator_finish(&mut self, g: Id, outcome: Result<Value, Value>) {
        self.complete_step(g, outcome, true);
        self.drain_requests(g);
    }

    /// AsyncGeneratorDrainQueue: once the body has ended, answer the remaining requests in order.
    fn drain_requests(&mut self, g: Id) {
        loop {
            let Some(a) = self.async_gen(g) else { return };
            a.phase = AsyncPhase::Completed;
            let Some(front) = a.queue.front() else { return };
            let (kind, value) = (front.kind, front.value);
            if kind == REQ_RETURN {
                a.phase = AsyncPhase::AwaitingReturn;
                self.await_return(g);
                return;
            }
            let outcome = if kind == REQ_THROW {
                Err(value)
            } else {
                Ok(Value::Undef)
            };
            self.complete_step(g, outcome, true);
        }
    }

    /// AsyncGeneratorAwaitReturn: a `return(value)` on an ended or unstarted generator settles once `value` does.
    fn await_return(&mut self, g: Id) {
        let Some(v) = self
            .async_gen(g)
            .and_then(|a| a.queue.front().map(|r| r.value))
        else {
            return;
        };
        let p = self.promise_resolve(v);
        self.perform_then(p, Reaction::GenReturn(g));
    }
}

fn async_iter_self(_vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(this)
}

fn async_gen_next(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    request(vm, this, REQ_NEXT, args)
}

fn async_gen_return(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    request(vm, this, REQ_RETURN, args)
}

fn async_gen_throw(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    request(vm, this, REQ_THROW, args)
}

/// An async generator's request. The reference's native returns before the body runs, so a call from bytecode spends
/// its fifty first and the call costs nothing more.
fn request(vm: &mut Vm, this: Value, kind: u8, args: &[Value]) -> Res {
    let counted = vm.host.meter.counted;
    if counted {
        vm.fuel(NATIVE_FUEL);
    }
    let r = vm.async_gen_request(this, kind, args.first().copied().unwrap_or_default());
    if counted && r.is_ok() {
        vm.bytecode_builtin();
    }
    r
}
