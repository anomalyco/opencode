//! Extension globals, the copying boundary, host errors and imports, mirroring the reference's
//! `extensions.test.ts`.

use std::sync::{Arc, Mutex};

use psychoscript::{
    ConfigError, Extension, Hooks, HostError, HostFunction, HostValue, Json, Limits, Runtime,
};
use serde_json::json;

type Held = Arc<Mutex<Vec<HostValue>>>;

fn web(held: &Held) -> Extension {
    let keep = held.clone();
    let fetch = HostFunction::new_async("fetch", 2, |args| async move {
        let url = args
            .first()
            .and_then(HostValue::as_str)
            .unwrap_or_default()
            .to_owned();
        let body = format!(r#"{{"url":"{url}"}}"#);
        let text = body.clone();
        Ok(HostValue::object([
            ("status", HostValue::Number(200.0)),
            ("ok", HostValue::Bool(true)),
            (
                "headers",
                HostValue::object([(
                    "get",
                    HostFunction::new("get", 1, |args| {
                        Ok(match args.first().and_then(HostValue::as_str) {
                            Some("content-type") => "application/json".into(),
                            _ => HostValue::Null,
                        })
                    })
                    .into(),
                )]),
            ),
            (
                "text",
                HostFunction::new("text", 0, move |_| Ok(text.clone().into())).into(),
            ),
            (
                "json",
                HostFunction::new("json", 0, move |_| {
                    Ok(HostValue::from_json(&serde_json::from_str(&body).unwrap()))
                })
                .into(),
            ),
            (
                "handlers",
                HostValue::array([HostFunction::new("step", 1, |args| {
                    Ok(HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0))
                })
                .into()]),
            ),
        ]))
    });
    Extension::new("web")
        .function(
            "keep",
            HostFunction::new("keep", 1, move |args| {
                let v = args.into_iter().next().unwrap_or_default();
                keep.lock().unwrap().push(v.clone());
                Ok(v)
            }),
        )
        .function(
            "settings",
            HostFunction::new("settings", 0, |_| {
                Ok(HostValue::from_json(
                    &json!({ "retries": 3, "nested": { "deep": true } }),
                ))
            }),
        )
        .function(
            "later",
            HostFunction::new_async("later", 1, |args| async move {
                Ok(HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0))
            }),
        )
        .function(
            "first",
            HostFunction::new("first", 1, |args| match args.into_iter().next() {
                Some(HostValue::Map(entries)) => Ok(entries
                    .into_iter()
                    .find(|(k, _)| k.as_str() == Some("k"))
                    .map(|(_, v)| v)
                    .unwrap_or_default()),
                _ => Ok(HostValue::Undefined),
            }),
        )
        .function("fetch", fetch)
}

fn value(rt: &Runtime, code: &str) -> Json {
    match rt.execute(code, &serde_json::Map::new()).result {
        Ok(v) => v,
        Err(d) => panic!("expected success, got {:?}: {}", d.kind, d.message),
    }
}

fn failure(rt: &Runtime, code: &str) -> String {
    match rt.execute(code, &serde_json::Map::new()).result {
        Ok(v) => panic!("expected failure, got {v}"),
        Err(d) => d.message,
    }
}

#[test]
fn a_global_is_callable_awaitable_and_named() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held));
    assert_eq!(value(&rt, "return await later(1)"), json!(2));
    assert_eq!(
        value(&rt, "return [typeof later, later.name, later.length]"),
        json!(["function", "later", 1])
    );
    assert!(
        rt.execute("new later()", &serde_json::Map::new())
            .result
            .is_err()
    );
}

