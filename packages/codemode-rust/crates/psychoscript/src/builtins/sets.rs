//! Map and Set additions (`getOrInsert`, `groupBy`, the Set composition methods), `Object.groupBy`, WeakMap and
//! WeakSet.

use super::{arg, describe_value, fuel, incompatible, require_callback};
use crate::native::{
    FOR_OF_SLOTS, Flow, ForOf, Frame, Input, NativeOp, Step, enter_for_of, enter_for_of_sub,
    for_of_step,
};
use crate::object::*;
use crate::ops::Hint;
use crate::value::{Id, Slot, Value};
use crate::vm::{Res, Vm};

pub fn setup(vm: &mut Vm) {
    let mp = vm.realm.map_proto;
    vm.methods(
        mp,
        &[
            ("getOrInsert", 2, map_get_or_insert),
            ("getOrInsertComputed", 2, map_get_or_insert_computed),
        ],
    );
    let k = vm.names.constructor;
    if let Value::Obj(map) = vm.get_obj(mp, k) {
        vm.method(map, "groupBy", 2, map_group_by);
    }
    let op = vm.realm.object_proto;
    if let Value::Obj(object) = vm.get_obj(op, k) {
        vm.method(object, "groupBy", 2, object_group_by);
    }
    let sp = vm.realm.set_proto;
    for (i, (name, _)) in SET_METHODS.iter().enumerate() {
        let f = vm.native_fn(name, 1, set_method, Value::Num(i as f64));
        let key = vm.atoms.intern_static(name);
        vm.define_hidden(sp, key, f);
    }

    let wmp = vm.plain(op);
    vm.realm.std.weak_map = wmp;
    vm.ctor("WeakMap", 0, weak_map_ctor, wmp, Value::Undef);
    vm.methods(
        wmp,
        &[
            ("get", 1, weak_get),
            ("set", 2, weak_set),
            ("has", 1, weak_has),
            ("delete", 1, weak_delete),
            ("getOrInsert", 2, weak_get_or_insert),
            ("getOrInsertComputed", 2, weak_get_or_insert_computed),
        ],
    );
    let wsp = vm.plain(op);
    vm.realm.std.weak_set = wsp;
    vm.ctor("WeakSet", 0, weak_set_ctor, wsp, Value::Undef);
    vm.methods(
        wsp,
        &[
            ("add", 1, weak_add),
            ("has", 1, weak_has),
            ("delete", 1, weak_delete),
        ],
    );
}

fn table(vm: &mut Vm, id: Id) -> &mut OrderedMap {
    match &mut vm.heap[id as usize].kind {
        Kind::Map(m) | Kind::Set(m) | Kind::WeakMap(m) | Kind::WeakSet(m) => m,
        _ => unreachable!("checked by the receiver test"),
    }
}

fn receiver(vm: &mut Vm, this: &Value, method: &str, ok: fn(&Kind) -> bool) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && ok(&vm.heap[*id as usize].kind)
    {
        return Ok(*id);
    }
    Err(incompatible(vm, method, this))
}

fn normalize(v: Value) -> Value {
    match v {
        Value::Num(n) => Value::Num(n + 0.0),
        v => v,
    }
}

// ---------- Map ----------

fn map_get_or_insert(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = receiver(vm, &this, "Map.prototype.getOrInsert", |k| {
        matches!(k, Kind::Map(_))
    })?;
    let key = vm.map_key(&arg(args, 0));
    if let Some(v) = table(vm, id).get(key) {
        return Ok(v);
    }
    table(vm, id).set(key, arg(args, 0), arg(args, 1));
    Ok(arg(args, 1))
}

fn get_or_insert_computed(vm: &mut Vm, id: Id, args: &[Value], name: &str, callee: Id) -> Res {
    let f = require_callback(vm, &arg(args, 1), name)?;
    let k = normalize(arg(args, 0));
    let key = vm.map_key(&k);
    if let Some(v) = table(vm, id).get(key) {
        return Ok(v);
    }
    // A missing key is the reference's `insertComputed`: the callback, then `$Table("add")`.
    fuel::handoff(vm);
    vm.enter_native_sub(
        NativeOp::Collections,
        GET_OR_INSERT,
        callee,
        Value::Undef,
        &[Value::Obj(id), k, f],
    )
}

