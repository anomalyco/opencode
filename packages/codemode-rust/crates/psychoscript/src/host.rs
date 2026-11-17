//! The VM's side of host work: tool calls, the `search` built-in, extension globals and modules, and the host
//! futures a run has in flight. Arguments cross out and results cross in as copies.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use rustc_hash::FxHashMap;

use crate::exec::{Tasks, block_on};
use crate::extension::{Body, HostError, HostFunction, HostResult, HostValue};
use crate::hooks::{CallResult, ExtensionInvocation, Hooks, ToolInvocation};
use crate::object::*;
use crate::schema;
use crate::search;
use crate::strings::Atom;
use crate::tool::{BoxFuture, Execute, Tool, ToolContext, tool_expression};
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};
use crate::{DiagnosticKind, Json, Setup, ToolCall};

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
    /// An extension call's value, or what it threw, with the label that names it in conversion errors and the
    /// extension it came from.
    Host(Box<(HostResult, String, String)>),
    /// The call interrupts the whole run.
    Interrupted,
}

/// A host call's failure. Boxed, so the common successful settlement stays small.
pub struct Failed {
    kind: DiagnosticKind,
    message: String,
    suggestions: Vec<String>,
}

impl Settlement {
    fn failure(kind: DiagnosticKind, message: String) -> Self {
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
    fn new(kind: DiagnosticKind, message: String) -> Box<Self> {
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

/// The host state of one run.
pub struct RunHost<'rt> {
    pub setup: &'rt Setup,
    /// Names the run's host calls; made on first use when the host gave none.
    pub(crate) run_id: crate::tool::RunId,
    pub(crate) next_call: u64,
    /// The context handed to synchronous tools, its call id set for each call.
    ctx: Option<ToolContext>,
    pub tasks: Tasks<'rt, Settlement>,
    pub(crate) functions: Vec<FnEntry>,
    /// Host calls in flight.
    pub calls: Vec<Call>,
    /// Results whose functions survive a suspend through their extension's hooks.
    pub results: Vec<ResultRoot>,
    /// Calls a resumed run starts again when it begins.
    pub restarts: Vec<(Id, String, Json, u64, Start)>,
    /// What a suspend asks of the run, shared with its [`Suspender`](crate::Suspender)s.
    pub shared: Arc<crate::program::Shared>,
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
}

impl<'rt> RunHost<'rt> {
    /// A point where the reference starts the calls queued so far: a new job, or a finished synchronous call.
    #[inline]
    pub fn next_epoch(&self) {
        use std::sync::atomic::Ordering::Relaxed;
        self.epoch.store(self.epoch.load(Relaxed) + 1, Relaxed);
    }

    pub fn new(setup: &'rt Setup, run_id: Option<String>) -> Self {
        Self {
            setup,
            ctx: None,
            run_id: Arc::new(run_id.map(std::sync::OnceLock::from).unwrap_or_default()),
            next_call: 0,
            tasks: Tasks::default(),
            functions: Vec::new(),
            calls: Vec::new(),
            results: Vec::new(),
            restarts: Vec::new(),
            shared: Arc::default(),
            suggestions: FxHashMap::default(),
            promise_like: None,
            interrupted: false,
            unhandled: Vec::new(),
            modules: FxHashMap::default(),
            namespaces: FxHashMap::default(),
            epoch: Default::default(),
        }
    }

    /// Whether host work is still in flight, so an idle program is waiting rather than stuck.
    pub fn waiting(&self) -> bool {
        !self.tasks.is_empty()
    }

    fn next_call(&mut self) -> u64 {
        let id = self.next_call;
        self.next_call += 1;
        id
    }

    pub fn run_id(&mut self) -> crate::tool::RunId {
        self.run_id.clone()
    }

    fn context(&mut self) -> ToolContext {
        let id = self.next_call();
        ToolContext::new(self.run_id(), id)
    }

    /// The key of the call with this id.
    pub fn key(&self, call: u64) -> String {
        ToolContext::new(self.run_id.clone(), call).key()
    }

    /// A call settled: it is no longer in flight.
    pub fn settled(&mut self, promise: Id) {
        if let Some(i) = self.calls.iter().position(|c| c.promise == promise) {
            self.calls.swap_remove(i);
        }
    }

    /// Stops durable work still running when the run ends or is interrupted for real; a suspend detaches it first.
    pub fn cancel_durable(&mut self) {
        let setup = self.setup;
        for call in std::mem::take(&mut self.calls) {
            let CallKind::Durable(data) = &call.kind else {
                continue;
            };
            if call.detached.load(Ordering::Relaxed) {
                continue;
            }
            let data = data.lock().unwrap_or_else(|e| e.into_inner()).clone();
            if let (Some(data), Some(tool)) = (data, setup.registry.get(&call.tool))
                && let Execute::Durable(d) = &tool.execute
            {
                block_on((d.cancel)(data));
            }
        }
    }

    /// The shared context for a synchronous call, without a reference count change per call.
    fn sync_context(&mut self, call: u64) -> &ToolContext {
        if self.ctx.is_none() {
            self.ctx = Some(ToolContext::new(self.run_id(), 0));
        }
        let ctx = self.ctx.as_mut().expect("context");
        ctx.call = call;
        ctx
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
    let v = match name {
        "search" => native(vm, "search", 0, search_native, Value::Undef),
        "require" => native(vm, "require", 1, require_native, Value::Undef),
        IMPORT_GLOBAL => native(vm, "import", 2, import_native, Value::Undef),
        _ => {
            let setup = vm.host.setup;
            let found = setup.extensions.iter().find_map(|extension| {
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

fn native(vm: &mut Vm, name: &str, length: u8, f: crate::vm::NativeFn, data: Value) -> Value {
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

// ---------- tool calls ----------

/// `tools.<path>(...args)`: returns a promise at once; the call starts now and settles it later.
pub fn call_tool(vm: &mut Vm, path: &str, args: &[Value]) -> Res {
    let p = vm.new_promise();
    start_tool(vm, p, path, args);
    Ok(Value::Obj(p))
}

/// Everything about a call that happens before its tool runs: the reference's `decode` and `admit`.
struct Admitted<'rt> {
    tool: &'rt Tool,
    input: Json,
    call: u64,
}

/// Starts a call whose promise is `p`. A call that ends at once queues its outcome; the rest become tasks.
fn start_tool<'rt>(vm: &mut Vm<'rt>, p: Id, path: &str, args: &[Value]) {
    let setup = vm.host.setup;
    // Models often write `tools.search(...)` for the bare `search(...)`; honor it unless a tool owns that path.
    if path == "search" && !setup.registry.exists("search") {
        let s = match run_search(vm, args) {
            Ok(json) => Settlement::Json(json),
            Err(f) => Settlement::Failure(f),
        };
        vm.inbox.push_back((p, s));
        return;
    }
    let admitted = match admit(vm, path, args) {
        Ok(a) => a,
        Err(f) => {
            vm.inbox.push_back((p, Settlement::Failure(f)));
            return;
        }
    };
    let hooks = &setup.hooks;
    if hooks.tool_before.is_none()
        && hooks.tool_after.is_none()
        && let Execute::Sync(f) = &admitted.tool.execute
    {
        let shared = vm.host.shared.clone();
        shared.enter_sync(&vm.host, admitted.call, tool_expression(path));
        let raw = f(admitted.input, vm.host.sync_context(admitted.call));
        shared.leave_sync();
        let s = finish(path, admitted.tool, raw);
        if let Settlement::Interrupted = s {
            interrupt(vm);
        }
        vm.inbox.push_back((p, s));
        return;
    }
    spawn_tool(
        vm,
        p,
        path,
        admitted.tool,
        admitted.input,
        admitted.call,
        Start::Call,
    );
}

/// How a tool call's future begins: a new call, an idempotent call run again on resume, or a started durable call
/// reconnected to its work through its data.
pub enum Start {
    Call,
    Again,
    Wait(Json),
}

/// Runs a tool call as a host future, recorded as in flight while it runs.
pub fn spawn_tool<'rt>(
    vm: &mut Vm<'rt>,
    p: Id,
    path: &str,
    tool: &'rt Tool,
    input: Json,
    call: u64,
    start: Start,
) {
    let setup = vm.host.setup;
    let hooks = &setup.hooks;
    let detached = Arc::new(AtomicBool::new(false));
    let kind = match &tool.execute {
        Execute::Idempotent(_) => CallKind::Idempotent,
        Execute::Durable(_) => CallKind::Durable(Arc::new(Mutex::new(match &start {
            Start::Wait(data) => Some(data.clone()),
            _ => None,
        }))),
        _ => CallKind::Blocking,
    };
    let phase = match &kind {
        CallKind::Durable(data) => Some(data.clone()),
        _ => None,
    };
    let ctx = ToolContext::new(vm.host.run_id(), call);
    let a = Admitted {
        tool,
        input: input.clone(),
        call,
    };
    let future = Box::pin(hooked_tool(
        hooks,
        path.to_owned(),
        a,
        ctx,
        detached.clone(),
        phase,
        start,
    ));
    match vm.host.tasks.spawn(p, future) {
        Poll::Ready(s) => vm.inbox.push_back((p, s)),
        Poll::Pending => vm.host.calls.push(Call {
            promise: p,
            call,
            path: tool_expression(path),
            tool: path.to_owned(),
            input,
            kind,
            detached,
        }),
    }
}

#[inline]
fn admit<'rt>(vm: &mut Vm<'rt>, path: &str, args: &[Value]) -> Result<Admitted<'rt>, Box<Failed>> {
    let setup = vm.host.setup;
    let Some(tool) = setup.registry.get(path) else {
        return Err(unknown_tool(setup, path));
    };
    let tool: &'rt Tool = tool;
    let entry_field = if tool.freeform {
        schema::string_parameter(tool.input.document()).map(|(name, _)| name)
    } else {
        None
    };
    let input = decode(vm, path, &tool.input, entry_field.as_deref(), args, false)?;
    admit_call(vm, path, &input)?;
    let call = vm.host.next_call();
    Ok(Admitted { tool, input, call })
}

/// Copies the call's argument out as JSON and decodes it with the tool's input schema.
#[inline]
fn decode(
    vm: &mut Vm,
    name: &str,
    schema: &crate::Schema,
    string_field: Option<&str>,
    args: &[Value],
    search: bool,
) -> Result<Json, Box<Failed>> {
    if args.len() > 1 {
        return Err(Failed::new(
            DiagnosticKind::InvalidToolInput,
            format!("Tool '{name}' expects at most one input object."),
        ));
    }
    let input = match args.first() {
        None => Json::Object(serde_json::Map::new()),
        Some(v) => match crate::convert::to_json(vm, v) {
            Ok(j) => j,
            Err(e) => {
                let msg = vm.error_text(&e);
                return Err(Failed::new(
                    DiagnosticKind::InvalidDataValue,
                    format!("Invalid input for tool '{name}': {msg}"),
                ));
            }
        },
    };
    let input = match (string_field, input) {
        (Some(field), Json::String(s)) => {
            let mut map = serde_json::Map::new();
            map.insert(field.to_owned(), Json::String(s));
            Json::Object(map)
        }
        (_, input) => input,
    };
    schema
        .validate(input)
        .map_err(|e| Box::new(Failed {
            kind: DiagnosticKind::InvalidToolInput,
            message: format!("Invalid input for tool '{name}': {e}"),
            suggestions: vec![if search {
                "Pass search a query string or an object, such as search(\"issues\") or search({ namespace: \"github\" }).".into()
            } else {
                "The signature may have changed. Use search to get the current signature.".into()
            }],
        }))
}

/// Counts a call against `max_tool_calls` and records it.
#[inline]
fn admit_call(vm: &mut Vm, path: &str, input: &Json) -> Result<(), Box<Failed>> {
    if let Some(max) = vm.limits.max_tool_calls
        && vm.tool_calls.len() as u64 >= max
    {
        return Err(Failed::new(
            DiagnosticKind::ToolCallLimitExceeded,
            format!("Execution exceeded its tool-call limit of {max}."),
        ));
    }
    vm.tool_calls.push(ToolCall {
        path: path.to_owned(),
        input: input.clone(),
    });
    Ok(())
}

/// A tool's raw result as the program receives it.
#[inline]
fn finish(name: &str, tool: &Tool, raw: Result<Json, crate::ToolError>) -> Settlement {
    match raw {
        Err(e) if e.is_interrupt() => Settlement::Interrupted,
        Err(e) => Settlement::failure(DiagnosticKind::ToolFailure, e.message),
        Ok(raw) => match &tool.output {
            None => Settlement::Undefined,
            Some(schema) => match schema.validate(raw) {
                Ok(json) => Settlement::Json(json),
                Err(e) => Settlement::failure(
                    DiagnosticKind::InvalidToolOutput,
                    format!("Invalid output from tool '{name}': {e}"),
                ),
            },
        },
    }
}

/// Runs `tool.after` as interrupted if the call is dropped while its tool runs, unless a suspend detached it.
struct AfterGuard<'h> {
    hooks: &'h Hooks,
    call: Option<ToolInvocation>,
    detached: Arc<AtomicBool>,
}

impl AfterGuard<'_> {
    fn end(mut self, s: &Settlement) {
        let (Some(after), Some(call)) = (&self.hooks.tool_after, self.call.take()) else {
            return;
        };
        let null = Json::Null;
        match s {
            Settlement::Json(v) => after(&call, CallResult::Success(v)),
            Settlement::Undefined => after(&call, CallResult::Success(&null)),
            Settlement::Failure(f) => after(&call, CallResult::Failure(&f.message)),
            Settlement::Interrupted => after(&call, CallResult::Interrupted),
            Settlement::Host(_) => {}
        }
    }
}

impl Drop for AfterGuard<'_> {
    fn drop(&mut self) {
        if self.detached.load(Ordering::Relaxed) {
            return;
        }
        if let (Some(after), Some(call)) = (&self.hooks.tool_after, self.call.take()) {
            after(&call, CallResult::Interrupted);
        }
    }
}

async fn hooked_tool(
    hooks: &Hooks,
    name: String,
    a: Admitted<'_>,
    ctx: ToolContext,
    detached: Arc<AtomicBool>,
    phase: Option<Arc<Mutex<Option<Json>>>>,
    start: Start,
) -> Settlement {
    let call = ToolInvocation {
        name: name.clone(),
        input: a.input.clone(),
        key: ctx.key(),
    };
    // A durable call reconnecting on resume already passed its hook.
    if !matches!(start, Start::Wait(_))
        && let Some(before) = &hooks.tool_before
        && let Err(e) = before(&call).await
    {
        return Settlement::failure(DiagnosticKind::ToolFailure, e.message);
    }
    let guard = AfterGuard {
        hooks,
        call: Some(call),
        detached,
    };
    let raw = match &a.tool.execute {
        Execute::Sync(f) => f(a.input, &ctx),
        Execute::Async(f) | Execute::Idempotent(f) => f(a.input, ctx).await,
        Execute::Durable(d) => {
            let data = match start {
                Start::Wait(data) => Ok(data),
                _ => (d.start)(a.input, ctx.clone()).await,
            };
            match data {
                Ok(data) => {
                    if let Some(phase) = &phase {
                        *phase.lock().unwrap_or_else(|e| e.into_inner()) = Some(data.clone());
                    }
                    let r = (d.wait)(data, ctx).await;
                    // Finished: there is nothing left to cancel.
                    if let Some(phase) = &phase {
                        *phase.lock().unwrap_or_else(|e| e.into_inner()) = None;
                    }
                    r
                }
                Err(e) => Err(e),
            }
        }
    };
    let s = finish(&name, a.tool, raw);
    guard.end(&s);
    s
}

#[cold]
fn unknown_tool(setup: &Setup, path: &str) -> Box<Failed> {
    let registry = &setup.registry;
    let entries = registry.entries();
    let index = registry.word_index();
    let segments: Vec<&str> = path.split('.').collect();
    if !registry.is_namespace(path) {
        let first = segments[0];
        let ns = (segments.len() > 1 && registry.exists(first)).then_some(first);
        let (scope, query): (Vec<usize>, String) = match ns {
            Some(ns) => {
                let under = format!("{ns}.");
                (
                    (0..entries.len())
                        .filter(|&i| entries[i].path.starts_with(&under))
                        .collect(),
                    segments[1..].join(" "),
                )
            }
            None => ((0..entries.len()).collect(), path.to_owned()),
        };
        let closest = search::rank(entries, index, &scope, &query)
            .into_iter()
            .next();
        let message = match closest {
            Some(i) => format!(
                "Unknown tool '{path}'. Did you mean {}?",
                tool_expression(&entries[i].path)
            ),
            None => format!("Unknown tool '{path}'."),
        };
        return Box::new(Failed {
            kind: DiagnosticKind::UnknownTool,
            message,
            suggestions: vec!["Use search to find available tools.".into()],
        });
    }
    let under = format!("{path}.");
    let scope: Vec<usize> = (0..entries.len())
        .filter(|&i| entries[i].path.starts_with(&under))
        .collect();
    let mut shown = search::rank(
        entries,
        index,
        &scope,
        segments.last().copied().unwrap_or(""),
    );
    for &i in &scope {
        if !shown.contains(&i) {
            shown.push(i);
        }
    }
    shown.truncate(3);
    let shown: Vec<String> = shown
        .iter()
        .map(|&i| tool_expression(&entries[i].path))
        .collect();
    let more = scope.len() - shown.len();
    let message = if shown.is_empty() {
        format!("Tool '{path}' is not callable.")
    } else {
        format!(
            "Tool '{path}' is not callable, it is a namespace. Did you mean {}?",
            disjunction(&shown)
        )
    };
    let suggestion = if more > 0 {
        format!(
            "{more} more under '{path}'. Use search({{ namespace: {} }}) to list them.",
            schema::js_stringify(&Json::String(path.to_owned()))
        )
    } else {
        "Use search to find available tools.".into()
    };
    Box::new(Failed {
        kind: DiagnosticKind::UnknownTool,
        message,
        suggestions: vec![suggestion],
    })
}

/// `Intl.ListFormat("en", { type: "disjunction" })`.
fn disjunction(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [a] => a.clone(),
        [a, b] => format!("{a} or {b}"),
        [rest @ .., last] => format!("{}, or {last}", rest.join(", ")),
    }
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
            crate::Interrupted.to_string(),
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
        Settlement::Host(host) => match *host {
            (Ok(v), label, extension) => match result_from_host(vm, v, &label, &extension) {
                Ok(v) => vm.fulfill(p, v),
                Err(e) => vm.reject(p, e),
            },
            (Err(thrown), label, _) => {
                let e = from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e);
                vm.reject(p, e);
            }
        },
    }
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

