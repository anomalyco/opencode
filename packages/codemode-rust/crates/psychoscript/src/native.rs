//! Native frames: built-ins that call back into the program, run by the dispatch loop like bytecode.
//!
//! A built-in that calls a callback (`Array.prototype.map`), a conversion method or a promise handler does not call it
//! from Rust. It checks its arguments, then pushes a native frame (`Vm::enter_native`) holding its state in the frame's
//! slots, as a bytecode frame holds its locals: the callback, the index, the accumulator. The dispatch loop runs the
//! built-in's step function whenever the frame is on top, instead of code. A step either asks for a call, whose frame the
//! loop pushes above it as a call from bytecode, or finishes with the built-in's result, which the caller receives as
//! a native's. When the called frame returns, the step function runs again with its value; when it throws past a
//! handler the step pushed, with what it threw.
//!
//! No Rust frame waits on a callback, so a native frame parks for `search(...)`, suspends and snapshots like any
//! other: a snapshot saves its slots with the stack and its step function by `NativeOp`.

use crate::bytecode::{FuncProto, Op};

/// Where a native frame continues, as its `pc`: with the value a call returned, with what a call threw (the `pc` of
/// the handlers it pushes), or from the start.
pub const RETURNED: usize = 0;
pub const THREW: usize = 1;
pub const START: usize = 2;
/// With the completion value of a generator it resumed (`Vm::native_resume`).
pub const FINISHED: usize = 3;
use crate::value::{Slot, Value};
use crate::vm::{Res, Vm};

/// The step function a native frame runs, saved by its number in snapshots.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub enum NativeOp {
    /// The callback methods of arrays that visit each index (`forEach`, `map`, `filter`, `some`, `every`, the find
    /// methods): see `builtins::array::each_step`.
    ArrayEach,
    /// `reduce` and `reduceRight`.
    ArrayReduce,
    /// A sort with a comparator.
    SortWith,
    /// `Array.from` over an iterable.
    ArrayFromIterable,
    /// `new Map(iterable)` and `new Set(iterable)`.
    FillCollection,
    /// A promise handler, a `finally` cleanup, a thenable job, an executor or a `Promise.try` callback.
    Settle,
}

const OPS: [NativeOp; 6] = [
    NativeOp::ArrayEach,
    NativeOp::ArrayReduce,
    NativeOp::SortWith,
    NativeOp::ArrayFromIterable,
    NativeOp::FillCollection,
    NativeOp::Settle,
];

impl NativeOp {
    pub fn code(self) -> u16 {
        self as u16
    }

    pub fn from_code(code: u16) -> Option<Self> {
        OPS.get(code as usize).copied()
    }
}

/// What a native frame continues with.
pub enum Input {
    /// It was just pushed.
    Start,
    /// The call it asked for returned this.
    Returned(Slot),
    /// The call it asked for threw this, which a handler it pushed (`catching`) caught.
    Threw(Value),
    /// The generator it resumed finished.
    Finished,
}

/// What a step asks of the loop.
pub enum Step {
    /// Call the callee pushed above the frame's slots, with its receiver and this many arguments (see `call`).
    Call(usize),
    /// The frame of the call was pushed already.
    Pushed,
    /// `Call`, as native code calls: a native costs no fifty.
    CallUncounted(usize),
    /// `Call`, as the reference enters a promise handler (`enterSettlingCall`): a plain function's frame and a
    /// promise's resolve function for nothing, anything else as bytecode calls it.
    CallSettling(usize),
    /// The built-in's result: the frame is popped and its caller receives this.
    Done(Value),
}

/// The code of every native frame, which never runs: one instruction for each place it continues from.
pub fn proto() -> FuncProto {
    FuncProto {
        name: 0,
        code: vec![Op::Nop; 4],
        pos: Vec::new(),
        nparams: 0,
        length: 0,
        nlocals: 0,
        captures: Vec::new(),
        is_async: false,
        is_generator: false,
        is_arrow: false,
        is_program: false,
        needs_extra: false,
        callees: Vec::new(),
    }
}