#[test]
fn a_function_inside_a_result_is_callable_and_crosses_the_same_way() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held));
    assert_eq!(
        value(
            &rt,
            r#"const res = await fetch("https://a.test/", { method: "GET" })
            return [res.status, res.ok, res.headers.get("content-type"), res.text(), res.json(), typeof res.json, res.json.name, res.handlers[0](1)]"#
        ),
        json!([200, true, "application/json", r#"{"url":"https://a.test/"}"#, { "url": "https://a.test/" }, "function", "json", 2])
    );
    assert!(
        failure(
            &rt,
            r#"const res = await fetch("https://a.test/"); res.handlers[0](() => 1)"#
        )
        .contains("Argument 1 to fetch.handlers[0] contains a function")
    );
    assert_eq!(
        value(&rt, r#"return await fetch("https://a.test/")"#),
        json!({ "status": 200, "ok": true, "headers": {}, "handlers": [null] })
    );
}

#[test]
fn values_are_copies_both_ways() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held));
    value(
        &rt,
        "const o = { n: 1, list: [1] }; keep(o); o.n = 2; o.list.push(2)",
    );
    assert_eq!(
        held.lock().unwrap()[0].to_json(),
        Some(json!({ "n": 1, "list": [1] }))
    );
    assert_eq!(
        value(
            &rt,
            "const s = settings(); s.retries = 0; s.nested.deep = false; return [s, settings()]"
        ),
        json!([{ "retries": 0, "nested": { "deep": false } }, { "retries": 3, "nested": { "deep": true } }])
    );
    assert_eq!(value(&rt, "return settings() === settings()"), json!(false));
    assert_eq!(
        value(&rt, r#"return first(new Map([["k", { z: 1 }]]))"#),
        json!({ "z": 1 })
    );
    held.lock().unwrap().clear();
    value(&rt, "keep({ __proto__: { polluted: true }, a: 1 })");
    assert_eq!(held.lock().unwrap()[0].to_json(), Some(json!({ "a": 1 })));
}

#[test]
fn a_program_error_crosses_with_its_name_message_cause_and_data() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held));
    value(
        &rt,
        r#"const e = new Error("m", { cause: new RangeError("root") })
        e.code = "ENOENT"; e.detail = { path: "x" }; e.fn = () => 1
        keep(e)"#,
    );
    let HostValue::Error(e) = &held.lock().unwrap()[0] else {
        panic!("not an error");
    };
    assert_eq!((e.name.as_str(), e.message.as_str()), ("Error", "m"));
    let Some(HostValue::Error(cause)) = e.cause.as_deref() else {
        panic!("no cause");
    };
    assert_eq!(
        (cause.name.as_str(), cause.message.as_str()),
        ("RangeError", "root")
    );
    let keys: Vec<&str> = e.fields.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, ["code", "detail"]);
}

#[test]
fn functions_promises_iterators_and_symbols_cannot_be_passed_in() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held));
    assert!(failure(&rt, "keep(() => 1)").contains("Argument 1 to keep contains a function"));
    assert!(failure(&rt, "keep([1].keys())").contains("Argument 1 to keep contains an iterator"));
    assert!(failure(&rt, "keep(later(1))").contains("un-awaited Promise"));
    assert!(failure(&rt, "keep(Symbol.iterator)").contains("Argument 1 to keep contains a symbol"));
}

#[test]
fn host_errors_become_program_errors() {
    let rt = Runtime::new().extension(
        Extension::new("odd")
            .function(
                "fail",
                HostFunction::new("fail", 0, |_| {
                    Err(HostError::named("RangeError", "boom").into())
                }),
            )
            .function(
                "open",
                HostFunction::new("open", 0, |_| {
                    let cause = HostError::new("ENOENT: no such file or directory, open 'x'")
                        .with_field("code", "ENOENT")
                        .with_field("errno", -2.0)
                        .with_field("path", "x")
                        .with_field("detail", HostValue::from_json(&json!({ "retried": true })))
                        .with_field("retry", HostFunction::new("retry", 0, |_| Ok(1.0.into())));
                    Err(HostError::new("open failed").with_cause(cause).into())
                }),
            )
            .function(
                "reject",
                HostFunction::new_async("reject", 1, |args| async move {
                    Err(args.into_iter().next().unwrap_or_default())
                }),
            )
            .function(
                "boom",
                HostFunction::new("boom", 0, |_| {
                    Err(HostValue::from_json(
                        &json!({ "status": 404, "nested": { "a": 1 } }),
                    ))
                }),
            ),
    );
    assert_eq!(
        value(
            &rt,
            "try { fail() } catch (e) { return [e instanceof RangeError, e.message] }"
        ),
        json!([true, "boom"])
    );
    assert_eq!(
        value(
            &rt,
            r#"try { open() } catch (e) {
              const c = e.cause
              return [e.message, Object.keys(e), c instanceof Error, c.code, c.errno, c.path, c.detail, Object.keys(c), "stack" in c]
            }"#
        ),
        json!(["open failed", [], true, "ENOENT", -2, "x", { "retried": true }, ["code", "errno", "path", "detail"], false])
    );
    assert_eq!(
        value(
            &rt,
            r#"try { await reject(new TypeError("bad")) } catch (e) { return [e instanceof TypeError, e.message] }"#
        ),
        json!([true, "bad"])
    );
    assert_eq!(
        value(
            &rt,
            r#"try { await reject("plain") } catch (e) { return e }"#
        ),
        json!("plain")
    );
    assert_eq!(
        value(&rt, "try { boom() } catch (e) { return e.status }"),
        json!(404)
    );
    assert_eq!(
        failure(&rt, "boom()"),
        r#"Uncaught: {"status":404,"nested":{"a":1}}"#
    );
}

