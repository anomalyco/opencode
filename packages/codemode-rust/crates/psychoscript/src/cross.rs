//! Crossing to the host. A host call's arguments cross as the reference's `toHost` copies them (`host::host_args`);
//! under the runtime's `promises: await` translation, a call whose arguments hold a promise that hasn't fulfilled waits
//! for it, then calls again (`wait_async`, `wait_sync`: the reference's `$vmHostWait`).
//!
//! The program's result crosses as JSON: plain data on a native fast path (`fast`, the reference's
//! `tryFastBoundaryOrJson`); a value holding a promise, a `toJSON` of the program's, or shared objects revisited too
//! often through the reference's internal walk (`$vmResult` over the `visit` generators of `$vmJsonVisitor`), which
//! awaits each promise it meets. The walk here is a heap object (`Kind::Cross`), so a run suspended while it awaits
//! saves it, and it spends the fuel that bytecode spends, in the same order. A `toJSON` it calls runs from a native
//! frame (`frame_step`), as the reference calls it from its bytecode, so it can park for a host call's wait, suspend
//! and be saved in a snapshot.

use rustc_hash::FxHashSet;

use crate::Json;
use crate::object::*;
use crate::value::{Id, Slot, Value};
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
    pub waiting: Waiting,
    /// A `next` that resumed the walk owes `$vmCross`'s loop its back-edge when the walk yields or ends again.
    pub owed: bool,
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
        out.insert(k.to_owned(), j);
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
            return Ok(builtin_to_json(vm, id, &to_json).map(Some));
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
                        out.insert(vm.atoms.text(k).to_owned(), j);
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
            let name = name.to_owned();
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

/// The JSON of a Date or URL `id` whose `toJSON` `f` is its prototype's, which the fast path makes itself without
/// calling it, as the reference does (even when the program replaced the prototype's method); `None` for any other.
fn builtin_to_json(vm: &mut Vm, id: Id, f: &Value) -> Option<Json> {
    let proto = match vm.heap[id as usize].kind {
        Kind::Date(_) => vm.realm.std.date,
        Kind::Url(_) => vm.realm.std.url,
        _ => return None,
    };
    if proto == 0 {
        return None;
    }
    let k = vm.names.to_json;
    if !matches!((vm.get_obj(proto, k), f), (Value::Obj(a), Value::Obj(b)) if a == *b) {
        return None;
    }
    Some(match &vm.heap[id as usize].kind {
        Kind::Date(t) if t.is_finite() => Json::String(crate::builtins::date::iso_string(*t)),
        Kind::Url(u) => Json::String(u.url.as_str().to_owned()),
        _ => Json::Null,
    })
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
                        out.insert(vm.atoms.text(p.key).to_owned(), j);
                    }
                }
                Json::Object(out)
            }
        },
    })
}

// ---------- the result's walk ----------

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
    let id = start(vm, vec![v]);
    advance(vm, id, None)
}

/// Whether the reference's `$IsThenable` holds: a promise, or an object with a callable `then`.
fn thenable(vm: &mut Vm, v: &Value) -> bool {
    let Value::Obj(id) = v else { return false };
    match vm.heap[*id as usize].kind {
        Kind::Promise(_) => return true,
        Kind::Namespace(_) => return false,
        _ => {}
    }
    let then = vm.names.then;
    let t = vm.get_obj(*id, then);
    vm.is_callable(&t)
}

/// Makes a walk over `roots` as a heap object.
pub fn start(vm: &mut Vm, roots: Vec<Value>) -> Id {
    let n = roots.len();
    vm.alloc(Obj::new(
        None,
        Kind::Cross(Box::new(Cross {
            roots,
            crossed: Vec::with_capacity(n),
            stack: Vec::new(),
            ancestors: Vec::new(),
            waiting: Waiting::No,
            owed: false,
        })),
    ))
}

/// The settled value a walk awaited (`resumed`), or the walk's start: runs it until it awaits again or ends, then
/// hands its outcome to the run. At a `toJSON` it pushes a native frame that calls it and runs the rest of the walk
/// (`frame_step`). A waiting host call (`wait_async`) resumes here too, by the same reaction.
pub fn advance(vm: &mut Vm, id: Id, resumed: Option<Result<Value, Value>>) -> Result<(), Value> {
    if let (Kind::Array(_), Some(outcome)) = (&vm.heap[id as usize].kind, &resumed) {
        let outcome = *outcome;
        return resume_wait(vm, id, outcome);
    }
    let resume = match resumed {
        None => Resume::Start,
        Some(r) => Resume::Settled(r),
    };
    match walk(vm, id, resume)? {
        Walked::Await(awaited) => {
            wait(vm, id, awaited);
            Ok(())
        }
        Walked::Call(call) => enter_frame(vm, id, CALL, call).map(|_| ()),
        Walked::Done(outcome) => finish(vm, outcome),
    }
}

