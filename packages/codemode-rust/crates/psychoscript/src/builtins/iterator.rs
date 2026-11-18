//! Live iterators over standard-library collections, and the shared iterator prototype's `next`.

use super::{arg, fuel};
use crate::native::{FOR_OF_SLOTS, Flow, ForOf, Frame, enter_for_of_record};
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{Res, Vm};

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

/// Closes an iterator record a prelude `for...of` leaves early: the iterator's `return`, at what calling it costs.
fn close_record(vm: &mut Vm, iter: &Value) -> Result<(), Value> {
    let close = vm.close_fuel(iter);
    vm.iter_close(iter)?;
    vm.fuel(close);
    Ok(())
}

/// The prelude's `closeIterator(source)`: entered, then a `return` method called and its result checked with
/// `$IsObject`.
fn close_source(vm: &mut Vm, iter: &Value) -> Result<(), Value> {
    fuel::method(vm);
    let Value::Obj(id) = iter else { return Ok(()) };
    let rk = vm.names.return_;
    let method = vm.get_obj(*id, rk);
    if method.is_nullish() {
        return Ok(());
    }
    let native =
        !matches!(&method, Value::Obj(m) if matches!(vm.heap[*m as usize].kind, Kind::Closure(_)));
    vm.iter_close(iter)?;
    if native {
        fuel::native(vm);
    }
    fuel::native(vm);
    Ok(())
}

/// Where an iterator record was made, for the error when its `next` is not a function: by a helper, with the name
/// it kept, or by the running call.
#[derive(Clone, Copy)]
enum Site {
    Kept(Value),
}

