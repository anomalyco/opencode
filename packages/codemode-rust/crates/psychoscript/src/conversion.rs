//! Conversions that call the program: an object's own `valueOf` or `toString`, called by an operator or a built-in.
//!
//! The reference converts in its internal bytecode (`$vmToPrimitive`, `$vmBinary`, `$vmConvert`), so those calls are
//! bytecode calls that can park, suspend and be saved. Rust does the same with a convert frame (see `native.rs`):
//!
//! - A built-in called from bytecode (`Vm::call_op`) converts with `convert_ok` set. A conversion that would call
//!   the program then does not call it: it records the request (`convert_req`) and fails with a sentinel. The call
//!   pushes a convert frame, which runs ToPrimitive as calls, then runs the built-in again from the start with the
//!   answers so far replayed in order, as the reference's `$vmConvert` reruns a built-in, until it completes.
//! - An instruction whose operand converts by calling the program pushes a convert frame for the operation, which
//!   runs the operation's slow path (`Vm::op_slow`) the same way and hands its result back as the instruction would.
//! - A native frame's step converts a value explicitly (`Frame::convert`): the primitive comes back as a call's result.
//!
//! A replay spends no fuel twice: the fuel spent until the last answer is taken is rewound to what it was when the
//! replay started (`end_replay`), so the fuel and its order are those of the conversions made inline.

use std::collections::VecDeque;

use crate::bytecode::Arith;
use crate::native::{Frame, Input, NativeOp, Step};
use crate::object::*;
use crate::ops::Hint;
use crate::value::{Id, Slot, Value};
use crate::vm::{Res, Vm};

/// What a convert frame does once a value is converted, by its sub-op.
const OP: u16 = 0;
const NATIVE: u16 = 1;
const RETURN: u16 = 2;

// The slots of a convert frame.
const VALUE: usize = 0;
const HINT: usize = 1;
/// The next of the value's two methods to try.
const STAGE: usize = 2;
/// The primitives so far, in the order they were asked for (an internal array).
const ANSWERS: usize = 3;
const PHASE: usize = 4;
/// An operation: its code, its operands, and what the code needs besides.
const CODE: usize = 5;
const A: usize = 6;
const B: usize = 7;
const C: usize = 8;
const EXTRA: usize = 9;
const EXTRA2: usize = 10;
/// A built-in: its function, receiver, whether its call was counted, whether it constructs, its arguments.
const CALLEE: usize = 5;
const THIS: usize = 6;
const COUNTED: usize = 7;
const CONSTRUCTING: usize = 8;
const ARGC: usize = 9;
/// A list of conversions (`fuel::Conversions`) being made: whether one is, its values and their hints (internal
/// arrays), whether each is made a number or a string too, the next, and those made so far.
const LISTING: usize = 11;
const LIST: usize = 12;
const HINTS: usize = 13;
const COERCE: usize = 14;
const LIST_I: usize = 15;
const LIST_OUT: usize = 16;
const ARGS: usize = 17;

/// Waiting for a conversion method's result; waiting for the frame a rerun built-in pushed.
const CONVERTING: usize = 0;
const WAITING: usize = 1;

