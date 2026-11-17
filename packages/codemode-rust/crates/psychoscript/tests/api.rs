//! Host-facing behavior the conformance cases do not cover: limits, diagnostics and the data boundary.

use psychoscript::{DiagnosticKind, Json, Limits, Runtime};
use serde_json::json;

fn run(rt: &Runtime, code: &str) -> psychoscript::Outcome {
    rt.execute(code, &serde_json::Map::new())
}

fn echo() -> Runtime {
    Runtime::new().tool("echo", |input| Ok(input.clone()))
}

#[test]
fn timeout_interrupts_busy_loops() {
    let rt = Runtime::new().limits(Limits {
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
fn tool_call_limit_counts_admitted_calls() {
    let rt = echo().limits(Limits {
        max_tool_calls: Some(2),
        ..Limits::default()
    });
    let outcome = run(&rt, "for (let i = 0; i < 5; i++) await tools.echo({ i })");
    assert_eq!(
        outcome.result.unwrap_err().kind,
        DiagnosticKind::ToolCallLimitExceeded
    );
    assert_eq!(outcome.tool_calls.len(), 2);
}

#[test]
fn output_limit_truncates_result_and_logs() {
    let rt = Runtime::new().limits(Limits {
        max_output_bytes: Some(40),
        ..Limits::default()
    });
    let outcome = run(
        &rt,
        "for (let i = 0; i < 10; i++) console.log('line ' + i); return 'x'.repeat(100)",
    );
    let value = outcome.result.unwrap();
    assert!(
        value
            .as_str()
            .unwrap()
            .contains("[result truncated: 102 bytes")
    );
    assert_eq!(
        outcome.logs,
        vec!["[logs truncated: showing 0 of 10 lines]"]
    );
}

#[test]
fn tool_input_is_a_json_copy() {
    let outcome = run(
        &echo(),
        "const o = { a: 1, f() {}, u: undefined, n: [NaN] }; const r = await tools.echo(o); r.a = 2; return [o.a, r]",
    );
    assert_eq!(outcome.result.unwrap(), json!([1, { "a": 2, "n": [null] }]));
    assert_eq!(outcome.tool_calls[0].input, json!({ "a": 1, "n": [null] }));
}

#[test]
fn unsupported_syntax_has_a_location() {
    let d = run(
        &Runtime::new(),
        "const a = 1\nconst o = { get x() { return a } }",
    )
    .result
    .unwrap_err();
    assert_eq!(d.kind, DiagnosticKind::UnsupportedSyntax);
    assert_eq!(d.location, Some((2, 13)));
}

#[test]
fn runtime_errors_report_their_location() {
    let d = run(&Runtime::new(), "const x = null\nreturn x.y")
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
    let rt = Runtime::new();
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
    let outcome =
        Runtime::new().execute("const m = n * 2; { const n = 1; return [m, n] }", &bindings);
    assert_eq!(outcome.result.unwrap(), json!([8, 1]));
}

#[test]
fn string_building_does_not_alias() {
    let code = "let s = ''; const parts = []; for (let i = 0; i < 3; i++) { s += i; parts.push(s) } return parts";
    assert_eq!(
        run(&Runtime::new(), code).result.unwrap(),
        json!(["0", "01", "012"])
    );
}
