//! The VM's side of host work: the run's host globals (see [`crate::host_function`]) and modules, the host calls a run
//! has in flight and how they settle. Arguments cross out and results cross in as copies.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use rustc_hash::FxHashMap;

use crate::exec::{BoxFuture, Tasks, block_on};
use crate::host_function::{
    Body, DurableCall, DurableFunction, HostError, HostFunction, HostResult, HostString, HostValue,
    Namespace, Resolved, Returned, SnapshotHooks,
};
use crate::object::*;
use crate::runtime::{Run, Translate, TranslateFunctions, TranslatePromises};
use crate::strings::Atom;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Res, Vm};
use crate::{Data, DiagnosticKind};

/// The names bound in every program before its host globals, as the reference's `globalNames` lists them.
pub const GLOBAL_NAMES: &[&str] = &[
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
    Undefined,
    Failure(Box<Failed>),
    /// A host call's value, or what it threw.
    Host(Box<Settled>),
    /// A value a snapshot couldn't keep (a live response, the reference's `Lost`): the call fails with this message
    /// once the run resumes, at the call's source offset.
    Lost(String, Option<u32>),
    /// The call interrupts the whole run.
    Interrupted,
}

/// A host call's outcome, with what converting it needs.
pub struct Settled {
    pub result: HostResult,
    /// Names the call in conversion errors.
    pub label: String,
    /// The global host function whose `snapshot` hooks save functions in the value, by label.
    pub owner: Option<String>,
    /// The source offset of the call, where an error converting its value points.
    pub site: Option<u32>,
}

impl Settlement {
    pub(crate) fn host(
        result: HostResult,
        label: String,
        owner: Option<String>,
        site: Option<u32>,
    ) -> Self {
        Settlement::Host(Box::new(Settled {
            result,
            label,
            owner,
            site,
        }))
    }
}

/// A host call's failure. Boxed, so the common successful settlement stays small.
pub struct Failed {
    kind: DiagnosticKind,
    message: HostString,
    suggestions: Vec<HostString>,
}

impl Failed {
    pub fn parts(&self) -> (&DiagnosticKind, &HostString, &[HostString]) {
        (&self.kind, &self.message, &self.suggestions)
    }

    pub fn from_parts(
        kind: DiagnosticKind,
        message: HostString,
        suggestions: Vec<HostString>,
    ) -> Box<Self> {
        Box::new(Failed {
            kind,
            message,
            suggestions,
        })
    }
}

/// What a program function made from the host calls: a host function, or a durable one.
#[derive(Clone)]
pub enum Callee {
    Fn(HostFunction),
    Durable(DurableFunction),
}

impl Callee {
    /// Its own name, or `None` when it is to be named by where it is.
    fn name(&self) -> Option<&str> {
        match self {
            Callee::Fn(f) if f.own_name || !f.name.is_empty() => Some(f.name()),
            _ => None,
        }
    }

    fn length(&self) -> u8 {
        match self {
            Callee::Fn(f) => f.length,
            Callee::Durable(_) => 0,
        }
    }
}

/// A host function the program holds: what it calls, and where it is.
pub struct FnEntry {
    pub(crate) f: Callee,
    /// How the program names it in errors: `fetch`, `fs.readFile`, `api.issues.list`.
    pub(crate) label: String,
    /// Where it is among the run's host globals, so a resumed run can find it again; none inside a result.
    pub(crate) path: Option<Vec<HostString>>,
    /// The global host function whose `snapshot` hooks save the values this function returns, by label.
    pub(crate) owner: Option<String>,
    /// Whether it is among the globals, even where no path leads (inside an array): such a function never crosses
    /// back to the host as itself.
    pub(crate) installed: bool,
}

/// A host call in flight, as a suspend sees it.
pub struct InFlight {
    pub promise: Id,
    pub call: u64,
    /// How the program names the function: `fetch`, `api.issues.list`.
    pub label: String,
    /// Where the function is among the globals, to find it again on resume.
    pub path: Option<Vec<HostString>>,
    /// The arguments as they crossed, for a call that starts again on resume.
    pub args: Vec<HostValue>,
    pub owner: Option<String>,
    pub site: Option<u32>,
    pub kind: CallKind,
    /// Whether host functions crossed back among its arguments: a suspend is refused until it completes.
    pub holds_functions: bool,
    /// Set when a suspend detaches the call, so its durable work is not cancelled.
    pub detached: Arc<AtomicBool>,
}

pub enum CallKind {
    /// A suspend is refused while it runs.
    Blocking,
    /// Interrupted on suspend and run again on resume.
    Idempotent,
    /// A durable call: its data once `start` returned it (a suspend is refused before that), and what cancels it.
    Durable(Arc<Mutex<Option<Data>>>, DurableFunction, DurableCall),
}

/// A host result whose functions its owner's `snapshot` hooks can bring back: the value as the host returned it,
/// and the range of `functions` made from it, in the order `from_host` visits them.
pub struct ResultRoot {
    pub owner: String,
    pub value: HostValue,
    pub functions: std::ops::Range<usize>,
}

/// A run's id, shared by its calls and made the first time it is read, when the host gave none.
pub(crate) type RunId = Arc<std::sync::OnceLock<String>>;

/// The key of a run's host call, `<runId>:<callId>`.
pub(crate) fn call_key(run_id: &RunId, call: u64) -> String {
    format!("{}:{}", run_id.get_or_init(random_run_id), call)
}

