//! Crossing to the host as the reference's boundary crosses: a tool's or `search`'s arguments and the program's result
//! become host JSON. Plain data crosses on a native fast path (`fast`, the reference's `tryFastBoundaryOrJson`); a value
//! holding a promise, a `toJSON` of the program's, or shared objects revisited too often crosses through the
//! reference's internal walk (`$vmCross` over the `visit` generators of `$vmJsonVisitor`), which awaits each promise it
//! meets. The walk here is a heap object (`Kind::Cross`), so a run suspended while it awaits saves it, and it spends
//! the fuel that bytecode spends, in the same order.

use std::rc::Rc;

use rustc_hash::FxHashSet;

use crate::Json;
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{NATIVE_FUEL, Reaction, Res, Vm};

/// The depth the fast path allows.
const FAST_DEPTH: u32 = 32;
/// The depth the walk allows.
const WALK_DEPTH: u32 = 100;
/// The visits of objects seen already the fast path allows (`VISIT_BUDGET`): it gives up at the last.
const REVISITS: u32 = 2048;

/// A walk in progress: the values it crosses (`roots`), what it has crossed of them, and the `visit` generators that
/// run now, outermost first.
pub struct Cross {
    pub roots: Vec<Value>,
    pub crossed: Vec<Value>,
    pub stack: Vec<Visit>,
    /// The containers the walk is inside, for the circular check.
    pub ancestors: Vec<Value>,
    pub target: Target,
    pub waiting: Waiting,
    /// A `next` that resumed the walk owes `$vmCross`'s loop its back-edge when the walk yields or ends again.
    pub owed: bool,
}

/// Where a walk's result goes.
pub enum Target {
    /// A tool call: started with the crossed arguments, or its promise rejected.
    Tool { path: Rc<str>, promise: Id },
    /// `search(...)`: run with the crossed arguments, then answered to the frames it parked with `coroutine`.
    Search { coroutine: u32 },
    /// The program's result.
    Result,
}

#[derive(Clone, Copy, PartialEq)]
pub enum Waiting {
    No,
    /// The program's result is a thenable, awaited before it is walked.
    Root,
    /// The innermost visit met a promise, which it yielded.
    Value,
}

/// One `visit(holder, key, depth)` generator.
pub struct Visit {
    pub holder: Value,
    pub key: Value,
    pub depth: u32,
    pub step: Step,
}

/// Where a visit is: not past its promise check yet, or inside its container's loop, waiting for the child at `i`.
pub enum Step {
    Start,
    Array {
        target: Value,
        out: Id,
        len: u32,
        i: u32,
    },
    Object {
        target: Value,
        out: Id,
        names: Vec<Value>,
        i: u32,
    },
}

/// What the fast path made of a value: its JSON (`None` for undefined), or a need for the walk.
pub enum Fast {
    Json(Option<Json>),
    Walk,
}

/// The arguments' JSON on the fast path, `None` once one needs the walk.
pub fn fast_all(vm: &mut Vm, args: &[Value]) -> Result<Option<Vec<Option<Json>>>, Value> {
    let mut out = Vec::with_capacity(args.len());
    for a in args {
        match fast(vm, a)? {
            Fast::Json(j) => out.push(j),
            Fast::Walk => return Ok(None),
        }
    }
    Ok(Some(out))
}

/// The reference's `tryFastBoundaryOrJson` at the host boundary.
pub fn fast(vm: &mut Vm, v: &Value) -> Result<Fast, Value> {
    match v {
        Value::Undef | Value::Uninit => return Ok(Fast::Json(None)),
        Value::Null => return Ok(Fast::Json(Some(Json::Null))),
        Value::Bool(b) => return Ok(Fast::Json(Some(Json::Bool(*b)))),
        Value::Str(s) => {
            return Ok(Fast::Json(Some(Json::String(crate::convert::host_string(
                vm, *s,
            )))));
        }
        Value::Num(n) => return Ok(Fast::Json(Some(number(*n)))),
        _ => {}
    }
    if let Some(j) = flat(vm, v) {
        return Ok(Fast::Json(Some(j)));
    }
    let mut walk = FastWalk {
        seen: FxHashSet::default(),
        ancestors: Vec::new(),
        revisits: REVISITS,
    };
    Ok(match walk.visit(vm, v, 0)? {
        Some(j) => Fast::Json(j),
        None => Fast::Walk,
    })
}

