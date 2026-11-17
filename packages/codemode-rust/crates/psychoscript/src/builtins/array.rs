//! Array and Array.prototype.

use super::{arg, to_index};
use crate::object::*;
use crate::ops::MAX_ARRAY_LEN;
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

fn len(vm: &Vm, id: Id) -> usize {
    items(vm, id).len()
}

fn item(vm: &Vm, id: Id, i: usize) -> Value {
    items(vm, id).get(i).cloned().unwrap_or_default()
}

fn items_mut<'a>(vm: &'a mut Vm, id: Id, growing: bool) -> Result<&'a mut Vec<Value>, Value> {
    let flags = vm.heap[id as usize].flags;
    if flags & FROZEN != 0 || (growing && flags & NON_EXTENSIBLE != 0) {
        return Err(vm.type_error("Cannot modify a frozen or non-extensible array"));
    }
    if !matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
        return Err(vm.type_error("not an array"));
    }
    match &mut vm.heap[id as usize].kind {
        Kind::Array(items) => Ok(items),
        _ => unreachable!("checked above"),
    }
}

fn callback(vm: &mut Vm, args: &[Value]) -> Result<Value, Value> {
    let f = arg(args, 0);
    if !vm.is_callable(&f) {
        let d = vm.describe(&f);
        return Err(vm.type_error(&format!("{d} is not a function")));
    }
    Ok(f)
}

fn array_ctor(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.len() == 1
        && let Value::Num(n) = args[0]
    {
        if n < 0.0 || n.fract() != 0.0 || n > MAX_ARRAY_LEN as f64 {
            return Err(vm.range_error("Invalid array length."));
        }
        return Ok(vm.new_array(vec![Value::Undef; n as usize]));
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
    if src.is_nullish() {
        return Err(vm.type_error("Array.from requires an array-like or iterable object"));
    }
    let iterable = match &src {
        Value::Str(_) => true,
        Value::Obj(id) => {
            !matches!(vm.heap[*id as usize].kind, Kind::Ordinary) || vm.has_key(*id, SYM_ITERATOR)
        }
        _ => false,
    };
    let mut list = if iterable {
        vm.iterate_to_vec(&src)?
    } else if let Value::Obj(id) = src {
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
        if has_indexes {
            let mut out = Vec::with_capacity(n);
            for i in 0..n {
                out.push(vm.get_elem(&src, &Value::Num(i as f64))?);
            }
            out
        } else {
            vec![Value::Undef; n]
        }
    } else {
        Vec::new()
    };
    let f = arg(args, 1);
    if !matches!(f, Value::Undef) {
        if !vm.is_callable(&f) {
            return Err(vm.type_error("Array.from mapper is not a function"));
        }
        let this_arg = arg(args, 2);
        for (i, v) in list.iter_mut().enumerate() {
            let x = std::mem::take(v);
            *v = vm.call(&f, this_arg, &[x, Value::Num(i as f64)])?;
        }
    }
    Ok(vm.new_array(list))
}

fn a_push(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let items = items_mut(vm, id, true)?;
    if items.len() + args.len() > MAX_ARRAY_LEN {
        return Err(vm.range_error("Invalid array length."));
    }
    items.extend_from_slice(args);
    Ok(Value::Num(items.len() as f64))
}

fn a_pop(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    Ok(items_mut(vm, id, false)?.pop().unwrap_or_default())
}

fn a_shift(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let items = items_mut(vm, id, false)?;
    if items.is_empty() {
        return Ok(Value::Undef);
    }
    Ok(items.remove(0))
}

fn a_unshift(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let items = items_mut(vm, id, true)?;
    items.splice(0..0, args.iter().cloned());
    Ok(Value::Num(items.len() as f64))
}

fn a_slice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let n = len(vm, id);
    let s = to_index(vm, &arg(args, 0), n, 0)?;
    let e = to_index(vm, &arg(args, 1), n, n)?;
    let out = if s < e {
        items(vm, id)[s..e].to_vec()
    } else {
        Vec::new()
    };
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
    let id = arr_id(vm, &this)?;
    let n = len(vm, id);
    let (start, count) = splice_args(vm, args, n)?;
    let insert: Vec<Value> = args.iter().skip(2).cloned().collect();
    let items = items_mut(vm, id, !insert.is_empty())?;
    let removed: Vec<Value> = items.splice(start..start + count, insert).collect();
    Ok(vm.new_array(removed))
}

