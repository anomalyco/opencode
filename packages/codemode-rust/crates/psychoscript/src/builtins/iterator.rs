//! Live iterators over standard-library collections, and the shared iterator prototype's `next`.

use super::{arg, fuel};
use crate::native::{
    FOR_OF_SLOTS, Flow, ForOf, Frame, Input, NativeOp, Step, THREW, enter_for_of_record,
};
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{Handler, Res, Vm};

pub fn setup(vm: &mut Vm) {
    let ip = vm.realm.iter_proto;
    vm.method(ip, "next", 0, iter_next);
}

/// A live iterator over the elements of `target`.
pub fn exotic_iter(vm: &mut Vm, target: Id, kind: IterKind) -> Value {
    let proto = vm.realm.iter_proto;
    Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::ExoticIter {
            target,
            pos: 0,
            kind,
        },
    )))
}

fn exotic_step(vm: &mut Vm, id: Id) -> Option<Value> {
    let Kind::ExoticIter { target, pos, kind } = vm.heap[id as usize].kind else {
        return None;
    };
    let v = match &vm.heap[target as usize].kind {
        Kind::Bytes(_) => super::bytes::iter_step(vm, target, pos as usize, kind),
        Kind::SearchParams(_) | Kind::Headers(_) => {
            super::web::iter_step(vm, target, pos as usize, kind)
        }
        _ => None,
    };
    if let Kind::ExoticIter { pos, .. } = &mut vm.heap[id as usize].kind {
        *pos = if v.is_some() { *pos + 1 } else { u32::MAX };
    }
    v
}

fn iter_next(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let r = match this {
        Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::ExoticIter { .. }) => {
            exotic_step(vm, id)
        }
        Value::Obj(id)
            if matches!(
                vm.heap[id as usize].kind,
                Kind::ArrayIter { .. }
                    | Kind::MapIter { .. }
                    | Kind::StrIter { .. }
                    | Kind::ListIter { .. }
            ) =>
        {
            vm.iter_step(&this)?
        }
        _ => return Err(super::incompatible(vm, "Iterator.prototype.next", &this)),
    };
    Ok(match r {
        Some(v) => vm.iter_result(v, false),
        None => vm.iter_result(Value::Undef, true),
    })
}

// ---------- Iterator and its helpers ----------

pub enum HelperOp {
    Wrap,
    Map(Value),
    Filter(Value),
    Take(f64),
    Drop(f64),
    FlatMap(Value, Option<(Value, Value)>),
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum HelperState {
    Start,
    Suspended,
    Running,
    Done,
}

/// An iterator helper: a lazy step over an iterator record, as the reference's prelude generators behave.
pub struct Helper {
    pub(crate) iter: Value,
    pub(crate) next: Value,
    pub(crate) op: HelperOp,
    pub(crate) counter: f64,
    pub(crate) state: HelperState,
    /// The name of the call that made the helper (`Iterator.from`), as a string, or undefined; the reference names it
    /// when the iterator's `next` turns out not to be a function.
    pub(crate) site: Value,
}

pub fn setup_helpers(vm: &mut Vm) {
    let ip = vm.realm.iter_proto;
    vm.ctor("Iterator", 0, iterator_ctor, ip, Value::Undef);
    let k = vm.names.constructor;
    if let Value::Obj(c) = vm.get_obj(ip, k) {
        vm.method(c, "from", 1, iterator_from);
    }
    vm.methods(
        ip,
        &[
            ("map", 1, it_map),
            ("filter", 1, it_filter),
            ("take", 1, it_take),
            ("drop", 1, it_drop),
            ("flatMap", 1, it_flat_map),
            ("reduce", 1, it_reduce),
            ("toArray", 0, it_to_array),
            ("forEach", 1, it_for_each),
            ("some", 1, it_some),
            ("every", 1, it_every),
            ("find", 1, it_find),
        ],
    );
    let hp = vm.plain(ip);
    vm.realm.std.iterator_helper = hp;
    vm.methods(
        hp,
        &[("next", 0, helper_next), ("return", 0, helper_return)],
    );
}

fn iterator_ctor(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    if matches!(this, Value::Uninit) {
        return Err(
            vm.type_error("Iterator is abstract; use Iterator.from(...) or a built-in iterator.")
        );
    }
    Err(vm.type_error("Constructor Iterator requires 'new'."))
}

/// GetIteratorDirect: the iterator and its `next`, read once; the reference's `$Direct` helper.
fn direct(vm: &mut Vm, v: &Value) -> Result<(Value, Value), Value> {
    let Value::Obj(id) = v else {
        return Err(vm.type_error("An iterator must be an object."));
    };
    let nk = vm.names.next;
    let next = vm.get_obj(*id, nk);
    fuel::native(vm);
    Ok((*v, next))
}

/// Whether the reference steps `iter` without calling its `next`: a built-in iterator, a generator or a helper.
fn stepped_directly(vm: &Vm, iter: &Value) -> bool {
    matches!(iter, Value::Obj(id) if matches!(
        vm.heap[*id as usize].kind,
        Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. }
            | Kind::Generator(_)
            | Kind::IterHelper(_)
    ))
}