fn number(n: f64) -> Json {
    if n.is_finite() {
        crate::convert::json_number(n)
    } else {
        Json::Null
    }
}

/// A plain object of at most four data properties, all primitives, without its own `toJSON`.
fn flat(vm: &Vm, v: &Value) -> Option<Json> {
    let Value::Obj(id) = v else { return None };
    let o = &vm.heap[*id as usize];
    if !matches!(o.kind, Kind::Ordinary)
        || o.proto != Some(vm.realm.object_proto)
        || o.props.items.len() > 4
        || o.props.find(vm.names.to_json).is_some()
    {
        return None;
    }
    let mut out = serde_json::Map::new();
    for p in &o.props.items {
        if p.flags & ENUMERABLE == 0 || p.key <= SYM_ASYNC_ITERATOR {
            continue;
        }
        let k = vm.atoms.text(p.key);
        if k == "__proto__" {
            continue;
        }
        let j = match p.value {
            Value::Undef | Value::Uninit => continue,
            Value::Null => Json::Null,
            Value::Bool(b) => Json::Bool(b),
            Value::Num(n) => number(n),
            Value::Str(s) => Json::String(crate::convert::host_string(vm, s)),
            _ => return None,
        };
        out.insert(crate::strings::host_text(k).into_owned(), j);
    }
    Some(Json::Object(out))
}

struct FastWalk {
    seen: FxHashSet<Id>,
    ancestors: Vec<Id>,
    revisits: u32,
}

impl FastWalk {
    /// A value's JSON, `Some(None)` for undefined; `None` when the walk is needed.
    fn visit(
        &mut self,
        vm: &mut Vm,
        cur: &Value,
        depth: u32,
    ) -> Result<Option<Option<Json>>, Value> {
        if depth > FAST_DEPTH {
            return Err(
                vm.range_error(&format!("Value exceeds the maximum depth of {FAST_DEPTH}."))
            );
        }
        let id = match cur {
            Value::Undef | Value::Uninit => return Ok(Some(None)),
            Value::Num(n) => return Ok(Some(Some(number(*n)))),
            Value::Null => return Ok(Some(Some(Json::Null))),
            Value::Bool(b) => return Ok(Some(Some(Json::Bool(*b)))),
            Value::Str(s) => {
                return Ok(Some(Some(Json::String(crate::convert::host_string(
                    vm, *s,
                )))));
            }
            Value::Sym(_) => return Ok(Some(Some(Json::Object(serde_json::Map::new())))),
            Value::Obj(id) => *id,
        };
        if vm.heap[id as usize].is_callable() {
            return Ok(Some(None));
        }
        if matches!(vm.heap[id as usize].kind, Kind::Promise(_)) {
            return Ok(None);
        }
        if !self.seen.insert(id) {
            self.revisits -= 1;
            if self.revisits == 0 {
                return Ok(None);
            }
        }
        let plain = is_plain(vm, id);
        let tj = vm.names.to_json;
        let to_json = if plain && vm.heap[id as usize].props.find(tj).is_none() {
            Value::Undef
        } else {
            vm.get(cur, tj)?
        };
        if vm.is_callable(&to_json) {
            if !builtin_to_json(vm, id, &to_json) {
                return Ok(None);
            }
            let key = vm.static_str("");
            let r = vm.call(&to_json, *cur, &[key])?;
            return Ok(Some(Some(leaf(vm, &r))));
        }
        match &vm.heap[id as usize].kind {
            Kind::Bytes(_) => {
                return crate::builtins::exotic::json_value(vm, cur, true).map(|_| None);
            }
            Kind::SearchParams(_) | Kind::Headers(_) => {
                let v = crate::builtins::exotic::json_value(vm, cur, true)?;
                return Ok(Some(Some(plain_json(vm, &v).unwrap_or(Json::Null))));
            }
            _ => {}
        }
        if self.ancestors.contains(&id) {
            return Err(vm.type_error("Converting circular structure to JSON."));
        }
        self.ancestors.push(id);
        let r = self.children(vm, id, depth);
        self.ancestors.pop();
        r
    }

