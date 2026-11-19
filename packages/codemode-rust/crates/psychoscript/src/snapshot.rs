//! Saving a run's state as plain data and restoring it into a fresh VM, the counterpart of the reference's
//! `src/snapshot*`.
//!
//! - **Code is never saved.** A snapshot keeps the program's source; restoring compiles it again and refuses it when
//!   the bytecode differs, so a pc always means the same instruction.
//! - **Built-ins are saved by position.** A fresh run makes the same objects, strings and host globals in the same
//!   order before the program starts (the base). Only base objects the run changed are saved, and everything made
//!   after the base is saved whole.
//! - **Natives are named** by their index in a table of every native the VM can make, built once per process.
//! - **Host calls in flight** are saved by kind: an idempotent call as queued, to run again with the same key; a
//!   started durable call with its data, to wait on again. Any other one in flight refuses the suspend.

use std::collections::VecDeque;
use std::fmt;
use std::sync::Arc;
use std::sync::OnceLock;

use rustc_hash::FxHashMap;
use serde_json::{Value as J, json};

use crate::host::{self, CallKind, Callee, FnEntry, ResultRoot, Settled, Settlement};
use crate::host_function::{HostError, HostFunction, HostValue};
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::{
    Coroutine, Frame, FrameKind, Handler, Job, NativeFn, Reaction, Resume, SavedFrame, Vm,
};
use crate::{DiagnosticKind, Json, Limits};

/// Bumped whenever the shape of saved state changes.
pub const FORMAT: u64 = 1;

/// A run's saved state: plain JSON, with a `header` that says where it can resume.
#[derive(Clone, Debug, PartialEq)]
pub struct Snapshot(pub Json);

/// The state as bytes, to store or send.
pub fn to_bytes(state: &Snapshot) -> Vec<u8> {
    serde_json::to_vec(&state.0).unwrap_or_default()
}

/// A state read back from [`to_bytes`].
pub fn from_bytes(bytes: &[u8]) -> Result<Snapshot, SnapshotError> {
    serde_json::from_slice(bytes)
        .map(Snapshot)
        .map_err(|e| SnapshotError::new(format!("Invalid snapshot: {e}.")))
}

/// Why a state cannot resume here: another build, other host globals, a changed source, or malformed data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotError {
    pub message: String,
}

impl SnapshotError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SnapshotError {}

fn invalid(message: impl fmt::Display) -> SnapshotError {
    SnapshotError::new(format!("Invalid snapshot: {message}"))
}

type R<T> = Result<T, SnapshotError>;

/// What a fresh run has made before its program starts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Base {
    pub heap: usize,
    pub bufs: usize,
    pub atoms: usize,
    pub cells: usize,
    pub functions: usize,
}

impl Base {
    pub fn of(vm: &Vm) -> Base {
        let (bufs, atoms) = vm.atoms.counts();
        Base {
            heap: vm.heap.len(),
            bufs,
            atoms,
            cells: vm.cells.len(),
            functions: vm.host.functions.len(),
        }
    }

    fn json(&self) -> J {
        json!([self.heap, self.bufs, self.atoms, self.cells, self.functions])
    }
}

// ---------- the native table ----------

struct Natives {
    list: Vec<NativeFn>,
    index: FxHashMap<usize, u32>,
    /// Identifies what a fresh VM makes, for the build id.
    shape: u64,
}

fn natives() -> &'static Natives {
    static TABLE: OnceLock<Natives> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut vm = Vm::new(
            host::RunHost::bare(),
            Limits::default(),
            crate::strings::Strings::new(),
        );
        vm.setup();
        let base = vm.heap.len();
        for bit in 0..8 {
            crate::builtins::ensure(&mut vm, 1 << bit);
        }
        let mut list: Vec<NativeFn> = Vec::new();
        list.extend(host::snapshot_natives());
        list.extend(crate::promise::snapshot_natives());
        for o in &vm.heap {
            if let Kind::Native { f, .. } = &o.kind {
                list.push(*f);
            }
        }
        let mut index = FxHashMap::default();
        let mut unique = Vec::new();
        for f in list {
            if let std::collections::hash_map::Entry::Vacant(e) = index.entry(f as usize) {
                e.insert(unique.len() as u32);
                unique.push(f);
            }
        }
        let shape = hash(
            format!(
                "{FORMAT} {} {base} {} {:?}",
                unique.len(),
                vm.heap.len(),
                vm.atoms.counts()
            )
            .as_bytes(),
        );
        Natives {
            list: unique,
            index,
            shape,
        }
    })
}

/// The build a snapshot belongs to: the package version and the shape of what the VM makes.
pub fn build_id() -> String {
    format!("{}+{:016x}", env!("CARGO_PKG_VERSION"), natives().shape)
}

/// FNV-1a, for the build and source hashes.
fn hash(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

fn hex(h: u64) -> String {
    format!("{h:016x}")
}

/// The shape of a run's host globals: their names, the functions among them by label (with whether they have
/// `snapshot` hooks or are durable), and their namespaces, the reference's `hosts` shape.
pub(crate) fn hosts_id(globals: &[(String, HostValue)]) -> String {
    fn shape(v: &HostValue, label: &str, text: &mut String) {
        match v {
            HostValue::Function(f) => {
                text.push_str(label);
                text.push_str(if f.snapshot.is_some() { "+;" } else { ";" });
            }
            HostValue::Durable(_) => {
                text.push_str(label);
                text.push_str("~;");
            }
            HostValue::Namespace(_) => {
                text.push_str(label);
                text.push_str("*;");
            }
            HostValue::Object(fields) => {
                for (k, item) in fields {
                    shape(item, &format!("{label}.{k}"), text);
                }
            }
            _ => {}
        }
    }
    let mut text = String::new();
    for (name, value) in globals {
        text.push_str(name);
        text.push(',');
        shape(value, name, &mut text);
        text.push('\n');
    }
    hex(hash(text.as_bytes()))
}

/// The bytecode of a compiled program, for checking a restore compiles the same instructions.
pub fn bytecode_hash(program: &crate::bytecode::Program) -> String {
    let mut text = String::new();
    for p in &program.protos {
        text.push_str(&format!("{:?}|{:?}|{}\n", p.code, p.pos, p.nlocals));
    }
    text.push_str(&format!("{}", program.consts.len()));
    hex(hash(text.as_bytes()))
}

// ---------- values ----------

fn num(n: f64) -> J {
    if n.is_nan() {
        return J::from("NaN");
    }
    if n.is_infinite() {
        return J::from(if n > 0.0 { "Inf" } else { "-Inf" });
    }
    if n == 0.0 && n.is_sign_negative() {
        return J::from("-0");
    }
    serde_json::Number::from_f64(n).map_or(J::Null, J::Number)
}

fn val(v: &Value) -> J {
    match v {
        Value::Undef => J::from("u"),
        Value::Null => J::Null,
        Value::Bool(b) => J::Bool(*b),
        Value::Num(n) => num(*n),
        Value::Str(s) => J::from(format!("s{s}")),
        Value::Obj(o) => J::from(format!("o{o}")),
        Value::Sym(s) => J::from(format!("y{s}")),
        Value::Uninit => J::from("i"),
    }
}

fn slot(s: &Slot) -> J {
    val(&s.get())
}

fn vals(items: &[Value]) -> J {
    J::Array(items.iter().map(val).collect())
}

fn outcome(o: &Result<Value, Value>) -> J {
    match o {
        Ok(v) => json!(["ok", val(v)]),
        Err(e) => json!(["err", val(e)]),
    }
}

fn opt_id(id: Option<Id>) -> J {
    id.map_or(J::Null, J::from)
}

/// A crossing to the host in progress (`cross::Cross`).
fn cross(c: &crate::cross::Cross) -> J {
    use crate::cross::{Step, Waiting};
    let stack: Vec<J> = c
        .stack
        .iter()
        .map(|v| {
            let step = match &v.step {
                Step::Start => json!(["s"]),
                Step::Array {
                    target,
                    out,
                    len,
                    i,
                } => json!(["a", val(target), out, len, i]),
                Step::Object {
                    target,
                    out,
                    names,
                    i,
                } => json!(["o", val(target), out, vals(names), i]),
            };
            json!([val(&v.holder), val(&v.key), v.depth, step])
        })
        .collect();
    let waiting = match c.waiting {
        Waiting::No => 0,
        Waiting::Root => 1,
        Waiting::Value => 2,
    };
    json!([
        "x",
        vals(&c.roots),
        vals(&c.crossed),
        stack,
        vals(&c.ancestors),
        json!(["result"]),
        waiting,
        c.owed
    ])
}

// ---------- capture ----------

/// What a capture needs to know beyond the VM.
pub struct Capture<'c> {
    pub code: &'c str,
    pub active_ms: u64,
}

struct Enc<'v> {
    vm: &'v Vm,
    natives: &'static Natives,
    protos: FxHashMap<usize, usize>,
    buffers: Vec<Arc<std::sync::Mutex<Vec<u8>>>>,
}

/// Why a suspend was refused: the calls that block it, or a state that can't be saved.
pub enum Refusal {
    Running(Vec<(u64, String)>),
    Other(String),
}

