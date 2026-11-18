//! The VM's side of host work: host function globals and modules, the host calls a run has in flight and how they
//! settle, and what the layer embedding the language (Code Mode, through [`Embedder`]) gives programs besides.
//! Arguments cross out and results cross in as copies.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use rustc_hash::FxHashMap;

use crate::exec::{BoxFuture, Tasks, block_on};
use crate::extension::{Body, HostError, HostFunction, HostResult, HostValue};
use crate::object::*;
use crate::strings::Atom;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Res, Vm};
use crate::{DiagnosticKind, Json};

/// Globals every program has before extensions apply, as the reference names them; an extension may not shadow one.
pub const BUILTIN_GLOBALS: &[&str] = &[
    "tools",
    "search",
    "require",
    "undefined",
    "NaN",
    "Infinity",
    "Object",
    "Function",
    "Array",
    "Math",
    "JSON",
    "console",
    "Promise",
    "Symbol",
    "Iterator",
    "Number",
    "String",
    "Boolean",
    "parseInt",
    "parseFloat",
    "isFinite",
    "isNaN",
    "Date",
    "RegExp",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "URL",
    "URLSearchParams",
    "Headers",
    "Uint8Array",
    "Buffer",
    "TextEncoder",
    "TextDecoder",
    "encodeURI",
    "encodeURIComponent",
    "decodeURI",
    "decodeURIComponent",
    "atob",
    "btoa",
    "crypto",
    "structuredClone",
    "globalThis",
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "EvalError",
    "URIError",
    "AggregateError",
];

/// The hidden global the compiler loads modules through. Not an identifier, so programs cannot name it.
pub const IMPORT_GLOBAL: &str = "%import";

/// How a host call settles its promise.
pub enum Settlement {
    Json(Json),
    Undefined,
    Failure(Box<Failed>),
    /// An extension call's value, or what it threw, with the label that names it in conversion errors, the
    /// extension it came from, whether its strings are run text already (`HostFunction::carrier`), and the source
    /// offset of the call, where an error converting its value points.
    Host(Box<(HostResult, String, String, bool, Option<u32>)>),
    /// A value a snapshot couldn't keep (a live response, the reference's `Lost`): the call fails with this message
    /// once the run resumes, at the call's source offset.
    Lost(String, Option<u32>),
    /// The call interrupts the whole run.
    Interrupted,
}

/// A host call's failure. Boxed, so the common successful settlement stays small.
pub struct Failed {
    kind: DiagnosticKind,
    message: String,
    suggestions: Vec<String>,
}

impl Failed {
    /// What the failure says.
    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}

impl Failed {
    /// A call's failure as its settlement.
    pub(crate) fn settlement(kind: DiagnosticKind, message: String) -> Settlement {
        Settlement::Failure(Failed::new(kind, message))
    }
}

impl Failed {
    pub fn parts(&self) -> (DiagnosticKind, &str, &[String]) {
        (self.kind, &self.message, &self.suggestions)
    }

    pub fn from_parts(
        kind: DiagnosticKind,
        message: String,
        suggestions: Vec<String>,
    ) -> Box<Self> {
        Box::new(Failed {
            kind,
            message,
            suggestions,
        })
    }

    #[cold]
    pub(crate) fn new(kind: DiagnosticKind, message: String) -> Box<Self> {
        Box::new(Failed {
            kind,
            message,
            suggestions: Vec::new(),
        })
    }
}

/// A host function the program holds: what it calls, the path that names it, and whether it is an entry point,
/// whose calls fire the extension hooks.
pub struct FnEntry {
    pub(crate) f: HostFunction,
    pub(crate) label: String,
    pub(crate) extension: String,
    pub(crate) entry: bool,
}

/// A host call in flight, as a suspend sees it.
pub struct Call {
    pub promise: Id,
    pub call: u64,
    /// How a suspend names it: `tools.x.y`, `search`, `fetch`.
    pub path: String,
    /// The tool's canonical path, for a tool call.
    pub tool: String,
    pub input: Json,
    pub kind: CallKind,
    /// Set when a suspend detaches the call, so its `tool.after` does not fire and its work is not cancelled.
    pub detached: Arc<AtomicBool>,
}

pub enum CallKind {
    /// A suspend is refused while it runs.
    Blocking,
    /// Interrupted on suspend and run again on resume.
    Idempotent,
    /// A durable call: its data once `start` returned it; a suspend is refused before that.
    Durable(Arc<Mutex<Option<Json>>>),
}

/// A host result whose functions an extension's `snapshot` hooks can bring back: the value as the host returned it,
/// and the range of `functions` made from it, in the order `from_host` visits them.
pub struct ResultRoot {
    pub extension: String,
    pub value: HostValue,
    pub functions: std::ops::Range<usize>,
}

/// A run's id, shared by its calls and made the first time a key is read, when the host gave none.
pub(crate) type RunId = Arc<std::sync::OnceLock<String>>;

/// The key of a run's host call, `<runId>:<callId>`, the same at every hook.
pub(crate) fn call_key(run_id: &RunId, call: u64) -> String {
    format!("{}:{}", run_id.get_or_init(random_run_id), call)
}

/// A random run id, as the reference uses a random UUID.
pub fn random_run_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
        ^ COUNTER.fetch_add(0x9e37_79b9_7f4a_7c15, Ordering::Relaxed);
    let mix = |mut z: u64| {
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    };
    let (a, b) = (mix(seed), mix(seed.wrapping_add(0x9e37_79b9_7f4a_7c15)));
    format!(
        "{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        a >> 32,
        (a >> 16) & 0xffff,
        a & 0x0fff,
        ((b >> 48) & 0x3fff) | 0x8000,
        b & 0xffff_ffff_ffff
    )
}

// ---------- the embedder ----------

