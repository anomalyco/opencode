//! Compiling a program, setting up its heap, built-ins and host globals, and copying its outcome out.

use std::borrow::Cow;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;

use crate::bytecode::Program;
use crate::compiler::{self, CompileError};
use crate::convert;
use crate::host::{self, RunHost};
use crate::nesting;
use crate::object::{Closure, Kind, Obj};
use crate::program::Running;
use crate::runtime::{ProgramOptions, Run};
use crate::strings::Strings;
use crate::value::Value;
use crate::vm::Vm;
use crate::{Data, Diagnostic, DiagnosticKind, HostString, Outcome, Runtime};

/// Native stack that parsing and compiling may use per unit of [`nesting::bound`], measured with
/// `bench/examples/stack_probe.rs`, with headroom. The costliest form per unit is a chain of prefix operators: 819 B a
/// level in release builds and 12.9 KB in debug builds.
pub const COMPILE_STACK_PER_LEVEL: usize = if cfg!(debug_assertions) {
    16 << 10
} else {
    1 << 10
};
/// The native stack a run may use from where it is driven, wherever it runs: past it a call fails with a RangeError, so
/// where a program runs never changes what it can do. A run on the caller's thread assumes this much is free there.
pub const RUN_STACK_BUDGET: usize = 512 << 10;
/// Room on a thread beyond what its work is measured to need.
pub(crate) const THREAD_STACK_BASE: usize = 256 << 10;

pub fn execute(rt: &Runtime, code: &str, options: &ProgramOptions) -> Outcome {
    let run = AssertUnwindSafe(|| settled(rt.program(code, options).run()));
    std::panic::catch_unwind(run).unwrap_or_else(|_| internal_error())
}

/// Compiles on the caller's thread when the program's syntax is shallow enough to compile within the run's stack
/// budget, whatever its length; a deeper one compiles on a thread with the stack its nesting needs. Running needs no
/// more native stack for deep syntax, so only compiling moves.
pub fn compile(code: &str, atoms: &mut Strings) -> Result<Program, CompileError> {
    let need = nesting::bound(code).saturating_mul(COMPILE_STACK_PER_LEVEL);
    if need <= RUN_STACK_BUDGET {
        return compiler::compile(code, atoms);
    }
    std::thread::scope(|s| {
        std::thread::Builder::new()
            .stack_size(need.saturating_add(THREAD_STACK_BASE))
            .spawn_scoped(s, || compiler::compile(code, atoms))
            .map_err(|_| CompileError {
                kind: DiagnosticKind::ExecutionFailure,
                message:
                    "The program is nested too deeply to compile: no thread with enough stack."
                        .into(),
                offset: None,
            })?
            .join()
            .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
    })
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
        metadata: Data::Null,
    }
}

/// Compiles a program and sets up its run, or the outcome when it does not compile.
pub fn start<'a>(
    rt: &'a Runtime,
    code: Cow<'a, str>,
    options: &ProgramOptions,
) -> Result<Box<Running>, Box<Outcome>> {
    let mut atoms = Strings::new();
    let program = match compile(&code, &mut atoms) {
        Ok(p) => p,
        Err(e) => {
            let location = e.offset.map(|o| line_col(&code, o));
            let message = format!("{}{}", e.message, suffix(location));
            return Err(Box::new(failed(Diagnostic {
                kind: e.kind,
                message: message.into(),
                location,
                suggestions: Vec::new(),
            })));
        }
    };
    let setup = rt.setup();
    let run = Run::new(options.run_id.clone(), Data::Null);
    let globals = setup.globals_for(&run);
    let host = RunHost::new(globals, setup.modules.clone(), setup.translate, run);
    let mut vm = Vm::new(host, setup.limits, atoms);
    vm.setup();
    crate::builtins::ensure_globals(&mut vm, &program.globals);
    host::install(&mut vm, &program.globals);
    vm.snapshot_base = crate::snapshot::Base::of(&vm);
    for (k, v) in &options.bindings {
        // Host globals of the same name win, as in the reference.
        if k.as_str().is_some_and(|k| host::has_host_global(&vm, k)) {
            continue;
        }
        let val = convert::from_data(&mut vm, v);
        let a = vm.atoms.intern(&k.to_run_text());
        vm.global_map.insert(a, val);
    }
    vm.load(program);
    Ok(Box::new(Running::new(vm, code.into_owned())))
}

/// A fresh run for a saved program: compiled and set up with the saved limits and no bindings, ready to be filled in.
pub struct Resumed {
    pub running: Box<Running>,
    pub bytecode: String,
}

