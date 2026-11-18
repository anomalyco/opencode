//! Compiling a program, setting up its heap, built-ins and host globals, and copying its outcome out.

use std::borrow::Cow;
use std::panic::AssertUnwindSafe;
use std::rc::Rc;

use crate::compiler;
use crate::convert;
use crate::extension::Extension;
use crate::host::{self, RunHost};
use crate::object::{Closure, Kind, Obj};
use crate::program::Running;
use crate::strings::Strings;
use crate::value::Value;
use crate::vm::Vm;
use crate::{Diagnostic, DiagnosticKind, Json, Outcome, RunOptions, Runtime};

/// Small programs run on the caller's thread with a modest native-stack budget. Larger ones, whose parse can
/// recurse deeper, run on their own thread with a large stack; the reservation is virtual, only touched pages are
/// committed.
const INLINE_SOURCE_BYTES: usize = 2048;
const INLINE_BRACKET_DEPTH: usize = 64;
pub const INLINE_STACK_BUDGET: usize = 512 << 10;
const STACK_SIZE: usize = 256 << 20;
const THREAD_STACK_BUDGET: usize = 64 << 20;

pub fn execute(
    rt: &Runtime,
    code: &str,
    bindings: &serde_json::Map<String, Json>,
    options: &RunOptions,
) -> Outcome {
    // A pick the runtime can't honour is the host's mistake, raised before the run, not an interpreter defect.
    rt.setup().check(options);
    if code.len() <= INLINE_SOURCE_BYTES && bracket_depth(code) <= INLINE_BRACKET_DEPTH {
        let run =
            AssertUnwindSafe(|| settled(rt.program_with(code, bindings, None, options).run()));
        return std::panic::catch_unwind(run).unwrap_or_else(|_| internal_error());
    }
    std::thread::scope(|s| {
        let spawned = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(s, || {
                let mut program = rt.program_with(code, bindings, None, options);
                program.stack_budget = THREAD_STACK_BUDGET;
                settled(program.run())
            });
        match spawned {
            Ok(handle) => handle.join().unwrap_or_else(|_| internal_error()),
            Err(_) => settled(rt.program_with(code, bindings, None, options).run()),
        }
    })
}

/// The deepest bracket nesting in the source text, a cheap bound on how deep parsing recurses.
fn bracket_depth(code: &str) -> usize {
    let (mut depth, mut max) = (0usize, 0usize);
    for b in code.bytes() {
        match b {
            b'(' | b'[' | b'{' => {
                depth += 1;
                max = max.max(depth);
            }
            b')' | b']' | b'}' => depth = depth.saturating_sub(1),
            _ => {}
        }
    }
    max
}

/// The outcome of a run, or for an interrupted one, an `ExecutionFailure` that says so.
fn settled(run: Result<Outcome, crate::Interrupted>) -> Outcome {
    run.unwrap_or_else(|i| failed(diagnostic(DiagnosticKind::ExecutionFailure, i.to_string())))
}

/// A defect in the interpreter, reported instead of unwinding into the host.
fn internal_error() -> Outcome {
    failed(Diagnostic {
        kind: DiagnosticKind::ExecutionFailure,
        message: "Internal interpreter error.".into(),
        location: None,
        suggestions: Vec::new(),
    })
}

fn failed(error: Diagnostic) -> Outcome {
    Outcome {
        result: Err(error),
        warnings: Vec::new(),
        logs: Vec::new(),
        truncated: false,
        tool_calls: Vec::new(),
    }
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

/// Compiles a program and sets up its run, or the outcome when it does not compile.
pub fn start<'a>(
    rt: &'a Runtime,
    code: Cow<'a, str>,
    bindings: &serde_json::Map<String, Json>,
    run_id: Option<String>,
    extensions: Rc<[&'a Extension]>,
) -> Result<Box<Running<'a>>, Box<Outcome>> {
    let mut atoms = Strings::new();
    let program = match compiler::compile(&code, &mut atoms) {
        Ok(p) => p,
        Err(e) => {
            let location = e.offset.map(|o| line_col(&code, o));
            let message = format!("{}{}", e.message, suffix(location));
            return Err(Box::new(failed(Diagnostic {
                kind: e.kind,
                message,
                location,
                suggestions: Vec::new(),
            })));
        }
    };
    let setup = rt.setup();
    let mut vm = Vm::new(RunHost::new(setup, extensions, run_id), setup.limits, atoms);
    vm.setup();
    host::install(&mut vm, &program.globals);
    crate::builtins::ensure_globals(&mut vm, &program.globals);
    vm.snapshot_base = crate::snapshot::Base::of(&vm);
    for (k, v) in bindings {
        let val = convert::from_json(&mut vm, v);
        let a = vm.atoms.intern(k);
        vm.global_map.insert(a, val);
    }
    vm.load(program);
    Ok(Box::new(Running::new(vm, code)))
}