/// What the language asks of the layer embedding it, Code Mode: the namespace of host functions it gives programs
/// (`tools`) and the blocking global that answers about them (`search`), what a snapshot needs about the calls in flight,
/// and the hooks it runs around a host function's calls. The language knows nothing else about tools.
pub(crate) trait Embedder: Sync {
    /// The embedder itself, for its own code to get back.
    fn as_any(&self) -> &dyn std::any::Any;
    /// A global the embedder makes when a program refers to it (`search`), or `None` when it has none by that name.
    fn global(&self, vm: &mut Vm<'_>, name: &str) -> Option<Value>;
    /// A call into the namespace, `tools.<path>(...args)`: its promise.
    fn call_namespace(&self, vm: &mut Vm<'_>, path: &str, args: &[Value]) -> Res;
    /// The blocking global's answer for its crossed arguments (`search(...)`).
    fn call_blocking(&self, vm: &mut Vm<'_>, args: &[Option<Json>]) -> Res;
    /// The names under a namespace path, as `Object.keys` lists them.
    fn namespace_keys(&self, path: &str) -> Vec<String>;
    /// Fails when a path whose names are listed names nothing in the namespace.
    fn require_namespace(&self, vm: &mut Vm<'_>, path: &str) -> Result<(), Value>;
    /// Stops the work of a started durable call to `path` when the run ends for real.
    fn cancel(&self, path: &str, data: Json);
    /// Whether a call in flight to `path` that a snapshot saved can start again, as a durable call when `durable`.
    fn restorable(&self, path: &str, durable: bool) -> Result<(), String>;
    /// Starts a restored call in flight again.
    fn restart(&self, vm: &mut Vm<'_>, p: Id, path: &str, input: Json, call: u64, start: Start);
    /// The natives the embedder makes, which a snapshot names after the language's own.
    fn natives(&self) -> &'static [NativeFn];
    /// Whether it watches calls to the host functions in globals; `before_call` and `after_call` are asked only then.
    fn watches_calls(&self) -> bool;
    /// What to wait for before a watched call goes ahead; failing denies it.
    fn before_call(&self, call: &HostCall) -> Option<BoxFuture<'static, Result<(), HostError>>>;
    /// A watched call ended.
    fn after_call(&self, call: &HostCall, ended: Ended<'_>);
}

/// A watched call: the function's extension, the label that names it, and its arguments as they crossed.
pub(crate) struct HostCall {
    pub extension: String,
    pub label: String,
    pub args: Vec<HostValue>,
}

/// How a watched call ended.
pub(crate) enum Ended<'a> {
    Returned(&'a HostResult),
    Interrupted,
}

/// No embedder: no namespace, no blocking global, no hooks; what a run made for the snapshot's tables uses.
pub(crate) struct NoEmbedder;

impl Embedder for NoEmbedder {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
    fn global(&self, _: &mut Vm<'_>, _: &str) -> Option<Value> {
        None
    }
    fn call_namespace(&self, vm: &mut Vm<'_>, path: &str, _: &[Value]) -> Res {
        Err(vm.type_error(&format!("{path} is not a function.")))
    }
    fn call_blocking(&self, _: &mut Vm<'_>, _: &[Option<Json>]) -> Res {
        Ok(Value::Undef)
    }
    fn namespace_keys(&self, _: &str) -> Vec<String> {
        Vec::new()
    }
    fn require_namespace(&self, _: &mut Vm<'_>, _: &str) -> Result<(), Value> {
        Ok(())
    }
    fn cancel(&self, _: &str, _: Json) {}
    fn restorable(&self, path: &str, _: bool) -> Result<(), String> {
        Err(format!(
            "This state has a call to {path} in flight, which this runtime doesn't have."
        ))
    }
    fn restart(&self, _: &mut Vm<'_>, _: Id, _: &str, _: Json, _: u64, _: Start) {}
    fn natives(&self) -> &'static [NativeFn] {
        &[]
    }
    fn watches_calls(&self) -> bool {
        false
    }
    fn before_call(&self, _: &HostCall) -> Option<BoxFuture<'static, Result<(), HostError>>> {
        None
    }
    fn after_call(&self, _: &HostCall, _: Ended<'_>) {}
}

/// What a run tells whoever may suspend it from another thread (Code Mode's suspenders), and asks of them.
pub(crate) trait SuspendWatch: Send + Sync {
    /// Whether a suspend is waiting for the run to reach a step boundary.
    fn requested(&self) -> bool;
    /// Whether anyone can suspend the run, so synchronous calls only record themselves when it matters.
    fn watched(&self) -> bool;
    /// A synchronous host call starts, named by its key and path: a suspend is refused until it returns.
    fn enter_sync(&self, key: String, path: String);
    fn leave_sync(&self);
}

/// No one can suspend the run.
struct Unwatched;

impl SuspendWatch for Unwatched {
    fn requested(&self) -> bool {
        false
    }
    fn watched(&self) -> bool {
        false
    }
    fn enter_sync(&self, _: String, _: String) {}
    fn leave_sync(&self) {}
}

impl RunHost<'_> {
    /// A synchronous host call starts: a suspend is refused until it returns (`SuspendWatch::enter_sync`).
    pub(crate) fn enter_sync(&self, call: u64, path: String) {
        if self.shared.watched() {
            self.shared.enter_sync(self.key(call), path);
        }
    }

    pub(crate) fn leave_sync(&self) {
        self.shared.leave_sync();
    }
}

/// The host state of one run.
pub struct RunHost<'rt> {
    /// The layer embedding the language, which made the run and outlives it.
    pub(crate) embedder: &'rt dyn Embedder,
    /// The embedder's own state in the run, which only it reads.
    pub(crate) embedded: Option<Box<dyn std::any::Any>>,
    /// The runtime's extensions this run gets, in the runtime's order.
    pub extensions: std::rc::Rc<[&'rt crate::Extension]>,
    /// Names the run's host calls; made on first use when the host gave none.
    pub(crate) run_id: RunId,
    pub(crate) next_call: u64,
    pub tasks: Tasks<'rt, Settlement>,
    pub(crate) functions: Vec<FnEntry>,
    /// Host calls in flight.
    pub calls: Vec<Call>,
    /// Results whose functions survive a suspend through their extension's hooks.
    pub results: Vec<ResultRoot>,
    /// Calls a resumed run starts again when it begins.
    pub restarts: Vec<(Id, String, Json, u64, Start)>,
    /// Whoever may suspend the run: what they ask of it, and the synchronous call that refuses them meanwhile.
    pub shared: Arc<dyn SuspendWatch>,
    /// Suggestions attached to failure values, by error object.
    pub suggestions: FxHashMap<Id, Vec<String>>,
    pub(crate) promise_like: Option<Id>,
    /// Whether a call interrupted the run.
    pub interrupted: bool,
    /// Rejected promises nothing handled yet, with their reasons, for the run's warnings.
    pub unhandled: Vec<(Id, Value)>,
    pub(crate) modules: FxHashMap<String, Value>,
    pub(crate) namespaces: FxHashMap<String, Value>,
    /// Counts the points where the reference hands queued calls to the host, for streaming responses.
    pub(crate) epoch: crate::streaming::Epoch,
    /// The VM's fuel counters, which it checks only when its step budget runs out.
    pub(crate) meter: Meter,
    /// Set while a carrier result (`HostFunction::carrier`) crosses in.
    pub(crate) carrier: bool,
}

/// The reference's fuel left (`handover`) and the steps left until the VM next checks the clock (`fuel`), as of when
/// the VM's step budget was last set to `start`.
pub(crate) struct Meter {
    pub start: i32,
    pub handover: i32,
    pub fuel: i32,
    /// Set by a built-in the reference writes in bytecode as it returns: see `Vm::bytecode_builtin`.
    pub bytecode: bool,
    /// Whether the native called last stands for a call of the reference's bytecode, which spends fifty on it: see
    /// `fuel::Conversions`.
    pub counted: bool,
}

impl<'rt> RunHost<'rt> {
    /// A point where the reference starts the calls queued so far: a new job, or a finished synchronous call.
    #[inline]
    pub fn next_epoch(&self) {
        use std::sync::atomic::Ordering::Relaxed;
        self.epoch.store(self.epoch.load(Relaxed) + 1, Relaxed);
    }

    pub(crate) fn new(
        embedder: &'rt dyn Embedder,
        extensions: std::rc::Rc<[&'rt crate::Extension]>,
        run_id: Option<String>,
    ) -> Self {
        Self {
            embedder,
            embedded: None,
            extensions,
            run_id: Arc::new(run_id.map(std::sync::OnceLock::from).unwrap_or_default()),
            next_call: 0,
            tasks: Tasks::default(),
            functions: Vec::new(),
            calls: Vec::new(),
            results: Vec::new(),
            restarts: Vec::new(),
            shared: Arc::new(Unwatched),
            suggestions: FxHashMap::default(),
            promise_like: None,
            interrupted: false,
            unhandled: Vec::new(),
            modules: FxHashMap::default(),
            namespaces: FxHashMap::default(),
            epoch: Default::default(),
            carrier: false,
            meter: Meter {
                start: crate::vm::HANDOVER_FUEL,
                handover: crate::vm::HANDOVER_FUEL,
                fuel: crate::vm::FUEL,
                bytecode: false,
                counted: false,
            },
        }
    }

    /// Whether host work is still in flight, so an idle program is waiting rather than stuck.
    pub fn waiting(&self) -> bool {
        !self.tasks.is_empty()
    }

    pub(crate) fn next_call(&mut self) -> u64 {
        let id = self.next_call;
        self.next_call += 1;
        id
    }

    pub fn run_id(&mut self) -> RunId {
        self.run_id.clone()
    }

    /// The key of the call with this id.
    pub fn key(&self, call: u64) -> String {
        call_key(&self.run_id, call)
    }

    /// A call settled: it is no longer in flight.
    pub fn settled(&mut self, promise: Id) {
        if let Some(i) = self.calls.iter().position(|c| c.promise == promise) {
            self.calls.swap_remove(i);
        }
    }

    /// Stops durable work still running when the run ends or is interrupted for real; a suspend detaches it first.
    pub fn cancel_durable(&mut self) {
        for call in std::mem::take(&mut self.calls) {
            let CallKind::Durable(data) = &call.kind else {
                continue;
            };
            if call.detached.load(Ordering::Relaxed) {
                continue;
            }
            let data = data.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(data) = data {
                self.embedder.cancel(&call.tool, data);
            }
        }
    }
}

impl Drop for RunHost<'_> {
    fn drop(&mut self) {
        self.cancel_durable();
    }
}

// ---------- setup ----------

/// Defines the host globals the program refers to: `search`, `require`, the import hook, and extension globals.
/// The rest are made only if a module import asks for them, so a run pays only for the globals it uses.
pub fn install(vm: &mut Vm, referenced: &[Atom]) {
    for &a in referenced {
        let name = vm.atoms.text(a).to_owned();
        define_host_global(vm, &name);
    }
}

/// Defines one host global by name; false when there is none.
fn define_host_global(vm: &mut Vm, name: &str) -> bool {
    let embedder = vm.host.embedder;
    if let Some(v) = embedder.global(vm, name) {
        global(vm, name, v);
        return true;
    }
    let v = match name {
        "require" => native(vm, "require", 1, require_native, Value::Undef),
        IMPORT_GLOBAL => native(vm, "import", 2, import_native, Value::Undef),
        _ => {
            let extensions = vm.host.extensions.clone();
            let found = extensions.iter().find_map(|extension| {
                extension
                    .globals()
                    .iter()
                    .find(|(n, _)| n == name)
                    .map(|(_, value)| (extension.name(), value))
            });
            let Some((extension, value)) = found else {
                return false;
            };
            from_host(vm, value, name, Some((extension, true)), 0).unwrap_or(Value::Undef)
        }
    };
    global(vm, name, v);
    true
}

fn global(vm: &mut Vm, name: &str, v: Value) {
    let a = vm.atoms.intern(name);
    vm.global_map.insert(a, v);
}

pub(crate) fn native(vm: &mut Vm, name: &str, length: u8, f: NativeFn, data: Value) -> Value {
    let name = vm.atoms.intern(name);
    let proto = vm.realm.function_proto;
    Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::Native {
            f,
            data,
            name,
            length,
            ctor: false,
        },
    )))
}

// ---------- host calls ----------

/// A host call's arguments as JSON, or the failure converting them met (`cross::tool_args`).
pub(crate) type Crossed = Result<Vec<Option<Json>>, Box<Failed>>;

/// How a tool call's future begins: a new call, an idempotent call run again on resume, or a started durable call
/// reconnected to its work through its data.
pub enum Start {
    Call,
    Again,
    Wait(Json),
}

/// A promise was rejected with nothing to handle it: a warning, unless something handles it before the run ends.
pub fn unhandled(vm: &mut Vm, p: Id, reason: Value) {
    if vm.fatal.is_none() {
        vm.host.unhandled.push((p, reason));
    }
}

/// A reaction was attached to a rejected promise, so its rejection is handled after all.
#[inline]
pub fn handled(vm: &mut Vm, p: Id) {
    if !vm.host.unhandled.is_empty() {
        vm.host.unhandled.retain(|(q, _)| *q != p);
    }
}

/// Stops the run at once: it ends interrupted, and calls still running are interrupted with it.
pub fn interrupt(vm: &mut Vm) {
    vm.host.interrupted = true;
    if vm.fatal.is_none() {
        vm.fatal = Some((
            DiagnosticKind::ExecutionFailure,
            crate::diagnostic::Interrupted.to_string(),
        ));
    }
}

/// Settles a host call's promise with what it ended with.
#[inline]
pub fn settle(vm: &mut Vm, p: Id, s: Settlement) {
    match s {
        Settlement::Interrupted => interrupt(vm),
        Settlement::Json(json) => {
            let v = crate::convert::from_json(vm, &json);
            vm.fulfill(p, v);
        }
        Settlement::Undefined => vm.fulfill(p, Value::Undef),
        Settlement::Failure(f) => {
            let e = failure_value(vm, f.kind, f.message, f.suggestions);
            vm.reject(p, e);
        }
        Settlement::Lost(message, site) => {
            let e = vm.type_error(&message);
            locate_at(vm, &e, site);
            vm.reject(p, e);
        }
        Settlement::Host(host) => match *host {
            (Ok(v), label, extension, carrier, site) => {
                vm.host.carrier = carrier;
                let v = result_from_host(vm, v, &label, &extension);
                vm.host.carrier = false;
                match v {
                    Ok(v) => vm.fulfill(p, v),
                    Err(e) => {
                        // The reference converts the value at the call, so its errors point there.
                        locate_at(vm, &e, site);
                        vm.reject(p, e)
                    }
                }
            }
            (Err(thrown), label, _, _, _) => {
                let e = from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e);
                vm.reject(p, e);
            }
        },
    }
}

/// Points an error the VM made, not yet located, at a host call's source offset.
pub(crate) fn locate_at(vm: &mut Vm, e: &Value, site: Option<u32>) {
    if let Value::Obj(id) = e
        && let Kind::Error(Some(f)) = &mut vm.heap[*id as usize].kind
        && f.offset.is_none()
    {
        f.offset = site;
    }
}

/// A host call's failure as the error the program sees.
pub(crate) fn failed_value(vm: &mut Vm, f: Failed) -> Value {
    failure_value(vm, f.kind, f.message, f.suggestions)
}

fn failure_value(
    vm: &mut Vm,
    kind: DiagnosticKind,
    message: String,
    suggestions: Vec<String>,
) -> Value {
    let proto = vm.realm.error_proto;
    let e = vm.failure(proto, &message, kind);
    if !suggestions.is_empty()
        && let Value::Obj(id) = e
    {
        vm.host.suggestions.insert(id, suggestions);
    }
    e
}

// ---------- extensions ----------

/// How the reference describes a value that cannot be passed to the host.
pub(crate) fn describe(vm: &Vm, v: &Value) -> &'static str {
    match v {
        Value::Sym(_) => "a symbol",
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => "a function",
            Kind::ToolRef(_) => "a namespace reference",
            Kind::Promise(_) => "an un-awaited Promise",
            Kind::Generator(_) | Kind::AsyncGenerator(_) => "a generator",
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. }
            | Kind::IterHelper(_)
            | Kind::AsyncFromSync { .. } => "an iterator",
            _ => "an object",
        },
        _ => "a value",
    }
}