/// A random run id, as the reference uses a random UUID.
pub fn random_run_id() -> String {
    use std::sync::atomic::AtomicU64;
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

/// What a run tells whoever may suspend it from another thread (its program's suspenders), and asks of them.
pub(crate) trait SuspendWatch: Send + Sync {
    /// Whether a suspend is waiting for the run to reach a step boundary.
    fn requested(&self) -> bool;
    /// Whether anyone can suspend the run, so synchronous calls only record themselves when it matters.
    fn watched(&self) -> bool;
    /// A synchronous host call starts, named by its key and label: a suspend is refused until it returns.
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

/// The host globals a run gets, made by the runtime's `globals(run)` when it starts or resumes.
pub type Globals = Arc<[(String, HostValue)]>;

/// The host state of one run.
pub struct RunHost {
    /// The run's host globals.
    pub(crate) globals: Globals,
    /// Module names that load a global, beyond its own name.
    pub(crate) modules: Arc<[(String, String)]>,
    pub(crate) translate: Translate,
    /// The run as its globals see it: its id and metadata.
    pub(crate) run: Run,
    pub(crate) next_call: u64,
    pub tasks: Tasks<'static, Settlement>,
    pub(crate) functions: Vec<FnEntry>,
    /// Host calls in flight.
    pub calls: Vec<InFlight>,
    /// Results whose functions survive a suspend through their owner's hooks.
    pub results: Vec<ResultRoot>,
    /// Calls a resumed run starts again when it begins.
    pub restarts: Vec<Restart>,
    /// Calls made since the last handover, which start at the next one (`launch`), as the reference queues them for
    /// its driver.
    pub(crate) queued: Vec<Queued>,
    /// Whoever may suspend the run: what they ask of it, and the synchronous call that refuses them meanwhile.
    pub shared: Arc<dyn SuspendWatch>,
    /// Set once the run is being suspended: an interruption then detaches a call instead of ending it.
    pub(crate) suspending: Arc<AtomicBool>,
    /// Suggestions attached to failure values, by error object.
    pub suggestions: FxHashMap<Id, Vec<HostString>>,
    pub(crate) promise_like: Option<Id>,
    /// Whether a call interrupted the run.
    pub interrupted: bool,
    /// Moving long stretches of compute to a worker thread, for a run driven as a future. Boxed: the VM's hot fields
    /// sit after this struct, and a few more bytes here measurably slow its dispatch loop.
    pub(crate) offload: Option<Box<crate::offload::Offload>>,
    /// Rejected promises nothing handled yet, with their reasons, for the run's warnings.
    pub unhandled: Vec<(Id, Value)>,
    pub(crate) modules_loaded: FxHashMap<String, Value>,
    pub(crate) namespaces: FxHashMap<String, Value>,
    /// The host namespaces among the globals, by the label of the global they are, with where they are.
    /// The host namespaces among the globals, by the atom of the label of the global they are, with where they are.
    pub(crate) host_namespaces: FxHashMap<Atom, (Namespace, Vec<HostString>)>,
    /// Counts the points where the reference hands queued calls to the host, for streaming responses.
    pub(crate) epoch: crate::streaming::Epoch,
    /// The VM's fuel counters, which it checks only when its step budget runs out.
    pub(crate) meter: Meter,
}

/// A call in flight a resumed run starts again: its promise, id, label, path, arguments, owner, site, and how.
pub struct Restart {
    pub promise: Id,
    pub call: u64,
    pub label: String,
    pub path: Option<Vec<HostString>>,
    pub args: Vec<HostValue>,
    pub owner: Option<String>,
    pub site: Option<u32>,
    pub start: Start,
}

/// A call that starts at the next handover: an async or durable function's call, or the work a synchronous function
/// left pending.
pub(crate) enum Queued {
    Call(Id, Callee, Box<Restart>, bool),
    Work(Id, BoxFuture<'static, Settlement>, Box<InFlight>),
}

/// Starts the calls made since the last handover, in the order they were made: the reference hands its queued calls
/// to the driver at every stop.
pub fn launch(vm: &mut Vm) {
    for queued in std::mem::take(&mut vm.host.queued) {
        match queued {
            Queued::Call(p, f, r, holds) => spawn_call(vm, p, &f, *r, holds),
            Queued::Work(p, work, in_flight) => track(vm, p, work, || *in_flight),
        }
    }
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

impl RunHost {
    /// A point where the reference starts the calls queued so far: a new job, or a finished synchronous call.
    #[inline]
    pub fn next_epoch(&self) {
        use std::sync::atomic::Ordering::Relaxed;
        self.epoch.store(self.epoch.load(Relaxed) + 1, Relaxed);
    }

    pub(crate) fn new(
        globals: Globals,
        modules: Arc<[(String, String)]>,
        translate: Translate,
        run: Run,
    ) -> Self {
        Self {
            globals,
            modules,
            translate,
            run,
            next_call: 0,
            tasks: Tasks::default(),
            functions: Vec::new(),
            calls: Vec::new(),
            results: Vec::new(),
            restarts: Vec::new(),
            queued: Vec::new(),
            shared: Arc::new(Unwatched),
            suspending: Arc::default(),
            suggestions: FxHashMap::default(),
            promise_like: None,
            interrupted: false,
            unhandled: Vec::new(),
            offload: None,
            modules_loaded: FxHashMap::default(),
            namespaces: FxHashMap::default(),
            host_namespaces: FxHashMap::default(),
            epoch: Default::default(),
            meter: Meter {
                start: crate::vm::HANDOVER_FUEL,
                handover: crate::vm::HANDOVER_FUEL,
                fuel: crate::vm::FUEL,
                bytecode: false,
                counted: false,
            },
        }
    }

    /// A run with no host globals, for what the snapshot's tables need.
    pub(crate) fn bare() -> Self {
        Self::new(
            Arc::from([]),
            Arc::from([]),
            Translate::default(),
            Run::new(None, Data::Null),
        )
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

    /// The key of the call with this id.
    pub fn key(&self, call: u64) -> String {
        call_key(&self.run.id, call)
    }

    /// What a host function's call gets.
    pub(crate) fn call(&self, call: u64) -> crate::host_function::Call {
        crate::host_function::Call::new(self.run.id.clone(), call, self.suspending.clone())
    }

    /// A synchronous host call starts: a suspend is refused until it returns (`SuspendWatch::enter_sync`).
    pub(crate) fn enter_sync(&self, call: u64, label: String) {
        if self.shared.watched() {
            self.shared.enter_sync(self.key(call), label);
        }
    }

    pub(crate) fn leave_sync(&self) {
        self.shared.leave_sync();
    }

    /// A call settled: it is no longer in flight.
    pub fn settled(&mut self, promise: Id) {
        if let Some(i) = self.calls.iter().position(|c| c.promise == promise) {
            self.calls.swap_remove(i);
        }
    }

    /// The run's offload state, made on first use.
    pub(crate) fn offload(&mut self) -> &mut crate::offload::Offload {
        self.offload.get_or_insert_default()
    }

    /// Stops durable work still running when the run ends or is interrupted for real; a suspend detaches it first.
    pub fn cancel_durable(&mut self) {
        for call in std::mem::take(&mut self.calls) {
            let CallKind::Durable(data, f, durable) = &call.kind else {
                continue;
            };
            if call.detached.load(Ordering::Relaxed) {
                continue;
            }
            let data = data.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let Some(data) = data {
                block_on((f.cancel)(data, durable.clone()));
            }
        }
    }

    /// The snapshot hooks of the global host function labelled `owner`.
    pub(crate) fn hooks(&self, owner: &str) -> Option<SnapshotHooks> {
        let mut found = None;
        for (name, value) in self.globals.iter() {
            labeled_functions(value, name, &mut |label, f| {
                if found.is_none() && label == owner {
                    found = f.snapshot.clone();
                }
            });
        }
        found
    }

    /// The function at `path` among the globals now, through objects and namespaces, as the reference's
    /// `hosts.resolve` finds it for a resumed call.
    pub(crate) fn resolve(&self, path: &[HostString]) -> Option<Callee> {
        let (first, rest) = path.split_first()?;
        let mut at = &self.globals.iter().find(|(name, _)| first == name)?.1;
        for (index, key) in rest.iter().enumerate() {
            match at {
                HostValue::Namespace(ns) => {
                    return match (ns.resolve)(&rest[index..]) {
                        Resolved::Function(f) => Some(Callee::Fn(f)),
                        Resolved::Durable(f) => Some(Callee::Durable(f)),
                        Resolved::Missing(_) => None,
                    };
                }
                HostValue::Object(fields) => at = &fields.iter().find(|(k, _)| k == key)?.1,
                _ => return None,
            }
        }
        match at {
            HostValue::Function(f) => Some(Callee::Fn(f.clone())),
            HostValue::Durable(f) => Some(Callee::Durable(f.clone())),
            _ => None,
        }
    }
}

impl Drop for RunHost {
    fn drop(&mut self) {
        self.cancel_durable();
    }
}

/// Visits the functions of a global value with their labels, in the order `from_host` meets them, through plain
/// objects only: `fs.readFile`.
pub(crate) fn labeled_functions(
    v: &HostValue,
    label: &str,
    f: &mut dyn FnMut(&str, &HostFunction),
) {
    match v {
        HostValue::Function(hf) => f(label, hf),
        HostValue::Object(fields) => {
            for (k, item) in fields {
                labeled_functions(item, &format!("{label}.{k}"), f);
            }
        }
        _ => {}
    }
}

// ---------- setup ----------

/// Defines the host globals the program refers to: `require`, the import hook, and the run's host globals. The rest
/// are made only if a module import asks for them, so a run pays only for the globals it uses.
pub fn install(vm: &mut Vm, referenced: &[Atom]) {
    for &a in referenced {
        let name = vm.atoms.text(a).to_owned();
        define_host_global(vm, &name);
    }
}

/// Defines one host global by name; false when there is none.
fn define_host_global(vm: &mut Vm, name: &str) -> bool {
    let v = match name {
        "require" if !has_host_global(vm, name) => {
            native(vm, "require", 1, require_native, Value::Undef)
        }
        IMPORT_GLOBAL => native(vm, "import", 2, import_native, Value::Undef),
        _ => {
            let globals = vm.host.globals.clone();
            let Some((_, value)) = globals.iter().find(|(n, _)| n == name) else {
                return false;
            };
            let place = Place {
                global: Some(vec![name.into()]),
                installed: true,
                within: None,
            };
            from_host(vm, value, name, &place, 0).unwrap_or(Value::Undef)
        }
    };
    global(vm, name, v);
    true
}

/// Whether the run's host globals have one by this name, which wins over a built-in of the same name.
pub(crate) fn has_host_global(vm: &Vm, name: &str) -> bool {
    vm.host.globals.iter().any(|(n, _)| n == name)
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

/// How a call's future begins: a new call, an idempotent call run again on resume, or a started durable call
/// reconnected to its work through its data.
pub enum Start {
    Call,
    Again,
    Wait(Data),
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
        Settlement::Host(settled) => {
            let Settled {
                result,
                label,
                owner,
                site,
            } = *settled;
            match result {
                Ok(v) => {
                    let v = result_from_host(vm, v, &label, owner.as_deref());
                    match v {
                        Ok(v) => vm.fulfill(p, v),
                        Err(e) => {
                            // The reference converts the value at the call, so its errors point there.
                            locate_at(vm, &e, site);
                            vm.reject(p, e)
                        }
                    }
                }
                Err(HostValue::Interrupt) => interrupt(vm),
                Err(thrown) => {
                    let e = thrown_value(vm, &thrown, &label);
                    vm.reject(p, e);
                }
            }
        }
    }
}

/// What a host function threw, as the program sees it: a failure keeps its kind and suggestions.
fn thrown_value(vm: &mut Vm, thrown: &HostValue, label: &str) -> Value {
    match thrown {
        HostValue::Failure(f) => failure_value(
            vm,
            DiagnosticKind::named(&f.kind),
            f.message.clone(),
            f.suggestions.clone(),
        ),
        thrown => from_host(vm, thrown, label, &Place::default(), 0).unwrap_or_else(|e| e),
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

fn failure_value(
    vm: &mut Vm,
    kind: DiagnosticKind,
    message: HostString,
    suggestions: Vec<HostString>,
) -> Value {
    let proto = vm.realm.error_proto;
    let e = vm.failure(proto, &message.to_run_text(), kind);
    if !suggestions.is_empty()
        && let Value::Obj(id) = e
    {
        vm.host.suggestions.insert(id, suggestions);
    }
    e
}

/// Calls the function a namespace path names, as the reference's `callNamespace`: `resolve` gives the function, or
/// the failure the call throws.
pub fn call_namespace(vm: &mut Vm, id: Id, args: &[Value], callee: Value) -> Res {
    let ns = vm.ns_path(id);
    let Some((namespace, _)) = vm.host.host_namespaces.get(&ns.root) else {
        let message = format!("The namespace {} is not available.", vm.atoms.text(ns.root));
        return Err(vm.type_error(&message));
    };
    let resolve = namespace.resolve.clone();
    let resolved = match home_of(vm) {
        None => resolve(&ns.keys),
        Some(home) => {
            let keys = ns.keys.clone();
            let Some(resolved) = home.run(move || resolve(&keys)) else {
                interrupt(vm);
                return Err(Value::Undef);
            };
            resolved
        }
    };
    let f = match resolved {
        Resolved::Missing(f) => {
            return Err(failure_value(
                vm,
                DiagnosticKind::named(&f.kind),
                f.message,
                f.suggestions,
            ));
        }
        Resolved::Function(f) => Callee::Fn(f),
        Resolved::Durable(f) => Callee::Durable(f),
    };
    // Where the function is among the globals, which only a call that may start again on resume needs.
    let path = match &f {
        Callee::Fn(f) if !f.idempotent => None,
        _ => vm
            .host
            .host_namespaces
            .get(&ns.root)
            .map(|(_, global)| global.iter().chain(ns.keys.iter()).cloned().collect()),
    };
    let target = Target {
        label: vm.ns_label(&ns),
        path,
        owner: None,
    };
    call_host(vm, &f, args, target, callee)
}

/// Where a host function is, and how its calls are named and saved: the reference's `HostTarget`.
struct Target {
    label: String,
    path: Option<Vec<HostString>>,
    owner: Option<String>,
}

/// Calls a host function from the program, which reached it as `callee`. Its arguments cross to the host now. An
/// async or durable function's call starts at once and the program gets its promise; a failure crossing rejects it.
/// A synchronous one is called now: its value crosses back at once, and work it left pending is a promise. When the
/// runtime awaits promises in arguments and one hasn't fulfilled, the call waits for them first.
fn call_host(vm: &mut Vm, f: &Callee, args: &[Value], target: Target, callee: Value) -> Res {
    let takes = matches!(f, Callee::Fn(f) if f.takes_functions);
    let concurrent = match f {
        Callee::Durable(_) => true,
        Callee::Fn(f) => f.is_async(),
    };
    let mut back = false;
    let crossed = host_args(vm, args, &target.label, takes.then_some(&mut back));
    // What the arguments can't cross fails at the call, as the reference locates it.
    let crossed = match crossed {
        Err(e) => {
            let site = vm.call_offset();
            locate_at(vm, &e, site);
            Err(e)
        }
        ok => ok,
    };
    if concurrent {
        let site = vm.call_offset();
        let host_args = match crossed {
            Ok(Args::Ready(host_args)) => host_args,
            Ok(Args::Wait(promises)) => {
                let p = vm.new_promise();
                crate::cross::wait_async(vm, promises, callee, args, p);
                return Ok(Value::Obj(p));
            }
            Err(e) if vm.fatal.is_none() => {
                let p = vm.new_promise();
                vm.reject(p, e);
                return Ok(Value::Obj(p));
            }
            Err(e) => return Err(e),
        };
        let p = vm.new_promise();
        let call = vm.host.next_call();
        let r = Restart {
            promise: p,
            call,
            label: target.label,
            path: target.path,
            args: host_args,
            owner: target.owner,
            site,
            start: Start::Call,
        };
        vm.host
            .queued
            .push(Queued::Call(p, f.clone(), Box::new(r), back));
        return Ok(Value::Obj(p));
    }
    let Callee::Fn(f) = f else {
        unreachable!("durable functions are concurrent")
    };
    let host_args = match crossed? {
        Args::Ready(host_args) => host_args,
        Args::Wait(promises) => return crate::cross::wait_sync(vm, promises, callee, args),
    };
    let Body::Sync(body) = &f.body else {
        unreachable!("a synchronous function has a synchronous body")
    };
    let call_id = vm.host.next_call();
    vm.host.enter_sync(call_id, target.label.clone());
    let call = vm.host.call(call_id);
    let returned = match home_of(vm) {
        None => body(host_args, &call),
        Some(home) => {
            let body = body.clone();
            home.run(move || body(host_args, &call))
                .unwrap_or(Returned::Now(Err(HostValue::Interrupt)))
        }
    };
    let returned = match returned {
        // The run waits for the work: the reference's driver takes over, starting the calls queued so far.
        Returned::Block(work) => {
            vm.host.next_epoch();
            launch(vm);
            Returned::Now(block(vm, work))
        }
        returned => returned,
    };
    vm.host.leave_sync();
    match returned {
        Returned::Now(Err(HostValue::Interrupt)) | Returned::Block(_) => {
            interrupt(vm);
            Err(Value::Undef)
        }
        Returned::Now(Ok(v)) => {
            let site = vm.call_offset();
            let v = result_from_host(vm, v, &target.label, target.owner.as_deref())
                .inspect_err(|e| locate_at(vm, e, site))?;
            Ok(if f.thenable { promise_like(vm, v) } else { v })
        }
        Returned::Now(Err(thrown)) => Err(thrown_value(vm, &thrown, &target.label)),
        Returned::Pending(work) => {
            let site = vm.call_offset();
            let p = vm.new_promise();
            let (label, owner) = (target.label.clone(), target.owner.clone());
            let future: BoxFuture<'_, Settlement> =
                Box::pin(async move { Settlement::host(work.await, label, owner, site) });
            let in_flight = InFlight {
                promise: p,
                call: call_id,
                label: target.label,
                path: None,
                args: Vec::new(),
                owner: None,
                site,
                kind: CallKind::Blocking,
                holds_functions: false,
                detached: Arc::default(),
            };
            vm.host
                .queued
                .push(Queued::Work(p, future, Box::new(in_flight)));
            Ok(Value::Obj(p))
        }
    }
}

/// Waits on the thread for work a synchronous call blocks on, while the run's other host calls keep running: what they
/// complete with waits in the inbox. The run's timeout stops the wait; the call then fails as the run times out. While
/// the run is on its worker, the wait and the other calls' polls happen where the run is driven.
fn block(vm: &mut Vm, work: BoxFuture<'static, HostResult>) -> HostResult {
    let deadline = vm
        .limits
        .timeout_ms
        .map(|ms| vm.start + std::time::Duration::from_millis(ms));
    let (settled, done) = match home_of(vm) {
        None => wait(&mut vm.host.tasks, work, deadline),
        Some(home) => {
            let mut tasks = std::mem::take(&mut vm.host.tasks);
            let Some((tasks, waited)) = home.run(move || {
                let waited = wait(&mut tasks, work, deadline);
                (tasks, waited)
            }) else {
                return Err(HostValue::Interrupt);
            };
            vm.host.tasks = tasks;
            waited
        }
    };
    for (p, s) in settled {
        vm.host.settled(p);
        vm.inbox.push_back((p, s));
    }
    match done {
        Some(r) => r,
        None => {
            let _ = vm.check_time();
            Err(HostValue::Undefined)
        }
    }
}

/// Polls `work` to its end or the deadline, and the run's other host calls meanwhile: what they complete with, in
/// order, and the work's result, `None` past the deadline.
fn wait(
    tasks: &mut crate::exec::Tasks<'static, Settlement>,
    mut work: BoxFuture<'static, HostResult>,
    deadline: Option<std::time::Instant>,
) -> (Vec<(Id, Settlement)>, Option<HostResult>) {
    let mut settled = Vec::new();
    let mut armed = false;
    let done = block_on(std::future::poll_fn(|cx| {
        tasks.set_parent(Some(cx.waker()));
        settled.extend(tasks.poll_ready());
        if let Poll::Ready(r) = work.as_mut().poll(cx) {
            return Poll::Ready(Some(r));
        }
        match deadline {
            Some(at) if std::time::Instant::now() >= at => Poll::Ready(None),
            Some(at) if !armed => {
                armed = true;
                crate::exec::wake_at(at, cx.waker());
                Poll::Pending
            }
            _ => Poll::Pending,
        }
    }));
    tasks.set_parent(None);
    (settled, done)
}

/// Where host code runs while the run computes on its worker thread; `None` while it runs where it is driven.
fn home_of(vm: &Vm) -> Option<crate::offload::Home> {
    crate::offload::home(&vm.host.offload).cloned()
}

/// Runs a future for a call, recorded as in flight while it runs.
fn track(
    vm: &mut Vm,
    p: Id,
    future: BoxFuture<'static, Settlement>,
    in_flight: impl FnOnce() -> InFlight,
) {
    match vm
        .host
        .tasks
        .spawn(p, future, crate::offload::home(&vm.host.offload))
    {
        Poll::Ready(s) => vm.inbox.push_back((p, s)),
        Poll::Pending => vm.host.calls.push(in_flight()),
    }
}

/// Starts an async or durable call whose promise is `p`, or starts one again on resume.
fn spawn_call(vm: &mut Vm, p: Id, f: &Callee, mut r: Restart, holds_functions: bool) {
    let call = vm.host.call(r.call);
    let home = home_of(vm);
    let detached = Arc::new(AtomicBool::new(false));
    let (label, owner, site) = (r.label.clone(), r.owner.clone(), r.site);
    let (kind, future): (CallKind, BoxFuture<'static, Settlement>) = match f {
        Callee::Fn(f) => {
            let Body::Async(body) = &f.body else {
                unreachable!("only async functions are called concurrently")
            };
            // Only an idempotent call starts again on resume, with the same arguments.
            let (kind, args) = match f.idempotent {
                true => (CallKind::Idempotent, r.args.clone()),
                false => (CallKind::Blocking, std::mem::take(&mut r.args)),
            };
            let work = match &home {
                None => body(args, call),
                Some(home) => {
                    let body = body.clone();
                    home.run(move || body(args, call))
                        .unwrap_or_else(|| Box::pin(async { Err(HostValue::Interrupt) }))
                }
            };
            (
                kind,
                Box::pin(async move { Settlement::host(work.await, label, owner, site) }),
            )
        }
        Callee::Durable(d) => {
            let data = Arc::new(Mutex::new(match &r.start {
                Start::Wait(data) => Some(data.clone()),
                _ => None,
            }));
            let durable = DurableCall {
                call: call.clone(),
                args: r.args.clone(),
            };
            let (d2, phase, waiting) = (d.clone(), data.clone(), durable.clone());
            let started: BoxFuture<'static, Result<Data, HostValue>> = match &r.start {
                Start::Wait(data) => {
                    let data = data.clone();
                    Box::pin(async move { Ok(data) })
                }
                _ => match &home {
                    None => (d.start)(r.args.clone(), call),
                    Some(home) => {
                        let (d, args) = (d.clone(), r.args.clone());
                        home.run(move || (d.start)(args, call))
                            .unwrap_or_else(|| Box::pin(async { Err(HostValue::Interrupt) }))
                    }
                },
            };
            let future: BoxFuture<'static, Settlement> = Box::pin(async move {
                let result = match started.await {
                    Ok(data) => {
                        *phase.lock().unwrap_or_else(|e| e.into_inner()) = Some(data.clone());
                        let r = (d2.wait)(data, waiting).await;
                        // Finished: there is nothing left to cancel.
                        *phase.lock().unwrap_or_else(|e| e.into_inner()) = None;
                        r
                    }
                    Err(e) => Err(e),
                };
                Settlement::host(result, label, owner, site)
            });
            (CallKind::Durable(data, d.clone(), durable), future)
        }
    };
    track(vm, p, future, || InFlight {
        promise: p,
        call: r.call,
        label: r.label,
        path: r.path,
        args: r.args,
        owner: r.owner,
        site: r.site,
        kind,
        holds_functions,
        detached,
    });
}

/// Starts a restored call in flight again: an idempotent one runs again with its key, a started durable one waits on
/// its data. A function no longer at its path fails the call.
pub fn restart(vm: &mut Vm, r: Restart) {
    let p = r.promise;
    let found = r.path.as_deref().and_then(|path| vm.host.resolve(path));
    match found {
        Some(f) => spawn_call(vm, p, &f, r, false),
        None => {
            let message = format!("{} is not available in this runtime.", r.label);
            vm.inbox.push_back((
                p,
                Settlement::Failure(Failed::from_parts(
                    DiagnosticKind::ExecutionFailure,
                    message.into(),
                    Vec::new(),
                )),
            ));
        }
    }
}

/// The prototype of a sync-thenable function's object results: an ordinary object whose `then`, `catch` and
/// `finally` act on a settled copy, so a result can be used directly, awaited, or chained, while data views see only
/// its own fields.
fn promise_like(vm: &mut Vm, v: Value) -> Value {
    if let Value::Obj(id) = v
        && matches!(vm.heap[id as usize].kind, Kind::Ordinary)
        && vm.heap[id as usize].proto == Some(vm.realm.object_proto)
    {
        let proto = promise_like_proto(vm);
        vm.heap[id as usize].proto = Some(proto);
    }
    v
}

fn promise_like_proto(vm: &mut Vm) -> Id {
    if let Some(id) = vm.host.promise_like {
        return id;
    }
    let object_proto = vm.realm.object_proto;
    let id = vm.alloc(Obj::new(Some(object_proto), Kind::Ordinary));
    for (name, length) in [("then", 2u8), ("catch", 1), ("finally", 1)] {
        let key = vm.atoms.intern(name);
        let f = native(
            vm,
            name,
            length,
            promise_like_method,
            Value::Str(vm.atoms.atom_str(key)),
        );
        vm.define_hidden(id, key, f);
    }
    vm.host.promise_like = Some(id);
    id
}

fn promise_like_method(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let Value::Obj(source) = this else {
        return Err(vm.type_error("Method called on a non-object"));
    };
    let copy = vm.new_object();
    for (k, v) in vm.own_entries(source) {
        vm.define(copy, k, v);
    }
    let p = vm.new_promise();
    vm.fulfill(p, Value::Obj(copy));
    let Value::Str(name) = vm.native_data(callee) else {
        return Ok(Value::Undef);
    };
    // As the reference does, the promise's own `then`, `catch` or `finally` runs, whatever the program put on
    // `Promise.prototype`: it only registers its reactions.
    let derived = vm.new_promise();
    let (first, second) = (crate::builtins::arg(args, 0), crate::builtins::arg(args, 1));
    let reaction = match vm.text(name) {
        "then" => crate::vm::Reaction::Then {
            on_ful: first,
            on_rej: second,
            derived,
        },
        "catch" => crate::vm::Reaction::Then {
            on_ful: Value::Undef,
            on_rej: first,
            derived,
        },
        _ if vm.is_callable(&first) => crate::vm::Reaction::Finally {
            cleanup: first,
            derived,
        },
        _ => crate::vm::Reaction::Resolve(derived),
    };
    vm.perform_then(p, reaction);
    Ok(Value::Obj(derived))
}

// ---------- crossing ----------

/// What a host call's arguments came to: copies ready for the host, or the promises among them that haven't
/// fulfilled, in the order they were met, which the call waits for before its arguments cross again.
pub enum Args {
    Ready(Vec<HostValue>),
    Wait(Vec<Value>),
}

/// Where a value crossing from the host is: among the run's host globals, at `global` (so a function there can be
/// found again on resume), or inside a value a host function with `snapshot` hooks returned (`within`).
#[derive(Clone, Default)]
struct Place {
    global: Option<Vec<HostString>>,
    /// Whether it is among the globals at all, even where no path of names leads: inside an array, a Map or a Set.
    installed: bool,
    within: Option<String>,
}

impl Place {
    fn child(&self, key: Option<&HostString>) -> Place {
        Place {
            global: match (&self.global, key) {
                (Some(path), Some(key)) => {
                    let mut path = path.clone();
                    path.push(key.clone());
                    Some(path)
                }
                _ => None,
            },
            installed: self.installed,
            within: self.within.clone(),
        }
    }
}

/// A host function's arguments as host values, as the reference's `toHost` copies them under the runtime's
/// translation (see `to_host`), or the promises among them to wait for first. With `back`, a function from a host
/// result crosses back as itself, and `back` says whether one did.
fn host_args(
    vm: &mut Vm,
    args: &[Value],
    label: &str,
    mut back: Option<&mut bool>,
) -> Result<Args, Value> {
    let mut waiting = Vec::new();
    let mut out = Vec::with_capacity(args.len());
    for (i, a) in args.iter().enumerate() {
        let mut seen = Vec::new();
        let mut cx = ToHost {
            callee: label,
            arg: i,
            seen: &mut seen,
            waiting: &mut waiting,
            back: back.as_deref_mut(),
        };
        let v = to_host(vm, a, 0, &mut cx)?;
        out.push(v.unwrap_or(HostValue::Undefined));
    }
    if !waiting.is_empty() {
        return Ok(Args::Wait(waiting));
    }
    Ok(Args::Ready(out))
}

/// What a copy for the host carries along.
struct ToHost<'a> {
    /// Names the call in messages, with the argument's position: `Argument 1 to fetch`, made only when one needs it.
    callee: &'a str,
    arg: usize,
    seen: &'a mut Vec<Id>,
    waiting: &'a mut Vec<Value>,
    back: Option<&'a mut bool>,
}

impl ToHost<'_> {
    fn label(&self) -> String {
        format!("Argument {} to {}", self.arg + 1, self.callee)
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
    if !std::ptr::fn_addr_eq(*f, host_native as crate::vm::NativeFn) {
        return None;
    }
    let entry = vm.host.functions.get(*index as usize)?;
    match &entry.f {
        Callee::Fn(f) if !entry.installed => Some(f.clone()),
        _ => None,
    }
}

/// How the reference describes a value that cannot be passed to the host.
pub(crate) fn describe(vm: &Vm, v: &Value) -> &'static str {
    match v {
        Value::Sym(_) => "a symbol",
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => "a function",
            Kind::Namespace(_) => "a namespace reference",
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

/// A program value copied out for a host function, as the reference's `toHost` copies it under the runtime's
/// translation. A function that came from a host result crosses back as the host function when the call takes
/// functions (`back`). Otherwise a function fails the call, or is left out under `functions: drop` (`None`: an
/// object's key is skipped, an array's item is `null`, a Map's or Set's is undefined). A promise fails the call, or
/// under `promises: await` is its value once fulfilled; one that hasn't fulfilled goes in `waiting`, for the call to
/// wait for.
fn to_host(
    vm: &mut Vm,
    v: &Value,
    depth: usize,
    cx: &mut ToHost,
) -> Result<Option<HostValue>, Value> {
    if depth > crate::convert::MAX_VALUE_DEPTH {
        let msg = format!(
            "{} exceeds the maximum value depth of {}.",
            cx.label(),
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
            return Ok(Some(HostValue::String(HostString::from_run_text(
                vm.text(*s),
            ))));
        }
        Value::Sym(_) => {
            let msg = format!(
                "{} contains a symbol, which cannot be passed to the host.",
                cx.label()
            );
            return Err(vm.type_error(&msg));
        }
        Value::Obj(id) => *id,
    };
    if let Some(back) = cx.back.as_deref_mut()
        && let Some(f) = hosted(vm, id)
    {
        *back = true;
        return Ok(Some(HostValue::Function(f)));
    }
    if vm.host.translate.functions == TranslateFunctions::Drop && vm.heap[id as usize].is_callable()
    {
        return Ok(None);
    }
    if cx.seen.contains(&id) {
        return Err(vm.type_error(&format!("{} contains a circular value.", cx.label())));
    }
    if vm.host.translate.promises == TranslatePromises::Await
        && let Kind::Promise(p) = &vm.heap[id as usize].kind
    {
        let PromiseState::Fulfilled(result) = p.state else {
            cx.waiting.push(*v);
            return Ok(Some(HostValue::Undefined));
        };
        cx.seen.push(id);
        let out = to_host(vm, &result, depth + 1, cx)?;
        cx.seen.pop();
        return Ok(out);
    }
    if vm.heap[id as usize].is_callable() || crate::cross::opaque(&vm.heap[id as usize].kind) {
        let msg = format!(
            "{} contains {}, which cannot be passed to the host.",
            cx.label(),
            describe(vm, v)
        );
        return Err(vm.type_error(&msg));
    }
    cx.seen.push(id);
    // A child left out of a Map or a Set is undefined there.
    let kept = |vm: &mut Vm, item: &Value, cx: &mut ToHost| {
        to_host(vm, item, depth + 1, cx).map(Option::unwrap_or_default)
    };
    let out = match &vm.heap[id as usize].kind {
        Kind::Date(t) => HostValue::Date(*t),
        Kind::RegExp(r) => HostValue::RegExp {
            source: HostString::from_run_text(&r.source),
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
            cx.seen.pop();
            return to_host(vm, v, depth, cx);
        }
        Kind::Array(items) => {
            let items = items.clone();
            let mut out = Vec::with_capacity(items.len());
            for item in &items {
                out.push(match item {
                    Value::Uninit => None,
                    item => Some(to_host(vm, item, depth + 1, cx)?.unwrap_or(HostValue::Null)),
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
                    let k = kept(vm, k, cx)?;
                    out.push((k, kept(vm, val, cx)?));
                }
                HostValue::Map(out)
            } else {
                let mut out = Vec::with_capacity(entries.len());
                for (k, _) in &entries {
                    out.push(kept(vm, k, cx)?);
                }
                HostValue::Set(out)
            }
        }
        Kind::Error(_) => {
            let (name, message) = crate::convert::error_parts(vm, id);
            let name = crate::cross::host_error_name(vm, id, name);
            let mut error = HostError::named(
                HostString::from_run_text(&name),
                HostString::from_run_text(&message),
            );
            let cause_key = vm.names.cause;
            // A field that cannot cross is left behind, so the error itself always arrives.
            let left_behind = |vm: &mut Vm, item: &Value, cx: &mut ToHost| {
                let at = cx.seen.len();
                match to_host(vm, item, depth + 1, cx) {
                    Ok(item) => Ok(item),
                    Err(e) if vm.fatal.is_some() => Err(e),
                    Err(_) => {
                        cx.seen.truncate(at);
                        Ok(None)
                    }
                }
            };
            if vm.has_own(id, cause_key) {
                let cause = vm.get_obj(id, cause_key);
                if let Some(c) = left_behind(vm, &cause, cx)? {
                    error.cause = Some(Box::new(c));
                }
            }
            for (k, val) in vm.own_entries(id) {
                let key = HostString::from_run_text(vm.atoms.text(k));
                if key.as_str().is_some_and(crate::cross::uncrossed) || k == cause_key {
                    continue;
                }
                if let Some(item) = left_behind(vm, &val, cx)? {
                    error.fields.push((key, item));
                }
            }
            HostValue::Error(Box::new(error))
        }
        _ => {
            let mut out = Vec::new();
            for (k, val) in vm.own_entries(id) {
                let key = HostString::from_run_text(vm.atoms.text(k));
                if key == "__proto__" {
                    continue;
                }
                if let Some(item) = to_host(vm, &val, depth + 1, cx)? {
                    out.push((key, item));
                }
            }
            HostValue::Object(out)
        }
    };
    cx.seen.pop();
    Ok(Some(out))
}

/// A host value copied in, from where it is (`place`).
fn from_host(
    vm: &mut Vm,
    v: &HostValue,
    label: &str,
    place: &Place,
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
        HostValue::Undefined | HostValue::Interrupt => Value::Undef,
        HostValue::Null => Value::Null,
        HostValue::Bool(b) => Value::Bool(*b),
        HostValue::Number(n) => Value::Num(*n),
        HostValue::String(s) => vm.string_val(s.to_run_text()),
        HostValue::Function(f) => {
            // A global host function with `snapshot` hooks saves what it returns; a function inside such a value
            // saves with the same hooks.
            let owner = match (&place.global, &f.snapshot) {
                (Some(_), Some(_)) => Some(label.to_owned()),
                _ => place.within.clone(),
            };
            wrap(vm, Callee::Fn(f.clone()), label, place, owner)
        }
        HostValue::Durable(f) => wrap(vm, Callee::Durable(f.clone()), label, place, None),
        HostValue::Namespace(ns) => match &place.global {
            Some(global) => {
                let name = vm.atoms.intern(label);
                vm.host
                    .host_namespaces
                    .insert(name, (ns.clone(), global.clone()));
                vm.ns_ref(NsPath {
                    parent: NsPath::ROOT,
                    name,
                })
            }
            None => {
                let msg = format!("{label} produced a namespace, which the program cannot hold.");
                return Err(vm.type_error(&msg));
            }
        },
        HostValue::Failure(f) => failure_value(
            vm,
            DiagnosticKind::named(&f.kind),
            f.message.clone(),
            f.suggestions.clone(),
        ),
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
                    Some(item) => from_host(
                        vm,
                        item,
                        &format!("{label}[{i}]"),
                        &place.child(None),
                        depth + 1,
                    )?,
                    None => Value::Uninit,
                });
            }
            vm.new_array(out)
        }
        HostValue::Object(fields) => {
            let id = vm.new_object();
            for (k, item) in fields {
                let shown = k.to_string_lossy();
                let val = from_host(vm, item, &next(&shown), &place.child(Some(k)), depth + 1)?;
                let key = vm.atoms.intern(&k.to_run_text());
                vm.define(id, key, val);
            }
            Value::Obj(id)
        }
        HostValue::Date(t) => {
            crate::builtins::date::new_date(vm, crate::builtins::date::time_clip(*t))
        }
        HostValue::RegExp { source, flags } => {
            crate::builtins::regexp::new_regexp(vm, &source.to_run_text(), flags)?
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
        HostValue::Response(response) => response_from_host(vm, response, label, place, depth)?,
        HostValue::Map(entries) => {
            let proto = vm.realm.map_proto;
            let id = vm.alloc(Obj::new(Some(proto), Kind::Map(Box::default())));
            for (k, item) in entries {
                let k = from_host(vm, k, label, &place.child(None), depth + 1)?;
                let item = from_host(vm, item, label, &place.child(None), depth + 1)?;
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
                let k = from_host(vm, item, label, &place.child(None), depth + 1)?;
                let mk = vm.map_key(&k);
                if let Kind::Set(m) = &mut vm.heap[id as usize].kind {
                    m.set(mk, k, Value::Undef);
                }
            }
            Value::Obj(id)
        }
        HostValue::Error(e) => {
            let proto = match e.name.as_str().unwrap_or_default() {
                "TypeError" => vm.realm.type_error_proto,
                "RangeError" => vm.realm.range_error_proto,
                "SyntaxError" => vm.realm.syntax_error_proto,
                "ReferenceError" => vm.realm.reference_error_proto,
                "AggregateError" => vm.realm.aggregate_error_proto,
                name @ ("URIError" | "EvalError") => {
                    crate::builtins::ensure_global(vm, name);
                    let g = vm.atoms.intern(name);
                    match vm.global_map.get(&g).copied() {
                        Some(Value::Obj(c)) => {
                            let key = vm.names.prototype;
                            vm.get_obj(c, key).as_obj().unwrap_or(vm.realm.error_proto)
                        }
                        _ => vm.realm.error_proto,
                    }
                }
                _ => vm.realm.error_proto,
            };
            let err = vm.make_error(proto, &e.message.to_run_text());
            if let Value::Obj(id) = err {
                if let Some(cause) = &e.cause
                    && let Ok(c) =
                        from_host(vm, cause, &next("cause"), &Place::default(), depth + 1)
                {
                    let key = vm.names.cause;
                    vm.define_hidden(id, key, c);
                }
                for (k, item) in &e.fields {
                    if matches!(
                        k.as_str(),
                        Some("stack" | "message" | "constructor" | "toString" | "__proto__")
                    ) {
                        continue;
                    }
                    if matches!(
                        item,
                        HostValue::Function(_) | HostValue::Durable(_) | HostValue::Namespace(_)
                    ) {
                        continue;
                    }
                    let shown = k.to_string_lossy();
                    if let Ok(val) =
                        from_host(vm, item, &next(&shown), &Place::default(), depth + 1)
                    {
                        let key = vm.atoms.intern(&k.to_run_text());
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
    place: &Place,
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
                let f = response_fn(vm, f, &path, place);
                vm.define(body, key, f);
            }
            Value::Obj(body)
        }
        None => Value::Null,
    };
    let fields = [
        ("url", HostValue::from(response.url.as_str())),
        ("status", HostValue::Number(response.status as f64)),
        ("statusText", HostValue::from(response.status_text.as_str())),
        ("ok", HostValue::Bool(response.ok())),
        ("headers", HostValue::Headers(response.headers.clone())),
    ];
    for (key, v) in fields {
        let v = from_host(
            vm,
            &v,
            &format!("{label}.{key}"),
            &place.child(None),
            depth + 1,
        )?;
        let key = vm.atoms.intern(key);
        vm.define(result, key, v);
    }
    let key = vm.atoms.intern_static("redirected");
    vm.define(result, key, Value::Bool(response.redirected));
    let key = vm.atoms.intern_static("body");
    vm.define(result, key, body);
    for (key, f) in surface.methods {
        let f = response_fn(vm, f, &format!("{label}.{key}"), place);
        let key = vm.atoms.intern(key);
        vm.define(result, key, f);
    }
    Ok(Value::Obj(result))
}

/// A streaming response's method, which never saves with snapshot hooks: a live response can't be kept.
fn response_fn(vm: &mut Vm, f: HostFunction, label: &str, place: &Place) -> Value {
    wrap(vm, Callee::Fn(f), label, &place.child(None), None)
}

/// A host call's result copied in. When it is saved by an owner's `snapshot` hooks and holds functions, the value is
/// kept so a suspend can save them.
fn result_from_host(
    vm: &mut Vm,
    v: HostValue,
    label: &str,
    owner: Option<&str>,
) -> Result<Value, Value> {
    let start = vm.host.functions.len();
    let place = Place {
        global: None,
        installed: false,
        within: owner.map(str::to_owned),
    };
    let out = from_host(vm, &v, label, &place, 0);
    let end = vm.host.functions.len();
    if let Some(owner) = owner
        && end > start
    {
        vm.host.results.push(ResultRoot {
            owner: owner.to_owned(),
            value: v,
            functions: start..end,
        });
    }
    out
}

/// Natives the host makes, which a snapshot names like the built-ins'.
pub fn snapshot_natives() -> [NativeFn; 5] {
    [
        require_native,
        import_native,
        host_native,
        promise_like_method,
        crate::cross::park,
    ]
}

/// A function the run lost on resume: calling it throws.
pub fn lost_function(name: &str) -> HostFunction {
    let shown = if name.is_empty() { "(anonymous)" } else { name };
    let message = format!(
        "The function {shown} came from the host and was lost when the run was suspended; get it again after resuming."
    );
    HostFunction::lost(name, message)
}

/// A host function as a program function, at `label`. A host function made with no name is named by where it is.
/// A constructible one is called the same way by `new`.
fn wrap(vm: &mut Vm, f: Callee, label: &str, place: &Place, owner: Option<String>) -> Value {
    let constructible = matches!(&f, Callee::Fn(f) if f.constructible);
    let name = match f.name() {
        Some(name) => name.to_owned(),
        None => label[label.rfind('.').map_or(0, |i| i + 1)..].to_owned(),
    };
    let length = f.length();
    let index = vm.host.functions.len();
    vm.host.functions.push(FnEntry {
        f,
        label: label.to_owned(),
        path: place.global.clone(),
        owner,
        installed: place.installed,
    });
    let made = native(vm, &name, length, host_native, Value::Num(index as f64));
    if constructible
        && let Value::Obj(id) = made
        && let Kind::Native { ctor, .. } = &mut vm.heap[id as usize].kind
    {
        *ctor = true;
    }
    made
}

fn host_native(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let Value::Num(index) = vm.native_data(callee) else {
        return Ok(Value::Undef);
    };
    let entry = &vm.host.functions[index as usize];
    if let Callee::Fn(f) = &entry.f
        && let Body::Lost(message) = &f.body
    {
        let message = message.clone();
        return Err(vm.type_error(&message));
    }
    let f = entry.f.clone();
    let target = Target {
        label: entry.label.clone(),
        path: entry.path.clone(),
        owner: entry.owner.clone(),
    };
    call_host(vm, &f, args, target, Value::Obj(callee))
}

// ---------- modules ----------

fn module_name(specifier: &str) -> &str {
    specifier.strip_prefix("node:").unwrap_or(specifier)
}

fn global_value(vm: &mut Vm, name: &str) -> Option<Value> {
    let a = vm.atoms.intern(name);
    if !vm.global_map.contains_key(&a)
        && (has_host_global(vm, name) || !crate::builtins::ensure_global(vm, name))
    {
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
    if let Some(v) = vm.host.modules_loaded.get(&name) {
        return Ok(*v);
    }
    // A module name the runtime maps to a global.
    let modules = vm.host.modules.clone();
    let named = modules
        .iter()
        .find(|(m, _)| *m == name)
        .map(|(_, global)| global.as_str());
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
    vm.host.modules_loaded.insert(name, found);
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

/// The names directly under a namespace path, as the reference's `namespaceKeys` lists them, or what listing them
/// threw.
pub(crate) fn namespace_keys(vm: &mut Vm, id: Id) -> Result<Vec<HostString>, Value> {
    let ns = vm.ns_path(id);
    let Some((namespace, _)) = vm.host.host_namespaces.get(&ns.root).cloned() else {
        let message = format!("The namespace {} is not available.", vm.atoms.text(ns.root));
        return Err(vm.type_error(&message));
    };
    let listed = match home_of(vm) {
        None => (namespace.keys)(&ns.keys),
        Some(home) => {
            let keys = ns.keys.clone();
            let Some(listed) = home.run(move || (namespace.keys)(&keys)) else {
                interrupt(vm);
                return Err(Value::Undef);
            };
            listed
        }
    };
    listed.map_err(|thrown| {
        let label = vm.ns_label(&ns);
        thrown_value(vm, &thrown, &label)
    })
}
