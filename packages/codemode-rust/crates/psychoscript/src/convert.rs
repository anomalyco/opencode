//! Crossing the host boundary as JSON copies, `JSON.stringify`/`JSON.parse`, and console formatting.

use std::fmt::Write as _;

use crate::object::*;
use crate::strings::{external_text, has_mark, host_text};
use crate::value::{Id, Slot, Value, write_num};
use crate::vm::{Res, Vm};
use crate::{DiagnosticKind, Json};

pub const MAX_VALUE_DEPTH: usize = 32;

/// A string as the host gets it; only a carrier needs converting.
pub(crate) fn host_string(vm: &Vm, s: crate::strings::StrId) -> String {
    if vm.atoms.is_wtf(s) {
        return host_text(vm.text(s)).into_owned();
    }
    vm.text(s).to_owned()
}

/// Host JSON as a fresh program value.
pub fn from_json(vm: &mut Vm, j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) if has_mark(s) => vm.string_val(external_text(s.clone())),
        Json::String(s) => vm.str_val(s),
        Json::Array(items) => {
            let vals = items.iter().map(|i| from_json(vm, i)).collect();
            vm.new_array(vals)
        }
        Json::Object(map) => {
            let id = vm.new_object();
            for (k, v) in map {
                let val = from_json(vm, v);
                let a = if has_mark(k) {
                    vm.atoms.intern(&external_text(k.clone()))
                } else {
                    vm.atoms.intern(k)
                };
                vm.define(id, a, val);
            }
            Value::Obj(id)
        }
    }
}

pub(crate) fn json_number(n: f64) -> Json {
    if n.fract() == 0.0 && n.abs() < 9.2e18 {
        return Json::from(n as i64);
    }
    serde_json::Number::from_f64(n)
        .map(Json::Number)
        .unwrap_or(Json::Null)
}

/// A program value as the host sees it: what `JSON.stringify` would serialize, plus the boundary table.
pub fn to_json(vm: &mut Vm, v: &Value) -> Result<Json, Value> {
    let mut stack = Vec::new();
    Ok(to_json_inner(vm, v, Key::Empty, &mut stack)?.unwrap_or(Json::Null))
}

fn to_json_inner(
    vm: &mut Vm,
    v: &Value,
    key: Key,
    stack: &mut Vec<Id>,
) -> Result<Option<Json>, Value> {
    let v = apply_to_json(vm, v, key, None)?;
    let v = crate::builtins::exotic::json_value(vm, &v, true)?;
    Ok(Some(match &v {
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::Num(n) => json_number(*n),
        Value::Str(s) => Json::String(host_string(vm, *s)),
        Value::Undef | Value::Uninit | Value::Sym(_) => return Ok(None),
        Value::Obj(id) => {
            let id = *id;
            if vm.heap[id as usize].is_callable() {
                return Ok(None);
            }
            if stack.contains(&id) {
                return Err(vm.type_error("Converting circular structure to JSON"));
            }
            if stack.len() >= MAX_VALUE_DEPTH {
                return Err(invalid_data(vm, "Data is nested more than 32 levels deep."));
            }
            stack.push(id);
            vm.densify(id)?;
            let out = match &vm.heap[id as usize].kind {
                Kind::Array(items) => {
                    let items = items.clone();
                    let mut out = Vec::with_capacity(items.len());
                    for (i, item) in items.iter().enumerate() {
                        out.push(
                            to_json_inner(vm, item, Key::Index(i), stack)?.unwrap_or(Json::Null),
                        );
                    }
                    Json::Array(out)
                }
                Kind::Set(m) => {
                    let items: Vec<Value> = m.entries.iter().flatten().map(|(k, _)| *k).collect();
                    let mut out = Vec::with_capacity(items.len());
                    for (i, item) in items.iter().enumerate() {
                        out.push(
                            to_json_inner(vm, item, Key::Index(i), stack)?.unwrap_or(Json::Null),
                        );
                    }
                    Json::Array(out)
                }
                Kind::Error(_) => {
                    let mut map = serde_json::Map::new();
                    let (name, message) = error_parts(vm, id);
                    map.insert("name".into(), Json::String(host_text(&name).into_owned()));
                    map.insert(
                        "message".into(),
                        Json::String(host_text(&message).into_owned()),
                    );
                    for (k, val) in vm.own_entries(id) {
                        let ks = host_text(vm.atoms.text(k)).into_owned();
                        if ks == "__proto__" || ks == "name" || ks == "message" {
                            continue;
                        }
                        if let Some(j) = to_json_inner(vm, &val, Key::Atom(k), stack)? {
                            map.insert(ks, j);
                        }
                    }
                    Json::Object(map)
                }
                Kind::Ordinary | Kind::Arguments(_) | Kind::Live(_) => {
                    let mut map = serde_json::Map::new();
                    for (k, val) in vm.own_entries(id) {
                        if vm.atoms.text(k) == "__proto__" {
                            continue;
                        }
                        if let Some(j) = to_json_inner(vm, &val, Key::Atom(k), stack)? {
                            map.insert(host_string(vm, vm.atoms.atom_str(k)), j);
                        }
                    }
                    Json::Object(map)
                }
                _ => Json::Object(serde_json::Map::new()),
            };
            stack.pop();
            out
        }
    }))
}

fn invalid_data(vm: &mut Vm, msg: &str) -> Value {
    let p = vm.realm.type_error_proto;
    vm.failure(p, msg, DiagnosticKind::InvalidDataValue)
}

/// The key a value is serialized under, materialized only when a `toJSON` or replacer needs it.
#[derive(Clone, Copy)]
pub enum Key {
    Empty,
    Index(usize),
    Atom(Atom),
}

fn key_value(vm: &mut Vm, key: Key) -> Value {
    match key {
        Key::Empty => vm.static_str(""),
        Key::Index(i) => vm.string_val(i.to_string()),
        Key::Atom(a) => vm.atom_val(a),
    }
}