/// The operations an instruction converts in (`Vm::op_slow`).
pub(crate) mod code {
    pub const SUB: u8 = 0;
    pub const MUL: u8 = 1;
    pub const DIV: u8 = 2;
    pub const MOD: u8 = 3;
    pub const POW: u8 = 4;
    pub const BIT_AND: u8 = 5;
    pub const BIT_OR: u8 = 6;
    pub const BIT_XOR: u8 = 7;
    pub const SHL: u8 = 8;
    pub const SHR: u8 = 9;
    pub const USHR: u8 = 10;
    pub const ADD: u8 = 11;
    pub const LT: u8 = 12;
    pub const GT: u8 = 13;
    pub const LE: u8 = 14;
    pub const GE: u8 = 15;
    /// `Vm::arith` with the `Arith` in `extra`.
    pub const ARITH: u8 = 16;
    pub const EQ: u8 = 17;
    pub const NE: u8 = 18;
    pub const NEG: u8 = 19;
    /// `extra`: which message an opaque operand gets (0 for `++`, 1 for `--`, 2 for a unary operator).
    pub const TO_NUMBER: u8 = 20;
    pub const BIT_NOT: u8 = 21;
    pub const INC: u8 = 22;
    pub const DEC: u8 = 23;
    pub const TO_STR: u8 = 24;
    pub const GET_ELEM: u8 = 25;
    pub const SET_ELEM: u8 = 26;
    pub const DEL_ELEM: u8 = 27;
    /// Defines `b` as key `a` on the object on top of the instruction's stack.
    pub const DEFINE_ELEM: u8 = 28;
    pub const TO_KEY: u8 = 29;
    pub const IN: u8 = 30;
    /// `extra` is the `Arith`, `extra2` the jump taken when the comparison fails.
    pub const JUMP_UNLESS: u8 = 31;
    /// Adds `b` to local `extra`.
    pub const ADD_LOCAL: u8 = 32;
    /// Increments local `extra` (`extra2` 1 to decrement).
    pub const INC_LOCAL: u8 = 33;
    /// `Vm::write_key` of key `a` on base `b`.
    pub const WRITE_KEY: u8 = 34;
}

const ARITHS: [Arith; 11] = [
    Arith::Add,
    Arith::Sub,
    Arith::Mul,
    Arith::Div,
    Arith::Mod,
    Arith::Lt,
    Arith::Le,
    Arith::Gt,
    Arith::Ge,
    Arith::StrictEq,
    Arith::StrictNe,
];

pub(crate) fn arith_code(a: Arith) -> u32 {
    ARITHS.iter().position(|x| *x == a).unwrap_or(0) as u32
}

/// What a replay rewinds: the step budget and the meter.
pub(crate) type Meter = [i32; 4];

/// A conversion a restartable run asked for: one value, or a built-in's list of them (`fuel::Conversions`), whose
/// answer is the whole list converted.
pub(crate) enum Request {
    One(Value, Hint),
    List(Vec<Value>, Vec<Hint>, bool),
}

impl Vm {
    /// Whether converting `v` with `hint` calls the program: one of the methods ToPrimitive may call is not native.
    pub(crate) fn converts_by_call(&mut self, v: &Value, hint: Hint) -> bool {
        let Value::Obj(id) = v else { return false };
        // A namespace or a promise converts without consulting its methods (see `Vm::primitive_of`).
        if matches!(
            self.heap[*id as usize].kind,
            Kind::Namespace(_) | Kind::Promise(_)
        ) {
            return false;
        }
        let hint = if hint == Hint::Default && crate::builtins::exotic::prefers_string(self, *id) {
            Hint::String
        } else {
            hint
        };
        let names = match hint {
            Hint::String => [self.names.to_string, self.names.value_of],
            _ => [self.names.value_of, self.names.to_string],
        };
        names.into_iter().any(|name| {
            let f = self.get_obj(*id, name);
            self.is_callable(&f) && !matches!(&f, Value::Obj(m) if matches!(self.heap[*m as usize].kind, Kind::Native { .. }))
        })
    }

    /// Whether an operand of an instruction converts by calling the program, for any hint.
    #[cold]
    #[inline(never)]
    pub(crate) fn operand_calls(&mut self, v: &Value) -> bool {
        matches!(v, Value::Obj(_))
            && (self.converts_by_call(v, Hint::Number) || self.converts_by_call(v, Hint::String))
    }

    /// Whether `in` converts its key `k` by calling the program: only with a data object on the right (see
    /// `Vm::has_property`).
    #[cold]
    #[inline(never)]
    pub(crate) fn in_key_calls(&mut self, o: &Value, k: &Value) -> bool {
        self.is_convertible_obj(o) && self.operand_calls(k)
    }

    /// A conversion asked for where it can be restarted: the replayed answer, or the request (an `Err` the caller
    /// passes on). `None` when the conversion is made inline.
    #[inline]
    pub(crate) fn restartable_conversion(&mut self, v: &Value, hint: Hint) -> Option<Res> {
        if !self.convert_ok || !matches!(v, Value::Obj(_)) || !self.converts_by_call(v, hint) {
            return None;
        }
        if let Some(a) = self.replay.pop_front() {
            if self.replay.is_empty() {
                self.end_replay(true);
            }
            return Some(Ok(a));
        }
        if self.convert_req.is_none() {
            self.convert_req = Some(Request::One(*v, hint));
        }
        Some(Err(Value::Undef))
    }

