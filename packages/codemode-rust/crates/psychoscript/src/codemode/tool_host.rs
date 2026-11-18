//! Code Mode's side of a run's host work: tool calls, the `search` built-in, and the hooks around both and around
//! extension calls. The language layer reaches it only through `Embedder`, which the runtime's `Setup` implements.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::Poll;

use crate::codemode::hooks::{CallResult, ExtensionInvocation, Hooks, ToolInvocation};
use crate::codemode::schema;
use crate::codemode::search;
use crate::codemode::tool::{Execute, Tool, ToolContext, tool_expression};
use crate::exec::{BoxFuture, block_on};
use crate::extension::{HostError, HostValue};
use crate::host::{Call, CallKind, Crossed, Embedder, Ended, Failed, HostCall, Settlement, Start};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Res, Vm};
use crate::{DiagnosticKind, Json, Setup};

/// The runtime a run belongs to, which made it and outlives it.
fn setup<'rt>(vm: &Vm<'rt>) -> &'rt Setup {
    let embedder: &'rt dyn Embedder = vm.host.embedder;
    embedder
        .as_any()
        .downcast_ref::<Setup>()
        .expect("a run's embedder is the runtime's setup")
}

/// Code Mode's own state in a run: the context handed to synchronous tools, its call id set for each call.
#[derive(Default)]
struct RunState {
    ctx: Option<ToolContext>,
}

fn state<'v>(vm: &'v mut Vm) -> &'v mut RunState {
    let slot = &mut vm.host.embedded;
    if !slot.as_ref().is_some_and(|s| s.is::<RunState>()) {
        *slot = Some(Box::new(RunState::default()));
    }
    slot.as_mut()
        .and_then(|s| s.downcast_mut::<RunState>())
        .expect("made above")
}

/// A new call's context.
fn context(vm: &mut Vm) -> ToolContext {
    let id = vm.host.next_call();
    ToolContext::new(vm.host.run_id(), id)
}

/// The shared context for a synchronous call, without a reference count change per call.
fn sync_context<'v>(vm: &'v mut Vm, call: u64) -> &'v ToolContext {
    let run_id = vm.host.run_id.clone();
    let st = state(vm);
    let ctx = st.ctx.get_or_insert_with(|| ToolContext::new(run_id, 0));
    ctx.call = call;
    ctx
}

impl Embedder for Setup {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn global(&self, vm: &mut Vm<'_>, name: &str) -> Option<Value> {
        if name != "search" {
            return None;
        }
        let f = crate::host::native(vm, "search", 0, search_native, Value::Undef);
        if let Value::Obj(id) = f {
            vm.search_fn = id;
        }
        Some(f)
    }

    fn call_namespace(&self, vm: &mut Vm<'_>, path: &str, args: &[Value]) -> Res {
        call_tool(vm, path, args)
    }

    fn call_blocking(&self, vm: &mut Vm<'_>, args: &[Option<Json>]) -> Res {
        search_value(vm, args)
    }

    fn namespace_keys(&self, path: &str) -> Vec<String> {
        self.registry.children(path)
    }

    fn cancel(&self, path: &str, data: Json) {
        if let Some(tool) = self.registry.get(path)
            && let Execute::Durable(d) = &tool.execute
        {
            block_on((d.cancel)(data));
        }
    }

    fn restorable(&self, path: &str, durable: bool) -> Result<(), String> {
        let Some(tool) = self.registry.get(path) else {
            return Err(format!(
                "This state has a call to tools.{path} in flight, which this runtime doesn't have."
            ));
        };
        if durable && !matches!(tool.execute, Execute::Durable(_)) {
            return Err(format!(
                "This state has a started durable call to tools.{path}, which is no longer durable here."
            ));
        }
        Ok(())
    }

    fn restart(&self, vm: &mut Vm<'_>, p: Id, path: &str, input: Json, call: u64, start: Start) {
        let setup = setup(vm);
        if let Some(tool) = setup.registry.get(path) {
            spawn_tool(vm, p, path, tool, input, call, start);
        }
    }