/// The step of `getOrInsertComputed` once the key was missing: calls the callback, then stores what it returned.
fn get_or_insert_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (f, k) = (fr.slot(vm, 2), fr.slot(vm, 1));
            fr.call_slots(vm, f, Slot::UNDEF, [k])
        }
        Input::Returned(r) => {
            let id = fr.slot(vm, 0).obj().unwrap_or(0);
            let k = fr.get(vm, 1);
            let key = vm.map_key(&k);
            let v = r.get();
            table(vm, id).set(key, k, v);
            fuel::native(vm);
            vm.bytecode_builtin();
            Ok(Step::Done(v))
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

fn map_get_or_insert_computed(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let id = receiver(vm, &this, "Map.prototype.getOrInsertComputed", |k| {
        matches!(k, Kind::Map(_))
    })?;
    get_or_insert_computed(vm, id, args, "Map.getOrInsertComputed", callee)
}

// The slots of a `groupBy` frame, after the loop's: the callback, the next index, the item being grouped, the
// `[key, item]` pairs so far (an internal array), whether it groups into an object, and whether a key is being
// converted by a call.
const GROUP_F: usize = FOR_OF_SLOTS;
const GROUP_INDEX: usize = FOR_OF_SLOTS + 1;
const GROUP_ITEM: usize = FOR_OF_SLOTS + 2;
const GROUP_PAIRS: usize = FOR_OF_SLOTS + 3;
const GROUP_OBJECT: usize = FOR_OF_SLOTS + 4;
const GROUP_CONV: usize = FOR_OF_SLOTS + 5;

/// Walks an iterable one step at a time, calling the grouping callback between steps, with the fuel of the
/// reference's `groupBy`: its `$Callback` and `$Table("groups")`, then for each item the callback, an object key's
/// `$Table("groupKey")` and `String`, and `$Table("group")`.
pub(crate) struct GroupBy;

impl ForOf for GroupBy {
    fn item(vm: &mut Vm, fr: Frame, x: Value) -> Result<Flow, Value> {
        fr.set(vm, GROUP_ITEM, x);
        let (f, index) = (fr.slot(vm, GROUP_F), fr.slot(vm, GROUP_INDEX));
        Ok(Flow::Call(fr.catching(
            vm,
            f,
            Slot::UNDEF,
            [Slot::pack(x), index],
        )?))
    }

    fn returned(vm: &mut Vm, fr: Frame, r: Slot) -> Result<Flow, Value> {
        if fr.index(vm, GROUP_CONV) == 1 {
            fr.set_index(vm, GROUP_CONV, 0);
            return add_to_group(vm, fr, r.get());
        }
        let index = fr.index(vm, GROUP_INDEX);
        fr.set_index(vm, GROUP_INDEX, index + 1);
        let mut key = r.get();
        if fr.index(vm, GROUP_OBJECT) != 0 {
            fuel::native(vm);
            fuel::native(vm);
            // `String` of an object key: ToPrimitive now, as a call when it calls the program.
            if matches!(key, Value::Obj(_)) {
                if vm.converts_by_call(&key, Hint::String) {
                    fr.set_index(vm, GROUP_CONV, 1);
                    return Ok(Flow::Call(super::convert_catching(
                        vm,
                        fr,
                        key,
                        Hint::String,
                    )?));
                }
                key = vm.primitive_of(&key, Hint::String)?;
            }
        }
        add_to_group(vm, fr, key)
    }

    fn finish(vm: &mut Vm, fr: Frame) -> Res {
        vm.bytecode_builtin();
        let pairs = match fr
            .slot(vm, GROUP_PAIRS)
            .obj()
            .map(|p| &vm.heap[p as usize].kind)
        {
            Some(Kind::Array(items)) => items.clone(),
            _ => Vec::new(),
        };
        let pairs = pairs.chunks(2).map(|p| (p[0], p[1]));
        if fr.index(vm, GROUP_OBJECT) != 0 {
            return object_groups(vm, pairs);
        }
        Ok(map_groups(vm, pairs))
    }
}

/// `$Table("group")`: the item goes with its key.
fn add_to_group(vm: &mut Vm, fr: Frame, key: Value) -> Result<Flow, Value> {
    fuel::native(vm);
    let item = fr.get(vm, GROUP_ITEM);
    if let Some(pairs) = fr.slot(vm, GROUP_PAIRS).obj()
        && let Kind::Array(items) = &mut vm.heap[pairs as usize].kind
    {
        items.extend([key, item]);
    }
    Ok(Flow::Next)
}

fn group_by(vm: &mut Vm, args: &[Value], kind: &str, callee: Id) -> Res {
    fuel::method(vm);
    fuel::method(vm);
    let items = arg(args, 0);
    if items.is_nullish() {
        return Err(vm.type_error(&format!("{kind}.groupBy expects an iterable collection.")));
    }
    let f = require_callback(vm, &arg(args, 1), &format!("{kind}.groupBy"))?;
    fuel::native(vm);
    fuel::native(vm);
    let object = Value::Num((kind == "Object") as u8 as f64);
    let pairs = vm.new_array(Vec::new());
    let own = [
        f,
        Value::Num(0.0),
        Value::Undef,
        pairs,
        object,
        Value::Num(0.0),
    ];
    enter_for_of(
        vm,
        crate::native::NativeOp::GroupBy,
        callee,
        Value::Undef,
        items,
        &own,
    )
}

fn map_groups(vm: &mut Vm, pairs: impl Iterator<Item = (Value, Value)>) -> Value {
    let proto = vm.realm.map_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Map(Box::default())));
    for (k, item) in pairs {
        let k = normalize(k);
        let key = vm.map_key(&k);
        match table(vm, id).get(key) {
            Some(Value::Obj(arr)) => {
                if let Kind::Array(items) = &mut vm.heap[arr as usize].kind {
                    items.push(item);
                }
            }
            _ => {
                let arr = vm.new_array(vec![item]);
                table(vm, id).set(key, k, arr);
            }
        }
    }
    Value::Obj(id)
}

