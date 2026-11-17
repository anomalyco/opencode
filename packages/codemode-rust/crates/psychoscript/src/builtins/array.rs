//! Array and Array.prototype.

use super::{arg, fuel, to_index};
use crate::object::*;
use crate::ops::{Hint, MAX_ARRAY_LEN, without_holes};
use crate::strings::StrId;
use crate::value::{Id, Value, to_integer};
use crate::vm::{Res, Vm};

pub fn setup(vm: &mut Vm) {
    let ap = vm.realm.array_proto;
    let array = vm.ctor("Array", 1, array_ctor, ap, Value::Undef);
    vm.methods(
        array,
        &[
            ("isArray", 1, array_is_array),
            ("from", 1, array_from),
            ("of", 0, array_of),
        ],
    );
    vm.methods(
        ap,
        &[
            ("push", 1, a_push),
            ("pop", 0, a_pop),
            ("shift", 0, a_shift),
            ("unshift", 1, a_unshift),
            ("slice", 2, a_slice),
            ("splice", 2, a_splice),
            ("toSpliced", 2, a_to_spliced),
            ("concat", 1, a_concat),
            ("join", 1, a_join),
            ("toString", 0, a_to_string),
            ("toLocaleString", 0, a_to_locale_string),
            ("reverse", 0, a_reverse),
            ("toReversed", 0, a_to_reversed),
            ("indexOf", 1, a_index_of),
            ("lastIndexOf", 1, a_last_index_of),
            ("includes", 1, a_includes),
            ("find", 1, a_find),
            ("findIndex", 1, a_find_index),
            ("findLast", 1, a_find_last),
            ("findLastIndex", 1, a_find_last_index),
            ("filter", 1, a_filter),
            ("map", 1, a_map),
            ("forEach", 1, a_for_each),
            ("some", 1, a_some),
            ("every", 1, a_every),
            ("reduce", 1, a_reduce),
            ("reduceRight", 1, a_reduce_right),
            ("sort", 1, a_sort),
            ("toSorted", 1, a_to_sorted),
            ("flat", 0, a_flat),
            ("flatMap", 1, a_flat_map),
            ("fill", 1, a_fill),
            ("copyWithin", 2, a_copy_within),
            ("at", 1, a_at),
            ("with", 2, a_with),
            ("keys", 0, a_keys),
            ("entries", 0, a_entries),
        ],
    );
    let values = vm.method(ap, "values", 0, a_values);
    vm.define_hidden(ap, SYM_ITERATOR, values);
}

fn arr_id(vm: &mut Vm, this: &Value) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Array(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(vm.type_error("Array.prototype method called on a value that is not an array"))
}

fn items<'a>(vm: &'a Vm, id: Id) -> &'a [Value] {
    match &vm.heap[id as usize].kind {
        Kind::Array(items) => items,
        _ => &[],
    }
}

#[inline]
fn len(vm: &Vm, id: Id) -> usize {
    vm.array_len(id)
}

#[inline]
fn is_sparse(vm: &Vm, id: Id) -> bool {
    vm.heap[id as usize].flags & SPARSE != 0
}

/// A sparse array's own element `i` past its items.
fn tail_elem(vm: &Vm, id: Id, i: usize) -> Option<Value> {
    if !is_sparse(vm, id) {
        return None;
    }
    let key = vm.atoms.lookup(&i.to_string())?;
    vm.heap[id as usize].props.get(key).copied()
}

/// Element `i` as the array holds it, with a hole read as `undefined` and not looked up on the prototypes.
fn item(vm: &Vm, id: Id, i: usize) -> Value {
    match items(vm, id).get(i) {
        Some(v) => undef(*v),
        None => tail_elem(vm, id, i).unwrap_or_default(),
    }
}

/// The indexes below `n` a method that skips holes visits: `None` for all of them, or for a sparse array only
/// those it holds, so a huge length is not walked index by index.
fn visit_order(vm: &Vm, id: Id, n: usize) -> Option<Vec<usize>> {
    if !is_sparse(vm, id) {
        return None;
    }
    let dense = items(vm, id).len().min(n);
    let tail = vm
        .sparse_tail(id)
        .into_iter()
        .map(|(i, _)| i)
        .filter(|i| *i < n);
    Some((0..dense).chain(tail).collect())
}

/// The `k`th index of a visit order over `n` indexes, or `None` past its end.
#[inline]
fn visit_at(order: &Option<Vec<usize>>, n: usize, k: usize) -> Option<usize> {
    match order {
        None => (k < n).then_some(k),
        Some(o) => o.get(k).copied(),
    }
}

/// Makes `this` array dense for a method that walks its items.
fn dense_id(vm: &mut Vm, this: &Value) -> Result<Id, Value> {
    let id = arr_id(vm, this)?;
    vm.densify(id)?;
    Ok(id)
}

fn undef(v: Value) -> Value {
    match v {
        Value::Uninit => Value::Undef,
        v => v,
    }
}

/// Element `i` as `array[i]` reads it: a hole or an index past the end may be inherited.
#[inline]
fn read(vm: &mut Vm, id: Id, i: usize) -> Value {
    match items(vm, id).get(i) {
        Some(v) if !matches!(v, Value::Uninit) => *v,
        _ => vm.missing_elem(id, i),
    }
}

/// Element `i` when `i in array`, which a hole or an index past the end may still be through the prototypes.
#[inline]
fn present(vm: &mut Vm, id: Id, i: usize) -> Option<Value> {
    match items(vm, id).get(i) {
        Some(v) if !matches!(v, Value::Uninit) => Some(*v),
        _ => inherited(vm, id, i),
    }
}