/// The prelude's `flattenable` up to its call: `$IsObject` for a value that is not a string, `$Describe` when it
/// fails, then the value's `[Symbol.iterator]` method, which the caller calls (when it is not nullish) and opens with
/// `direct`.
fn flattenable(vm: &mut Vm, v: &Value, strings: bool, name: &str) -> Result<Value, Value> {
    fuel::method(vm);
    let ok = match v {
        Value::Str(_) => strings,
        Value::Obj(id) if !vm.is_namespace(*id) => {
            fuel::native(vm);
            true
        }
        _ => {
            fuel::native(vm);
            false
        }
    };
    if !ok {
        let d = super::describe_value(vm, v);
        fuel::native(vm);
        return Err(vm.type_error(&format!(
            "{name} expects an iterable or iterator, received {d}."
        )));
    }
    vm.get(v, SYM_ITERATOR)
}

/// The error of a call of a value that is not callable, naming `site` (a helper's kept name or the running call's), as
/// the reference names the call its prelude makes.
fn not_callable(vm: &mut Vm, site: Value) -> Value {
    let name = match site {
        Value::Str(s) => vm.text(s).to_owned(),
        _ => "The called value".to_owned(),
    };
    vm.type_error(&format!("{name} is not a function."))
}

/// A helper made: its prelude generator called, `prime` entered, and its first `next` run to the first `yield`.
fn primed(vm: &mut Vm, iter: Value, next: Value, op: HelperOp) -> Value {
    fuel::method(vm);
    fuel::method(vm);
    fuel::native(vm);
    let h = new_helper(vm, iter, next, op);
    vm.bytecode_builtin();
    h
}

fn new_helper(vm: &mut Vm, iter: Value, next: Value, op: HelperOp) -> Value {
    let proto = vm.realm.std.iterator_helper;
    let site = match vm.call_site().map(str::to_owned) {
        Some(name) => vm.string_val(name),
        None => Value::Undef,
    };
    let h = Helper {
        iter,
        next,
        op,
        counter: 0.0,
        state: HelperState::Start,
        site,
    };
    Value::Obj(vm.alloc(Obj::new(Some(proto), Kind::IterHelper(Box::new(h)))))
}

fn inherits_iterator(vm: &Vm, v: &Value) -> bool {
    let &Value::Obj(mut cur) = v else {
        return false;
    };
    let ip = vm.realm.iter_proto;
    while let Some(p) = vm.heap[cur as usize].proto {
        if p == ip {
            return true;
        }
        cur = p;
    }
    false
}

fn iterator_from(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    // The prelude's `Iterator$from`: `$IsObject`, and for an object `$Inherits`.
    fuel::method(vm);
    let v = arg(args, 0);
    fuel::native(vm);
    if matches!(v, Value::Obj(_)) {
        fuel::native(vm);
    }
    if inherits_iterator(vm, &v) {
        vm.bytecode_builtin();
        return Ok(v);
    }
    let method = flattenable(vm, &v, true, "Iterator.from")?;
    if method.is_nullish() {
        let (iter, next) = direct(vm, &v)?;
        return Ok(primed(vm, iter, next, HelperOp::Wrap));
    }
    if !vm.is_callable(&method) {
        let site = match vm.call_site().map(str::to_owned) {
            Some(name) => vm.string_val(name),
            None => Value::Undef,
        };
        return Err(not_callable(vm, site));
    }
    vm.enter_native_sub(
        NativeOp::Iterators,
        FROM,
        callee,
        Value::Undef,
        &[v, method],
    )
}

fn callback_helper(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    make: fn(Value) -> HelperOp,
) -> Res {
    fuel::method(vm);
    let (iter, next) = direct(vm, this)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Iterator.prototype.{name}"))?;
    fuel::native(vm);
    Ok(primed(vm, iter, next, make(f)))
}

fn it_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    callback_helper(vm, &this, args, "map", HelperOp::Map)
}

fn it_filter(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    callback_helper(vm, &this, args, "filter", HelperOp::Filter)
}

fn it_flat_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    callback_helper(vm, &this, args, "flatMap", |f| HelperOp::FlatMap(f, None))
}

fn count(vm: &mut Vm, v: &Value, name: &str) -> Result<f64, Value> {
    let n = vm.number_of(v)?;
    let i = if n.is_infinite() { n } else { n.trunc() };
    if n.is_nan() || i < 0.0 {
        return Err(vm.range_error(&format!(
            "Iterator.prototype.{name} expects a non-negative count, received {}.",
            crate::value::num_to_string(n)
        )));
    }
    Ok(i)
}

fn it_take(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    fuel::method(vm);
    let (iter, next) = direct(vm, &this)?;
    fuel::method(vm);
    let n = count(vm, &arg(args, 0), "take")?;
    Ok(primed(vm, iter, next, HelperOp::Take(n)))
}

fn it_drop(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    fuel::method(vm);
    let (iter, next) = direct(vm, &this)?;
    fuel::method(vm);
    let n = count(vm, &arg(args, 0), "drop")?;
    Ok(primed(vm, iter, next, HelperOp::Drop(n)))
}

fn helper_mut(vm: &mut Vm, id: Id) -> &mut Helper {
    match &mut vm.heap[id as usize].kind {
        Kind::IterHelper(h) => h,
        _ => unreachable!("checked by this_helper"),
    }
}

fn this_helper(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && matches!(vm.heap[*id as usize].kind, Kind::IterHelper(_))
    {
        return Ok(*id);
    }
    Err(super::incompatible(
        vm,
        &format!("%IteratorHelper%.{name}"),
        this,
    ))
}

