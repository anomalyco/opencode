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
use crate::value::{Slot, Value};
use crate::vm::Vm;

/// The step function a native frame runs, saved by its number in snapshots.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u16)]
pub enum NativeOp {
    /// The callback methods of arrays that visit each index (`forEach`, `map`, `filter`, `some`, `every`, the find
    /// methods): see `builtins::array::each_step`.
    ArrayEach,
    /// `reduce` and `reduceRight`.
    ArrayReduce,
}

const OPS: [NativeOp; 2] = [NativeOp::ArrayEach, NativeOp::ArrayReduce];

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
}

/// What a step asks of the loop.
pub enum Step {
    /// Call the callee pushed above the frame's slots, with its receiver and this many arguments (see `call`).
    Call(usize),
    /// The frame of the call was pushed already.
    Pushed,
    /// The built-in's result: the frame is popped and its caller receives this.
    Done(Value),
}

/// The code of every native frame, which never runs: one instruction for each place it continues from.
pub fn proto() -> FuncProto {
    FuncProto {
        name: 0,
        code: vec![Op::Nop; 3],
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
}