fn object_groups(vm: &mut Vm, pairs: impl Iterator<Item = (Value, Value)>) -> Res {
    let id = vm.alloc(Obj::new(None, Kind::Ordinary));
    for (k, item) in pairs {
        let atom = vm.key_of(&k)?;
        match vm.heap[id as usize].props.get(atom).copied() {
            Some(Value::Obj(arr)) => {
                if let Kind::Array(items) = &mut vm.heap[arr as usize].kind {
                    items.push(item);
                }
            }
            _ => {
                let arr = vm.new_array(vec![item]);
                vm.define(id, atom, arr);
            }
        }
    }
    Ok(Value::Obj(id))
}

fn map_group_by(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    group_by(vm, args, "Map", callee)
}

fn object_group_by(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    group_by(vm, args, "Object", callee)
}

// ---------- Set composition ----------

const SET_METHODS: [(&str, ()); 7] = [
    ("union", ()),
    ("intersection", ()),
    ("difference", ()),
    ("symmetricDifference", ()),
    ("isSubsetOf", ()),
    ("isSupersetOf", ()),
    ("isDisjointFrom", ()),
];

fn new_set(vm: &mut Vm, entries: Vec<Value>) -> Id {
    let proto = vm.realm.set_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Set(Box::default())));
    for v in entries {
        let key = vm.map_key(&v);
        table(vm, id).set(key, v, Value::Undef);
    }
    id
}

fn live_values(vm: &mut Vm, id: Id) -> Vec<Value> {
    table(vm, id)
        .entries
        .iter()
        .flatten()
        .map(|e| e.0)
        .collect()
}

