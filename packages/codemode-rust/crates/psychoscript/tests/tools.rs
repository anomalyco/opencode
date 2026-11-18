//! Tools, schemas, paths and search, mirroring the reference's `codemode.test.ts` and `tool-paths.test.ts`.

use std::sync::{Arc, Mutex};

use psychoscript::{DiagnosticKind, Json, Limits, Outcome, Runtime, Schema, Tool, ToolError};
use serde_json::json;

fn run(rt: &Runtime, code: &str) -> Outcome {
    rt.execute(code, &serde_json::Map::new())
}

fn value(rt: &Runtime, code: &str) -> Json {
    match run(rt, code).result {
        Ok(v) => v,
        Err(d) => panic!("expected success, got {:?}: {}", d.kind, d.message),
    }
}

fn failure(rt: &Runtime, code: &str) -> psychoscript::Diagnostic {
    match run(rt, code).result {
        Ok(v) => panic!("expected failure, got {v}"),
        Err(d) => d,
    }
}

fn empty() -> Schema {
    Schema::validated(json!({ "type": "object", "properties": {}, "additionalProperties": false }))
}

fn echo(description: &str, result: &str) -> Tool {
    let result = result.to_owned();
    Tool::new(description, move |_, _| Ok(Json::String(result.clone())))
        .input(empty())
        .output(Schema::validated(json!({ "type": "string" })))
}

fn struct_of(fields: Json, required: &[&str]) -> Schema {
    Schema::validated(json!({
        "type": "object",
        "properties": fields,
        "required": required,
        "additionalProperties": false
    }))
}

#[test]
fn explicit_tool_failures_are_preserved() {
    let rt = Runtime::new().with_tool(
        "host.call",
        Tool::new("Fail", |_, _| {
            Err(ToolError::new("Authorized request was refused"))
        })
        .input(empty()),
    );
    let d = failure(&rt, "return await tools.host.call({})");
    assert_eq!(d.kind, DiagnosticKind::ToolFailure);
    assert_eq!(d.message, "Authorized request was refused");
}

#[test]
fn invalid_output_is_reported_with_the_schema_error() {
    let rt = Runtime::new().with_tool(
        "host.call",
        Tool::new("Return invalid output", |_, _| Ok(json!({ "value": 1 })))
            .input(empty())
            .output(struct_of(
                json!({ "value": { "type": "string" } }),
                &["value"],
            )),
    );
    let d = failure(&rt, "return await tools.host.call({})");
    assert_eq!(d.kind, DiagnosticKind::InvalidToolOutput);
    assert_eq!(
        d.message,
        "Invalid output from tool 'host.call': SchemaError(Expected string\n  at [\"value\"])"
    );
}

#[test]
fn caught_tool_failures_are_error_values() {
    let rt = Runtime::new().with_tool(
        "host.call",
        Tool::new("Refuse", |_, _| Err("Refused".into())).input(empty()),
    );
    assert_eq!(
        value(
            &rt,
            r#"try { await tools.host.call({}); return "no" } catch (e) { return { isError: e instanceof Error, message: e.message } }"#
        ),
        json!({ "isError": true, "message": "Refused" })
    );
}

#[test]
fn render_only_input_passes_through_and_omitted_output_is_void() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = observed.clone();
    let call = Tool::new("Call an adapter-described tool", move |input, _| {
        seen.lock().unwrap().push(input.clone());
        Ok(json!({ "echoed": input }))
    })
    .input(Schema::render_only(json!({
        "type": "object",
        "properties": { "id": { "type": "string" }, "count": { "type": "number" } },
        "required": ["id"]
    })));
    let rt = Runtime::new().with_tool("adapter.call", call);
    assert_eq!(
        rt.catalog()[0].signature,
        "tools.adapter.call({\n  id: string,\n  count?: number,\n}): Promise<void>"
    );
    assert_eq!(
        value(&rt, "return await tools.adapter.call({ id: 42 })"),
        Json::Null
    );
    assert_eq!(*observed.lock().unwrap(), vec![json!({ "id": 42 })]);
}