    fn natives(&self) -> &'static [NativeFn] {
        &[search_native]
    }

    fn watches_calls(&self) -> bool {
        self.hooks.extension_before.is_some() || self.hooks.extension_after.is_some()
    }

    fn before_call(&self, call: &HostCall) -> Option<BoxFuture<'static, Result<(), HostError>>> {
        let before = self.hooks.extension_before.as_ref()?;
        Some(before(&invocation(call)))
    }

    fn after_call(&self, call: &HostCall, ended: Ended<'_>) {
        let Some(after) = &self.hooks.extension_after else {
            return;
        };
        let call = invocation(call);
        match ended {
            Ended::Returned(Ok(v)) => after(&call, CallResult::Success(v)),
            Ended::Returned(Err(thrown)) => {
                let text = thrown_text(thrown);
                after(&call, CallResult::Failure(&text));
            }
            Ended::Interrupted => after(&call, CallResult::Interrupted),
        }
    }
}

fn invocation(call: &HostCall) -> ExtensionInvocation {
    ExtensionInvocation {
        extension: call.extension.clone(),
        name: call.label.clone(),
        args: call.args.clone(),
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

// ---------- tool calls ----------

/// `tools.<path>(...args)`: returns a promise at once. The arguments cross now (`cross::tool_args`): a failure there
/// rejects the promise, and when they hold promises that haven't fulfilled the call waits for them first
/// (`cross::wait_async`); otherwise the call starts, and settles the promise later.
pub fn call_tool(vm: &mut Vm, path: &str, args: &[Value]) -> Res {
    use crate::cross::Args;
    let p = vm.new_promise();
    let label = || tool_expression(path);
    match crate::cross::tool_args(vm, args, crate::cross::Callee::Lazy(&label)) {
        Err(e) if vm.fatal.is_some() => return Err(e),
        Err(e) => vm.reject(p, e),
        Ok(Args::Ready(json)) => start_tool(vm, p, path, json),
        Ok(Args::Wait(promises)) => {
            let callee = vm.tool_ref(path);
            crate::cross::wait_async(vm, promises, callee, args, p);
        }
    }
    Ok(Value::Obj(p))
}

/// Everything about a call that happens before its tool runs: the reference's `decode` and `admit`.
struct Admitted<'rt> {
    tool: &'rt Tool,
    input: Json,
    call: u64,
}

/// Starts a call whose promise is `p`, once its arguments have crossed (`args`, `None` for undefined, or the failure
/// the tool runtime's `toJson` meets, which fails a call that finds its tool). A call that ends at once queues its
/// outcome; the rest become tasks.
pub(crate) fn start_tool<'rt>(vm: &mut Vm<'rt>, p: Id, path: &str, args: Crossed) {
    let setup = setup(vm);
    // Models often write `tools.search(...)` for the bare `search(...)`; honor it unless a tool owns that path.
    if path == "search" && !setup.registry.exists("search") {
        let s = match args.and_then(|args| run_search(vm, &args)) {
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
        vm.host.enter_sync(admitted.call, tool_expression(path));
        let raw = f(admitted.input, sync_context(vm, admitted.call));
        vm.host.leave_sync();
        let s = finish(path, admitted.tool, raw);
        if let Settlement::Interrupted = s {
            crate::host::interrupt(vm);
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
    let setup = setup(vm);
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
fn admit<'rt>(vm: &mut Vm<'rt>, path: &str, args: Crossed) -> Result<Admitted<'rt>, Box<Failed>> {
    let setup = setup(vm);
    let Some(tool) = setup.registry.get(path) else {
        return Err(unknown_tool(setup, path));
    };
    let tool: &'rt Tool = tool;
    let args = args?;
    let entry_field = if tool.freeform {
        schema::string_parameter(tool.input.document()).map(|(name, _)| name)
    } else {
        None
    };
    let input = decode(path, &tool.input, entry_field.as_deref(), args, false)?;
    admit_call(vm, path, &input)?;
    let call = vm.host.next_call();
    Ok(Admitted { tool, input, call })
}

/// Decodes the call's crossed argument with the tool's input schema.
#[inline]
fn decode(
    name: &str,
    schema: &crate::Schema,
    string_field: Option<&str>,
    args: Vec<Option<Json>>,
    search: bool,
) -> Result<Json, Box<Failed>> {
    if args.len() > 1 {
        return Err(Failed::new(
            DiagnosticKind::InvalidToolInput,
            format!("Tool '{name}' expects at most one input object."),
        ));
    }
    let input = match args.into_iter().next() {
        None => Json::Object(serde_json::Map::new()),
        Some(j) => j.unwrap_or(Json::Null),
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
        .map_err(|e| Failed::from_parts(
            DiagnosticKind::InvalidToolInput,
            format!("Invalid input for tool '{name}': {e}"),
            vec![if search {
                "Pass search a query string or an object, such as search(\"issues\") or search({ namespace: \"github\" }).".into()
            } else {
                "The signature may have changed. Use search to get the current signature.".into()
            }],
        ))
}

/// Counts a call against `max_tool_calls` and records it.
#[inline]
fn admit_call(vm: &mut Vm, path: &str, input: &Json) -> Result<(), Box<Failed>> {
    if let Some(max) = vm.limits.max_tool_calls
        && vm.recorded_calls.len() as u64 >= max
    {
        return Err(Failed::new(
            DiagnosticKind::ToolCallLimitExceeded,
            format!("Execution exceeded its tool-call limit of {max}."),
        ));
    }
    vm.recorded_calls.push((path.to_owned(), input.clone()));
    Ok(())
}

/// A tool's raw result as the program receives it.
#[inline]
fn finish(name: &str, tool: &Tool, raw: Result<Json, crate::ToolError>) -> Settlement {
    match raw {
        Err(e) if e.is_interrupt() => Settlement::Interrupted,
        Err(e) => Failed::settlement(DiagnosticKind::ToolFailure, e.message),
        Ok(raw) => match &tool.output {
            None => Settlement::Undefined,
            Some(schema) => match schema.validate(raw) {
                Ok(json) => Settlement::Json(json),
                Err(e) => Failed::settlement(
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
            Settlement::Failure(f) => after(&call, CallResult::Failure(f.message())),
            Settlement::Interrupted => after(&call, CallResult::Interrupted),
            Settlement::Host(_) | Settlement::Lost(..) => {}
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
        return Failed::settlement(DiagnosticKind::ToolFailure, e.message);
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
        return Failed::from_parts(
            DiagnosticKind::UnknownTool,
            message,
            vec!["Use search to find available tools.".into()],
        );
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
    Failed::from_parts(DiagnosticKind::UnknownTool, message, vec![suggestion])
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

// ---------- search ----------

/// `search(...)` called other than from bytecode, which `call_op` runs itself (`cross::search_call`).
fn search_native(vm: &mut Vm, _this: Value, args: &[Value], _callee: Id) -> Res {
    crate::cross::search_call(vm, args)
}

/// What `search(...)` answers for its crossed arguments.
pub(crate) fn search_value(vm: &mut Vm, args: &[Option<Json>]) -> Res {
    match run_search(vm, args) {
        Ok(json) => {
            let v = crate::convert::from_json(vm, &json);
            if let Value::Obj(id) = v {
                vm.heap[id as usize].proto = Some(promise_like_proto(vm));
            }
            Ok(v)
        }
        Err(f) => Err(crate::host::failed_value(vm, *f)),
    }
}

/// The built-in search, blocking: decode, admit, the hooks, then the ranking.
fn run_search(vm: &mut Vm, args: &[Option<Json>]) -> Result<Json, Box<Failed>> {
    let setup = setup(vm);
    let mut args = args.to_vec();
    if let Some(Some(Json::String(query))) = args.first() {
        let mut map = serde_json::Map::new();
        map.insert("query".into(), Json::String(query.clone()));
        args[0] = Some(Json::Object(map));
    }
    let input = decode("search", &search::input_schema(), None, args, true)?;
    admit_call(vm, "search", &input)?;
    let ctx = context(vm);
    let key = ctx.key();
    vm.host.enter_sync(ctx.call, "search".into());
    let hooks = &setup.hooks;
    let call = ToolInvocation {
        name: "search".into(),
        input: input.clone(),
        key,
    };
    if let Some(before) = &hooks.tool_before
        && let Err(e) = block_on(before(&call))
    {
        vm.host.leave_sync();
        return Err(Failed::new(DiagnosticKind::ToolFailure, e.message));
    }
    let registry = &setup.registry;
    let result = search::search(registry.entries(), registry.word_index(), &input);
    vm.host.leave_sync();
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
        let f = crate::host::native(
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