/// How a run of the walk starts: from where it is, with the settled value it awaited, or with what a `toJSON` it
/// called returned.
enum Resume {
    Start,
    Settled(Result<Value, Value>),
    Called(Value),
}

/// How far a run of the walk got.
enum Walked {
    /// It awaits this.
    Await(Value),
    /// It calls a `toJSON`: the function, its receiver and the key.
    Call([Value; 3]),
    /// It ended, with the result crossed or an error.
    Done(Result<Vec<Option<Json>>, Value>),
}

/// Runs the walk until it awaits, calls a `toJSON` or ends; only a fatal error is an `Err`.
fn walk(vm: &mut Vm, id: Id, resume: Resume) -> Result<Walked, Value> {
    let Kind::Cross(mut c) = std::mem::replace(&mut vm.heap[id as usize].kind, Kind::Ordinary)
    else {
        return Err(vm.type_error("The crossing is not running."));
    };
    let r = match resume {
        Resume::Settled(Err(e)) => Err(e),
        resume => step(vm, &mut c, resume),
    };
    match r {
        Ok(Pause::Await(awaited)) => {
            vm.heap[id as usize].kind = Kind::Cross(c);
            Ok(Walked::Await(awaited))
        }
        Ok(Pause::Call(call)) => {
            vm.heap[id as usize].kind = Kind::Cross(c);
            Ok(Walked::Call(call))
        }
        Ok(Pause::Done) => {
            let crossed = c.crossed.iter().map(|v| plain_json(vm, v)).collect();
            Ok(Walked::Done(Ok(crossed)))
        }
        Err(e) if vm.fatal.is_some() => Err(e),
        Err(e) => Ok(Walked::Done(Err(e))),
    }
}

/// `$vmResult`'s `await`: the walk resumes once `awaited` settles.
fn wait(vm: &mut Vm, id: Id, awaited: Value) {
    let p = vm.promise_resolve(awaited);
    vm.perform_then(p, Reaction::Cross(id));
}

// The slots of the walk's native frame: the walk, the `toJSON` call it makes (function, receiver, key), and where the
// frame is.
const F_CROSS: usize = 0;
const F_FN: usize = 1;
const F_THIS: usize = 2;
const F_KEY: usize = 3;
const F_PHASE: usize = 4;

/// Where the walk's frame is: about to call the `toJSON` in its slots, or waiting for a `toJSON` it called.
const CALL: usize = 0;
const CALLED: usize = 2;

/// Pushes a native frame that runs the walk `id` from `phase`.
fn enter_frame(vm: &mut Vm, id: Id, phase: usize, call: [Value; 3]) -> Res {
    vm.enter_native_with(
        crate::native::NativeOp::Callbacks,
        crate::builtins::object::SUB_CROSS,
        Value::Undef,
        Value::Undef,
        &[
            Value::Obj(id),
            call[0],
            call[1],
            call[2],
            Value::Num(phase as f64),
        ],
    )
}

/// The step of the walk's native frame: calls the `toJSON`s of the program the walk meets as bytecode calls them, so
/// they can park for a host call's wait and suspend, and hands each result back to the walk. A walk that awaits leaves the
/// rest to a job (`Reaction::Cross`).
pub(crate) fn frame_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let Value::Obj(id) = fr.get(vm, F_CROSS) else {
        return Ok(Step::Done(Value::Undef));
    };
    let phase = fr.index(vm, F_PHASE);
    let resume = match input {
        Input::Start if phase == CALL => return call_to_json(vm, fr),
        Input::Start => Resume::Start,
        Input::Returned(r) if phase == CALLED => Resume::Called(r.get()),
        Input::Returned(r) | Input::Finished(r) => Resume::Settled(Ok(r.get())),
        Input::Threw(e) => Resume::Settled(Err(e)),
    };
    match walk(vm, id, resume)? {
        Walked::Call(call) => {
            fr.set(vm, F_FN, call[0]);
            fr.set(vm, F_THIS, call[1]);
            fr.set(vm, F_KEY, call[2]);
            call_to_json(vm, fr)
        }
        Walked::Await(awaited) => {
            wait(vm, id, awaited);
            Ok(Step::Done(Value::Undef))
        }
        Walked::Done(outcome) => {
            finish(vm, outcome)?;
            Ok(Step::Done(Value::Undef))
        }
    }
}