fn set_method(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let which = match vm.native_data(callee) {
        Value::Num(n) => n as usize,
        _ => 0,
    };
    let name = SET_METHODS[which].0;
    // The fuel is the reference's `setMethod`: its checks, then `$Table` and callback calls per item (see `fuel.rs`).
    fuel::method(vm);
    let target = receiver(vm, &this, &format!("Set.prototype.{name}"), |k| {
        matches!(k, Kind::Set(_))
    })?;
    fuel::receiver_then_loop(vm);
    let other = arg(args, 0);
    fuel::native(vm);
    let oid = match other {
        Value::Obj(oid) if !vm.is_namespace(oid) => oid,
        _ => return Err(vm.type_error(&format!("Set.{name} expects a Set-like object."))),
    };
    let sk = vm.names.size;
    let raw = vm.get(&other, sk)?;
    let size = vm.number_of(&raw)?;
    if size.is_nan() {
        return Err(vm.type_error(&format!(
            "Set.{name} received a Set-like object with an invalid size."
        )));
    }
    let size = crate::value::to_integer(size);
    if size < 0.0 {
        return Err(vm.range_error(&format!(
            "Set.{name} received a Set-like object with a negative size."
        )));
    }
    let hk = vm.atoms.intern_static("has");
    let kk = vm.atoms.intern_static("keys");
    let has = vm.get_obj(oid, hk);
    let keys = vm.get_obj(oid, kk);
    fuel::native(vm);
    let callable = vm.is_callable(&has);
    if callable {
        fuel::native(vm);
    }
    if !callable || !vm.is_callable(&keys) {
        return Err(vm.type_error(&format!(
            "Set.{name} expects callable 'has' and 'keys' methods."
        )));
    }
    let own = table(vm, target).live as f64;
    fuel::native(vm);
    if (name == "isSubsetOf" && own > size) || (name == "isSupersetOf" && own < size) {
        vm.bytecode_builtin();
        return Ok(Value::Bool(false));
    }
    let result = match name {
        "intersection" => Value::Obj(new_set(vm, Vec::new())),
        "union" | "difference" | "symmetricDifference" => {
            fuel::native(vm);
            let vals = live_values(vm, target);
            Value::Obj(new_set(vm, vals))
        }
        _ => Value::Undef,
    };
    // With a Set-like object at least as large, the methods that may drop items ask its `has` for each own item;
    // otherwise they walk its `keys()`.
    let asks = name == "isSubsetOf"
        || (matches!(name, "intersection" | "difference" | "isDisjointFrom") && own <= size);
    if asks {
        fuel::native(vm);
        if builtin_has(vm, &has) {
            return ask_builtin(vm, name, target, result.as_obj(), has, other);
        }
    }
    let phase = if asks { ASKING } else { KEYS };
    let slots = [
        Value::Obj(target),
        other,
        has,
        keys,
        result,
        Value::Num(which as f64),
        Value::Num(phase as f64),
        Value::Num(0.0),
        Value::Undef,
        Value::Undef,
        Value::Undef,
        Value::Bool(false),
    ];
    vm.enter_native_sub(
        NativeOp::Collections,
        SET_METHOD,
        callee,
        Value::Undef,
        &slots,
    )
}

// The slots of a Set method's frame: the receiver, the Set-like object, its `has` and `keys`, the Set it builds (or
// undefined), which method, the phase, the next entry of the walk, the item asked about, the iterator `keys()`
// returned and its `next`, and whether that iterator is an array's.
const SM_TARGET: usize = 0;
const SM_OTHER: usize = 1;
const SM_HAS: usize = 2;
const SM_KEYS: usize = 3;
const SM_RESULT: usize = 4;
const SM_WHICH: usize = 5;
const SM_PHASE: usize = 6;
const SM_AT: usize = 7;
const SM_ITEM: usize = 8;
const SM_ITER: usize = 9;
const SM_NEXT: usize = 10;
const SM_ARRAY: usize = 11;

/// What a Set method's frame waits on: `has(item)`, `keys()`, the iterator's `next()`, its `return()`, or a
/// generator closing.
const ASKING: usize = 0;
const KEYS: usize = 1;
const STEPPING: usize = 2;
const CLOSING: usize = 3;
const CLOSING_GEN: usize = 4;