    fn children(&mut self, vm: &mut Vm, id: Id, depth: u32) -> Result<Option<Option<Json>>, Value> {
        let items = match &vm.heap[id as usize].kind {
            Kind::Array(_) => {
                vm.densify(id)?;
                match &vm.heap[id as usize].kind {
                    Kind::Array(items) => Some(
                        items
                            .iter()
                            .map(|v| {
                                if matches!(v, Value::Uninit) {
                                    Value::Undef
                                } else {
                                    *v
                                }
                            })
                            .collect::<Vec<_>>(),
                    ),
                    _ => Some(Vec::new()),
                }
            }
            Kind::Set(m) => Some(m.entries.iter().flatten().map(|(k, _)| *k).collect()),
            _ => None,
        };
        if let Some(items) = items {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                match self.visit(vm, &item, depth + 1)? {
                    None => return Ok(None),
                    Some(j) => out.push(j.unwrap_or(Json::Null)),
                }
            }
            return Ok(Some(Some(Json::Array(out))));
        }
        let mut out = serde_json::Map::new();
        if matches!(vm.heap[id as usize].kind, Kind::Error(_)) {
            for k in [vm.names.name, vm.names.message] {
                let v = vm.get_obj(id, k);
                match self.visit(vm, &v, depth + 1)? {
                    None => return Ok(None),
                    Some(Some(j)) => {
                        out.insert(crate::strings::host_text(vm.atoms.text(k)).into_owned(), j);
                    }
                    Some(None) => {}
                }
            }
        }
        for (k, v) in vm.own_entries(id) {
            let name = vm.atoms.text(k);
            if name == "__proto__" {
                continue;
            }
            let name = crate::strings::host_text(name).into_owned();
            match self.visit(vm, &v, depth + 1)? {
                None => return Ok(None),
                Some(Some(j)) => {
                    out.insert(name, j);
                }
                Some(None) => {}
            }
        }
        Ok(Some(Some(Json::Object(out))))
    }
}

/// An object `{}` makes: an ordinary object whose prototype is `Object.prototype`.
fn is_plain(vm: &Vm, id: Id) -> bool {
    let o = &vm.heap[id as usize];
    matches!(o.kind, Kind::Ordinary) && o.proto == Some(vm.realm.object_proto)
}

/// Whether `f` is the `toJSON` of a Date or URL `id` is, which the fast path applies itself.
fn builtin_to_json(vm: &mut Vm, id: Id, f: &Value) -> bool {
    let proto = match vm.heap[id as usize].kind {
        Kind::Date(_) => vm.realm.std.date,
        Kind::Url(_) => vm.realm.std.url,
        _ => return false,
    };
    if proto == 0 {
        return false;
    }
    let k = vm.names.to_json;
    matches!((vm.get_obj(proto, k), f), (Value::Obj(a), Value::Obj(b)) if a == *b)
}

/// A primitive's JSON, or null.
fn leaf(vm: &Vm, v: &Value) -> Json {
    match v {
        Value::Str(s) => Json::String(crate::convert::host_string(vm, *s)),
        Value::Num(n) => number(*n),
        Value::Bool(b) => Json::Bool(*b),
        _ => Json::Null,
    }
}