#[cold]
fn inherited(vm: &mut Vm, id: Id, i: usize) -> Option<Value> {
    vm.inherited_elem(id, i)
}

/// The array's items for a mutating method, after `check_mutable`.
fn items_mut<'a>(vm: &'a mut Vm, id: Id, growth: Option<i64>) -> Result<&'a mut Vec<Value>, Value> {
    check_mutable(vm, id, growth)?;
    array_items(vm, id)
}

/// The reference's check of what a mutating method's first write would hit on a frozen, sealed or non-extensible
/// array. `growth` is given by the methods that always write `length`: how many items they add (or remove, when
/// negative).
fn check_mutable(vm: &mut Vm, id: Id, growth: Option<i64>) -> Result<(), Value> {
    let flags = vm.heap[id as usize].flags;
    if flags & (NON_EXTENSIBLE | SEALED | FROZEN) == 0 {
        return Ok(());
    }
    let n = len(vm, id);
    let g = growth.unwrap_or(0);
    if g > 0 && flags & NON_EXTENSIBLE != 0 {
        return Err(vm.type_error(&format!(
            "Cannot add property {n}, object is not extensible."
        )));
    }
    if g < 0 && n > 0 && flags & SEALED != 0 {
        return Err(vm.type_error(&format!("Cannot delete property '{}'.", n - 1)));
    }
    if flags & FROZEN != 0 && (n > 0 || growth.is_some()) {
        let k = if n > 0 { "0" } else { "length" };
        return Err(vm.type_error(&format!("Cannot assign to read only property '{k}'.")));
    }
    Ok(())
}

fn array_items<'a>(vm: &'a mut Vm, id: Id) -> Result<&'a mut Vec<Value>, Value> {
    if !matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
        return Err(vm.type_error("not an array"));
    }
    match &mut vm.heap[id as usize].kind {
        Kind::Array(items) => Ok(items),
        _ => unreachable!("checked above"),
    }
}

fn callback(vm: &mut Vm, args: &[Value], name: &str) -> Result<Value, Value> {
    super::require_callback(vm, &arg(args, 0), name)
}

fn array_ctor(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.len() == 1
        && let Value::Num(n) = args[0]
    {
        if n < 0.0 || n.fract() != 0.0 || n > MAX_ARRAY_LEN as f64 {
            return Err(vm.range_error("Invalid array length."));
        }
        return Ok(vm.new_array(vec![Value::Uninit; n as usize]));
    }
    Ok(vm.new_array(args.to_vec()))
}

fn array_is_array(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        matches!(arg(args, 0), Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Array(_))),
    ))
}

fn array_of(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(vm.new_array(args.to_vec()))
}

fn array_from(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let src = arg(args, 0);
    let mapper = match arg(args, 1) {
        Value::Undef => None,
        f => Some(super::require_callback(vm, &f, "Array.from")?),
    };
    let this_arg = arg(args, 2);
    if vm.is_iterable(&src) {
        // The reference's `arrayFromIterable`: each value is mapped as it is read, and a mapper that throws closes
        // the iterator.
        fuel::handoff(vm);
        let mut out = Vec::new();
        fuel::for_of(vm, &src, |vm, x| {
            if out.len() >= MAX_ARRAY_LEN {
                return Err(vm.range_error("Invalid array length."));
            }
            out.push(match mapper {
                Some(f) => vm.call_counted(&f, this_arg, &[x, Value::Num(out.len() as f64)])?,
                None => x,
            });
            Ok(true)
        })?;
        vm.bytecode_builtin();
        return Ok(vm.new_array(out));
    }
    let id = match src {
        Value::Obj(id) if !matches!(vm.heap[id as usize].kind, Kind::Promise(_)) => id,
        _ => {
            let d = vm.describe_data(&src);
            return Err(vm.invalid_data(&format!(
                "Array.from expects an iterable or array-like value, received {d}."
            )));
        }
    };
    let lk = vm.names.length;
    let lv = vm.get_obj(id, lk);
    let n = to_integer(vm.number_of(&lv)?).max(0.0);
    if n > MAX_ARRAY_LEN as f64 {
        return Err(vm.range_error("Invalid array length."));
    }
    let n = n as usize;
    let has_indexes = vm.heap[id as usize]
        .props
        .items
        .iter()
        .any(|p| vm.atoms.index(p.key).is_some());
    let mut out = Vec::with_capacity(n);
    // With a mapper, the reference's `arrayFromLike`.
    if mapper.is_some() {
        fuel::handoff(vm);
    }
    for i in 0..n {
        let v = if has_indexes {
            vm.get_elem(&src, &Value::Num(i as f64))?
        } else {
            Value::Undef
        };
        out.push(match mapper {
            Some(f) => {
                let v = vm.call_counted(&f, this_arg, &[v, Value::Num(i as f64)])?;
                fuel::step(vm);
                v
            }
            None => v,
        });
    }
    if mapper.is_some() {
        vm.bytecode_builtin();
    }
    Ok(vm.new_array(out))
}

fn a_push(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    check_mutable(vm, id, Some(args.len() as i64))?;
    for a in args {
        vm.reject_circular(id, a, "Array.push result")?;
    }
    if is_sparse(vm, id) {
        return push_sparse(vm, id, args);
    }
    let items = array_items(vm, id)?;
    if items.len() + args.len() > MAX_ARRAY_LEN {
        return Err(vm.range_error("Invalid array length."));
    }
    items.extend_from_slice(args);
    Ok(Value::Num(items.len() as f64))
}

