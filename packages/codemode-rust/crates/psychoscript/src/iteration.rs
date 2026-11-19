//! Iteration in bytecode over an iterator the VM does not step itself: one whose `[Symbol.iterator]`, `next` or
//! `return` is the program's (or a helper's, or the host's). The iteration instruction pushes a native frame (see
//! `native.rs`) that makes the call and hands the result back to the instruction's frame as the instruction would:
//! a value pushed, or for a finished `for...of` a jump to its exit, as a finished generator hands its end back
//! (`Vm::generator_done`). A step that fails forgets the iterator first, so it is not closed afterwards.
//!
//! `yield*` and `for await` do the same: a delegated iterator's `next`, `throw` or `return` of the program's, a
//! delegated generator resumed with a `return` or `throw` request, the sync iterator behind an async-from-sync one
//! (its step's promise settled once the call returns), and an async open or close that calls the program.

use crate::native::{Frame, Input, NativeOp, Step};
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{REQ_RETURN, Reaction, Res, Vm};

/// The steps, by the frame's sub-op.
const OPEN: u16 = 0;
const NEXT: u16 = 1;
const STEP: u16 = 2;
const REST: u16 = 3;
const SPREAD: u16 = 4;
const CLOSE: u16 = 5;
/// A delegated iterator's `next`, `throw` or `return` for `yield*` or `for await`, or an async iterator's `return`
/// closing it, called as native code calls: its result is pushed.
const CALL: u16 = 6;
/// A `yield*` over a generator suspended at a `yield` that gets a `return` or `throw` request: the generator resumed
/// with it, its value pushed and the `DelegateResult` after skipped or left through its exit.
const RESUME: u16 = 7;
/// A step of an async-from-sync iterator (`for await` or an async generator's `yield*` over a sync iterable): the sync
/// iterator's method called or its generator resumed, then the step's promise settled from the result.
const ADAPT: u16 = 8;
/// `GetAsyncIter` over a value whose `[Symbol.asyncIterator]` or `[Symbol.iterator]` is the program's.
const ASYNC_OPEN: u16 = 9;

// Slots shared by the steps.
const IT: usize = 0;
const NEXT_FN: usize = 1;
/// The instruction's iterator slot, in its frame.
const SLOT: usize = 2;
/// `for...of`'s exit; for an open or a close, its fuel; for a close, whether it is quiet (`IterCloseQuiet`).
const EXTRA: usize = 3;
/// The values collected so far (an internal array) for a rest element or a spread; for an open, the source.
const OUT: usize = 4;
/// Whether a spread has opened its iterator yet; whether an async open adapts a sync iterator.
const FLAG: usize = 5;

// The slots of a call (`CALL`): its argument, and whether it has one.
const ARG: usize = 0;
const HAS_ARG: usize = 1;

// The slots of a resumed generator (`RESUME`).
const GEN: usize = 0;
const MODE: usize = 1;
const SENT: usize = 2;

// The slots of an async-from-sync step (`ADAPT`): the step's promise, the sync iterator, the request (`REQ_*`), its
// argument and whether it has one, and how the step goes (`BY_*`).
const MADE: usize = 0;
const SYNC: usize = 1;
const KIND: usize = 2;
const SYNC_ARG: usize = 3;
const SYNC_HAS_ARG: usize = 4;
const HOW: usize = 5;
/// The sync iterator's method called as native code calls it.
pub(crate) const BY_UNCOUNTED: usize = 0;
/// Its `next` called as bytecode calls it.
pub(crate) const BY_COUNTED: usize = 1;
/// The sync iterator, a generator, resumed with `next`.
pub(crate) const BY_RESUME: usize = 2;
/// Its `return` called to close it, as it lacks the `throw` asked for: the promise is rejected after.
pub(crate) const BY_CLOSE: usize = 3;

