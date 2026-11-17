//! Live iterators over standard-library collections, and the shared iterator prototype's `next`.

use super::arg;
use crate::object::*;
use crate::value::{Id, Value};
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

/// GetIteratorDirect: the iterator and its `next`, read once.
fn direct(vm: &mut Vm, v: &Value) -> Result<(Value, Value), Value> {
    let Value::Obj(id) = v else {
        return Err(vm.type_error("An iterator must be an object."));
    };
    let nk = vm.names.next;
    let next = vm.get_obj(*id, nk);
    Ok((*v, next))
}

fn step(vm: &mut Vm, iter: &Value, next: &Value) -> Result<Option<Value>, Value> {
    let r = vm.call(next, *iter, &[])?;
    let Value::Obj(rid) = r else {
        let d = super::describe_value(vm, &r);
        return Err(vm.type_error(&format!("Iterator result {d} is not an object")));
    };
    let (dk, vk) = (vm.names.done, vm.names.value);
    let done = vm.get_obj(rid, dk);
    if vm.truthy(&done) {
        return Ok(None);
    }
    Ok(Some(vm.get_obj(rid, vk)))
}

/// An iterable by its `[Symbol.iterator]`, otherwise the object itself as an iterator.
fn flattenable(vm: &mut Vm, v: &Value, strings: bool, name: &str) -> Result<(Value, Value), Value> {
    let ok = match v {
        Value::Str(_) => strings,
        Value::Obj(_) => true,
        _ => false,
    };
    if !ok {
        let d = super::describe_value(vm, v);
        return Err(vm.type_error(&format!(
            "{name} expects an iterable or iterator, received {d}."
        )));
    }
    let method = vm.get(v, SYM_ITERATOR)?;
    let it = if method.is_nullish() {
        *v
    } else {
        vm.call(&method, *v, &[])?
    };
    direct(vm, &it)
}