/// Calls the `toJSON` in the frame's slots as bytecode calls it; what it throws comes back to the frame.
fn call_to_json(vm: &mut Vm, fr: crate::native::Frame) -> Result<crate::native::Step, Value> {
    fr.set_index(vm, F_PHASE, CALLED);
    let (f, this, key) = (fr.slot(vm, F_FN), fr.slot(vm, F_THIS), fr.slot(vm, F_KEY));
    fr.catching(vm, f, this, [key])
}

/// Asks the loop to park the frames of the waiting host call with the coroutine in its data, and costs nothing. A
/// snapshot names it with the host's natives (`host::snapshot_natives`): the heap may still hold one when the run
/// suspends.
pub(crate) fn park(vm: &mut Vm, _this: Value, _args: &[Value], callee: Id) -> Res {
    if let Kind::Native {
        data: Value::Num(c),
        ..
    } = vm.heap[callee as usize].kind
    {
        vm.park = true;
        vm.park_coroutine = c as u32;
    }
    vm.bytecode_builtin();
    Ok(Value::Undef)
}

fn finish(vm: &mut Vm, outcome: Result<Vec<Option<Json>>, Value>) -> Result<(), Value> {
    match outcome {
        Ok(mut json) => {
            vm.result_json = Some(json.pop().flatten().unwrap_or(Json::Null));
            vm.outcome = Some(Ok(Value::Undef));
        }
        Err(e) => vm.outcome = Some(Err(e)),
    }
    Ok(())
}

/// What a step of the walk does next.
enum Act {
    /// `$vmCross`'s loop over the roots, at its condition.
    Root,
    /// The innermost visit reads `holder[key]`.
    Read,
    /// The innermost visit has its value past the promise check.
    Value(Value),
    /// The innermost visit has its value past its `toJSON`.
    Classify(Value),
    /// The innermost visit returned this.
    Return(Value),
}

/// Where a run of the walk stopped.
enum Pause {
    /// It awaits this promise.
    Await(Value),
    /// The innermost visit calls a `toJSON` (function, receiver, key) and goes on with what it returns.
    Call([Value; 3]),
    /// Every root has crossed.
    Done,
}