/// Saves the VM's state as it is now. The VM must be at a safe point: between jobs, or stopped at a back-edge.
pub fn capture(vm: &Vm, c: &Capture) -> Result<Snapshot, Refusal> {
    let running: Vec<(u64, String)> = vm
        .host
        .calls
        .iter()
        .filter(|call| {
            call.holds_functions
                || match &call.kind {
                    CallKind::Blocking => true,
                    CallKind::Idempotent => false,
                    CallKind::Durable(data, ..) => data.lock().map(|d| d.is_none()).unwrap_or(true),
                }
        })
        .map(|call| (call.call, call.label.clone()))
        .collect();
    if !running.is_empty() {
        let mut running = running;
        running.sort_by_key(|(call, _)| *call);
        return Err(Refusal::Running(running));
    }
    let mut enc = Enc {
        vm,
        natives: natives(),
        protos: vm
            .protos
            .iter()
            .enumerate()
            .map(|(i, p)| (Arc::as_ptr(p) as usize, i))
            .collect(),
        buffers: Vec::new(),
    };
    let state = enc.state(c).map_err(|e| Refusal::Other(e.message))?;
    let base = vm.snapshot_base;
    let program = crate::run::compile(c.code, &mut crate::strings::Strings::new())
        .map_err(|e| Refusal::Other(e.message))?;
    let limits = vm.limits;
    let metadata = vm.host.run.metadata();
    let header = json!({
        "build": build_id(),
        "hosts": hosts_id(&vm.host.globals),
        "runId": vm.host.run.id.get().cloned(),
        "metadata": metadata.to_json(),
        "metadataData": (!well_formed(&metadata)).then(|| host_value(&metadata.to_host())),
        "source": {
            "code": c.code,
            "hash": hex(hash(c.code.as_bytes())),
            "bytecode": bytecode_hash(&program),
        },
        "limits": {
            "timeoutMs": limits.timeout_ms,
            "maxOutputBytes": limits.max_output_bytes,
        },
        "budget": { "activeMs": c.active_ms },
        "base": base.json(),
    });
    Ok(Snapshot(
        json!({ "format": FORMAT, "header": header, "state": state }),
    ))
}

impl Enc<'_> {
    fn state(&mut self, c: &Capture) -> R<J> {
        let vm = self.vm;
        let base = vm.snapshot_base;
        let (texts, atoms) = vm.atoms.save_from(base.bufs, base.atoms);
        let baseline = baseline(vm, c.code)?;
        let mut changed = Vec::new();
        for (id, o) in vm.heap.iter().enumerate().take(base.heap) {
            let now = self.obj(o)?;
            let fresh = baseline.get(id);
            if fresh != Some(&now) {
                changed.push(json!([id, now]));
            }
        }
        let mut rest = Vec::new();
        // A streaming response's live accessors have no data form: one the run can still reach fails the resume, as
        // in the reference.
        let live = vm.heap[base.heap..]
            .iter()
            .any(|o| matches!(o.kind, Kind::Live(_)))
            .then(|| crate::reach::reachable(vm));
        for (i, o) in vm.heap.iter().enumerate().skip(base.heap) {
            let mut encoded = self.obj(o)?;
            if let (Kind::Live(l), Some(live)) = (&o.kind, &live)
                && live[i]
            {
                let names: Vec<&str> = l.accessors.iter().map(|(k, _)| vm.atoms.text(*k)).collect();
                encoded[3] = json!(["live", names]);
            }
            rest.push(encoded);
        }
        let mut global_map: Vec<(&u32, &Value)> = vm.global_map.iter().collect();
        global_map.sort_by_key(|(a, _)| **a);
        let host = self.host(c)?;
        let std = &vm.realm.std;
        Ok(json!({
            "strings": texts.iter().map(|(t, b)| json!([t, b])).collect::<Vec<_>>(),
            "atoms": atoms,
            "cells": vm.cells[base.cells.min(vm.cells.len())..].iter().map(slot).collect::<Vec<_>>(),
            "changed": changed,
            "heap": rest,
            "buffers": self.buffers.iter().map(|b| J::from(bytes_hex(&b.lock().unwrap_or_else(std::sync::PoisonError::into_inner)))).collect::<Vec<_>>(),
            "stack": vm.stack.iter().map(slot).collect::<Vec<_>>(),
            "frames": vm.frames.iter().map(|f| self.frame(f)).collect::<R<Vec<_>>>()?,
            "handlers": vm.handlers_ref().iter().map(handler).collect::<Vec<_>>(),
            "globals": vals(&vm.globals),
            "globalMap": global_map.iter().map(|(a, v)| json!([a, val(v)])).collect::<Vec<_>>(),
            "templates": vm.template_objs_ref().iter().map(|t| opt_id(*t)).collect::<Vec<_>>(),
            "jobs": vm.jobs.iter().map(|j| self.job(j)).collect::<Vec<_>>(),
            "inbox": vm.inbox.iter().map(|(p, s)| self.settlement(*p, s)).collect::<R<Vec<_>>>()?,
            "coroutines": vm.coroutines.iter().map(|co| self.coroutine(co)).collect::<R<Vec<_>>>()?,
            "logs": vm.logs,
            "rng": vm.rng.to_string(),
            "std": [std.regexp, std.date, std.uint8, std.buffer, std.text_encoder, std.text_decoder,
                    std.weak_map, std.weak_set, std.iterator_helper, std.uri_error, std.url, std.params,
                    std.headers, std.loaded],
            "host": host,
        }))
    }

    fn host(&mut self, _c: &Capture) -> R<J> {
        let h = &self.vm.host;
        let base = self.vm.snapshot_base;
        // Each result its owner's hooks can bring back, as the data its `encode` made.
        let mut results = Vec::new();
        for root in &h.results {
            let Some(hooks) = h.hooks(&root.owner) else {
                continue;
            };
            let data = encode(&hooks, &root.owner, &root.value)?;
            results.push(json!([
                root.owner,
                host_value(&data),
                root.functions.start,
                root.functions.end
            ]));
        }
        let functions: Vec<J> = h.functions[base.functions.min(h.functions.len())..]
            .iter()
            .map(|f| {
                let (name, length, own) = match &f.f {
                    Callee::Fn(hf) => (hf.name(), hf.length, hf.own_name),
                    Callee::Durable(_) => ("", 0, false),
                };
                json!([
                    f.label,
                    f.path.as_deref().map(texts),
                    f.owner,
                    f.installed,
                    name,
                    length,
                    own
                ])
            })
            .collect();
        let mut suggestions: Vec<(&Id, &Vec<crate::HostString>)> = h.suggestions.iter().collect();
        suggestions.sort_by_key(|(id, _)| **id);
        let mut modules: Vec<(&String, &Value)> = h.modules_loaded.iter().collect();
        modules.sort_by(|a, b| a.0.cmp(b.0));
        let mut namespaces: Vec<(&String, &Value)> = h.namespaces.iter().collect();
        namespaces.sort_by(|a, b| a.0.cmp(b.0));
        let mut calls = Vec::new();
        for call in &h.calls {
            let args = J::Array(call.args.iter().map(host_value).collect());
            let start = match &call.kind {
                CallKind::Idempotent => json!(["again"]),
                CallKind::Durable(data, ..) => match data.lock().map(|d| d.clone()).unwrap_or(None)
                {
                    Some(data) => json!(["wait", host_value(&data.to_host())]),
                    None => continue,
                },
                CallKind::Blocking => continue,
            };
            if !call.args.iter().all(plain_arg) {
                return Err(SnapshotError::new(format!(
                    "The call {} ({}) holds arguments with no data form.",
                    h.key(call.call),
                    call.label
                )));
            }
            calls.push(json!([
                start,
                call.promise,
                call.call,
                call.label,
                call.path.as_deref().map(texts),
                args,
                call.owner,
                call.site
            ]));
        }
        Ok(json!({
            "nextCall": h.next_call,
            "functions": functions,
            "results": results,
            "suggestions": suggestions.iter().map(|(id, s)| json!([id, texts(s)])).collect::<Vec<_>>(),
            "promiseLike": opt_id(h.promise_like),
            "unhandled": h.unhandled.iter().map(|(p, v)| json!([p, val(v)])).collect::<Vec<_>>(),
            "modules": modules.iter().map(|(k, v)| json!([k, val(v)])).collect::<Vec<_>>(),
            "namespaces": namespaces.iter().map(|(k, v)| json!([k, val(v)])).collect::<Vec<_>>(),
            "calls": calls,
        }))
    }

    fn obj(&mut self, o: &Obj) -> R<J> {
        let props: Vec<J> = o
            .props
            .items
            .iter()
            .map(|p| json!([p.key, val(&p.value), p.flags]))
            .collect();
        Ok(json!([
            opt_id(o.proto),
            o.flags,
            props,
            self.kind(&o.kind)?
        ]))
    }

    fn kind(&mut self, k: &Kind) -> R<J> {
        Ok(match k {
            Kind::Ordinary => J::from("o"),
            Kind::Array(items) => json!(["a", vals(items)]),
            Kind::Arguments(items) => json!(["g", vals(items)]),
            Kind::Closure(c) => {
                let proto = self.proto(&c.proto)?;
                json!(["c", proto, c.upvals.to_vec(), val(&c.this)])
            }
            Kind::Native {
                f,
                data,
                name,
                length,
                ctor,
            } => {
                let Some(i) = self.natives.index.get(&(*f as usize)).map(|&i| i as usize) else {
                    return Err(SnapshotError::new(
                        "The run can't be suspended: it holds a native function this build can't name.",
                    ));
                };
                json!(["n", i, val(data), name, length, ctor])
            }
            Kind::Bound(b) => json!(["b", val(&b.0), val(&b.1), vals(&b.2)]),
            Kind::Error(f) => match f {
                None => json!(["e", J::Null]),
                Some(f) => json!(["e", [f.kind.name(), f.message, f.offset]]),
            },
            Kind::Promise(d) => {
                let state = match &d.state {
                    PromiseState::Pending => json!(["pending"]),
                    PromiseState::Fulfilled(v) => json!(["ok", val(v)]),
                    PromiseState::Rejected(e) => json!(["err", val(e)]),
                };
                let reactions: Vec<J> = d.reactions.iter().map(reaction).collect();
                json!(["p", state, reactions])
            }
            Kind::Map(m) => json!(["m", map(m)]),
            Kind::Set(m) => json!(["s", map(m)]),
            Kind::WeakMap(m) => json!(["wm", map(m)]),
            Kind::WeakSet(m) => json!(["ws", map(m)]),
            Kind::Generator(g) => json!(["gen", self.gen_state(g)?]),
            Kind::ArrayIter { target, pos, kind } => json!(["ai", target, pos, iter_kind(*kind)]),
            Kind::MapIter { target, pos, kind } => json!(["mi", target, pos, iter_kind(*kind)]),
            Kind::ExoticIter { target, pos, kind } => {
                json!(["xi", target, pos, iter_kind(*kind)])
            }
            Kind::StrIter { s, pos } => json!(["si", s, pos]),
            Kind::Cross(c) => cross(c),
            Kind::ListIter { items, pos } => json!(["li", vals(items), pos]),
            Kind::Namespace(ns) => json!(["t", (!ns.is_root()).then_some(ns.parent), ns.name]),
            Kind::Resolvers { promise, done } => json!(["r", promise, done]),
            Kind::Combinator(c) => {
                let kind = match c.kind {
                    CombKind::All => 0,
                    CombKind::AllSettled => 1,
                    CombKind::Any => 2,
                };
                json!(["cb", kind, c.promise, vals(&c.values), c.remaining])
            }
            Kind::RegExp(r) => json!(["re", r.source, r.flags, num(r.last_index)]),
            Kind::Date(t) => json!(["d", num(*t)]),
            Kind::Bytes(b) => {
                let i = match self.buffers.iter().position(|x| Arc::ptr_eq(x, &b.buf)) {
                    Some(i) => i,
                    None => {
                        self.buffers.push(b.buf.clone());
                        self.buffers.len() - 1
                    }
                };
                json!(["y", i, b.start, b.len, b.buffer])
            }
            Kind::TextDecoder(d) => {
                json!(["td", d.fatal, d.ignore_bom, bytes_hex(&d.queued), d.seen])
            }
            Kind::IterHelper(h) => {
                use crate::builtins::iterator::{HelperOp, HelperState};
                let op = match &h.op {
                    HelperOp::Wrap => json!(["wrap"]),
                    HelperOp::Map(f) => json!(["map", val(f)]),
                    HelperOp::Filter(f) => json!(["filter", val(f)]),
                    HelperOp::Take(n) => json!(["take", num(*n)]),
                    HelperOp::Drop(n) => json!(["drop", num(*n)]),
                    HelperOp::FlatMap(f, inner) => json!([
                        "flatmap",
                        val(f),
                        inner.map_or(J::Null, |(a, b)| json!([val(&a), val(&b)]))
                    ]),
                };
                let state = match h.state {
                    HelperState::Start => 0,
                    HelperState::Suspended => 1,
                    HelperState::Running => 2,
                    HelperState::Done => 3,
                };
                json!([
                    "ih",
                    val(&h.iter),
                    val(&h.next),
                    op,
                    num(h.counter),
                    state,
                    val(&h.site)
                ])
            }
            Kind::Url(u) => json!(["url", u.url.as_str(), u.params]),
            Kind::SearchParams(p) => json!(["sp", p.list, opt_id(p.url)]),
            Kind::Headers(h) => json!(["h", h.list]),
            Kind::AsyncGenerator(a) => {
                let phase = match a.phase {
                    AsyncPhase::Start => 0,
                    AsyncPhase::Yield => 1,
                    AsyncPhase::Executing => 2,
                    AsyncPhase::AwaitingReturn => 3,
                    AsyncPhase::Completed => 4,
                };
                let queue: Vec<J> = a
                    .queue
                    .iter()
                    .map(|r| json!([r.kind, val(&r.value), r.promise]))
                    .collect();
                json!(["ag", self.gen_state(&a.state)?, phase, queue])
            }
            Kind::AsyncFromSync { sync, next } => json!(["afs", sync, val(next)]),
            Kind::Live(_) => json!(["live", []]),
        })
    }

    fn proto(&self, p: &Arc<crate::bytecode::FuncProto>) -> R<usize> {
        self.protos
            .get(&(Arc::as_ptr(p) as usize))
            .copied()
            .ok_or_else(|| {
                SnapshotError::new("The run can't be suspended: a function is not this run's code.")
            })
    }

    fn gen_state(&self, g: &GenState) -> R<J> {
        Ok(match g {
            GenState::Done => json!(["done"]),
            GenState::Suspended(s) => json!(["susp", self.saved(s)?]),
            GenState::Running(s) => json!(["run", self.saved(s)?]),
        })
    }

    fn saved(&self, s: &SavedFrame) -> R<J> {
        let frame = match &s.frame {
            Some(f) => self.frame(f)?,
            None => J::Null,
        };
        let mut out = json!([
            frame,
            s.stack.iter().map(slot).collect::<Vec<_>>(),
            s.handlers.iter().map(handler).collect::<Vec<_>>(),
            s.started
        ]);
        if !s.above.is_empty()
            && let J::Array(items) = &mut out
        {
            items.push(J::Array(
                s.above
                    .iter()
                    .map(|f| self.frame(f))
                    .collect::<R<Vec<_>>>()?,
            ));
            if !s.splits.is_empty() {
                items.push(json!(s.splits));
            }
        }
        Ok(out)
    }

    fn frame(&self, f: &Frame) -> R<J> {
        let kind = match f.kind {
            FrameKind::Normal => json!(["n"]),
            FrameKind::Native(op, sub) => json!(["x", op.code(), sub]),
            FrameKind::Async(c) => json!(["a", c]),
            FrameKind::Generator(g, r) => {
                let r = match r {
                    Resume::Iter => json!("i"),
                    Resume::Delegate => json!("d"),
                    Resume::Collect(a) => json!(["c", a]),
                    Resume::Result => json!("r"),
                    Resume::Native => json!("x"),
                };
                json!(["g", g, r])
            }
        };
        // A native frame's code is not the program's: its step function is in its mode.
        let proto = match f.kind {
            FrameKind::Native(..) => 0,
            _ => self.proto(&f.func)?,
        };
        Ok(json!([
            proto,
            f.pc,
            f.base,
            f.upvals.to_vec(),
            f.hbase,
            vals(&f.extra),
            f.argc,
            kind,
            f.is_base,
            f.yield_pc
        ]))
    }

    fn coroutine(&self, c: &Coroutine) -> R<J> {
        let saved = match &c.saved {
            Some(s) => self.saved(s)?,
            None => J::Null,
        };
        Ok(json!([saved, opt_id(c.promise)]))
    }

    fn job(&self, j: &Job) -> J {
        match j {
            Job::Reaction(r, o) => json!(["r", reaction(r), outcome(o)]),
            Job::Thenable {
                promise,
                thenable,
                then,
            } => json!(["t", promise, val(thenable), val(then)]),
        }
    }

    fn settlement(&self, p: Id, s: &Settlement) -> R<J> {
        Ok(match s {
            Settlement::Undefined => json!([p, "undef"]),
            Settlement::Failure(f) => {
                let (kind, message, suggestions) = f.parts();
                json!([p, "fail", kind.name(), text(message), texts(suggestions)])
            }
            Settlement::Lost(message, site) => json!([p, "lost", message, site]),
            Settlement::Host(h) => {
                let Settled {
                    result,
                    label,
                    owner,
                    site,
                } = h.as_ref();
                let (ok, v) = match result {
                    Ok(v) => (true, v),
                    Err(v) => (false, v),
                };
                let hooks = owner.as_deref().and_then(|o| self.vm.host.hooks(o));
                let (hooked, data) = match (hooks, owner) {
                    (Some(hooks), Some(owner)) if ok && has_functions(v) => {
                        (true, encode(&hooks, owner, v)?)
                    }
                    _ => (false, v.clone()),
                };
                json!([p, "host", ok, label, owner, hooked, host_value(&data), site])
            }
            Settlement::Interrupted => json!([p, "interrupted"]),
        })
    }
}