fn apply_to_json(vm: &mut Vm, v: &Value, key: Key, mode: Option<&Mode>) -> Res {
    if let Value::Obj(id) = v
        && !matches!(
            vm.heap[*id as usize].kind,
            Kind::Promise(_)
                | Kind::Closure(_)
                | Kind::Native { .. }
                | Kind::Bound(_)
                | Kind::ToolRef(_)
        )
    {
        let k = vm.names.to_json;
        let f = vm.get_obj(*id, k);
        if vm.is_callable(&f) {
            // The native walk calls only Date's and URL's own; any other makes it start over as the internal walk.
            if let Some(mode) = mode
                && !native_to_json(vm, &f)
            {
                mode.restart.set(true);
                return Ok(Value::Undef);
            }
            let kv = key_value(vm, key);
            return vm.call(&f, *v, &[kv]);
        }
    }
    Ok(*v)
}

pub fn error_parts(vm: &mut Vm, id: Id) -> (String, String) {
    let (nk, mk) = (vm.names.name, vm.names.message);
    let name = match vm.get_obj(id, nk) {
        Value::Undef => "Error".to_owned(),
        v => vm
            .string_of(&v)
            .map(|s| vm.text(s).to_owned())
            .unwrap_or_default(),
    };
    let message = match vm.get_obj(id, mk) {
        Value::Undef => String::new(),
        v => vm
            .string_of(&v)
            .map(|s| vm.text(s).to_owned())
            .unwrap_or_default(),
    };
    (name, message)
}

/// `Error.prototype.toString`.
pub fn error_to_string(vm: &mut Vm, id: Id) -> String {
    let (name, message) = error_parts(vm, id);
    if message.is_empty() {
        return name;
    }
    if name.is_empty() {
        return message;
    }
    format!("{name}: {message}")
}

// ---------- JSON.stringify ----------

pub struct Stringify {
    pub indent: String,
    pub replacer_fn: Option<Value>,
    pub allow: Option<Vec<Atom>>,
}

/// How `JSON.stringify` runs in the reference, for its fuel: a native walk, or its internal bytecode walk
/// (`$vmJsonWalk`), which a replacer, a property list, a `toJSON` other than Date's and URL's, a promise, or more than
/// `REVISITS` visits of objects it has seen already need. The native walk (`write_json`, which calls no program code)
/// stops (`restart`) at the first value that needs the other, before it calls anything, and the stringify starts over
/// as that walk, which runs in a native frame (`stringify_step`).
struct Mode {
    restart: std::cell::Cell<bool>,
    /// The stamp of a native walk (see `Vm::start_json_walk`); one nested in another keeps the objects it has seen.
    stamp: u32,
    seen: std::cell::RefCell<rustc_hash::FxHashSet<Id>>,
    revisits: std::cell::Cell<u32>,
}

/// The visits of objects seen already the reference's native walk allows (its `VISIT_BUDGET`): it gives up at the
/// last.
const REVISITS: u32 = 2048;

impl Mode {
    fn new(vm: &mut Vm) -> Self {
        Self {
            restart: std::cell::Cell::new(false),
            stamp: vm.start_json_walk().unwrap_or(0),
            seen: Default::default(),
            revisits: std::cell::Cell::new(REVISITS),
        }
    }

    /// Counts a native walk's visit of `id`; whether the walk gives up there. A function is not counted, and a promise
    /// makes the walk give up anyway.
    #[inline(always)]
    fn revisited(&self, vm: &mut Vm, id: Id) -> bool {
        let first = if self.stamp != 0 {
            let o = &mut vm.heap[id as usize];
            std::mem::replace(&mut o.visit, self.stamp) != self.stamp
        } else {
            self.seen.borrow_mut().insert(id)
        };
        if first
            || vm.heap[id as usize].is_callable()
            || matches!(vm.heap[id as usize].kind, Kind::Promise(_))
        {
            return false;
        }
        let left = self.revisits.get() - 1;
        self.revisits.set(left);
        left == 0
    }

    /// Ends the walk, so another native walk may stamp objects.
    fn end(&self, vm: &mut Vm) {
        if self.stamp != 0 {
            vm.json_walk = 0;
        }
    }
}

/// `JSON.stringify` on the reference's native walk: its result (`None` for undefined), or `None` when it needs the
/// internal walk (`enter_stringify`).
pub fn stringify(
    vm: &mut Vm,
    v: &Value,
    opts: &Stringify,
) -> Result<Option<Option<String>>, Value> {
    if opts.replacer_fn.is_some() || opts.allow.is_some() {
        return Ok(None);
    }
    let mode = Mode::new(vm);
    let out = stringify_in(vm, v, opts, &mode);
    mode.end(vm);
    let out = out?;
    Ok(if mode.restart.get() { None } else { Some(out) })
}

fn stringify_in(
    vm: &mut Vm,
    v: &Value,
    opts: &Stringify,
    mode: &Mode,
) -> Result<Option<String>, Value> {
    let mut out = String::new();
    let mut stack = Vec::new();
    // The holder `{ "": v }` the reference makes, though nothing here reads it.
    let holder = vm.new_object();
    let empty = vm.atoms.intern_static("");
    vm.define(holder, empty, *v);
    let ok = write_json(vm, &mut out, Key::Empty, *v, opts, mode, &mut stack, "")?;
    Ok(if ok { Some(out) } else { None })
}

/// Whether `f` is Date's or URL's own `toJSON`, which the reference's native walk applies itself.
fn native_to_json(vm: &mut Vm, f: &Value) -> bool {
    let k = vm.names.to_json;
    let (date, url) = (vm.realm.std.date, vm.realm.std.url);
    [date, url]
        .into_iter()
        .filter(|p| *p != 0)
        .any(|p| matches!((vm.get_obj(p, k), f), (Value::Obj(a), Value::Obj(b)) if a == *b))
}