/// `push` on a sparse array: each value is a far element, up to the largest length an array may have.
fn push_sparse(vm: &mut Vm, id: Id, args: &[Value]) -> Res {
    let n = len(vm, id);
    if n + args.len() > u32::MAX as usize {
        // As the reference's host words it: one value and several take different paths there.
        return Err(vm.range_error(if args.len() == 1 {
            "Length exceeded the maximum array length"
        } else {
            "Invalid array length"
        }));
    }
    for (k, v) in args.iter().enumerate() {
        let key = vm.atoms.intern(&(n + k).to_string());
        vm.set_obj(id, key, *v)?;
    }
    Ok(Value::Num((n + args.len()) as f64))
}

fn a_pop(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    if is_sparse(vm, id) {
        check_mutable(vm, id, Some(-1))?;
        let n = len(vm, id);
        let last = vm.atoms.intern(&(n - 1).to_string());
        let v = item(vm, id, n - 1);
        let lk = vm.names.length;
        let o = &mut vm.heap[id as usize];
        o.props.remove(last);
        o.props.insert(lk, Value::Num((n - 1) as f64), 0);
        return Ok(v);
    }
    Ok(undef(
        items_mut(vm, id, Some(-1))?.pop().unwrap_or_default(),
    ))
}

fn a_shift(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    let items = items_mut(vm, id, Some(-1))?;
    if items.is_empty() {
        return Ok(Value::Undef);
    }
    Ok(undef(items.remove(0)))
}

fn a_unshift(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    check_mutable(vm, id, Some(args.len() as i64))?;
    for a in args {
        vm.reject_circular(id, a, "Array.unshift result")?;
    }
    let items = array_items(vm, id)?;
    items.splice(0..0, args.iter().cloned());
    Ok(Value::Num(items.len() as f64))
}

fn a_slice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    integers(vm, args, &[0, 1], |vm, args| {
        let n = len(vm, id);
        let s = to_index(vm, &arg(args, 0), n, 0)?;
        let e = to_index(vm, &arg(args, 1), n, n)?;
        if s >= e {
            return Ok(vm.new_array(Vec::new()));
        }
        if is_sparse(vm, id) {
            return slice_sparse(vm, id, s, e);
        }
        let out = items(vm, id)[s..e].to_vec();
        Ok(vm.new_array(out))
    })
}

/// `slice` of a sparse array: the elements it holds in the range, with holes between them.
fn slice_sparse(vm: &mut Vm, id: Id, s: usize, e: usize) -> Res {
    if e - s > MAX_ARRAY_LEN {
        return Err(vm.range_error("Invalid array length."));
    }
    let mut out = vec![Value::Uninit; e - s];
    let dense = items(vm, id);
    for (i, v) in dense.iter().enumerate().take(e).skip(s) {
        out[i - s] = *v;
    }
    for (i, v) in vm.sparse_tail(id) {
        if (s..e).contains(&i) {
            out[i - s] = v;
        }
    }
    Ok(vm.new_array(out))
}

fn splice_args(vm: &mut Vm, args: &[Value], n: usize) -> Result<(usize, usize), Value> {
    let start = to_index(vm, &arg(args, 0), n, 0)?;
    let count = match args.len() {
        0 => 0,
        1 => n - start,
        _ => (to_integer(vm.number_of(&args[1])?).max(0.0) as usize).min(n - start),
    };
    Ok((start, count))
}

fn a_splice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    integers(vm, args, &[0, 1], |vm, args| {
        let n = len(vm, id);
        let (start, count) = splice_args(vm, args, n)?;
        let insert: Vec<Value> = args.iter().skip(2).cloned().collect();
        for a in &insert {
            vm.reject_circular(id, a, "Array.splice result")?;
        }
        let items = items_mut(vm, id, Some(insert.len() as i64 - count as i64))?;
        let removed: Vec<Value> = items.splice(start..start + count, insert).collect();
        Ok(vm.new_array(removed))
    })
}

fn a_to_spliced(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    integers(vm, args, &[0, 1], |vm, args| {
        let n = len(vm, id);
        let (start, count) = splice_args(vm, args, n)?;
        let mut out = without_holes(items(vm, id));
        out.splice(start..start + count, args.iter().skip(2).cloned());
        Ok(vm.new_array(out))
    })
}

fn a_concat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    let mut out = items(vm, id).to_vec();
    for a in args {
        match a {
            Value::Obj(o) if matches!(vm.heap[*o as usize].kind, Kind::Array(_)) => {
                vm.densify(*o)?;
                out.extend_from_slice(items(vm, *o));
            }
            v => out.push(*v),
        }
        if out.len() > MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length."));
        }
    }
    Ok(vm.new_array(out))
}

pub fn join(vm: &mut Vm, id: Id, sep: &str, seen: &mut Vec<Id>) -> Result<String, Value> {
    if seen.contains(&id) {
        return Ok(String::new());
    }
    seen.push(id);
    vm.densify(id)?;
    let mut out = String::new();
    let n = len(vm, id);
    for i in 0..n {
        if i > 0 {
            out.push_str(sep);
        }
        match items(vm, id).get(i).cloned().unwrap_or_default() {
            Value::Undef | Value::Null | Value::Uninit => {}
            Value::Str(s) => out.push_str(vm.text(s)),
            Value::Num(x) => crate::value::write_num(&mut out, x),
            Value::Obj(o) if matches!(vm.heap[o as usize].kind, Kind::Array(_)) => {
                let s = join(vm, o, ",", seen)?;
                out.push_str(&s);
            }
            v => {
                let t = vm.string_of(&v)?;
                out.push_str(vm.text(t));
            }
        }
        if out.len() > crate::ops::MAX_STRING_LEN {
            return Err(vm.range_error("Invalid string length"));
        }
    }
    seen.pop();
    Ok(out)
}