pub fn step(vm: &mut Vm, op: NativeOp, base: usize, input: Input) -> Result<Step, Value> {
    let frame = Frame(base);
    match op {
        NativeOp::ArrayEach => crate::builtins::array::each_step(vm, frame, input),
        NativeOp::ArrayReduce => crate::builtins::array::reduce_step(vm, frame, input),
        NativeOp::SortWith => crate::builtins::array::sort_step(vm, frame, input),
        NativeOp::ArrayFromIterable => {
            for_of_step::<crate::builtins::array::ArrayFromIterable>(vm, frame, input)
        }
        NativeOp::FillCollection => {
            for_of_step::<crate::builtins::collections::FillCollection>(vm, frame, input)
        }
        NativeOp::Settle => crate::promise::settle_step(vm, frame, input),
    }
}

/// A native frame's slots, by index: what the built-in passed to `enter_native`, then anything it keeps.
#[derive(Clone, Copy)]
pub struct Frame(usize);

impl Frame {
    #[inline]
    pub fn get(self, vm: &Vm, k: usize) -> Value {
        vm.stack[self.0 + k].get()
    }

    /// Where the frame's slots start on the stack.
    #[inline(always)]
    pub fn base(self) -> usize {
        self.0
    }

    #[inline(always)]
    pub fn slot(self, vm: &Vm, k: usize) -> Slot {
        vm.stack[self.0 + k]
    }

    #[inline(always)]
    pub fn set_slot(self, vm: &mut Vm, k: usize, s: Slot) {
        vm.stack[self.0 + k] = s;
    }

    /// A slot holding an index or a count.
    #[inline(always)]
    pub fn index(self, vm: &Vm, k: usize) -> usize {
        vm.stack[self.0 + k].f() as usize
    }

    #[inline(always)]
    pub fn set_index(self, vm: &mut Vm, k: usize, i: usize) {
        vm.stack[self.0 + k] = Slot::index(i);
    }

    #[inline(always)]
    pub fn this_slot(self, vm: &Vm) -> Slot {
        vm.stack[self.0 - 1]
    }

    /// Calls `f` with `this` and `args`, as a call instruction would; the frame's next step receives the result.
    #[inline(always)]
    pub fn call_slots<const N: usize>(
        self,
        vm: &mut Vm,
        f: Slot,
        this: Slot,
        args: [Slot; N],
    ) -> Result<Step, Value> {
        vm.stack.extend_from_slice(&[f, this]);
        vm.stack.extend_from_slice(&args);
        vm.native_call(N)
    }

    /// `call_slots` with another kind of call (`Step::CallUncounted`, `Step::CallSettling`).
    pub fn call_slots_as<const N: usize>(
        self,
        vm: &mut Vm,
        f: Slot,
        this: Slot,
        args: [Slot; N],
        mode: fn(usize) -> Step,
    ) -> Result<Step, Value> {
        vm.stack.extend_from_slice(&[f, this]);
        vm.stack.extend_from_slice(&args);
        Ok(mode(N))
    }

    /// `call_slots`, with what the call throws coming back to this frame as `Input::Threw`.
    pub fn catching<const N: usize>(
        self,
        vm: &mut Vm,
        f: Slot,
        this: Slot,
        args: [Slot; N],
    ) -> Result<Step, Value> {
        let sp = (vm.stack.len() - self.0) as u32;
        vm.handlers_mut().push(crate::vm::Handler {
            pc: THREW as u32,
            sp,
        });
        self.call_slots(vm, f, this, args)
    }