/// The native walk: writes `v` (`holder[key]`) and says whether it wrote anything.
#[allow(clippy::too_many_arguments)]
fn write_json(
    vm: &mut Vm,
    out: &mut String,
    key: Key,
    v: Value,
    opts: &Stringify,
    mode: &Mode,
    stack: &mut Vec<Id>,
    gap: &str,
) -> Result<bool, Value> {
    if mode.restart.get() {
        return Ok(false);
    }
    // Every value is checked, a primitive too: the native walk stops past depth 32.
    if stack.len() > 32 {
        return Err(vm.range_error("Value exceeds the maximum depth of 32."));
    }
    if let Value::Obj(id) = v
        && mode.revisited(vm, id)
    {
        mode.restart.set(true);
        return Ok(false);
    }
    let mut v = apply_to_json(vm, &v, key, Some(mode))?;
    if crate::builtins::exotic::may_have_json_forms(vm) {
        let headers =
            matches!(v, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Headers(_)));
        v = crate::builtins::exotic::json_value(vm, &v, false)?;
        // Headers are JSON of their own in the reference, a record of their entries: neither the replacer nor the
        // walk reaches inside, though a property list still picks among them.
        if headers {
            let mode = Mode::new(vm);
            let r = write_json(vm, out, key, v, opts, &mode, stack, gap);
            mode.end(vm);
            return r;
        }
    }
    match &v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Num(n) => write_number(out, *n),
        Value::Str(s) => quote_str(vm, out, *s),
        Value::Undef | Value::Uninit | Value::Sym(_) => return Ok(false),
        Value::Obj(id) => {
            let id = *id;
            if vm.heap[id as usize].is_callable() {
                return Ok(false);
            }
            if matches!(vm.heap[id as usize].kind, Kind::Promise(_)) {
                mode.restart.set(true);
                return Ok(false);
            }
            if stack.contains(&id) {
                return Err(vm.type_error("Converting circular structure to JSON"));
            }
            if stack.len() > 512 {
                return Err(vm.range_error("Maximum call stack size exceeded"));
            }
            stack.push(id);
            let inner = format!("{gap}{}", opts.indent);
            let is_array = matches!(vm.heap[id as usize].kind, Kind::Array(_));
            if is_array {
                vm.densify(id)?;
                let len = match &vm.heap[id as usize].kind {
                    Kind::Array(items) => items.len(),
                    _ => 0,
                };
                if len == 0 {
                    out.push_str("[]");
                } else {
                    out.push('[');
                    for i in 0..len {
                        if i > 0 {
                            out.push(',');
                        }
                        if !opts.indent.is_empty() {
                            out.push('\n');
                            out.push_str(&inner);
                        }
                        let item = array_item(vm, id, i);
                        if !write_json(vm, out, Key::Index(i), item, opts, mode, stack, &inner)? {
                            out.push_str("null");
                        }
                    }
                    if !opts.indent.is_empty() {
                        out.push('\n');
                        out.push_str(gap);
                    }
                    out.push(']');
                }
            } else {
                let entries = json_entries(vm, id, opts.allow.as_deref());
                out.push('{');
                let mut first = true;
                for (k, val) in entries {
                    let mark = out.len();
                    if !first {
                        out.push(',');
                    }
                    if !opts.indent.is_empty() {
                        out.push('\n');
                        out.push_str(&inner);
                    }
                    quote_str(vm, out, vm.atoms.atom_str(k));
                    out.push(':');
                    if !opts.indent.is_empty() {
                        out.push(' ');
                    }
                    if write_json(vm, out, Key::Atom(k), val, opts, mode, stack, &inner)? {
                        first = false;
                    } else {
                        out.truncate(mark);
                    }
                }
                if !first && !opts.indent.is_empty() {
                    out.push('\n');
                    out.push_str(gap);
                }
                out.push('}');
            }
            stack.pop();
        }
    }
    if out.len() > crate::ops::MAX_STRING_LEN {
        return Err(vm.range_error("Invalid string length"));
    }
    Ok(true)
}

#[inline(always)]
fn write_number(out: &mut String, n: f64) {
    if n.is_finite() {
        write_num(out, n);
    } else {
        out.push_str("null");
    }
}

/// The element at `i` of the dense array `id`, a hole as undefined.
#[inline(always)]
fn array_item(vm: &Vm, id: Id, i: usize) -> Value {
    match &vm.heap[id as usize].kind {
        Kind::Array(items) => match items.get(i) {
            Some(Value::Uninit) | None => Value::Undef,
            Some(v) => *v,
        },
        _ => Value::Undef,
    }
}

/// The properties an object serializes, in order: an error's name and message first, then its own entries; only the
/// listed ones, in the list's order, when there is a property list.
fn json_entries(vm: &mut Vm, id: Id, allow: Option<&[Atom]>) -> Vec<(Atom, Value)> {
    let entries: Vec<(Atom, Value)> = match &vm.heap[id as usize].kind {
        Kind::Error(_) => {
            let (name, message) = error_parts(vm, id);
            let (nk, mk) = (vm.names.name, vm.names.message);
            let (name, message) = (vm.string_val(name), vm.string_val(message));
            let mut e = vec![(nk, name), (mk, message)];
            e.extend(
                vm.own_entries(id)
                    .into_iter()
                    .filter(|(k, _)| *k != nk && *k != mk),
            );
            e
        }
        Kind::Ordinary | Kind::Arguments(_) | Kind::Live(_) => vm.own_entries(id),
        _ => Vec::new(),
    };
    match allow {
        Some(allow) => allow
            .iter()
            .filter_map(|k| entries.iter().find(|(e, _)| e == k).cloned())
            .collect(),
        None => entries,
    }
}

// ---------- JSON.stringify's internal walk ----------

/// A key as the walk keeps it in its slots: its atom.
fn atom_slot(a: Atom) -> Value {
    Value::Num(a as f64)
}