fn new_helper(vm: &mut Vm, iter: Value, next: Value, op: HelperOp) -> Value {
    let proto = vm.realm.std.iterator_helper;
    let h = Helper {
        iter,
        next,
        op,
        counter: 0.0,
        state: HelperState::Start,
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
    let v = arg(args, 0);
    if inherits_iterator(vm, &v) {
        return Ok(v);
    }
    let (iter, next) = flattenable(vm, &v, true, "Iterator.from")?;
    Ok(new_helper(vm, iter, next, HelperOp::Wrap))
}

fn callback_helper(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    make: fn(Value) -> HelperOp,
) -> Res {
    let (iter, next) = direct(vm, this)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Iterator.prototype.{name}"))?;
    Ok(new_helper(vm, iter, next, make(f)))
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
    let (iter, next) = direct(vm, &this)?;
    let n = count(vm, &arg(args, 0), "take")?;
    Ok(new_helper(vm, iter, next, HelperOp::Take(n)))
}

fn it_drop(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let (iter, next) = direct(vm, &this)?;
    let n = count(vm, &arg(args, 0), "drop")?;
    Ok(new_helper(vm, iter, next, HelperOp::Drop(n)))
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

/// One result of a helper: `Some(value)`, or `None` once it is done.
fn helper_step(vm: &mut Vm, id: Id) -> Result<Option<Value>, Value> {
    let h = helper_mut(vm, id);
    let (iter, next) = (h.iter, h.next);
    if let HelperOp::Take(n) = h.op
        && n <= 0.0
    {
        vm.iter_close(&iter)?;
        return Ok(None);
    }
    loop {
        let h = helper_mut(vm, id);
        if let HelperOp::FlatMap(_, Some((inner, inext))) = h.op {
            match step(vm, &inner, &inext) {
                Ok(Some(v)) => return Ok(Some(v)),
                Ok(None) => {
                    if let HelperOp::FlatMap(_, slot) = &mut helper_mut(vm, id).op {
                        *slot = None;
                    }
                    continue;
                }
                Err(e) => {
                    let _ = vm.iter_close(&iter);
                    return Err(e);
                }
            }
        }
        let Some(item) = step(vm, &iter, &next)? else {
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
                    Ok(None)
                } else {
                    Ok(Some(item))
                }
            }
            HelperOp::Map(f) => {
                let f = *f;
                h.counter += 1.0;
                vm.call(&f, Value::Undef, &[item, Value::Num(index)])
                    .map(Some)
            }
            HelperOp::Filter(f) => {
                let f = *f;
                h.counter += 1.0;
                vm.call(&f, Value::Undef, &[item, Value::Num(index)])
                    .map(|r| vm.truthy(&r).then_some(item))
            }
            HelperOp::FlatMap(f, _) => {
                let f = *f;
                h.counter += 1.0;
                let r = vm
                    .call(&f, Value::Undef, &[item, Value::Num(index)])
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
                let _ = vm.iter_close(&iter);
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
    helper_mut(vm, id).state = HelperState::Running;
    let r = helper_step(vm, id);
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
    h.state = HelperState::Done;
    let iter = h.iter;
    let inner = match &mut h.op {
        HelperOp::FlatMap(_, slot) => slot.take(),
        _ => None,
    };
    if let Some((inner, _)) = inner {
        let r = vm.iter_close(&inner);
        let r2 = vm.iter_close(&iter);
        r?;
        r2?;
    } else {
        vm.iter_close(&iter)?;
    }
    Ok(vm.iter_result(Value::Undef, true))
}

/// Runs `f(item, index)` over the iterator until it decides, closing the iterator when it stops early or throws.
fn consume(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    decide: fn(&mut Vm, Value, Value) -> Option<Value>,
) -> Result<Option<Value>, Value> {
    let (iter, next) = direct(vm, this)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Iterator.prototype.{name}"))?;
    let mut index = 0.0;
    while let Some(item) = step(vm, &iter, &next)? {
        let r = match vm.call(&f, Value::Undef, &[item, Value::Num(index)]) {
            Ok(r) => r,
            Err(e) => {
                let _ = vm.iter_close(&iter);
                return Err(e);
            }
        };
        index += 1.0;
        if let Some(v) = decide(vm, item, r) {
            vm.iter_close(&iter)?;
            return Ok(Some(v));
        }
    }
    Ok(None)
}

fn it_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    consume(vm, &this, args, "forEach", |_, _, _| None)?;
    Ok(Value::Undef)
}

fn it_some(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = consume(vm, &this, args, "some", |vm, _, r| {
        vm.truthy(&r).then_some(Value::Bool(true))
    })?;
    Ok(r.unwrap_or(Value::Bool(false)))
}

fn it_every(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = consume(vm, &this, args, "every", |vm, _, r| {
        (!vm.truthy(&r)).then_some(Value::Bool(false))
    })?;
    Ok(r.unwrap_or(Value::Bool(true)))
}

fn it_find(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = consume(vm, &this, args, "find", |vm, item, r| {
        vm.truthy(&r).then_some(item)
    })?;
    Ok(r.unwrap_or(Value::Undef))
}

fn it_to_array(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let (iter, next) = direct(vm, &this)?;
    let mut out = Vec::new();
    while let Some(item) = step(vm, &iter, &next)? {
        if out.len() >= crate::ops::MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length"));
        }
        out.push(item);
    }
    Ok(vm.new_array(out))
}

fn it_reduce(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let (iter, next) = direct(vm, &this)?;
    let f = super::require_callback(vm, &arg(args, 0), "Iterator.prototype.reduce")?;
    let mut acc = args.get(1).copied();
    let mut index = 0.0;
    while let Some(item) = step(vm, &iter, &next)? {
        acc = Some(match acc {
            None => item,
            Some(a) => match vm.call(&f, Value::Undef, &[a, item, Value::Num(index)]) {
                Ok(r) => r,
                Err(e) => {
                    let _ = vm.iter_close(&iter);
                    return Err(e);
                }
            },
        });
        index += 1.0;
    }
    match acc {
        Some(a) => Ok(a),
        None => Err(
            vm.type_error("Iterator.prototype.reduce of an empty iterator with no initial value.")
        ),
    }
}
