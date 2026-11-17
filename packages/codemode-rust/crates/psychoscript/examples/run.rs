//! Runs a program file and prints its outcome: `cargo run --example run -- program.js`.

use psychoscript::{Json, Limits, Runtime};

fn main() {
    let path = std::env::args().nth(1).expect("usage: run <program.js>");
    let code = std::fs::read_to_string(&path).expect("readable program");
    let runtime = Runtime::new()
        .tool("echo", |input| {
            Ok(input.get("id").cloned().unwrap_or(Json::Null))
        })
        .tool("fail", |_| Err("boom".to_owned()))
        .tool("git.status", |_| {
            Ok(serde_json::json!({ "branch": "main", "dirty": true }))
        })
        .limits(Limits {
            timeout_ms: Some(2000),
            max_tool_calls: None,
            max_output_bytes: None,
        });
    let outcome = runtime.execute(&code, &serde_json::Map::new());
    for line in &outcome.logs {
        println!("log: {line}");
    }
    match outcome.result {
        Ok(v) => println!("ok: {v}"),
        Err(d) => println!("error: {:?}: {} {:?}", d.kind, d.message, d.location),
    }
}