fn helper_next(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    let id = this_helper(vm, &this, "next")?;
    let state = helper_mut(vm, id).state;
    match state {
        HelperState::Done => return Ok(vm.iter_result(Value::Undef, true)),
        HelperState::Running => return Err(vm.type_error("Iterator helper is already running.")),
        _ => {}
    }
    let resumed = state == HelperState::Suspended;
    if let Some(r) = next_direct(vm, id, resumed) {
        return r;
    }
    helper_mut(vm, id).state = HelperState::Running;
    enter_helper(vm, callee, id, START, resumed, Value::Undef)
}

/// `next()` of a helper whose step calls nothing of the program's: `Iterator.from`, `take` with values left or `drop`,
/// over a built-in iterator stepped by its native `next`. It runs the frame's loop at once, without a frame; `None`
/// for any other helper.
fn next_direct(vm: &mut Vm, id: Id, resumed: bool) -> Option<Res> {
    let h = helper_mut(vm, id);
    let (iter, next) = (h.iter, h.next);
    match h.op {
        HelperOp::Wrap | HelperOp::Drop(_) => {}
        HelperOp::Take(n) if n > 0.0 => {}
        _ => return None,
    }
    if !native_step(vm, &iter, &next) {
        return None;
    }
    let mut back = resumed;
    loop {
        if std::mem::take(&mut back) {
            fuel::step(vm);
        }
        let r = vm.call(&next, iter, &[]).and_then(|r| result_of(vm, r));
        let item = match r {
            Ok(Some(item)) => item,
            Ok(None) => {
                helper_mut(vm, id).state = HelperState::Done;
                return Some(Ok(vm.iter_result(Value::Undef, true)));
            }
            Err(e) => {
                helper_mut(vm, id).state = HelperState::Done;
                return Some(Err(e));
            }
        };
        let h = helper_mut(vm, id);
        match &mut h.op {
            HelperOp::Drop(n) if *n > 0.0 => {
                *n -= 1.0;
                back = true;
                continue;
            }
            HelperOp::Take(n) => *n -= 1.0,
            _ => {}
        }
        h.state = HelperState::Suspended;
        return Some(Ok(vm.iter_result(item, false)));
    }
}

/// Whether `iter` is a built-in iterator whose record steps it by a native `next`, which calls nothing of the
/// program's.
fn native_step(vm: &Vm, iter: &Value, next: &Value) -> bool {
    matches!(iter, Value::Obj(id) if matches!(
        vm.heap[*id as usize].kind,
        Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. }
    )) && matches!(next, Value::Obj(n) if matches!(vm.heap[*n as usize].kind, Kind::Native { .. }))
}

fn helper_return(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    let id = this_helper(vm, &this, "return")?;
    let h = helper_mut(vm, id);
    match h.state {
        HelperState::Done => return Ok(vm.iter_result(Value::Undef, true)),
        HelperState::Running => return Err(vm.type_error("Iterator helper is already running.")),
        _ => {}
    }
    // Before its first value the prelude generator's `finally` closes the source with `closeIterator`; at a `yield`
    // its loops close their iterator records, the inner one of `flatMap` first.
    let started = h.state == HelperState::Suspended;
    h.state = HelperState::Done;
    let inner = match &mut h.op {
        HelperOp::FlatMap(_, slot) => slot.take(),
        _ => None,
    };
    let (phase, inner) = match inner {
        _ if !started => (CLOSE_SOURCE, Value::Undef),
        Some((inner, _)) => (CLOSE_INNER, inner),
        None => (CLOSE_RECORD, Value::Undef),
    };
    enter_helper(vm, callee, id, phase, false, inner)
}

// A helper's `next()` and `return()` run in a native frame of the sub-op `HELPER` on the helper (its `this`), which
// holds what lasts between calls (the source record, the op, the counter, `flatMap`'s inner record, the state); the
// frame's slots hold one call's progress: where it is, the item a callback decides on (or the inner record `return()`
// closes), whether the prelude generator's loop owes a back-edge, and while closing, the error to throw, the close's
// fuel (or for `closeIterator` whether `return` is native) and whether a close failed.
const HELPER: u16 = 0;
/// `Iterator.from` calling an iterable's `[Symbol.iterator]`: slots the iterable and the method.
const FROM: u16 = 1;

const PHASE: usize = 0;
const ITEM: usize = 1;
const BACK: usize = 2;
const STASH: usize = 3;
const CLOSE: usize = 4;
const FAILED: usize = 5;

// Where a helper's frame is: what the call it waits on, if any, is for. A generator's phase follows its call's.
const START: usize = 0;
const OUTER_CALL: usize = 1;
const OUTER_GEN: usize = 2;
const INNER_CALL: usize = 3;
const INNER_GEN: usize = 4;
const CALLBACK: usize = 5;
const FLAT_OPEN: usize = 6;
/// Closing the source after a failure, which it throws once closed whatever the close does.
const CLOSE_THROW: usize = 7;
/// The prelude's `closeIterator(source)`, before the first value.
const CLOSE_SOURCE: usize = 8;
/// `return()` closing `flatMap`'s inner record, then the source.
const CLOSE_INNER: usize = 9;
/// Closing the source record, as a prelude `for...of` left early does.
const CLOSE_RECORD: usize = 10;

