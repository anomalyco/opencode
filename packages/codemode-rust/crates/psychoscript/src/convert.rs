//! Crossing the host boundary as JSON copies, `JSON.stringify`/`JSON.parse`, and console formatting.

use std::fmt::Write as _;

use crate::object::*;
use crate::strings::{external_text, has_mark, host_text};
use crate::value::{Id, Value, write_num};
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
            if let Some(mode) = mode
                && !mode.walk
                && !native_to_json(vm, &f)
            {
                mode.restart.set(true);
                return Ok(Value::Undef);
            }
            let kv = key_value(vm, key);
            return if mode.is_some_and(|m| m.walk) {
                vm.call_counted(&f, *v, &[kv])
            } else {
                vm.call(&f, *v, &[kv])
            };
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
/// `REVISITS` visits of objects it has seen already need. The native walk stops (`restart`) at the first value that
/// needs the other, before it calls anything, and the stringify starts over as that walk.
struct Mode {
    walk: bool,
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
    fn new(vm: &mut Vm, walk: bool) -> Self {
        Self {
            walk,
            restart: std::cell::Cell::new(false),
            stamp: if walk {
                0
            } else {
                vm.start_json_walk().unwrap_or(0)
            },
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

pub fn stringify(vm: &mut Vm, v: &Value, opts: &Stringify) -> Result<Option<String>, Value> {
    let walk = opts.replacer_fn.is_some() || opts.allow.is_some();
    if !walk {
        let mode = Mode::new(vm, false);
        let out = stringify_in(vm, v, opts, &mode);
        mode.end(vm);
        let out = out?;
        if !mode.restart.get() {
            return Ok(out);
        }
    }
    // The internal walk, after `JSON.stringify`'s own call: `$vmJsonVisitor`, the root `visit` generator and its
    // first `next`; each value then costs what `visit` spends (see `builtins/fuel.rs`).
    vm.fuel(crate::vm::NATIVE_FUEL);
    vm.fuel(1);
    vm.fuel(1);
    vm.fuel(crate::vm::NATIVE_FUEL);
    let mode = Mode::new(vm, true);
    let out = stringify_in(vm, v, opts, &mode)?;
    vm.bytecode_builtin();
    Ok(out)
}

fn stringify_in(
    vm: &mut Vm,
    v: &Value,
    opts: &Stringify,
    mode: &Mode,
) -> Result<Option<String>, Value> {
    let mut out = String::new();
    let mut stack = Vec::new();
    let holder = vm.new_object();
    let empty = vm.atoms.intern_static("");
    vm.define(holder, empty, *v);
    let ok = write_json(
        vm,
        &mut out,
        Value::Obj(holder),
        Key::Empty,
        *v,
        opts,
        mode,
        &mut stack,
        "",
    )?;
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

#[allow(clippy::too_many_arguments)]
fn write_json(
    vm: &mut Vm,
    out: &mut String,
    holder: Value,
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
    // Every value is checked, a primitive too: the native walk stops past depth 32, the internal walk past 100
    // (`$Throw` in its `visit`, a native that throws and so costs nothing).
    let depth = stack.len();
    if mode.walk && depth > 100 {
        return Err(vm.range_error("Value exceeds the maximum depth of 100."));
    }
    if !mode.walk && depth > 32 {
        return Err(vm.range_error("Value exceeds the maximum depth of 32."));
    }
    if !mode.walk
        && let Value::Obj(id) = v
        && mode.revisited(vm, id)
    {
        mode.restart.set(true);
        return Ok(false);
    }
    let mut v = apply_to_json(vm, &v, key, Some(mode))?;
    if let Some(f) = &opts.replacer_fn {
        let kv = key_value(vm, key);
        v = vm.call_counted(f, holder, &[kv, v])?;
    }
    if crate::builtins::exotic::may_have_json_forms(vm) {
        let headers =
            matches!(v, Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Headers(_)));
        v = crate::builtins::exotic::json_value(vm, &v, false)?;
        // Headers are JSON of their own in the reference, a record of their entries: neither the replacer nor the
        // walk reaches inside, though a property list still picks among them.
        if headers {
            let plain = Stringify {
                indent: opts.indent.clone(),
                replacer_fn: None,
                allow: opts.allow.clone(),
            };
            let mode = Mode::new(vm, false);
            let r = write_json(vm, out, holder, key, v, &plain, &mode, stack, gap);
            mode.end(vm);
            return r;
        }
    }
    match &v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Num(n) => {
            if n.is_finite() {
                write_num(out, *n);
            } else {
                out.push_str("null");
            }
        }
        Value::Str(s) => quote_str(vm, out, *s),
        Value::Undef | Value::Uninit | Value::Sym(_) => return Ok(false),
        Value::Obj(id) => {
            let id = *id;
            if vm.heap[id as usize].is_callable() {
                return Ok(false);
            }
            if matches!(vm.heap[id as usize].kind, Kind::Promise(_)) {
                if !mode.walk {
                    mode.restart.set(true);
                    return Ok(false);
                }
                return Err(vm.type_error("Cannot serialize a promise; await it first"));
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
                        let item = match &vm.heap[id as usize].kind {
                            Kind::Array(items) => match items.get(i) {
                                Some(Value::Uninit) | None => Value::Undef,
                                Some(v) => *v,
                            },
                            _ => Value::Undef,
                        };
                        if mode.walk {
                            // `String(i)`, the child `visit` generator, `yield*` opening it and its `next`.
                            vm.fuel(crate::vm::NATIVE_FUEL);
                            vm.fuel(1);
                            vm.fuel(crate::vm::NATIVE_FUEL);
                            vm.fuel(crate::vm::NATIVE_FUEL);
                        }
                        if !write_json(
                            vm,
                            out,
                            Value::Obj(id),
                            Key::Index(i),
                            item,
                            opts,
                            mode,
                            stack,
                            &inner,
                        )? {
                            out.push_str("null");
                        }
                        if mode.walk {
                            vm.fuel(1);
                        }
                    }
                    if !opts.indent.is_empty() {
                        out.push('\n');
                        out.push_str(gap);
                    }
                    out.push(']');
                }
            } else {
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
                let entries: Vec<(Atom, Value)> = match &opts.allow {
                    Some(allow) => allow
                        .iter()
                        .filter_map(|k| entries.iter().find(|(e, _)| e == k).cloned())
                        .collect(),
                    None => entries,
                };
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
                    if mode.walk {
                        vm.fuel(1);
                        vm.fuel(crate::vm::NATIVE_FUEL);
                        vm.fuel(crate::vm::NATIVE_FUEL);
                    }
                    if write_json(
                        vm,
                        out,
                        Value::Obj(id),
                        Key::Atom(k),
                        val,
                        opts,
                        mode,
                        stack,
                        &inner,
                    )? {
                        first = false;
                        if mode.walk {
                            // `$Define` of the property.
                            vm.fuel(crate::vm::NATIVE_FUEL);
                        }
                    } else {
                        out.truncate(mark);
                    }
                    if mode.walk {
                        vm.fuel(1);
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
