//! The catalog, signatures, search and tool-call diagnostics against the reference, from
//! `conformance/catalog.json`, which `bun conformance/catalog.ts` generates from the reference.

use psychoscript::{Json, Runtime, Schema, Tool, search_signature, tool_expression};

fn fixture() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/catalog.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("catalog.json")).expect("JSON")
}

fn schema(spec: &Json, text: Option<&str>) -> Schema {
    // The schema as written, when its key order is what is being tested.
    let doc = text.map_or_else(
        || spec["schema"].clone(),
        |t| serde_json::from_str(t).unwrap(),
    );
    if spec["validated"] == Json::Bool(true) {
        Schema::validated(doc)
    } else {
        Schema::render_only(doc)
    }
}

fn runtime(fixture: &Json) -> Runtime {
    let results = serde_json::json!({
        "orders.lookup": { "id": "o1", "status": "open" },
        "orders.list": [{ "id": "o1", "total": 3 }],
        "util.now": null,
        "fetchPage": "page",
        "context7.resolve-library-id": "/lib",
    });
    let mut rt = Runtime::new();
    for spec in fixture["tools"].as_array().unwrap() {
        let path = spec["path"].as_str().unwrap();
        let result = results.get(path).cloned();
        let mut tool = Tool::new(spec["description"].as_str().unwrap(), move |input, _| {
            Ok(result.clone().unwrap_or(input))
        })
        .input(schema(&spec["input"], spec["inputText"].as_str()));
        if let Some(output) = spec.get("output") {
            tool = tool.output(schema(output, None));
        }
        if spec["freeform"] == Json::Bool(true) {
            tool = tool.freeform();
        }
        rt = rt.with_tool(path, tool);
    }
    for ns in fixture["namespaces"].as_array().unwrap() {
        rt = rt.namespace(
            ns["path"].as_str().unwrap(),
            ns["description"].as_str().unwrap(),
        );
    }
    rt
}

#[test]
fn catalog_signatures_match_the_reference() {
    let fixture = fixture();
    let rt = runtime(&fixture);
    let catalog: Vec<Json> = rt
        .catalog()
        .into_iter()
        .map(|t| serde_json::json!({ "path": t.path, "description": t.description, "signature": t.signature }))
        .collect();
    let expected = fixture["catalog"].as_array().unwrap();
    assert_eq!(catalog.len(), expected.len());
    for (actual, expected) in catalog.iter().zip(expected) {
        assert_eq!(
            actual, expected,
            "\n{}\n---\n{}",
            actual["signature"], expected["signature"]
        );
    }
}

#[test]
fn search_signature_and_tool_expressions_match_the_reference() {
    let fixture = fixture();
    assert_eq!(
        search_signature(),
        fixture["searchSignature"].as_str().unwrap()
    );
    for pair in fixture["expressions"].as_array().unwrap() {
        assert_eq!(
            tool_expression(pair[0].as_str().unwrap()),
            pair[1].as_str().unwrap()
        );
    }
}

#[test]
fn search_and_tool_call_diagnostics_match_the_reference() {
    let fixture = fixture();
    let rt = runtime(&fixture);
    let mut failures = Vec::new();
    for case in fixture["programs"].as_array().unwrap() {
        let code = case["code"].as_str().unwrap();
        let outcome = rt.execute(code, &serde_json::Map::new());
        let actual = match &outcome.result {
            Ok(value) => {
                let mut ok = serde_json::json!({ "ok": true, "value": value, "toolCalls": outcome.tool_calls.len() });
                if !outcome.warnings.is_empty() {
                    let warnings: Vec<Json> = outcome
                        .warnings
                        .iter()
                        .map(|w| {
                            let mut j =
                                serde_json::json!({ "kind": w.kind.name(), "message": w.message });
                            if let Some((line, column)) = w.location {
                                j["location"] =
                                    serde_json::json!({ "line": line, "column": column });
                            }
                            if !w.suggestions.is_empty() {
                                j["suggestions"] = w.suggestions.clone().into();
                            }
                            j
                        })
                        .collect();
                    ok["warnings"] = warnings.into();
                }
                ok
            }
            Err(d) => {
                let mut error = serde_json::json!({ "kind": d.kind.name(), "message": d.message });
                if !d.suggestions.is_empty() {
                    error["suggestions"] = d.suggestions.clone().into();
                }
                serde_json::json!({ "ok": false, "error": error, "toolCalls": outcome.tool_calls.len() })
            }
        };
        let mut expected = case.clone();
        expected.as_object_mut().unwrap().remove("code");
        if let Some(e) = expected.get_mut("error") {
            e.as_object_mut().unwrap().remove("location");
        }
        if !same(&actual, &expected) {
            failures.push(format!(
                "{code}\n  expected: {expected}\n  actual:   {actual}"
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

fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}
