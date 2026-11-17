//! Promises and the job queue, following the ECMAScript reaction and thenable-job ordering.

use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Job, Reaction, Vm};

impl<'rt> Vm<'rt> {
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
            let then_key = self.names.then;
            let then = self.get_obj(id, then_key);
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

    /// Marks a resolver pair used; returns its promise if this is the first use.
    fn take_resolver(&mut self, callee: Id) -> Option<Id> {
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
                if let Err(e) = self.call(&then, thenable, &[res, rej]) {
                    if self.fatal.is_some() {
                        return Err(e);
                    }
                    if let Value::Obj(r) = res
                        && let Some(p) = self.take_resolver(r)
                    {
                        self.reject(p, e);
                    }
                }
                Ok(())
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
                    match self.call(&handler, Value::Undef, &[arg]) {
                        Ok(r) => self.resolve_promise(derived, r),
                        Err(e) => {
                            if self.fatal.is_some() {
                                return Err(e);
                            }
                            self.reject(derived, e);
                        }
                    }
                } else if ok {
                    self.fulfill(derived, arg);
                } else {
                    self.reject(derived, arg);
                }
                Ok(())
            }
            Reaction::Await(c) => self.resume_coroutine(c, outcome),
            Reaction::Resolve(target) => {
                self.settle(target, outcome);
                Ok(())
            }
            Reaction::Comb { comb, index } => {
                self.combinator_step(comb, index as usize, outcome);
                Ok(())
            }
            Reaction::Finally { cleanup, derived } => {
                match self.call(&cleanup, Value::Undef, &[]) {
                    Ok(r) => {
                        let p = self.promise_resolve(r);
                        self.perform_then(p, Reaction::Restore { derived, outcome });
                    }
                    Err(e) => {
                        if self.fatal.is_some() {
                            return Err(e);
                        }
                        self.reject(derived, e);
                    }
                }
                Ok(())
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