fn a_to_spliced(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let n = len(vm, id);
    let (start, count) = splice_args(vm, args, n)?;
    let mut out = items(vm, id).to_vec();
    out.splice(start..start + count, args.iter().skip(2).cloned());
    Ok(vm.new_array(out))
}

fn a_concat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let mut out = items(vm, id).to_vec();
    for a in args {
        match a {
            Value::Obj(o) if matches!(vm.heap[*o as usize].kind, Kind::Array(_)) => {
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
    let mut out = String::new();
    let n = len(vm, id);
    for i in 0..n {
        if i > 0 {
            out.push_str(sep);
        }
        match item(vm, id, i) {
            Value::Undef | Value::Null => {}
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
        Value::Undef => ",".to_owned(),
        v => {
            let t = vm.string_of(&v)?;
            vm.text(t).to_owned()
        }
    };
    let s = join(vm, id, &sep, &mut Vec::new())?;
    Ok(vm.string_val(s))
}

fn a_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let s = join(vm, id, ",", &mut Vec::new())?;
    Ok(vm.string_val(s))
}

fn a_reverse(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    items_mut(vm, id, false)?.reverse();
    Ok(this)
}

fn a_to_reversed(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let mut out = items(vm, id).to_vec();
    out.reverse();
    Ok(vm.new_array(out))
}

fn a_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    let from = to_index(vm, &arg(args, 1), n, 0)?;
    let r = items(vm, id)
        .iter()
        .enumerate()
        .skip(from)
        .find(|(_, v)| vm.strict_eq(v, &x))
        .map(|(i, _)| i as f64);
    Ok(Value::Num(r.unwrap_or(-1.0)))
}

fn a_last_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    if n == 0 {
        return Ok(Value::Num(-1.0));
    }
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
    let items = items(vm, id);
    let r = (0..=from as usize)
        .rev()
        .find(|i| vm.strict_eq(&items[*i], &x));
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn a_includes(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let x = arg(args, 0);
    let n = len(vm, id);
    let from = to_index(vm, &arg(args, 1), n, 0)?;
    Ok(Value::Bool(
        items(vm, id)
            .iter()
            .skip(from)
            .any(|v| vm.same_value_zero(v, &x)),
    ))
}

/// Calls `f(value, index, array)` for each index while `visit` returns `None`; returns what stopped it.
fn each<T>(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    reverse: bool,
    mut visit: impl FnMut(&mut Vm, usize, Value, Value) -> Option<T>,
) -> Result<Option<T>, Value> {
    let id = arr_id(vm, this)?;
    let f = callback(vm, args)?;
    let this_arg = arg(args, 1);
    let n = len(vm, id);
    for k in 0..n {
        let i = if reverse { n - 1 - k } else { k };
        let v = item(vm, id, i);
        let r = vm.call(&f, this_arg, &[v, Value::Num(i as f64), *this])?;
        if let Some(t) = visit(vm, i, v, r) {
            return Ok(Some(t));
        }
    }
    Ok(None)
}

fn a_find(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(each(vm, &this, args, false, |vm, _, v, r| {
        vm.truthy(&r).then_some(v)
    })?
    .unwrap_or_default())
}

fn a_find_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = each(vm, &this, args, false, |vm, i, _, r| {
        vm.truthy(&r).then_some(i)
    })?;
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn a_find_last(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(each(vm, &this, args, true, |vm, _, v, r| {
        vm.truthy(&r).then_some(v)
    })?
    .unwrap_or_default())
}

fn a_find_last_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = each(vm, &this, args, true, |vm, i, _, r| {
        vm.truthy(&r).then_some(i)
    })?;
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn a_some(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        each(vm, &this, args, false, |vm, _, _, r| {
            vm.truthy(&r).then_some(())
        })?
        .is_some(),
    ))
}

fn a_every(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        each(vm, &this, args, false, |vm, _, _, r| {
            (!vm.truthy(&r)).then_some(())
        })?
        .is_none(),
    ))
}

fn a_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    each(vm, &this, args, false, |_, _, _, _| None::<()>)?;
    Ok(Value::Undef)
}

fn a_filter(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let mut out = Vec::new();
    each(vm, &this, args, false, |vm, _, v, r| {
        if vm.truthy(&r) {
            out.push(v);
        }
        None::<()>
    })?;
    Ok(vm.new_array(out))
}

fn a_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let mut out = Vec::with_capacity(len(vm, id));
    each(vm, &this, args, false, |_, _, _, r| {
        out.push(r);
        None::<()>
    })?;
    Ok(vm.new_array(out))
}