/// The reference's `toPlainJson`: what the walk built, as host JSON; `None` for undefined.
fn plain_json(vm: &Vm, v: &Value) -> Option<Json> {
    Some(match v {
        Value::Undef | Value::Uninit => return None,
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::Num(n) => crate::convert::json_number(*n),
        Value::Str(s) => Json::String(crate::convert::host_string(vm, *s)),
        Value::Sym(_) => Json::Object(serde_json::Map::new()),
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Array(items) => Json::Array(
                items
                    .iter()
                    .map(|i| plain_json(vm, i).unwrap_or(Json::Null))
                    .collect(),
            ),
            _ => {
                let mut out = serde_json::Map::new();
                for p in &vm.heap[*id as usize].props.items {
                    if p.flags & ENUMERABLE == 0 || p.key <= SYM_ASYNC_ITERATOR {
                        continue;
                    }
                    if let Some(j) = plain_json(vm, &p.value) {
                        out.insert(
                            crate::strings::host_text(vm.atoms.text(p.key)).into_owned(),
                            j,
                        );
                    }
                }
                Json::Object(out)
            }
        },
    })
}

// ---------- the walk ----------

/// A tool call: its promise, which the call settles once its arguments have crossed.
pub fn tool_call(vm: &mut Vm, path: &str, args: &[Value]) -> Res {
    let p = vm.new_promise();
    match fast_all(vm, args) {
        Err(e) => {
            if vm.fatal.is_some() {
                return Err(e);
            }
            vm.reject(p, e);
        }
        Ok(Some(json)) => crate::host::start_tool(vm, p, path, json),
        Ok(None) => {
            let id = start(
                vm,
                args.to_vec(),
                Target::Tool {
                    path: Rc::from(path),
                    promise: p,
                },
            );
            advance(vm, id, None)?;
        }
    }
    Ok(Value::Obj(p))
}

/// The program returned `v`: its result once it has crossed.
pub fn program_result(vm: &mut Vm, v: Value) -> Result<(), Value> {
    if !thenable(vm, &v) {
        match fast(vm, &v) {
            Ok(Fast::Json(j)) => {
                vm.result_json = Some(j.unwrap_or(Json::Null));
                vm.outcome = Some(Ok(v));
                return Ok(());
            }
            Ok(Fast::Walk) => {}
            Err(e) => {
                if vm.fatal.is_some() {
                    return Err(e);
                }
                vm.outcome = Some(Err(e));
                return Ok(());
            }
        }
    }
    let id = start(vm, vec![v], Target::Result);
    advance(vm, id, None)
}

/// Whether the reference's `$IsThenable` holds: a promise, or an object with a callable `then`.
fn thenable(vm: &mut Vm, v: &Value) -> bool {
    let Value::Obj(id) = v else { return false };
    if matches!(vm.heap[*id as usize].kind, Kind::Promise(_)) {
        return true;
    }
    let then = vm.names.then;
    let t = vm.get_obj(*id, then);
    vm.is_callable(&t)
}

/// Makes a walk over `roots` as a heap object.
pub fn start(vm: &mut Vm, roots: Vec<Value>, target: Target) -> Id {
    let n = roots.len();
    vm.alloc(Obj::new(
        None,
        Kind::Cross(Box::new(Cross {
            roots,
            crossed: Vec::with_capacity(n),
            stack: Vec::new(),
            ancestors: Vec::new(),
            target,
            waiting: Waiting::No,
            owed: false,
        })),
    ))
}

/// The settled value a walk awaited (`resumed`), or the walk's start: runs it until it awaits again or ends, then
/// hands its outcome to its target.
pub fn advance(vm: &mut Vm, id: Id, resumed: Option<Result<Value, Value>>) -> Result<(), Value> {
    match walk(vm, id, resumed)? {
        Walked::Await(awaited) => {
            wait(vm, id, awaited);
            Ok(())
        }
        Walked::Done(target, outcome) => finish(vm, target, outcome),
    }
}