fn enter_helper(vm: &mut Vm, callee: Id, id: Id, phase: usize, back: bool, item: Value) -> Res {
    let slots = [
        Slot::index(phase),
        Slot::pack(item),
        Slot::index(back as usize),
        Slot::UNDEF,
        Slot::index(0),
        Slot::index(0),
    ];
    let r = vm.enter_native_slots(
        NativeOp::Iterators,
        HELPER,
        Slot::pack(Value::Obj(callee)),
        Slot::pack(Value::Obj(id)),
        &slots,
    );
    if r.is_err() {
        helper_mut(vm, id).state = HelperState::Done;
    }
    r
}

fn helper_of(vm: &Vm, fr: Frame) -> Id {
    fr.this_slot(vm).obj().unwrap_or_default()
}

/// A step of a helper's frame. Whatever fails leaves the helper done, as its prelude generator is once it threw.
fn helper_frame(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let r = helper_input(vm, fr, input);
    if r.is_err() {
        let id = helper_of(vm, fr);
        helper_mut(vm, id).state = HelperState::Done;
    }
    r
}

fn helper_input(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let phase = fr.index(vm, PHASE);
    match input {
        Input::Start => match phase {
            START => next_start(vm, fr),
            CLOSE_SOURCE => close_source(vm, fr),
            CLOSE_INNER => {
                let inner = fr.get(vm, ITEM);
                close(vm, fr, inner)
            }
            _ => {
                let iter = helper_mut(vm, helper_of(vm, fr)).iter;
                close(vm, fr, iter)
            }
        },
        Input::Threw(e) => match phase {
            OUTER_CALL | OUTER_GEN => Err(e),
            INNER_CALL | INNER_GEN | CALLBACK | FLAT_OPEN => close_throw(vm, fr, e),
            _ => closed(vm, fr, Err(e)),
        },
        Input::Finished(_) => match phase {
            OUTER_GEN => out(vm, fr, None),
            INNER_GEN => {
                inner_done(vm, fr);
                next_loop(vm, fr)
            }
            _ => closed(vm, fr, Ok(())),
        },
        Input::Returned(r) => match phase {
            OUTER_CALL => match result_of(vm, r.get())? {
                Some(item) => after_item(vm, fr, item),
                None => out(vm, fr, None),
            },
            OUTER_GEN => after_item(vm, fr, r.get()),
            INNER_CALL => match result_of(vm, r.get()) {
                Ok(Some(v)) => out(vm, fr, Some(v)),
                Ok(None) => {
                    inner_done(vm, fr);
                    next_loop(vm, fr)
                }
                Err(e) => close_throw(vm, fr, e),
            },
            INNER_GEN => out(vm, fr, Some(r.get())),
            CALLBACK => callback_returned(vm, fr, r.get()),
            FLAT_OPEN => match direct(vm, &r.get()) {
                Ok(inner) => {
                    set_inner(vm, fr, Some(inner));
                    next_loop(vm, fr)
                }
                Err(e) => close_throw(vm, fr, e),
            },
            _ => {
                // A close: a `return` method's result must be an object, as `closeIterator` checks it with its own
                // message; a generator's close returns no result.
                let it = if phase == CLOSE_INNER {
                    fr.get(vm, ITEM)
                } else {
                    helper_mut(vm, helper_of(vm, fr)).iter
                };
                let generator = matches!(it, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Generator(_)));
                let outcome = if generator || r.obj().is_some() {
                    Ok(())
                } else if phase == CLOSE_SOURCE {
                    Err(vm.type_error("Iterator return() must return an object."))
                } else {
                    Err(vm.type_error("Iterator return() result must be an object."))
                };
                closed(vm, fr, outcome)
            }
        },
    }
}

/// A helper's `next()` starting: `take` with nothing left closes the source (its record once it yielded, as its
/// loop is left; before that with `closeIterator`); anything else runs the prelude generator's loop.
fn next_start(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let h = helper_mut(vm, helper_of(vm, fr));
    if let HelperOp::Take(n) = h.op
        && n <= 0.0
    {
        let iter = h.iter;
        if fr.index(vm, BACK) != 0 {
            fr.set_index(vm, PHASE, CLOSE_RECORD);
            return close(vm, fr, iter);
        }
        fr.set_index(vm, PHASE, CLOSE_SOURCE);
        return close_source(vm, fr);
    }
    next_loop(vm, fr)
}

/// What stepping an iterator gave: its next value or `None` once done, or the call it waits on.
enum Stepped {
    Value(Option<Value>),
    Pending(Step),
}

/// The prelude generator's loop, from its top: through the back-edge it owes, stepping `flatMap`'s inner record
/// while there is one, else the source, until a value is ready or a call is made.
fn next_loop(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let id = helper_of(vm, fr);
    loop {
        let h = helper_mut(vm, id);
        let (iter, next, site) = (h.iter, h.next, h.site);
        if let HelperOp::FlatMap(_, Some((inner, inext))) = h.op {
            back_edge(vm, fr);
            match step(vm, fr, inner, inext, Value::Undef, INNER_CALL) {
                Ok(Stepped::Pending(s)) => return Ok(s),
                Ok(Stepped::Value(Some(v))) => return out(vm, fr, Some(v)),
                Ok(Stepped::Value(None)) => {
                    inner_done(vm, fr);
                    continue;
                }
                Err(e) => return close_throw(vm, fr, e),
            }
        }
        back_edge(vm, fr);
        let item = match step(vm, fr, iter, next, site, OUTER_CALL)? {
            Stepped::Pending(s) => return Ok(s),
            Stepped::Value(None) => return out(vm, fr, None),
            Stepped::Value(Some(item)) => item,
        };
        if let Some(s) = apply(vm, fr, id, item)? {
            return Ok(s);
        }
    }
}