/// The reference's `$JsonNames` off the host boundary, as atoms: an error's name and message first, then the own keys.
fn walk_keys(vm: &mut Vm, id: Id) -> Vec<Value> {
    let (nk, mk) = (vm.names.name, vm.names.message);
    match vm.heap[id as usize].kind {
        Kind::Error(_) => [nk, mk]
            .into_iter()
            .chain(vm.own_keys(id).into_iter().filter(|k| *k != nk && *k != mk))
            .map(atom_slot)
            .collect(),
        Kind::Ordinary | Kind::Arguments(_) | Kind::Live(_) => {
            vm.own_keys(id).into_iter().map(atom_slot).collect()
        }
        _ => Vec::new(),
    }
}

// The slots of the internal walk's frame: the replacer (or undefined), the property list (an internal array of its
// keys' atoms, or undefined), the indent (undefined for none), the output written before the last call (an internal
// byte buffer, or undefined), and how many containers deep the walk is; then the value it visits (`holder[key]`, the
// key a number for an array's element, the value read once the visit starts), what the call it waits on is for, and
// the key's atom off an array; then, per container, the container, its keys' atoms (an internal array, undefined for
// an array), how many children it has, the next one, and whether none was written yet.
const J_F: usize = 0;
const J_ALLOW: usize = 1;
const J_INDENT: usize = 2;
const J_OUT: usize = 3;
const J_DEPTH: usize = 4;
const J_HOLDER: usize = 5;
const J_KEY: usize = 6;
const J_VAL: usize = 7;
const J_PHASE: usize = 8;
const J_ATOM: usize = 9;
const J_LEVELS: usize = 10;
const LEVEL: usize = 5;
const L_ID: usize = 0;
const L_KEYS: usize = 1;
const L_N: usize = 2;
const L_I: usize = 3;
const L_FIRST: usize = 4;

/// What the walk's call returns to: the value's `toJSON`, or the replacer.
const TO_JSON: usize = 0;
const REPLACED: usize = 1;

/// Where a step of the internal walk is.
#[derive(Clone, Copy)]
enum Stage {
    /// The value's depth check and `toJSON`.
    Visit,
    /// The replacer.
    Replace,
    /// Writing the value, or entering it.
    Emit,
    /// The innermost container goes on to its next child, or ends.
    Child,
    /// A value was visited, written or not; its container goes on.
    After(bool),
}

/// Pushes the frame of `JSON.stringify`'s internal walk over `v`, after `JSON.stringify`'s own call: `$vmJsonVisitor`,
/// the root `visit` generator and its first `next`. Each value then costs what `visit` spends (see `builtins/fuel.rs`).
pub fn enter_stringify(vm: &mut Vm, callee: Id, v: Value, opts: Stringify) -> Res {
    vm.fuel(crate::vm::NATIVE_FUEL);
    vm.fuel(1);
    vm.fuel(1);
    vm.fuel(crate::vm::NATIVE_FUEL);
    let holder = vm.new_object();
    let empty = vm.atoms.intern_static("");
    vm.define(holder, empty, v);
    let allow = match opts.allow {
        Some(allow) => {
            let keys = allow.into_iter().map(atom_slot).collect();
            vm.new_array(keys)
        }
        None => Value::Undef,
    };
    let indent = if opts.indent.is_empty() {
        Value::Undef
    } else {
        vm.string_val(opts.indent)
    };
    let key = vm.atom_val(empty);
    let slots = [
        opts.replacer_fn.unwrap_or_default(),
        allow,
        indent,
        Value::Undef,
        Value::Num(0.0),
        Value::Obj(holder),
        key,
        Value::Undef,
        Value::Num(0.0),
        atom_slot(empty),
    ];
    vm.enter_native_sub(
        crate::native::NativeOp::Callbacks,
        crate::builtins::object::SUB_STRINGIFY,
        callee,
        Value::Undef,
        &slots,
    )
}

/// The step of the internal walk: it writes what it can, and keeps what it wrote in its slots before each call of a
/// `toJSON` or the replacer. A key and its separator are written only once the value under it is known to be written,
/// so nothing written has to be taken back.
pub(crate) fn stringify_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let indent = match fr.get(vm, J_INDENT) {
        Value::Str(s) => vm.text(s).to_owned(),
        _ => String::new(),
    };
    let mut out = String::with_capacity(256);
    let mut stage = match input {
        Input::Start => Stage::Visit,
        Input::Returned(r) => {
            fr.set_slot(vm, J_VAL, r);
            if fr.index(vm, J_PHASE) == TO_JSON {
                Stage::Replace
            } else {
                Stage::Emit
            }
        }
        Input::Threw(e) => return Err(e),
        Input::Finished(_) => return Ok(Step::Done(Value::Undef)),
    };
    loop {
        let depth = fr.index(vm, J_DEPTH);
        stage = match stage {
            Stage::Visit => {
                // `$Throw` in `visit`, a native that throws and so costs nothing.
                if depth > 100 {
                    return Err(vm.range_error("Value exceeds the maximum depth of 100."));
                }
                // `holder[key]`, read as the walk reaches it.
                let (holder, key) = (fr.get(vm, J_HOLDER), fr.get(vm, J_KEY));
                let v = match key {
                    Value::Num(_) => vm.get_elem(&holder, &key)?,
                    _ => vm.get(&holder, fr.index(vm, J_ATOM) as Atom)?,
                };
                if matches!(v, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Promise(_)))
                {
                    return Err(vm.invalid_data(
                        "JSON.stringify received an un-awaited Promise; await it first - e.g. `const result = await \
                         tools.ns.tool(...)`.",
                    ));
                }
                fr.set(vm, J_VAL, v);
                if let Value::Obj(id) = v
                    && !matches!(
                        vm.heap[id as usize].kind,
                        Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) | Kind::ToolRef(_)
                    )
                {
                    let k = vm.names.to_json;
                    let f = vm.get_obj(id, k);
                    if vm.is_callable(&f) {
                        let kv = walk_key(vm, fr);
                        flush(vm, fr, &mut out);
                        fr.set_index(vm, J_PHASE, TO_JSON);
                        return fr.call_slots(vm, Slot::pack(f), Slot::pack(v), [Slot::pack(kv)]);
                    }
                }
                Stage::Replace
            }
            Stage::Replace => {
                let f = fr.slot(vm, J_F);
                if f.obj().is_none() {
                    Stage::Emit
                } else {
                    let kv = walk_key(vm, fr);
                    flush(vm, fr, &mut out);
                    fr.set_index(vm, J_PHASE, REPLACED);
                    let (holder, v) = (fr.slot(vm, J_HOLDER), fr.slot(vm, J_VAL));
                    return fr.call_slots(vm, f, holder, [Slot::pack(kv), v]);
                }
            }
            Stage::Emit => emit(vm, fr, &mut out, &indent, depth)?,
            Stage::Child => child(vm, fr, &mut out, &indent, depth)?,
            Stage::After(written) => {
                if depth == 0 {
                    let buf = fr.get(vm, J_OUT).as_obj();
                    let text = match buf.map(|b| &mut vm.heap[b as usize].kind) {
                        Some(Kind::Bytes(b)) => {
                            let mut bytes = std::mem::take(&mut *b.buf.borrow_mut());
                            b.len = 0;
                            bytes.extend_from_slice(out.as_bytes());
                            // Only whole strings were written to it.
                            String::from_utf8(bytes).unwrap_or_default()
                        }
                        _ => out,
                    };
                    vm.bytecode_builtin();
                    return Ok(Step::Done(if written {
                        vm.string_val(text)
                    } else {
                        Value::Undef
                    }));
                }
                let at = J_LEVELS + (depth - 1) * LEVEL;
                if fr.slot(vm, at + L_KEYS).obj().is_none() {
                    if !written {
                        out.push_str("null");
                    }
                } else if written {
                    fr.set_index(vm, at + L_FIRST, 0);
                    // `$Define` of the property.
                    vm.fuel(crate::vm::NATIVE_FUEL);
                }
                vm.fuel(1);
                let i = fr.index(vm, at + L_I);
                fr.set_index(vm, at + L_I, i + 1);
                Stage::Child
            }
        };
    }
}