// ---------- search ----------

fn search_native(vm: &mut Vm, _this: Value, args: &[Value], _callee: Id) -> Res {
    match run_search(vm, args) {
        Ok(json) => {
            let v = crate::convert::from_json(vm, &json);
            if let Value::Obj(id) = v {
                vm.heap[id as usize].proto = Some(promise_like_proto(vm));
            }
            Ok(v)
        }
        Err(f) => Err(failure_value(vm, f.kind, f.message, f.suggestions)),
    }
}

/// The built-in search, blocking: decode, admit, the hooks, then the ranking.
fn run_search(vm: &mut Vm, args: &[Value]) -> Result<Json, Box<Failed>> {
    let setup = vm.host.setup;
    let args: Vec<Value> = match args.first() {
        Some(Value::Str(s)) => {
            let query = vm.text(*s).to_owned();
            let id = vm.new_object();
            let q = vm.str_val(&query);
            let key = vm.atoms.intern("query");
            vm.define(id, key, q);
            let mut rest = vec![Value::Obj(id)];
            rest.extend_from_slice(&args[1..]);
            rest
        }
        _ => args.to_vec(),
    };
    let input = decode(vm, "search", &search::input_schema(), None, &args, true)?;
    admit_call(vm, "search", &input)?;
    let ctx = vm.host.context();
    let key = ctx.key();
    let shared = vm.host.shared.clone();
    shared.enter_sync(&vm.host, ctx.call, "search".into());
    let hooks = &setup.hooks;
    let call = ToolInvocation {
        name: "search".into(),
        input: input.clone(),
        key,
    };
    if let Some(before) = &hooks.tool_before
        && let Err(e) = block_on(before(&call))
    {
        shared.leave_sync();
        return Err(Failed::new(DiagnosticKind::ToolFailure, e.message));
    }
    let registry = &setup.registry;
    let result = search::search(registry.entries(), registry.word_index(), &input);
    shared.leave_sync();
    if let Some(after) = &hooks.tool_after {
        after(&call, CallResult::Success(&result));
    }
    Ok(result)
}