/// Runs the walk until it pauses.
fn step(vm: &mut Vm, c: &mut Cross, resume: Resume) -> Result<Pause, Value> {
    let resumed = match resume {
        Resume::Called(v) => return run(vm, c, Act::Classify(v), false),
        Resume::Settled(r) => Some(r.unwrap_or_default()),
        Resume::Start => None,
    };
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

fn run(vm: &mut Vm, c: &mut Cross, mut act: Act, mut root_awaited: bool) -> Result<Pause, Value> {
    loop {
        act = match act {
            Act::Root => {
                let at = c.crossed.len();
                if at == c.roots.len() {
                    return Ok(Pause::Done);
                }
                let root = c.roots[at];
                if !root_awaited && thenable(vm, &root) {
                    c.waiting = Waiting::Root;
                    return Ok(Pause::Await(root));
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
                // `$Throw`, a native that throws and so costs nothing.
                if top.depth > WALK_DEPTH {
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
                    return Ok(Pause::Await(val));
                }
                Act::Value(val)
            }
            Act::Value(val) => {
                if let Value::Obj(_) = val {
                    let tj = vm.names.to_json;
                    let f = vm.get(&val, tj)?;
                    if vm.is_callable(&f) {
                        let key = c.stack.last().expect("visit").key;
                        return Ok(Pause::Call([f, val, key]));
                    }
                }
                Act::Classify(val)
            }
            Act::Classify(val) => match classify(vm, &val, &c.ancestors)? {
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
            },
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
}

// ---------- host-call arguments ----------

/// The error properties `toHost` leaves on a program's error.
pub(crate) fn uncrossed(key: &str) -> bool {
    matches!(
        key,
        "stack" | "message" | "constructor" | "toString" | "__proto__"
    )
}

/// The name a program's error has as the host's copy: its own `name`, or the name of an error type the host has, or
/// `Error`.
pub(crate) fn host_error_name(vm: &mut Vm, id: Id, name: String) -> String {
    let own = vm.has_own(id, vm.names.name);
    let known = matches!(
        name.as_str(),
        "TypeError"
            | "RangeError"
            | "SyntaxError"
            | "ReferenceError"
            | "EvalError"
            | "URIError"
            | "AggregateError"
    );
    if own || known { name } else { "Error".into() }
}

/// The objects `toHost` refuses: the interpreter's machinery, which is not data.
pub(crate) fn opaque(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::Namespace(_)
            | Kind::Promise(_)
            | Kind::Generator(_)
            | Kind::AsyncGenerator(_)
            | Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. }
            | Kind::IterHelper(_)
            | Kind::AsyncFromSync { .. }
            | Kind::Resolvers { .. }
            | Kind::Combinator(_)
            | Kind::Cross(_)
    )
}

// ---------- waiting host calls ----------

// A host call whose arguments hold promises that haven't fulfilled waits for each in turn, then calls its function
// again with the same arguments, which cross with their values now: the reference's `$vmHostWait`, an async function
// in its internal bytecode (`let i = 0; while (i < promises.length) { await promises[i]; i++ } return $Apply(callee,
// undefined, args)`). Each resumption is a job, and each turn of its loop a back-edge, as there.

/// The wait of an async or durable host function's call, whose promise `p` the
/// caller already holds: `p` takes on what the call made again gives, or the reason a promise rejected with. The
/// wait's state is an array no program sees, `[promises, index, callee, args, p]`, resumed by `Reaction::Cross`.
pub fn wait_async(vm: &mut Vm, promises: Vec<Value>, callee: Value, args: &[Value], p: Id) {
    let first = promises[0];
    let promises = vm.new_array(promises);
    let args = vm.new_array(args.to_vec());
    let Value::Obj(state) =
        vm.new_array(vec![promises, Value::Num(0.0), callee, args, Value::Obj(p)])
    else {
        return;
    };
    await_for(vm, state, first);
}

fn await_for(vm: &mut Vm, state: Id, v: Value) {
    let q = vm.promise_resolve(v);
    vm.perform_then(q, Reaction::Cross(state));
}

/// The awaited promise of an `async` host function's wait settled.
fn resume_wait(vm: &mut Vm, state: Id, outcome: Result<Value, Value>) -> Result<(), Value> {
    let item = |vm: &Vm, i: usize| match &vm.heap[state as usize].kind {
        Kind::Array(items) => items.get(i).copied().unwrap_or(Value::Undef),
        _ => Value::Undef,
    };
    let Value::Obj(p) = item(vm, 4) else {
        return Ok(());
    };
    if let Err(e) = outcome {
        vm.reject(p, e);
        return Ok(());
    }
    let next = match item(vm, 1) {
        Value::Num(n) => n as usize + 1,
        _ => 0,
    };
    // The wait loop's back-edge.
    vm.fuel_step();
    let promises = list(vm, item(vm, 0));
    if let Some(&awaited) = promises.get(next) {
        if let Kind::Array(items) = &mut vm.heap[state as usize].kind {
            items[1] = Value::Num(next as f64);
        }
        await_for(vm, state, awaited);
        return Ok(());
    }
    let (callee, args) = (item(vm, 2), list(vm, item(vm, 3)));
    let r = match &vm.heap[callee.as_obj().unwrap_or(0) as usize].kind {
        // A namespace function is called through its namespace, which costs the reference nothing.
        Kind::Namespace(_) => {
            crate::host::call_namespace(vm, callee.as_obj().unwrap_or(0), &args, callee)
        }
        _ => {
            let r = vm.call(&callee, Value::Undef, &args);
            vm.fuel(NATIVE_FUEL);
            r
        }
    };
    match r {
        Ok(v) => vm.resolve_promise(p, v),
        Err(e) if vm.fatal.is_some() => return Err(e),
        Err(e) => vm.reject(p, e),
    }
    Ok(())
}

fn list(vm: &Vm, v: Value) -> Vec<Value> {
    match v {
        Value::Obj(id) => match &vm.heap[id as usize].kind {
            Kind::Array(items) => items.clone(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// The wait of a synchronous host function's call: its call waits where it is, as
/// an `await` there would, parking the frames from the nearest async function up, and they go on with what the call
/// made again returns. A call native code made, whose frame it drives itself, cannot wait, nor one with a generator or
/// such a call in between.
pub fn wait_sync(vm: &mut Vm, promises: Vec<Value>, callee: Value, args: &[Value]) -> Res {
    let promises = vm.new_array(promises);
    let args = vm.new_array(args.to_vec());
    vm.enter_native_with(
        crate::native::NativeOp::Callbacks,
        crate::builtins::object::SUB_HOST_WAIT,
        Value::Undef,
        Value::Undef,
        &[
            promises,
            callee,
            args,
            Value::Num(0.0),
            Value::Num(0.0),
            Value::Num(0.0),
        ],
    )
}

/// Where the wait's frames park, from the wait's own frame on top: nowhere when native code drives that frame.
fn parks_with(vm: &mut Vm) -> Option<u32> {
    if vm.frames.last().is_none_or(|f| f.is_base) {
        return None;
    }
    vm.parkable()
}

#[cold]
fn cant_wait(vm: &mut Vm, callee: Value) -> Value {
    let name = match callee.as_obj() {
        Some(id) if vm.is_namespace(id) => vm.ns_label(&vm.ns_path(id)),
        _ => crate::host::function_name(vm, &callee),
    };
    let msg = format!(
        "{name}(...) can't wait for a promise in its arguments here, in a callback or a generator; await it first."
    );
    vm.invalid_data(&msg)
}

// The slots of a synchronous call's wait: the promises, the function and its arguments, the promise it waits for now,
// the coroutine its frames park with, and where it is.
const W_PROMISES: usize = 0;
const W_CALLEE: usize = 1;
const W_ARGS: usize = 2;
const W_INDEX: usize = 3;
const W_COROUTINE: usize = 4;
const W_PHASE: usize = 5;

/// Where a synchronous call's wait is: parked for a promise, or calling its function again.
const PARKED: usize = 1;
const RECALLED: usize = 2;

/// The step of a synchronous call's wait.
pub(crate) fn wait_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    match (input, fr.index(vm, W_PHASE)) {
        (Input::Start, _) => {
            // The call from bytecode costs its fifty once it has entered the wait, before the wait runs.
            if let Some(f) = vm.frames.last_mut()
                && f.argc & 1 != 0
            {
                f.argc &= !1;
                vm.fuel(NATIVE_FUEL);
            }
            let Some(c) = parks_with(vm) else {
                let callee = fr.get(vm, W_CALLEE);
                return Err(cant_wait(vm, callee));
            };
            fr.set_index(vm, W_COROUTINE, c as usize);
            park_for(vm, fr, 0)
        }
        (Input::Threw(e), PARKED) => Err(e),
        (Input::Returned(_) | Input::Finished(_), PARKED) => {
            let next = fr.index(vm, W_INDEX) + 1;
            // The wait loop's back-edge.
            vm.fuel_step();
            if next < list(vm, fr.get(vm, W_PROMISES)).len() {
                return park_for(vm, fr, next);
            }
            fr.set_index(vm, W_PHASE, RECALLED);
            let args = list(vm, fr.get(vm, W_ARGS));
            vm.stack.push(fr.slot(vm, W_CALLEE));
            vm.stack.push(Slot::UNDEF);
            vm.stack.extend(args.iter().map(|v| Slot::pack(*v)));
            vm.native_call(args.len())
        }
        (Input::Returned(r) | Input::Finished(r), _) => Ok(Step::Done(r.get())),
        (Input::Threw(e), _) => Err(e),
    }
}

/// Awaits the promise at `index`, parking the frames up to the nearest async function as an `await` does; what it
/// settles with comes back to this frame, a rejection through the handler.
fn park_for(
    vm: &mut Vm,
    fr: crate::native::Frame,
    index: usize,
) -> Result<crate::native::Step, Value> {
    let awaited = list(vm, fr.get(vm, W_PROMISES))
        .get(index)
        .copied()
        .unwrap_or(Value::Undef);
    let c = fr.index(vm, W_COROUTINE) as u32;
    fr.set_index(vm, W_INDEX, index);
    fr.set_index(vm, W_PHASE, PARKED);
    vm.await_value(awaited, c);
    let park = vm.native_fn("", 0, park, Value::Num(c as f64));
    fr.catching(vm, Slot::pack(park), Slot::UNDEF, [])
}