    /// A built-in's list of conversions made where it can be restarted, once its bookkeeping is spent: the replayed
    /// list, or the request. `None` when the list is converted inline.
    pub(crate) fn restartable_list(
        &mut self,
        hints: &[Hint],
        values: &[Value],
        coerce: bool,
    ) -> Option<Result<Vec<Value>, Value>> {
        if !self.convert_ok {
            return None;
        }
        let calls = (0..values.len())
            .any(|i| self.converts_by_call(&values[i], hints[i.min(hints.len() - 1)]));
        if !calls {
            return None;
        }
        if let Some(a) = self.replay.pop_front() {
            if self.replay.is_empty() {
                self.end_replay(true);
            }
            let list = match a.as_obj().map(|id| &self.heap[id as usize].kind) {
                Some(Kind::Array(items)) => items.clone(),
                _ => values.to_vec(),
            };
            return Some(Ok(list));
        }
        if self.convert_req.is_none() {
            let hints = (0..values.len())
                .map(|i| hints[i.min(hints.len() - 1)])
                .collect();
            self.convert_req = Some(Request::List(values.to_vec(), hints, coerce));
        }
        Some(Err(Value::Undef))
    }

    /// Starts a replay of `answers`.
    fn start_replay(&mut self, answers: Vec<Value>) {
        self.replay = VecDeque::from(answers);
        self.replay_meter = Some(self.meter_state());
    }

    /// Ends a replay: with `rewind`, the fuel spent since it started is given back.
    pub(crate) fn end_replay(&mut self, rewind: bool) {
        self.replay.clear();
        if let Some(m) = self.replay_meter.take()
            && rewind
        {
            self.set_meter_state(m);
        }
    }

    /// Pushes a convert frame for the instruction operation `code` on `a`, `b` and `c`.
    #[cold]
    #[inline(never)]
    pub(crate) fn convert_op(
        &mut self,
        code: u8,
        a: Value,
        b: Value,
        c: Value,
        extra: u32,
        extra2: u32,
    ) -> Res {
        let mut slots = [Value::Undef; ARGS];
        slots[STAGE] = Value::Num(0.0);
        slots[PHASE] = Value::Num(CONVERTING as f64);
        slots[CODE] = Value::Num(code as f64);
        slots[A] = a;
        slots[B] = b;
        slots[C] = c;
        slots[EXTRA] = Value::Num(extra as f64);
        slots[EXTRA2] = Value::Num(extra2 as f64);
        slots[LISTING] = Value::Bool(false);
        let r = self.enter_native_with(NativeOp::Convert, OP, Value::Undef, Value::Undef, &slots);
        self.entered = false;
        r
    }

    /// After a built-in asked for a conversion: pushes the convert frame that converts, then reruns it.
    #[cold]
    #[inline(never)]
    pub(crate) fn convert_native(
        &mut self,
        callee: Id,
        this: Value,
        args: &[Value],
        counted: bool,
        constructing: bool,
    ) -> Res {
        if self.convert_req.is_none() {
            return Ok(Value::Undef);
        }
        self.end_replay(false);
        self.entered = false;
        let mut slots = vec![Value::Undef; ARGS];
        slots[STAGE] = Value::Num(0.0);
        slots[PHASE] = Value::Num(CONVERTING as f64);
        slots[CALLEE] = Value::Obj(callee);
        slots[THIS] = this;
        slots[COUNTED] = Value::Bool(counted);
        slots[CONSTRUCTING] = Value::Bool(constructing);
        slots[ARGC] = Value::Num(args.len() as f64);
        slots[LISTING] = Value::Bool(false);
        slots.extend_from_slice(args);
        let r = self.enter_native_with(NativeOp::Convert, NATIVE, Value::Obj(callee), this, &slots);
        self.entered = false;
        // The frame starts with the request, as a rerun's next request (see `convert_next`).
        // The frame ends the call as `call_op` would have ended it.
        if r.is_ok()
            && let Some(f) = self.frames.last_mut()
        {
            f.argc = counted as u32;
        }
        r
    }