#[test]
fn arguments_follow_json_serialization_and_drop_undefined() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = observed.clone();
    let rt = Runtime::new().with_tool(
        "things.find",
        Tool::new("Find things", move |input, _| {
            seen.lock().unwrap().push(input);
            Ok(json!("ok"))
        })
        .input(Schema::validated(json!({
            "type": "object",
            "properties": { "query": { "type": "string" }, "limit": { "type": "number" } },
            "additionalProperties": false
        }))),
    );
    value(
        &rt,
        "return await tools.things.find({ query: undefined, limit: 5 })",
    );
    // NaN crosses as `null`, which a number field refuses, as Effect's `Schema.Number` does.
    let d = failure(&rt, "return await tools.things.find({ limit: 0 / 0 })");
    assert_eq!(d.kind, DiagnosticKind::InvalidToolInput);
    assert_eq!(*observed.lock().unwrap(), vec![json!({ "limit": 5 })]);
}

#[test]
fn tool_arguments_leave_functions_out_and_await_promises_as_json_did() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = observed.clone();
    let rt = Runtime::new().with_tool(
        "shop.show",
        Tool::new("Show raw input", move |input, _| {
            seen.lock().unwrap().push(input);
            Ok(json!("ok"))
        })
        .input(Schema::validated(json!({ "type": "object" }))),
    );
    for code in [
        r#"await tools.shop.show({ q: "x", format(v) { return v } })"#,
        "await tools.shop.show({ n: Promise.resolve(5) })",
        // A toJSON method is a function too: left out, not run.
        r#"await tools.shop.show({ item: "book", price: { cents: 1999, toJSON() { return "$19.99" } } })"#,
        "await tools.shop.show({ later: (async () => { await null; return [1, () => 2] })() })",
    ] {
        assert!(run(&rt, code).result.is_ok(), "{code}");
    }
    assert_eq!(
        *observed.lock().unwrap(),
        vec![
            json!({ "q": "x" }),
            json!({ "n": 5 }),
            json!({ "item": "book", "price": { "cents": 1999 } }),
            json!({ "later": [1, null] }),
        ]
    );
    let d = failure(
        &rt,
        r#"await tools.shop.show({ n: Promise.reject(new Error("no price")) })"#,
    );
    assert!(d.message.contains("no price"), "{}", d.message);
    assert_eq!(observed.lock().unwrap().len(), 4);
}