/// How far a run of the walk got.
enum Walked {
    /// It awaits this.
    Await(Value),
    /// It ended, with every root crossed or an error.
    Done(Target, Result<Vec<Option<Json>>, Value>),
}

/// Runs the walk until it awaits or ends; only a fatal error is an `Err`.
fn walk(vm: &mut Vm, id: Id, resumed: Option<Result<Value, Value>>) -> Result<Walked, Value> {
    let Kind::Cross(mut c) = std::mem::replace(&mut vm.heap[id as usize].kind, Kind::Ordinary)
    else {
        return Err(vm.type_error("The crossing is not running."));
    };
    let r = match resumed {
        Some(Err(e)) => Err(e),
        resumed => step(vm, &mut c, resumed.map(|r| r.unwrap_or_default())),
    };
    match r {
        Ok(Some(awaited)) => {
            vm.heap[id as usize].kind = Kind::Cross(c);
            Ok(Walked::Await(awaited))
        }
        Ok(None) => {
            let crossed = c.crossed.iter().map(|v| plain_json(vm, v)).collect();
            Ok(Walked::Done(c.target, Ok(crossed)))
        }
        Err(e) if vm.fatal.is_some() => Err(e),
        Err(e) => Ok(Walked::Done(c.target, Err(e))),
    }
}

/// `$vmCross`'s `await`: the walk resumes once `awaited` settles.
fn wait(vm: &mut Vm, id: Id, awaited: Value) {
    let p = vm.promise_resolve(awaited);
    vm.perform_then(p, Reaction::Cross(id));
}

/// `search(...)`: its result once its arguments have crossed. When their walk awaits, a call from bytecode (`direct`)
/// parks its frames up to the nearest async function until the walk ends (`Vm::park`); any other cannot wait.
pub fn search_call(vm: &mut Vm, args: &[Value], direct: bool) -> Res {
    if let Some(json) = fast_all(vm, args)? {
        return crate::host::search_value(vm, &json);
    }
    let coroutine = if direct { vm.search_parkable() } else { None };
    let id = start(
        vm,
        args.to_vec(),
        Target::Search {
            coroutine: coroutine.unwrap_or(u32::MAX),
        },
    );
    match walk(vm, id, None)? {
        Walked::Done(_, Ok(json)) => crate::host::search_value(vm, &json),
        Walked::Done(_, Err(e)) => Err(e),
        Walked::Await(awaited) => {
            if coroutine.is_none() {
                return Err(vm.invalid_data(
                    "search(...) can't wait for a promise in its input here, in a callback or a generator; await it \
                     first, e.g. search({ query: await query }).",
                ));
            }
            wait(vm, id, awaited);
            vm.park = true;
            Ok(Value::Undef)
        }
    }
}

fn finish(
    vm: &mut Vm,
    target: Target,
    outcome: Result<Vec<Option<Json>>, Value>,
) -> Result<(), Value> {
    match (target, outcome) {
        (Target::Tool { path, promise }, Ok(json)) => {
            crate::host::start_tool(vm, promise, &path, json);
            Ok(())
        }
        (Target::Tool { promise, .. }, Err(e)) => {
            vm.reject(promise, e);
            Ok(())
        }
        (Target::Result, Ok(mut json)) => {
            vm.result_json = Some(json.pop().flatten().unwrap_or(Json::Null));
            vm.outcome = Some(Ok(Value::Undef));
            Ok(())
        }
        (Target::Result, Err(e)) => {
            vm.outcome = Some(Err(e));
            Ok(())
        }
        (Target::Search { coroutine }, outcome) => vm.answer_search(coroutine, outcome),
    }
}

