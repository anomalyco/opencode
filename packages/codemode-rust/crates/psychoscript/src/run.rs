//! One `execute`: compile, set up a fresh heap and built-ins, run to an outcome, and copy it out.

use std::panic::AssertUnwindSafe;
use std::rc::Rc;

use crate::compiler;
use crate::convert;
use crate::object::{Closure, Kind, Obj};
use crate::strings::Strings;
use crate::value::Value;
use crate::vm::Vm;
use crate::{Diagnostic, DiagnosticKind, Json, Outcome, Runtime};

/// Small programs run on the caller's thread with a modest native-stack budget. Larger ones, whose parse can
/// recurse deeper, run on their own thread with a large stack; the reservation is virtual, only touched pages are
/// committed.
const INLINE_SOURCE_BYTES: usize = 2048;
const INLINE_BRACKET_DEPTH: usize = 64;
const INLINE_STACK_BUDGET: usize = 512 << 10;
const STACK_SIZE: usize = 256 << 20;
const THREAD_STACK_BUDGET: usize = 64 << 20;

pub fn execute(rt: &Runtime, code: &str, bindings: &serde_json::Map<String, Json>) -> Outcome {
    if code.len() <= INLINE_SOURCE_BYTES && bracket_depth(code) <= INLINE_BRACKET_DEPTH {
        let run = AssertUnwindSafe(|| execute_here(rt, code, bindings, INLINE_STACK_BUDGET));
        return std::panic::catch_unwind(run).unwrap_or_else(|_| internal_error());
    }
    std::thread::scope(|s| {
        let spawned = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(s, || execute_here(rt, code, bindings, THREAD_STACK_BUDGET));
        match spawned {
            Ok(handle) => handle.join().unwrap_or_else(|_| internal_error()),
            Err(_) => execute_here(rt, code, bindings, INLINE_STACK_BUDGET),
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
    Outcome {
        result: Err(Diagnostic {
            kind: DiagnosticKind::ExecutionFailure,
            message: "Internal interpreter error.".into(),
            location: None,
        }),
        logs: Vec::new(),
        tool_calls: Vec::new(),
    }
}

fn execute_here(
    rt: &Runtime,
    code: &str,
    bindings: &serde_json::Map<String, Json>,
    budget: usize,
) -> Outcome {
    let probe = 0u8;
    let mut atoms = Strings::new();
    let program = match compiler::compile(code, &mut atoms) {
        Ok(p) => p,
        Err(e) => {
            let location = e.offset.map(|o| line_col(code, o));
            let message = format!("{}{}", e.message, suffix(location));
            return Outcome {
                result: Err(Diagnostic {
                    kind: e.kind,
                    message,
                    location,
                }),
                logs: Vec::new(),
                tool_calls: Vec::new(),
            };
        }
    };
    let mut vm = Vm::new(&rt.tools, rt.limits, atoms);
    vm.stack_base = &probe as *const u8 as usize;
    vm.stack_budget = budget;
    vm.setup();
    for (k, v) in bindings {
        let val = convert::from_json(&mut vm, v);
        let a = vm.atoms.intern(k);
        vm.global_map.insert(a, val);
    }
    vm.load(program);
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
    match vm.call(&main, Value::Undef, &[]) {
        Ok(_) => {
            let _ = vm.drive();
        }
        Err(e) => {
            if vm.outcome.is_none() {
                vm.outcome = Some(Err(e));
            }
        }
    }
    let result = match (vm.fatal.clone(), vm.outcome.take()) {
        (Some((kind, message)), _) => Err(Diagnostic {
            kind,
            message,
            location: None,
        }),
        (None, Some(Ok(v))) => match convert::to_json(&mut vm, &v) {
            Ok(j) => Ok(j),
            Err(e) => Err(diagnose(&mut vm, &e, code)),
        },
        (None, Some(Err(e))) => Err(diagnose(&mut vm, &e, code)),
        (None, None) => Err(Diagnostic {
            kind: DiagnosticKind::ExecutionFailure,
            message: "The program did not finish.".into(),
            location: None,
        }),
    };
    let result = match (vm.fatal.clone(), result) {
        (Some((kind, message)), Ok(_)) => Err(Diagnostic {
            kind,
            message,
            location: None,
        }),
        (_, r) => r,
    };
    let logs = std::mem::take(&mut vm.logs);
    let tool_calls = std::mem::take(&mut vm.tool_calls);
    bound_output(
        Outcome {
            result,
            logs,
            tool_calls,
        },
        rt.limits.max_output_bytes,
    )
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
            };
        }
        let message = convert::error_to_string(vm, id);
        return Diagnostic {
            kind: DiagnosticKind::ExecutionFailure,
            message,
            location: None,
        };
    }
    let text = convert::format_value(vm, e);
    Diagnostic {
        kind: DiagnosticKind::ExecutionFailure,
        message: format!("Uncaught: {text}"),
        location: None,
    }
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
    }
    outcome
}