pub fn start_for_resume(
    rt: &Runtime,
    restored: crate::snapshot::Restored,
) -> Result<Resumed, crate::snapshot::SnapshotError> {
    let code = restored.code;
    let mut atoms = Strings::new();
    let program = compile(&code, &mut atoms).map_err(|_| {
        crate::snapshot::SnapshotError::new(
            "Source main does not compile in this build, so it can't resume.",
        )
    })?;
    let bytecode = crate::snapshot::bytecode_hash(&program);
    let setup = rt.setup();
    let run = Run::new(restored.run_id, restored.metadata);
    let globals = setup.globals_for(&run);
    if crate::snapshot::hosts_id(&globals) != restored.hosts {
        return Err(crate::snapshot::SnapshotError::new(
            "This state was saved by a runtime with other host globals; resume it with the same ones.",
        ));
    }
    let host = RunHost::new(globals, setup.modules.clone(), setup.translate, run);
    let mut vm = Vm::new(host, restored.limits, atoms);
    vm.setup();
    crate::builtins::ensure_globals(&mut vm, &program.globals);
    host::install(&mut vm, &program.globals);
    vm.snapshot_base = crate::snapshot::Base::of(&vm);
    vm.load(program);
    Ok(Resumed {
        running: Box::new(Running::new(vm, code)),
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
            upvals: Arc::from(Vec::new()),
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
pub fn finish(r: Running) -> Outcome {
    let Running { mut vm, code, .. } = r;
    let code: &str = &code;
    vm.host.tasks.clear();
    let vm = &mut vm;
    let result = match (vm.fatal.clone(), vm.outcome.take()) {
        (Some((kind, message)), _) => Err(diagnostic(kind, message)),
        (None, Some(Ok(v))) => match vm.result_json.take() {
            Some(j) => Ok(Data::from_run_json(j)),
            None => match convert::to_json(vm, &v) {
                Ok(j) => Ok(Data::from_run_json(j)),
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
    let logs = std::mem::take(&mut vm.logs)
        .iter()
        .map(|l| HostString::from_run_text(l))
        .collect();
    let metadata = vm.host.run.metadata();
    bound_output(
        Outcome {
            result,
            warnings,
            logs,
            truncated: false,
            metadata,
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
            diagnose_with(
                vm,
                &reason,
                code,
                "Unhandled rejection from an un-awaited promise: ",
            )
        })
        .collect()
}

/// The JSON text a diagnostic crosses the reference's boundary as, for the output budget.
fn diagnostic_json(d: &Diagnostic) -> String {
    let mut fields = vec![
        (HostString::from("kind"), Data::String(d.kind.name().into())),
        (HostString::from("message"), Data::String(d.message.clone())),
    ];
    if let Some((line, column)) = d.location {
        fields.push((
            "location".into(),
            Data::from(serde_json::json!({ "line": line, "column": column })),
        ));
    }
    if !d.suggestions.is_empty() {
        fields.push((
            "suggestions".into(),
            Data::Array(d.suggestions.iter().cloned().map(Data::String).collect()),
        ));
    }
    Data::Object(fields).to_json_string()
}

/// A diagnostic whose message is a run's text (see `strings`), which keeps unpaired surrogates.
fn diagnostic(kind: DiagnosticKind, message: String) -> Diagnostic {
    Diagnostic {
        kind,
        message: HostString::from_run_text(&message),
        location: None,
        suggestions: Vec::new(),
    }
}

/// The diagnostic for an uncaught value.
fn diagnose(vm: &mut Vm, e: &Value, code: &str) -> Diagnostic {
    diagnose_with(vm, e, code, "")
}

/// The diagnostic for an uncaught value, its message after `prefix`.
fn diagnose_with(vm: &mut Vm, e: &Value, code: &str, prefix: &str) -> Diagnostic {
    let (kind, message, location, suggestions) = diagnose_text(vm, e, code);
    Diagnostic {
        kind,
        message: HostString::from_run_text(&format!("{prefix}{message}")),
        location,
        suggestions,
    }
}

/// An uncaught value's kind, message as a run's text, location and suggestions.
type Diagnosed = (DiagnosticKind, String, Option<(u32, u32)>, Vec<HostString>);

fn diagnose_text(vm: &mut Vm, e: &Value, code: &str) -> Diagnosed {
    if let Value::Obj(id) = e
        && let Kind::Error(failure) = &vm.heap[*id as usize].kind
    {
        let id = *id;
        if let Some(f) = failure.clone() {
            let location = f.offset.map(|o| line_col(code, o));
            let message = match f.kind {
                DiagnosticKind::ExecutionFailure
                | DiagnosticKind::InvalidDataValue
                | DiagnosticKind::UnsupportedSyntax => {
                    let (name, _) = convert::error_parts(vm, id);
                    format!("{name}: {}{}", f.message, suffix(location))
                }
                _ => f.message.clone(),
            };
            let suggestions = vm.host.suggestions.get(&id).cloned().unwrap_or_default();
            return (f.kind, message, location, suggestions);
        }
        let message = convert::error_to_string(vm, id);
        return (DiagnosticKind::ExecutionFailure, message, None, Vec::new());
    }
    // As the reference does, a thrown value's internals never show through a failure.
    let text = if convert::holds_runtime_reference(vm, e) {
        "a non-data value".to_owned()
    } else {
        convert::format_value(vm, e)
    };
    (
        DiagnosticKind::ExecutionFailure,
        format!("Uncaught: {text}"),
        None,
        Vec::new(),
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
        let text = v.to_json_string();
        value_bytes = text.len();
        if value_bytes > max {
            let mut cut = max;
            while !text.is_char_boundary(cut) {
                cut -= 1;
            }
            outcome.result = Ok(Data::String(HostString::from(format!(
                "{} [result truncated: {value_bytes} bytes exceeds the {max}-byte output limit; return a smaller value]",
                &text[..cut]
            ))));
            outcome.truncated = true;
        }
    }
    // Warnings have a budget of their own, so result data cannot starve them.
    let mut used = 0;
    let fit = outcome
        .warnings
        .iter()
        .take_while(|w| {
            used += diagnostic_json(w).len() + 1;
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
        // As UTF-8, an unpaired surrogate takes U+FFFD's three bytes.
        used += line.to_string_lossy().len() + 1;
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
            .push(format!("[logs truncated: showing {kept} of {total} lines]").into());
        outcome.truncated = true;
    }
    outcome
}