impl Vm {
    /// Whether `it`, kept with `next` in an iterator record, is stepped through a call the VM makes for it: anything
    /// but a built-in iterator stepped directly and a generator.
    pub(crate) fn steps_by_call(&self, it: Slot, next: Slot) -> bool {
        let Some(id) = it.obj() else { return false };
        match self.heap[id as usize].kind {
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. } => !next.get().is_nullish(),
            Kind::Generator(_) => false,
            _ => true,
        }
    }

    /// `GetIter` over a value whose `[Symbol.iterator]` the program wrote: checks it as `get_iterator_in` does, then
    /// pushes a frame that calls it. `None` when opening it makes no call.
    pub(crate) fn open_by_call(&mut self, v: &Value, slot: u32, ctx: u8) -> Option<Res> {
        let method = self.program_iterator_method(v)?;
        if !self.is_iterable(v) {
            return Some(Err(self.not_iterable(v, ctx)));
        }
        if !self.is_callable(&method) {
            return Some(Err(self.type_error("Iterator method must be a function.")));
        }
        let cost = self.open_fuel(v, ctx);
        let slots = [
            Value::Undef,
            Value::Undef,
            Value::Num(slot as f64),
            Value::Num(cost as f64),
            *v,
            Value::Undef,
        ];
        Some(self.enter_native_with(NativeOp::Iteration, OPEN, method, Value::Undef, &slots))
    }

    /// The `[Symbol.iterator]` method opening `v` calls, when it is not one the VM runs itself.
    pub(crate) fn program_iterator_method(&mut self, v: &Value) -> Option<Value> {
        let Value::Obj(id) = v else { return None };
        if self.walks(v)
            || matches!(
                self.heap[*id as usize].kind,
                Kind::Generator(_)
                    | Kind::Arguments(_)
                    | Kind::ArrayIter { .. }
                    | Kind::StrIter { .. }
            )
        {
            return None;
        }
        let f = self.get_obj(*id, SYM_ITERATOR);
        (!f.is_nullish() && !matches!(&f, Value::Obj(m) if matches!(self.heap[*m as usize].kind, Kind::Native { .. })))
            .then_some(f)
    }

    /// `IterNext` (`exit` is its jump), `IterStep` (`exit` none) or `IterRest` (`rest`) over an iterator stepped by a
    /// call: pushes the frame that steps it.
    pub(crate) fn step_by_call(
        &mut self,
        it: Slot,
        next: Slot,
        slot: u32,
        exit: Option<u32>,
        rest: bool,
    ) -> Res {
        let sub = match (exit, rest) {
            (_, true) => REST,
            (Some(_), _) => NEXT,
            (None, _) => STEP,
        };
        let out = if rest {
            self.new_array(Vec::new())
        } else {
            Value::Undef
        };
        let exit = Value::Num(exit.unwrap_or(0) as f64);
        let slots = [
            it.get(),
            next.get(),
            Value::Num(slot as f64),
            exit,
            out,
            Value::Undef,
        ];
        self.enter_native_with(NativeOp::Iteration, sub, Value::Undef, Value::Undef, &slots)
    }

    /// `ArraySpread` of a value opened or stepped by a call into the array below it: pushes the frame that does it.
    pub(crate) fn spread_by_call(&mut self, src: Value) -> Option<Res> {
        let Value::Obj(id) = src else { return None };
        if self.walks(&src) || matches!(self.heap[id as usize].kind, Kind::Generator(_)) {
            return None;
        }
        let method = self.get_obj(id, SYM_ITERATOR);
        let native = matches!(&method, Value::Obj(m) if matches!(self.heap[*m as usize].kind, Kind::Native { .. }));
        let stepped_by_call = matches!(
            self.heap[id as usize].kind,
            Kind::IterHelper(_) | Kind::ExoticIter { .. }
        );
        if native && !stepped_by_call && !matches!(self.heap[id as usize].kind, Kind::Ordinary) {
            return None;
        }
        let slots = [
            Value::Undef,
            Value::Undef,
            Value::Num(0.0),
            Value::Num(0.0),
            src,
            Value::Undef,
        ];
        Some(self.enter_native_with(
            NativeOp::Iteration,
            SPREAD,
            Value::Undef,
            Value::Undef,
            &slots,
        ))
    }

    /// `IterClose` or `IterCloseQuiet` of an iterator closed by a call (a generator suspended at a `yield`, or one with
    /// a `return` method that is not the VM's): pushes the frame that closes it. `None` when closing makes no call.
    pub(crate) fn close_by_call(&mut self, it: &Value, quiet: bool) -> Option<Res> {
        let Value::Obj(id) = it else { return None };
        let call = match &self.heap[*id as usize].kind {
            Kind::Generator(GenState::Suspended(_)) => true,
            Kind::Generator(_)
            | Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. } => false,
            _ => {
                let rk = self.names.return_;
                let f = self.get_obj(*id, rk);
                self.is_callable(&f)
            }
        };
        if !call {
            return None;
        }
        let cost = self.close_fuel(it);
        let slots = [
            *it,
            Value::Undef,
            Value::Num(0.0),
            Value::Num(cost as f64),
            Value::Bool(quiet),
            Value::Undef,
        ];
        Some(self.enter_native_with(
            NativeOp::Iteration,
            CLOSE,
            Value::Undef,
            Value::Undef,
            &slots,
        ))
    }

    /// Whether calling `f` runs code of the program's (or a bound function or namespace path over it), which a frame
    /// calls; a native is called at once.
    pub(crate) fn calls_program(&self, f: &Value) -> bool {
        matches!(f, Value::Obj(id) if self.heap[*id as usize].is_callable()
            && !matches!(self.heap[*id as usize].kind, Kind::Native { .. }))
    }

    /// `DelegateCall` or `AsyncClose` calling the iterator's method `m` (see `calls_program`) on `it`, with `arg` if
    /// any: pushes the frame that calls it and pushes its result for the instruction.
    pub(crate) fn delegate_by_call(&mut self, m: Value, it: Value, arg: Option<Value>) -> Res {
        let slots = [arg.unwrap_or_default(), Value::Bool(arg.is_some())];
        self.enter_native_with(NativeOp::Iteration, CALL, m, it, &slots)
    }

    /// `DelegateCall` with a `return` (`mode` 1) or `throw` (2) request for the suspended generator `g`: pushes the
    /// frame that resumes it.
    pub(crate) fn resume_delegate_by_frame(&mut self, g: Id, mode: u8, sent: Value) -> Res {
        let slots = [Value::Obj(g), Value::Num(mode as f64), sent];
        self.enter_native_with(
            NativeOp::Iteration,
            RESUME,
            Value::Undef,
            Value::Undef,
            &slots,
        )
    }

    /// A step of an async-from-sync iterator over `sync` that calls the program or resumes a generator (`how` is one
    /// of `BY_*`; `m` the method to call): pushes the frame that takes it and settles `made` after.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn adapt_by_frame(
        &mut self,
        how: usize,
        made: Id,
        sync: Id,
        kind: u8,
        arg: Option<Value>,
        m: Value,
    ) -> Res {
        let slots = [
            Value::Obj(made),
            Value::Obj(sync),
            Value::Num(kind as f64),
            arg.unwrap_or_default(),
            Value::Bool(arg.is_some()),
            Value::Num(how as f64),
        ];
        self.enter_native_with(NativeOp::Iteration, ADAPT, m, Value::Undef, &slots)
    }

    /// Settles the promise `made` of an async-from-sync step from the sync iterator's answer: with the value once it
    /// resolved (closing the iterator if that fails and it is not done), or rejected with what the step threw.
    pub(crate) fn settle_from_sync(
        &mut self,
        made: Id,
        sync: Id,
        kind: u8,
        step: Result<(Value, bool), Value>,
    ) -> Result<(), Value> {
        match step {
            Ok((v, done)) => {
                let close = (kind != REQ_RETURN && !done).then_some(sync);
                let w = self.promise_resolve(v);
                self.perform_then(w, Reaction::FromSync { made, done, close });
            }
            Err(e) => {
                if self.fatal.is_some() {
                    return Err(e);
                }
                self.reject(made, e);
            }
        }
        Ok(())
    }

    /// `GetAsyncIter` opening `v` with the program's `method`: its `[Symbol.asyncIterator]`, or with `sync_open` (the
    /// open's fuel) its `[Symbol.iterator]`, whose iterator is adapted. Pushes the frame that calls it and writes the
    /// instruction's iterator record.
    pub(crate) fn open_async_by_call(
        &mut self,
        method: Value,
        v: Value,
        slot: u32,
        sync_open: Option<i32>,
    ) -> Res {
        let slots = [
            Value::Undef,
            Value::Undef,
            Value::Num(slot as f64),
            Value::Num(sync_open.unwrap_or(0) as f64),
            v,
            Value::Bool(sync_open.is_some()),
        ];
        self.enter_native_with(NativeOp::Iteration, ASYNC_OPEN, method, v, &slots)
    }
}