fn a_join(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let sep = match arg(args, 0) {
        Value::Undef => vm.static_str(","),
        v => v,
    };
    joined(vm, id, Some(sep))
}

fn a_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    joined(vm, id, None)
}

/// The reference's `join` and `toString`: the separator (`join`'s) and the elements, holes and nullish ones as "",
/// are one list of conversions with the string hint (see `fuel::Conversions`), then joined. An element that is an
/// array converts through its own `toString`, as any object does.
fn joined(vm: &mut Vm, id: Id, sep: Option<Value>) -> Res {
    vm.densify(id)?;
    let is_obj = |v: &Value| matches!(v, Value::Obj(_));
    if !sep.as_ref().is_some_and(is_obj) && !items(vm, id).iter().any(is_obj) {
        let sep = match sep {
            Some(v) => {
                let t = vm.string_of(&v)?;
                vm.text(t).to_owned()
            }
            None => ",".to_owned(),
        };
        let s = join(vm, id, &sep, &mut Vec::new())?;
        return Ok(vm.string_val(s));
    }
    let empty = vm.static_str("");
    let mut list: Vec<Value> = sep.into_iter().collect();
    let parts = list.len();
    list.extend(items(vm, id).iter().map(|v| match v {
        Value::Undef | Value::Null | Value::Uninit => empty,
        v => *v,
    }));
    let mut c = fuel::Conversions::default();
    c.convert(vm, &[Hint::String], &mut list, false)?;
    let sep = match parts {
        0 => ",".to_owned(),
        _ => {
            let t = vm.string_of(&list[0])?;
            vm.text(t).to_owned()
        }
    };
    let mut out = String::new();
    for (i, v) in list[parts..].iter().enumerate() {
        if i > 0 {
            out.push_str(&sep);
        }
        let t = vm.string_of(v)?;
        out.push_str(vm.text(t));
        if out.len() > crate::ops::MAX_STRING_LEN {
            return Err(vm.range_error("Invalid string length"));
        }
    }
    let r = Ok(vm.string_val(out));
    c.finish(vm, r)
}

/// The reference's `integers`: the arguments at `positions`, `undefined` where missing, are one list of conversions
/// with the number hint (see `fuel::Conversions`) before `body` reads them.
fn integers(
    vm: &mut Vm,
    args: &[Value],
    positions: &[usize],
    body: impl FnOnce(&mut Vm, &[Value]) -> Res,
) -> Res {
    if !positions
        .iter()
        .any(|&p| matches!(args.get(p), Some(Value::Obj(_))))
    {
        return body(vm, args);
    }
    let mut listed: Vec<Value> = positions.iter().map(|&p| arg(args, p)).collect();
    let mut c = fuel::Conversions::default();
    c.convert(vm, &[Hint::Number], &mut listed, false)?;
    let mut converted = args.to_vec();
    for (&p, v) in positions.iter().zip(listed) {
        if p < args.len() {
            converted[p] = v;
        }
    }
    let r = body(vm, &converted);
    c.finish(vm, r)
}

fn a_to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    fuel::method(vm);
    let id = dense_id(vm, &this)?;
    fuel::native(vm);
    let key = vm.atoms.intern_static("toLocaleString");
    let mut out = String::new();
    let mut i = 0;
    while i < len(vm, id) {
        if i > 0 {
            out.push(',');
        }
        let item = read(vm, id, i);
        if !item.is_nullish() {
            let f = vm.get(&item, key)?;
            let r = vm.call_counted(&f, item, &[])?;
            let s = vm.string_of(&r)?;
            fuel::native(vm);
            out.push_str(vm.text(s));
            if out.len() > crate::ops::MAX_STRING_LEN {
                return Err(vm.range_error("Invalid string length"));
            }
        }
        i += 1;
        fuel::step(vm);
    }
    vm.bytecode_builtin();
    Ok(vm.string_val(out))
}

fn a_reverse(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    // Fewer than two items means no writes at all, so a frozen one-item array reverses fine.
    if len(vm, id) > 1 {
        items_mut(vm, id, None)?.reverse();
    }
    Ok(this)
}

fn a_to_reversed(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    let mut out = without_holes(items(vm, id));
    out.reverse();
    Ok(vm.new_array(out))
}

fn a_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    // An empty array answers before fromIndex converts.
    if n == 0 {
        return Ok(Value::Num(-1.0));
    }
    integers(vm, args, &[1], |vm, args| {
        let n = len(vm, id);
        let from = to_index(vm, &arg(args, 1), n, 0)?;
        let r = items(vm, id)
            .iter()
            .enumerate()
            .skip(from)
            .find(|(_, v)| !matches!(v, Value::Uninit) && vm.strict_eq(v, &x))
            .map(|(i, _)| i);
        // A sparse array's far elements come after its items.
        let r = r.or_else(|| {
            vm.sparse_tail(id)
                .into_iter()
                .find(|(i, v)| *i >= from && *i < n && vm.strict_eq(v, &x))
                .map(|(i, _)| i)
        });
        Ok(Value::Num(r.map_or(-1.0, |i| i as f64)))
    })
}