/// A function's own name, as it was made.
pub(crate) fn function_name(vm: &Vm, v: &Value) -> String {
    match v {
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Native { name, .. } => vm.atoms.text(*name).to_owned(),
            _ => String::new(),
        },
        _ => String::new(),
    }
}

/// The host function behind a function the program got inside a host result, which crosses back as itself to a host
/// function that takes functions. The functions among the globals don't: what the host runs around their calls runs
/// only when the program calls them.
fn hosted(vm: &Vm, id: Id) -> Option<HostFunction> {
    let Kind::Native {
        f,
        data: Value::Num(index),
        ..
    } = &vm.heap[id as usize].kind
    else {
        return None;
    };
    if !std::ptr::fn_addr_eq(*f, extension_native as crate::vm::NativeFn) {
        return None;
    }
    let entry = vm.host.functions.get(*index as usize)?;
    (!entry.entry).then(|| entry.f.clone())
}

/// An extension function's arguments as host values, as the reference's `toHost` copies them under Code Mode's
/// translation (see `to_host`), or the promises among them to wait for first.
fn host_args(
    vm: &mut Vm,
    args: &[Value],
    label: &str,
) -> Result<crate::cross::Args<Vec<HostValue>>, Value> {
    let mut waiting = Vec::new();
    let mut out = Vec::with_capacity(args.len());
    for (i, a) in args.iter().enumerate() {
        let mut seen = Vec::new();
        let label = format!("Argument {} to {label}", i + 1);
        let v = to_host(vm, a, &label, 0, &mut seen, &mut waiting)?;
        out.push(v.unwrap_or(HostValue::Undefined));
    }
    if !waiting.is_empty() {
        return Ok(crate::cross::Args::Wait(waiting));
    }
    Ok(crate::cross::Args::Ready(out))
}