/// The step of an iteration frame.
pub(crate) fn step(vm: &mut Vm, sub: u16, fr: Frame, input: Input) -> Result<Step, Value> {
    match sub {
        OPEN => open_step(vm, fr, input),
        NEXT | STEP | REST => next_step(vm, sub, fr, input),
        SPREAD => spread_step(vm, fr, input),
        CLOSE => close_step(vm, fr, input),
        CALL => call_step(vm, fr, input),
        RESUME => resume_step(vm, fr, input),
        ADAPT => adapt_step(vm, fr, input),
        ASYNC_OPEN => async_open_step(vm, fr, input),
        _ => Ok(Step::Done(Value::Undef)),
    }
}

/// The frame below the iteration frame: the instruction's.
fn caller(vm: &Vm) -> usize {
    vm.frames.len().saturating_sub(2)
}

/// Writes the instruction's iterator slot (and the slot after it, its record's `next`).
fn set_caller_slot(vm: &mut Vm, fr: Frame, k: usize, v: Slot) {
    let c = caller(vm);
    let at = vm.frames[c].base + fr.index(vm, SLOT) + k;
    if let Some(s) = vm.stack.get_mut(at) {
        *s = v;
    }
}

fn open_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (f, src) = (fr.callee(vm), fr.slot(vm, OUT));
            fr.call_slots_as(vm, f, src, [], Step::CallUncounted)
        }
        Input::Returned(r) => {
            let it = r.get();
            let Value::Obj(id) = it else {
                return Err(vm.type_error("Iterator method result must be an object."));
            };
            let nk = vm.names.next;
            let next = vm.get_obj(id, nk);
            if !vm.is_callable(&next) {
                return Err(vm.type_error("Iterator next must be a function."));
            }
            vm.fuel(fr.index(vm, EXTRA) as i32);
            let src = fr.get(vm, OUT);
            let next = vm.record_next_of(&src, &it)?;
            set_caller_slot(vm, fr, 0, Slot::pack(it));
            set_caller_slot(vm, fr, 1, Slot::pack(next));
            Ok(Step::DoneEmpty)
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::DoneEmpty),
    }
}