/// What a step of the walk does next.
enum Act {
    /// `$vmCross`'s loop over the roots, at its condition.
    Root,
    /// The innermost visit reads `holder[key]`.
    Read,
    /// The innermost visit has its value past the promise check.
    Value(Value),
    /// The innermost visit returned this.
    Return(Value),
}

/// Runs the walk: `Some(promise)` when it awaits one, `None` when every root has crossed.
fn step(vm: &mut Vm, c: &mut Cross, resumed: Option<Value>) -> Result<Option<Value>, Value> {
    match (c.waiting, resumed) {
        (Waiting::Root, Some(v)) => {
            c.waiting = Waiting::No;
            let at = c.crossed.len();
            c.roots[at] = v;
            run(vm, c, Act::Root, true)
        }
        (Waiting::Value, Some(v)) => {
            c.waiting = Waiting::No;
            // `walk.next(v)`, then each enclosing `yield*` loops back and calls its inner `next`.
            vm.fuel(NATIVE_FUEL);
            for _ in 1..c.stack.len() {
                vm.fuel(1);
                vm.fuel(NATIVE_FUEL);
            }
            c.owed = true;
            run(vm, c, Act::Value(v), false)
        }
        _ => run(vm, c, Act::Root, false),
    }
}

fn run(
    vm: &mut Vm,
    c: &mut Cross,
    mut act: Act,
    mut root_awaited: bool,
) -> Result<Option<Value>, Value> {
    loop {
        act = match act {
            Act::Root => {
                let at = c.crossed.len();
                if at == c.roots.len() {
                    return Ok(None);
                }
                let root = c.roots[at];
                if matches!(c.target, Target::Result) && !root_awaited && thenable(vm, &root) {
                    c.waiting = Waiting::Root;
                    return Ok(Some(root));
                }
                root_awaited = false;
                // `$vmJsonVisitor(...)`, the root `visit` generator, and the first `next`.
                vm.fuel(1);
                let holder = vm.new_object();
                let empty = vm.atoms.intern_static("");
                vm.define(holder, empty, root);
                vm.fuel(1);
                let key = vm.static_str("");
                c.stack.push(Visit {
                    holder: Value::Obj(holder),
                    key,
                    depth: 0,
                    step: Step::Start,
                });
                vm.fuel(NATIVE_FUEL);
                Act::Read
            }
            Act::Read => {
                let top = c.stack.last().expect("visit");
                if top.depth > WALK_DEPTH {
                    vm.fuel(NATIVE_FUEL);
                    return Err(vm.range_error(&format!(
                        "Value exceeds the maximum depth of {WALK_DEPTH}."
                    )));
                }
                let (holder, key) = (top.holder, top.key);
                let val = vm.get_elem(&holder, &key)?;
                if matches!(val, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Promise(_)))
                {
                    if std::mem::take(&mut c.owed) {
                        vm.fuel(1);
                    }
                    c.waiting = Waiting::Value;
                    return Ok(Some(val));
                }
                Act::Value(val)
            }
            Act::Value(mut val) => {
                let key = c.stack.last().expect("visit").key;
                if let Value::Obj(_) = val {
                    let tj = vm.names.to_json;
                    let f = vm.get(&val, tj)?;
                    if vm.is_callable(&f) {
                        val = vm.call_counted(&f, val, &[key])?;
                    }
                }
                match classify(vm, &val, &c.ancestors)? {
                    Class::Undefined => Act::Return(Value::Undef),
                    Class::Data => Act::Return(val),
                    Class::Null => Act::Return(Value::Null),
                    Class::Special => Act::Return(special(vm, &val)?),
                    Class::Set | Class::Object => {
                        let target = match val {
                            Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Set(_)) => {
                                let items = match &vm.heap[id as usize].kind {
                                    Kind::Set(m) => {
                                        m.entries.iter().flatten().map(|(k, _)| *k).collect()
                                    }
                                    _ => Vec::new(),
                                };
                                vm.new_array(items)
                            }
                            v => v,
                        };
                        c.ancestors.push(target);
                        enter(vm, c, target)?
                    }
                }
            }
            Act::Return(v) => {
                c.stack.pop();
                if c.stack.is_empty() {
                    if std::mem::take(&mut c.owed) {
                        vm.fuel(1);
                    }
                    c.crossed.push(v);
                    // `$vmCross`'s loop over the roots.
                    vm.fuel(1);
                    Act::Root
                } else {
                    returned(vm, c, v)?
                }
            }
        };
    }
}