    /// A call of `f` with any number of arguments, of the kind `mode` asks for, with what it throws coming back to this
    /// frame as `Input::Threw`.
    pub fn catching_list(
        self,
        vm: &mut Vm,
        f: Slot,
        this: Slot,
        args: &[Slot],
        mode: fn(usize) -> Step,
    ) -> Step {
        let sp = (vm.stack.len() - self.0) as u32;
        vm.handlers_mut().push(crate::vm::Handler {
            pc: THREW as u32,
            sp,
        });
        vm.stack.extend_from_slice(&[f, this]);
        vm.stack.extend_from_slice(args);
        mode(args.len())
    }

    #[inline(always)]
    pub fn set(self, vm: &mut Vm, k: usize, v: Value) {
        vm.stack[self.0 + k] = Slot::pack(v);
    }
}

/// A built-in that iterates a value as the reference's prelude does with `for...of` (see `fuel::for_of`): opened as
/// the reference opens it, stepped one value at a time, closed when the built-in stops early or its body throws.
/// Its frame's first `FOR_OF_SLOTS` slots are the loop's; its own follow.
pub trait ForOf {
    /// One value from the iterator.
    fn item(vm: &mut Vm, fr: Frame, x: Value) -> Result<Flow, Value>;
    /// The result of the call `item` or `returned` asked for with `Flow::Call`.
    fn returned(_vm: &mut Vm, _fr: Frame, _r: Slot) -> Result<Flow, Value> {
        Ok(Flow::Next)
    }
    /// The built-in's result once the iterator is done.
    fn finish(vm: &mut Vm, fr: Frame) -> Res;
}

/// What a `ForOf` body does next.
pub enum Flow {
    /// Go on to the next value (after a back-edge).
    Next,
    /// The body called `Frame::catching` and waits for its result (`ForOf::returned`); a throw closes the iterator.
    Call(Step),
}

const LOOP_SOURCE: usize = 0;
const LOOP_IT: usize = 1;
const LOOP_NEXT: usize = 2;
const LOOP_PHASE: usize = 3;
/// Opening: the fuel the open costs once the method returned. Closing: the error to throw once closed, or the result.
const LOOP_STASH: usize = 4;
pub const FOR_OF_SLOTS: usize = 5;

/// Where a loop is: what the call it waits on, if any, is for.
const OPENING: usize = 0;
const STEPPING: usize = 1;
const BODY: usize = 2;
const CLOSING: usize = 3;
const CLOSING_THROW: usize = 4;
const STEP: usize = 5;
const START_LOOP: usize = 6;

/// Pushes a `ForOf` frame over `source`, with the built-in's own slots after the loop's.
pub fn enter_for_of(
    vm: &mut Vm,
    op: NativeOp,
    callee: crate::value::Id,
    this: Value,
    source: Value,
    own: &[Value],
) -> Res {
    let mut slots = vec![
        source,
        Value::Undef,
        Value::Undef,
        Value::Num(START_LOOP as f64),
        Value::Undef,
    ];
    slots.extend_from_slice(own);
    vm.enter_native(op, callee, this, &slots)
}