fn a_last_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    if n == 0 {
        return Ok(Value::Num(-1.0));
    }
    integers(vm, args, &[1], |vm, args| {
        let n = len(vm, id);
        let from = if args.len() > 1 {
            let k = to_integer(vm.number_of(&args[1])?);
            if k < 0.0 {
                n as f64 + k
            } else {
                k.min(n as f64 - 1.0)
            }
        } else {
            n as f64 - 1.0
        };
        if from < 0.0 {
            return Ok(Value::Num(-1.0));
        }
        let from = from as usize;
        let tail = vm.sparse_tail(id);
        let far = tail
            .iter()
            .rev()
            .find(|(i, v)| *i <= from && vm.strict_eq(v, &x))
            .map(|(i, _)| *i);
        let items = items(vm, id);
        let r = far.or_else(|| {
            (0..=from.min(items.len().saturating_sub(1)))
                .rev()
                .find(|i| {
                    items
                        .get(*i)
                        .is_some_and(|v| !matches!(v, Value::Uninit) && vm.strict_eq(v, &x))
                })
        });
        Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
    })
}

fn a_includes(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    if n == 0 {
        return Ok(Value::Bool(false));
    }
    integers(vm, args, &[1], |vm, args| {
        let n = len(vm, id);
        let from = to_index(vm, &arg(args, 1), n, 0)?;
        if is_sparse(vm, id) {
            return Ok(Value::Bool(includes_sparse(vm, id, &x, from, n)));
        }
        Ok(Value::Bool(
            items(vm, id)
                .iter()
                .skip(from)
                .any(|v| vm.same_value_zero(&undef(*v), &x)),
        ))
    })
}

/// `includes` on a sparse array: its elements from `from`, and its holes, which read as undefined.
fn includes_sparse(vm: &Vm, id: Id, x: &Value, from: usize, n: usize) -> bool {
    let dense = items(vm, id);
    let tail = vm.sparse_tail(id);
    let mut held = 0;
    for v in dense.iter().skip(from) {
        if !matches!(v, Value::Uninit) {
            held += 1;
        }
        if vm.same_value_zero(&undef(*v), x) {
            return true;
        }
    }
    for (i, v) in &tail {
        if *i >= from && *i < n {
            held += 1;
            if vm.same_value_zero(v, x) {
                return true;
            }
        }
    }
    matches!(x, Value::Undef) && held < n.saturating_sub(from)
}

/// The back-edges the reference's loop spends on the holes from `walked` up to `to`, which a sparse array's visit
/// skips here.
fn holes(vm: &mut Vm, walked: &mut usize, to: usize) {
    if to > *walked {
        vm.fuel_steps(to - *walked);
        *walked = to;
    }
}

/// Calls `f(value, index, array)` for each index below the starting length while `visit` returns `None`, reading
/// each element live, holes included; returns what stopped it. The find methods visit this way. Spends the fuel
/// of the reference's `findItem` (see `fuel.rs`).
fn each<T>(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    reverse: bool,
    mut visit: impl FnMut(&mut Vm, usize, Value, Value) -> Option<T>,
) -> Result<Option<T>, Value> {
    fuel::method(vm);
    let id = arr_id(vm, this)?;
    fuel::receiver_then_loop(vm);
    let f = callback(vm, args, name)?;
    fuel::native(vm);
    let this_arg = arg(args, 1);
    let n = len(vm, id);
    for k in 0..n {
        let i = if reverse { n - 1 - k } else { k };
        let v = read(vm, id, i);
        let r = vm.call_counted(&f, this_arg, &[v, Value::Num(i as f64), *this])?;
        if let Some(t) = visit(vm, i, v, r) {
            vm.bytecode_builtin();
            return Ok(Some(t));
        }
        fuel::step(vm);
    }
    vm.bytecode_builtin();
    Ok(None)
}

/// Like `each`, but skips the indexes not in the array when they come up, as the other callback methods do, with
/// the fuel of the reference's `forEachItem`, `mapItems`, `filterItems` and `testItems`.
fn each_present<T>(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    visit: impl FnMut(&mut Vm, usize, Value, Value) -> Option<T>,
) -> Result<Option<T>, Value> {
    fuel::method(vm);
    let id = arr_id(vm, this)?;
    each_present_in(vm, id, this, args, name, visit)
}

/// `each_present` once the receiver is known to be the array `id`.
fn each_present_in<T>(
    vm: &mut Vm,
    id: Id,
    this: &Value,
    args: &[Value],
    name: &str,
    mut visit: impl FnMut(&mut Vm, usize, Value, Value) -> Option<T>,
) -> Result<Option<T>, Value> {
    fuel::receiver_then_loop(vm);
    let f = callback(vm, args, name)?;
    fuel::native(vm);
    let this_arg = arg(args, 1);
    let n = len(vm, id);
    if let Some(order) = visit_order(vm, id, n) {
        let mut walked = 0;
        for i in order {
            holes(vm, &mut walked, i);
            if let Some(v) = present(vm, id, i) {
                let r = vm.call_counted(&f, this_arg, &[v, Value::Num(i as f64), *this])?;
                if let Some(t) = visit(vm, i, v, r) {
                    vm.bytecode_builtin();
                    return Ok(Some(t));
                }
            }
            fuel::step(vm);
            walked = i + 1;
        }
        holes(vm, &mut walked, n);
        vm.bytecode_builtin();
        return Ok(None);
    }
    for i in 0..n {
        if let Some(v) = present(vm, id, i) {
            let r = vm.call_counted(&f, this_arg, &[v, Value::Num(i as f64), *this])?;
            if let Some(t) = visit(vm, i, v, r) {
                vm.bytecode_builtin();
                return Ok(Some(t));
            }
        }
        fuel::step(vm);
    }
    vm.bytecode_builtin();
    Ok(None)
}

fn a_find(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(each(vm, &this, args, "Array.find", false, |vm, _, v, r| {
        vm.truthy(&r).then_some(v)
    })?
    .unwrap_or_default())
}