/// The key of the value the walk visits, as a `toJSON` or the replacer receives it.
fn walk_key(vm: &mut Vm, fr: crate::native::Frame) -> Value {
    match fr.get(vm, J_KEY) {
        Value::Num(i) => vm.string_val((i as usize).to_string()),
        k => k,
    }
}

/// Keeps what the step wrote in the frame's slots, before a call: in a byte buffer the frame owns.
fn flush(vm: &mut Vm, fr: crate::native::Frame, out: &mut String) {
    if out.is_empty() {
        return;
    }
    let buf = match fr.get(vm, J_OUT).as_obj() {
        Some(b) => b,
        None => {
            let bytes = crate::builtins::bytes::Bytes::new(Vec::new(), false);
            let b = vm.alloc(Obj::new(None, Kind::Bytes(Box::new(bytes))));
            fr.set(vm, J_OUT, Value::Obj(b));
            b
        }
    };
    if let Kind::Bytes(b) = &mut vm.heap[buf as usize].kind {
        b.buf.borrow_mut().extend_from_slice(out.as_bytes());
        b.len += out.len();
    }
    out.clear();
}

/// How much the walk wrote before the last call.
fn flushed(vm: &Vm, fr: crate::native::Frame) -> usize {
    match fr
        .get(vm, J_OUT)
        .as_obj()
        .map(|b| &vm.heap[b as usize].kind)
    {
        Some(Kind::Bytes(b)) => b.len,
        _ => 0,
    }
}

/// The length check after each value written, on all the walk has written.
fn check_length(vm: &mut Vm, fr: crate::native::Frame, out: &str) -> Result<(), Value> {
    if flushed(vm, fr) + out.len() > crate::ops::MAX_STRING_LEN {
        return Err(vm.range_error("Invalid string length"));
    }
    Ok(())
}

/// A new line indented `depth` times.
fn write_indent(out: &mut String, indent: &str, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str(indent);
    }
}

/// Writes what goes before a value in an object: the separator, the indent, the key and the colon.
fn write_prefix(vm: &Vm, fr: crate::native::Frame, out: &mut String, indent: &str, depth: usize) {
    if depth == 0 {
        return;
    }
    let at = J_LEVELS + (depth - 1) * LEVEL;
    if fr.slot(vm, at + L_KEYS).obj().is_none() {
        return;
    }
    if fr.index(vm, at + L_FIRST) == 0 {
        out.push(',');
    }
    if !indent.is_empty() {
        write_indent(out, indent, depth);
    }
    if let Value::Str(k) = fr.get(vm, J_KEY) {
        quote_str(vm, out, k);
    }
    out.push(':');
    if !indent.is_empty() {
        out.push(' ');
    }
}