/// A program value copied out for a host function, as the reference's `toHost` copies it: a function is left out
/// (`None`: an object's key is skipped, an array's item is `null`, a Map's or Set's is undefined), unless it came from
/// a host result, when it crosses back as the host function; a fulfilled promise is its value, and one that hasn't
/// fulfilled goes in `waiting`, for the call to wait for.
fn to_host(
    vm: &mut Vm,
    v: &Value,
    label: &str,
    depth: usize,
    seen: &mut Vec<Id>,
    waiting: &mut Vec<Value>,
) -> Result<Option<HostValue>, Value> {
    if depth > crate::convert::MAX_VALUE_DEPTH {
        let msg = format!(
            "{label} exceeds the maximum value depth of {}.",
            crate::convert::MAX_VALUE_DEPTH
        );
        return Err(vm.type_error(&msg));
    }
    let id = match v {
        Value::Undef | Value::Uninit => return Ok(Some(HostValue::Undefined)),
        Value::Null => return Ok(Some(HostValue::Null)),
        Value::Bool(b) => return Ok(Some(HostValue::Bool(*b))),
        Value::Num(n) => return Ok(Some(HostValue::Number(*n))),
        Value::Str(s) => {
            return Ok(Some(HostValue::String(
                crate::strings::host_text(vm.text(*s)).into_owned(),
            )));
        }
        Value::Sym(_) => {
            let msg = format!("{label} contains a symbol, which cannot be passed to the host.");
            return Err(vm.type_error(&msg));
        }
        Value::Obj(id) => *id,
    };
    if let Some(f) = hosted(vm, id) {
        return Ok(Some(HostValue::Function(f)));
    }
    if vm.heap[id as usize].is_callable() {
        return Ok(None);
    }
    if seen.contains(&id) {
        return Err(vm.type_error(&format!("{label} contains a circular value.")));
    }
    if let Kind::Promise(p) = &vm.heap[id as usize].kind {
        let PromiseState::Fulfilled(result) = p.state else {
            waiting.push(*v);
            return Ok(Some(HostValue::Undefined));
        };
        seen.push(id);
        let out = to_host(vm, &result, label, depth + 1, seen, waiting)?;
        seen.pop();
        return Ok(out);
    }
    if crate::cross::opaque(&vm.heap[id as usize].kind) {
        let msg = format!(
            "{label} contains {}, which cannot be passed to the host.",
            describe(vm, v)
        );
        return Err(vm.type_error(&msg));
    }
    seen.push(id);
    // A child left out of a Map or a Set is undefined there.
    let kept = |vm: &mut Vm, item: &Value, seen: &mut Vec<Id>, waiting: &mut Vec<Value>| {
        to_host(vm, item, label, depth + 1, seen, waiting).map(Option::unwrap_or_default)
    };
    let out = match &vm.heap[id as usize].kind {
        Kind::Date(t) => HostValue::Date(*t),
        Kind::RegExp(r) => HostValue::RegExp {
            source: r.source.clone(),
            flags: r.flags.clone(),
        },
        Kind::Url(_) => HostValue::Url(crate::builtins::web::url_href(vm, id)),
        Kind::SearchParams(p) => HostValue::SearchParams(p.list.clone()),
        Kind::Headers(h) => HostValue::Headers(crate::builtins::web::header_entries(&h.list)),
        Kind::Bytes(b) => {
            let data = b.to_vec();
            if b.buffer {
                HostValue::Buffer(data)
            } else {
                HostValue::Bytes(data)
            }
        }
        Kind::Array(_) if vm.heap[id as usize].flags & SPARSE != 0 => {
            vm.densify(id)?;
            seen.pop();
            return to_host(vm, v, label, depth, seen, waiting);
        }
        Kind::Array(items) => {
            let items = items.clone();
            let mut out = Vec::with_capacity(items.len());
            for item in &items {
                out.push(match item {
                    Value::Uninit => None,
                    item => Some(
                        to_host(vm, item, label, depth + 1, seen, waiting)?
                            .unwrap_or(HostValue::Null),
                    ),
                });
            }
            HostValue::Array(out)
        }
        Kind::Map(m) | Kind::Set(m) => {
            let is_map = matches!(vm.heap[id as usize].kind, Kind::Map(_));
            let entries: Vec<(Value, Value)> = m.entries.iter().flatten().copied().collect();
            if is_map {
                let mut out = Vec::with_capacity(entries.len());
                for (k, val) in &entries {
                    let k = kept(vm, k, seen, waiting)?;
                    out.push((k, kept(vm, val, seen, waiting)?));
                }
                HostValue::Map(out)
            } else {
                let mut out = Vec::with_capacity(entries.len());
                for (k, _) in &entries {
                    out.push(kept(vm, k, seen, waiting)?);
                }
                HostValue::Set(out)
            }
        }
        Kind::Error(_) => {
            let (name, message) = crate::convert::error_parts(vm, id);
            let name = crate::cross::host_error_name(vm, id, name);
            let mut error = HostError::named(
                crate::strings::host_text(&name).into_owned(),
                crate::strings::host_text(&message).into_owned(),
            );
            let cause_key = vm.names.cause;
            // A field that cannot cross is left behind, so the error itself always arrives.
            let mut left_behind = |vm: &mut Vm, item: &Value, seen: &mut Vec<Id>| {
                let at = seen.len();
                match to_host(vm, item, label, depth + 1, seen, waiting) {
                    Ok(item) => Ok(item),
                    Err(e) if vm.fatal.is_some() => Err(e),
                    Err(_) => {
                        seen.truncate(at);
                        Ok(None)
                    }
                }
            };
            if vm.has_own(id, cause_key) {
                let cause = vm.get_obj(id, cause_key);
                if let Some(c) = left_behind(vm, &cause, seen)? {
                    error.cause = Some(Box::new(c));
                }
            }
            for (k, val) in vm.own_entries(id) {
                let key = crate::strings::host_text(vm.atoms.text(k)).into_owned();
                if crate::cross::uncrossed(&key) || k == cause_key {
                    continue;
                }
                if let Some(item) = left_behind(vm, &val, seen)? {
                    error.fields.push((key, item));
                }
            }
            HostValue::Error(Box::new(error))
        }
        _ => {
            let mut out = Vec::new();
            for (k, val) in vm.own_entries(id) {
                let key = crate::strings::host_text(vm.atoms.text(k)).into_owned();
                if key == "__proto__" {
                    continue;
                }
                if let Some(item) = to_host(vm, &val, label, depth + 1, seen, waiting)? {
                    out.push((key, item));
                }
            }
            HostValue::Object(out)
        }
    };
    seen.pop();
    Ok(Some(out))
}