/// Starts the innermost visit's loop over `target`'s children.
fn enter(vm: &mut Vm, c: &mut Cross, target: Value) -> Result<Act, Value> {
    let is_array =
        matches!(target, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Array(_)));
    if is_array {
        let Value::Obj(out) = vm.new_array(Vec::new()) else {
            return Ok(Act::Return(Value::Undef));
        };
        let lk = vm.names.length;
        let len = vm.get(&target, lk)?;
        let len = match len {
            Value::Num(n) if n > 0.0 => n as u32,
            _ => 0,
        };
        c.stack.last_mut().expect("visit").step = Step::Array {
            target,
            out,
            len,
            i: 0,
        };
        return Ok(if len > 0 { child(vm, c) } else { done(c) });
    }
    let out = vm.alloc(Obj::new(None, Kind::Ordinary));
    let names = json_names(vm, &target);
    let any = !names.is_empty();
    c.stack.last_mut().expect("visit").step = Step::Object {
        target,
        out,
        names,
        i: 0,
    };
    Ok(if any { child(vm, c) } else { done(c) })
}

/// Opens the visit of the child at the innermost visit's `i`: `String(i)` for an array, the child `visit` generator,
/// `yield*` opening it through its `Symbol.iterator`, and its first `next`.
fn child(vm: &mut Vm, c: &mut Cross) -> Act {
    let top = c.stack.last().expect("visit");
    let depth = top.depth + 1;
    let (holder, key) = match &top.step {
        Step::Array { target, i, .. } => {
            let (target, i) = (*target, *i);
            vm.fuel(NATIVE_FUEL);
            (target, vm.string_val(i.to_string()))
        }
        Step::Object {
            target, names, i, ..
        } => (*target, names[*i as usize]),
        Step::Start => return Act::Return(Value::Undef),
    };
    vm.fuel(1);
    vm.fuel(NATIVE_FUEL);
    vm.fuel(NATIVE_FUEL);
    c.stack.push(Visit {
        holder,
        key,
        depth,
        step: Step::Start,
    });
    Act::Read
}

/// The innermost visit's loop ended: it returns what it built.
fn done(c: &mut Cross) -> Act {
    c.ancestors.pop();
    match &c.stack.last().expect("visit").step {
        Step::Array { out, .. } | Step::Object { out, .. } => Act::Return(Value::Obj(*out)),
        Step::Start => Act::Return(Value::Undef),
    }
}

/// The innermost visit's child returned `v`: written into its output, then the loop's back-edge.
fn returned(vm: &mut Vm, c: &mut Cross, v: Value) -> Result<Act, Value> {
    let more = match &mut c.stack.last_mut().expect("visit").step {
        Step::Array { out, len, i, .. } => {
            let (out, at) = (*out, *i as usize);
            let v = if matches!(v, Value::Undef) {
                Value::Null
            } else {
                v
            };
            if let Kind::Array(items) = &mut vm.heap[out as usize].kind {
                items.resize(at, Value::Null);
                items.push(v);
            }
            *i += 1;
            *i < *len
        }
        Step::Object { out, names, i, .. } => {
            let (out, k) = (*out, names[*i as usize]);
            if !matches!(v, Value::Undef) {
                // `$Define`.
                vm.fuel(NATIVE_FUEL);
                let key = vm.string_of(&k)?;
                let atom = vm.atoms.intern_id(key);
                vm.define(out, atom, v);
            }
            if let Step::Object { names, i, .. } = &mut c.stack.last_mut().expect("visit").step {
                *i += 1;
                (*i as usize) < names.len()
            } else {
                false
            }
        }
        Step::Start => false,
    };
    vm.fuel(1);
    Ok(if more { child(vm, c) } else { done(c) })
}