fn set_method_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    let name = SET_METHODS[fr.index(vm, SM_WHICH)].0;
    let target = fr.slot(vm, SM_TARGET).obj().unwrap_or(0);
    let result = fr.slot(vm, SM_RESULT).obj();
    let phase = fr.index(vm, SM_PHASE);
    match input {
        Input::Start if phase == KEYS => {
            let (keys, other) = (fr.slot(vm, SM_KEYS), fr.slot(vm, SM_OTHER));
            return fr.call_slots(vm, keys, other, []);
        }
        Input::Start => {}
        Input::Returned(r) => match phase {
            ASKING => {
                let found = vm.truthy(&r.get());
                let item = fr.get(vm, SM_ITEM);
                if answer(vm, name, result, item, found) {
                    return set_done(vm, Value::Bool(false));
                }
                fuel::step(vm);
            }
            KEYS => opened(vm, fr, r.get(), name)?,
            STEPPING => {
                let Some(rid) = r.obj() else {
                    return Err(vm.type_error("Iterator next() result must be an object."));
                };
                let (dk, vk) = (vm.names.done, vm.names.value);
                let done = vm.get_obj(rid, dk);
                if vm.truthy(&done) {
                    return set_done(vm, set_result(result));
                }
                let item = vm.get_obj(rid, vk);
                if let Some(step) = take_key(vm, fr, item, name, target, result)? {
                    return Ok(step);
                }
            }
            CLOSING => {
                if r.obj().is_none() {
                    return Err(vm.type_error("Iterator return() result must be an object."));
                }
                return set_done(vm, Value::Bool(false));
            }
            // A generator closing yielded from a `finally`.
            _ => return set_done(vm, Value::Bool(false)),
        },
        Input::Finished(_) => return set_done(vm, Value::Bool(false)),
        Input::Threw(e) => return Err(e),
    }
    if phase == ASKING {
        let walk = if name == "difference" {
            result.unwrap_or(target)
        } else {
            target
        };
        let mut i = fr.index(vm, SM_AT);
        loop {
            let entry = {
                let m = table(vm, walk);
                if i >= m.entries.len() {
                    break;
                }
                m.entries[i]
            };
            i += 1;
            let Some((item, _)) = entry else { continue };
            fr.set_index(vm, SM_AT, i);
            fr.set(vm, SM_ITEM, item);
            let (has, other) = (fr.slot(vm, SM_HAS), fr.slot(vm, SM_OTHER));
            return fr.call_slots(vm, has, other, [Slot::pack(item)]);
        }
        return set_done(vm, set_result(result));
    }
    // The keys of the Set-like object, one at a time.
    let iterator = fr.get(vm, SM_ITER);
    loop {
        if !vm.truthy(&fr.get(vm, SM_ARRAY)) {
            fr.set_index(vm, SM_PHASE, STEPPING);
            let next = fr.slot(vm, SM_NEXT);
            return fr.call_slots_as(vm, next, Slot::pack(iterator), [], Step::CallUncounted);
        }
        // An array's iterator, which the reference steps itself.
        let Some(item) = vm.iter_step(&iterator)? else {
            return set_done(vm, set_result(result));
        };
        if let Some(step) = take_key(vm, fr, item, name, target, result)? {
            return Ok(step);
        }
    }
}

/// Whether `f` is a Map's, Set's or WeakMap's own `has`, which runs no program code: asking it needs no frame.
fn builtin_has(vm: &Vm, f: &Value) -> bool {
    let Value::Obj(id) = f else { return false };
    let Kind::Native { f, .. } = vm.heap[*id as usize].kind else {
        return false;
    };
    let plain: [crate::vm::NativeFn; 3] = [
        super::collections::SET_HAS,
        super::collections::MAP_HAS,
        weak_has,
    ];
    plain.into_iter().any(|g| std::ptr::fn_addr_eq(f, g))
}

/// The walk that asks a built-in `has` about each own item, run here as the reference runs it.
fn ask_builtin(
    vm: &mut Vm,
    name: &str,
    target: Id,
    result: Option<Id>,
    has: Value,
    other: Value,
) -> Res {
    let walk = if name == "difference" {
        result.unwrap_or(target)
    } else {
        target
    };
    let mut i = 0;
    loop {
        let entry = {
            let m = table(vm, walk);
            if i >= m.entries.len() {
                break;
            }
            m.entries[i]
        };
        i += 1;
        let Some((item, _)) = entry else { continue };
        let r = vm.call_counted(&has, other, &[item])?;
        let found = vm.truthy(&r);
        if answer(vm, name, result, item, found) {
            vm.bytecode_builtin();
            return Ok(Value::Bool(false));
        }
        fuel::step(vm);
    }
    vm.bytecode_builtin();
    Ok(set_result(result))
}