/// A host value copied in. `entry` is the extension of a global object whose functions are entry points.
fn from_host(
    vm: &mut Vm,
    v: &HostValue,
    label: &str,
    entry: Option<(&str, bool)>,
    depth: usize,
) -> Result<Value, Value> {
    if depth > crate::convert::MAX_VALUE_DEPTH {
        let msg = format!(
            "{label} exceeds the maximum value depth of {}.",
            crate::convert::MAX_VALUE_DEPTH
        );
        return Err(vm.type_error(&msg));
    }
    let next = |key: &str| format!("{label}.{key}");
    Ok(match v {
        HostValue::Undefined => Value::Undef,
        HostValue::Null => Value::Null,
        HostValue::Bool(b) => Value::Bool(*b),
        HostValue::Number(n) => Value::Num(*n),
        HostValue::String(s) if vm.host.carrier => vm.str_val(s),
        HostValue::String(s) => vm.string_val(crate::strings::external_text(s.clone())),
        HostValue::Function(f) => wrap(vm, f, label, entry),
        HostValue::Array(items) => {
            if items.len() > 10_000_000 {
                let msg = format!(
                    "{label} produced an array of {} items; at most 10000000 can cross.",
                    items.len()
                );
                return Err(vm.range_error(&msg));
            }
            let mut out = Vec::with_capacity(items.len());
            for (i, item) in items.iter().enumerate() {
                out.push(match item {
                    Some(item) => from_host(vm, item, &format!("{label}[{i}]"), entry, depth + 1)?,
                    None => Value::Uninit,
                });
            }
            vm.new_array(out)
        }
        HostValue::Object(fields) => {
            let id = vm.new_object();
            for (k, item) in fields {
                let val = from_host(vm, item, &next(k), entry, depth + 1)?;
                let key = vm.atoms.intern(k);
                vm.define(id, key, val);
            }
            Value::Obj(id)
        }
        HostValue::Date(t) => {
            crate::builtins::date::new_date(vm, crate::builtins::date::time_clip(*t))
        }
        HostValue::RegExp { source, flags } => {
            crate::builtins::regexp::new_regexp(vm, source, flags)?
        }
        HostValue::Url(href) => match url::Url::parse(href) {
            Ok(u) => crate::builtins::web::new_url(vm, u),
            Err(_) => {
                let msg = format!("{label} produced an invalid URL '{href}'.");
                return Err(vm.type_error(&msg));
            }
        },
        HostValue::SearchParams(list) => crate::builtins::web::new_params(vm, list.clone()),
        HostValue::Headers(list) => {
            // As `new Headers(...)` leaves them: lowercase names and values without surrounding HTTP whitespace.
            let list = list
                .iter()
                .map(|(k, v)| {
                    let v = v.trim_matches(|c| matches!(c, '\t' | '\n' | '\r' | ' '));
                    (k.to_ascii_lowercase(), v.to_owned())
                })
                .collect();
            crate::builtins::web::new_headers(vm, list)
        }
        HostValue::Bytes(data) => crate::builtins::bytes::new_bytes(vm, data.clone(), false),
        HostValue::Buffer(data) => crate::builtins::bytes::new_bytes(vm, data.clone(), true),
        HostValue::Response(response) => response_from_host(vm, response, label, entry, depth)?,
        HostValue::Map(entries) => {
            let proto = vm.realm.map_proto;
            let id = vm.alloc(Obj::new(Some(proto), Kind::Map(Box::default())));
            for (k, item) in entries {
                let k = from_host(vm, k, label, entry, depth + 1)?;
                let item = from_host(vm, item, label, entry, depth + 1)?;
                let mk = vm.map_key(&k);
                if let Kind::Map(m) = &mut vm.heap[id as usize].kind {
                    m.set(mk, k, item);
                }
            }
            Value::Obj(id)
        }
        HostValue::Set(items) => {
            let proto = vm.realm.set_proto;
            let id = vm.alloc(Obj::new(Some(proto), Kind::Set(Box::default())));
            for item in items {
                let k = from_host(vm, item, label, entry, depth + 1)?;
                let mk = vm.map_key(&k);
                if let Kind::Set(m) = &mut vm.heap[id as usize].kind {
                    m.set(mk, k, Value::Undef);
                }
            }
            Value::Obj(id)
        }
        HostValue::Error(e) => {
            let proto = match e.name.as_str() {
                "TypeError" => vm.realm.type_error_proto,
                "RangeError" => vm.realm.range_error_proto,
                "SyntaxError" => vm.realm.syntax_error_proto,
                "ReferenceError" => vm.realm.reference_error_proto,
                "AggregateError" => vm.realm.aggregate_error_proto,
                _ => vm.realm.error_proto,
            };
            let err = vm.make_error(proto, &e.message);
            if let Value::Obj(id) = err {
                if let Some(cause) = &e.cause
                    && let Ok(c) = from_host(vm, cause, &next("cause"), None, depth + 1)
                {
                    let key = vm.names.cause;
                    vm.define_hidden(id, key, c);
                }
                for (k, item) in &e.fields {
                    if matches!(
                        k.as_str(),
                        "stack" | "message" | "constructor" | "toString" | "__proto__"
                    ) {
                        continue;
                    }
                    if matches!(item, HostValue::Function(_)) {
                        continue;
                    }
                    if let Ok(val) = from_host(vm, item, &next(k), None, depth + 1) {
                        let key = vm.atoms.intern(k);
                        vm.define(id, key, val);
                    }
                }
            }
            err
        }
    })
}