/// What a host function's `snapshot` hooks save of a value it returned: plain data, or why they can't.
fn encode(hooks: &crate::SnapshotHooks, owner: &str, v: &HostValue) -> R<HostValue> {
    let data = (hooks.encode)(v).map_err(|e| {
        SnapshotError::new(format!(
            "The host function {owner} couldn't save a value it returned: {}",
            e.message
        ))
    })?;
    if !plain(&data) {
        return Err(SnapshotError::new(format!(
            "The host function {owner} couldn't save a value it returned: it gave data that isn't plain."
        )));
    }
    Ok(data)
}

/// An argument a resumed call can be given again: anything but a function.
fn plain_arg(v: &HostValue) -> bool {
    let mut fns = Vec::new();
    collect_functions(v, &mut fns);
    fns.is_empty()
        && !matches!(
            v,
            HostValue::Durable(_) | HostValue::Namespace(_) | HostValue::Response(_)
        )
}

fn handler(h: &Handler) -> J {
    json!([h.pc, h.sp])
}

fn iter_kind(k: IterKind) -> u8 {
    match k {
        IterKind::Keys => 0,
        IterKind::Values => 1,
        IterKind::Entries => 2,
    }
}

fn map(m: &OrderedMap) -> J {
    J::Array(
        m.entries
            .iter()
            .map(|e| match e {
                Some((k, v)) => json!([val(k), val(v)]),
                None => J::Null,
            })
            .collect(),
    )
}

fn reaction(r: &Reaction) -> J {
    match r {
        Reaction::Then {
            on_ful,
            on_rej,
            derived,
        } => json!(["then", val(on_ful), val(on_rej), derived]),
        Reaction::Await(c) => json!(["await", c]),
        Reaction::Resolve(t) => json!(["resolve", t]),
        Reaction::Comb { comb, index } => json!(["comb", comb, index]),
        Reaction::Finally { cleanup, derived } => json!(["finally", val(cleanup), derived]),
        Reaction::Restore {
            derived,
            outcome: o,
        } => json!(["restore", derived, outcome(o)]),
        Reaction::Program => json!(["program"]),
        Reaction::Cross(id) => json!(["cross", id]),
        Reaction::AwaitGen(g) => json!(["awaitgen", g]),
        Reaction::GenReturn(g) => json!(["genreturn", g]),
        Reaction::FromSync { made, done, close } => json!(["fromsync", made, done, opt_id(*close)]),
    }
}

fn bytes_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn hex_bytes(s: &str) -> R<Vec<u8>> {
    if !s.is_ascii() || !s.len().is_multiple_of(2) {
        return Err(invalid("a byte string is not hex."));
    }
    (0..s.len())
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| invalid("a byte string is not hex."))
        })
        .collect()
}