/// What `has(item)` answered, for the methods that ask: whether that decides the result as `false`.
fn answer(vm: &mut Vm, name: &str, result: Option<Id>, item: Value, found: bool) -> bool {
    match (name, result) {
        ("intersection", Some(res)) => {
            if found {
                let key = vm.map_key(&item);
                table(vm, res).set(key, item, Value::Undef);
                fuel::native(vm);
            }
            false
        }
        ("difference", Some(res)) => {
            if found {
                let key = vm.map_key(&item);
                table(vm, res).delete(key);
                fuel::native(vm);
            }
            false
        }
        _ => found == (name == "isDisjointFrom"),
    }
}

/// What `keys()` returned: keeps the iterator to step.
fn opened(vm: &mut Vm, fr: Frame, iterator: Value, name: &str) -> Result<(), Value> {
    fuel::native(vm);
    let Value::Obj(iid) = iterator else {
        return Err(vm.type_error(&format!(
            "Set.{name} expects 'keys' to return an iterator object."
        )));
    };
    fuel::native(vm);
    // An array from `keys()` is read like its values iterator.
    let array = matches!(vm.heap[iid as usize].kind, Kind::Array(_));
    let it = if array {
        vm.get_iterator(&iterator)?
    } else {
        iterator
    };
    let nk = vm.names.next;
    let next = vm.get_obj(iid, nk);
    if !array && !vm.is_callable(&next) {
        return Err(vm.type_error("The called value is not a function."));
    }
    fr.set(vm, SM_ITER, it);
    fr.set(vm, SM_NEXT, next);
    fr.set(vm, SM_ARRAY, Value::Bool(array));
    Ok(())
}

/// One key of the Set-like object: `Some` with the frame's next step when it decides the result early.
fn take_key(
    vm: &mut Vm,
    fr: Frame,
    item: Value,
    name: &str,
    target: Id,
    result: Option<Id>,
) -> Result<Option<Step>, Value> {
    let item = normalize(item);
    let key = vm.map_key(&item);
    let found = table(vm, target).has(key);
    fuel::native(vm);
    match (name, result) {
        ("union", Some(res)) => {
            table(vm, res).set(key, item, Value::Undef);
            fuel::native(vm);
        }
        ("intersection", Some(res)) => {
            if found {
                table(vm, res).set(key, item, Value::Undef);
                fuel::native(vm);
            }
        }
        ("difference", Some(res)) => {
            table(vm, res).delete(key);
            fuel::native(vm);
        }
        ("symmetricDifference", Some(res)) => {
            if found {
                table(vm, res).delete(key);
            } else {
                table(vm, res).set(key, item, Value::Undef);
            }
            fuel::native(vm);
        }
        _ => {
            if found == (name == "isDisjointFrom") {
                return close_keys(vm, fr).map(Some);
            }
        }
    }
    fuel::step(vm);
    Ok(None)
}

/// Closes the keys iterator after the result was decided early, then finishes with `false`.
fn close_keys(vm: &mut Vm, fr: Frame) -> Result<Step, Value> {
    let Value::Obj(id) = fr.get(vm, SM_ITER) else {
        return set_done(vm, Value::Bool(false));
    };
    match &vm.heap[id as usize].kind {
        Kind::Generator(GenState::Suspended(_)) => {
            fr.set_index(vm, SM_PHASE, CLOSING_GEN);
            match super::collections::resume_catching(vm, fr, id, 1, Value::Undef)? {
                None => Ok(Step::Pushed),
                Some(_) => set_done(vm, Value::Bool(false)),
            }
        }
        Kind::Generator(_)
        | Kind::ArrayIter { .. }
        | Kind::MapIter { .. }
        | Kind::StrIter { .. }
        | Kind::ListIter { .. } => set_done(vm, Value::Bool(false)),
        _ => {
            let rk = vm.names.return_;
            let f = vm.get_obj(id, rk);
            if f.is_nullish() {
                return set_done(vm, Value::Bool(false));
            }
            if !vm.is_callable(&f) {
                return Err(vm.type_error("Iterator return must be a function."));
            }
            fr.set_index(vm, SM_PHASE, CLOSING);
            let it = Slot::pack(Value::Obj(id));
            fr.call_slots_as(vm, Slot::pack(f), it, [], Step::CallUncounted)
        }
    }
}

