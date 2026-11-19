//! The test262 harness globals, for the parity runner in `test262/` only. Mirrors the reference
//! `packages/codemode/test/test262/run.ts`: `$assert` with its checks, `compareArray`, `Test262Error`, `$DONE` and
//! `$DONOTEVALUATE` are host functions; `assert` itself is program code the runner prepends.

use std::cell::RefCell;
use std::sync::Arc;

use crate::builtins::arg;
use crate::object::{Closure, Kind, Obj};
use crate::strings::Strings;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Res, Vm};
use crate::{Diagnostic, DiagnosticKind, Limits, compiler, convert};

const STACK_SIZE: usize = 256 << 20;
const STACK_BUDGET: usize = 64 << 20;

/// How a test262 program ended.
pub struct Run {
    pub result: Result<(), Diagnostic>,
    /// `None` when `$DONE` was never called, `Some(None)` when it was called without an error, and
    /// `Some(Some(error))` when it was called with one.
    pub done: Option<Option<String>>,
}

thread_local! {
    static DONE: RefCell<Option<Option<String>>> = const { RefCell::new(None) };
}

/// Runs an already assembled test262 source with the harness globals, on its own large-stack thread.
pub fn run(code: &str, timeout_ms: u64) -> Run {
    std::thread::scope(|s| {
        let spawned = std::thread::Builder::new()
            .stack_size(STACK_SIZE)
            .spawn_scoped(s, || run_here(code, timeout_ms));
        match spawned.map(|h| h.join()) {
            Ok(Ok(run)) => run,
            _ => Run {
                result: Err(diagnostic(
                    DiagnosticKind::ExecutionFailure,
                    "Internal interpreter error.".into(),
                )),
                done: None,
            },
        }
    })
}

fn diagnostic(kind: DiagnosticKind, message: String) -> Diagnostic {
    Diagnostic {
        kind,
        message: crate::HostString::from_run_text(&message),
        location: None,
        suggestions: Vec::new(),
    }
}

fn run_here(code: &str, timeout_ms: u64) -> Run {
    let probe = 0u8;
    DONE.with(|d| *d.borrow_mut() = None);
    let mut atoms = Strings::new();
    let program = match compiler::compile(code, &mut atoms) {
        Ok(p) => p,
        Err(e) => {
            return Run {
                result: Err(diagnostic(e.kind, e.message)),
                done: None,
            };
        }
    };
    let limits = Limits {
        timeout_ms: Some(timeout_ms),
        ..Limits::default()
    };
    let mut vm = Vm::new(crate::host::RunHost::bare(), limits, atoms);
    vm.stack_base = &probe as *const u8 as usize;
    vm.stack_budget = STACK_BUDGET;
    vm.setup();
    harness(&mut vm);
    vm.load(program);
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
        (Some((kind, message)), _) => Err(diagnostic(kind, message)),
        (None, Some(Ok(v))) => match convert::to_json(&mut vm, &v) {
            Ok(_) => Ok(()),
            Err(e) => Err(failure(&mut vm, &e)),
        },
        (None, Some(Err(e))) => Err(failure(&mut vm, &e)),
        (None, None) => Err(diagnostic(
            DiagnosticKind::ExecutionFailure,
            "The program did not finish.".into(),
        )),
    };
    Run {
        result,
        done: DONE.with(|d| d.borrow_mut().take()),
    }
}

fn failure(vm: &mut Vm, e: &Value) -> Diagnostic {
    if let Value::Obj(id) = e
        && let Kind::Error(failure) = &vm.heap[*id as usize].kind
    {
        let id = *id;
        let kind = failure
            .as_ref()
            .map_or(DiagnosticKind::ExecutionFailure, |f| f.kind.clone());
        return diagnostic(kind, convert::error_to_string(vm, id));
    }
    let text = show(vm, e);
    diagnostic(
        DiagnosticKind::ExecutionFailure,
        format!("Uncaught: {text}"),
    )
}

fn global(vm: &mut Vm, name: &'static str, v: Value) {
    let a = vm.atoms.intern_static(name);
    vm.global_map.insert(a, v);
}

