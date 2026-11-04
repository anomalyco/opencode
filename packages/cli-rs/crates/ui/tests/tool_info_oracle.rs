//! P-ORACLE for U.5: decodes the tool parts of `parity/oracle/U.5-tool-info.ts` as the generated API type, runs
//! them through the Rust port, and compares with the TypeScript output in `parity/fixtures/U.5/tool-info.json`.
//! Regenerate it with `bun run fixtures`.

use opencode_api::generated::types::SessionMessageAssistantTool;
use opencode_ui::tool_info::{
    ToolInline, execute_call_summary, execute_calls, primitive_input_summary, read_display_text,
    tool_inline_info, tool_output_text, tool_path, web_search_provider_label,
};
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("../../../parity/fixtures/U.5/tool-info.json");

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).unwrap()
}

/// The TS `ToolInline` as `JSON.stringify` writes it: undefined fields are left out.
fn encode(info: &ToolInline) -> Value {
    let mut value = json!({ "icon": info.icon, "title": info.title });
    if let Some(description) = &info.description {
        value["description"] = json!(description);
    }
    if info.block {
        value["mode"] = json!("block");
    }
    if let Some(body) = &info.body {
        value["body"] = json!(body);
    }
    value
}

fn str_of(value: &Value) -> &str {
    value.as_str().unwrap()
}

#[test]
fn tool_inline_info_matches_typescript() {
    let fixture = fixture();
    let parts = fixture["parts"].as_array().unwrap();
    assert!(parts.len() >= 60);
    compare(parts);
}

/// Opt-in: `OPENCODE_TOOL_PARTS=<file>` compares parts recorded the same way from real sessions.
#[test]
fn recorded_tool_parts_match_typescript() {
    let Some(path) = std::env::var_os("OPENCODE_TOOL_PARTS") else {
        return;
    };
    let recorded: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let parts = recorded["parts"].as_array().unwrap();
    compare(parts);
    println!("{} recorded tool parts match", parts.len());
}

fn compare(parts: &[Value]) {
    let failures: Vec<_> = parts
        .iter()
        .filter_map(|case| {
            let part: SessionMessageAssistantTool =
                serde_json::from_value(case["part"].clone()).unwrap();
            let actual = encode(&tool_inline_info(&part, case["directory"].as_str()));
            (actual != case["expected"]).then(|| {
                format!(
                    "{}:\n  ts   {}\n  rust {actual}",
                    case["label"], case["expected"]
                )
            })
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} of {} differ:\n{}",
        failures.len(),
        parts.len(),
        failures.join("\n")
    );
}

#[test]
fn tool_display_helpers_match_typescript() {
    let fixture = fixture();
    let helpers = &fixture["helpers"];
    let cases = |name: &str| helpers[name].as_array().unwrap().clone();

    for case in cases("toolOutputText") {
        let actual = tool_output_text(str_of(&case["name"]), case["content"].as_array().unwrap());
        assert_eq!(
            actual,
            str_of(&case["expected"]),
            "toolOutputText {}",
            case["content"]
        );
    }
    for case in cases("readDisplayText") {
        let actual = read_display_text(str_of(&case["input"]));
        assert_eq!(
            actual.as_deref(),
            case["expected"].as_str(),
            "readDisplayText {}",
            case["input"]
        );
    }
    for case in cases("toolPath") {
        let actual = tool_path(
            str_of(&case["input"]),
            case["directory"].as_str(),
            case["home"].as_str(),
        );
        assert_eq!(
            actual,
            str_of(&case["expected"]),
            "toolPath {}",
            case["input"]
        );
    }
    for case in cases("primitiveInputSummary") {
        let omit: Vec<_> = case["omit"]
            .as_array()
            .unwrap()
            .iter()
            .map(str_of)
            .collect();
        let actual = primitive_input_summary(case["input"].as_object().unwrap(), &omit);
        assert_eq!(
            actual,
            str_of(&case["expected"]),
            "primitiveInputSummary {}",
            case["input"]
        );
    }
    for case in cases("executeCalls") {
        let actual: Vec<_> = execute_calls(&case["input"])
            .iter()
            .map(execute_call_summary)
            .collect();
        let expected: Vec<_> = case["expected"]
            .as_array()
            .unwrap()
            .iter()
            .map(str_of)
            .collect();
        assert_eq!(actual, expected, "executeCalls {}", case["input"]);
    }
    for case in cases("webSearchProviderLabel") {
        let actual = web_search_provider_label(&case["provider"]);
        assert_eq!(
            actual,
            str_of(&case["expected"]),
            "webSearchProviderLabel {}",
            case["provider"]
        );
    }
}