/// The value the walk visits, after its `toJSON` and the replacer: written, or entered when it is a container.
fn emit(
    vm: &mut Vm,
    fr: crate::native::Frame,
    out: &mut String,
    indent: &str,
    depth: usize,
) -> Result<Stage, Value> {
    let mut v = fr.get(vm, J_VAL);
    if crate::builtins::exotic::may_have_json_forms(vm) {
        let headers =
            matches!(v, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Headers(_)));
        v = crate::builtins::exotic::json_value(vm, &v, false)?;
        // Headers are JSON of their own in the reference, a record of their entries: neither the replacer nor the
        // walk reaches inside, though a property list still picks among them. They are written on the native walk.
        if headers {
            return emit_headers(vm, fr, out, indent, depth, v);
        }
    }
    match v {
        Value::Null => out_value(vm, fr, out, indent, depth, |_, out| out.push_str("null")),
        Value::Bool(b) => out_value(vm, fr, out, indent, depth, |_, out| {
            out.push_str(if b { "true" } else { "false" })
        }),
        Value::Num(n) => out_value(vm, fr, out, indent, depth, |_, out| write_number(out, n)),
        Value::Str(s) => out_value(vm, fr, out, indent, depth, |vm, out| quote_str(vm, out, s)),
        Value::Undef | Value::Uninit => Ok(Stage::After(false)),
        // `$JsonSpecial` of a value that is not an object: an empty object.
        Value::Sym(_) => out_value(vm, fr, out, indent, depth, |_, out| out.push_str("{}")),
        Value::Obj(id) => {
            if vm.heap[id as usize].is_callable() {
                return Ok(Stage::After(false));
            }
            if (0..depth).any(|d| fr.slot(vm, J_LEVELS + d * LEVEL + L_ID).obj() == Some(id)) {
                return Err(vm.type_error("Converting circular structure to JSON."));
            }
            write_prefix(vm, fr, out, indent, depth);
            let (keys, n) = if matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
                vm.densify(id)?;
                let len = match &vm.heap[id as usize].kind {
                    Kind::Array(items) => items.len(),
                    _ => 0,
                };
                if len == 0 {
                    out.push_str("[]");
                    check_length(vm, fr, out)?;
                    return Ok(Stage::After(true));
                }
                out.push('[');
                (Value::Undef, len)
            } else {
                let keys = walk_keys(vm, id);
                // The property list holds atoms, as the keys do.
                let keys: Vec<Value> = match fr.get(vm, J_ALLOW).as_obj() {
                    Some(allow) => match &vm.heap[allow as usize].kind {
                        Kind::Array(listed) => listed
                            .iter()
                            .filter(|k| {
                                keys.iter().any(
                                    |e| matches!((e, k), (Value::Num(a), Value::Num(b)) if a == b),
                                )
                            })
                            .copied()
                            .collect(),
                        _ => Vec::new(),
                    },
                    None => keys,
                };
                let n = keys.len();
                out.push('{');
                (vm.new_array(keys), n)
            };
            vm.stack.extend(
                [
                    Value::Obj(id),
                    keys,
                    Value::Num(n as f64),
                    Value::Num(0.0),
                    Value::Num(1.0),
                ]
                .map(Slot::pack),
            );
            fr.set_index(vm, J_DEPTH, depth + 1);
            Ok(Stage::Child)
        }
    }
}

/// Writes a primitive the walk visits.
fn out_value(
    vm: &mut Vm,
    fr: crate::native::Frame,
    out: &mut String,
    indent: &str,
    depth: usize,
    write: impl FnOnce(&Vm, &mut String),
) -> Result<Stage, Value> {
    write_prefix(vm, fr, out, indent, depth);
    write(vm, out);
    check_length(vm, fr, out)?;
    Ok(Stage::After(true))
}

/// The property list's keys.
fn allow_list(vm: &mut Vm, fr: crate::native::Frame) -> Option<Vec<Atom>> {
    let id = fr.get(vm, J_ALLOW).as_obj()?;
    let keys = match &vm.heap[id as usize].kind {
        Kind::Array(items) => items.clone(),
        _ => Vec::new(),
    };
    Some(
        keys.iter()
            .filter_map(|k| match k {
                Value::Num(a) => Some(*a as Atom),
                _ => None,
            })
            .collect(),
    )
}

/// Headers the walk visits, as the record of entries `json_value` made of them, written on the native walk.
fn emit_headers(
    vm: &mut Vm,
    fr: crate::native::Frame,
    out: &mut String,
    indent: &str,
    depth: usize,
    v: Value,
) -> Result<Stage, Value> {
    let mark = out.len();
    write_prefix(vm, fr, out, indent, depth);
    let plain = Stringify {
        indent: indent.to_owned(),
        replacer_fn: None,
        allow: allow_list(vm, fr),
    };
    let mut stack: Vec<Id> = (0..depth)
        .map(|d| fr.slot(vm, J_LEVELS + d * LEVEL + L_ID).obj().unwrap_or(0))
        .collect();
    let mode = Mode::new(vm);
    let r = write_json(
        vm,
        out,
        Key::Empty,
        v,
        &plain,
        &mode,
        &mut stack,
        &indent.repeat(depth),
    );
    mode.end(vm);
    if !r? {
        out.truncate(mark);
        return Ok(Stage::After(false));
    }
    check_length(vm, fr, out)?;
    Ok(Stage::After(true))
}

/// The innermost container's next child, as its loop in `visit` opens it, or the container's end.
fn child(
    vm: &mut Vm,
    fr: crate::native::Frame,
    out: &mut String,
    indent: &str,
    depth: usize,
) -> Result<Stage, Value> {
    let at = J_LEVELS + (depth - 1) * LEVEL;
    let id = fr.slot(vm, at + L_ID).obj().unwrap_or(0);
    let (i, n) = (fr.index(vm, at + L_I), fr.index(vm, at + L_N));
    let keys = fr.slot(vm, at + L_KEYS).obj();
    if i >= n {
        if !indent.is_empty() && (keys.is_none() || fr.index(vm, at + L_FIRST) == 0) {
            write_indent(out, indent, depth - 1);
        }
        out.push(if keys.is_none() { ']' } else { '}' });
        vm.stack.truncate(fr.base() + at);
        fr.set_index(vm, J_DEPTH, depth - 1);
        check_length(vm, fr, out)?;
        return Ok(Stage::After(true));
    }
    let key = match keys {
        None => {
            if i > 0 {
                out.push(',');
            }
            if !indent.is_empty() {
                write_indent(out, indent, depth);
            }
            // `String(i)`, the child `visit` generator, `yield*` opening it and its `next`.
            vm.fuel(crate::vm::NATIVE_FUEL);
            vm.fuel(1);
            vm.fuel(crate::vm::NATIVE_FUEL);
            vm.fuel(crate::vm::NATIVE_FUEL);
            Value::Num(i as f64)
        }
        Some(keys) => {
            vm.fuel(1);
            vm.fuel(crate::vm::NATIVE_FUEL);
            vm.fuel(crate::vm::NATIVE_FUEL);
            let atom = match &vm.heap[keys as usize].kind {
                Kind::Array(items) => items.get(i).map_or(0, |a| a.as_num() as Atom),
                _ => 0,
            };
            fr.set(vm, J_ATOM, atom_slot(atom));
            vm.atom_val(atom)
        }
    };
    fr.set(vm, J_HOLDER, Value::Obj(id));
    fr.set(vm, J_KEY, key);
    Ok(Stage::Visit)
}