/// Each object of a fresh run's base, encoded, to see which ones the run changed.
fn baseline(vm: &Vm, code: &str) -> R<Vec<J>> {
    let mut atoms = crate::strings::Strings::new();
    let program =
        crate::run::compile(code, &mut atoms).map_err(|e| SnapshotError::new(e.message))?;
    let h = &vm.host;
    let host = host::RunHost::new(
        h.globals.clone(),
        h.modules.clone(),
        h.translate,
        h.run.clone(),
    );
    let mut fresh = Vm::new(host, vm.limits, atoms);
    fresh.setup();
    crate::builtins::ensure_globals(&mut fresh, &program.globals);
    host::install(&mut fresh, &program.globals);
    let mut enc = Enc {
        vm: &fresh,
        natives: natives(),
        protos: FxHashMap::default(),
        buffers: Vec::new(),
    };
    fresh.heap.iter().map(|o| enc.obj(o)).collect()
}

// ---------- host values ----------

fn has_functions(v: &HostValue) -> bool {
    let mut out = Vec::new();
    collect_functions(v, &mut out);
    !out.is_empty()
}

/// The functions of a host value, in the order the VM wraps them when it copies the value in.
fn collect_functions(v: &HostValue, out: &mut Vec<HostFunction>) {
    match v {
        HostValue::Function(f) => out.push(f.clone()),
        HostValue::Array(items) => items
            .iter()
            .flatten()
            .for_each(|i| collect_functions(i, out)),
        HostValue::Object(fields) => fields.iter().for_each(|(_, i)| collect_functions(i, out)),
        HostValue::Map(entries) => entries.iter().for_each(|(k, i)| {
            collect_functions(k, out);
            collect_functions(i, out);
        }),
        HostValue::Set(items) => items.iter().for_each(|i| collect_functions(i, out)),
        // An error's own functions are dropped when it crosses; only its cause can hold some.
        HostValue::Error(e) => {
            if let Some(c) = &e.cause {
                collect_functions(c, out);
            }
        }
        _ => {}
    }
}

/// Plain data, as `snapshot.encode` must return: JSON values and bytes.
fn plain(v: &HostValue) -> bool {
    match v {
        HostValue::Null
        | HostValue::Bool(_)
        | HostValue::Number(_)
        | HostValue::String(_)
        | HostValue::Bytes(_) => true,
        HostValue::Array(items) => items.iter().all(|i| i.as_ref().is_some_and(plain)),
        HostValue::Object(fields) => fields.iter().all(|(_, i)| plain(i)),
        _ => false,
    }
}

fn host_value(v: &HostValue) -> J {
    match v {
        HostValue::Undefined => json!(["u"]),
        HostValue::Null => J::Null,
        HostValue::Bool(b) => J::Bool(*b),
        HostValue::Number(n) => json!(["n", num(*n)]),
        HostValue::String(s) => text(s),
        HostValue::Array(items) => json!([
            "a",
            items
                .iter()
                .map(|i| i.as_ref().map_or(json!(["hole"]), host_value))
                .collect::<Vec<_>>()
        ]),
        HostValue::Object(fields) => json!([
            "o",
            fields
                .iter()
                .map(|(k, v)| json!([text(k), host_value(v)]))
                .collect::<Vec<_>>()
        ]),
        HostValue::Map(entries) => json!([
            "m",
            entries
                .iter()
                .map(|(k, v)| json!([host_value(k), host_value(v)]))
                .collect::<Vec<_>>()
        ]),
        HostValue::Set(items) => json!(["set", items.iter().map(host_value).collect::<Vec<_>>()]),
        HostValue::Function(f) => json!(["f", f.name(), f.length]),
        HostValue::Durable(_) | HostValue::Namespace(_) => json!(["f", "", 0]),
        HostValue::Interrupt => json!(["u"]),
        HostValue::Failure(f) => json!(["fail", f.kind, text(&f.message), texts(&f.suggestions)]),
        HostValue::Date(t) => json!(["date", num(*t)]),
        HostValue::RegExp { source, flags } => json!(["re", text(source), flags]),
        HostValue::Url(href) => json!(["url", href]),
        HostValue::SearchParams(pairs) => json!(["sp", pairs]),
        HostValue::Headers(entries) => json!(["hd", entries]),
        HostValue::Bytes(b) => json!(["u8", bytes_hex(b)]),
        HostValue::Buffer(b) => json!(["buf", bytes_hex(b)]),
        HostValue::Response(_) => json!(["resp"]),
        HostValue::Error(e) => json!([
            "e",
            text(&e.name),
            text(&e.message),
            e.cause.as_ref().map_or(J::Null, |c| host_value(c)),
            e.fields
                .iter()
                .map(|(k, v)| json!([text(k), host_value(v)]))
                .collect::<Vec<_>>()
        ]),
    }
}

/// Where a saved host value holds a live response, named as the reference names what crosses: `label.key` in an
/// object, `label[i]` in an array, `label` in a Map or Set.
fn lost_path(j: &J, label: &str) -> Option<String> {
    let J::Array(a) = j else {
        return None;
    };
    let items = || a.get(1).and_then(J::as_array).into_iter().flatten();
    match a.first().and_then(J::as_str)? {
        "resp" => Some(label.to_owned()),
        "a" => items()
            .enumerate()
            .find_map(|(i, item)| lost_path(item, &format!("{label}[{i}]"))),
        "o" => items().find_map(|p| {
            let key = p.get(0).and_then(J::as_str).unwrap_or("");
            lost_path(p.get(1)?, &format!("{label}.{key}"))
        }),
        "m" => items()
            .find_map(|p| lost_path(p.get(0)?, label).or_else(|| lost_path(p.get(1)?, label))),
        "set" => items().find_map(|item| lost_path(item, label)),
        _ => None,
    }
}

/// Whether data's strings and keys are all well formed, so plain JSON holds it exactly.
fn well_formed(d: &crate::Data) -> bool {
    use crate::Data;
    match d {
        Data::String(s) => s.is_well_formed(),
        Data::Array(items) => items.iter().all(well_formed),
        Data::Object(fields) => fields
            .iter()
            .all(|(k, v)| k.is_well_formed() && well_formed(v)),
        _ => true,
    }
}

/// A host string as saved: JSON text when well formed, else its UTF-16 code units.
fn text(s: &crate::HostString) -> J {
    match s.as_str() {
        Some(s) => J::from(s),
        None => json!(["s16", s.to_utf16()]),
    }
}

fn texts(list: &[crate::HostString]) -> J {
    J::Array(list.iter().map(text).collect())
}

fn texts_from(j: &J) -> R<Vec<crate::HostString>> {
    j.as_array()
        .ok_or_else(|| invalid("a list of strings is not a list."))?
        .iter()
        .map(text_from)
        .collect()
}

fn text_from(j: &J) -> R<crate::HostString> {
    match j {
        J::String(s) => Ok(s.into()),
        J::Array(a) if a.first().and_then(J::as_str) == Some("s16") => {
            let units = list(a.get(1))?
                .iter()
                .map(|u| u.as_u64().and_then(|u| u16::try_from(u).ok()))
                .collect::<Option<Vec<u16>>>()
                .ok_or_else(|| invalid("a string's code units are malformed."))?;
            Ok(crate::HostString::from_utf16(&units))
        }
        _ => Err(invalid("a string is malformed.")),
    }
}

fn host_value_from(j: &J) -> R<HostValue> {
    Ok(match j {
        J::Null => HostValue::Null,
        J::Bool(b) => HostValue::Bool(*b),
        J::String(s) => HostValue::String(s.into()),
        J::Array(a) => match a.first().and_then(J::as_str) {
            Some("s16") => HostValue::String(text_from(j)?),
            Some("u") => HostValue::Undefined,
            Some("n") => HostValue::Number(unnum(a.get(1).unwrap_or(&J::Null))?),
            Some("a") => HostValue::Array(
                list(a.get(1))?
                    .iter()
                    .map(|i| match i {
                        J::Array(x) if x.first().and_then(J::as_str) == Some("hole") => Ok(None),
                        other => host_value_from(other).map(Some),
                    })
                    .collect::<R<_>>()?,
            ),
            Some("o") => HostValue::Object(
                list(a.get(1))?
                    .iter()
                    .map(|p| Ok((text_from(at(p, 0)?)?, host_value_from(at(p, 1)?)?)))
                    .collect::<R<_>>()?,
            ),
            Some("m") => HostValue::Map(
                list(a.get(1))?
                    .iter()
                    .map(|p| Ok((host_value_from(at(p, 0)?)?, host_value_from(at(p, 1)?)?)))
                    .collect::<R<_>>()?,
            ),
            Some("set") => HostValue::Set(
                list(a.get(1))?
                    .iter()
                    .map(host_value_from)
                    .collect::<R<_>>()?,
            ),
            Some("f") => HostValue::Function(host::lost_function(
                a.get(1).and_then(J::as_str).unwrap_or(""),
            )),
            Some("fail") => HostValue::Failure(
                crate::Failure::new(string(at(j, 1)?)?, text_from(at(j, 2)?)?)
                    .suggestions(texts_from(at(j, 3)?)?),
            ),
            Some("date") => HostValue::Date(unnum(a.get(1).unwrap_or(&J::Null))?),
            Some("re") => HostValue::RegExp {
                source: text_from(at(j, 1)?)?,
                flags: string(at(j, 2)?)?,
            },
            Some("url") => HostValue::Url(string(at(j, 1)?)?),
            Some("sp") => HostValue::SearchParams(pairs(at(j, 1)?)?),
            Some("hd") => HostValue::Headers(pairs(at(j, 1)?)?),
            Some("u8") => HostValue::Bytes(hex_bytes(&string(at(j, 1)?)?)?),
            Some("buf") => HostValue::Buffer(hex_bytes(&string(at(j, 1)?)?)?),
            // A live response has no data form; a settlement holding one is restored as `lost_path` says.
            Some("resp") => HostValue::Undefined,
            Some("e") => HostValue::Error(Box::new(HostError {
                name: text_from(at(j, 1)?)?,
                message: text_from(at(j, 2)?)?,
                cause: match at(j, 3)? {
                    J::Null => None,
                    c => Some(Box::new(host_value_from(c)?)),
                },
                fields: list(a.get(4))?
                    .iter()
                    .map(|p| Ok((text_from(at(p, 0)?)?, host_value_from(at(p, 1)?)?)))
                    .collect::<R<_>>()?,
            })),
            _ => return Err(invalid("a host value has an unknown tag.")),
        },
        J::Number(_) | J::Object(_) => return Err(invalid("a host value is malformed.")),
    })
}