fn harness(vm: &mut Vm) {
    let object_proto = vm.realm.object_proto;
    let proto = vm.alloc(Obj::new(Some(object_proto), Kind::Ordinary));
    let (nk, pk, ck) = (vm.names.name, vm.names.prototype, vm.names.constructor);
    let name = vm.static_str("Test262Error");
    vm.define_hidden(proto, nk, name);
    let name_atom = vm.atoms.intern_static("Test262Error");
    let fp = vm.realm.function_proto;
    let ctor = vm.alloc(Obj::new(
        Some(fp),
        Kind::Native {
            f: test262_error,
            data: Value::Obj(proto),
            name: name_atom,
            length: 1,
            ctor: true,
        },
    ));
    vm.heap[ctor as usize]
        .props
        .insert(pk, Value::Obj(proto), 0);
    vm.define_hidden(proto, ck, Value::Obj(ctor));
    let thrower = vm.native_fn("thrower", 1, test262_thrower, Value::Obj(proto));
    let key = vm.atoms.intern_static("thrower");
    vm.define_hidden(ctor, key, thrower);
    global(vm, "Test262Error", Value::Obj(ctor));

    let compare = vm.native_fn("compareArray", 2, compare_array, Value::Obj(proto));
    if let Value::Obj(id) = compare {
        vm.method(id, "format", 1, compare_format);
    }
    global(vm, "compareArray", compare);

    let assert = vm.native_fn("$assert", 2, assert_true, Value::Obj(proto));
    if let Value::Obj(id) = assert {
        let checks: [(&'static str, u8, NativeFn); 5] = [
            ("sameValue", 3, assert_same_value),
            ("notSameValue", 3, assert_not_same_value),
            ("compareArray", 3, assert_compare_array),
            ("notThrown", 2, assert_not_thrown),
            ("thrown", 3, assert_thrown),
        ];
        for (name, length, f) in checks {
            let m = vm.native_fn(name, length, f, Value::Obj(proto));
            let key = vm.atoms.intern_static(name);
            vm.define_hidden(id, key, m);
        }
    }
    global(vm, "$assert", assert);

    let done = vm.native_fn("$DONE", 1, done, Value::Undef);
    global(vm, "$DONE", done);
    let not_evaluate = vm.native_fn("$DONOTEVALUATE", 0, do_not_evaluate, Value::Undef);
    global(vm, "$DONOTEVALUATE", not_evaluate);
}

/// The `Test262Error` prototype, which every harness function carries as its data.
fn error_proto(vm: &Vm, callee: Id) -> Id {
    vm.native_data(callee)
        .as_obj()
        .unwrap_or(vm.realm.object_proto)
}

fn fail(vm: &mut Vm, callee: Id, message: &str) -> Res {
    let proto = error_proto(vm, callee);
    Err(vm.make_error(proto, message))
}

fn test262_error(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let message = match arg(args, 0) {
        Value::Undef => String::new(),
        v => {
            let s = vm.string_of(&v)?;
            vm.text(s).to_owned()
        }
    };
    let proto = error_proto(vm, callee);
    Ok(vm.make_error(proto, &message))
}

fn test262_thrower(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let s = vm.string_of(&arg(args, 0))?;
    let message = vm.text(s).to_owned();
    fail(vm, callee, &message)
}

fn same_value(vm: &Vm, a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => {
            (x.is_nan() && y.is_nan()) || (x == y && x.is_sign_negative() == y.is_sign_negative())
        }
        _ => vm.strict_eq(a, b),
    }
}

fn arrays_equal(vm: &Vm, a: &Value, b: &Value) -> bool {
    let (Value::Obj(a), Value::Obj(b)) = (a, b) else {
        return false;
    };
    match (&vm.heap[*a as usize].kind, &vm.heap[*b as usize].kind) {
        // Like the reference's host `every`: holes in the actual array are not compared, and a hole in the
        // expected one reads as undefined.
        (Kind::Array(x), Kind::Array(y)) => {
            x.len() == y.len()
                && x.iter().zip(y).all(|(x, y)| {
                    matches!(x, Value::Uninit)
                        || same_value(
                            vm,
                            x,
                            if let Value::Uninit = y {
                                &Value::Undef
                            } else {
                                y
                            },
                        )
                })
        }
        _ => false,
    }
}

fn prefix(vm: &mut Vm, message: &Value) -> Result<String, Value> {
    if let Value::Undef = message {
        return Ok(String::new());
    }
    let s = vm.string_of(message)?;
    Ok(format!("{} ", vm.text(s)))
}

fn compare_array(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(arrays_equal(vm, &arg(args, 0), &arg(args, 1))))
}

fn compare_format(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let text = show(vm, &arg(args, 0));
    Ok(vm.string_val(text))
}

fn assert_true(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let value = arg(args, 0);
    if let Value::Bool(true) = value {
        return Ok(Value::Undef);
    }
    let message = match arg(args, 1) {
        Value::Undef => format!("Expected true but got {}", show(vm, &value)),
        m => {
            let s = vm.string_of(&m)?;
            vm.text(s).to_owned()
        }
    };
    fail(vm, callee, &message)
}