/// A streaming response as the reference hands it over: its fields, a live `bodyUsed`, the reading methods, and a
/// `body` with a live `locked`, `cancel`, `getReader` and async iteration.
fn response_from_host(
    vm: &mut Vm,
    response: &crate::streaming::StreamingResponse,
    label: &str,
    entry: Option<(&str, bool)>,
    depth: usize,
) -> Result<Value, Value> {
    use crate::streaming::Live;
    let surface = crate::streaming::surface(response, &vm.host.epoch);
    let proto = vm.realm.object_proto;
    let body_used = vm.atoms.intern_static("bodyUsed");
    let result = vm.alloc(Obj::new(
        Some(proto),
        Kind::Live(Box::new(Live {
            accessors: vec![(body_used, surface.body_used)],
        })),
    ));
    let body = match surface.body {
        Some((cancel, get_reader, iterate, locked)) => {
            let key = vm.atoms.intern_static("locked");
            let body = vm.alloc(Obj::new(
                Some(proto),
                Kind::Live(Box::new(Live {
                    accessors: vec![(key, locked)],
                })),
            ));
            let methods = [
                (vm.atoms.intern_static("cancel"), cancel, "cancel"),
                (vm.atoms.intern_static("getReader"), get_reader, "getReader"),
                (
                    crate::object::SYM_ASYNC_ITERATOR,
                    iterate,
                    "[Symbol.asyncIterator]",
                ),
            ];
            for (key, f, name) in methods {
                let path = if name.starts_with('[') {
                    format!("{label}.body{name}")
                } else {
                    format!("{label}.body.{name}")
                };
                let f = wrap(vm, &f, &path, entry);
                vm.define(body, key, f);
            }
            Value::Obj(body)
        }
        None => Value::Null,
    };
    let fields = [
        ("url", HostValue::String(response.url.clone())),
        ("status", HostValue::Number(response.status as f64)),
        (
            "statusText",
            HostValue::String(response.status_text.clone()),
        ),
        ("ok", HostValue::Bool(response.ok())),
        ("headers", HostValue::Headers(response.headers.clone())),
    ];
    for (key, v) in fields {
        let v = from_host(vm, &v, &format!("{label}.{key}"), entry, depth + 1)?;
        let key = vm.atoms.intern(key);
        vm.define(result, key, v);
    }
    let key = vm.atoms.intern_static("redirected");
    vm.define(result, key, Value::Bool(response.redirected));
    let key = vm.atoms.intern_static("body");
    vm.define(result, key, body);
    for (key, f) in surface.methods {
        let f = wrap(vm, &f, &format!("{label}.{key}"), entry);
        let key = vm.atoms.intern(key);
        vm.define(result, key, f);
    }
    Ok(Value::Obj(result))
}

/// A host call's result copied in. When its extension has `snapshot` hooks and the value holds functions, the value
/// is kept so a suspend can save them.
fn result_from_host(
    vm: &mut Vm,
    v: HostValue,
    label: &str,
    extension: &str,
) -> Result<Value, Value> {
    let start = vm.host.functions.len();
    let out = from_host(vm, &v, label, None, 0);
    let end = vm.host.functions.len();
    let hooked = vm
        .host
        .extensions
        .iter()
        .any(|e| e.name() == extension && e.snapshot_hooks().is_some());
    if end > start && hooked {
        vm.host.results.push(ResultRoot {
            extension: extension.to_owned(),
            value: v,
            functions: start..end,
        });
    }
    out
}

/// Natives the host makes, which a snapshot names like the built-ins'.
pub fn snapshot_natives() -> [NativeFn; 4] {
    [
        require_native,
        import_native,
        extension_native,
        crate::cross::park,
    ]
}

/// A function the run lost on resume: calling it throws.
pub fn lost_function(name: &str) -> HostFunction {
    let shown = if name.is_empty() { "(anonymous)" } else { name };
    let message = format!(
        "The function {shown} came from the host and was lost when the run was suspended; get it again after resuming."
    );
    HostFunction {
        name: name.to_owned(),
        length: 0,
        body: Body::Lost(message.into()),
        carrier: false,
        constructible: false,
    }
}