/// Quotes text as JSON.stringify does, checking it for a carrier first.
pub fn quote(out: &mut String, s: &str) {
    if crate::strings::has_mark(s) {
        return quote_units(out, s);
    }
    quote_plain(out, s);
}

/// Quotes a run's string, whose carrier flag says how.
#[inline]
fn quote_str(vm: &Vm, out: &mut String, s: crate::strings::StrId) {
    if vm.atoms.is_wtf(s) {
        quote_units(out, vm.text(s));
    } else {
        quote_plain(out, vm.text(s));
    }
}

/// Quotes text that is not a carrier.
#[inline(always)]
fn quote_plain(out: &mut String, s: &str) {
    out.push('"');
    let bytes = s.as_bytes();
    let mut start = 0;
    for (i, &b) in bytes.iter().enumerate() {
        let esc = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x08 => "\\b",
            0x0c => "\\f",
            0..=0x1f => "",
            _ => continue,
        };
        out.push_str(&s[start..i]);
        if esc.is_empty() {
            let _ = write!(out, "\\u{:04x}", b);
        } else {
            out.push_str(esc);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

/// `quote` for a carrier text: a lone surrogate is written as a `\\u` escape, as well-formed JSON.stringify does.
#[cold]
#[inline(never)]
fn quote_units(out: &mut String, s: &str) {
    out.push('"');
    for r in char::decode_utf16(crate::strings::units_of(s)) {
        match r {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\r') => out.push_str("\\r"),
            Ok('\t') => out.push_str("\\t"),
            Ok('\u{8}') => out.push_str("\\b"),
            Ok('\u{c}') => out.push_str("\\f"),
            Ok(c) if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            Ok(c) => crate::strings::push_char(out, c),
            Err(e) => {
                let _ = write!(out, "\\u{:04x}", e.unpaired_surrogate());
            }
        }
    }
    out.push('"');
}

// ---------- JSON.parse ----------

struct Parser<'s> {
    s: &'s [u8],
    text: &'s str,
    i: usize,
    depth: usize,
}

pub fn parse(vm: &mut Vm, text: &str) -> Res {
    let mut p = Parser {
        s: text.as_bytes(),
        text,
        i: 0,
        depth: 0,
    };
    p.ws();
    let v = p.value(vm)?;
    p.ws();
    if p.i < p.s.len() {
        return Err(p.error(vm));
    }
    Ok(v)
}

impl<'s> Parser<'s> {
    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn error(&self, vm: &mut Vm) -> Value {
        let msg = if self.i >= self.s.len() {
            "Unexpected end of JSON input".to_owned()
        } else {
            let c = self.text[self.i..].chars().next().unwrap_or(' ');
            format!(
                "Unexpected token '{c}', \"{}\" is not valid JSON",
                truncate(self.text, 30)
            )
        };
        vm.syntax_error(&msg)
    }

    fn value(&mut self, vm: &mut Vm) -> Res {
        let Some(&c) = self.s.get(self.i) else {
            return Err(self.error(vm));
        };
        match c {
            b'{' => {
                self.depth += 1;
                if self.depth > 512 {
                    return Err(vm.range_error("Maximum call stack size exceeded"));
                }
                self.i += 1;
                let id = vm.new_object();
                self.ws();
                if self.s.get(self.i) == Some(&b'}') {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(Value::Obj(id));
                }
                loop {
                    self.ws();
                    if self.s.get(self.i) != Some(&b'"') {
                        return Err(self.error(vm));
                    }
                    let k = self.string(vm)?;
                    self.ws();
                    if self.s.get(self.i) != Some(&b':') {
                        return Err(self.error(vm));
                    }
                    self.i += 1;
                    self.ws();
                    let v = self.value(vm)?;
                    let a = vm.atoms.intern(&k);
                    vm.define(id, a, v);
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            self.depth -= 1;
                            return Ok(Value::Obj(id));
                        }
                        _ => return Err(self.error(vm)),
                    }
                }
            }
            b'[' => {
                self.depth += 1;
                if self.depth > 512 {
                    return Err(vm.range_error("Maximum call stack size exceeded"));
                }
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.s.get(self.i) == Some(&b']') {
                    self.i += 1;
                    self.depth -= 1;
                    return Ok(vm.new_array(items));
                }
                loop {
                    self.ws();
                    items.push(self.value(vm)?);
                    self.ws();
                    match self.s.get(self.i) {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            self.depth -= 1;
                            return Ok(vm.new_array(items));
                        }
                        _ => return Err(self.error(vm)),
                    }
                }
            }
            b'"' => {
                let s = self.string(vm)?;
                Ok(vm.string_val(s))
            }
            b't' if self.s[self.i..].starts_with(b"true") => {
                self.i += 4;
                Ok(Value::Bool(true))
            }
            b'f' if self.s[self.i..].starts_with(b"false") => {
                self.i += 5;
                Ok(Value::Bool(false))
            }
            b'n' if self.s[self.i..].starts_with(b"null") => {
                self.i += 4;
                Ok(Value::Null)
            }
            b'-' | b'0'..=b'9' => {
                let start = self.i;
                if self.s[self.i] == b'-' {
                    self.i += 1;
                }
                let int_start = self.i;
                while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                    self.i += 1;
                }
                if self.i == int_start || (self.s[int_start] == b'0' && self.i - int_start > 1) {
                    return Err(self.error(vm));
                }
                if self.s.get(self.i) == Some(&b'.') {
                    self.i += 1;
                    let f = self.i;
                    while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                        self.i += 1;
                    }
                    if self.i == f {
                        return Err(self.error(vm));
                    }
                }
                if matches!(self.s.get(self.i), Some(b'e' | b'E')) {
                    self.i += 1;
                    if matches!(self.s.get(self.i), Some(b'+' | b'-')) {
                        self.i += 1;
                    }
                    let e = self.i;
                    while self.i < self.s.len() && self.s[self.i].is_ascii_digit() {
                        self.i += 1;
                    }
                    if self.i == e {
                        return Err(self.error(vm));
                    }
                }
                Ok(Value::Num(
                    self.text[start..self.i].parse().unwrap_or(f64::NAN),
                ))
            }
            _ => Err(self.error(vm)),
        }
    }

    fn string(&mut self, vm: &mut Vm) -> Result<String, Value> {
        self.i += 1;
        let mut out = String::new();
        let mut start = self.i;
        loop {
            let Some(&c) = self.s.get(self.i) else {
                return Err(self.error(vm));
            };
            match c {
                b'"' => {
                    out.push_str(&self.text[start..self.i]);
                    self.i += 1;
                    return Ok(out);
                }
                b'\\' => {
                    out.push_str(&self.text[start..self.i]);
                    self.i += 1;
                    let Some(&e) = self.s.get(self.i) else {
                        return Err(self.error(vm));
                    };
                    self.i += 1;
                    match e {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\u{8}'),
                        b'f' => out.push('\u{c}'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let mut units = vec![self.hex4(vm)?];
                            while (0xd800..0xdc00).contains(units.last().unwrap_or(&0))
                                && self.s.get(self.i) == Some(&b'\\')
                                && self.s.get(self.i + 1) == Some(&b'u')
                            {
                                self.i += 2;
                                units.push(self.hex4(vm)?);
                            }
                            out.push_str(&crate::strings::from_units(&units));
                        }
                        _ => {
                            self.i -= 1;
                            return Err(self.error(vm));
                        }
                    }
                    start = self.i;
                }
                0..=0x1f => return Err(self.error(vm)),
                _ => self.i += 1,
            }
        }
    }

    fn hex4(&mut self, vm: &mut Vm) -> Result<u16, Value> {
        let h = self
            .text
            .get(self.i..self.i + 4)
            .and_then(|h| u16::from_str_radix(h, 16).ok());
        match h {
            Some(v) => {
                self.i += 4;
                Ok(v)
            }
            None => Err(self.error(vm)),
        }
    }
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_owned()
    } else {
        format!("{}...", s.chars().take(n).collect::<String>())
    }
}