/// Calls the iterator's `next` as `Vm::iter_step_with` does: the VM's own iterators and helpers without a native's
/// fifty, any other as bytecode calls it. A throw comes back to the frame, which forgets the iterator.
fn call_next(vm: &mut Vm, fr: Frame, it: Slot, next: Slot) -> Result<Step, Value> {
    let id = it.obj().unwrap_or(0);
    let direct = next.get().is_nullish();
    let f = if direct {
        let nk = vm.names.next;
        Slot::pack(vm.get_obj(id, nk))
    } else {
        next
    };
    let uncounted = match vm.heap[id as usize].kind {
        Kind::IterHelper(_) => true,
        Kind::ExoticIter { .. } => direct,
        _ => false,
    };
    let sp = (vm.stack.len() - fr.base()) as u32;
    vm.handlers_mut().push(crate::vm::Handler {
        pc: crate::native::THREW as u32,
        sp,
    });
    let mode = if uncounted {
        Step::CallUncounted
    } else {
        Step::Call
    };
    fr.call_slots_as(vm, f, it, [], mode)
}

/// What a `next()` result says: its value, or `None` when done.
fn result_of(vm: &mut Vm, r: Slot) -> Result<Option<Value>, Value> {
    let Some(rid) = r.obj() else {
        return Err(vm.type_error("Iterator next() result must be an object."));
    };
    let (dk, vk) = (vm.names.done, vm.names.value);
    let d = vm.get_obj(rid, dk);
    if vm.truthy(&d) {
        return Ok(None);
    }
    Ok(Some(vm.get_obj(rid, vk)))
}

fn next_step(vm: &mut Vm, sub: u16, fr: Frame, input: Input) -> Result<Step, Value> {
    let (it, next) = (fr.slot(vm, IT), fr.slot(vm, NEXT_FN));
    let got = match input {
        Input::Start => return call_next(vm, fr, it, next),
        Input::Returned(r) => result_of(vm, r),
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(None),
    };
    let got = match got {
        Ok(g) => g,
        Err(e) => {
            set_caller_slot(vm, fr, 0, Slot::UNDEF);
            return Err(e);
        }
    };
    match (sub, got) {
        (REST, Some(v)) => {
            let out = fr.slot(vm, OUT).obj().unwrap_or(0);
            if let Kind::Array(items) = &mut vm.heap[out as usize].kind {
                items.push(v);
            }
            call_next(vm, fr, it, next)
        }
        (REST, None) => {
            set_caller_slot(vm, fr, 0, Slot::UNDEF);
            Ok(Step::Done(fr.get(vm, OUT)))
        }
        (_, Some(v)) => Ok(Step::Done(v)),
        (NEXT, None) => {
            set_caller_slot(vm, fr, 0, Slot::UNDEF);
            let c = caller(vm);
            vm.frames[c].pc = fr.index(vm, EXTRA);
            Ok(Step::DoneEmpty)
        }
        (_, None) => {
            set_caller_slot(vm, fr, 0, Slot::UNDEF);
            Ok(Step::Done(Value::Undef))
        }
    }
}