// ---------- decoding helpers ----------

fn at(j: &J, i: usize) -> R<&J> {
    j.as_array()
        .and_then(|a| a.get(i))
        .ok_or_else(|| invalid(format!("an entry lacks field {i}.")))
}

fn list(j: Option<&J>) -> R<&Vec<J>> {
    j.and_then(J::as_array)
        .ok_or_else(|| invalid("a list is missing."))
}

fn field<'j>(j: &'j J, name: &str) -> R<&'j J> {
    j.get(name)
        .ok_or_else(|| invalid(format!("the state lacks {name}.")))
}

fn field_list<'j>(j: &'j J, name: &str) -> R<&'j Vec<J>> {
    field(j, name)?
        .as_array()
        .ok_or_else(|| invalid(format!("{name} is not a list.")))
}

fn uint(j: &J) -> R<u64> {
    j.as_u64()
        .ok_or_else(|| invalid("a count is not a number."))
}

fn u32_(j: &J) -> R<u32> {
    u32::try_from(uint(j)?).map_err(|_| invalid("a count is out of range."))
}

fn usize_(j: &J) -> R<usize> {
    usize::try_from(uint(j)?).map_err(|_| invalid("a count is out of range."))
}

fn boolean(j: &J) -> R<bool> {
    j.as_bool()
        .ok_or_else(|| invalid("a flag is not a boolean."))
}

fn string(j: &J) -> R<String> {
    j.as_str()
        .map(str::to_owned)
        .ok_or_else(|| invalid("a text is not a string."))
}

fn unnum(j: &J) -> R<f64> {
    match j {
        J::Number(n) => n.as_f64().ok_or_else(|| invalid("a number is malformed.")),
        J::String(s) => match s.as_str() {
            "NaN" => Ok(f64::NAN),
            "Inf" => Ok(f64::INFINITY),
            "-Inf" => Ok(f64::NEG_INFINITY),
            "-0" => Ok(-0.0),
            _ => Err(invalid("a number is malformed.")),
        },
        _ => Err(invalid("a number is malformed.")),
    }
}

fn opt_u32(j: &J) -> R<Option<u32>> {
    match j {
        J::Null => Ok(None),
        other => u32_(other).map(Some),
    }
}

fn kind_named(name: &str) -> R<DiagnosticKind> {
    Ok(DiagnosticKind::named(name))
}

// ---------- restore ----------

struct Dec<'p> {
    natives: &'static Natives,
    heap_len: usize,
    bufs_len: usize,
    protos: usize,
    buffers: Vec<Arc<std::sync::Mutex<Vec<u8>>>>,
    _p: std::marker::PhantomData<&'p ()>,
}