    /// An instruction's slow path on two operands, out of line: its result, or `None` once it pushed a convert frame
    /// because an operand converts by calling the program.
    #[inline(never)]
    pub(crate) fn slow_op(
        &mut self,
        code: u8,
        a: Value,
        b: Value,
        extra: u32,
        extra2: u32,
    ) -> Result<Option<Value>, Value> {
        if self.operand_calls(&a) || self.operand_calls(&b) {
            self.convert_op(code, a, b, Value::Undef, extra, extra2)?;
            return Ok(None);
        }
        self.op_slow(code, a, b, Value::Undef, extra, extra2)
            .map(Some)
    }

    /// The slow path of the instruction operation `code`, after its operands were popped: what the instruction
    /// pushes. A local or a jump it writes itself is written by the convert frame (`finish_op`).
    pub(crate) fn op_slow(
        &mut self,
        code: u8,
        a: Value,
        b: Value,
        c: Value,
        extra: u32,
        extra2: u32,
    ) -> Res {
        use code::*;
        Ok(match code {
            SUB..=USHR => {
                self.data_operands(&a, &b)?;
                let x = self.op_number(&a, &b)?;
                let y = self.op_number(&b, &a)?;
                Value::Num(match code {
                    SUB => x - y,
                    MUL => x * y,
                    DIV => x / y,
                    MOD => crate::vm::js_rem(x, y),
                    POW => crate::vm::js_pow(x, y),
                    BIT_AND => (to_i32(x) & to_i32(y)) as f64,
                    BIT_OR => (to_i32(x) | to_i32(y)) as f64,
                    BIT_XOR => (to_i32(x) ^ to_i32(y)) as f64,
                    SHL => to_i32(x).wrapping_shl(to_u32(y) & 31) as f64,
                    SHR => (to_i32(x) >> (to_u32(y) & 31)) as f64,
                    _ => (to_u32(x) >> (to_u32(y) & 31)) as f64,
                })
            }
            ADD | ADD_LOCAL => self.add(a, b)?,
            LT..=GE => {
                self.data_operands(&a, &b)?;
                let (swap, neg) = match code {
                    LT => (false, false),
                    GT => (true, false),
                    LE => (true, true),
                    _ => (false, true),
                };
                let (l, r) = if swap { (b, a) } else { (a, b) };
                Value::Bool(match self.less_than(&l, &r, !swap)? {
                    Some(v) => v != neg,
                    None => false,
                })
            }
            ARITH | JUMP_UNLESS => self.arith(ARITHS[extra as usize % ARITHS.len()], a, b)?,
            EQ | NE => {
                self.loose_eq_operands(&a, &b)?;
                Value::Bool(self.loose_eq(&a, &b)? == (code == EQ))
            }
            NEG => {
                self.data_operand(&a, "Unary operators require data values.")?;
                Value::Num(-self.number_of(&a)?)
            }
            TO_NUMBER => {
                if self.is_opaque_operand(&a) {
                    let msg = match extra {
                        0 => "'++' requires a data value.",
                        1 => "'--' requires a data value.",
                        _ => "Unary operators require data values.",
                    };
                    return Err(self.invalid_data(msg));
                }
                Value::Num(self.number_of(&a)?)
            }
            BIT_NOT => {
                self.data_operand(&a, "Unary operators require data values.")?;
                Value::Num(!to_i32(self.number_of(&a)?) as f64)
            }
            INC | DEC => {
                let msg = if code == INC {
                    "'++' requires a data value."
                } else {
                    "'--' requires a data value."
                };
                self.data_operand(&a, msg)?;
                let x = self.number_of(&a)?;
                Value::Num(if code == INC { x + 1.0 } else { x - 1.0 })
            }
            INC_LOCAL => {
                self.data_operand(
                    &a,
                    if extra2 == 0 {
                        "'++' requires a data value."
                    } else {
                        "'--' requires a data value."
                    },
                )?;
                let x = self.number_of(&a)?;
                Value::Num(if extra2 == 0 { x + 1.0 } else { x - 1.0 })
            }
            TO_STR => Value::Str(self.string_of(&a)?),
            GET_ELEM => self.get_elem(&a, &b)?,
            SET_ELEM => {
                self.check_assignment(&a, &c)?;
                self.set_elem(&a, &b, c)?;
                c
            }
            DEL_ELEM => {
                let k = self.key_of(&b)?;
                Value::Bool(self.delete(&a, k)?)
            }
            DEFINE_ELEM => {
                let k = self.key_of(&a)?;
                Value::Num(k as f64)
            }
            WRITE_KEY => self.write_key(&b, &a)?,
            TO_KEY => {
                let k = self.key_of(&a)?;
                if k <= SYM_ASYNC_ITERATOR {
                    Value::Sym(k)
                } else {
                    self.atom_val(k)
                }
            }
            IN => Value::Bool(self.has_property(&a, &b)?),
            _ => Value::Undef,
        })
    }
}