/// A spread: opened as `iterate_to_vec` opens it, then stepped to its end, its values appended to the array below.
fn spread_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let src = fr.get(vm, OUT);
            if let Some(method) = vm.program_iterator_method(&src) {
                if !vm.is_callable(&method) {
                    return Err(vm.type_error("Iterator method must be a function."));
                }
                fr.set_index(vm, FLAG, 1);
                return fr.call_slots_as(
                    vm,
                    Slot::pack(method),
                    Slot::pack(src),
                    [],
                    Step::CallUncounted,
                );
            }
            let it = vm.get_iterator(&src)?;
            let next = vm.record_next_of(&src, &it)?;
            fr.set(vm, IT, it);
            fr.set(vm, NEXT_FN, next);
            let out = vm.new_array(Vec::new());
            fr.set(vm, OUT, out);
        }
        Input::Returned(r) if fr.index(vm, FLAG) == 1 => {
            // The opening call returned the iterator.
            let it = r.get();
            let Value::Obj(id) = it else {
                return Err(vm.type_error("Iterator method result must be an object."));
            };
            let nk = vm.names.next;
            let next = vm.get_obj(id, nk);
            if !vm.is_callable(&next) {
                return Err(vm.type_error("Iterator next must be a function."));
            }
            let src = fr.get(vm, OUT);
            let next = vm.record_next_of(&src, &it)?;
            fr.set(vm, IT, it);
            fr.set(vm, NEXT_FN, next);
            fr.set_index(vm, FLAG, 0);
            let out = vm.new_array(Vec::new());
            fr.set(vm, OUT, out);
        }
        Input::Returned(r) => match result_of(vm, r)? {
            Some(v) => {
                let out = fr.slot(vm, OUT).obj().unwrap_or(0);
                if let Kind::Array(items) = &mut vm.heap[out as usize].kind {
                    if items.len() >= crate::ops::MAX_ARRAY_LEN {
                        return Err(vm.range_error("Invalid array length"));
                    }
                    items.push(v);
                }
            }
            None => return spread_done(vm, fr),
        },
        Input::Threw(e) => return Err(e),
        Input::Finished(_) => return spread_done(vm, fr),
    }
    let (it, next) = (fr.slot(vm, IT), fr.slot(vm, NEXT_FN));
    if !vm.steps_by_call(it, next) {
        // The VM steps it itself after all: the rest of it at once.
        let (itv, nextv) = (it.get(), next.get());
        let out = fr.slot(vm, OUT).obj().unwrap_or(0);
        while let Some(v) = vm.iter_step_with(&itv, nextv)? {
            if let Kind::Array(items) = &mut vm.heap[out as usize].kind {
                if items.len() >= crate::ops::MAX_ARRAY_LEN {
                    return Err(vm.range_error("Invalid array length"));
                }
                items.push(v);
            }
        }
        return spread_done(vm, fr);
    }
    let id = it.obj().unwrap_or(0);
    let direct = next.get().is_nullish();
    let f = if direct {
        let nk = vm.names.next;
        Slot::pack(vm.get_obj(id, nk))
    } else {
        next
    };
    let uncounted = match vm.heap[id as usize].kind {
        Kind::IterHelper(_) => true,
        Kind::ExoticIter { .. } => direct,
        _ => false,
    };
    let mode = if uncounted {
        Step::CallUncounted
    } else {
        Step::Call
    };
    fr.call_slots_as(vm, f, it, [], mode)
}

/// Appends a spread's values to the array below the frame's callee and receiver.
fn spread_done(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let items = match fr
        .slot(vm, OUT)
        .obj()
        .map(|o| &mut vm.heap[o as usize].kind)
    {
        Some(Kind::Array(items)) => std::mem::take(items),
        _ => Vec::new(),
    };
    let target = vm.stack[fr.base() - 3].obj();
    if let Some(Kind::Array(arr)) = target.map(|t: Id| &mut vm.heap[t as usize].kind) {
        arr.extend(items);
    }
    Ok(Step::DoneEmpty)
}

