//! Map, Set, Promise, generators and built-in iterators.

use super::{arg, fuel};
use crate::native::{
    FOR_OF_SLOTS, Flow, ForOf, Frame, Input, Step, enter_for_of, enter_for_of_sub,
};
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{Reaction, Res, Vm};

pub fn setup(vm: &mut Vm) {
    let mp = vm.realm.map_proto;
    vm.ctor("Map", 0, map_ctor, mp, Value::Undef);
    super::accessors(vm, mp, &["size"]);
    vm.methods(
        mp,
        &[
            ("get", 1, map_get),
            ("set", 2, map_set),
            ("has", 1, map_has::<false>),
            ("delete", 1, map_delete::<false>),
            ("clear", 0, map_clear::<false>),
            ("forEach", 1, map_for_each::<false>),
            ("keys", 0, map_keys),
            ("values", 0, map_values::<false>),
        ],
    );
    let entries = vm.method(mp, "entries", 0, map_entries::<false>);
    vm.define_hidden(mp, SYM_ITERATOR, entries);

    let sp = vm.realm.set_proto;
    super::accessors(vm, sp, &["size"]);
    vm.ctor("Set", 0, set_ctor, sp, Value::Undef);
    vm.methods(
        sp,
        &[
            ("add", 1, set_add),
            ("has", 1, map_has::<true>),
            ("delete", 1, map_delete::<true>),
            ("clear", 0, map_clear::<true>),
            ("forEach", 1, map_for_each::<true>),
            ("entries", 0, map_entries::<true>),
        ],
    );
    let values = vm.method(sp, "values", 0, map_values::<true>);
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
        ],
    );
    // Each combinator keeps, as its data, the internal function that collects an input it iterates in a frame.
    let collect = vm.native_fn("", 1, collect_items, Value::Undef);
    let combinators: [(&'static str, crate::vm::NativeFn); 4] = [
        ("all", promise_combinator::<ALL>),
        ("allSettled", promise_combinator::<ALL_SETTLED>),
        ("any", promise_combinator::<ANY>),
        ("race", promise_combinator::<RACE>),
    ];
    for (name, f) in combinators {
        let v = vm.native_fn(name, 1, f, collect);
        let key = vm.atoms.intern(name);
        vm.define_hidden(promise, key, v);
    }
    vm.methods(
        promise,
        &[
            ("withResolvers", 0, promise_with_resolvers),
            ("try", 1, promise_try),
        ],
    );
    // Combinators are not callbacks: `[p].map(Promise.resolve)` must ask for an arrow function.
    for name in [
        "all",
        "allSettled",
        "race",
        "any",
        "resolve",
        "reject",
        "withResolvers",
        "try",
    ] {
        let key = vm.atoms.intern(name);
        if let Value::Obj(f) = vm.get_obj(promise, key) {
            vm.heap[f as usize].flags |= NOT_CALLBACK;
        }
    }
    let then = vm.method(pp, "then", 2, promise_then);
    vm.realm.promise_then = then.as_obj().unwrap_or(0);
    vm.methods(
        pp,
        &[("catch", 1, promise_catch), ("finally", 1, promise_finally)],
    );

    // `Iterator.prototype.next` is `builtins::iterator`'s.
    let ip = vm.realm.iter_proto;
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

/// The receiver of a Map method (`SET` false) or a Set method (`SET` true).
fn map_of<const SET: bool>(vm: &mut Vm, this: &Value, what: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this {
        match vm.heap[*id as usize].kind {
            Kind::Map(_) if !SET => return Ok(*id),
            Kind::Set(_) if SET => return Ok(*id),
            _ => {}
        }
    }
    let ty = if SET { "Set" } else { "Map" };
    Err(super::incompatible(
        vm,
        &format!("{ty}.prototype.{what}"),
        this,
    ))
}

fn table(vm: &mut Vm, id: Id) -> &mut OrderedMap {
    match &mut vm.heap[id as usize].kind {
        Kind::Map(m) | Kind::Set(m) => m,
        _ => unreachable!("checked by map_of"),
    }
}

/// The reference's `fillCollection` into the Map or Set in the frame's first own slot: for a Map, `$IsObject`, then
/// `$Table("add")`, for each entry; for a Set, `$Table("add")` for each value.
pub(crate) struct FillCollection;

impl ForOf for FillCollection {
    fn item(vm: &mut Vm, fr: Frame, x: Value) -> Result<Flow, Value> {
        let id = fr.slot(vm, FOR_OF_SLOTS).obj().unwrap_or(0);
        if matches!(vm.heap[id as usize].kind, Kind::Set(_)) {
            let key = vm.map_key(&x);
            table(vm, id).set(key, x, Value::Undef);
            fuel::native(vm);
            return Ok(Flow::Next);
        }
        fuel::native(vm);
        if !matches!(x, Value::Obj(_)) {
            return Err(vm.type_error("new Map(...) expects [key, value] pairs as entry objects."));
        }
        let k = vm.get_elem(&x, &Value::Num(0.0))?;
        let v = vm.get_elem(&x, &Value::Num(1.0))?;
        let key = vm.map_key(&k);
        table(vm, id).set(key, k, v);
        fuel::native(vm);
        Ok(Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: Frame) -> Res {
        Ok(fr.get(vm, FOR_OF_SLOTS))
    }
}

fn map_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Constructor Map requires 'new'"));
    }
    let proto = vm.realm.map_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Map(Box::default())));
    let src = arg(args, 0);
    if !src.is_nullish() {
        fuel::method(vm);
        let op = crate::native::NativeOp::FillCollection;
        return enter_for_of(vm, op, callee, Value::Undef, src, &[Value::Obj(id)]);
    }
    Ok(Value::Obj(id))
}