fn a_find_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = each(vm, &this, args, "Array.findIndex", false, |vm, i, _, r| {
        vm.truthy(&r).then_some(i)
    })?;
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn a_find_last(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(
        each(vm, &this, args, "Array.findLast", true, |vm, _, v, r| {
            vm.truthy(&r).then_some(v)
        })?
        .unwrap_or_default(),
    )
}

fn a_find_last_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = each(
        vm,
        &this,
        args,
        "Array.findLastIndex",
        true,
        |vm, i, _, r| vm.truthy(&r).then_some(i),
    )?;
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn a_some(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        each_present(vm, &this, args, "Array.some", |vm, _, _, r| {
            vm.truthy(&r).then_some(())
        })?
        .is_some(),
    ))
}

fn a_every(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        each_present(vm, &this, args, "Array.every", |vm, _, _, r| {
            (!vm.truthy(&r)).then_some(())
        })?
        .is_none(),
    ))
}

fn a_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    each_present(vm, &this, args, "Array.forEach", |_, _, _, _| None::<()>)?;
    Ok(Value::Undef)
}

fn a_filter(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let mut out = Vec::new();
    each_present(vm, &this, args, "Array.filter", |vm, _, v, r| {
        if vm.truthy(&r) {
            out.push(v);
        }
        None::<()>
    })?;
    Ok(vm.new_array(out))
}

fn a_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    fuel::method(vm);
    let id = arr_id(vm, &this)?;
    if len(vm, id) > MAX_ARRAY_LEN {
        return Err(vm.range_error("Invalid array length."));
    }
    // Skipped indexes stay holes.
    let mut out = vec![Value::Uninit; len(vm, id)];
    each_present_in(vm, id, &this, args, "Array.map", |_, i, _, r| {
        out[i] = r;
        None::<()>
    })?;
    Ok(vm.new_array(out))
}

fn reduce(vm: &mut Vm, this: Value, args: &[Value], reverse: bool) -> Res {
    fuel::method(vm);
    let id = arr_id(vm, &this)?;
    fuel::receiver_then_loop(vm);
    let f = callback(
        vm,
        args,
        if reverse {
            "Array.reduceRight"
        } else {
            "Array.reduce"
        },
    )?;
    fuel::native(vm);
    let full = len(vm, id);
    let order = visit_order(vm, id, full);
    let n = order.as_ref().map_or(full, Vec::len);
    let index = |k: usize| {
        let k = if reverse { n - 1 - k } else { k };
        match &order {
            None => k,
            Some(o) => o[k],
        }
    };
    // The reference's loops walk every index, holes a sparse array skips here included: `walked` counts the
    // positions its loops have passed, from the end for `reduceRight`.
    let sparse = order.is_some();
    let at = |i: usize| if reverse { full - 1 - i } else { i };
    let mut walked = 0;
    let mut k = 0;
    let mut acc = if args.len() >= 2 {
        args[1]
    } else {
        loop {
            if k >= n {
                if sparse {
                    holes(vm, &mut walked, full);
                }
                let label = if reverse { "reduceRight" } else { "reduce" };
                return Err(vm.type_error(&format!(
                    "Array.{label} of an empty array with no initial value."
                )));
            }
            k += 1;
            let i = index(k - 1);
            if sparse {
                holes(vm, &mut walked, at(i));
                walked = at(i) + 1;
            }
            if let Some(v) = present(vm, id, i) {
                break v;
            }
            fuel::step(vm);
        }
    };
    while k < n {
        let i = index(k);
        k += 1;
        if sparse {
            holes(vm, &mut walked, at(i));
            walked = at(i) + 1;
        }
        if let Some(v) = present(vm, id, i) {
            acc = vm.call_counted(&f, Value::Undef, &[acc, v, Value::Num(i as f64), this])?;
        }
        fuel::step(vm);
    }
    if sparse {
        holes(vm, &mut walked, full);
    }
    vm.bytecode_builtin();
    Ok(acc)
}

fn a_reduce(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, false)
}

fn a_reduce_right(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, true)
}

/// Checks a sort's comparator as the reference does, naming the method (`Array.sort`) in the error.
pub(super) fn sort_comparator(vm: &mut Vm, cmp: &Value, name: &str) -> Result<(), Value> {
    if !matches!(cmp, Value::Undef) {
        super::require_callback(vm, cmp, name)?;
    }
    Ok(())
}

pub(super) fn sort_values(vm: &mut Vm, list: Vec<Value>, cmp: &Value) -> Result<Vec<Value>, Value> {
    let (mut defined, undefs): (Vec<Value>, Vec<Value>) =
        list.into_iter().partition(|v| !matches!(v, Value::Undef));
    if let Value::Undef = cmp {
        // Over `SORT_RUN` values the reference sorts in bounded native steps in its prelude (`sortDefault`).
        let stepped = defined.len() > SORT_RUN;
        let mut keyed = Vec::with_capacity(defined.len());
        for v in defined {
            let s = vm.string_of(&v)?;
            keyed.push((s, v));
        }
        if stepped {
            sort_default_fuel(vm, keyed.len());
        }
        let mut sorted = merge_sort(
            vm,
            keyed,
            &mut |vm, a: &(StrId, Value), b: &(StrId, Value)| {
                Ok(vm.atoms.sref(a.0).cmp16(vm.atoms.sref(b.0)).is_gt())
            },
        )?;
        defined = sorted.drain(..).map(|(_, v)| v).collect();
    } else {
        defined = sort_with(vm, defined, *cmp)?;
    }
    defined.extend(undefs);
    Ok(defined)
}

/// The most values the reference's default sort sorts in one native call, and how many a merge step of the
/// bounded sort past it merges.
const SORT_RUN: usize = 4096;
const MERGE_STEP: usize = 65_536;