fn reduce(vm: &mut Vm, this: Value, args: &[Value], reverse: bool) -> Res {
    let id = arr_id(vm, &this)?;
    let f = callback(vm, args)?;
    let n = len(vm, id);
    let mut k = 0;
    let mut acc = if args.len() >= 2 {
        args[1]
    } else {
        if n == 0 {
            return Err(vm.type_error("Array.reduce of an empty array with no initial value."));
        }
        k = 1;
        item(vm, id, if reverse { n - 1 } else { 0 })
    };
    while k < n {
        let i = if reverse { n - 1 - k } else { k };
        if i >= len(vm, id) {
            break;
        }
        let v = item(vm, id, i);
        acc = vm.call(&f, Value::Undef, &[acc, v, Value::Num(i as f64), this])?;
        k += 1;
    }
    Ok(acc)
}

fn a_reduce(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, false)
}

fn a_reduce_right(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, true)
}

fn sort_values(vm: &mut Vm, list: Vec<Value>, cmp: &Value) -> Result<Vec<Value>, Value> {
    if !matches!(cmp, Value::Undef) && !vm.is_callable(cmp) {
        return Err(vm.type_error("The comparison function must be either a function or undefined"));
    }
    let (mut defined, undefs): (Vec<Value>, Vec<Value>) =
        list.into_iter().partition(|v| !matches!(v, Value::Undef));
    if let Value::Undef = cmp {
        let mut keyed = Vec::with_capacity(defined.len());
        for v in defined {
            let s = vm.string_of(&v)?;
            keyed.push((s, v));
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
        let f = *cmp;
        defined = merge_sort(vm, defined, &mut |vm, a: &Value, b: &Value| {
            let r = vm.call(&f, Value::Undef, &[*a, *b])?;
            let n = match r {
                Value::Num(n) => n,
                v => vm.number_of(&v)?,
            };
            Ok(n > 0.0)
        })?;
    }
    defined.extend(undefs);
    Ok(defined)
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

fn a_sort(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let list = std::mem::take(items_mut(vm, id, false)?);
    let sorted = sort_values(vm, list, &arg(args, 0));
    match sorted {
        Ok(s) => {
            if let Kind::Array(items) = &mut vm.heap[id as usize].kind {
                *items = s;
            }
            Ok(this)
        }
        Err(e) => Err(e),
    }
}

fn a_to_sorted(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let list = items(vm, id).to_vec();
    let sorted = sort_values(vm, list, &arg(args, 0))?;
    Ok(vm.new_array(sorted))
}

fn flatten(vm: &Vm, out: &mut Vec<Value>, list: &[Value], depth: f64) {
    for v in list {
        if depth >= 1.0
            && let Value::Obj(o) = v
            && let Kind::Array(inner) = &vm.heap[*o as usize].kind
        {
            flatten(vm, out, inner, depth - 1.0);
            continue;
        }
        out.push(*v);
    }
}

fn a_flat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let depth = match arg(args, 0) {
        Value::Undef => 1.0,
        v => to_integer(vm.number_of(&v)?),
    };
    let list = items(vm, id).to_vec();
    let mut out = Vec::new();
    flatten(vm, &mut out, &list, depth.min(64.0));
    Ok(vm.new_array(out))
}

fn a_flat_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let mut mapped = Vec::new();
    each(vm, &this, args, false, |_, _, _, r| {
        mapped.push(r);
        None::<()>
    })?;
    let mut out = Vec::new();
    flatten(vm, &mut out, &mapped, 1.0);
    Ok(vm.new_array(out))
}

fn a_fill(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let n = len(vm, id);
    let s = to_index(vm, &arg(args, 1), n, 0)?;
    let e = to_index(vm, &arg(args, 2), n, n)?;
    let v = arg(args, 0);
    let items = items_mut(vm, id, false)?;
    for slot in items.iter_mut().take(e).skip(s) {
        *slot = v;
    }
    Ok(this)
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
    let n = len(vm, id);
    Ok(match rel_index(vm, &arg(args, 0), n)? {
        Some(i) => item(vm, id, i),
        None => Value::Undef,
    })
}

fn a_with(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = arr_id(vm, &this)?;
    let n = len(vm, id);
    let Some(i) = rel_index(vm, &arg(args, 0), n)? else {
        return Err(vm.range_error("Invalid index"));
    };
    let mut out = items(vm, id).to_vec();
    out[i] = arg(args, 1);
    Ok(vm.new_array(out))
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