fn set_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Constructor Set requires 'new'"));
    }
    let proto = vm.realm.set_proto;
    let id = vm.alloc(Obj::new(Some(proto), Kind::Set(Box::default())));
    let src = arg(args, 0);
    if !src.is_nullish() {
        fuel::method(vm);
        let op = crate::native::NativeOp::FillCollection;
        return enter_for_of(vm, op, callee, Value::Undef, src, &[Value::Obj(id)]);
    }
    Ok(Value::Obj(id))
}

fn map_get(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of::<false>(vm, &this, "get")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(table(vm, id).get(key).unwrap_or_default())
}

fn map_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of::<false>(vm, &this, "set")?;
    let key = vm.map_key(&arg(args, 0));
    table(vm, id).set(key, arg(args, 0), arg(args, 1));
    Ok(this)
}

fn set_add(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of::<true>(vm, &this, "add")?;
    let key = vm.map_key(&arg(args, 0));
    table(vm, id).set(key, arg(args, 0), Value::Undef);
    Ok(this)
}

/// `Set.prototype.has` and `Map.prototype.has`, which the Set methods may call directly (see `sets::builtin_has`).
pub(crate) const SET_HAS: crate::vm::NativeFn = map_has::<true>;
pub(crate) const MAP_HAS: crate::vm::NativeFn = map_has::<false>;

fn map_has<const SET: bool>(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of::<SET>(vm, &this, "has")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(Value::Bool(table(vm, id).has(key)))
}

fn map_delete<const SET: bool>(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = map_of::<SET>(vm, &this, "delete")?;
    let key = vm.map_key(&arg(args, 0));
    Ok(Value::Bool(table(vm, id).delete(key)))
}

fn map_clear<const SET: bool>(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = map_of::<SET>(vm, &this, "clear")?;
    table(vm, id).clear();
    Ok(Value::Undef)
}

fn map_for_each<const SET: bool>(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    // The reference's `collectionForEach`, over `$Table("entries")`.
    fuel::method(vm);
    let id = map_of::<SET>(vm, &this, "forEach")?;
    fuel::receiver_then_loop(vm);
    let label = if SET { "Set.forEach" } else { "Map.forEach" };
    let f = super::require_callback(vm, &arg(args, 0), label)?;
    fuel::native(vm);
    fuel::native(vm);
    let op = crate::native::NativeOp::MapForEach;
    vm.enter_native(
        op,
        callee,
        Value::Obj(id),
        &[f, arg(args, 1), Value::Num(0.0)],
    )
}