/// The fuel of the reference's `sortDefault` over `n` values: `$SortState`, a `$SortStep` per run of `SORT_RUN` and
/// per `MERGE_STEP` values of each merge pass, a back-edge after each step that leaves work, `$SortResult` and
/// `$Sorted`, after the native's own call.
fn sort_default_fuel(vm: &mut Vm, n: usize) {
    fuel::handoff(vm);
    fuel::native(vm);
    let mut steps = n.div_ceil(SORT_RUN);
    let mut width = SORT_RUN;
    while width < n {
        steps += n.div_ceil(MERGE_STEP);
        width *= 2;
    }
    for i in 0..steps {
        fuel::native(vm);
        if i + 1 < steps {
            fuel::step(vm);
        }
    }
    fuel::native(vm);
    fuel::native(vm);
    vm.bytecode_builtin();
}

/// A sort with a comparator as the reference's `sortWith` runs it: a stable top-down merge sort, its merges planned
/// in post-order so the comparator sees the pairs the recursive sort compares, in the same order. A result that is
/// not above zero, or NaN, keeps the left value first.
fn sort_with(vm: &mut Vm, mut work: Vec<Value>, f: Value) -> Result<Vec<Value>, Value> {
    fn plan(low: usize, high: usize, out: &mut Vec<(usize, usize, usize)>) {
        if high - low <= 1 {
            return;
        }
        let middle = low + (high - low) / 2;
        plan(low, middle, out);
        plan(middle, high, out);
        out.push((low, middle, high));
    }
    let mut merges = Vec::new();
    plan(0, work.len(), &mut merges);
    fuel::handoff(vm);
    let mut merged = Vec::with_capacity(work.len());
    for (low, middle, high) in merges {
        merged.clear();
        let (mut left, mut right) = (low, middle);
        while left < middle && right < high {
            let r = vm.call_counted(&f, Value::Undef, &[work[left], work[right]])?;
            let order = match r {
                Value::Num(n) => n,
                v => vm.number_of(&v)?,
            };
            if order <= 0.0 || order.is_nan() {
                merged.push(work[left]);
                left += 1;
            } else {
                merged.push(work[right]);
                right += 1;
            }
            fuel::step(vm);
        }
        merged.extend_from_slice(&work[left..middle]);
        merged.extend_from_slice(&work[right..high]);
        work[low..high].copy_from_slice(&merged);
        // `$MergeRest`, and the back-edge to the next merge.
        fuel::native(vm);
        fuel::step(vm);
    }
    fuel::native(vm);
    vm.bytecode_builtin();
    Ok(work)
}

type Greater<'a, T> = dyn FnMut(&mut Vm, &T, &T) -> Result<bool, Value> + 'a;

/// Stable merge sort with a fallible comparator; `greater(a, b)` means `a` sorts after `b`.
fn merge_sort<T: Clone>(
    vm: &mut Vm,
    mut v: Vec<T>,
    greater: &mut Greater<T>,
) -> Result<Vec<T>, Value> {
    let n = v.len();
    if n < 2 {
        return Ok(v);
    }
    let run = 8;
    for start in (0..n).step_by(run) {
        let end = (start + run).min(n);
        for i in start + 1..end {
            let mut j = i;
            while j > start && greater(vm, &v[j - 1], &v[j])? {
                v.swap(j - 1, j);
                j -= 1;
            }
        }
    }
    let mut width = run;
    let mut buf: Vec<T> = Vec::with_capacity(n);
    while width < n {
        buf.clear();
        let mut start = 0;
        while start < n {
            let mid = (start + width).min(n);
            let end = (start + 2 * width).min(n);
            let (mut i, mut j) = (start, mid);
            while i < mid && j < end {
                if greater(vm, &v[i], &v[j])? {
                    buf.push(v[j].clone());
                    j += 1;
                } else {
                    buf.push(v[i].clone());
                    i += 1;
                }
            }
            buf.extend_from_slice(&v[i..mid]);
            buf.extend_from_slice(&v[j..end]);
            start = end;
        }
        std::mem::swap(&mut v, &mut buf);
        width *= 2;
    }
    Ok(v)
}

/// Makes `this` dense for a sort, which fails as the reference's host does when it cannot copy the elements.
fn sort_id(vm: &mut Vm, this: &Value) -> Result<Id, Value> {
    let id = arr_id(vm, this)?;
    if len(vm, id) > MAX_ARRAY_LEN {
        return Err(vm.range_error("Out of memory"));
    }
    vm.densify(id)?;
    Ok(id)
}

fn a_sort(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = sort_id(vm, &this)?;
    // Holes sort last, after undefined, and stay holes; a comparator that throws leaves the array as it was.
    let cmp = arg(args, 0);
    let list = items_mut(vm, id, None)?.clone();
    sort_comparator(vm, &cmp, "Array.sort")?;
    let holes = list.iter().filter(|v| matches!(v, Value::Uninit)).count();
    let list = list
        .into_iter()
        .filter(|v| !matches!(v, Value::Uninit))
        .collect();
    let mut sorted = sort_values(vm, list, &cmp)?;
    sorted.resize(sorted.len() + holes, Value::Uninit);
    if let Kind::Array(items) = &mut vm.heap[id as usize].kind {
        *items = sorted;
    }
    Ok(this)
}

fn a_to_sorted(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = sort_id(vm, &this)?;
    sort_comparator(vm, &arg(args, 0), "Array.toSorted")?;
    let list = without_holes(items(vm, id));
    let sorted = sort_values(vm, list, &arg(args, 0))?;
    Ok(vm.new_array(sorted))
}