/// The back-edge the loop owes, once.
fn back_edge(vm: &mut Vm, fr: Frame) {
    if fr.index(vm, BACK) != 0 {
        fr.set_index(vm, BACK, 0);
        fuel::step(vm);
    }
}

/// `flatMap`'s inner record is done: its loop's back-edge, back to the source.
fn inner_done(vm: &mut Vm, fr: Frame) {
    set_inner(vm, fr, None);
    fuel::step(vm);
}

fn set_inner(vm: &mut Vm, fr: Frame, inner: Option<(Value, Value)>) {
    if let HelperOp::FlatMap(_, slot) = &mut helper_mut(vm, helper_of(vm, fr)).op {
        *slot = inner;
    }
}

/// A value from the source, then the loop goes on.
fn after_item(vm: &mut Vm, fr: Frame, item: Value) -> Result<Step, Value> {
    let id = helper_of(vm, fr);
    match apply(vm, fr, id, item)? {
        Some(s) => Ok(s),
        None => next_loop(vm, fr),
    }
}

/// What the helper's op does with a value from the source: the step to return, or `None` to go round the loop.
fn apply(vm: &mut Vm, fr: Frame, id: Id, item: Value) -> Result<Option<Step>, Value> {
    let h = helper_mut(vm, id);
    let index = h.counter;
    let f = match &mut h.op {
        HelperOp::Wrap => return out(vm, fr, Some(item)).map(Some),
        HelperOp::Take(n) => {
            *n -= 1.0;
            return out(vm, fr, Some(item)).map(Some);
        }
        HelperOp::Drop(n) => {
            if *n > 0.0 {
                *n -= 1.0;
                fr.set_index(vm, BACK, 1);
                return Ok(None);
            }
            return out(vm, fr, Some(item)).map(Some);
        }
        HelperOp::Map(f) | HelperOp::FlatMap(f, _) => *f,
        HelperOp::Filter(f) => {
            let f = *f;
            fr.set_index(vm, BACK, 1);
            f
        }
    };
    helper_mut(vm, id).counter += 1.0;
    fr.set(vm, ITEM, item);
    fr.set_index(vm, PHASE, CALLBACK);
    let args = [Slot::pack(item), Slot::pack(Value::Num(index))];
    match call(vm, fr, Slot::pack(f), Slot::UNDEF, args, true) {
        Ok(s) => Ok(Some(s)),
        Err(e) => close_throw(vm, fr, e).map(Some),
    }
}

/// The callback of `map`, `filter` or `flatMap` returned.
fn callback_returned(vm: &mut Vm, fr: Frame, r: Value) -> Result<Step, Value> {
    let id = helper_of(vm, fr);
    match helper_mut(vm, id).op {
        HelperOp::Filter(_) => {
            if vm.truthy(&r) {
                let item = fr.get(vm, ITEM);
                return out(vm, fr, Some(item));
            }
            next_loop(vm, fr)
        }
        HelperOp::FlatMap(..) => {
            let method = match flattenable(vm, &r, false, "Iterator.prototype.flatMap") {
                Ok(m) => m,
                Err(e) => return close_throw(vm, fr, e),
            };
            if method.is_nullish() {
                return match direct(vm, &r) {
                    Ok(inner) => {
                        set_inner(vm, fr, Some(inner));
                        next_loop(vm, fr)
                    }
                    Err(e) => close_throw(vm, fr, e),
                };
            }
            if !vm.is_callable(&method) {
                let site = helper_mut(vm, id).site;
                let e = not_callable(vm, site);
                return close_throw(vm, fr, e);
            }
            fr.set_index(vm, PHASE, FLAT_OPEN);
            match call(vm, fr, Slot::pack(method), Slot::pack(r), [], true) {
                Ok(s) => Ok(s),
                Err(e) => close_throw(vm, fr, e),
            }
        }
        _ => out(vm, fr, Some(r)),
    }
}

/// The helper's result for this call: a value, or done.
fn out(vm: &mut Vm, fr: Frame, v: Option<Value>) -> Result<Step, Value> {
    let id = helper_of(vm, fr);
    helper_mut(vm, id).state = if v.is_some() {
        HelperState::Suspended
    } else {
        HelperState::Done
    };
    Ok(Step::Done(
        vm.iter_result(v.unwrap_or(Value::Undef), v.is_none()),
    ))
}

