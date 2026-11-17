//! Map and Set additions (`getOrInsert`, `groupBy`, the Set composition methods), `Object.groupBy`, WeakMap and
//! WeakSet.

use super::{arg, describe_value, incompatible, require_callback};
use crate::object::*;
use crate::value::{Id, Value};
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

fn table<'a>(vm: &'a mut Vm<'_>, id: Id) -> &'a mut OrderedMap {
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

fn get_or_insert_computed(vm: &mut Vm, id: Id, args: &[Value], name: &str) -> Res {
    let f = require_callback(vm, &arg(args, 1), name)?;
    let k = normalize(arg(args, 0));
    let key = vm.map_key(&k);
    if let Some(v) = table(vm, id).get(key) {
        return Ok(v);
    }
    let v = vm.call(&f, Value::Undef, &[k])?;
    table(vm, id).set(key, k, v);
    Ok(v)
}

fn map_get_or_insert_computed(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = receiver(vm, &this, "Map.prototype.getOrInsertComputed", |k| {
        matches!(k, Kind::Map(_))
    })?;
    get_or_insert_computed(vm, id, args, "Map.getOrInsertComputed")
}

/// Walks an iterable one step at a time, calling the grouping callback between steps.
fn group_by(vm: &mut Vm, args: &[Value], kind: &str) -> Result<Vec<(Value, Value)>, Value> {
    let items = arg(args, 0);
    if items.is_nullish() {
        return Err(vm.type_error(&format!("{kind}.groupBy expects an iterable collection.")));
    }
    let f = require_callback(vm, &arg(args, 1), &format!("{kind}.groupBy"))?;
    let it = vm.get_iterator(&items)?;
    let mut out = Vec::new();
    let mut index = 0.0;
    while let Some(item) = vm.iter_step(&it)? {
        let key = match vm.call(&f, Value::Undef, &[item, Value::Num(index)]) {
            Ok(k) => k,
            Err(e) => {
                let _ = vm.iter_close(&it);
                return Err(e);
            }
        };
        index += 1.0;
        out.push((key, item));
    }
    Ok(out)
}

fn map_group_by(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let pairs = group_by(vm, args, "Map")?;
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
    Ok(Value::Obj(id))
}

fn object_group_by(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let pairs = group_by(vm, args, "Object")?;
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
    let target = receiver(vm, &this, &format!("Set.prototype.{name}"), |k| {
        matches!(k, Kind::Set(_))
    })?;
    let other = arg(args, 0);
    let Value::Obj(oid) = other else {
        return Err(vm.type_error(&format!("Set.{name} expects a Set-like object.")));
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
    if !vm.is_callable(&has) || !vm.is_callable(&keys) {
        return Err(vm.type_error(&format!(
            "Set.{name} expects callable 'has' and 'keys' methods."
        )));
    }
    let own = table(vm, target).live as f64;
    if name == "isSubsetOf" && own > size {
        return Ok(Value::Bool(false));
    }
    if name == "isSupersetOf" && own < size {
        return Ok(Value::Bool(false));
    }
    let result = match name {
        "intersection" => Some(new_set(vm, Vec::new())),
        "union" | "difference" | "symmetricDifference" => {
            let vals = live_values(vm, target);
            Some(new_set(vm, vals))
        }
        _ => None,
    };
    let asks = name == "isSubsetOf"
        || (matches!(name, "intersection" | "difference" | "isDisjointFrom") && own <= size);
    if asks {
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
            let r = vm.call(&has, other, &[item])?;
            let found = vm.truthy(&r);
            match (name, result) {
                ("intersection", Some(res)) => {
                    if found {
                        let key = vm.map_key(&item);
                        table(vm, res).set(key, item, Value::Undef);
                    }
                }
                ("difference", Some(res)) => {
                    if found {
                        let key = vm.map_key(&item);
                        table(vm, res).delete(key);
                    }
                }
                _ => {
                    if found == (name == "isDisjointFrom") {
                        return Ok(Value::Bool(false));
                    }
                }
            }
        }
        return Ok(match result {
            Some(r) => Value::Obj(r),
            None => Value::Bool(true),
        });
    }
    let iterator = vm.call(&keys, other, &[])?;
    let Value::Obj(iid) = iterator else {
        return Err(vm.type_error(&format!(
            "Set.{name} expects 'keys' to return an iterator object."
        )));
    };
    // An array from `keys()` is read like its values iterator.
    let array = matches!(vm.heap[iid as usize].kind, Kind::Array(_));
    let iterator = if array {
        vm.get_iterator(&iterator)?
    } else {
        iterator
    };
    let nk = vm.names.next;
    let next = vm.get_obj(iid, nk);
    loop {
        let item = if array {
            match vm.iter_step(&iterator)? {
                Some(v) => v,
                None => break,
            }
        } else {
            let r = vm.call(&next, iterator, &[])?;
            let Value::Obj(rid) = r else {
                return Err(vm.type_error("Iterator next() result must be an object."));
            };
            let (dk, vk) = (vm.names.done, vm.names.value);
            let done = vm.get_obj(rid, dk);
            if vm.truthy(&done) {
                break;
            }
            vm.get_obj(rid, vk)
        };
        let item = normalize(item);
        let key = vm.map_key(&item);
        let found = table(vm, target).has(key);
        match (name, result) {
            ("union", Some(res)) => table(vm, res).set(key, item, Value::Undef),
            ("intersection", Some(res)) => {
                if found {
                    table(vm, res).set(key, item, Value::Undef);
                }
            }
            ("difference", Some(res)) => {
                table(vm, res).delete(key);
            }
            ("symmetricDifference", Some(res)) => {
                if found {
                    table(vm, res).delete(key);
                } else {
                    table(vm, res).set(key, item, Value::Undef);
                }
            }
            _ => {
                if found == (name == "isDisjointFrom") {
                    vm.iter_close(&iterator)?;
                    return Ok(Value::Bool(false));
                }
            }
        }
    }
    Ok(match result {
        Some(r) => Value::Obj(r),
        None => Value::Bool(true),
    })
}

// ---------- WeakMap and WeakSet ----------

fn weak_key(vm: &mut Vm, v: &Value, label: &str) -> Result<(), Value> {
    if let Value::Obj(id) = v
        && !matches!(vm.heap[*id as usize].kind, Kind::ToolRef(_))
    {
        return Ok(());
    }
    let d = describe_value(vm, v);
    Err(vm.type_error(&format!(
        "Invalid value used {label}: {d} cannot be held weakly."
    )))
}

fn holdable(vm: &Vm, v: &Value) -> bool {
    matches!(v, Value::Obj(id) if !matches!(vm.heap[*id as usize].kind, Kind::ToolRef(_)))
}

fn weak_ctor(vm: &mut Vm, this: Value, args: &[Value], name: &str, pairs: bool) -> Res {
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
    let it = vm.get_iterator(&src)?;
    while let Some(item) = vm.iter_step(&it)? {
        let r = (|| -> Result<(), Value> {
            if pairs {
                if !matches!(item, Value::Obj(_)) {
                    return Err(vm.type_error(&format!(
                        "new {name}(...) expects [key, value] pairs as entry objects."
                    )));
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
            Ok(())
        })();
        if let Err(e) = r {
            let _ = vm.iter_close(&it);
            return Err(e);
        }
    }
    Ok(Value::Obj(id))
}

fn weak_map_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    weak_ctor(vm, this, args, "WeakMap", true)
}

fn weak_set_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    weak_ctor(vm, this, args, "WeakSet", false)
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

fn weak_get_or_insert_computed(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = weak_map_of(vm, &this, "getOrInsertComputed")?;
    weak_key(vm, &arg(args, 0), "as weak map key")?;
    get_or_insert_computed(vm, id, args, "WeakMap.getOrInsertComputed")
}