/// A fresh run for a saved program: compiled and set up with the saved limits and no bindings, ready to be filled in.
pub struct Resumed<'a> {
    pub running: Box<Running<'a>>,
    pub bytecode: String,
}

pub fn start_for_resume<'a>(
    rt: &'a Runtime,
    code: String,
    run_id: Option<String>,
    limits: crate::Limits,
    extensions: Rc<[&'a Extension]>,
) -> Result<Resumed<'a>, crate::snapshot::SnapshotError> {
    let mut atoms = Strings::new();
    let program = compiler::compile(&code, &mut atoms).map_err(|_| {
        crate::snapshot::SnapshotError::new(
            "Source main does not compile in this build, so it can't resume.",
        )
    })?;
    let bytecode = crate::snapshot::bytecode_hash(&program);
    let setup = rt.setup();
    let mut vm = Vm::new(RunHost::new(setup, extensions, run_id), limits, atoms);
    vm.setup();
    host::install(&mut vm, &program.globals);
    crate::builtins::ensure_globals(&mut vm, &program.globals);
    vm.snapshot_base = crate::snapshot::Base::of(&vm);
    vm.load(program);
    Ok(Resumed {
        running: Box::new(Running::new(vm, Cow::Owned(code))),
        bytecode,
    })
}

/// The outcome reported for an interrupted run, to a suspend that asks after it.
pub fn failed_interrupted() -> Outcome {
    failed(diagnostic(
        DiagnosticKind::ExecutionFailure,
        crate::Interrupted.to_string(),
    ))
}

/// What `Program::run` reports for a run a suspender stopped.
pub fn failed_suspended() -> Outcome {
    failed(diagnostic(
        DiagnosticKind::ExecutionFailure,
        "The run was suspended; run it with run_resumable to get its state.".into(),
    ))
}

/// Runs the program's body to its first suspension.
pub fn call_main(vm: &mut Vm) {
    let proto = vm.protos[0].clone();
    let fp = vm.realm.function_proto;
    let main = Value::Obj(vm.alloc(Obj::new(
        Some(fp),
        Kind::Closure(Box::new(Closure {
            proto,
            upvals: Rc::from(Vec::new()),
            this: Value::Undef,
        })),
    )));
    vm.resumable_run = true;
    vm.start_handover_fuel();
    let r = vm.call(&main, Value::Undef, &[]);
    vm.resumable_run = false;
    if let Err(e) = r
        && vm.outcome.is_none()
    {
        vm.outcome = Some(Err(e));
    }
}

/// The outcome of a run that ended: host work it left running is interrupted, then the result is copied out.
pub fn finish(r: Running<'_>) -> Outcome {
    let Running { mut vm, code, .. } = r;
    let code: &str = &code;
    vm.host.tasks.clear();
    let vm = &mut vm;
    let result = match (vm.fatal.clone(), vm.outcome.take()) {
        (Some((kind, message)), _) => Err(diagnostic(kind, message)),
        (None, Some(Ok(v))) => match vm.result_json.take() {
            Some(j) => Ok(j),
            None => match convert::to_json(vm, &v) {
                Ok(j) => Ok(j),
                Err(e) => Err(diagnose(vm, &e, code)),
            },
        },
        (None, Some(Err(e))) => Err(diagnose(vm, &e, code)),
        (None, None) => Err(diagnostic(
            DiagnosticKind::ExecutionFailure,
            "The program did not finish.".into(),
        )),
    };
    let result = match (vm.fatal.clone(), result) {
        (Some((kind, message)), Ok(_)) => Err(diagnostic(kind, message)),
        (_, r) => r,
    };
    let warnings = if result.is_ok() {
        warnings(vm, code)
    } else {
        Vec::new()
    };
    let logs = std::mem::take(&mut vm.logs);
    let tool_calls = std::mem::take(&mut vm.tool_calls);
    bound_output(
        Outcome {
            result,
            warnings,
            logs,
            truncated: false,
            tool_calls,
        },
        vm.limits.max_output_bytes,
    )
}

/// Rejections nothing handled, in promise creation order, once completed host calls have settled their promises.
fn warnings(vm: &mut Vm, code: &str) -> Vec<Diagnostic> {
    while let Some((p, s)) = vm.inbox.pop_front() {
        if !matches!(s, host::Settlement::Interrupted) {
            host::settle(vm, p, s);
        }
    }
    let mut unhandled = std::mem::take(&mut vm.host.unhandled);
    unhandled.sort_by_key(|(p, _)| *p);
    unhandled
        .into_iter()
        .map(|(_, reason)| {
            let mut d = diagnose(vm, &reason, code);
            d.message = format!(
                "Unhandled rejection from an un-awaited promise: {}",
                d.message
            );
            d
        })
        .collect()
}