/// A close: the generator resumed with a return, or the iterator's `return` called as native code calls it; then its
/// fuel. A quiet close ignores how it went; a plain one throws what it threw, after the fuel.
fn close_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let it = fr.get(vm, IT);
    let quiet = matches!(fr.get(vm, OUT), Value::Bool(true));
    let outcome = match input {
        Input::Start => {
            let Value::Obj(id) = it else {
                return Ok(Step::DoneEmpty);
            };
            if matches!(vm.heap[id as usize].kind, Kind::Generator(_)) {
                let sp = (vm.stack.len() - fr.base()) as u32;
                vm.handlers_mut().push(crate::vm::Handler {
                    pc: crate::native::THREW as u32,
                    sp,
                });
                return match vm.native_resume(id, 1, Value::Undef) {
                    Ok(None) => Ok(Step::Pushed),
                    Ok(Some(_)) => close_done(vm, fr, Ok(()), quiet),
                    Err(e) => close_done(vm, fr, Err(e), quiet),
                };
            }
            let rk = vm.names.return_;
            let f = Slot::pack(vm.get_obj(id, rk));
            let sp = (vm.stack.len() - fr.base()) as u32;
            vm.handlers_mut().push(crate::vm::Handler {
                pc: crate::native::THREW as u32,
                sp,
            });
            return fr.call_slots_as(vm, f, Slot::pack(it), [], Step::CallUncounted);
        }
        Input::Returned(r) => {
            let generator = matches!(it, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Generator(_)));
            if !generator && r.obj().is_none() {
                Err(vm.type_error("Iterator return() result must be an object."))
            } else {
                Ok(())
            }
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(()),
    };
    close_done(vm, fr, outcome, quiet)
}

fn close_done(
    vm: &mut Vm,
    fr: Frame,
    outcome: Result<(), Value>,
    quiet: bool,
) -> Result<Step, Value> {
    vm.fuel(fr.index(vm, EXTRA) as i32);
    match outcome {
        Err(e) if !quiet || vm.fatal.is_some() => Err(e),
        _ => Ok(Step::DoneEmpty),
    }
}

/// Calls the frame's callee on its receiver, with its argument if it has one, as `mode` asks. A closure costs the
/// same either way, so its frame is pushed at once.
fn call_with_arg(
    vm: &mut Vm,
    fr: Frame,
    this: Slot,
    arg: Option<Slot>,
    mode: fn(usize) -> Step,
) -> Result<Step, Value> {
    let f = fr.callee(vm);
    if f.obj()
        .is_some_and(|id| matches!(vm.heap[id as usize].kind, Kind::Closure(_)))
    {
        return match arg {
            Some(a) => fr.call_slots(vm, f, this, [a]),
            None => fr.call_slots(vm, f, this, []),
        };
    }
    match arg {
        Some(a) => fr.call_slots_as(vm, f, this, [a], mode),
        None => fr.call_slots_as(vm, f, this, [], mode),
    }
}

/// A delegated iterator's method: its result goes to the instruction as it is.
fn call_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let arg = matches!(fr.get(vm, HAS_ARG), Value::Bool(true)).then(|| fr.slot(vm, ARG));
            let this = fr.this_slot(vm);
            call_with_arg(vm, fr, this, arg, Step::CallUncounted)
        }
        Input::Returned(r) | Input::Finished(r) => Ok(Step::Done(r.get())),
        Input::Threw(e) => Err(e),
    }
}

/// A delegated generator resumed with a `return` or `throw` request: what it yields or returns goes to the
/// instruction as a value and a done flag, as `Vm::sync_delegate_step` hands them over.
fn resume_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let (v, done) = match input {
        Input::Start => {
            let g = fr.slot(vm, GEN).obj().unwrap_or(0);
            let (mode, sent) = (fr.index(vm, MODE) as u8, fr.get(vm, SENT));
            match crate::builtins::collections::resume_catching(vm, fr, g, mode, sent)? {
                None => return Ok(Step::Pushed),
                Some(step) => step,
            }
        }
        Input::Returned(r) => (r.get(), false),
        Input::Finished(r) => (r.get(), true),
        Input::Threw(e) => return Err(e),
    };
    // The value is pushed; a done one leaves through the following `DelegateResult`'s exit, else it is skipped.
    let c = caller(vm);
    let f = &mut vm.frames[c];
    f.pc = match f.func.code.get(f.pc) {
        Some(crate::bytecode::Op::DelegateResult(exit, _)) if done => *exit as usize,
        _ => crate::vm::delegate_continue(&f.func.code, f.pc + 1),
    };
    Ok(Step::Done(v))
}