fn step(vm: &mut Vm, iter: &Value, next: &Value, site: Site) -> Result<Option<Value>, Value> {
    if !vm.is_callable(next) {
        let name = match site {
            Site::Kept(Value::Str(s)) => Some(vm.text(s).to_owned()),
            Site::Kept(_) => None,
        };
        let name = name.as_deref().unwrap_or("The called value");
        return Err(vm.type_error(&format!("{name} is not a function.")));
    }
    let r = if stepped_directly(vm, iter) {
        vm.call(next, *iter, &[])?
    } else {
        vm.call_counted(next, *iter, &[])?
    };
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

/// An iterable by its `[Symbol.iterator]`, otherwise the object itself as an iterator: the prelude's
/// `flattenable`, with its `$IsObject` for a value that is not a string, and `$Describe` when it fails.
fn flattenable(vm: &mut Vm, v: &Value, strings: bool, name: &str) -> Result<(Value, Value), Value> {
    fuel::method(vm);
    let ok = match v {
        Value::Str(_) => strings,
        Value::Obj(_) => {
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
    let method = vm.get(v, SYM_ITERATOR)?;
    let it = if method.is_nullish() {
        *v
    } else {
        vm.call_counted(&method, *v, &[])?
    };
    direct(vm, &it)
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

fn iterator_from(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
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
    let (iter, next) = flattenable(vm, &v, true, "Iterator.from")?;
    Ok(primed(vm, iter, next, HelperOp::Wrap))
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

fn helper_mut<'a>(vm: &'a mut Vm, id: Id) -> &'a mut Helper {
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

/// One result of a helper: `Some(value)`, or `None` once it is done. `resumed` is whether it yielded before, so
/// its prelude generator goes on from that `yield`: through its loop's back-edge, and for `take` with nothing left,
/// out of the loop. Spends that generator's fuel (see `fuel.rs`).
fn helper_step(vm: &mut Vm, id: Id, resumed: bool) -> Result<Option<Value>, Value> {
    let h = helper_mut(vm, id);
    let (iter, next, site) = (h.iter, h.next, h.site);
    if let HelperOp::Take(n) = h.op
        && n <= 0.0
    {
        if resumed {
            close_record(vm, &iter)?;
        } else {
            close_source(vm, &iter)?;
        }
        return Ok(None);
    }
    let mut back = resumed;
    loop {
        let h = helper_mut(vm, id);
        if let HelperOp::FlatMap(_, Some((inner, inext))) = h.op {
            if std::mem::take(&mut back) {
                fuel::step(vm);
            }
            match step(vm, &inner, &inext, Site::Kept(Value::Undef)) {
                Ok(Some(v)) => return Ok(Some(v)),
                Ok(None) => {
                    if let HelperOp::FlatMap(_, slot) = &mut helper_mut(vm, id).op {
                        *slot = None;
                    }
                    fuel::step(vm);
                    continue;
                }
                Err(e) => {
                    let close = vm.close_fuel(&iter);
                    let _ = vm.iter_close(&iter);
                    vm.fuel(close);
                    return Err(e);
                }
            }
        }
        if std::mem::take(&mut back) {
            fuel::step(vm);
        }
        let Some(item) = step(vm, &iter, &next, Site::Kept(site))? else {
            return Ok(None);
        };
        let h = helper_mut(vm, id);
        let index = h.counter;
        let outcome: Result<Option<Value>, Value> = match &mut h.op {
            HelperOp::Wrap => Ok(Some(item)),
            HelperOp::Take(n) => {
                *n -= 1.0;
                Ok(Some(item))
            }
            HelperOp::Drop(n) => {
                if *n > 0.0 {
                    *n -= 1.0;
                    back = true;
                    Ok(None)
                } else {
                    Ok(Some(item))
                }
            }
            HelperOp::Map(f) => {
                let f = *f;
                h.counter += 1.0;
                vm.call_counted(&f, Value::Undef, &[item, Value::Num(index)])
                    .map(Some)
            }
            HelperOp::Filter(f) => {
                let f = *f;
                h.counter += 1.0;
                back = true;
                vm.call_counted(&f, Value::Undef, &[item, Value::Num(index)])
                    .map(|r| vm.truthy(&r).then_some(item))
            }
            HelperOp::FlatMap(f, _) => {
                let f = *f;
                h.counter += 1.0;
                let r = vm
                    .call_counted(&f, Value::Undef, &[item, Value::Num(index)])
                    .and_then(|r| flattenable(vm, &r, false, "Iterator.prototype.flatMap"));
                match r {
                    Ok(inner) => {
                        if let HelperOp::FlatMap(_, slot) = &mut helper_mut(vm, id).op {
                            *slot = Some(inner);
                        }
                        Ok(None)
                    }
                    Err(e) => Err(e),
                }
            }
        };
        match outcome {
            Ok(Some(v)) => return Ok(Some(v)),
            Ok(None) => continue,
            Err(e) => {
                let close = vm.close_fuel(&iter);
                let _ = vm.iter_close(&iter);
                vm.fuel(close);
                return Err(e);
            }
        }
    }
}

fn helper_next(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_helper(vm, &this, "next")?;
    match helper_mut(vm, id).state {
        HelperState::Done => return Ok(vm.iter_result(Value::Undef, true)),
        HelperState::Running => return Err(vm.type_error("Generator is already running")),
        _ => {}
    }
    let resumed = helper_mut(vm, id).state == HelperState::Suspended;
    helper_mut(vm, id).state = HelperState::Running;
    let r = helper_step(vm, id, resumed);
    let h = helper_mut(vm, id);
    match r {
        Ok(Some(v)) => {
            h.state = HelperState::Suspended;
            Ok(vm.iter_result(v, false))
        }
        Ok(None) => {
            h.state = HelperState::Done;
            Ok(vm.iter_result(Value::Undef, true))
        }
        Err(e) => {
            h.state = HelperState::Done;
            Err(e)
        }
    }
}

fn helper_return(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_helper(vm, &this, "return")?;
    let h = helper_mut(vm, id);
    match h.state {
        HelperState::Done => return Ok(vm.iter_result(Value::Undef, true)),
        HelperState::Running => return Err(vm.type_error("Generator is already running")),
        _ => {}
    }
    // Before its first value the prelude generator's `finally` closes the source with `closeIterator`; at a `yield`
    // its loops close their iterator records.
    let started = h.state == HelperState::Suspended;
    h.state = HelperState::Done;
    let iter = h.iter;
    let inner = match &mut h.op {
        HelperOp::FlatMap(_, slot) => slot.take(),
        _ => None,
    };
    if !started {
        close_source(vm, &iter)?;
    } else if let Some((inner, _)) = inner {
        let r = close_record(vm, &inner);
        let r2 = close_record(vm, &iter);
        r?;
        r2?;
    } else {
        close_record(vm, &iter)?;
    }
    Ok(vm.iter_result(Value::Undef, true))
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

/// The steps of this family's native frames (`native::NativeOp::Iterators`), by sub-op; see `native.rs`.
pub(crate) fn family_step(
    _vm: &mut Vm,
    _sub: u16,
    _fr: crate::native::Frame,
    _input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    Ok(crate::native::Step::Done(Value::Undef))
}