/// Flattens `list` into `out`, dropping holes at every level.
fn flatten(vm: &Vm, out: &mut Vec<Value>, list: &[Value], depth: f64) {
    for v in list {
        if let Value::Uninit = v {
            continue;
        }
        if depth >= 1.0
            && let Value::Obj(o) = v
            && let Kind::Array(inner) = &vm.heap[*o as usize].kind
        {
            flatten(vm, out, inner, depth - 1.0);
            // A sparse array's far elements follow its items; its holes are dropped anyway.
            let tail: Vec<Value> = vm.sparse_tail(*o).into_iter().map(|(_, v)| v).collect();
            flatten(vm, out, &tail, depth - 1.0);
            continue;
        }
        out.push(*v);
    }
}

fn a_flat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    integers(vm, args, &[0], |vm, args| {
        let depth = match arg(args, 0) {
            Value::Undef => 1.0,
            v => to_integer(vm.number_of(&v)?),
        };
        let list = items(vm, id).to_vec();
        let mut out = Vec::new();
        flatten(vm, &mut out, &list, depth.min(64.0));
        Ok(vm.new_array(out))
    })
}

fn a_flat_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    // A returned array is read like the callback methods read theirs: live, skipping indexes not in it. The fuel is
    // the reference's `Array$prototype$flatMap`, which runs its loops itself.
    fuel::method(vm);
    let id = arr_id(vm, &this)?;
    fuel::native(vm);
    let f = callback(vm, args, "Array.flatMap")?;
    fuel::native(vm);
    let this_arg = arg(args, 1);
    let mut out = Vec::new();
    let n = len(vm, id);
    let order = visit_order(vm, id, n);
    let mut walked = 0;
    let mut k = 0;
    while let Some(i) = visit_at(&order, n, k) {
        k += 1;
        holes(vm, &mut walked, i);
        if let Some(v) = present(vm, id, i) {
            match vm.call_counted(&f, this_arg, &[v, Value::Num(i as f64), this])? {
                Value::Obj(inner) if matches!(vm.heap[inner as usize].kind, Kind::Array(_)) => {
                    let m = len(vm, inner);
                    let inner_order = visit_order(vm, inner, m);
                    let mut inner_walked = 0;
                    let mut j = 0;
                    while let Some(at) = visit_at(&inner_order, len(vm, inner).min(m), j) {
                        j += 1;
                        holes(vm, &mut inner_walked, at);
                        if let Some(v) = present(vm, inner, at) {
                            out.push(v);
                        }
                        fuel::step(vm);
                        inner_walked = at + 1;
                    }
                    let end = len(vm, inner).min(m);
                    holes(vm, &mut inner_walked, end);
                }
                r => out.push(r),
            }
        }
        fuel::step(vm);
        walked = i + 1;
    }
    holes(vm, &mut walked, n);
    vm.bytecode_builtin();
    Ok(vm.new_array(out))
}

fn a_fill(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    integers(vm, args, &[1, 2], |vm, args| {
        let n = len(vm, id);
        let s = to_index(vm, &arg(args, 1), n, 0)?;
        let e = to_index(vm, &arg(args, 2), n, n)?;
        let v = arg(args, 0);
        check_mutable(vm, id, None)?;
        vm.reject_circular(id, &v, "Array.fill result")?;
        if e > items(vm, id).len() {
            vm.densify(id)?;
        }
        let items = array_items(vm, id)?;
        for slot in items.iter_mut().take(e).skip(s) {
            *slot = v;
        }
        Ok(this)
    })
}

fn a_copy_within(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    integers(vm, args, &[0, 1, 2], |vm, args| {
        let n = len(vm, id);
        let target = to_index(vm, &arg(args, 0), n, 0)?;
        let start = to_index(vm, &arg(args, 1), n, 0)?;
        let end = to_index(vm, &arg(args, 2), n, n)?;
        let items = items_mut(vm, id, None)?;
        if start < end && target < n {
            let count = (end - start).min(n - target);
            let copy: Vec<Value> = items[start..start + count].to_vec();
            items[target..target + count].copy_from_slice(&copy);
        }
        Ok(this)
    })
}

fn rel_index(vm: &mut Vm, v: &Value, n: usize) -> Result<Option<usize>, Value> {
    let mut i = to_integer(vm.number_of(v)?);
    if i < 0.0 {
        i += n as f64;
    }
    Ok(if i < 0.0 || i >= n as f64 {
        None
    } else {
        Some(i as usize)
    })
}

fn a_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    integers(vm, args, &[0], |vm, args| {
        let n = len(vm, id);
        Ok(match rel_index(vm, &arg(args, 0), n)? {
            Some(i) => item(vm, id, i),
            None => Value::Undef,
        })
    })
}

fn a_with(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = dense_id(vm, &this)?;
    integers(vm, args, &[0], |vm, args| {
        let n = len(vm, id);
        let Some(i) = rel_index(vm, &arg(args, 0), n)? else {
            return Err(vm.range_error("Invalid index"));
        };
        let mut out = without_holes(items(vm, id));
        out[i] = arg(args, 1);
        Ok(vm.new_array(out))
    })
}

fn array_iter(vm: &mut Vm, this: &Value, kind: IterKind) -> Res {
    let id = arr_id(vm, this)?;
    let proto = vm.realm.iter_proto;
    Ok(Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::ArrayIter {
            target: id,
            pos: 0,
            kind,
        },
    ))))
}

fn a_keys(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    array_iter(vm, &this, IterKind::Keys)
}

fn a_values(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    array_iter(vm, &this, IterKind::Values)
}

fn a_entries(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    array_iter(vm, &this, IterKind::Entries)
}