/// The step of a Map's or Set's `forEach`: entries added while it runs are visited too.
pub(crate) fn map_for_each_step(
    vm: &mut Vm,
    fr: Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let this = fr.this_slot(vm);
    let id = this.obj().unwrap_or(0);
    let mut i = fr.index(vm, 2);
    match input {
        Input::Returned(_) => fuel::step(vm),
        Input::Threw(e) => return Err(e),
        Input::Start | Input::Finished(_) => {}
    }
    let is_set = matches!(vm.heap[id as usize].kind, Kind::Set(_));
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
            fr.set_index(vm, 2, i);
            let v = if is_set { k } else { v };
            let (f, this_arg) = (fr.slot(vm, 0), fr.slot(vm, 1));
            return fr.call_slots(vm, f, this_arg, [Slot::pack(v), Slot::pack(k), this]);
        }
    }
    vm.bytecode_builtin();
    Ok(Step::Done(Value::Undef))
}

fn map_iter<const SET: bool>(vm: &mut Vm, this: &Value, name: &str, kind: IterKind) -> Res {
    let id = map_of::<SET>(vm, this, name)?;
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
    map_iter::<false>(vm, &this, "keys", IterKind::Keys)
}

fn map_values<const SET: bool>(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_iter::<SET>(vm, &this, "values", IterKind::Values)
}

fn map_entries<const SET: bool>(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_iter::<SET>(vm, &this, "entries", IterKind::Entries)
}

// ---------- iterators and generators ----------

fn iter_self(_vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(this)
}

/// A generator method called as a native (`mode` 0 for `next`, 1 for `return`, 2 for `throw`): a generator that
/// runs does so in a frame, which answers with the iterator result.
fn gen_resume(vm: &mut Vm, this: &Value, mode: u8, v: Value, callee: Id) -> Res {
    let Value::Obj(id) = *this else {
        return Err(vm.type_error("Generator method called on incompatible receiver"));
    };
    match vm.heap[id as usize].kind {
        Kind::Generator(GenState::Suspended(_)) => {}
        Kind::Generator(_) => {
            // A generator that is done or running does not run: the answer is at hand.
            if let Some((value, done)) = vm.native_resume(id, mode, v)? {
                return Ok(vm.iter_result(value, done));
            }
        }
        _ => return Err(vm.type_error("Generator method called on incompatible receiver")),
    }
    let op = crate::native::NativeOp::Collections;
    let slots = [Value::Obj(id), Value::Num(mode as f64), v];
    vm.enter_native_sub(op, super::sets::GEN_RESUME, callee, Value::Undef, &slots)
}

/// `Vm::native_resume` for the frame `fr` on top, with what the generator throws and does not catch coming back to
/// the frame as `Input::Threw`. A `return` or `throw` request unwinds while the frame's step runs, which must not
/// carry the throw past the frame: when the frame is the base of a run, that would unwind the frames below it twice.
pub(crate) fn resume_catching(
    vm: &mut Vm,
    fr: Frame,
    g: Id,
    mode: u8,
    v: Value,
) -> Result<Option<(Value, bool)>, Value> {
    let sp = (vm.stack.len() - fr.base()) as u32;
    vm.handlers_mut().push(crate::vm::Handler {
        pc: crate::native::THREW as u32,
        sp,
    });
    let r = vm.native_resume(g, mode, v);
    if !matches!(r, Ok(None)) {
        vm.handlers_mut().pop();
    }
    r
}

/// The step of a generator method's frame: resumes the generator, then answers with what it yielded or returned.
pub(crate) fn gen_resume_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let g = fr.slot(vm, 0).obj().unwrap_or(0);
            let (mode, v) = (fr.index(vm, 1) as u8, fr.get(vm, 2));
            match resume_catching(vm, fr, g, mode, v)? {
                None => Ok(Step::Pushed),
                Some((value, done)) => Ok(Step::Done(vm.iter_result(value, done))),
            }
        }
        Input::Returned(r) => Ok(Step::Done(vm.iter_result(r.get(), false))),
        Input::Finished(r) => Ok(Step::Done(vm.iter_result(r.get(), true))),
        Input::Threw(e) => Err(e),
    }
}

fn gen_next(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    gen_resume(vm, &this, 0, arg(args, 0), callee)
}

fn gen_return(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    gen_resume(vm, &this, 1, arg(args, 0), callee)
}

fn gen_throw(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    gen_resume(vm, &this, 2, arg(args, 0), callee)
}

// ---------- Promise ----------