/// Steps `iter` by its record's `next` as the prelude does: the reference steps its own iterators, generators and
/// helpers without counting a call. A call's result comes back in phase `phase`, a generator's in `phase + 1`. `site`
/// names the call that made the record, for a `next` that is not a function.
fn step(
    vm: &mut Vm,
    fr: Frame,
    iter: Value,
    next: Value,
    site: Value,
    phase: usize,
) -> Result<Stepped, Value> {
    if !vm.is_callable(&next) {
        return Err(not_callable(vm, site));
    }
    if native_step(vm, &iter, &next) {
        if let Some(v) = step_builtin(vm, iter, next) {
            return v.map(Stepped::Value);
        }
        let r = vm.call(&next, iter, &[])?;
        return result_of(vm, r).map(Stepped::Value);
    }
    if let Value::Obj(id) = iter
        && matches!(vm.heap[id as usize].kind, Kind::Generator(_))
        && next.as_obj() == Some(vm.realm.generator_next)
    {
        fr.set_index(vm, PHASE, phase + 1);
        return Ok(match resume(vm, fr, id, 0)? {
            None => Stepped::Pending(Step::Pushed),
            Some((_, true)) => Stepped::Value(None),
            Some((v, false)) => Stepped::Value(Some(v)),
        });
    }
    let direct = stepped_directly(vm, &iter);
    fr.set_index(vm, PHASE, phase);
    call(vm, fr, Slot::pack(next), Slot::pack(iter), [], !direct).map(Stepped::Pending)
}

/// A built-in iterator stepped by the shared `next` (`iter_next`), as calling it from native code and reading its
/// result does, without making the result: `None` when `next` is another function.
#[inline(always)]
fn step_builtin(vm: &mut Vm, iter: Value, next: Value) -> Option<Result<Option<Value>, Value>> {
    let (Value::Obj(id), Value::Obj(n)) = (iter, next) else {
        return None;
    };
    match vm.heap[n as usize].kind {
        Kind::Native { f, .. } if std::ptr::fn_addr_eq(f, iter_next as crate::vm::NativeFn) => {}
        _ => return None,
    }
    vm.host.meter.counted = false;
    let r = if matches!(vm.heap[id as usize].kind, Kind::ExoticIter { .. }) {
        Ok(exotic_step(vm, id))
    } else {
        vm.iter_step(&iter)
    };
    vm.host.meter.bytecode = false;
    Some(r)
}

/// An iterator result: its value, or `None` when it is done.
fn result_of(vm: &mut Vm, r: Value) -> Result<Option<Value>, Value> {
    let Value::Obj(rid) = r else {
        return Err(vm.type_error("Iterator next() result must be an object."));
    };
    let (dk, vk) = (vm.names.done, vm.names.value);
    let done = vm.get_obj(rid, dk);
    if vm.truthy(&done) {
        return Ok(None);
    }
    Ok(Some(vm.get_obj(rid, vk)))
}

/// Calls `f` for the frame, counted as bytecode calls it or not as native code does, with what it throws coming back
/// as `Input::Threw`. A call that fails before it runs fails here, with no handler left behind.
fn call<const N: usize>(
    vm: &mut Vm,
    fr: Frame,
    f: Slot,
    this: Slot,
    args: [Slot; N],
    counted: bool,
) -> Result<Step, Value> {
    if !counted {
        return Ok(fr.catching_list(vm, f, this, &args, Step::CallUncounted));
    }
    let n = vm.handlers_mut().len();
    let r = fr.catching(vm, f, this, args);
    if r.is_err() {
        vm.handlers_mut().truncate(n);
    }
    r
}

/// Resumes the generator `g` for the frame (see `Vm::native_resume`), with what it throws coming back as
/// `Input::Threw`.
fn resume(vm: &mut Vm, fr: Frame, g: Id, mode: u8) -> Result<Option<(Value, bool)>, Value> {
    let n = vm.handlers_mut().len();
    let sp = (vm.stack.len() - fr.base()) as u32;
    vm.handlers_mut().push(Handler {
        pc: THREW as u32,
        sp,
    });
    let r = vm.native_resume(g, mode, Value::Undef);
    if !matches!(r, Ok(None)) {
        vm.handlers_mut().truncate(n);
    }
    r
}

/// A failure of the loop, after the source was taken: closes the source, ignoring how the close goes, then throws it.
fn close_throw(vm: &mut Vm, fr: Frame, e: Value) -> Result<Step, Value> {
    if vm.fatal.is_some() {
        return Err(e);
    }
    let iter = helper_mut(vm, helper_of(vm, fr)).iter;
    fr.set(vm, STASH, e);
    fr.set_index(vm, PHASE, CLOSE_THROW);
    close(vm, fr, iter)
}

/// The prelude's `closeIterator(source)`: entered, then a `return` method called and its result checked with
/// `$IsObject`, which costs a native's call more when the method is native.
fn close_source(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    fuel::method(vm);
    let iter = helper_mut(vm, helper_of(vm, fr)).iter;
    let Value::Obj(id) = iter else {
        return out(vm, fr, None);
    };
    let rk = vm.names.return_;
    let method = vm.get_obj(id, rk);
    if method.is_nullish() {
        return out(vm, fr, None);
    }
    let native = !vm.is_closure(&method);
    fr.set_index(vm, CLOSE, native as usize);
    close(vm, fr, iter)
}