/// The prototype of `search` results: an ordinary object whose `then`, `catch` and `finally` act on a settled copy,
/// so a result can be used directly, awaited, or chained, while data views see only its own fields.
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
    let name = vm.text(name).to_owned();
    let key = vm.atoms.intern(&name);
    let method = vm.get(&Value::Obj(p), key)?;
    vm.call(&method, Value::Obj(p), args)
}

// ---------- extensions ----------

fn describe(vm: &Vm, v: &Value) -> &'static str {
    match v {
        Value::Sym(_) => "a symbol",
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => "a function",
            Kind::ToolRef(_) => "a tool reference",
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

/// A program value copied out for a host function.
fn to_host(
    vm: &mut Vm,
    v: &Value,
    label: &str,
    depth: usize,
    seen: &mut Vec<Id>,
) -> Result<HostValue, Value> {
    if depth > crate::convert::MAX_VALUE_DEPTH {
        let msg = format!(
            "{label} exceeds the maximum value depth of {}.",
            crate::convert::MAX_VALUE_DEPTH
        );
        return Err(vm.type_error(&msg));
    }
    let id = match v {
        Value::Undef | Value::Uninit => return Ok(HostValue::Undefined),
        Value::Null => return Ok(HostValue::Null),
        Value::Bool(b) => return Ok(HostValue::Bool(*b)),
        Value::Num(n) => return Ok(HostValue::Number(*n)),
        Value::Str(s) => return Ok(HostValue::String(vm.text(*s).to_owned())),
        Value::Sym(_) => {
            let msg = format!("{label} contains a symbol, which cannot be passed to an extension.");
            return Err(vm.type_error(&msg));
        }
        Value::Obj(id) => *id,
    };
    // Interpreter machinery is never data; every other object crosses as a copy, as the reference's `toHost`.
    let opaque = matches!(
        vm.heap[id as usize].kind,
        Kind::Closure(_)
            | Kind::Native { .. }
            | Kind::Bound(_)
            | Kind::ToolRef(_)
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
    );
    if opaque {
        let msg = format!(
            "{label} contains {}, which cannot be passed to an extension.",
            describe(vm, v)
        );
        return Err(vm.type_error(&msg));
    }
    if seen.contains(&id) {
        return Err(vm.type_error(&format!("{label} contains a circular value.")));
    }
    seen.push(id);
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
        Kind::Array(items) => {
            let items = items.clone();
            let mut out = Vec::with_capacity(items.len());
            for item in &items {
                out.push(match item {
                    Value::Uninit => None,
                    item => Some(to_host(vm, item, label, depth + 1, seen)?),
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
                    out.push((
                        to_host(vm, k, label, depth + 1, seen)?,
                        to_host(vm, val, label, depth + 1, seen)?,
                    ));
                }
                HostValue::Map(out)
            } else {
                let mut out = Vec::with_capacity(entries.len());
                for (k, _) in &entries {
                    out.push(to_host(vm, k, label, depth + 1, seen)?);
                }
                HostValue::Set(out)
            }
        }
        Kind::Error(_) => {
            let (name, message) = crate::convert::error_parts(vm, id);
            let mut error = HostError::named(name, message);
            let cause_key = vm.names.cause;
            if vm.has_own(id, cause_key) {
                let cause = vm.get_obj(id, cause_key);
                if let Ok(c) = to_host(vm, &cause, label, depth + 1, seen) {
                    error.cause = Some(Box::new(c));
                }
            }
            for (k, val) in vm.own_entries(id) {
                let key = vm.atoms.text(k).to_owned();
                if matches!(
                    key.as_str(),
                    "stack"
                        | "message"
                        | "constructor"
                        | "toString"
                        | "__proto__"
                        | "cause"
                        | "name"
                ) {
                    continue;
                }
                // A field that cannot cross is left behind, so the error itself always arrives.
                if let Ok(item) = to_host(vm, &val, label, depth + 1, seen) {
                    error.fields.push((key, item));
                }
            }
            HostValue::Error(Box::new(error))
        }
        _ => {
            let mut out = Vec::new();
            for (k, val) in vm.own_entries(id) {
                let key = vm.atoms.text(k).to_owned();
                if key == "__proto__" {
                    continue;
                }
                out.push((key, to_host(vm, &val, label, depth + 1, seen)?));
            }
            HostValue::Object(out)
        }
    };
    seen.pop();
    Ok(out)
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
        HostValue::String(s) => vm.str_val(s),
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
        .setup
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
pub fn snapshot_natives() -> [crate::vm::NativeFn; 4] {
    [
        search_native,
        require_native,
        import_native,
        extension_native,
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
    }
}

/// A host function as a program function, at `label`. Inside a global object, it is an entry point.
fn wrap(vm: &mut Vm, f: &HostFunction, label: &str, entry: Option<(&str, bool)>) -> Value {
    let index = vm.host.functions.len();
    vm.host.functions.push(FnEntry {
        f: f.clone(),
        label: label.to_owned(),
        extension: entry.map(|(e, _)| e.to_owned()).unwrap_or_default(),
        entry: entry.is_some_and(|(_, e)| e),
    });
    native(
        vm,
        &f.name.clone(),
        f.length,
        extension_native,
        Value::Num(index as f64),
    )
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
    let mut host_args = Vec::with_capacity(args.len());
    for (i, a) in args.iter().enumerate() {
        let mut seen = Vec::new();
        host_args.push(to_host(
            vm,
            a,
            &format!("Argument {} to {label}", i + 1),
            0,
            &mut seen,
        )?);
    }
    let setup = vm.host.setup;
    let hooks = &setup.hooks;
    let invocation = hooked.then(|| ExtensionInvocation {
        extension,
        name: label.clone(),
        args: host_args.clone(),
    });
    match &f.body {
        Body::Sync(body) => {
            let shared = vm.host.shared.clone();
            let call_id = vm.host.next_call();
            shared.enter_sync(&vm.host, call_id, label.clone());
            if let (Some(call), Some(before)) = (&invocation, &hooks.extension_before)
                && let Err(e) = block_on(before(call))
            {
                shared.leave_sync();
                let thrown = HostValue::Error(Box::new(e));
                return Err(from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e));
            }
            let result = body(host_args);
            shared.leave_sync();
            vm.host.next_epoch();
            if let (Some(call), Some(after)) = (&invocation, &hooks.extension_after) {
                report(after.as_ref(), call, &result);
            }
            match result {
                Ok(v) => result_from_host(vm, v, &label, &extension_name),
                Err(thrown) => Err(from_host(vm, &thrown, &label, None, 0).unwrap_or_else(|e| e)),
            }
        }
        Body::Lost(_) => unreachable!("refused above"),
        Body::Async(body) => {
            let p = vm.new_promise();
            let body = body.clone();
            let call_id = vm.host.next_call();
            let path = label.clone();
            let future: BoxFuture<'_, Settlement> = Box::pin(async move {
                if let (Some(call), Some(before)) = (&invocation, &hooks.extension_before)
                    && let Err(e) = before(call).await
                {
                    return Settlement::Host(Box::new((
                        Err(HostValue::Error(Box::new(e))),
                        label,
                        extension_name,
                    )));
                }
                let guard = ExtensionGuard {
                    hooks,
                    call: invocation,
                };
                let result = body(host_args).await;
                guard.end(&result);
                Settlement::Host(Box::new((result, label, extension_name)))
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

fn report(after: &crate::hooks::ExtensionAfter, call: &ExtensionInvocation, result: &HostResult) {
    match result {
        Ok(v) => after(call, CallResult::Success(v)),
        Err(thrown) => {
            let text = thrown_text(thrown);
            after(call, CallResult::Failure(&text));
        }
    }
}

fn thrown_text(v: &HostValue) -> String {
    match v {
        HostValue::Error(e) => e.message.clone(),
        HostValue::String(s) => s.clone(),
        other => other
            .to_json()
            .map(|j| schema::js_stringify(&j))
            .unwrap_or_default(),
    }
}

struct ExtensionGuard<'h> {
    hooks: &'h Hooks,
    call: Option<ExtensionInvocation>,
}

impl ExtensionGuard<'_> {
    fn end(mut self, result: &HostResult) {
        if let (Some(after), Some(call)) = (&self.hooks.extension_after, self.call.take()) {
            report(after.as_ref(), &call, result);
        }
    }
}

impl Drop for ExtensionGuard<'_> {
    fn drop(&mut self) {
        if let (Some(after), Some(call)) = (&self.hooks.extension_after, self.call.take()) {
            after(&call, CallResult::Interrupted);
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
    let found = match global_value(vm, &name) {
        Some(v) => Some(v),
        None => match name.as_str() {
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
        },
    };
    let Some(found) = found else {
        let message = format!(
            "Cannot import \"{specifier}\": it isn't available in Code Mode, which can't load packages or files. Use the provided globals, or call tools through `tools`."
        );
        let proto = vm.realm.error_proto;
        return Err(vm.make_error(proto, &message));
    };
    vm.host.modules.insert(name, found);
    Ok(found)
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
    let specifier = vm.text(*s).to_owned();
    module(vm, &specifier)
}

/// The compiler's import hook: `%import(specifier, kind, name)`. Kinds: 0 a default import, 1 a namespace, 2 a
/// named export, 3 a side-effect import, 4 `import()`.
fn import_native(vm: &mut Vm, _this: Value, args: &[Value], _callee: Id) -> Res {
    let specifier = match args.first() {
        Some(Value::Str(s)) => vm.text(*s).to_owned(),
        Some(other) => {
            let other = *other;
            let s = vm.string_of(&other)?;
            vm.text(s).to_owned()
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
                Err(e) => vm.reject(p, e),
            }
            Ok(Value::Obj(p))
        }
    }
}