fn to_i32(x: f64) -> i32 {
    crate::value::to_int32(x)
}

fn to_u32(x: f64) -> u32 {
    crate::value::to_uint32(x)
}

fn hint_code(h: Hint) -> f64 {
    match h {
        Hint::Number => 0.0,
        Hint::String => 1.0,
        Hint::Default => 2.0,
    }
}

fn hint_of(v: usize) -> Hint {
    match v {
        0 => Hint::Number,
        1 => Hint::String,
        _ => Hint::Default,
    }
}

impl Frame {
    /// Converts `v` with `hint` for a native frame's step: the primitive comes back as `Input::Returned`. `v` must be
    /// an object.
    pub fn convert(self, vm: &mut Vm, v: Value, hint: Hint) -> Result<Step, Value> {
        let slots = [
            v,
            Value::Num(hint_code(hint)),
            Value::Num(0.0),
            Value::Undef,
            Value::Num(CONVERTING as f64),
        ];
        vm.enter_native_with(
            NativeOp::Convert,
            RETURN,
            Value::Undef,
            Value::Undef,
            &slots,
        )?;
        vm.entered = false;
        Ok(Step::Pushed)
    }
}

/// The step of a convert frame.
pub(crate) fn step(vm: &mut Vm, sub: u16, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => match sub {
            OP => run_op(vm, fr),
            NATIVE => convert_next(vm, fr),
            _ => begin(vm, fr),
        },
        Input::Returned(r) if fr.index(vm, PHASE) == WAITING => Ok(Step::Done(r.get())),
        Input::Returned(r) => {
            let r = r.get();
            if matches!(r, Value::Obj(_)) {
                return next_method(vm, fr);
            }
            if sub != RETURN && matches!(fr.get(vm, LISTING), Value::Bool(true)) {
                return listed(vm, fr, r);
            }
            answered(vm, sub, fr, r)
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

/// ToPrimitive of the frame's value, as `Vm::primitive_of` makes it: its fuel, then its first method.
fn begin(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    vm.fuel(1);
    if let Value::Obj(id) = fr.get(vm, VALUE)
        && hint_of(fr.index(vm, HINT)) == Hint::Default
        && crate::builtins::exotic::prefers_string(vm, id)
    {
        fr.set_index(vm, HINT, 1);
    }
    fr.set_index(vm, STAGE, 0);
    fr.set_index(vm, PHASE, CONVERTING);
    next_method(vm, fr)
}

/// Calls the next of the value's methods that is callable, as bytecode calls it; none left fails.
fn next_method(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let v = fr.get(vm, VALUE);
    let Value::Obj(id) = v else {
        return Err(unconvertible(vm));
    };
    let names = match hint_of(fr.index(vm, HINT)) {
        Hint::String => [vm.names.to_string, vm.names.value_of],
        _ => [vm.names.value_of, vm.names.to_string],
    };
    let mut stage = fr.index(vm, STAGE);
    while stage < 2 {
        let f = vm.get_obj(id, names[stage]);
        stage += 1;
        if vm.is_callable(&f) {
            fr.set_index(vm, STAGE, stage);
            return fr.call_slots(vm, Slot::pack(f), Slot::pack(v), []);
        }
    }
    Err(unconvertible(vm))
}

/// A value with no method that converts it. The only member instructions that convert are those whose key does, so
/// at one the failure points at the key, as the reference's key conversion does.
fn unconvertible(vm: &mut Vm) -> Value {
    let e = vm.type_error("Cannot convert object to primitive value.");
    vm.at_site(e, crate::bytecode::Site::Key)
}

/// A value converted to `r`: kept with the answers, then the operation or built-in runs again.
fn answered(vm: &mut Vm, sub: u16, fr: Frame, r: Value) -> Result<Step, Value> {
    if sub == RETURN {
        return Ok(Step::Done(r));
    }
    let answers = match fr.get(vm, ANSWERS) {
        Value::Obj(a) => a,
        _ => {
            let a = vm.new_array(Vec::new());
            fr.set(vm, ANSWERS, a);
            a.as_obj().unwrap_or(0)
        }
    };
    if let Kind::Array(items) = &mut vm.heap[answers as usize].kind {
        items.push(r);
    }
    if sub == OP {
        return run_op(vm, fr);
    }
    rerun_native(vm, fr)
}

fn answers_of(vm: &Vm, fr: Frame) -> Vec<Value> {
    match fr
        .get(vm, ANSWERS)
        .as_obj()
        .map(|a| &vm.heap[a as usize].kind)
    {
        Some(Kind::Array(items)) => items.clone(),
        _ => Vec::new(),
    }
}

/// After a run that asked for another conversion: converts that value, or that list, next.
fn convert_next(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let Some(req) = vm.convert_req.take() else {
        return Ok(Step::Done(Value::Undef));
    };
    vm.end_replay(false);
    match req {
        Request::One(v, hint) => {
            fr.set(vm, LISTING, Value::Bool(false));
            fr.set(vm, VALUE, v);
            fr.set_index(vm, HINT, hint_code(hint) as usize);
            begin(vm, fr)
        }
        Request::List(values, hints, coerce) => {
            let list = vm.new_array(values);
            let hints = vm.new_array(
                hints
                    .into_iter()
                    .map(|h| Value::Num(hint_code(h)))
                    .collect(),
            );
            let out = vm.new_array(Vec::new());
            fr.set(vm, LISTING, Value::Bool(true));
            fr.set(vm, LIST, list);
            fr.set(vm, HINTS, hints);
            fr.set(vm, COERCE, Value::Bool(coerce));
            fr.set_index(vm, LIST_I, 0);
            fr.set(vm, LIST_OUT, out);
            next_listed(vm, fr)
        }
    }
}

/// The next value of a list of conversions, as `fuel::Conversions::convert` converts it: ToPrimitive, made a number
/// or a string with `coerce`, then a back-edge. A primitive is not called for.
fn next_listed(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    loop {
        let i = fr.index(vm, LIST_I);
        let list = fr.get(vm, LIST).as_obj().unwrap_or(0);
        let item = match &vm.heap[list as usize].kind {
            Kind::Array(items) => items.get(i).copied(),
            _ => None,
        };
        let Some(v) = item else {
            let out = fr.get(vm, LIST_OUT);
            return answered(vm, NATIVE, fr, out);
        };
        let hints = fr.get(vm, HINTS).as_obj().unwrap_or(0);
        let hint = match &vm.heap[hints as usize].kind {
            Kind::Array(h) => h.get(i).map_or(0, |x| x.as_num() as usize),
            _ => 0,
        };
        if vm.is_convertible_obj(&v) {
            fr.set(vm, VALUE, v);
            fr.set_index(vm, HINT, hint);
            return begin(vm, fr);
        }
        push_listed(vm, fr, v, hint)?;
    }
}

/// A list's value converted to the primitive `p`: coerced, kept, then a back-edge.
fn push_listed(vm: &mut Vm, fr: Frame, p: Value, hint: usize) -> Result<(), Value> {
    let p = match fr.get(vm, COERCE) {
        Value::Bool(true) => match hint_of(hint) {
            Hint::String => Value::Str(vm.string_of(&p)?),
            _ => Value::Num(vm.number_of(&p)?),
        },
        _ => p,
    };
    if let Some(Kind::Array(out)) = fr
        .get(vm, LIST_OUT)
        .as_obj()
        .map(|o| &mut vm.heap[o as usize].kind)
    {
        out.push(p);
    }
    crate::builtins::fuel::step(vm);
    let i = fr.index(vm, LIST_I);
    fr.set_index(vm, LIST_I, i + 1);
    Ok(())
}

/// A list's object value converted to `r`: the rest of the list next.
fn listed(vm: &mut Vm, fr: Frame, r: Value) -> Result<Step, Value> {
    let hint = fr.index(vm, HINT);
    push_listed(vm, fr, r, hint)?;
    next_listed(vm, fr)
}

/// Runs the operation with the answers so far.
fn run_op(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let answers = answers_of(vm, fr);
    if !answers.is_empty() {
        vm.start_replay(answers);
    }
    let code = fr.index(vm, CODE) as u8;
    let (a, b, c) = (fr.get(vm, A), fr.get(vm, B), fr.get(vm, C));
    let (extra, extra2) = (fr.index(vm, EXTRA) as u32, fr.index(vm, EXTRA2) as u32);
    vm.convert_ok = true;
    let r = vm.op_slow(code, a, b, c, extra, extra2);
    vm.convert_ok = false;
    if vm.convert_req.is_some() {
        return convert_next(vm, fr);
    }
    vm.end_replay(false);
    finish_op(vm, fr, code, r?, extra, extra2)
}

/// Hands an operation's result back as its instruction does.
fn finish_op(
    vm: &mut Vm,
    fr: Frame,
    code: u8,
    v: Value,
    extra: u32,
    extra2: u32,
) -> Result<Step, Value> {
    let caller = vm.frames.len().saturating_sub(2);
    match code {
        code::JUMP_UNLESS => {
            if !vm.truthy(&v) {
                vm.frames[caller].pc = extra2 as usize;
            }
            Ok(Step::DoneEmpty)
        }
        code::ADD_LOCAL | code::INC_LOCAL => {
            let at = vm.frames[caller].base + extra as usize;
            if let Some(s) = vm.stack.get_mut(at) {
                *s = Slot::pack(v);
            }
            Ok(Step::DoneEmpty)
        }
        code::DEFINE_ELEM => {
            let (k, val) = (v.as_num() as u32, fr.get(vm, B));
            if let Some(id) = vm.stack[fr.base() - 3].obj() {
                vm.define(id, k, val);
            }
            Ok(Step::DoneEmpty)
        }
        _ => Ok(Step::Done(v)),
    }
}

/// Runs the built-in again from the start with the answers so far, as `call_op` calls it.
fn rerun_native(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let answers = answers_of(vm, fr);
    vm.start_replay(answers);
    let Some(id) = fr.slot(vm, CALLEE).obj() else {
        return Ok(Step::Done(Value::Undef));
    };
    let Kind::Native { f, .. } = &vm.heap[id as usize].kind else {
        return Ok(Step::Done(Value::Undef));
    };
    let f = *f;
    let counted = matches!(fr.get(vm, COUNTED), Value::Bool(true));
    let this = match fr.get(vm, CONSTRUCTING) {
        Value::Bool(true) => Value::Uninit,
        _ => fr.get(vm, THIS),
    };
    let argc = fr.index(vm, ARGC);
    let at = fr.base() + ARGS;
    let args: Vec<Value> = vm.stack[at..at + argc].iter().map(|s| s.get()).collect();
    vm.host.meter.counted = counted;
    vm.convert_ok = true;
    let r = f(vm, this, &args, id);
    vm.convert_ok = false;
    if vm.convert_req.is_some() {
        vm.entered = false;
        return convert_next(vm, fr);
    }
    vm.end_replay(false);
    if std::mem::take(&mut vm.entered) {
        // The built-in went on in a frame of its own: its result is the call's.
        if let Some(inner) = vm.frames.last_mut() {
            inner.argc = counted as u32;
        }
        vm.host.meter.bytecode = false;
        let me = vm.frames.len() - 2;
        vm.frames[me].argc = 0;
        fr.set_index(vm, PHASE, WAITING);
        return Ok(Step::Pushed);
    }
    Ok(Step::Done(r?))
}
