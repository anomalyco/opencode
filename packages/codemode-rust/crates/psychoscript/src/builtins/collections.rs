//! Map, Set, Promise, generators and built-in iterators.

use super::arg;
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Reaction, Res, Vm};

pub fn setup(vm: &mut Vm) {
    let mp = vm.realm.map_proto;
    vm.ctor("Map", 0, map_ctor, mp, Value::Undef);
    vm.methods(
        mp,
        &[
            ("get", 1, map_get),
            ("set", 2, map_set),
            ("has", 1, map_has),
            ("delete", 1, map_delete),
            ("clear", 0, map_clear),
            ("forEach", 1, map_for_each),
            ("keys", 0, map_keys),
            ("values", 0, map_values),
        ],
    );
    let entries = vm.method(mp, "entries", 0, map_entries);
    vm.define_hidden(mp, SYM_ITERATOR, entries);

    let sp = vm.realm.set_proto;
    vm.ctor("Set", 0, set_ctor, sp, Value::Undef);
    vm.methods(
        sp,
        &[
            ("add", 1, set_add),
            ("has", 1, map_has),
            ("delete", 1, map_delete),
            ("clear", 0, map_clear),
            ("forEach", 1, map_for_each),
            ("entries", 0, map_entries),
        ],
    );
    let values = vm.method(sp, "values", 0, map_values);
    let keys = vm.atoms.intern_static("keys");
    vm.define_hidden(sp, keys, values);
    vm.define_hidden(sp, SYM_ITERATOR, values);

    let pp = vm.realm.promise_proto;
    let promise = vm.ctor("Promise", 1, promise_ctor, pp, Value::Undef);
    vm.methods(
        promise,
        &[
            ("resolve", 1, promise_resolve),
            ("reject", 1, promise_reject),
            ("all", 1, promise_all),
            ("allSettled", 1, promise_all_settled),
            ("any", 1, promise_any),
            ("race", 1, promise_race),
            ("withResolvers", 0, promise_with_resolvers),
            ("try", 1, promise_try),
        ],
    );
    let then = vm.method(pp, "then", 2, promise_then);
    vm.realm.promise_then = then.as_obj().unwrap_or(0);
    vm.methods(
        pp,
        &[("catch", 1, promise_catch), ("finally", 1, promise_finally)],
    );

    let ip = vm.realm.iter_proto;
    vm.method(ip, "next", 0, iter_next);
    let self_iter = vm.native_fn("[Symbol.iterator]", 0, iter_self, Value::Undef);
    vm.define_hidden(ip, SYM_ITERATOR, self_iter);

    let gp = vm.realm.generator_proto;
    vm.methods(
        gp,
        &[
            ("next", 1, gen_next),
            ("return", 1, gen_return),
            ("throw", 1, gen_throw),
        ],
    );
}

// ---------- Map and Set ----------

fn map_of(vm: &mut Vm, this: &Value, what: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Map(_) | Kind::Set(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(vm.type_error(&format!("Method {what} called on incompatible receiver")))
}

fn table<'a>(vm: &'a mut Vm<'_>, id: Id) -> &'a mut OrderedMap {
    match &mut vm.heap[id as usize].kind {
        Kind::Map(m) | Kind::Set(m) => m,
        _ => unreachable!("checked by map_of"),
    }
}

fn map_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Constructor Map requires 'new'"));
    }
    let proto = vm.realm.map_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Map(Box::default())));
    let src = arg(args, 0);
    if !src.is_nullish() {
        for entry in vm.iterate_to_vec(&src)? {
            if !matches!(entry, Value::Obj(_)) {
                let d = vm.describe(&entry);
                return Err(vm.type_error(&format!("Iterator value {d} is not an entry object")));
            }
            let k = vm.get_elem(&entry, &Value::Num(0.0))?;
            let v = vm.get_elem(&entry, &Value::Num(1.0))?;
            let key = vm.map_key(&k);
            table(vm, id).set(key, k, v);
        }
    }
    Ok(Value::Obj(id))
}