/// A host function as a program function, at `label`. Inside a global object, it is an entry point. A constructible
/// entry point is called the same way by `new`; a function inside a result never is, as in the reference.
fn wrap(vm: &mut Vm, f: &HostFunction, label: &str, entry: Option<(&str, bool)>) -> Value {
    let constructible = f.constructible && entry.is_some_and(|(_, e)| e);
    let index = vm.host.functions.len();
    vm.host.functions.push(FnEntry {
        f: f.clone(),
        label: label.to_owned(),
        extension: entry.map(|(e, _)| e.to_owned()).unwrap_or_default(),
        entry: entry.is_some_and(|(_, e)| e),
    });
    let made = native(
        vm,
        &f.name.clone(),
        f.length,
        extension_native,
        Value::Num(index as f64),
    );
    if constructible
        && let Value::Obj(id) = made
        && let Kind::Native { ctor, .. } = &mut vm.heap[id as usize].kind
    {
        *ctor = true;
    }
    made
}

fn extension_native(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let Value::Num(index) = vm.native_data(callee) else {
        return Ok(Value::Undef);
    };
    let entry = &vm.host.functions[index as usize];
    if let Body::Lost(message) = &entry.f.body {
        let message = message.clone();
        return Err(vm.type_error(&message));
    }
    let (f, label, extension, hooked) = (
        entry.f.clone(),
        entry.label.clone(),
        entry.extension.clone(),
        entry.entry,
    );
    let extension_name = extension.clone();
    let host_args = match extension_args(vm, &f, args, &label, callee)? {
        Ok(host_args) => host_args,
        Err(made) => return Ok(made),
    };
    let embedder = vm.host.embedder;
    let watched = (hooked && embedder.watches_calls()).then(|| HostCall {
        extension,
        label: label.clone(),
        args: host_args.clone(),
    });
    match &f.body {
        Body::Sync(body) => {
            let call_id = vm.host.next_call();
            vm.host.enter_sync(call_id, label.clone());
            if let Some(call) = &watched
                && let Some(before) = embedder.before_call(call)
                && let Err(e) = block_on(before)
            {
                vm.host.leave_sync();
                let thrown = HostValue::Error(Box::new(e));
                return Err(from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e));
            }
            let result = body(host_args);
            vm.host.leave_sync();
            vm.host.next_epoch();
            if let Some(call) = &watched {
                embedder.after_call(call, Ended::Returned(&result));
            }
            match result {
                Ok(v) => {
                    let site = vm.call_offset();
                    result_from_host(vm, v, &label, &extension_name)
                        .inspect_err(|e| locate_at(vm, e, site))
                }
                Err(thrown) => Err(from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e)),
            }
        }
        Body::Lost(_) => unreachable!("refused above"),
        Body::Async(body) => {
            let site = vm.call_offset();
            let p = vm.new_promise();
            let body = body.clone();
            let carrier = f.carrier;
            let call_id = vm.host.next_call();
            let path = label.clone();
            let future: BoxFuture<'_, Settlement> = Box::pin(async move {
                if let Some(call) = &watched
                    && let Some(before) = embedder.before_call(call)
                    && let Err(e) = before.await
                {
                    return Settlement::Host(Box::new((
                        Err(HostValue::Error(Box::new(e))),
                        label,
                        extension_name,
                        false,
                        site,
                    )));
                }
                let guard = ExtensionGuard {
                    embedder,
                    call: watched,
                };
                let result = body(host_args).await;
                guard.end(&result);
                Settlement::Host(Box::new((result, label, extension_name, carrier, site)))
            });
            match vm.host.tasks.spawn(p, future) {
                Poll::Ready(s) => vm.inbox.push_back((p, s)),
                Poll::Pending => vm.host.calls.push(Call {
                    promise: p,
                    call: call_id,
                    path,
                    tool: String::new(),
                    input: Json::Null,
                    kind: CallKind::Blocking,
                    detached: Arc::new(AtomicBool::new(false)),
                }),
            }
            Ok(Value::Obj(p))
        }
    }
}

/// An extension function's arguments as they cross to the host (`Ok(Ok)`), or what the call gives the program instead
/// (`Ok(Err)`): an `async` function's promise when crossing failed or the call waits for promises among them; a
/// synchronous function's wait, or its failure, throws or enters the wait's frame.
fn extension_args(
    vm: &mut Vm,
    f: &HostFunction,
    args: &[Value],
    label: &str,
    callee: Id,
) -> Result<Result<Vec<HostValue>, Value>, Value> {
    let is_async = matches!(f.body, Body::Async(_));
    match host_args(vm, args, label) {
        Ok(crate::cross::Args::Ready(host_args)) => Ok(Ok(host_args)),
        Ok(crate::cross::Args::Wait(promises)) if is_async => {
            let p = vm.new_promise();
            crate::cross::wait_async(vm, promises, Value::Obj(callee), args, p);
            Ok(Err(Value::Obj(p)))
        }
        Ok(crate::cross::Args::Wait(promises)) => {
            crate::cross::wait_sync(vm, promises, Value::Obj(callee), args).map(Err)
        }
        Err(e) if is_async && vm.fatal.is_none() => {
            let p = vm.new_promise();
            vm.reject(p, e);
            Ok(Err(Value::Obj(p)))
        }
        Err(e) => Err(e),
    }
}

/// Tells the embedder a watched async call ended: how it returned, or, when the call is dropped first, that it was
/// interrupted.
struct ExtensionGuard<'h> {
    embedder: &'h dyn Embedder,
    call: Option<HostCall>,
}

impl ExtensionGuard<'_> {
    fn end(mut self, result: &HostResult) {
        if let Some(call) = self.call.take() {
            self.embedder.after_call(&call, Ended::Returned(result));
        }
    }
}

impl Drop for ExtensionGuard<'_> {
    fn drop(&mut self) {
        if let Some(call) = self.call.take() {
            self.embedder.after_call(&call, Ended::Interrupted);
        }
    }
}

// ---------- modules ----------

fn module_name(specifier: &str) -> &str {
    specifier.strip_prefix("node:").unwrap_or(specifier)
}

fn global_value(vm: &mut Vm, name: &str) -> Option<Value> {
    let a = vm.atoms.intern(name);
    if !vm.global_map.contains_key(&a) && !crate::builtins::ensure_global(vm, name) {
        define_host_global(vm, name);
    }
    match vm.global_map.get(&a) {
        Some(Value::Undef) | None => None,
        Some(v) => Some(*v),
    }
}