/// Closes `it` as `Vm::iter_close` does; how it went comes to `closed`, now or once the call it makes returns. Except
/// for `closeIterator`, the close costs what calling its `return` does, read before it closes.
fn close(vm: &mut Vm, fr: Frame, it: Value) -> Result<Step, Value> {
    if fr.index(vm, PHASE) != CLOSE_SOURCE {
        let cost = vm.close_fuel(&it);
        fr.set_index(vm, CLOSE, cost as usize);
    }
    let Value::Obj(id) = it else {
        return closed(vm, fr, Ok(()));
    };
    match &vm.heap[id as usize].kind {
        Kind::Generator(GenState::Suspended(_)) => match resume(vm, fr, id, 1) {
            Ok(None) => Ok(Step::Pushed),
            Ok(Some(_)) => closed(vm, fr, Ok(())),
            Err(e) => closed(vm, fr, Err(e)),
        },
        Kind::Generator(_)
        | Kind::ArrayIter { .. }
        | Kind::MapIter { .. }
        | Kind::StrIter { .. }
        | Kind::ListIter { .. } => closed(vm, fr, Ok(())),
        _ => {
            let rk = vm.names.return_;
            let f = vm.get_obj(id, rk);
            if f.is_nullish() {
                return closed(vm, fr, Ok(()));
            }
            if !vm.is_callable(&f) {
                // `closeIterator` calls it, which fails as a call of the helper's prelude generator does.
                let e = if fr.index(vm, PHASE) == CLOSE_SOURCE {
                    let site = helper_mut(vm, helper_of(vm, fr)).site;
                    not_callable(vm, site)
                } else {
                    vm.type_error("Iterator return must be a function.")
                };
                return closed(vm, fr, Err(e));
            }
            call(vm, fr, Slot::pack(f), Slot::pack(it), [], false)
        }
    }
}

/// A close the frame made ended: spends its fuel, then goes on by what the frame was closing for.
fn closed(vm: &mut Vm, fr: Frame, outcome: Result<(), Value>) -> Result<Step, Value> {
    match fr.index(vm, PHASE) {
        CLOSE_THROW => {
            let cost = fr.index(vm, CLOSE) as i32;
            vm.fuel(cost);
            Err(fr.get(vm, STASH))
        }
        CLOSE_SOURCE => {
            outcome?;
            if fr.index(vm, CLOSE) != 0 {
                fuel::native(vm);
            }
            fuel::native(vm);
            out(vm, fr, None)
        }
        phase => {
            match outcome {
                Ok(()) => {
                    let cost = fr.index(vm, CLOSE) as i32;
                    vm.fuel(cost);
                }
                // `return()` closes the source after its inner record whatever that close did, and throws the
                // first failure.
                Err(e) if fr.index(vm, FAILED) == 0 => {
                    fr.set(vm, STASH, e);
                    fr.set_index(vm, FAILED, 1);
                }
                Err(_) => {}
            }
            if phase == CLOSE_INNER {
                fr.set_index(vm, PHASE, CLOSE_RECORD);
                let iter = helper_mut(vm, helper_of(vm, fr)).iter;
                return close(vm, fr, iter);
            }
            if fr.index(vm, FAILED) != 0 {
                return Err(fr.get(vm, STASH));
            }
            out(vm, fr, None)
        }
    }
}

// The consumers of an iterator run on the for-of driver (see `native::ForOf`), from its record: the slots after the
// loop's are what they do, the callback, the next index, the accumulator (or `toArray`'s result) and whether it is
// set, and the item being decided on.
const USE_MODE: usize = FOR_OF_SLOTS;
const USE_F: usize = FOR_OF_SLOTS + 1;
const USE_INDEX: usize = FOR_OF_SLOTS + 2;
const USE_ACC: usize = FOR_OF_SLOTS + 3;
const USE_HAS_ACC: usize = FOR_OF_SLOTS + 4;
const USE_ITEM: usize = FOR_OF_SLOTS + 5;

const FOR_EACH: usize = 0;
const SOME: usize = 1;
const EVERY: usize = 2;
const FIND: usize = 3;
const TO_ARRAY: usize = 4;
const REDUCE: usize = 5;

/// `forEach`, `some`, `every`, `find`, `toArray` and `reduce` of `Iterator.prototype`, as the prelude's
/// `Iterator$prototype$...` and its `iteratorTest` run them: a callback that throws closes the iterator, and one
/// that decides closes it too.
pub(crate) struct Consume;

impl ForOf for Consume {
    fn item(vm: &mut Vm, fr: Frame, x: Value) -> Result<Flow, Value> {
        match fr.index(vm, USE_MODE) {
            TO_ARRAY => {
                let out = fr.slot(vm, USE_ACC).obj().unwrap_or(0);
                if let Kind::Array(items) = &mut vm.heap[out as usize].kind {
                    if items.len() >= crate::ops::MAX_ARRAY_LEN {
                        return Err(vm.range_error("Invalid array length"));
                    }
                    items.push(x);
                }
                Ok(Flow::Next)
            }
            REDUCE if fr.index(vm, USE_HAS_ACC) == 0 => {
                fr.set(vm, USE_ACC, x);
                fr.set_index(vm, USE_HAS_ACC, 1);
                let index = fr.index(vm, USE_INDEX);
                fr.set_index(vm, USE_INDEX, index + 1);
                Ok(Flow::Next)
            }
            REDUCE => {
                let (f, acc, index) = (
                    fr.slot(vm, USE_F),
                    fr.slot(vm, USE_ACC),
                    fr.slot(vm, USE_INDEX),
                );
                Ok(Flow::Call(fr.catching(
                    vm,
                    f,
                    Slot::UNDEF,
                    [acc, Slot::pack(x), index],
                )?))
            }
            _ => {
                fr.set(vm, USE_ITEM, x);
                let (f, index) = (fr.slot(vm, USE_F), fr.slot(vm, USE_INDEX));
                Ok(Flow::Call(fr.catching(
                    vm,
                    f,
                    Slot::UNDEF,
                    [Slot::pack(x), index],
                )?))
            }
        }
    }