fn set_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Constructor Set requires 'new'"));
    }
    let proto = vm.realm.set_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Set(Box::default())));
    let src = arg(args, 0);
    if !src.is_nullish() {
        for v in vm.iterate_to_vec(&src)? {
            let key = vm.map_key(&v);
            table(vm, id).set(key, v, Value::Undef);
        }
    }
    Ok(Value::Obj(id))
}

fn map_get(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "Map.prototype.get")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(table(vm, id).get(key).unwrap_or_default())
}

fn map_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "Map.prototype.set")?;
    let key = vm.map_key(&arg(args, 0));
    table(vm, id).set(key, arg(args, 0), arg(args, 1));
    Ok(this)
}

fn set_add(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "Set.prototype.add")?;
    let key = vm.map_key(&arg(args, 0));
    table(vm, id).set(key, arg(args, 0), Value::Undef);
    Ok(this)
}

fn map_has(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "has")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(Value::Bool(table(vm, id).has(key)))
}

fn map_delete(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "delete")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(Value::Bool(table(vm, id).delete(key)))
}

fn map_clear(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "clear")?;
    table(vm, id).clear();
    Ok(Value::Undef)
}

fn map_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of(vm, &this, "forEach")?;
    let f = arg(args, 0);
    if !vm.is_callable(&f) {
        let d = vm.describe(&f);
        return Err(vm.type_error(&format!("{d} is not a function")));
    }
    let is_set = matches!(vm.heap[id as usize].kind, Kind::Set(_));
    let this_arg = arg(args, 1);
    let mut i = 0;
    loop {
        let entry = {
            let m = table(vm, id);
            if i >= m.entries.len() {
                break;
            }
            m.entries[i]
        };
        i += 1;
        if let Some((k, v)) = entry {
            let v = if is_set { k } else { v };
            vm.call(&f, this_arg, &[v, k, this])?;
        }
    }
    Ok(Value::Undef)
}

fn map_iter(vm: &mut Vm, this: &Value, kind: IterKind) -> Res {
    let id = map_of(vm, this, "iterator")?;
    let proto = vm.realm.iter_proto;
    Ok(Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::MapIter {
            target: id,
            pos: 0,
            kind,
        },
    ))))
}

fn map_keys(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_iter(vm, &this, IterKind::Keys)
}

fn map_values(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_iter(vm, &this, IterKind::Values)
}

fn map_entries(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_iter(vm, &this, IterKind::Entries)
}

// ---------- iterators and generators ----------

fn iter_next(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let r = vm.iter_step(&this)?;
    Ok(match r {
        Some(v) => vm.iter_result(v, false),
        None => vm.iter_result(Value::Undef, true),
    })
}

fn iter_self(_vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(this)
}

fn gen_resume(vm: &mut Vm, this: &Value, mode: u8, v: Value) -> Res {
    let Value::Obj(id) = this else {
        return Err(vm.type_error("Generator method called on incompatible receiver"));
    };
    if !matches!(vm.heap[*id as usize].kind, Kind::Generator(_)) {
        return Err(vm.type_error("Generator method called on incompatible receiver"));
    }
    let (value, done) = vm.resume_generator(*id, mode, v)?;
    Ok(vm.iter_result(value, done))
}

fn gen_next(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    gen_resume(vm, &this, 0, arg(args, 0))
}

fn gen_return(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    gen_resume(vm, &this, 1, arg(args, 0))
}

fn gen_throw(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    gen_resume(vm, &this, 2, arg(args, 0))
}

// ---------- Promise ----------

fn promise_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Promise constructor cannot be invoked without 'new'"));
    }
    let executor = arg(args, 0);
    if !vm.is_callable(&executor) {
        let d = vm.describe(&executor);
        return Err(vm.type_error(&format!("Promise resolver {d} is not a function")));
    }
    let p = vm.new_promise();
    let (res, rej) = vm.create_resolvers(p);
    if let Err(e) = vm.call(&executor, Value::Undef, &[res, rej]) {
        if vm.fatal.is_some() {
            return Err(e);
        }
        vm.call(&rej, Value::Undef, &[e])?;
    }
    Ok(Value::Obj(p))
}