fn promise_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        return Err(vm.type_error("Promise constructor cannot be invoked without 'new'"));
    }
    let executor = arg(args, 0);
    if !vm.is_callable(&executor) || matches!(executor, Value::Obj(id) if vm.is_namespace(id)) {
        return Err(vm.type_error(
            "new Promise(...) expects an executor function (e.g. new Promise((resolve, reject) => { ... })).",
        ));
    }
    let p = vm.new_promise();
    let (res, rej) = vm.create_resolvers(p);
    let kind = crate::promise::EXECUTOR;
    crate::promise::enter_settle(
        vm,
        Value::Obj(callee),
        kind,
        Value::Obj(p),
        rej,
        Value::Undef,
        executor,
        Value::Undef,
        &[res, rej],
    )
}

fn promise_resolve(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Obj(vm.promise_resolve(arg(args, 0))))
}

fn promise_reject(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let p = vm.new_promise();
    vm.reject(p, arg(args, 0));
    Ok(Value::Obj(p))
}

// Which combinator a frame runs, as its slot holds it.
const ALL: u8 = 0;
const ALL_SETTLED: u8 = 1;
const ANY: u8 = 2;
const RACE: u8 = 3;
const COMBINATOR_NAMES: [&str; 4] = ["all", "allSettled", "any", "race"];

/// `Promise.all`, `allSettled`, `any` and `race`: an input that fails to iterate gives a rejected promise, not a
/// throw. An array is walked here; any other input is iterated in a frame (`combine_step`).
fn promise_combinator<const K: u8>(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let items = arg(args, 0);
    if !vm.is_iterable(&items) {
        let d = vm.describe_data(&items);
        let name = COMBINATOR_NAMES[K as usize];
        let e = vm.type_error(&format!(
            "Promise.{name} expects a synchronous iterable, received {d}."
        ));
        return Ok(rejected(vm, e));
    }
    // The reference adds the items in its internal `$vmCombine`, a back-edge each, after its own call.
    fuel::native(vm);
    if matches!(items, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Array(_))) {
        return match fuel::for_of(vm, &items) {
            Ok(list) => {
                vm.bytecode_builtin();
                Ok(combine(vm, K, list))
            }
            Err(e) if vm.fatal.is_some() => Err(e),
            Err(e) => Ok(rejected(vm, e)),
        };
    }
    let collect = vm.native_data(callee);
    let op = crate::native::NativeOp::Collections;
    let slots = [collect, items, Value::Num(K as f64)];
    vm.enter_native_sub(op, super::sets::COMBINE, callee, Value::Undef, &slots)
}

/// The step of a combinator's frame: collects its input with the internal `collect_items`, catching what that throws,
/// then combines the items, or answers with a rejected promise.
pub(crate) fn combine_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (collect, items) = (fr.slot(vm, 0), fr.slot(vm, 1));
            Ok(fr.catching_list(vm, collect, Slot::UNDEF, &[items], Step::CallUncounted))
        }
        Input::Returned(r) => {
            let list = match r.obj().map(|id| &mut vm.heap[id as usize].kind) {
                Some(Kind::Array(items)) => std::mem::take(items),
                _ => Vec::new(),
            };
            vm.bytecode_builtin();
            let kind = fr.index(vm, 2) as u8;
            Ok(Step::Done(combine(vm, kind, list)))
        }
        Input::Threw(e) if vm.fatal.is_some() => Err(e),
        Input::Threw(e) => Ok(Step::Done(rejected(vm, e))),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

/// The internal function a combinator's frame calls to collect its input into an array, in a frame of its own.
fn collect_items(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let list = vm.new_array(Vec::new());
    let op = crate::native::NativeOp::Collections;
    let sub = super::sets::COLLECT;
    enter_for_of_sub(vm, op, sub, callee, Value::Undef, arg(args, 0), &[list])
}

/// Collects each value into the array in the frame's first own slot.
pub(crate) struct Collect;

