//! Host-facing behavior the conformance cases do not cover: limits, diagnostics and the data boundary.

use std::sync::{Arc, Mutex};

use psychoscript::{
    DiagnosticKind, HostFunction, HostString, HostValue, Json, Limits, ProgramOptions, Runtime,
    Translate, TranslateFunctions,
};
use serde_json::json;

fn run(rt: &Runtime, code: &str) -> psychoscript::Outcome {
    rt.execute(code)
}

/// A runtime whose `echo(value)` gives its argument back and keeps what it received; functions in arguments are
/// left out, as `JSON.stringify` does.
fn echo() -> (Runtime, Arc<Mutex<Vec<HostValue>>>) {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let kept = seen.clone();
    let rt = Runtime::make()
        .translate(Translate {
            functions: TranslateFunctions::Drop,
            ..Translate::default()
        })
        .globals(move |_| {
            let kept = kept.clone();
            [(
                "echo",
                HostFunction::new(move |args, _| {
                    let v = args.into_iter().next().unwrap_or_default();
                    kept.lock().unwrap().push(v.clone());
                    v
                }),
            )]
        });
    (rt, seen)
}

#[test]
fn timeout_interrupts_busy_loops() {
    let rt = Runtime::make().limits(Limits {
        timeout_ms: Some(50),
        ..Limits::default()
    });
    let outcome = run(&rt, "try { while (true) {} } catch (e) { return 'caught' }");
    assert_eq!(
        outcome.result.unwrap_err().kind,
        DiagnosticKind::TimeoutExceeded
    );
}

#[test]
fn output_limit_truncates_result_and_logs() {
    let rt = Runtime::make().limits(Limits {
        max_output_bytes: Some(40),
        ..Limits::default()
    });
    let outcome = run(
        &rt,
        "for (let i = 0; i < 10; i++) console.log('line ' + i); return 'x'.repeat(100)",
    );
    assert!(outcome.truncated);
    let value = outcome.result.unwrap();
    assert!(
        value
            .as_string()
            .and_then(|s| s.as_str())
            .unwrap()
            .contains("[result truncated: 102 bytes")
    );
    assert_eq!(
        outcome.logs,
        vec!["[logs truncated: showing 0 of 10 lines]"]
    );
}

#[test]
fn host_arguments_and_results_are_copies() {
    let (rt, seen) = echo();
    let outcome = run(
        &rt,
        "const o = { a: 1, f() {}, u: undefined, n: [NaN] }; const r = echo(o); r.a = 2; return [o.a, r, 'u' in r]",
    );
    assert_eq!(
        outcome.result.unwrap(),
        json!([1, { "a": 2, "n": [null] }, true])
    );
    let seen = seen.lock().unwrap()[0].clone();
    assert!(matches!(seen.get("u"), Some(HostValue::Undefined)));
    assert!(seen.get("f").is_none());
    assert!(
        matches!(seen.get("n"), Some(HostValue::Array(n)) if matches!(n[..], [Some(HostValue::Number(x))] if x.is_nan()))
    );
}

#[test]
fn unsupported_syntax_has_a_location() {
    let d = run(&Runtime::make(), "const a = 1\nconst B = class {}")
        .result
        .unwrap_err();
    assert_eq!(d.kind, DiagnosticKind::UnsupportedSyntax);
    assert_eq!(d.location, Some((2, 11)));
    // As the reference reports it: the node type, then the orientation it also suggests (the streaming recording
    // checks the message, not the suggestions).
    assert_eq!(d.suggestions.len(), 1);
    assert_eq!(
        d.message,
        format!(
            "SyntaxError: Syntax 'ClassExpression' is not supported. {} (line 2, col 11)",
            d.suggestions[0]
        )
    );
    // Rethrown, it keeps them.
    let again = run(
        &Runtime::make(),
        "let e; try { class A {} } catch (x) { e = x }\nthrow e",
    )
    .result
    .unwrap_err();
    assert_eq!(again.kind, DiagnosticKind::UnsupportedSyntax);
    assert_eq!(again.location, Some((1, 14)));
    assert_eq!(again.suggestions, d.suggestions);
}

#[test]
fn runtime_errors_report_their_location() {
    let d = run(&Runtime::make(), "const x = null\nreturn x.y")
        .result
        .unwrap_err();
    assert_eq!(d.kind, DiagnosticKind::ExecutionFailure);
    assert_eq!(d.location, Some((2, 8)));
    assert!(
        d.message
            .starts_with("TypeError: Cannot read properties of null (reading 'y')")
    );
}