/// The step of a `ForOf` frame.
pub fn for_of_step<C: ForOf>(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let mut phase = fr.index(vm, LOOP_PHASE);
    let mut flow = None;
    match input {
        Input::Start => {}
        Input::Returned(r) => match phase {
            OPENING => {
                let it = r.get();
                let Value::Obj(id) = it else {
                    return Err(vm.type_error("Iterator method result must be an object."));
                };
                let nk = vm.names.next;
                let next = vm.get_obj(id, nk);
                if !vm.is_callable(&next) {
                    return Err(vm.type_error("Iterator next must be a function."));
                }
                let open = fr.index(vm, LOOP_STASH) as i32;
                vm.fuel(open);
                let source = fr.get(vm, LOOP_SOURCE);
                let next = vm.record_next_of(&source, &it)?;
                fr.set(vm, LOOP_IT, it);
                fr.set(vm, LOOP_NEXT, next);
                phase = STEP;
            }
            STEPPING => {
                let Some(rid) = r.obj() else {
                    return Err(vm.type_error("Iterator next() result must be an object."));
                };
                let (dk, vk) = (vm.names.done, vm.names.value);
                let d = vm.get_obj(rid, dk);
                if vm.truthy(&d) {
                    return Ok(Step::Done(C::finish(vm, fr)?));
                }
                let v = vm.get_obj(rid, vk);
                flow = Some(body::<C>(vm, fr, |vm, fr| C::item(vm, fr, v)));
            }
            // A generator yielded.
            STEP => flow = Some(body::<C>(vm, fr, |vm, fr| C::item(vm, fr, r.get()))),
            BODY => flow = Some(body::<C>(vm, fr, |vm, fr| C::returned(vm, fr, r))),
            CLOSING => return close_done(vm, fr, Some(r)),
            _ => return close_done(vm, fr, None),
        },
        Input::Finished => match phase {
            STEP => return Ok(Step::Done(C::finish(vm, fr)?)),
            CLOSING => return close_done(vm, fr, None),
            _ => return close_done(vm, fr, None),
        },
        Input::Threw(e) => match phase {
            BODY => return close(vm, fr, Err(e)),
            // A failing close of a loop that threw keeps the loop's error.
            _ => return close_done(vm, fr, None),
        },
    }
    if phase == START_LOOP {
        let source = fr.get(vm, LOOP_SOURCE);
        let open = vm.open_fuel(&source, crate::bytecode::ITER_FOR_OF);
        let method = match source {
            Value::Obj(id) if !vm.walks(&source) && !is_builtin_iterator(vm, id) => {
                vm.get_obj(id, crate::object::SYM_ITERATOR)
            }
            _ => Value::Undef,
        };
        if method.is_nullish() {
            let it = vm.get_iterator(&source)?;
            vm.fuel(open);
            let next = vm.record_next_of(&source, &it)?;
            fr.set(vm, LOOP_IT, it);
            fr.set(vm, LOOP_NEXT, next);
        } else {
            if !vm.is_callable(&method) {
                return Err(vm.type_error("Iterator method must be a function."));
            }
            fr.set_index(vm, LOOP_STASH, open as usize);
            fr.set_index(vm, LOOP_PHASE, OPENING);
            return fr.call_slots_as(
                vm,
                Slot::pack(method),
                Slot::pack(source),
                [],
                Step::CallUncounted,
            );
        }
    }
    loop {
        match flow.take() {
            None => {}
            Some(Err(e)) => return close(vm, fr, Err(e)),
            Some(Ok(Flow::Next)) => crate::builtins::fuel::step(vm),
            Some(Ok(Flow::Call(step))) => {
                fr.set_index(vm, LOOP_PHASE, BODY);
                return Ok(step);
            }
        }
        // The next value.
        let (it, next) = (fr.get(vm, LOOP_IT), fr.get(vm, LOOP_NEXT));
        let Value::Obj(id) = it else {
            return Ok(Step::Done(C::finish(vm, fr)?));
        };
        let direct = next.is_nullish();
        let kind = &vm.heap[id as usize].kind;
        use crate::object::Kind;
        let stepped = match kind {
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
                if direct =>
            {
                None
            }
            Kind::Generator(_) => {
                fr.set_index(vm, LOOP_PHASE, STEP);
                match vm.native_resume(id, 0, Value::Undef)? {
                    None => return Ok(Step::Pushed),
                    Some((_, true)) => return Ok(Step::Done(C::finish(vm, fr)?)),
                    Some((v, false)) => Some(v),
                }
            }
            _ => {
                let uncounted = match kind {
                    Kind::IterHelper(_) => true,
                    Kind::ExoticIter { .. } => direct,
                    _ => false,
                };
                let f = if direct {
                    let nk = vm.names.next;
                    vm.get_obj(id, nk)
                } else {
                    next
                };
                fr.set_index(vm, LOOP_PHASE, STEPPING);
                let mode = if uncounted {
                    Step::CallUncounted
                } else {
                    Step::Call
                };
                return fr.call_slots_as(vm, Slot::pack(f), Slot::pack(it), [], mode);
            }
        };
        let x = match stepped {
            Some(v) => v,
            None => match vm.iter_step_with(&it, next)? {
                Some(v) => v,
                None => return Ok(Step::Done(C::finish(vm, fr)?)),
            },
        };
        flow = Some(body::<C>(vm, fr, |vm, fr| C::item(vm, fr, x)));
    }
}