impl ForOf for Collect {
    fn item(vm: &mut Vm, fr: Frame, x: Value) -> Result<Flow, Value> {
        if let Some(list) = fr.slot(vm, FOR_OF_SLOTS).obj()
            && let Kind::Array(items) = &mut vm.heap[list as usize].kind
        {
            items.push(x);
        }
        Ok(Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: Frame) -> Res {
        Ok(fr.get(vm, FOR_OF_SLOTS))
    }
}

fn rejected(vm: &mut Vm, e: Value) -> Value {
    locate_call(vm, &e);
    let p = vm.new_promise();
    vm.reject(p, e);
    Value::Obj(p)
}

/// Points a failure a combinator rejects with at the combinator's call, as the reference's would be when thrown.
fn locate_call(vm: &mut Vm, e: &Value) {
    if let Value::Obj(id) = *e
        && let Some(caller) = vm
            .frames
            .iter()
            .rev()
            .find(|f| !matches!(f.kind, crate::vm::FrameKind::Native(..)))
        && let Kind::Error(Some(f)) = &mut vm.heap[id as usize].kind
        && f.offset.is_none()
    {
        f.offset = caller.func.pos.get(caller.pc.saturating_sub(1)).copied();
    }
}

/// The promise a combinator returns for its input's items.
fn combine(vm: &mut Vm, which: u8, items: Vec<Value>) -> Value {
    let result = vm.new_promise();
    let kind = match which {
        ALL => CombKind::All,
        ALL_SETTLED => CombKind::AllSettled,
        ANY => CombKind::Any,
        _ => {
            if items.is_empty() {
                let e = vm.type_error(
                    "Promise.race([]) would never settle; provide at least one promise or value.",
                );
                locate_call(vm, &e);
                vm.reject(result, e);
            }
            for item in items {
                let p = vm.promise_resolve(item);
                vm.perform_then(p, Reaction::Resolve(result));
            }
            return Value::Obj(result);
        }
    };
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
        return Value::Obj(result);
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
    Value::Obj(result)
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

fn promise_try(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let f = arg(args, 0);
    if !vm.is_callable(&f) {
        let d = vm.describe_data(&f);
        return Err(vm.type_error(&format!("Promise.try expects a function, received {d}.")));
    }
    let p = vm.new_promise();
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    // The reference's native returns before the callback runs, which a call from bytecode spent its fifty on.
    let counted = vm.host.meter.counted;
    if counted {
        fuel::native(vm);
    }
    // The frame ends the call as a bytecode built-in's when the call was counted.
    let (u, c) = (Value::Undef, Value::Num(counted as u8 as f64));
    crate::promise::enter_settle(
        vm,
        Value::Obj(callee),
        crate::promise::TRY,
        Value::Obj(p),
        u,
        c,
        f,
        u,
        rest,
    )
}

fn this_promise(vm: &mut Vm, this: &Value, method: &str) -> Result<Id, Value> {
    match vm.as_promise(this) {
        Some(p) => Ok(p),
        None => Err(super::incompatible(
            vm,
            &format!("Promise.prototype.{method}"),
            this,
        )),
    }
}

fn promise_then(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this, "then")?;
    let on_ful = reaction_handler(vm, arg(args, 0), "then")?;
    let on_rej = reaction_handler(vm, arg(args, 1), "then")?;
    let derived = vm.new_promise();
    vm.perform_then(
        p,
        Reaction::Then {
            on_ful,
            on_rej,
            derived,
        },
    );
    Ok(Value::Obj(derived))
}

fn promise_catch(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this, "catch")?;
    let on_rej = reaction_handler(vm, arg(args, 0), "catch")?;
    let derived = vm.new_promise();
    vm.perform_then(
        p,
        Reaction::Then {
            on_ful: Value::Undef,
            on_rej,
            derived,
        },
    );
    Ok(Value::Obj(derived))
}

/// A reaction's handler as the reference's `reactionHandler` takes it: a function a callback site admits, nothing
/// for anything that isn't a function, and a TypeError for a function it doesn't admit.
fn reaction_handler(vm: &mut Vm, f: Value, method: &str) -> Res {
    if super::supported_callback(vm, &f) {
        return Ok(f);
    }
    if vm.type_of(&f) == "function" {
        let name = format!("Promise.prototype.{method}");
        return Err(super::unsupported_callable(
            vm,
            &name,
            "handler",
            "(value) => fn(value)",
        ));
    }
    Ok(Value::Undef)
}

fn promise_finally(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = this_promise(vm, &this, "finally")?;
    let cleanup = reaction_handler(vm, arg(args, 0), "finally")?;
    let derived = vm.new_promise();
    if vm.is_callable(&cleanup) {
        vm.perform_then(p, Reaction::Finally { cleanup, derived });
    } else {
        vm.perform_then(p, Reaction::Resolve(derived));
    }
    Ok(Value::Obj(derived))
}