enum Class {
    Undefined,
    Data,
    Null,
    Special,
    Set,
    Object,
}

/// The reference's `$JsonClassify` at the boundary.
fn classify(vm: &mut Vm, v: &Value, ancestors: &[Value]) -> Result<Class, Value> {
    let id = match v {
        Value::Undef | Value::Uninit => return Ok(Class::Undefined),
        Value::Num(n) => {
            return Ok(if n.is_finite() {
                Class::Data
            } else {
                Class::Null
            });
        }
        Value::Null | Value::Str(_) | Value::Bool(_) => return Ok(Class::Data),
        Value::Sym(_) => return Ok(Class::Special),
        Value::Obj(id) => *id,
    };
    if vm.heap[id as usize].is_callable() {
        return Ok(Class::Undefined);
    }
    match vm.heap[id as usize].kind {
        Kind::Bytes(_) => {
            crate::builtins::exotic::json_value(vm, v, true)?;
            return Ok(Class::Special);
        }
        Kind::SearchParams(_) | Kind::Headers(_) => return Ok(Class::Special),
        _ => {}
    }
    if ancestors
        .iter()
        .any(|a| matches!(a, Value::Obj(x) if *x == id))
    {
        return Err(vm.type_error("Converting circular structure to JSON."));
    }
    Ok(if matches!(vm.heap[id as usize].kind, Kind::Set(_)) {
        Class::Set
    } else {
        Class::Object
    })
}

/// The reference's `$JsonSpecial` at the boundary.
fn special(vm: &mut Vm, v: &Value) -> Res {
    if let Value::Obj(id) = v
        && matches!(
            vm.heap[*id as usize].kind,
            Kind::SearchParams(_) | Kind::Headers(_)
        )
    {
        return crate::builtins::exotic::json_value(vm, v, true);
    }
    Ok(Value::Obj(vm.new_object()))
}

/// The reference's `$JsonNames` at the boundary: an error's name and message first, then the own keys but
/// `__proto__`.
fn json_names(vm: &mut Vm, target: &Value) -> Vec<Value> {
    let Value::Obj(id) = target else {
        return Vec::new();
    };
    let id = *id;
    let error = matches!(vm.heap[id as usize].kind, Kind::Error(_));
    let (nk, mk) = (vm.names.name, vm.names.message);
    let mut out = Vec::new();
    if error {
        out.push(vm.atom_val(nk));
        out.push(vm.atom_val(mk));
    }
    for k in vm.own_keys(id) {
        if (error && (k == nk || k == mk)) || vm.atoms.text(k) == "__proto__" {
            continue;
        }
        out.push(vm.atom_val(k));
    }
    out
}

/// The values a walk holds, for the snapshot's reach.
pub fn values(c: &Cross) -> impl Iterator<Item = Value> + '_ {
    let target = match c.target {
        Target::Tool { promise, .. } => Some(Value::Obj(promise)),
        _ => None,
    };
    c.roots
        .iter()
        .chain(c.crossed.iter())
        .chain(c.ancestors.iter())
        .copied()
        .chain(c.stack.iter().flat_map(|v| {
            let mut out = vec![v.holder, v.key];
            match &v.step {
                Step::Start => {}
                Step::Array { target, out: o, .. } => out.extend([*target, Value::Obj(*o)]),
                Step::Object {
                    target,
                    out: o,
                    names,
                    ..
                } => {
                    out.extend([*target, Value::Obj(*o)]);
                    out.extend(names.iter().copied());
                }
            }
            out
        }))
        .chain(target)
}