fn set_result(result: Option<Id>) -> Value {
    match result {
        Some(r) => Value::Obj(r),
        None => Value::Bool(true),
    }
}

fn set_done(vm: &mut Vm, v: Value) -> Result<Step, Value> {
    vm.bytecode_builtin();
    Ok(Step::Done(v))
}

// ---------- WeakMap and WeakSet ----------

fn weak_key(vm: &mut Vm, v: &Value, label: &str) -> Result<(), Value> {
    if let Value::Obj(id) = v
        && !matches!(vm.heap[*id as usize].kind, Kind::Namespace(_))
    {
        return Ok(());
    }
    let d = describe_value(vm, v);
    Err(vm.type_error(&format!(
        "Invalid value used {label}: {d} cannot be held weakly."
    )))
}

fn holdable(vm: &Vm, v: &Value) -> bool {
    matches!(v, Value::Obj(id) if !matches!(vm.heap[*id as usize].kind, Kind::Namespace(_)))
}

/// The reference's `fillCollection` into the WeakMap or WeakSet in the frame's first own slot: for a WeakMap,
/// `$IsObject`, then `$Table("add")`, for each entry; for a WeakSet, `$Table("add")` for each value.
struct WeakFill;

impl ForOf for WeakFill {
    fn item(vm: &mut Vm, fr: Frame, item: Value) -> Result<Flow, Value> {
        let id = fr.slot(vm, FOR_OF_SLOTS).obj().unwrap_or(0);
        if matches!(vm.heap[id as usize].kind, Kind::WeakMap(_)) {
            fuel::native(vm);
            if !matches!(item, Value::Obj(_)) {
                return Err(
                    vm.type_error("new WeakMap(...) expects [key, value] pairs as entry objects.")
                );
            }
            let k = vm.get_elem(&item, &Value::Num(0.0))?;
            let v = vm.get_elem(&item, &Value::Num(1.0))?;
            weak_key(vm, &k, "as weak map key")?;
            let key = vm.map_key(&k);
            table(vm, id).set(key, k, v);
        } else {
            weak_key(vm, &item, "in weak set")?;
            let key = vm.map_key(&item);
            table(vm, id).set(key, item, Value::Undef);
        }
        fuel::native(vm);
        Ok(Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: Frame) -> Res {
        Ok(fr.get(vm, FOR_OF_SLOTS))
    }
}

fn weak_ctor(vm: &mut Vm, this: Value, args: &[Value], pairs: bool, callee: Id) -> Res {
    let name = if pairs { "WeakMap" } else { "WeakSet" };
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error(&format!("Constructor {name} requires 'new'.")));
    }
    let proto = if pairs {
        vm.realm.std.weak_map
    } else {
        vm.realm.std.weak_set
    };
    let kind = if pairs {
        Kind::WeakMap(Box::default())
    } else {
        Kind::WeakSet(Box::default())
    };
    let id = vm.alloc(Obj::new(Some(proto), kind));
    let src = arg(args, 0);
    if src.is_nullish() {
        return Ok(Value::Obj(id));
    }
    fuel::method(vm);
    let own = [Value::Obj(id)];
    enter_for_of_sub(
        vm,
        NativeOp::Collections,
        WEAK_FILL,
        callee,
        Value::Undef,
        src,
        &own,
    )
}

fn weak_map_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    weak_ctor(vm, this, args, true, callee)
}

fn weak_set_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    weak_ctor(vm, this, args, false, callee)
}

fn weak_map_of(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    receiver(vm, this, &format!("WeakMap.prototype.{name}"), |k| {
        matches!(k, Kind::WeakMap(_))
    })
}