#[test]
fn validated_input_drops_excess_properties_before_the_tool_sees_it() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = observed.clone();
    let rt = Runtime::new().with_tool(
        "echo",
        Tool::new("Echo", move |input, _| {
            seen.lock().unwrap().push(input.clone());
            Ok(input)
        })
        .output(Schema::render_only(json!({})))
        .input(struct_of(
            json!({ "text": { "type": "string" } }),
            &["text"],
        )),
    );
    assert_eq!(
        value(&rt, r#"return await tools.echo({ text: "a", extra: 1 })"#),
        json!({ "text": "a" })
    );
    let d = failure(&rt, r#"return await tools.echo({ message: "hello" })"#);
    assert_eq!(d.kind, DiagnosticKind::InvalidToolInput);
    assert_eq!(
        d.suggestions,
        ["The signature may have changed. Use search to get the current signature."]
    );
    let d = failure(&rt, "return await tools.echo({}, {})");
    assert_eq!(d.kind, DiagnosticKind::InvalidToolInput);
    assert!(d.suggestions.is_empty());
    assert_eq!(observed.lock().unwrap().len(), 1);
}

#[test]
fn a_freeform_tool_takes_its_string_directly_and_still_accepts_the_object() {
    let input = struct_of(
        json!({ "url": { "type": "string", "description": "Page URL" } }),
        &["url"],
    );
    let fetch = |freeform: bool| {
        let t = Tool::new("Fetch a page", |input, _| Ok(input["url"].clone()))
            .input(input.clone())
            .output(Schema::validated(json!({ "type": "string" })));
        if freeform { t.freeform() } else { t }
    };
    let rt = Runtime::new()
        .with_tool("fetchPage", fetch(true))
        .with_tool("plain", fetch(false));
    let signatures: Vec<String> = rt.catalog().into_iter().map(|t| t.signature).collect();
    assert_eq!(
        signatures,
        [
            "tools.fetchPage(/** Page URL */ url: string): Promise<string>",
            "tools.plain({\n  /** Page URL */\n  url: string,\n}): Promise<string>"
        ]
    );
    assert_eq!(
        value(
            &rt,
            r#"return [await tools.fetchPage("a"), await tools.fetchPage({ url: "b" })]"#
        ),
        json!(["a", "b"])
    );
    assert!(run(&rt, r#"return await tools.plain("a")"#).result.is_err());
}

#[test]
fn catalogs_are_sorted_whatever_the_insertion_order() {
    let make = |order: &[&str]| {
        order
            .iter()
            .fold(Runtime::new(), |rt, p| rt.with_tool(p, echo(p, p)))
            .catalog()
    };
    let first = make(&["zeta.zeta", "zeta.alpha", "alpha.zeta", "alpha.alpha"]);
    let second = make(&["alpha.alpha", "alpha.zeta", "zeta.alpha", "zeta.zeta"]);
    assert_eq!(first, second);
    let paths: Vec<String> = first.into_iter().map(|t| t.path).collect();
    assert_eq!(
        paths,
        ["alpha.alpha", "alpha.zeta", "zeta.alpha", "zeta.zeta"]
    );
}

#[test]
fn dotted_names_nest_and_bracket_access_spells_the_same_path() {
    let rt = Runtime::new().with_tool("api.issues.list", echo("List issues", "listed"));
    assert_eq!(rt.catalog()[0].path, "api.issues.list");
    assert_eq!(
        value(&rt, "return await tools.api.issues.list({})"),
        json!("listed")
    );
    assert_eq!(
        value(&rt, r#"return await tools.api["issues"].list({})"#),
        json!("listed")
    );
    assert_eq!(
        value(
            &rt,
            "return [Object.keys(tools.api), Object.keys(tools.api.issues)]"
        ),
        json!([["issues"], ["list"]])
    );
}

#[test]
fn a_path_can_hold_a_tool_and_child_tools() {
    let rt = Runtime::new()
        .with_tool("issues", echo("All issues", "all"))
        .with_tool("issues.list", echo("List issues", "list"));
    assert_eq!(value(&rt, "return await tools.issues({})"), json!("all"));
    assert_eq!(
        value(&rt, "return await tools.issues.list({})"),
        json!("list")
    );
    assert_eq!(
        value(&rt, "return Object.keys(tools.issues)"),
        json!(["list"])
    );
    let d = failure(&rt, "return await tools.issues.missing({})");
    assert_eq!(d.kind, DiagnosticKind::UnknownTool);
    assert!(d.message.contains("Unknown tool 'issues.missing'"));
    assert_eq!(d.suggestions, ["Use search to find available tools."]);
    assert_eq!(
        failure(&rt, r#"return await tools.issues["get-list"]({})"#).message,
        "Unknown tool 'issues.get-list'. Did you mean tools.issues.list?"
    );
}

#[test]
fn calling_a_namespace_names_a_few_tools_and_counts_the_rest() {
    let rt = ["archive", "create", "get", "issues", "list"]
        .iter()
        .fold(Runtime::new(), |rt, n| {
            rt.with_tool(&format!("issues.{n}"), echo(&format!("Issue {n}"), n))
        });
    let d = failure(&rt, "return await tools.issues({})");
    assert_eq!(
        d.message,
        "Tool 'issues' is not callable, it is a namespace. Did you mean tools.issues.issues, tools.issues.archive, or tools.issues.create?"
    );
    assert_eq!(
        d.suggestions,
        [r#"2 more under 'issues'. Use search({ namespace: "issues" }) to list them."#]
    );
}

#[test]
fn tools_may_use_blocked_member_names() {
    let rt = Runtime::new()
        .with_tool("prototype", echo("Prototype tool", "proto"))
        .with_tool("issues.constructor", echo("Constructor tool", "ctor"))
        .with_tool("nested.__proto__", echo("Proto tool", "dunder"));
    let paths: Vec<String> = rt.catalog().into_iter().map(|t| t.path).collect();
    assert_eq!(
        paths,
        ["issues.constructor", "nested.__proto__", "prototype"]
    );
    assert_eq!(
        value(&rt, "return await tools.prototype({})"),
        json!("proto")
    );
    assert_eq!(
        value(&rt, "return await tools.issues.constructor({})"),
        json!("ctor")
    );
    assert_eq!(
        value(&rt, "return await tools.nested.__proto__({})"),
        json!("dunder")
    );
}

#[test]
fn empty_segments_are_refused() {
    for name in ["", "a..b", "trail.", ".lead"] {
        let err = Runtime::new()
            .try_with_tool(name, echo("Bad", "bad"))
            .err()
            .unwrap();
        assert!(err.0.contains("empty segment"), "{name}");
    }
}

#[test]
fn the_last_tool_for_a_canonical_path_wins() {
    let rt = Runtime::new()
        .with_tool("issues.list", echo("First", "first"))
        .with_tool("issues.list", echo("Second", "second"))
        .with_tool("issues.get", echo("Get issue", "got"));
    assert_eq!(
        value(&rt, "return await tools.issues.list({})"),
        json!("second")
    );
    assert_eq!(rt.catalog().len(), 2);
    assert_eq!(rt.catalog()[1].description, "Second");
}

#[test]
fn a_proto_key_never_reaches_tool_code() {
    let rt = Runtime::new().with_tool(
        "inspect",
        Tool::new("Inspect", |input, _| Ok(input)).output(Schema::render_only(json!({}))),
    );
    assert_eq!(
        value(
            &rt,
            "return await tools.inspect({ v: { __proto__: { polluted: true }, a: 1 } })"
        ),
        json!({ "v": { "a": 1 } })
    );
}

#[test]
fn search_is_a_counted_tool_call_and_is_observed() {
    let observed = Arc::new(Mutex::new(Vec::new()));
    let seen = observed.clone();
    let rt = Runtime::new()
        .with_tool("orders.lookup", echo("Look up an order", "o"))
        .limits(Limits {
            max_tool_calls: Some(1),
            ..Limits::default()
        })
        .hooks(psychoscript::Hooks::new().tool_before(move |call| {
            seen.lock()
                .unwrap()
                .push((call.name.clone(), call.input.clone()));
            Ok(())
        }));
    let outcome = run(&rt, "search({}); return search({})");
    assert_eq!(
        outcome.result.unwrap_err().kind,
        DiagnosticKind::ToolCallLimitExceeded
    );
    assert_eq!(
        *observed.lock().unwrap(),
        vec![("search".to_owned(), json!({}))]
    );
    assert_eq!(outcome.tool_calls.len(), 1);
}

#[test]
fn search_is_an_opaque_shadowable_global() {
    let rt = Runtime::new().with_tool("api.list", echo("List things", "listed"));
    assert_eq!(value(&rt, "return typeof search"), json!("function"));
    assert_eq!(
        value(&rt, r#"const search = () => "local"; return search()"#),
        json!("local")
    );
    assert_eq!(value(&rt, "return { search }"), json!({}));
}

#[test]
fn search_results_can_be_read_awaited_or_chained() {
    let rt = Runtime::new().with_tool("api.list", echo("List things", "listed"));
    assert_eq!(
        value(
            &rt,
            r#"const query = { query: "list" }
            return [
              search(query).items[0].path,
              (await search(query)).items[0].path,
              await search(query).then((result) => result.items[0].path),
              (await search(query).catch(() => "unused")).items[0].path,
              (await search(query).finally(() => "ignored")).items[0].path,
              (await Promise.all([search(query), search({})])).map((result) => result.items.length),
              (await tools.search("list")).items[0].path,
            ]"#
        ),
        json!([
            "tools.api.list",
            "tools.api.list",
            "tools.api.list",
            "tools.api.list",
            "tools.api.list",
            [1, 1],
            "tools.api.list"
        ])
    );
    assert_eq!(
        value(
            &rt,
            r#"const result = search({ query: "list" })
            const forIn = []
            for (const key in result) forIn.push(key)
            return [Object.keys(result), Object.keys({ ...result }), forIn, JSON.parse(JSON.stringify(result)).remaining]"#
        ),
        json!([
            ["items", "remaining", "next"],
            ["items", "remaining", "next"],
            ["items", "remaining", "next"],
            0
        ])
    );
    assert!(
        value(
            &rt,
            r#"try { await search({ limit: "ten" }) } catch (error) { return error.message }"#
        )
        .as_str()
        .unwrap()
        .contains("Invalid input for tool 'search'")
    );
}

#[test]
fn a_registered_root_search_tool_takes_precedence() {
    let rt = Runtime::new().with_tool("search", echo("Custom search", "custom"));
    assert_eq!(value(&rt, "return await tools.search({})"), json!("custom"));
}

#[test]
fn tool_context_carries_the_run_key() {
    let rt = Runtime::new().with_tool(
        "key",
        Tool::new("Key", |_, ctx| Ok(Json::String(ctx.key())))
            .output(Schema::render_only(json!({}))),
    );
    let program = rt.program(
        "return [await tools.key(), await tools.key()]",
        &serde_json::Map::new(),
        Some("run-1"),
    );
    assert_eq!(
        program.run().unwrap().result.unwrap(),
        json!(["run-1:0", "run-1:1"])
    );
    let generated = value(&rt, "return await tools.key()");
    assert_eq!(
        generated.as_str().unwrap().len(),
        "00000000-0000-0000-0000-000000000000:0".len()
    );
}

#[test]
fn reruns_start_from_a_clean_slate() {
    let rt = Runtime::new()
        .with_tool(
            "host.echo",
            Tool::new("echo", |_, _| Ok(json!(1)))
                .input(empty())
                .output(Schema::validated(json!({ "type": "number" }))),
        )
        .limits(Limits {
            max_tool_calls: Some(1),
            ..Limits::default()
        });
    for _ in 0..2 {
        let outcome = run(
            &rt,
            r#"console.log("hi"); return await tools.host.echo({})"#,
        );
        assert_eq!(outcome.result.unwrap(), json!(1));
        assert_eq!(outcome.logs, ["hi"]);
        assert_eq!(outcome.tool_calls.len(), 1);
    }
}

#[test]
fn warnings_have_their_own_output_budget() {
    let rt = Runtime::new().limits(Limits {
        max_output_bytes: Some(120),
        ..Limits::default()
    });
    let outcome = run(
        &rt,
        r#"for (const m of ["a", "b", "c"]) Promise.reject(new Error(m)); return "ok""#,
    );
    assert_eq!(outcome.result.unwrap(), json!("ok"));
    let messages: Vec<&str> = outcome
        .warnings
        .iter()
        .map(|w| w.message.as_str())
        .collect();
    assert_eq!(
        messages,
        [
            "Unhandled rejection from an un-awaited promise: Error: a",
            "2 additional warnings omitted by the output limit."
        ]
    );
    assert_eq!(outcome.warnings[1].kind, DiagnosticKind::Truncated);
    assert!(outcome.truncated);
}