/// An async-from-sync step: the sync iterator's answer, or what its step threw, settles the step's promise, which
/// goes to the instruction.
fn adapt_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let how = fr.index(vm, HOW);
    let made = fr.slot(vm, MADE).obj().unwrap_or(0);
    let sync = fr.slot(vm, SYNC).obj().unwrap_or(0);
    let kind = fr.index(vm, KIND) as u8;
    let step = match input {
        Input::Start if how == BY_RESUME => {
            let arg = fr.get(vm, SYNC_ARG);
            match crate::builtins::collections::resume_catching(vm, fr, sync, 0, arg) {
                Ok(None) => return Ok(Step::Pushed),
                Ok(Some(step)) => Ok(step),
                Err(e) => Err(e),
            }
        }
        Input::Start => {
            let sp = (vm.stack.len() - fr.base()) as u32;
            vm.handlers_mut().push(crate::vm::Handler {
                pc: crate::native::THREW as u32,
                sp,
            });
            let arg = matches!(fr.get(vm, SYNC_HAS_ARG), Value::Bool(true))
                .then(|| fr.slot(vm, SYNC_ARG));
            let mode = if how == BY_COUNTED {
                Step::Call
            } else {
                Step::CallUncounted
            };
            return call_with_arg(vm, fr, fr.slot(vm, SYNC), arg, mode);
        }
        Input::Returned(r) => match how {
            BY_RESUME => Ok((r.get(), false)),
            BY_CLOSE if r.obj().is_none() => {
                Err(vm.type_error("Iterator return() result must be an object."))
            }
            BY_CLOSE => {
                Err(vm.type_error("The delegated iterator does not provide a throw() method."))
            }
            _ => vm.iter_result_parts(&r.get(), kind),
        },
        Input::Finished(r) => Ok((r.get(), true)),
        Input::Threw(e) => Err(e),
    };
    if how == BY_CLOSE {
        // Closing ends in a rejection either way: with what it threw, or for the missing `throw`.
        if let Err(e) = step {
            vm.reject(made, e);
        }
        return Ok(Step::Done(Value::Obj(made)));
    }
    vm.settle_from_sync(made, sync, kind, step)?;
    Ok(Step::Done(Value::Obj(made)))
}

/// An async open: the method returned the iterator, checked as `Vm::open_with` checks it, then kept in the
/// instruction's iterator record, adapted when it is a sync one.
fn async_open_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let r = match input {
        Input::Start => {
            let (f, src) = (fr.callee(vm), fr.slot(vm, OUT));
            return fr.call_slots_as(vm, f, src, [], Step::CallUncounted);
        }
        Input::Returned(r) => r,
        Input::Threw(e) => return Err(e),
        Input::Finished(_) => return Ok(Step::DoneEmpty),
    };
    let Value::Obj(id) = r.get() else {
        return Err(vm.type_error("Iterator method result must be an object."));
    };
    let nk = vm.names.next;
    let next = vm.get_obj(id, nk);
    if !vm.is_callable(&next) {
        return Err(vm.type_error("Iterator next must be a function."));
    }
    let it = if matches!(fr.get(vm, FLAG), Value::Bool(true)) {
        vm.fuel(fr.index(vm, EXTRA) as i32);
        let src = fr.get(vm, OUT);
        let next = vm.record_next_of(&src, &Value::Obj(id))?;
        let proto = vm.realm.async_from_sync_proto;
        Value::Obj(vm.alloc(Obj::new(
            Some(proto),
            Kind::AsyncFromSync { sync: id, next },
        )))
    } else {
        // The reference calls the method as bytecode calls it.
        if !vm.is_closure(&fr.callee(vm).get()) {
            vm.fuel(crate::vm::NATIVE_FUEL);
        }
        Value::Obj(id)
    };
    let next = vm.record_next(&it)?;
    set_caller_slot(vm, fr, 0, Slot::pack(it));
    set_caller_slot(vm, fr, 1, Slot::pack(next));
    Ok(Step::DoneEmpty)
}