fn weak_get(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_map_of(vm, &this, "get")?;
    let k = arg(args, 0);
    if !holdable(vm, &k) {
        return Ok(Value::Undef);
    }
    let key = vm.map_key(&k);
    Ok(table(vm, id).get(key).unwrap_or_default())
}

fn weak_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_map_of(vm, &this, "set")?;
    let k = arg(args, 0);
    weak_key(vm, &k, "as weak map key")?;
    let key = vm.map_key(&k);
    table(vm, id).set(key, k, arg(args, 1));
    Ok(this)
}

fn weak_either(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    let is_map =
        matches!(this, Value::Obj(id) if matches!(vm.heap[*id as usize].kind, Kind::WeakMap(_)));
    let what = if is_map { "WeakMap" } else { "WeakSet" };
    receiver(vm, this, &format!("{what}.prototype.{name}"), |k| {
        matches!(k, Kind::WeakMap(_) | Kind::WeakSet(_))
    })
}

fn weak_has(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_either(vm, &this, "has")?;
    let k = arg(args, 0);
    if !holdable(vm, &k) {
        return Ok(Value::Bool(false));
    }
    let key = vm.map_key(&k);
    Ok(Value::Bool(table(vm, id).has(key)))
}

fn weak_delete(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_either(vm, &this, "delete")?;
    let k = arg(args, 0);
    if !holdable(vm, &k) {
        return Ok(Value::Bool(false));
    }
    let key = vm.map_key(&k);
    Ok(Value::Bool(table(vm, id).delete(key)))
}

fn weak_add(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = receiver(vm, &this, "WeakSet.prototype.add", |k| {
        matches!(k, Kind::WeakSet(_))
    })?;
    let k = arg(args, 0);
    weak_key(vm, &k, "in weak set")?;
    let key = vm.map_key(&k);
    table(vm, id).set(key, k, Value::Undef);
    Ok(this)
}

fn weak_get_or_insert(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_map_of(vm, &this, "getOrInsert")?;
    let k = arg(args, 0);
    weak_key(vm, &k, "as weak map key")?;
    let key = vm.map_key(&k);
    if let Some(v) = table(vm, id).get(key) {
        return Ok(v);
    }
    table(vm, id).set(key, k, arg(args, 1));
    Ok(arg(args, 1))
}

fn weak_get_or_insert_computed(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let id = weak_map_of(vm, &this, "getOrInsertComputed")?;
    weak_key(vm, &arg(args, 0), "as weak map key")?;
    get_or_insert_computed(vm, id, args, "WeakMap.getOrInsertComputed", callee)
}

// The sub-ops of this family's frames. A number keeps its meaning once a snapshot may hold it.
/// `getOrInsertComputed` of a Map or WeakMap.
const GET_OR_INSERT: u16 = 0;
/// A Set composition method given a Set-like object.
const SET_METHOD: u16 = 1;
/// `new WeakMap(iterable)` and `new WeakSet(iterable)`.
const WEAK_FILL: u16 = 2;
/// A generator's `next`, `return` or `throw` called as a native.
pub(crate) const GEN_RESUME: u16 = 3;
/// `Promise.all`, `allSettled`, `any` and `race` over an input they iterate in a frame.
pub(crate) const COMBINE: u16 = 4;
/// The loop that collects a combinator's input.
pub(crate) const COLLECT: u16 = 5;

/// The steps of this family's native frames (`native::NativeOp::Collections`), by sub-op; see `native.rs`.
pub(crate) fn family_step(vm: &mut Vm, sub: u16, fr: Frame, input: Input) -> Result<Step, Value> {
    use super::collections;
    match sub {
        GET_OR_INSERT => get_or_insert_step(vm, fr, input),
        SET_METHOD => set_method_step(vm, fr, input),
        WEAK_FILL => for_of_step::<WeakFill>(vm, fr, input),
        GEN_RESUME => collections::gen_resume_step(vm, fr, input),
        COMBINE => collections::combine_step(vm, fr, input),
        COLLECT => for_of_step::<collections::Collect>(vm, fr, input),
        _ => Ok(Step::Done(Value::Undef)),
    }
}