impl Dec<'_> {
    fn val(&self, j: &J) -> R<Value> {
        let id = |s: &str| -> R<u32> {
            s[1..]
                .parse::<u32>()
                .map_err(|_| invalid("a value reference is malformed."))
        };
        Ok(match j {
            J::Null => Value::Null,
            J::Bool(b) => Value::Bool(*b),
            J::Number(_) => Value::Num(unnum(j)?),
            J::String(s) => match s.as_str() {
                "u" => Value::Undef,
                "i" => Value::Uninit,
                "NaN" | "Inf" | "-Inf" | "-0" => Value::Num(unnum(j)?),
                t if t.starts_with('s') => {
                    let s = id(t)?;
                    if s as usize >= self.bufs_len {
                        return Err(invalid("a string reference is out of range."));
                    }
                    Value::Str(s)
                }
                t if t.starts_with('o') => {
                    let o = id(t)?;
                    if o as usize >= self.heap_len {
                        return Err(invalid("an object reference is out of range."));
                    }
                    Value::Obj(o)
                }
                t if t.starts_with('y') => {
                    let a = id(t)?;
                    if a > SYM_ASYNC_ITERATOR {
                        return Err(invalid("a symbol is unknown."));
                    }
                    Value::Sym(a)
                }
                _ => return Err(invalid("a value is malformed.")),
            },
            _ => return Err(invalid("a value is malformed.")),
        })
    }

    fn vals(&self, j: &J) -> R<Vec<Value>> {
        j.as_array()
            .ok_or_else(|| invalid("a value list is not a list."))?
            .iter()
            .map(|v| self.val(v))
            .collect()
    }

    fn slot(&self, j: &J) -> R<Slot> {
        Ok(Slot::pack(self.val(j)?))
    }

    fn slots(&self, j: &J) -> R<Vec<Slot>> {
        j.as_array()
            .ok_or_else(|| invalid("a stack is not a list."))?
            .iter()
            .map(|v| self.slot(v))
            .collect()
    }

    fn id(&self, j: &J) -> R<Id> {
        let id = u32_(j)?;
        if id as usize >= self.heap_len {
            return Err(invalid("an object id is out of range."));
        }
        Ok(id)
    }

    fn opt_id(&self, j: &J) -> R<Option<Id>> {
        match j {
            J::Null => Ok(None),
            other => self.id(other).map(Some),
        }
    }

    fn outcome(&self, j: &J) -> R<Result<Value, Value>> {
        let v = self.val(at(j, 1)?)?;
        match at(j, 0)?.as_str() {
            Some("ok") => Ok(Ok(v)),
            Some("err") => Ok(Err(v)),
            _ => Err(invalid("an outcome is malformed.")),
        }
    }

    fn reaction(&self, j: &J) -> R<Reaction> {
        let tag = at(j, 0)?.as_str().unwrap_or("");
        Ok(match tag {
            "then" => Reaction::Then {
                on_ful: self.val(at(j, 1)?)?,
                on_rej: self.val(at(j, 2)?)?,
                derived: self.id(at(j, 3)?)?,
            },
            "await" => Reaction::Await(u32_(at(j, 1)?)?),
            "resolve" => Reaction::Resolve(self.id(at(j, 1)?)?),
            "comb" => Reaction::Comb {
                comb: self.id(at(j, 1)?)?,
                index: u32_(at(j, 2)?)?,
            },
            "finally" => Reaction::Finally {
                cleanup: self.val(at(j, 1)?)?,
                derived: self.id(at(j, 2)?)?,
            },
            "restore" => Reaction::Restore {
                derived: self.id(at(j, 1)?)?,
                outcome: self.outcome(at(j, 2)?)?,
            },
            "program" => Reaction::Program,
            "cross" => Reaction::Cross(self.id(at(j, 1)?)?),
            "awaitgen" => Reaction::AwaitGen(self.id(at(j, 1)?)?),
            "genreturn" => Reaction::GenReturn(self.id(at(j, 1)?)?),
            "fromsync" => Reaction::FromSync {
                made: self.id(at(j, 1)?)?,
                done: boolean(at(j, 2)?)?,
                close: self.opt_id(at(j, 3)?)?,
            },
            _ => return Err(invalid(format!("unknown reaction {tag}."))),
        })
    }

    fn handlers(&self, j: &J) -> R<Vec<Handler>> {
        j.as_array()
            .ok_or_else(|| invalid("handlers are not a list."))?
            .iter()
            .map(|h| {
                Ok(Handler {
                    pc: u32_(at(h, 0)?)?,
                    sp: u32_(at(h, 1)?)?,
                })
            })
            .collect()
    }

    fn frame(&self, vm: &Vm, j: &J) -> R<Box<Frame>> {
        let kind = at(j, 7)?;
        let native = at(kind, 0)?.as_str() == Some("x");
        let proto = usize_(at(j, 0)?)?;
        if !native && proto >= self.protos {
            return Err(invalid("a frame's function is not in the program."));
        }
        let func = match native {
            true => vm.native_proto.clone(),
            false => vm.protos[proto].clone(),
        };
        let pc = usize_(at(j, 1)?)?;
        if pc >= func.code.len() {
            return Err(invalid(format!("a frame's pc {pc} is out of range.")));
        }
        let kind = match at(kind, 0)?.as_str() {
            Some("n") => FrameKind::Normal,
            Some("x") => {
                let code = u32_(at(kind, 1)?)?;
                let op = u16::try_from(code)
                    .ok()
                    .and_then(crate::native::NativeOp::from_code)
                    .ok_or_else(|| invalid("a native frame's step is unknown."))?;
                let sub = match kind.get(2) {
                    Some(s) => u16::try_from(u32_(s)?)
                        .map_err(|_| invalid("a native frame's step is unknown."))?,
                    None => 0,
                };
                FrameKind::Native(op, sub)
            }
            Some("a") => FrameKind::Async(u32_(at(kind, 1)?)?),
            Some("g") => {
                let g = self.id(at(kind, 1)?)?;
                let r = at(kind, 2)?;
                let r = match r {
                    J::String(s) if s == "i" => Resume::Iter,
                    J::String(s) if s == "d" => Resume::Delegate,
                    J::String(s) if s == "r" => Resume::Result,
                    J::String(s) if s == "x" => Resume::Native,
                    J::Array(_) => Resume::Collect(self.id(at(r, 1)?)?),
                    _ => return Err(invalid("a generator frame's resume is unknown.")),
                };
                FrameKind::Generator(g, r)
            }
            _ => return Err(invalid("a frame's mode is unknown.")),
        };
        Ok(Box::new(Frame {
            func,
            pc,
            base: usize_(at(j, 2)?)?,
            upvals: at(j, 3)?
                .as_array()
                .ok_or_else(|| invalid("a frame's upvalues are not a list."))?
                .iter()
                .map(u32_)
                .collect::<R<Vec<u32>>>()?
                .into(),
            hbase: u32_(at(j, 4)?)?,
            extra: self.vals(at(j, 5)?)?.into(),
            argc: u32_(at(j, 6)?)?,
            kind,
            is_base: boolean(at(j, 8)?)?,
            yield_pc: u32_(at(j, 9)?)?,
            depth: 0,
        }))
    }

    fn saved(&self, vm: &Vm, j: &J) -> R<Box<SavedFrame>> {
        let frame = match at(j, 0)? {
            J::Null => None,
            f => Some(self.frame(vm, f)?),
        };
        let above = match j.get(4) {
            Some(J::Array(items)) => items
                .iter()
                .map(|f| self.frame(vm, f))
                .collect::<R<Vec<_>>>()?,
            _ => Vec::new(),
        };
        let splits = match j.get(5) {
            Some(J::Array(items)) => items
                .iter()
                .map(|s| Ok((u32_(at(s, 0)?)?, u32_(at(s, 1)?)?)))
                .collect::<R<Vec<_>>>()?,
            _ => Vec::new(),
        };
        Ok(Box::new(SavedFrame {
            frame,
            stack: self.slots(at(j, 1)?)?,
            handlers: self.handlers(at(j, 2)?)?,
            started: boolean(at(j, 3)?)?,
            above,
            splits,
        }))
    }

    fn gen_state(&self, vm: &Vm, j: &J) -> R<GenState> {
        Ok(match at(j, 0)?.as_str() {
            Some("done") => GenState::Done,
            Some("susp") => GenState::Suspended(self.saved(vm, at(j, 1)?)?),
            Some("run") => GenState::Running(self.saved(vm, at(j, 1)?)?),
            _ => return Err(invalid("a generator's state is unknown.")),
        })
    }

    fn map(&self, vm: &mut Vm, j: &J) -> R<Box<OrderedMap>> {
        let mut entries = Vec::new();
        let mut keys = Vec::new();
        for e in j
            .as_array()
            .ok_or_else(|| invalid("a map is not a list."))?
        {
            match e {
                J::Null => {
                    entries.push(None);
                    keys.push(None);
                }
                e => {
                    let k = self.val(at(e, 0)?)?;
                    let v = self.val(at(e, 1)?)?;
                    keys.push(Some(vm.map_key(&k)));
                    entries.push(Some((k, v)));
                }
            }
        }
        Ok(Box::new(OrderedMap::restore(entries, keys)))
    }

    fn iter_kind(j: &J) -> R<IterKind> {
        Ok(match uint(j)? {
            0 => IterKind::Keys,
            1 => IterKind::Values,
            2 => IterKind::Entries,
            _ => return Err(invalid("an iterator kind is unknown.")),
        })
    }

    fn obj(&self, vm: &mut Vm, j: &J) -> R<Obj> {
        let proto = self.opt_id(at(j, 0)?)?;
        let flags = u32_(at(j, 1)?)? as u8;
        let mut items = Vec::new();
        for p in at(j, 2)?
            .as_array()
            .ok_or_else(|| invalid("properties are not a list."))?
        {
            items.push(Prop {
                key: u32_(at(p, 0)?)?,
                value: self.val(at(p, 1)?)?,
                flags: u32_(at(p, 2)?)? as u8,
            });
        }
        let kind = self.kind(vm, at(j, 3)?)?;
        Ok(Obj {
            proto,
            props: Props::from_items(items),
            kind,
            flags,
            visit: 0,
        })
    }

    fn cross<'j>(&self, f: impl Fn(usize) -> R<&'j J>) -> R<Kind> {
        use crate::cross::{Cross, Step, Visit, Waiting};
        let stack = f(3)?
            .as_array()
            .ok_or_else(|| invalid("a crossing's visits are not a list."))?
            .iter()
            .map(|v| {
                let s = at(v, 3)?;
                let step = match at(s, 0)?.as_str() {
                    Some("s") => Step::Start,
                    Some("a") => Step::Array {
                        target: self.val(at(s, 1)?)?,
                        out: self.id(at(s, 2)?)?,
                        len: u32_(at(s, 3)?)?,
                        i: u32_(at(s, 4)?)?,
                    },
                    Some("o") => Step::Object {
                        target: self.val(at(s, 1)?)?,
                        out: self.id(at(s, 2)?)?,
                        names: self.vals(at(s, 3)?)?,
                        i: u32_(at(s, 4)?)?,
                    },
                    _ => return Err(invalid("a crossing's visit is unknown.")),
                };
                Ok(Visit {
                    holder: self.val(at(v, 0)?)?,
                    key: self.val(at(v, 1)?)?,
                    depth: u32_(at(v, 2)?)?,
                    step,
                })
            })
            .collect::<R<Vec<_>>>()?;
        // Only the program's result crosses this way.
        if at(f(5)?, 0)?.as_str() != Some("result") {
            return Err(invalid("a crossing's target is unknown."));
        }
        let waiting = match uint(f(6)?)? {
            0 => Waiting::No,
            1 => Waiting::Root,
            _ => Waiting::Value,
        };
        Ok(Kind::Cross(Box::new(Cross {
            roots: self.vals(f(1)?)?,
            crossed: self.vals(f(2)?)?,
            stack,
            ancestors: self.vals(f(4)?)?,
            waiting,
            owed: boolean(f(7)?)?,
        })))
    }

    fn kind(&self, vm: &mut Vm, j: &J) -> R<Kind> {
        if j.as_str() == Some("o") {
            return Ok(Kind::Ordinary);
        }
        let tag = at(j, 0)?.as_str().unwrap_or("").to_owned();
        let f = |i: usize| at(j, i);
        Ok(match tag.as_str() {
            "a" => Kind::Array(self.vals(f(1)?)?),
            "g" => Kind::Arguments(self.vals(f(1)?)?),
            "c" => {
                let proto = usize_(f(1)?)?;
                if proto >= self.protos {
                    return Err(invalid("a closure's function is not in the program."));
                }
                let upvals: Vec<u32> = f(2)?
                    .as_array()
                    .ok_or_else(|| invalid("a closure's cells are not a list."))?
                    .iter()
                    .map(u32_)
                    .collect::<R<_>>()?;
                let p = vm.protos[proto].clone();
                if upvals.len() != p.captures.len() {
                    return Err(invalid("a closure's cells do not match its captures."));
                }
                Kind::Closure(Box::new(Closure {
                    proto: p,
                    upvals: upvals.into(),
                    this: self.val(f(3)?)?,
                }))
            }
            "n" => {
                let i = usize_(f(1)?)?;
                let Some(native) = self.natives.list.get(i) else {
                    return Err(invalid("a native function is unknown."));
                };
                Kind::Native {
                    f: *native,
                    data: self.val(f(2)?)?,
                    name: u32_(f(3)?)?,
                    length: u32_(f(4)?)? as u8,
                    ctor: boolean(f(5)?)?,
                }
            }
            "b" => Kind::Bound(Box::new((
                self.val(f(1)?)?,
                self.val(f(2)?)?,
                self.vals(f(3)?)?,
            ))),
            "e" => Kind::Error(match f(1)? {
                J::Null => None,
                e => Some(Box::new(Failure {
                    kind: kind_named(&string(at(e, 0)?)?)?,
                    message: string(at(e, 1)?)?,
                    offset: opt_u32(at(e, 2)?)?,
                    site: Default::default(),
                })),
            }),
            "p" => {
                let s = f(1)?;
                let state = match at(s, 0)?.as_str() {
                    Some("pending") => PromiseState::Pending,
                    Some("ok") => PromiseState::Fulfilled(self.val(at(s, 1)?)?),
                    Some("err") => PromiseState::Rejected(self.val(at(s, 1)?)?),
                    _ => return Err(invalid("a promise state is unknown.")),
                };
                let reactions = f(2)?
                    .as_array()
                    .ok_or_else(|| invalid("reactions are not a list."))?
                    .iter()
                    .map(|r| self.reaction(r))
                    .collect::<R<_>>()?;
                Kind::Promise(Box::new(PromiseData { state, reactions }))
            }
            "m" => Kind::Map(self.map(vm, f(1)?)?),
            "s" => Kind::Set(self.map(vm, f(1)?)?),
            "wm" => Kind::WeakMap(self.map(vm, f(1)?)?),
            "ws" => Kind::WeakSet(self.map(vm, f(1)?)?),
            "gen" => Kind::Generator(self.gen_state(vm, f(1)?)?),
            "ai" | "mi" | "xi" => {
                let target = self.id(f(1)?)?;
                let pos = u32_(f(2)?)?;
                let kind = Self::iter_kind(f(3)?)?;
                match tag.as_str() {
                    "ai" => Kind::ArrayIter { target, pos, kind },
                    "mi" => Kind::MapIter { target, pos, kind },
                    _ => Kind::ExoticIter { target, pos, kind },
                }
            }
            "si" => {
                let s = u32_(f(1)?)?;
                if s as usize >= self.bufs_len {
                    return Err(invalid("a string iterator's string is out of range."));
                }
                Kind::StrIter {
                    s,
                    pos: u32_(f(2)?)?,
                }
            }
            "li" => Kind::ListIter {
                items: self.vals(f(1)?)?.into(),
                pos: u32_(f(2)?)?,
            },
            "t" => Kind::Namespace(NsPath {
                parent: match f(1)? {
                    J::Null => NsPath::ROOT,
                    p => self.id(p)?,
                },
                name: u32_(f(2)?)?,
            }),
            "r" => Kind::Resolvers {
                promise: self.id(f(1)?)?,
                done: boolean(f(2)?)?,
            },
            "x" => self.cross(f)?,
            "cb" => Kind::Combinator(Box::new(Combinator {
                kind: match uint(f(1)?)? {
                    0 => CombKind::All,
                    1 => CombKind::AllSettled,
                    _ => CombKind::Any,
                },
                promise: self.id(f(2)?)?,
                values: self.vals(f(3)?)?,
                remaining: usize_(f(4)?)?,
            })),
            "re" => {
                let source = string(f(1)?)?;
                let flags = string(f(2)?)?;
                let (regex, flags) = crate::builtins::regexp::compile(&source, &flags)
                    .map_err(|_| invalid("a regular expression does not compile."))?;
                Kind::RegExp(Box::new(crate::builtins::regexp::RegExpData {
                    source,
                    flags,
                    regex,
                    last_index: unnum(f(3)?)?,
                }))
            }
            "d" => Kind::Date(unnum(f(1)?)?),
            "y" => {
                let i = usize_(f(1)?)?;
                let Some(buf) = self.buffers.get(i) else {
                    return Err(invalid("a byte array's buffer is missing."));
                };
                let (start, len) = (usize_(f(2)?)?, usize_(f(3)?)?);
                if start + len
                    > buf
                        .lock()
                        .unwrap_or_else(std::sync::PoisonError::into_inner)
                        .len()
                {
                    return Err(invalid("a byte array's view is out of range."));
                }
                Kind::Bytes(Box::new(crate::builtins::bytes::Bytes {
                    buf: buf.clone(),
                    start,
                    len,
                    buffer: boolean(f(4)?)?,
                }))
            }
            "td" => Kind::TextDecoder(Box::new(crate::builtins::bytes::Decoder {
                fatal: boolean(f(1)?)?,
                ignore_bom: boolean(f(2)?)?,
                queued: hex_bytes(&string(f(3)?)?)?,
                seen: boolean(f(4)?)?,
            })),
            "ih" => {
                use crate::builtins::iterator::{Helper, HelperOp, HelperState};
                let op = f(3)?;
                let op = match at(op, 0)?.as_str() {
                    Some("wrap") => HelperOp::Wrap,
                    Some("map") => HelperOp::Map(self.val(at(op, 1)?)?),
                    Some("filter") => HelperOp::Filter(self.val(at(op, 1)?)?),
                    Some("take") => HelperOp::Take(unnum(at(op, 1)?)?),
                    Some("drop") => HelperOp::Drop(unnum(at(op, 1)?)?),
                    Some("flatmap") => HelperOp::FlatMap(
                        self.val(at(op, 1)?)?,
                        match at(op, 2)? {
                            J::Null => None,
                            p => Some((self.val(at(p, 0)?)?, self.val(at(p, 1)?)?)),
                        },
                    ),
                    _ => return Err(invalid("an iterator helper is unknown.")),
                };
                let state = match uint(f(5)?)? {
                    0 => HelperState::Start,
                    1 => HelperState::Suspended,
                    2 => HelperState::Running,
                    _ => HelperState::Done,
                };
                Kind::IterHelper(Box::new(Helper {
                    iter: self.val(f(1)?)?,
                    next: self.val(f(2)?)?,
                    op,
                    counter: unnum(f(4)?)?,
                    state,
                    site: self.val(f(6)?)?,
                }))
            }
            "url" => {
                let url = url::Url::parse(&string(f(1)?)?)
                    .map_err(|_| invalid("a URL does not parse."))?;
                Kind::Url(Box::new(crate::builtins::web::UrlData {
                    url,
                    params: self.id(f(2)?)?,
                }))
            }
            "sp" => Kind::SearchParams(Box::new(crate::builtins::web::Params {
                list: pairs(f(1)?)?,
                url: self.opt_id(f(2)?)?,
            })),
            "h" => Kind::Headers(Box::new(crate::builtins::web::HeaderList {
                list: pairs(f(1)?)?,
            })),
            "live" => match list(Some(f(1)?))?.first() {
                Some(name) => {
                    let name = string(name)?;
                    return Err(invalid(format!("the accessor {name} has no original.")));
                }
                None => Kind::Ordinary,
            },
            "ag" => {
                let phase = match uint(f(2)?)? {
                    0 => AsyncPhase::Start,
                    1 => AsyncPhase::Yield,
                    2 => AsyncPhase::Executing,
                    3 => AsyncPhase::AwaitingReturn,
                    _ => AsyncPhase::Completed,
                };
                let mut queue = VecDeque::new();
                for r in f(3)?
                    .as_array()
                    .ok_or_else(|| invalid("a request queue is not a list."))?
                {
                    queue.push_back(AsyncRequest {
                        kind: u32_(at(r, 0)?)? as u8,
                        value: self.val(at(r, 1)?)?,
                        promise: self.id(at(r, 2)?)?,
                    });
                }
                Kind::AsyncGenerator(Box::new(AsyncGen {
                    state: self.gen_state(vm, f(1)?)?,
                    phase,
                    queue,
                }))
            }
            "afs" => Kind::AsyncFromSync {
                sync: self.id(f(1)?)?,
                next: self.val(f(2)?)?,
            },
            _ => return Err(invalid(format!("an object kind {tag} is unknown."))),
        })
    }

    fn job(&self, j: &J) -> R<Job> {
        Ok(match at(j, 0)?.as_str() {
            Some("r") => Job::Reaction(self.reaction(at(j, 1)?)?, self.outcome(at(j, 2)?)?),
            Some("t") => Job::Thenable {
                promise: self.id(at(j, 1)?)?,
                thenable: self.val(at(j, 2)?)?,
                then: self.val(at(j, 3)?)?,
            },
            _ => return Err(invalid("a job is unknown.")),
        })
    }
}

