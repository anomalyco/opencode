//! Compiling a program, setting up its heap, built-ins and host globals, and copying its outcome out.

use std::panic::AssertUnwindSafe;
use std::rc::Rc;

use crate::compiler;
use crate::convert;
use crate::host::{self, RunHost};
use crate::object::{Closure, Kind, Obj};
use crate::program::Running;
use crate::strings::Strings;
use crate::value::Value;
use crate::vm::Vm;
use crate::{Diagnostic, DiagnosticKind, Json, Outcome, Runtime};

/// Small programs run on the caller's thread with a modest native-stack budget. Larger ones, whose parse can
/// recurse deeper, run on their own thread with a large stack; the reservation is virtual, only touched pages are
/// committed.
const INLINE_SOURCE_BYTES: usize = 2048;
const INLINE_BRACKET_DEPTH: usize = 64;
pub const INLINE_STACK_BUDGET: usize = 512 << 10;
const STACK_SIZE: usize = 256 << 20;
const THREAD_STACK_BUDGET: usize = 64 << 20;

pub fn execute(rt: &Runtime, code: &str, bindings: &serde_json::Map<String, Json>) -> Outcome {
    if code.len() <= INLINE_SOURCE_BYTES && bracket_depth(code) <= INLINE_BRACKET_DEPTH {
        let run = AssertUnwindSafe(|| rt.program(code, bindings, None).run());
        return std::panic::catch_unwind(run).unwrap_or_else(|_| internal_error());
    }
    std::thread::scope(|s| {
        let spawned = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(s, || {
                let mut program = rt.program(code, bindings, None);
                program.stack_budget = THREAD_STACK_BUDGET;
                program.run()
            });
        match spawned {
            Ok(handle) => handle.join().unwrap_or_else(|_| internal_error()),
            Err(_) => rt.program(code, bindings, None).run(),
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
    code: &'a str,
    bindings: &serde_json::Map<String, Json>,
    run_id: Option<String>,
) -> Result<Box<Running<'a>>, Box<Outcome>> {
    let mut atoms = Strings::new();
    let program = match compiler::compile(code, &mut atoms) {
        Ok(p) => p,
        Err(e) => {
            let location = e.offset.map(|o| line_col(code, o));
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
    let mut vm = Vm::new(RunHost::new(setup, run_id), setup.limits, atoms);
    vm.setup();
    host::install(&mut vm);
    for (k, v) in bindings {
        let val = convert::from_json(&mut vm, v);
        let a = vm.atoms.intern(k);
        vm.global_map.insert(a, val);
    }
    vm.load(program);
    Ok(Box::new(Running::new(vm, code)))
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
    if let Err(e) = vm.call(&main, Value::Undef, &[])
        && vm.outcome.is_none()
    {
        vm.outcome = Some(Err(e));
    }
}

/// The outcome of a run that ended: host work it left running is interrupted, then the result is copied out.
pub fn finish(r: Running<'_>) -> Outcome {
    let Running { mut vm, code, .. } = r;
    vm.host.tasks.clear();
    let vm = &mut vm;
    let result = match (vm.fatal.clone(), vm.outcome.take()) {
        (Some((kind, message)), _) => Err(diagnostic(kind, message)),
        (None, Some(Ok(v))) => match convert::to_json(vm, &v) {
            Ok(j) => Ok(j),
            Err(e) => Err(diagnose(vm, &e, code)),
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
    let logs = std::mem::take(&mut vm.logs);
    let tool_calls = std::mem::take(&mut vm.tool_calls);
    bound_output(
        Outcome {
            result,
            warnings: Vec::new(),
            logs,
            truncated: false,
            tool_calls,
        },
        vm.limits.max_output_bytes,
    )
}

fn diagnostic(kind: DiagnosticKind, message: String) -> Diagnostic {
    Diagnostic {
        kind,
        message,
        location: None,
        suggestions: Vec::new(),
    }
}

fn diagnose(vm: &mut Vm, e: &Value, code: &str) -> Diagnostic {
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