fn promise_resolve(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Obj(vm.promise_resolve(arg(args, 0))))
}

fn promise_reject(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let p = vm.new_promise();
    vm.reject(p, arg(args, 0));
    Ok(Value::Obj(p))
}

fn combinator(vm: &mut Vm, args: &[Value], kind: CombKind) -> Res {
    let items = vm.iterate_to_vec(&arg(args, 0))?;
    let result = vm.new_promise();
    let n = items.len();
    if n == 0 {
        if kind == CombKind::Any {
            let proto = vm.realm.aggregate_error_proto;
            let e = vm.make_error(proto, "All promises were rejected");
            let empty = vm.new_array(Vec::new());
            if let Value::Obj(eid) = e {
                let ek = vm.names.errors;
                vm.define_hidden(eid, ek, empty);
            }
            vm.reject(result, e);
        } else {
            let empty = vm.new_array(Vec::new());
            vm.resolve_promise(result, empty);
        }
        return Ok(Value::Obj(result));
    }
    let proto = vm.realm.object_proto;
    let comb = vm.alloc(Obj::new(
        Some(proto),
        Kind::Combinator(Box::new(Combinator {
            kind,
            promise: result,
            values: vec![Value::Undef; n],
            remaining: n,
        })),
    ));
    for (i, item) in items.into_iter().enumerate() {
        let p = vm.promise_resolve(item);
        vm.perform_then(
            p,
            Reaction::Comb {
                comb,
                index: i as u32,
            },
        );
    }
    Ok(Value::Obj(result))
}

fn promise_all(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    combinator(vm, args, CombKind::All)
}

fn promise_all_settled(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    combinator(vm, args, CombKind::AllSettled)
}

fn promise_any(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    combinator(vm, args, CombKind::Any)
}

fn promise_race(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let items = vm.iterate_to_vec(&arg(args, 0))?;
    let result = vm.new_promise();
    for item in items {
        let p = vm.promise_resolve(item);
        vm.perform_then(p, Reaction::Resolve(result));
    }
    Ok(Value::Obj(result))
}

fn promise_with_resolvers(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    let p = vm.new_promise();
    let (res, rej) = vm.create_resolvers(p);
    let o = vm.new_object();
    let (pk, rk, jk) = (
        vm.atoms.intern_static("promise"),
        vm.atoms.intern_static("resolve"),
        vm.atoms.intern_static("reject"),
    );
    vm.define(o, pk, Value::Obj(p));
    vm.define(o, rk, res);
    vm.define(o, jk, rej);
    Ok(Value::Obj(o))
}

fn promise_try(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let p = vm.new_promise();
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    match vm.call(&arg(args, 0), Value::Undef, rest) {
        Ok(v) => vm.resolve_promise(p, v),
        Err(e) => {
            if vm.fatal.is_some() {
                return Err(e);
            }
            vm.reject(p, e);
        }
    }
    Ok(Value::Obj(p))
}

fn this_promise(vm: &mut Vm, this: &Value) -> Result<Id, Value> {
    match vm.as_promise(this) {
        Some(p) => Ok(p),
        None => Err(vm.type_error("Promise.prototype method called on incompatible receiver")),
    }
}

fn promise_then(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this)?;
    let derived = vm.new_promise();
    vm.perform_then(
        p,
        Reaction::Then {
            on_ful: arg(args, 0),
            on_rej: arg(args, 1),
            derived,
        },
    );
    Ok(Value::Obj(derived))
}

fn promise_catch(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this)?;
    let derived = vm.new_promise();
    vm.perform_then(
        p,
        Reaction::Then {
            on_ful: Value::Undef,
            on_rej: arg(args, 0),
            derived,
        },
    );
    Ok(Value::Obj(derived))
}

fn promise_finally(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this)?;
    let derived = vm.new_promise();
    let cleanup = arg(args, 0);
    if vm.is_callable(&cleanup) {
        vm.perform_then(p, Reaction::Finally { cleanup, derived });
    } else {
        vm.perform_then(p, Reaction::Resolve(derived));
    }
    Ok(Value::Obj(derived))
}