fn pairs(j: &J) -> R<Vec<(String, String)>> {
    j.as_array()
        .ok_or_else(|| invalid("a list of pairs is not a list."))?
        .iter()
        .map(|p| Ok((string(at(p, 0)?)?, string(at(p, 1)?)?)))
        .collect()
}

/// A saved state, checked against this runtime and ready to resume.
pub struct Restored {
    pub code: String,
    pub run_id: Option<String>,
    pub metadata: crate::Data,
    /// The shape of the host globals it was saved with (`hosts_id`).
    pub hosts: String,
    pub limits: Limits,
    pub active_ms: u64,
}

/// Reads a state's header, checking it belongs to this build and its source matches its hash; the run's setup then
/// checks its host globals (`hosts_id`).
pub fn header(snapshot: &Snapshot) -> R<Restored> {
    let s = &snapshot.0;
    if s.get("format").and_then(J::as_u64) != Some(FORMAT) {
        return Err(invalid("its format is unknown."));
    }
    let header = field(s, "header")?;
    let build = field(header, "build")?.as_str().unwrap_or("");
    let expected = build_id();
    if build != expected {
        return Err(SnapshotError::new(format!(
            "This state was saved by another PsychoScript build ({build}); this runtime is {expected}, so it can't resume it."
        )));
    }
    let source = field(header, "source")?;
    let code = string(field(source, "code")?)?;
    if field(source, "hash")?.as_str() != Some(hex(hash(code.as_bytes())).as_str()) {
        return Err(SnapshotError::new("Source main does not match its hash."));
    }
    let limits = field(header, "limits")?;
    let opt = |name: &str| field(limits, name).map(J::as_u64);
    let budget = field(header, "budget")?;
    Ok(Restored {
        code,
        run_id: field(header, "runId")?.as_str().map(str::to_owned),
        metadata: match header.get("metadataData") {
            Some(saved) if !saved.is_null() => crate::Data::from_host(&host_value_from(saved)?),
            _ => crate::Data::from_json(header.get("metadata").unwrap_or(&J::Null)),
        },
        hosts: string(field(header, "hosts")?)?,
        limits: Limits {
            timeout_ms: opt("timeoutMs")?,
            max_output_bytes: opt("maxOutputBytes")?.map(|n| n as usize),
        },
        active_ms: field(budget, "activeMs")?.as_u64().unwrap_or(0),
    })
}