fn assert_same_value(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let (a, b) = (arg(args, 0), arg(args, 1));
    if same_value(vm, &a, &b) {
        return Ok(Value::Undef);
    }
    let p = prefix(vm, &arg(args, 2))?;
    let message = format!(
        "{p}Expected SameValue(«{}», «{}») to be true",
        show(vm, &a),
        show(vm, &b)
    );
    fail(vm, callee, &message)
}

fn assert_not_same_value(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let (a, b) = (arg(args, 0), arg(args, 1));
    if !same_value(vm, &a, &b) {
        return Ok(Value::Undef);
    }
    let p = prefix(vm, &arg(args, 2))?;
    let message = format!(
        "{p}Expected SameValue(«{}», «{}») to be false",
        show(vm, &a),
        show(vm, &b)
    );
    fail(vm, callee, &message)
}

fn assert_compare_array(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let (a, b) = (arg(args, 0), arg(args, 1));
    if arrays_equal(vm, &a, &b) {
        return Ok(Value::Undef);
    }
    let p = prefix(vm, &arg(args, 2))?;
    let message = format!(
        "Actual {} and expected {} should have the same contents. {p}",
        show(vm, &a),
        show(vm, &b)
    );
    fail(vm, callee, &message)
}

fn expected_name(vm: &mut Vm, ctor: &Value) -> String {
    if vm.is_callable(ctor) {
        let nk = vm.names.name;
        if let Ok(name) = vm.get(ctor, nk) {
            return match name {
                Value::Str(s) => vm.text(s).to_owned(),
                other => show(vm, &other),
            };
        }
    }
    show(vm, ctor)
}

fn assert_not_thrown(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let p = prefix(vm, &arg(args, 1))?;
    let name = expected_name(vm, &arg(args, 0));
    let message = format!("{p}Expected a {name} to be thrown but no exception was thrown at all");
    fail(vm, callee, &message)
}

fn assert_thrown(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let (expected, thrown) = (arg(args, 0), arg(args, 2));
    let p = prefix(vm, &arg(args, 1))?;
    if !matches!(thrown, Value::Obj(_)) {
        return fail(vm, callee, &format!("{p}Thrown value was not an object!"));
    }
    let ck = vm.names.constructor;
    let actual = vm.get(&thrown, ck)?;
    if vm.strict_eq(&actual, &expected) {
        return Ok(Value::Undef);
    }
    let name = expected_name(vm, &expected);
    // The thrown error's own message is not in the reference's text; it only names the cause in reports.
    let message = format!(
        "{p}Expected a {name} but got a {} ({})",
        show(vm, &actual),
        vm.error_text(&thrown)
    );
    fail(vm, callee, &message)
}

fn done(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let error = match arg(args, 0) {
        Value::Undef => None,
        e => Some(show(vm, &e)),
    };
    DONE.with(|d| {
        d.borrow_mut().get_or_insert(error);
    });
    Ok(Value::Undef)
}

fn do_not_evaluate(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    Err(vm.static_str("Test262: This statement should not be evaluated."))
}

/// A value as the reference harness shows it in failure messages.
fn show(vm: &mut Vm, v: &Value) -> String {
    match v {
        Value::Str(s) => {
            let mut out = String::new();
            convert::quote(&mut out, vm.text(*s));
            out
        }
        Value::Num(n) if *n == 0.0 && n.is_sign_negative() => "-0".into(),
        Value::Obj(id) => {
            let id = *id;
            match &vm.heap[id as usize].kind {
                Kind::Array(items) => {
                    let items = items.clone();
                    let parts: Vec<String> = items
                        .iter()
                        .map(|item| match item {
                            Value::Uninit => String::new(),
                            item => show(vm, item),
                        })
                        .collect();
                    format!("[{}]", parts.join(", "))
                }
                Kind::Closure(_) => "program function".into(),
                _ if vm.heap[id as usize].is_callable() => {
                    let nk = vm.names.name;
                    let name = vm.get_obj(id, nk);
                    vm.string_of(&name)
                        .map(|s| vm.text(s).to_owned())
                        .unwrap_or_default()
                }
                _ => {
                    let (nk, mk) = (vm.names.name, vm.names.message);
                    match vm.get_obj(id, mk) {
                        Value::Str(m) => {
                            let message = vm.text(m).to_owned();
                            let name = match vm.get_obj(id, nk) {
                                Value::Undef => "object".to_owned(),
                                n => vm
                                    .string_of(&n)
                                    .map(|s| vm.text(s).to_owned())
                                    .unwrap_or_default(),
                            };
                            format!("{name}: {message}")
                        }
                        _ => "object".into(),
                    }
                }
            }
        }
        _ => convert::format_value(vm, v),
    }
}