/// A module, as `require` returns it and a default import binds it: a global, by its Node module name.
fn module(vm: &mut Vm, specifier: &str) -> Res {
    let name = module_name(specifier).to_owned();
    if let Some(v) = vm.host.modules.get(&name) {
        return Ok(*v);
    }
    // A module name an extension of this run gives one of its globals; a later extension's wins.
    let extensions = vm.host.extensions.clone();
    let named = extensions.iter().rev().find_map(|e| {
        e.modules()
            .iter()
            .find(|(m, _)| *m == name)
            .map(|(_, global)| global.as_str())
    });
    let found = match global_value(vm, &name) {
        Some(v) => Some(v),
        None => match named.and_then(|global| global_value(vm, global)) {
            Some(v) => Some(v),
            None => alias(vm, &name)?,
        },
    };
    let Some(found) = found else {
        let message = cannot_import(specifier);
        let proto = vm.realm.error_proto;
        // A failure, as the reference throws it at the import: the diagnostic says where.
        return Err(vm.failure(proto, &message, DiagnosticKind::ExecutionFailure));
    };
    vm.host.modules.insert(name, found);
    Ok(found)
}

/// The globals that provide Node's other names for them.
fn alias(vm: &mut Vm, name: &str) -> Result<Option<Value>, Value> {
    Ok(match name {
        "fs/promises" => match global_value(vm, "fs") {
            Some(fs @ Value::Obj(_)) => {
                let key = vm.atoms.intern("promises");
                match vm.get(&fs, key)? {
                    Value::Undef => None,
                    v => Some(v),
                }
            }
            _ => None,
        },
        "url" => pick(vm, &["URL", "URLSearchParams"]),
        "util" => pick(vm, &["TextEncoder", "TextDecoder"]),
        "buffer" => pick(vm, &["Buffer", "atob", "btoa"]),
        _ => None,
    })
}

/// Why `specifier` can't be loaded, split so the error names the kind of import that failed.
fn cannot_import(specifier: &str) -> String {
    if specifier.starts_with('.') || specifier.starts_with('/') || specifier.starts_with("file:") {
        return format!("Cannot import \"{specifier}\": local files can't be imported.");
    }
    if is_runtime_module(specifier) {
        return format!("Cannot import \"{specifier}\": this runtime doesn't provide it.");
    }
    format!("Cannot import \"{specifier}\": packages can't be installed here.")
}

/// Node's core modules, fixed so every host gives the same answer, as the reference fixes them.
const CORE_MODULES: &[&str] = &[
    "assert",
    "async_hooks",
    "buffer",
    "child_process",
    "cluster",
    "console",
    "constants",
    "crypto",
    "dgram",
    "diagnostics_channel",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "http2",
    "https",
    "inspector",
    "module",
    "net",
    "os",
    "path",
    "perf_hooks",
    "process",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "sys",
    "timers",
    "tls",
    "trace_events",
    "tty",
    "url",
    "util",
    "v8",
    "vm",
    "wasi",
    "worker_threads",
    "zlib",
];

/// Whether a specifier names a module a runtime provides, as Node's and Bun's own modules are, rather than a package.
fn is_runtime_module(specifier: &str) -> bool {
    specifier.starts_with("node:")
        || specifier == "bun"
        || specifier.starts_with("bun:")
        || CORE_MODULES.contains(&specifier.split('/').next().unwrap_or_default())
}

fn pick(vm: &mut Vm, names: &[&str]) -> Option<Value> {
    let found: Vec<(&str, Value)> = names
        .iter()
        .filter_map(|n| global_value(vm, n).map(|v| (*n, v)))
        .collect();
    if found.is_empty() {
        return None;
    }
    let id = vm.alloc(Obj::new(None, Kind::Ordinary));
    for (name, v) in found {
        let key = vm.atoms.intern(name);
        vm.define(id, key, v);
    }
    Some(Value::Obj(id))
}

/// What `import * as` and `import()` see: the module's own properties, and the module itself as `default`.
fn namespace(vm: &mut Vm, specifier: &str) -> Res {
    let module = module(vm, specifier)?;
    let name = module_name(specifier).to_owned();
    if let Some(v) = vm.host.namespaces.get(&name) {
        return Ok(*v);
    }
    let id = vm.alloc(Obj::new(None, Kind::Ordinary));
    if let Value::Obj(m) = module {
        for (k, v) in vm.own_entries(m) {
            vm.define(id, k, v);
        }
    }
    let key = vm.atoms.intern("default");
    vm.define(id, key, module);
    vm.host.namespaces.insert(name, Value::Obj(id));
    Ok(Value::Obj(id))
}

fn require_native(vm: &mut Vm, _this: Value, args: &[Value], _callee: Id) -> Res {
    let Some(Value::Str(s)) = args.first() else {
        return Err(vm.type_error("require expects a module name string."));
    };
    let specifier = crate::strings::host_text(vm.text(*s)).into_owned();
    module(vm, &specifier)
}

/// The compiler's import hook: `%import(specifier, kind, name)`. Kinds: 0 a default import, 1 a namespace, 2 a
/// named export, 3 a side-effect import, 4 `import()`.
fn import_native(vm: &mut Vm, _this: Value, args: &[Value], _callee: Id) -> Res {
    let specifier = match args.first() {
        Some(Value::Str(s)) => crate::strings::host_text(vm.text(*s)).into_owned(),
        Some(other) => {
            let other = *other;
            let s = vm.string_of(&other)?;
            crate::strings::host_text(vm.text(s)).into_owned()
        }
        None => String::new(),
    };
    let kind = match args.get(1) {
        Some(Value::Num(n)) => *n as u8,
        _ => 0,
    };
    match kind {
        0 => module(vm, &specifier),
        1 => namespace(vm, &specifier),
        2 => {
            let ns = namespace(vm, &specifier)?;
            let Some(Value::Str(name)) = args.get(2) else {
                return Ok(Value::Undef);
            };
            let name = vm.text(*name).to_owned();
            let key: Atom = vm.atoms.intern(&name);
            let ns_id = ns.as_obj().unwrap_or(0);
            if !vm.has_own(ns_id, key) {
                let msg = format!("\"{specifier}\" has no export named \"{name}\".");
                return Err(vm.syntax_error(&msg));
            }
            Ok(vm.get_obj(ns_id, key))
        }
        3 => module(vm, &specifier).map(|_| Value::Undef),
        _ => {
            let p = vm.new_promise();
            match namespace(vm, &specifier) {
                Ok(ns) => vm.fulfill(p, ns),
                // The rejection reports the `import()`, as the reference locates it.
                Err(e) => {
                    let site = vm.call_offset();
                    locate_at(vm, &e, site);
                    vm.reject(p, e)
                }
            }
            Ok(Value::Obj(p))
        }
    }
}