/// Fills `vm`, made fresh for the saved program (compiled, set up and loaded with no bindings), with the state.
pub fn restore(vm: &mut Vm, snapshot: &Snapshot, program_hash: &str) -> R<()> {
    let s = &snapshot.0;
    let header = field(s, "header")?;
    let source = field(header, "source")?;
    if field(source, "bytecode")?.as_str() != Some(program_hash) {
        return Err(SnapshotError::new(
            "Source main compiles to other bytecode in this build, so it can't resume.",
        ));
    }
    let base = field(header, "base")?;
    let base = Base {
        heap: usize_(at(base, 0)?)?,
        bufs: usize_(at(base, 1)?)?,
        atoms: usize_(at(base, 2)?)?,
        cells: usize_(at(base, 3)?)?,
        functions: usize_(at(base, 4)?)?,
    };
    if base != vm.snapshot_base {
        return Err(invalid(
            "the state's built-ins do not match this runtime's.",
        ));
    }
    let st = field(s, "state")?;

    // Strings first: values refer to them.
    let mut texts = Vec::new();
    for t in field_list(st, "strings")? {
        texts.push((string(at(t, 0)?)?, boolean(at(t, 1)?)?));
    }
    let atoms: Vec<u32> = field_list(st, "atoms")?
        .iter()
        .map(u32_)
        .collect::<R<_>>()?;
    vm.atoms.restore(texts, atoms).map_err(invalid)?;

    let rest = field_list(st, "heap")?;
    let changed = field_list(st, "changed")?;
    let mut buffers = Vec::new();
    for b in field_list(st, "buffers")? {
        buffers.push(Arc::new(std::sync::Mutex::new(hex_bytes(&string(b)?)?)));
    }
    let dec = Dec {
        natives: natives(),
        heap_len: base.heap + rest.len(),
        bufs_len: vm.atoms.counts().0,
        protos: vm.protos.len(),
        buffers,
        _p: std::marker::PhantomData,
    };
    if vm.heap.len() != base.heap {
        return Err(invalid(
            "the state's built-ins do not match this runtime's.",
        ));
    }
    // Placeholders first, so objects can refer forward; then each one decoded in place.
    for _ in 0..rest.len() {
        vm.heap.push(Obj::new(None, Kind::Ordinary));
    }
    for c in changed {
        let id = usize_(at(c, 0)?)?;
        if id >= base.heap {
            return Err(invalid("a changed built-in is out of range."));
        }
        vm.heap[id] = dec.obj(vm, at(c, 1)?)?;
    }
    for (i, o) in rest.iter().enumerate() {
        vm.heap[base.heap + i] = dec.obj(vm, o)?;
    }

    let cells = field_list(st, "cells")?;
    vm.cells.truncate(base.cells);
    for c in cells {
        vm.cells.push(dec.slot(c)?);
    }
    vm.stack = dec.slots(field(st, "stack")?)?;
    vm.frames = field_list(st, "frames")?
        .iter()
        .map(|f| dec.frame(vm, f))
        .collect::<R<_>>()?;
    vm.recount_frames();
    *vm.handlers_mut() = dec.handlers(field(st, "handlers")?)?;
    vm.globals = dec.vals(field(st, "globals")?)?;
    if vm.globals.len() != vm.global_names.len() {
        return Err(invalid("the program's globals do not match."));
    }
    vm.global_map.clear();
    for g in field_list(st, "globalMap")? {
        vm.global_map.insert(u32_(at(g, 0)?)?, dec.val(at(g, 1)?)?);
    }
    let templates: Vec<Option<Id>> = field_list(st, "templates")?
        .iter()
        .map(|t| dec.opt_id(t))
        .collect::<R<_>>()?;
    if templates.len() != vm.template_objs_ref().len() {
        return Err(invalid("the program's template sites do not match."));
    }
    *vm.template_objs_mut() = templates;
    vm.jobs = field_list(st, "jobs")?
        .iter()
        .map(|j| dec.job(j))
        .collect::<R<_>>()?;
    vm.coroutines = field_list(st, "coroutines")?
        .iter()
        .map(|c| {
            Ok(Coroutine {
                saved: match at(c, 0)? {
                    J::Null => None,
                    sv => Some(dec.saved(vm, sv)?),
                },
                promise: dec.opt_id(at(c, 1)?)?,
            })
        })
        .collect::<R<_>>()?;
    vm.logs = field_list(st, "logs")?
        .iter()
        .map(string)
        .collect::<R<_>>()?;
    vm.rng = field(st, "rng")?
        .as_str()
        .and_then(|r| r.parse().ok())
        .ok_or_else(|| invalid("the random state is malformed."))?;
    let std = field_list(st, "std")?;
    let id = |i: usize| -> R<Id> {
        u32_(
            std.get(i)
                .ok_or_else(|| invalid("built-in prototypes are missing."))?,
        )
    };
    let realm = &mut vm.realm.std;
    realm.regexp = id(0)?;
    realm.date = id(1)?;
    realm.uint8 = id(2)?;
    realm.buffer = id(3)?;
    realm.text_encoder = id(4)?;
    realm.text_decoder = id(5)?;
    realm.weak_map = id(6)?;
    realm.weak_set = id(7)?;
    realm.iterator_helper = id(8)?;
    realm.uri_error = id(9)?;
    realm.url = id(10)?;
    realm.params = id(11)?;
    realm.headers = id(12)?;
    realm.loaded = id(13)? as u8;

    restore_host(vm, &dec, field(st, "host")?, base)?;
    let inbox = field_list(st, "inbox")?;
    for i in inbox {
        let entry = restore_settlement(vm, &dec, i)?;
        vm.inbox.push_back(entry);
    }
    Ok(())
}

fn restore_settlement(vm: &mut Vm, dec: &Dec, j: &J) -> R<(Id, Settlement)> {
    let p = dec.id(at(j, 0)?)?;
    let s = match at(j, 1)?.as_str() {
        Some("undef") => Settlement::Undefined,
        Some("fail") => Settlement::Failure(host::Failed::from_parts(
            kind_named(&string(at(j, 2)?)?)?,
            text_from(at(j, 3)?)?,
            texts_from(at(j, 4)?)?,
        )),
        Some("host") => {
            let ok = boolean(at(j, 2)?)?;
            let label = string(at(j, 3)?)?;
            let owner = opt_string(at(j, 4)?)?;
            let hooked = boolean(at(j, 5)?)?;
            let saved = at(j, 6)?;
            // The reference saves a value with no data form (a live response) as a `Lost`, which can't cross into the
            // program once the run resumes: the call fails there, at the place that names it.
            let site = j.get(7).and_then(J::as_u64).map(|s| s as u32);
            if ok && let Some(at_label) = lost_path(saved, &label) {
                let message = format!("{at_label} produced a Lost, which the program cannot hold.");
                return Ok((p, Settlement::Lost(message, site)));
            }
            let mut v = host_value_from(saved)?;
            if hooked && let Some(owner) = &owner {
                v = decode(vm, owner, v)?;
            }
            Settlement::host(if ok { Ok(v) } else { Err(v) }, label, owner, site)
        }
        Some("lost") => Settlement::Lost(
            string(at(j, 2)?)?,
            j.get(3).and_then(J::as_u64).map(|s| s as u32),
        ),
        Some("interrupted") => Settlement::Interrupted,
        _ => return Err(invalid("a settlement is unknown.")),
    };
    Ok((p, s))
}

fn opt_string(j: &J) -> R<Option<String>> {
    match j {
        J::Null => Ok(None),
        other => string(other).map(Some),
    }
}

fn opt_path(j: &J) -> R<Option<Vec<crate::HostString>>> {
    match j {
        J::Null => Ok(None),
        other => texts_from(other).map(Some),
    }
}

/// A value its owner's `snapshot` hooks bring back from their data.
fn decode(vm: &Vm, owner: &str, data: HostValue) -> R<HostValue> {
    let hooks = vm.host.hooks(owner).ok_or_else(|| {
        SnapshotError::new(format!("The host function {owner} has no snapshot hooks."))
    })?;
    Ok((hooks.decode)(data))
}

fn restore_host(vm: &mut Vm, dec: &Dec, j: &J, base: Base) -> R<()> {
    vm.host.next_call = uint(field(j, "nextCall")?)?;
    // Results their owners' hooks saved: decoded once each, their functions taken in order.
    let mut restored: Vec<(usize, Vec<HostFunction>)> = Vec::new();
    for r in field_list(j, "results")? {
        let owner = string(at(r, 0)?)?;
        let value = decode(vm, &owner, host_value_from(at(r, 1)?)?)?;
        let mut fns = Vec::new();
        collect_functions(&value, &mut fns);
        let start = usize_(at(r, 2)?)?;
        let end = usize_(at(r, 3)?)?;
        if fns.len() != end.saturating_sub(start) {
            return Err(SnapshotError::new(format!(
                "The host function {owner} restored a value of another shape, so this state can't resume."
            )));
        }
        restored.push((start, fns));
        vm.host.results.push(ResultRoot {
            owner,
            value,
            functions: start..end,
        });
    }
    vm.host.functions.truncate(base.functions);
    for (i, f) in field_list(j, "functions")?.iter().enumerate() {
        let index = base.functions + i;
        let label = string(at(f, 0)?)?;
        let path = opt_path(at(f, 1)?)?;
        let owner = opt_string(at(f, 2)?)?;
        let installed = boolean(at(f, 3)?)?;
        let name = string(at(f, 4)?)?;
        let from_root = restored
            .iter()
            .find_map(|(start, fns)| index.checked_sub(*start).and_then(|k| fns.get(k)).cloned());
        // A function among the globals is found again at its path; one inside a result through its owner's hooks.
        let found = match &path {
            Some(path) => vm.host.resolve(path),
            None => from_root.map(Callee::Fn),
        };
        vm.host.functions.push(FnEntry {
            f: found.unwrap_or_else(|| Callee::Fn(host::lost_function(&name))),
            label,
            path,
            owner,
            installed,
        });
    }
    vm.host.suggestions.clear();
    for s in field_list(j, "suggestions")? {
        vm.host
            .suggestions
            .insert(dec.id(at(s, 0)?)?, texts_from(at(s, 1)?)?);
    }
    vm.host.promise_like = dec.opt_id(field(j, "promiseLike")?)?;
    vm.host.unhandled = field_list(j, "unhandled")?
        .iter()
        .map(|u| Ok((dec.id(at(u, 0)?)?, dec.val(at(u, 1)?)?)))
        .collect::<R<_>>()?;
    vm.host.modules_loaded.clear();
    for m in field_list(j, "modules")? {
        vm.host
            .modules_loaded
            .insert(string(at(m, 0)?)?, dec.val(at(m, 1)?)?);
    }
    vm.host.namespaces.clear();
    for m in field_list(j, "namespaces")? {
        vm.host
            .namespaces
            .insert(string(at(m, 0)?)?, dec.val(at(m, 1)?)?);
    }
    // Calls in flight start again: an idempotent one reruns with its key, a started durable one waits on its data.
    for c in field_list(j, "calls")? {
        let start = at(c, 0)?;
        let label = string(at(c, 3)?)?;
        let path = opt_path(at(c, 4)?)?;
        let start = match at(start, 0)?.as_str() {
            Some("again") => host::Start::Again,
            Some("wait") => {
                let durable = path
                    .as_deref()
                    .and_then(|path| vm.host.resolve(path))
                    .is_some_and(|f| matches!(f, Callee::Durable(_)));
                let call = uint(at(c, 2)?)?;
                if !durable {
                    return Err(SnapshotError::new(format!(
                        "The pending durable call {} ({label}) cannot resume because that function is no longer a durable function in this runtime.",
                        vm.host.key(call)
                    )));
                }
                host::Start::Wait(crate::Data::from_host(&host_value_from(at(start, 1)?)?))
            }
            _ => return Err(invalid("a call in flight is unknown.")),
        };
        let restart = host::Restart {
            promise: dec.id(at(c, 1)?)?,
            call: uint(at(c, 2)?)?,
            label,
            path,
            args: at(c, 5)?
                .as_array()
                .ok_or_else(|| invalid("a call's arguments are not a list."))?
                .iter()
                .map(host_value_from)
                .collect::<R<_>>()?,
            owner: opt_string(at(c, 6)?)?,
            site: at(c, 7)?.as_u64().map(|s| s as u32),
            start,
        };
        vm.host.restarts.push(restart);
    }
    Ok(())
}

/// The calls a resumed run restarts, in the order they were in flight, so their futures start on the run's executor.
pub fn restart_calls(vm: &mut Vm) {
    for r in std::mem::take(&mut vm.host.restarts) {
        host::restart(vm, r);
    }
}
