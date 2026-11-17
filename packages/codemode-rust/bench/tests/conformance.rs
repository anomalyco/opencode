//! Runs every `conformance/cases/<name>.js` through `psychoscript::Runtime` and compares it with the reference outcome
//! in `<name>.json`. Reports every failing case at once. `CONFORMANCE_FILTER=<substring>` narrows the run.

use std::panic::{self, AssertUnwindSafe};
use std::path::Path;

use psychoscript::{DiagnosticKind, Json, Limits, Runtime};

fn runtime(limits: Limits) -> Runtime {
    Runtime::new()
        .tool("echo", |input| {
            Ok(input.get("id").cloned().unwrap_or(Json::Null))
        })
        .tool("fail", |_| Err("boom".to_owned()))
        .tool("git.status", |_| {
            Ok(serde_json::json!({ "branch": "main", "dirty": true }))
        })
        .limits(limits)
}

fn kind_name(kind: DiagnosticKind) -> &'static str {
    match kind {
        DiagnosticKind::ParseError => "ParseError",
        DiagnosticKind::UnsupportedSyntax => "UnsupportedSyntax",
        DiagnosticKind::UnknownTool => "UnknownTool",
        DiagnosticKind::InvalidDataValue => "InvalidDataValue",
        DiagnosticKind::ToolCallLimitExceeded => "ToolCallLimitExceeded",
        DiagnosticKind::TimeoutExceeded => "TimeoutExceeded",
        DiagnosticKind::ToolFailure => "ToolFailure",
        DiagnosticKind::ExecutionFailure => "ExecutionFailure",
    }
}

/// JSON equality where numbers compare by value, so `3` equals `3.0`.
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((kx, vx), (ky, vy))| kx == ky && same(vx, vy))
        }
        _ => a == b,
    }
}

fn check(name: &str, code: &str, expected: &Json) -> Result<(), String> {
    let bindings = expected["bindings"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let limits = Limits {
        max_tool_calls: expected["limits"]["max_tool_calls"].as_u64(),
        timeout_ms: expected["limits"]["timeout_ms"].as_u64(),
        max_output_bytes: None,
    };
    let rt = runtime(limits);
    let outcome = panic::catch_unwind(AssertUnwindSafe(|| rt.execute(code, &bindings))).map_err(
        |payload| {
            let msg = payload
                .downcast_ref::<String>()
                .cloned()
                .or_else(|| payload.downcast_ref::<&str>().map(|s| (*s).to_owned()))
                .unwrap_or_default();
            format!("{name}: panicked: {msg}")
        },
    )?;

    let mut problems = Vec::new();
    match (&outcome.result, expected["ok"].as_bool()) {
        (Ok(value), Some(true)) => {
            if !same(value, &expected["value"]) {
                problems.push(format!(
                    "value\n    expected: {}\n    actual:   {value}",
                    expected["value"]
                ));
            }
        }
        (Err(d), Some(false)) => {
            if kind_name(d.kind) != expected["kind"] {
                problems.push(format!(
                    "kind: expected {}, got {} ({})",
                    expected["kind"],
                    kind_name(d.kind),
                    d.message
                ));
            }
        }
        (Ok(value), _) => problems.push(format!(
            "expected {} error, got ok: {value}",
            expected["kind"]
        )),
        (Err(d), _) => problems.push(format!(
            "expected ok {}, got {}: {}",
            expected["value"],
            kind_name(d.kind),
            d.message
        )),
    }
    if let Some(logs) = expected.get("logs") {
        let actual = Json::from(outcome.logs.clone());
        if !same(&actual, logs) {
            problems.push(format!(
                "logs\n    expected: {logs}\n    actual:   {actual}"
            ));
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(format!("{name}: {}", problems.join("\n  ")))
    }
}

#[test]
fn conformance() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../conformance/cases");
    let filter = std::env::var("CONFORMANCE_FILTER").unwrap_or_default();
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .expect("conformance/cases")
        .filter_map(|e| {
            e.ok()?
                .file_name()
                .into_string()
                .ok()?
                .strip_suffix(".js")
                .map(str::to_owned)
        })
        .filter(|n| n.contains(&filter))
        .collect();
    names.sort();
    assert!(!names.is_empty(), "no conformance cases matched");

    let hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let failures: Vec<String> = names
        .iter()
        .filter_map(|name| {
            let code = std::fs::read_to_string(dir.join(format!("{name}.js"))).unwrap();
            let expected: Json = serde_json::from_str(
                &std::fs::read_to_string(dir.join(format!("{name}.json"))).unwrap(),
            )
            .unwrap();
            check(name, &code, &expected).err()
        })
        .collect();
    panic::set_hook(hook);

    if !failures.is_empty() {
        panic!(
            "{} of {} conformance cases failed:\n{}",
            failures.len(),
            names.len(),
            failures.join("\n")
        );
    }
    println!("{} conformance cases passed", names.len());
}
