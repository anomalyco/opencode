//! Crossing the host boundary as JSON copies, `JSON.stringify`/`JSON.parse`, and console formatting.

use std::fmt::Write as _;

use crate::object::*;

use crate::value::{Id, Slot, Value, write_num};
use crate::vm::{Res, Vm};
use crate::{DiagnosticKind, Json};

pub const MAX_VALUE_DEPTH: usize = 32;

/// A string of the result as run text (a carrier keeps unpaired surrogates: see `strings`), which `Data` decodes
/// once the result has crossed.
pub(crate) fn host_string(vm: &Vm, s: crate::strings::StrId) -> String {
    vm.text(s).to_owned()
}

/// Host data as a fresh program value, its strings exactly as the host gave them.
pub fn from_data(vm: &mut Vm, d: &crate::Data) -> Value {
    use crate::Data;
    match d {
        Data::Null => Value::Null,
        Data::Bool(b) => Value::Bool(*b),
        Data::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
        Data::String(s) => vm.string_val(s.to_run_text()),
        Data::Array(items) => {
            let vals = items.iter().map(|i| from_data(vm, i)).collect();
            vm.new_array(vals)
        }
        Data::Object(fields) => {
            let id = vm.new_object();
            for (k, v) in fields {
                let val = from_data(vm, v);
                let a = vm.atoms.intern(&k.to_run_text());
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
                    map.insert("name".into(), Json::String(name));
                    map.insert("message".into(), Json::String(message));
                    for (k, val) in vm.own_entries(id) {
                        let ks = vm.atoms.text(k).to_owned();
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
                | Kind::Namespace(_)
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
        v => vm.quiet_string(&v),
    };
    let message = match vm.get_obj(id, mk) {
        Value::Undef => String::new(),
        v => vm.quiet_string(&v),
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
        // The reference's walk takes a symbol for an object with no fields.
        Value::Sym(_) => out.push_str("{}"),
        Value::Undef | Value::Uninit => return Ok(false),
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
    if n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        write_int(out, n);
    } else if n.is_finite() {
        write_num(out, n);
    } else {
        out.push_str("null");
    }
}

/// Writes a safe integer as `write_num` does, without the formatting machinery.
fn write_int(out: &mut String, n: f64) {
    if n < 0.0 {
        out.push('-');
    }
    out.push_str(digits(&mut [0; 20], n.abs() as u64));
}

/// The decimal digits of `n`, written into `buf`.
fn digits(buf: &mut [u8; 20], n: u64) -> &str {
    let mut rest = n;
    let mut at = buf.len();
    loop {
        at -= 1;
        buf[at] = b'0' + (rest % 10) as u8;
        rest /= 10;
        if rest == 0 {
            break;
        }
    }
    std::str::from_utf8(&buf[at..]).unwrap_or_default()
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

/// Pushes the reference's `$JsonNames` off the host boundary as atoms (an error's name and message first, then the own
/// keys), or with a property list the listed ones it has, in the list's order: how many.
fn push_walk_keys(vm: &mut Vm, id: Id, allow: Option<Id>) -> usize {
    let (nk, mk) = (vm.names.name, vm.names.message);
    let start = vm.stack.len();
    match vm.heap[id as usize].kind {
        Kind::Error(_) => {
            let rest = vm.own_keys(id).into_iter().filter(|k| *k != nk && *k != mk);
            let keys: Vec<Atom> = [nk, mk].into_iter().chain(rest).collect();
            vm.stack.extend(keys.into_iter().map(key_slot));
        }
        Kind::Ordinary => {
            // Without index keys, the own keys are the enumerable string-keyed properties in their order.
            let props = &vm.heap[id as usize].props.items;
            if props.iter().all(|p| vm.atoms.index(p.key).is_none()) {
                vm.stack.extend(
                    props
                        .iter()
                        .filter(|p| p.flags & ENUMERABLE != 0 && p.key > SYM_ASYNC_ITERATOR)
                        .map(|p| key_slot(p.key)),
                );
            } else {
                let keys = vm.own_keys(id);
                vm.stack.extend(keys.into_iter().map(key_slot));
            }
        }
        Kind::Arguments(_) | Kind::Live(_) => {
            let keys = vm.own_keys(id);
            vm.stack.extend(keys.into_iter().map(key_slot));
        }
        _ => {}
    }
    // The property list holds atoms, as the keys do.
    if let Some(allow) = allow {
        let own = vm.stack.split_off(start);
        if let Kind::Array(listed) = &vm.heap[allow as usize].kind {
            vm.stack.extend(
                listed
                    .iter()
                    .map(|k| Slot::pack(*k))
                    .filter(|k| own.contains(k)),
            );
        }
    }
    vm.stack.len() - start
}

/// A key's atom as the walk's slots keep it.
fn key_slot(a: Atom) -> Slot {
    Slot::index(a as usize)
}

// The slots of the internal walk's frame: the replacer (or undefined), the property list (an internal array of its
// keys' atoms, or undefined), the indent (undefined for none), the output written before the last call (an internal
// byte buffer, or undefined), and how many containers deep the walk is; then the value it visits (`holder[key]`, the
// key a number for an array's element, the value read once the visit starts), what the call it waits on is for, and
// the key's atom off an array; then, per container, an object's keys' atoms, then the container, whether it is an
// object (undefined for an array), how many children it has, the next one, and whether none was written yet. The
// innermost container's slots are the top of the frame's stack whenever a step runs.
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
const LEVEL: usize = 5;
const L_ID: usize = 0;
const L_OBJECT: usize = 1;
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
    // The text a step writes before it keeps it in the frame's buffer; its capacity is reused by the next step, as a
    // replacer makes a step per value.
    thread_local! {
        static SCRATCH: std::cell::Cell<String> = const { std::cell::Cell::new(String::new()) };
    }
    let mut out = SCRATCH.take();
    let r = stringify_walk(vm, fr, input, &mut out);
    out.clear();
    SCRATCH.set(out);
    r
}

fn stringify_walk(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
    out: &mut String,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let indent = match fr.get(vm, J_INDENT) {
        Value::Str(s) => vm.text(s).to_owned(),
        _ => String::new(),
    };
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
                    _ => {
                        let atom = fr.index(vm, J_ATOM) as Atom;
                        match plain_prop(vm, fr, holder, atom, depth) {
                            Some(v) => v,
                            None => vm.get(&holder, atom)?,
                        }
                    }
                };
                if matches!(v, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Promise(_)))
                {
                    return Err(vm.invalid_data(
                        "JSON.stringify received an un-awaited Promise; await it first - e.g. `const result = await \
                         load(...)`.",
                    ));
                }
                fr.set(vm, J_VAL, v);
                if let Value::Obj(id) = v
                    && !matches!(
                        vm.heap[id as usize].kind,
                        Kind::Closure(_)
                            | Kind::Native { .. }
                            | Kind::Bound(_)
                            | Kind::Namespace(_)
                    )
                {
                    let k = vm.names.to_json;
                    let f = vm.get_obj(id, k);
                    if vm.is_callable(&f) {
                        let kv = walk_key(vm, fr);
                        flush(vm, fr, out);
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
                    flush(vm, fr, out);
                    fr.set_index(vm, J_PHASE, REPLACED);
                    let (holder, v) = (fr.slot(vm, J_HOLDER), fr.slot(vm, J_VAL));
                    return fr.call_slots(vm, f, holder, [Slot::pack(kv), v]);
                }
            }
            Stage::Emit => emit(vm, fr, out, &indent, depth)?,
            Stage::Child => child(vm, fr, out, &indent, depth)?,
            Stage::After(written) => {
                if depth == 0 {
                    let buf = fr.get(vm, J_OUT).as_obj();
                    let text = match buf.map(|b| &mut vm.heap[b as usize].kind) {
                        Some(Kind::Bytes(b)) => {
                            let mut bytes = std::mem::take(&mut *b.bytes());
                            b.len = 0;
                            bytes.extend_from_slice(out.as_bytes());
                            // Only whole strings were written to it.
                            String::from_utf8(bytes).unwrap_or_default()
                        }
                        _ => std::mem::take(out),
                    };
                    vm.bytecode_builtin();
                    return Ok(Step::Done(if written {
                        vm.string_val(text)
                    } else {
                        Value::Undef
                    }));
                }
                let at = top(vm, fr);
                if fr.slot(vm, at + L_OBJECT) == Slot::UNDEF {
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

/// Where the innermost container's slots start in the frame: at the top of its stack.
#[inline(always)]
fn top(vm: &Vm, fr: crate::native::Frame) -> usize {
    vm.stack.len() - fr.base() - LEVEL
}

/// The containers the walk is in, innermost first, off the frame's stack.
fn open_containers(stack: &[Slot], depth: usize) -> impl Iterator<Item = Id> + '_ {
    let mut end = stack.len();
    (0..depth).map(move |_| {
        let at = end - LEVEL;
        let keys = if stack[at + L_OBJECT] == Slot::UNDEF {
            0
        } else {
            stack[at + L_N].f() as usize
        };
        end = at - keys;
        stack[at + L_ID].obj().unwrap_or(0)
    })
}

/// `holder[atom]` for an ordinary object whose own property at the child's position is that key's plain value, as
/// it is when every own key serializes: the read without a search.
#[inline(always)]
fn plain_prop(
    vm: &Vm,
    fr: crate::native::Frame,
    holder: Value,
    atom: Atom,
    depth: usize,
) -> Option<Value> {
    let Value::Obj(id) = holder else {
        return None;
    };
    let o = &vm.heap[id as usize];
    if depth == 0 || !matches!(o.kind, Kind::Ordinary) {
        return None;
    }
    let p = o.props.items.get(fr.index(vm, top(vm, fr) + L_I))?;
    (p.key == atom && !matches!(p.value, Value::Uninit)).then_some(p.value)
}

/// The key of the value the walk visits, as a `toJSON` or the replacer receives it.
fn walk_key(vm: &mut Vm, fr: crate::native::Frame) -> Value {
    match fr.get(vm, J_KEY) {
        // An index's string, interned: an array's keys repeat from one array to the next.
        Value::Num(i) => vm.static_str(digits(&mut [0; 20], i as u64)),
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
        b.bytes().extend_from_slice(out.as_bytes());
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
    let at = top(vm, fr);
    if fr.slot(vm, at + L_OBJECT) == Slot::UNDEF {
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
            if open_containers(&vm.stack, depth).any(|c| c == id) {
                return Err(vm.type_error("Converting circular structure to JSON."));
            }
            write_prefix(vm, fr, out, indent, depth);
            let (object, n) = if matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
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
                (Slot::UNDEF, len)
            } else {
                let allow = fr.slot(vm, J_ALLOW).obj();
                let n = push_walk_keys(vm, id, allow);
                out.push('{');
                (Slot::index(1), n)
            };
            vm.stack.extend_from_slice(&[
                Slot::pack(Value::Obj(id)),
                object,
                Slot::index(n),
                Slot::index(0),
                Slot::index(1),
            ]);
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
    let mut stack: Vec<Id> = open_containers(&vm.stack, depth).collect();
    stack.reverse();
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
    let at = top(vm, fr);
    let id = fr.slot(vm, at + L_ID).obj().unwrap_or(0);
    let (i, n) = (fr.index(vm, at + L_I), fr.index(vm, at + L_N));
    let object = fr.slot(vm, at + L_OBJECT) != Slot::UNDEF;
    if i >= n {
        if !indent.is_empty() && (!object || fr.index(vm, at + L_FIRST) == 0) {
            write_indent(out, indent, depth - 1);
        }
        out.push(if object { '}' } else { ']' });
        vm.stack
            .truncate(fr.base() + at - if object { n } else { 0 });
        fr.set_index(vm, J_DEPTH, depth - 1);
        check_length(vm, fr, out)?;
        return Ok(Stage::After(true));
    }
    let key = match object {
        false => {
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
        true => {
            vm.fuel(1);
            vm.fuel(crate::vm::NATIVE_FUEL);
            vm.fuel(crate::vm::NATIVE_FUEL);
            let atom = fr.index(vm, at - n + i) as Atom;
            fr.set_index(vm, J_ATOM, atom as usize);
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

    /// The reference's `JSON.parse` passes on its host runtime's message.
    fn error(&self, vm: &mut Vm) -> Value {
        let why = crate::streaming::json_parse_error(self.text);
        vm.syntax_error(&format!("JSON.parse received invalid JSON: {why}"))
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
        Value::Sym(s) => out.push_str(crate::ops::symbol_text(*s)),
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

/// Whether a value holds what is not data, at any depth: a function, a promise, a namespace, an iterator, or a built-in
/// object such as a Map or a Date. The reference's `containsRuntimeReference`, which keeps a thrown value's internals
/// out of a run's failure.
pub fn holds_runtime_reference(vm: &Vm, v: &Value) -> bool {
    let mut seen = Vec::new();
    let mut pending = vec![*v];
    while let Some(v) = pending.pop() {
        let Value::Obj(id) = v else {
            continue;
        };
        if seen.contains(&id) {
            continue;
        }
        seen.push(id);
        let o = &vm.heap[id as usize];
        match &o.kind {
            Kind::Ordinary => {}
            Kind::Array(items) | Kind::Arguments(items) => pending.extend(items.iter().copied()),
            _ => return true,
        }
        pending.extend(o.props.items.iter().map(|p| p.value));
    }
    false
}
