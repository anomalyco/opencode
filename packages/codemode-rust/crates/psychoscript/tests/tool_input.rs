//! Tool calls with invalid input next to valid, denied and failing ones, against the reference's behaviour recorded in
//! `conformance/tools.json` by `bun conformance/tools.ts`: when each settles, its message, the hooks it runs,
//! `toolCalls`, and what counts against `max_tool_calls`.

use std::sync::{Arc, Mutex};

use psychoscript::{Hooks, Json, Limits, Runtime, Schema, Tool, ToolError};
use serde_json::json;

type Log = Arc<Mutex<Vec<Json>>>;

/// The runtime of `conformance/tools.ts`.
fn runtime(log: &Log, max_tool_calls: Option<u64>) -> Runtime {
    let (typed, echo, fail) = (log.clone(), log.clone(), log.clone());
    let (before, after) = (log.clone(), log.clone());
    Runtime::new()
        .with_tool(
            "t.typed",
            Tool::new("Takes an id", move |input, _| {
                typed
                    .lock()
                    .unwrap()
                    .push(json!(["run", "t.typed", input["id"]]));
                Ok(input["id"].clone())
            })
            .input(Schema::validated(json!({
                "type": "object",
                "properties": { "id": { "type": "number" } },
                "required": ["id"],
                "additionalProperties": false
            })))
            .output(Schema::validated(json!({ "type": "number" }))),
        )
        .with_tool(
            "t.echo",
            Tool::new("Echoes its input", move |input, _| {
                echo.lock().unwrap().push(json!(["run", "t.echo", input]));
                Ok(input)
            })
            .output(Schema::validated(json!({}))),
        )
        .with_tool(
            "t.fail",
            Tool::new("Always fails", move |_, _| {
                fail.lock().unwrap().push(json!(["run", "t.fail"]));
                Err("boom".into())
            })
            .input(Schema::validated(
                json!({ "type": "object", "properties": {}, "additionalProperties": false }),
            ))
            .output(Schema::validated(json!({ "type": "number" }))),
        )
        .hooks(
            Hooks::new()
                .tool_before(move |call| {
                    before
                        .lock()
                        .unwrap()
                        .push(json!(["before", call.name, call.input]));
                    match call.input.get("deny") {
                        Some(_) => Err(ToolError::new("denied")),
                        None => Ok(()),
                    }
                })
                .tool_after(move |call, result| {
                    after
                        .lock()
                        .unwrap()
                        .push(json!(["after", call.name, result.status()]));
                }),
        )
        .limits(Limits {
            max_tool_calls,
            ..Limits::default()
        })
}

#[test]
fn tool_calls_match_the_reference() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../conformance/tools.json");
    let fixture: Json = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut failures = Vec::new();
    for case in fixture["cases"].as_array().unwrap() {
        let log: Log = Arc::default();
        let code = case["code"].as_str().unwrap();
        let o = runtime(&log, case["maxToolCalls"].as_u64()).execute(code, &serde_json::Map::new());
        let outcome = match &o.result {
            Ok(value) => json!({ "ok": true, "value": value }),
            Err(d) => json!({ "ok": false, "kind": d.kind.name(), "message": d.message }),
        };
        let calls: Vec<&str> = o.tool_calls.iter().map(|c| c.path.as_str()).collect();
        let actual = json!({ "outcome": outcome, "toolCalls": calls, "log": *log.lock().unwrap() });
        let expected = json!({ "outcome": case["outcome"], "toolCalls": case["toolCalls"], "log": case["log"] });
        if actual != expected {
            failures.push(format!(
                "{code}\n  expected {expected}\n  actual   {actual}"
            ));
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}