#[test]
fn extension_calls_are_not_tool_calls() {
    let held = Held::default();
    let rt = Runtime::new().extension(web(&held)).limits(Limits {
        max_tool_calls: Some(0),
        ..Limits::default()
    });
    let outcome = rt.execute(
        r#"(await fetch("https://a.test/")).json(); return await later(1)"#,
        &serde_json::Map::new(),
    );
    assert_eq!(outcome.result.unwrap(), json!(2));
    assert!(outcome.tool_calls.is_empty());
}

#[test]
fn a_global_may_not_shadow_a_built_in_or_another_extension() {
    let url =
        Extension::new("web").function("URL", HostFunction::new("URL", 0, |_| Ok(1.0.into())));
    assert_eq!(
        Runtime::new().try_extension(url).err(),
        Some(ConfigError(
            "Extension \"web\" global \"URL\" is already defined.".into()
        ))
    );
    let held = Held::default();
    let again = Extension::new("again")
        .function("fetch", HostFunction::new("fetch", 0, |_| Ok(1.0.into())));
    assert_eq!(
        Runtime::new()
            .extension(web(&held))
            .try_extension(again)
            .err(),
        Some(ConfigError(
            "Extension \"again\" global \"fetch\" is already defined.".into()
        ))
    );
}

fn files() -> Extension {
    Extension::new("files").object(
        "fs",
        HostValue::object([
            (
                "readFile",
                HostFunction::new("readFile", 1, |args| {
                    Ok(format!("text of {}", args[0].as_str().unwrap_or_default()).into())
                })
                .into(),
            ),
            (
                "promises",
                HostValue::object([(
                    "readFile",
                    HostFunction::new_async("readFile", 1, |args| async move {
                        Ok(args.into_iter().next().unwrap_or_default())
                    })
                    .into(),
                )]),
            ),
        ]),
    )
}

#[test]
fn import_require_and_dynamic_import_load_globals_and_fire_the_hooks() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let seen = calls.clone();
    let rt = Runtime::new()
        .extension(files())
        .hooks(Hooks::new().extension_before(move |call| {
            seen.lock()
                .unwrap()
                .push(format!("{}:{}", call.extension, call.name));
            Ok(())
        }));
    assert_eq!(
        value(
            &rt,
            r#"import fs, { readFile } from "node:fs"
            import * as ns from "fs"
            import { readFile as readAsync } from "fs/promises"
            const dynamic = await import("fs")
            return [readFile("a"), fs === require("fs"), ns.default === fs, dynamic === ns, await readAsync("b")]"#
        ),
        json!(["text of a", true, true, true, "b"])
    );
    assert_eq!(
        *calls.lock().unwrap(),
        ["files:fs.readFile", "files:fs.promises.readFile"]
    );
}

#[test]
fn a_module_that_is_not_provided_or_a_missing_export_fails_at_the_import() {
    let rt = Runtime::new().extension(files());
    assert!(failure(&rt, r#"import yaml from "yaml""#).starts_with(
        r#"Error: Cannot import "yaml": it isn't available in Code Mode, which can't load packages or files."#
    ));
    assert!(
        value(
            &rt,
            r#"try { await import("child_process") } catch (e) { return e.message }"#
        )
        .as_str()
        .unwrap()
        .starts_with(r#"Cannot import "child_process""#)
    );
    assert!(
        failure(&rt, r#"import { writeFile } from "fs""#)
            .starts_with(r#"SyntaxError: "fs" has no export named "writeFile"."#)
    );
    assert!(
        failure(&Runtime::new(), r#"require("fs")"#).starts_with(r#"Error: Cannot import "fs""#)
    );
}