#[test]
fn deep_input_does_not_overflow() {
    let rt = Runtime::make();
    let nested = format!("return {}1{}", "(".repeat(1_000), ")".repeat(1_000));
    assert!(run(&rt, &nested).result.is_ok());
    let chain = format!("return {}1", "1+".repeat(100_000));
    assert_eq!(
        run(&rt, &chain).result.unwrap_err().kind,
        DiagnosticKind::ParseError
    );
    let recursion = run(&rt, "const f = (n) => [n].map((x) => f(x + 1)); f(0)")
        .result
        .unwrap_err();
    assert!(
        recursion
            .message
            .contains("Maximum call stack size exceeded")
    );
}

#[test]
fn bindings_are_globals_programs_can_shadow() {
    let mut bindings = serde_json::Map::new();
    bindings.insert("n".into(), Json::from(4));
    let outcome = Runtime::make().execute_with(
        "const m = n * 2; { const n = 1; return [m, n] }",
        &ProgramOptions::new().bindings(bindings),
    );
    assert_eq!(outcome.result.unwrap(), json!([8, 1]));
}

#[test]
fn string_building_does_not_alias() {
    let code = "let s = ''; const parts = []; for (let i = 0; i < 3; i++) { s += i; parts.push(s) } return parts";
    assert_eq!(
        run(&Runtime::make(), code).result.unwrap(),
        json!(["0", "01", "012"])
    );
}

/// Rust text can't hold a lone surrogate, so where the reference hands the host and the outcome the surrogate
/// itself, these get U+FFFD; inside the program it stays a surrogate.
#[test]
fn lone_surrogates_reach_the_host_unchanged() {
    let (rt, seen) = echo();
    let outcome = run(
        &rt,
        r#"const h = "\ud83d"
        const back = echo({ [h]: h + "x" })
        return [Object.keys(back)[0] === h, back[h] === h + "x", back[h].length, (h + "\ude00").isWellFormed()]"#,
    );
    assert_eq!(outcome.result.unwrap(), json!([true, true, 2, true]));
    let seen = seen.lock().unwrap()[0].clone();
    let HostValue::Object(fields) = seen else {
        panic!("not an object");
    };
    assert_eq!(fields[0].0, HostString::from_utf16(&[0xd83d]));
    assert!(!fields[0].0.is_well_formed());
    assert_eq!(fields[0].0.to_string_lossy(), "\u{fffd}");
    assert!(
        matches!(&fields[0].1, HostValue::String(s) if s.to_utf16().as_ref() == [0xd83d, u16::from(b'x')])
    );
}

#[test]
fn host_text_keeps_the_last_code_point() {
    let rt = Runtime::make().globals(|_| {
        [(
            "max",
            HostFunction::new_async(|_, _| async { Ok(HostValue::from("a\u{10ffff}b")) }),
        )]
    });
    let outcome = run(
        &rt,
        r#"const s = await max()
        return [s, s.length, s.codePointAt(1), s.isWellFormed(), s === "a\u{10ffff}b", JSON.stringify(s).length]"#,
    );
    assert_eq!(
        outcome.result.unwrap(),
        json!(["a\u{10ffff}b", 4, 0x10ffff, true, true, 6])
    );
}

#[test]
fn uncaught_lone_surrogates_are_replaced_in_diagnostics() {
    let outcome = run(&Runtime::make(), r#"throw new TypeError("bad \udc00")"#);
    assert_eq!(
        outcome.result.unwrap_err().message,
        "TypeError: bad \u{fffd}"
    );
}

#[test]
fn sparse_arrays_visit_only_their_elements() {
    // The reference gives these results after walking all 30 million indexes, too slowly for a conformance case.
    let outcome = run(
        &Runtime::make(),
        r#"const a = []; a[30000000] = 2; a[1] = 1
        const b = []; b[30000000] = "z"; b[0] = "a"
        return [a.reduce((s, x) => s + x, 0), a.reduceRight((s, x, i) => s + "," + i, ""), a.some((x) => x === 2), a.every((x) => x > 0), [b].flat(), [0].flatMap(() => b)]"#,
    );
    assert_eq!(
        outcome.result.unwrap(),
        json!([3, ",30000000,1", true, true, ["a", "z"], ["a", "z"]])
    );
}