/// Runs a body hook, closing the iterator if it fails before calling anything.
fn body<C: ForOf>(
    vm: &mut Vm,
    fr: Frame,
    f: impl FnOnce(&mut Vm, Frame) -> Result<Flow, Value>,
) -> Result<Flow, Value> {
    fr.set_index(vm, LOOP_PHASE, BODY);
    f(vm, fr)
}

fn is_builtin_iterator(vm: &Vm, id: crate::value::Id) -> bool {
    use crate::object::Kind;
    matches!(
        vm.heap[id as usize].kind,
        Kind::Generator(_)
            | Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::Arguments(_)
    )
}

/// Closes the loop's iterator: after the loop stopped with `Ok(result)`, or threw `Err(error)` (unless fatal).
fn close(vm: &mut Vm, fr: Frame, outcome: Result<Value, Value>) -> Result<Step, Value> {
    if let Err(e) = &outcome
        && vm.fatal.is_some()
    {
        return Err(*e);
    }
    let throwing = outcome.is_err();
    let stash = match outcome {
        Ok(v) | Err(v) => v,
    };
    fr.set(vm, LOOP_STASH, stash);
    fr.set_index(
        vm,
        LOOP_PHASE,
        if throwing { CLOSING_THROW } else { CLOSING },
    );
    let it = fr.get(vm, LOOP_IT);
    let Value::Obj(id) = it else {
        return close_done(vm, fr, None);
    };
    use crate::object::{GenState, Kind};
    match &vm.heap[id as usize].kind {
        Kind::Generator(GenState::Suspended(_)) => match vm.native_resume(id, 1, Value::Undef) {
            Ok(None) => Ok(Step::Pushed),
            Ok(Some(_)) => close_done(vm, fr, None),
            Err(e) if throwing => {
                let _ = e;
                close_done(vm, fr, None)
            }
            Err(e) => Err(e),
        },
        Kind::Generator(_)
        | Kind::ArrayIter { .. }
        | Kind::MapIter { .. }
        | Kind::StrIter { .. }
        | Kind::ListIter { .. } => close_done(vm, fr, None),
        _ => {
            let rk = vm.names.return_;
            let f = vm.get_obj(id, rk);
            if f.is_nullish() {
                return close_done(vm, fr, None);
            }
            if !vm.is_callable(&f) {
                if throwing {
                    return close_done(vm, fr, None);
                }
                return Err(vm.type_error("Iterator return must be a function."));
            }
            if throwing {
                let sp = (vm.stack.len() - fr.0) as u32;
                vm.handlers_mut().push(crate::vm::Handler {
                    pc: THREW as u32,
                    sp,
                });
            }
            fr.call_slots_as(vm, Slot::pack(f), Slot::pack(it), [], Step::CallUncounted)
        }
    }
}

/// The iterator closed (`result` is what its `return()` returned, when it was called): spends the close's fuel, then
/// throws the loop's error or finishes with its result.
fn close_done(vm: &mut Vm, fr: Frame, result: Option<Slot>) -> Result<Step, Value> {
    let throwing = fr.index(vm, LOOP_PHASE) == CLOSING_THROW;
    if !throwing
        && let Some(r) = result
        && r.obj().is_none()
    {
        return Err(vm.type_error("Iterator return() result must be an object."));
    }
    let it = fr.get(vm, LOOP_IT);
    let cost = vm.close_fuel(&it);
    vm.fuel(cost);
    let stash = fr.get(vm, LOOP_STASH);
    if throwing {
        return Err(stash);
    }
    Ok(Step::Done(stash))
}