// ---------- console ----------

/// One value as `console.log` shows it.
pub fn format_value(vm: &mut Vm, v: &Value) -> String {
    match v {
        Value::Undef | Value::Uninit => "undefined".into(),
        Value::Str(s) => vm.text(*s).to_owned(),
        _ => {
            let mut out = String::new();
            let mut seen = Vec::new();
            format_inner(vm, &mut out, v, &mut seen);
            out
        }
    }
}

fn format_inner(vm: &mut Vm, out: &mut String, v: &Value, seen: &mut Vec<Id>) {
    match v {
        Value::Undef | Value::Uninit | Value::Null => out.push_str("null"),
        Value::Str(s) => quote_str(vm, out, *s),
        Value::Num(n) => write_num(out, *n),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Sym(s) => out.push_str(vm.atoms.text(*s)),
        Value::Obj(id) => {
            let id = *id;
            if seen.len() > MAX_VALUE_DEPTH {
                out.push_str("...");
                return;
            }
            if seen.contains(&id) {
                out.push_str("[Circular]");
                return;
            }
            seen.push(id);
            match &vm.heap[id as usize].kind {
                Kind::Array(items) => {
                    let items = items.clone();
                    let _ = vm.densify(id);
                    let items = match &vm.heap[id as usize].kind {
                        Kind::Array(dense) if dense.len() != items.len() => dense.clone(),
                        _ => items,
                    };
                    out.push('[');
                    for (i, item) in items.iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        // A hole prints as nothing, as in an array literal.
                        if !matches!(item, Value::Uninit) {
                            format_inner(vm, out, item, seen);
                        }
                    }
                    // An array too long to lay out shows the elements it starts with.
                    if vm.heap[id as usize].flags & SPARSE != 0 {
                        out.push_str(",…");
                    }
                    out.push(']');
                }
                Kind::Ordinary | Kind::Arguments(_) | Kind::Live(_) => {
                    out.push('{');
                    for (i, (k, val)) in vm.own_entries(id).into_iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        quote_str(vm, out, vm.atoms.atom_str(k));
                        out.push(':');
                        format_inner(vm, out, &val, seen);
                    }
                    out.push('}');
                }
                Kind::Error(_) => {
                    let s = error_to_string(vm, id);
                    out.push_str(&s);
                }
                Kind::Map(m) | Kind::Set(m) => {
                    let is_set = matches!(vm.heap[id as usize].kind, Kind::Set(_));
                    let entries: Vec<(Value, Value)> =
                        m.entries.iter().flatten().cloned().collect();
                    let _ = write!(
                        out,
                        "{}({}) [",
                        if is_set { "Set" } else { "Map" },
                        entries.len()
                    );
                    for (i, (k, val)) in entries.iter().enumerate() {
                        if i > 0 {
                            out.push(',');
                        }
                        if is_set {
                            format_inner(vm, out, k, seen);
                        } else {
                            out.push('[');
                            format_inner(vm, out, k, seen);
                            out.push(',');
                            format_inner(vm, out, val, seen);
                            out.push(']');
                        }
                    }
                    out.push(']');
                }
                Kind::Promise(_) => out.push_str("[Promise (await it to get its value)]"),
                _ => match crate::builtins::exotic::inspect(vm, id) {
                    Some(s) => out.push_str(&s),
                    None => out.push_str("[opaque reference]"),
                },
            }
            seen.pop();
        }
    }
}