    fn returned(vm: &mut Vm, fr: Frame, r: Slot) -> Result<Flow, Value> {
        let index = fr.index(vm, USE_INDEX);
        fr.set_index(vm, USE_INDEX, index + 1);
        let r = r.get();
        Ok(match fr.index(vm, USE_MODE) {
            REDUCE => {
                fr.set(vm, USE_ACC, r);
                Flow::Next
            }
            SOME if vm.truthy(&r) => Flow::Stop(Value::Bool(true)),
            EVERY if !vm.truthy(&r) => Flow::Stop(Value::Bool(false)),
            FIND if vm.truthy(&r) => Flow::Stop(fr.get(vm, USE_ITEM)),
            _ => Flow::Next,
        })
    }

    fn finish(vm: &mut Vm, fr: Frame) -> Res {
        let r = match fr.index(vm, USE_MODE) {
            SOME => Value::Bool(false),
            EVERY => Value::Bool(true),
            TO_ARRAY => fr.get(vm, USE_ACC),
            REDUCE if fr.index(vm, USE_HAS_ACC) != 0 => fr.get(vm, USE_ACC),
            REDUCE => {
                return Err(vm.type_error(
                    "Iterator.prototype.reduce of an empty iterator with no initial value.",
                ));
            }
            _ => Value::Undef,
        };
        vm.bytecode_builtin();
        Ok(r)
    }

    fn stopped(vm: &mut Vm) {
        vm.bytecode_builtin();
    }
}

/// Starts a consumer on the iterator `this` once its prologue's fuel is spent: a `next` that is not a function fails
/// as the first step would.
fn consume(vm: &mut Vm, this: Value, callee: Id, iter: Value, next: Value, own: [Value; 4]) -> Res {
    let direct = stepped_directly(vm, &iter);
    if !direct && !vm.is_callable(&next) {
        let name = vm.call_site().unwrap_or("The called value").to_owned();
        return Err(vm.type_error(&format!("{name} is not a function.")));
    }
    let next = if direct { Value::Undef } else { next };
    let own = [
        own[0],
        own[1],
        Value::Num(0.0),
        own[2],
        own[3],
        Value::Undef,
    ];
    enter_for_of_record(
        vm,
        crate::native::NativeOp::IterConsume,
        callee,
        this,
        iter,
        next,
        &own,
    )
}

/// The prologue of `forEach`, `some`, `every` and `find`: the prelude's `Iterator$prototype$...` and its
/// `iteratorTest`.
fn test(vm: &mut Vm, this: Value, args: &[Value], callee: Id, mode: usize, name: &str) -> Res {
    fuel::method(vm);
    fuel::method(vm);
    let (iter, next) = direct(vm, &this)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Iterator.prototype.{name}"))?;
    fuel::native(vm);
    consume(
        vm,
        this,
        callee,
        iter,
        next,
        [Value::Num(mode as f64), f, Value::Undef, Value::Num(0.0)],
    )
}

fn it_for_each(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    test(vm, this, args, callee, FOR_EACH, "forEach")
}

fn it_some(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    test(vm, this, args, callee, SOME, "some")
}

fn it_every(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    test(vm, this, args, callee, EVERY, "every")
}

fn it_find(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    test(vm, this, args, callee, FIND, "find")
}

fn it_to_array(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    fuel::method(vm);
    let (iter, next) = direct(vm, &this)?;
    let out = vm.new_array(Vec::new());
    consume(
        vm,
        this,
        callee,
        iter,
        next,
        [
            Value::Num(TO_ARRAY as f64),
            Value::Undef,
            out,
            Value::Num(0.0),
        ],
    )
}

fn it_reduce(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    fuel::method(vm);
    let (iter, next) = direct(vm, &this)?;
    let f = super::require_callback(vm, &arg(args, 0), "Iterator.prototype.reduce")?;
    fuel::native(vm);
    let (acc, has) = match args.get(1) {
        Some(a) => (*a, 1.0),
        None => (Value::Undef, 0.0),
    };
    consume(
        vm,
        this,
        callee,
        iter,
        next,
        [Value::Num(REDUCE as f64), f, acc, Value::Num(has)],
    )
}

/// `Iterator.from` over an iterable whose `[Symbol.iterator]` it calls, as the prelude's `flattenable` does.
fn from_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (method, v) = (fr.slot(vm, 1), fr.slot(vm, 0));
            fr.call_slots(vm, method, v, [])
        }
        Input::Returned(it) => {
            let (iter, next) = direct(vm, &it.get())?;
            Ok(Step::Done(primed(vm, iter, next, HelperOp::Wrap)))
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

/// The steps of this family's native frames (`native::NativeOp::Iterators`), by sub-op; see `native.rs`.
pub(crate) fn family_step(vm: &mut Vm, sub: u16, fr: Frame, input: Input) -> Result<Step, Value> {
    match sub {
        HELPER => helper_frame(vm, fr, input),
        _ => from_step(vm, fr, input),
    }
}