/// The JSON a diagnostic crosses the reference's boundary as, for the output budget.
fn diagnostic_json(d: &Diagnostic) -> Json {
    let mut map = serde_json::Map::new();
    map.insert("kind".into(), d.kind.name().into());
    map.insert("message".into(), d.message.clone().into());
    if let Some((line, column)) = d.location {
        map.insert(
            "location".into(),
            serde_json::json!({ "line": line, "column": column }),
        );
    }
    if !d.suggestions.is_empty() {
        map.insert("suggestions".into(), d.suggestions.clone().into());
    }
    Json::Object(map)
}

fn diagnostic(kind: DiagnosticKind, message: String) -> Diagnostic {
    let message = match crate::strings::host_text(&message) {
        std::borrow::Cow::Owned(m) => m,
        std::borrow::Cow::Borrowed(_) => message,
    };
    Diagnostic {
        kind,
        message,
        location: None,
        suggestions: Vec::new(),
    }
}

/// The diagnostic for an uncaught value, with its text as the host gets it.
fn diagnose(vm: &mut Vm, e: &Value, code: &str) -> Diagnostic {
    let mut d = diagnose_text(vm, e, code);
    if let std::borrow::Cow::Owned(m) = crate::strings::host_text(&d.message) {
        d.message = m;
    }
    d
}

fn diagnose_text(vm: &mut Vm, e: &Value, code: &str) -> Diagnostic {
    if let Value::Obj(id) = e
        && let Kind::Error(failure) = &vm.heap[*id as usize].kind
    {
        let id = *id;
        if let Some(f) = failure.clone() {
            let location = f.offset.map(|o| line_col(code, o));
            let message = match f.kind {
                DiagnosticKind::ExecutionFailure | DiagnosticKind::InvalidDataValue => {
                    let (name, _) = convert::error_parts(vm, id);
                    format!("{name}: {}{}", f.message, suffix(location))
                }
                _ => f.message.clone(),
            };
            return Diagnostic {
                kind: f.kind,
                message,
                location,
                suggestions: vm.host.suggestions.get(&id).cloned().unwrap_or_default(),
            };
        }
        let message = convert::error_to_string(vm, id);
        return diagnostic(DiagnosticKind::ExecutionFailure, message);
    }
    let text = convert::format_value(vm, e);
    diagnostic(
        DiagnosticKind::ExecutionFailure,
        format!("Uncaught: {text}"),
    )
}

fn suffix(location: Option<(u32, u32)>) -> String {
    match location {
        Some((line, col)) => format!(" (line {line}, col {col})"),
        None => String::new(),
    }
}

/// 1-based line and column (in UTF-16 units) of a byte offset.
fn line_col(code: &str, offset: u32) -> (u32, u32) {
    let offset = (offset as usize).min(code.len());
    let before = code.get(..offset).unwrap_or(code);
    let line = before.matches('\n').count() as u32 + 1;
    let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let col = before[line_start..].encode_utf16().count() as u32 + 1;
    (line, col)
}

/// Keeps the result and logs within `max_output_bytes`, the way the reference does.
fn bound_output(mut outcome: Outcome, max: Option<usize>) -> Outcome {
    let Some(max) = max else { return outcome };
    let mut value_bytes = 0;
    if let Ok(v) = &outcome.result {
        let text = v.to_string();
        value_bytes = text.len();
        if value_bytes > max {
            let mut cut = max;
            while !text.is_char_boundary(cut) {
                cut -= 1;
            }
            outcome.result = Ok(Json::String(format!(
                "{} [result truncated: {value_bytes} bytes exceeds the {max}-byte output limit; return a smaller value]",
                &text[..cut]
            )));
            outcome.truncated = true;
        }
    }
    // Warnings have a budget of their own, so result data cannot starve them.
    let mut used = 0;
    let fit = outcome
        .warnings
        .iter()
        .take_while(|w| {
            used += crate::schema::js_stringify(&diagnostic_json(w)).len() + 1;
            used <= max
        })
        .count();
    if fit < outcome.warnings.len() {
        let omitted = outcome.warnings.len() - fit;
        outcome.warnings.truncate(fit);
        outcome.warnings.push(diagnostic(
            DiagnosticKind::Truncated,
            format!("{omitted} additional warnings omitted by the output limit."),
        ));
        outcome.truncated = true;
    }
    let budget = max.saturating_sub(value_bytes.min(max));
    let mut used = 0;
    let mut kept = 0;
    for line in &outcome.logs {
        used += line.len() + 1;
        if used > budget {
            break;
        }
        kept += 1;
    }
    if kept < outcome.logs.len() {
        let total = outcome.logs.len();
        outcome.logs.truncate(kept);
        outcome
            .logs
            .push(format!("[logs truncated: showing {kept} of {total} lines]"));
        outcome.truncated = true;
    }
    outcome
}
