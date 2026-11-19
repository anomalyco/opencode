//! Host globals, the copying boundary, host errors, module names and imports. The values crossing in either
//! direction and the runtime configurations the reference records are replayed from `conformance/boundary.json`;
//! these cover the rest.

use std::sync::{Arc, Mutex};

use psychoscript::{
    HostError, HostFunction, HostValue, Json, Limits, ProgramOptions, Runtime, Translate,
    TranslateFunctions, TranslatePromises,
};
use serde_json::json;

type Held = Arc<Mutex<Vec<HostValue>>>;

/// Functions in arguments are left out and promises awaited, as `JSON.stringify` and `await` would.
const LENIENT: Translate = Translate {
    functions: TranslateFunctions::Drop,
    promises: TranslatePromises::Await,
};

/// What `fetch(url)` gives: data, and functions inside it.
fn response(url: &str) -> HostValue {
    let body = format!(r#"{{"url":"{url}"}}"#);
    let text = body.clone();
    HostValue::object([
        ("status", HostValue::Number(200.0)),
        ("ok", HostValue::Bool(true)),
        (
            "headers",
            HostValue::object([(
                "get",
                HostFunction::new(|args, _| match args.first().and_then(HostValue::as_str) {
                    Some("content-type") => HostValue::from("application/json"),
                    _ => HostValue::Null,
                })
                .named("get")
                .length(1)
                .into(),
            )]),
        ),
        (
            "text",
            HostFunction::new(move |_, _| HostValue::from(text.clone()))
                .named("text")
                .into(),
        ),
        (
            "json",
            HostFunction::new(move |_, _| {
                HostValue::from_json(&serde_json::from_str(&body).unwrap())
            })
            .named("json")
            .into(),
        ),
        (
            "handlers",
            HostValue::array([HostFunction::new(|args, _| {
                HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0)
            })
            .named("step")
            .length(1)
            .into()]),
        ),
    ])
}

/// The globals of a small web host; `keep` records what it gets in `held`.
fn web(held: &Held, translate: Translate, limits: Limits) -> Runtime {
    let held = held.clone();
    Runtime::make()
        .translate(translate)
        .limits(limits)
        .globals(move |_| {
            let keep = held.clone();
            [
                (
                    "keep",
                    HostFunction::new(move |args, _| {
                        let v = args.into_iter().next().unwrap_or_default();
                        keep.lock().unwrap().push(v.clone());
                        v
                    })
                    .length(1),
                ),
                (
                    "settings",
                    HostFunction::new(|_, _| {
                        HostValue::from_json(&json!({ "retries": 3, "nested": { "deep": true } }))
                    }),
                ),
                (
                    "later",
                    HostFunction::new_async(|args, _| async move {
                        Ok(HostValue::Number(args[0].as_f64().unwrap_or(0.0) + 1.0))
                    })
                    .length(1),
                ),
                (
                    "first",
                    HostFunction::new(|args, _| match args.into_iter().next() {
                        Some(HostValue::Map(entries)) => entries
                            .into_iter()
                            .find(|(k, _)| k.as_str() == Some("k"))
                            .map(|(_, v)| v)
                            .unwrap_or_default(),
                        _ => HostValue::Undefined,
                    })
                    .length(1),
                ),
                (
                    "fetch",
                    HostFunction::new_async(|args, _| async move {
                        Ok(response(
                            args.first().and_then(HostValue::as_str).unwrap_or_default(),
                        ))
                    })
                    .length(2),
                ),
                (
                    "never",
                    HostFunction::new_async(|_, _| std::future::pending()),
                ),
                (
                    "echo",
                    HostFunction::new(|args, _| args[0].get("v").cloned().unwrap_or_default())
                        .length(1),
                ),
            ]
        })
}

fn lenient(held: &Held) -> Runtime {
    web(held, LENIENT, Limits::default())
}

fn value(rt: &Runtime, code: &str) -> Json {
    match rt.execute(code).result {
        Ok(v) => v.to_json(),
        Err(d) => panic!("expected success, got {:?}: {}", d.kind, d.message),
    }
}

fn failure(rt: &Runtime, code: &str) -> String {
    match rt.execute(code).result {
        Ok(v) => panic!("expected failure, got {v}"),
        Err(d) => d.message_lossy(),
    }
}

#[test]
fn a_global_is_callable_awaitable_and_named() {
    let held = Held::default();
    let rt = lenient(&held);
    assert_eq!(value(&rt, "return await later(1)"), json!(2));
    assert_eq!(
        value(&rt, "return [typeof later, later.name, later.length]"),
        json!(["function", "later", 1])
    );
    assert_eq!(
        failure(&rt, "new later()"),
        "TypeError: new later(...) is not supported; call later(...) without new instead. (line 1, col 1)"
    );
}

#[test]
fn a_function_inside_a_result_is_callable_and_crosses_the_same_way() {
    let held = Held::default();
    let rt = lenient(&held);
    assert_eq!(
        value(
            &rt,
            r#"const res = await fetch("https://a.test/", { method: "GET" })
            return [res.status, res.ok, res.headers.get("content-type"), res.text(), res.json(), typeof res.json, res.json.name, res.handlers[0](1)]"#
        ),
        json!([200, true, "application/json", r#"{"url":"https://a.test/"}"#, { "url": "https://a.test/" }, "function", "json", 2])
    );
    assert_eq!(
        failure(
            &rt,
            r#"const res = await fetch("https://a.test/"); res.handlers[0]([1].keys())"#
        ),
        "TypeError: Argument 1 to fetch.handlers[0] contains an iterator, which cannot be passed to the host. (line 1, col 45)"
    );
    for rt in [rt, web(&held, Translate::default(), Limits::default())] {
        assert_eq!(
            value(&rt, r#"return await fetch("https://a.test/")"#),
            json!({ "status": 200, "ok": true, "headers": {}, "handlers": [null] })
        );
    }
}

#[test]
fn values_are_copies_both_ways() {
    let held = Held::default();
    let rt = lenient(&held);
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
    let rt = lenient(&held);
    value(
        &rt,
        r#"const e = new Error("m", { cause: new RangeError("root") })
        e.code = "ENOENT"; e.detail = { path: "x" }; e.fn = () => 1
        keep(e)"#,
    );
    let HostValue::Error(e) = &held.lock().unwrap()[0] else {
        panic!("not an error");
    };
    assert_eq!(
        (e.name.as_str(), e.message.as_str()),
        (Some("Error"), Some("m"))
    );
    let Some(HostValue::Error(cause)) = e.cause.as_deref() else {
        panic!("no cause");
    };
    assert_eq!(
        (cause.name.as_str(), cause.message.as_str()),
        (Some("RangeError"), Some("root"))
    );
    let keys: Vec<&str> = e.fields.iter().filter_map(|(k, _)| k.as_str()).collect();
    assert_eq!(keys, ["code", "detail"]);
}

#[test]
fn functions_are_left_out_and_promises_awaited_iterators_and_symbols_cannot_be_passed_in() {
    let held = Held::default();
    let rt = lenient(&held);
    value(
        &rt,
        "keep({ f: () => 1, n: later(1) }); keep([() => 1, later(2)]); keep(() => 1); keep(later(3))",
    );
    let kept: Vec<Option<Json>> = held
        .lock()
        .unwrap()
        .iter()
        .map(HostValue::to_json)
        .collect();
    assert_eq!(
        kept,
        [
            Some(json!({ "n": 2 })),
            Some(json!([null, 3])),
            None,
            Some(json!(4))
        ]
    );
    assert_eq!(
        failure(&rt, "keep([1].keys())"),
        "TypeError: Argument 1 to keep contains an iterator, which cannot be passed to the host. (line 1, col 1)"
    );
    assert_eq!(
        failure(&rt, "keep(Symbol.iterator)"),
        "TypeError: Argument 1 to keep contains a symbol, which cannot be passed to the host. (line 1, col 1)"
    );
}

#[test]
fn host_errors_become_program_errors() {
    let rt = Runtime::make().globals(|_| {
        [
            (
                "fail",
                HostFunction::new(|_, _| -> psychoscript::HostResult {
                    Err(HostError::named("RangeError", "boom").into())
                }),
            ),
            (
                "open",
                HostFunction::new(|_, _| -> psychoscript::HostResult {
                    let cause = HostError::new("ENOENT: no such file or directory, open 'x'")
                        .with_field("code", "ENOENT")
                        .with_field("errno", -2.0)
                        .with_field("path", "x")
                        .with_field("detail", HostValue::from_json(&json!({ "retried": true })))
                        .with_field(
                            "retry",
                            HostFunction::new(|_, _| HostValue::Number(1.0)).named("retry"),
                        );
                    Err(HostError::new("open failed").with_cause(cause).into())
                }),
            ),
            (
                "reject",
                HostFunction::new_async(|args, _| async move {
                    Err(args.into_iter().next().unwrap_or_default())
                }),
            ),
            (
                "boom",
                HostFunction::new(|_, _| -> psychoscript::HostResult {
                    Err(HostValue::from_json(
                        &json!({ "status": 404, "nested": { "a": 1 } }),
                    ))
                }),
            ),
        ]
    });
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
fn a_host_function_passed_back_arrives_as_itself_wherever_it_sits() {
    // Each file's `text` is named after the file, so the host can tell which function it got back.
    let rt = Runtime::make().globals(|_| {
        [
            (
                "file",
                HostFunction::new(|args, _| {
                    let name = args[0].as_str().unwrap_or_default().to_owned();
                    let text = HostFunction::new(|_, _| HostValue::from("text"))
                        .named(format!("text:{name}"));
                    HostValue::object([("name", HostValue::from(name)), ("text", text.into())])
                }),
            ),
            (
                "copy",
                HostFunction::new_async(|args, _| async move {
                    let name = match args[1].get("text") {
                        Some(HostValue::Function(f)) => f.name().to_owned(),
                        _ => "no function".to_owned(),
                    };
                    Ok(HostValue::array([args[0].clone(), HostValue::from(name)]))
                })
                .takes_functions(),
            ),
        ]
    });
    assert_eq!(
        value(&rt, r#"return await copy("b", file("a"))"#),
        json!(["b", "text:a"])
    );
    assert_eq!(
        value(
            &rt,
            r#"const f = file("a"); return await copy("b", { text: f.text })"#
        ),
        json!(["b", "text:a"])
    );
}

#[test]
fn a_program_function_or_a_global_passed_to_the_host_is_left_out() {
    let taken = Held::default();
    let into = taken.clone();
    let rt = Runtime::make()
        .translate(Translate {
            functions: TranslateFunctions::Drop,
            ..Translate::default()
        })
        .globals(move |_| {
            let into = into.clone();
            [
                (
                    "fs",
                    HostValue::object([(
                        "rm",
                        HostFunction::new(|_, _| HostValue::Undefined).into(),
                    )]),
                ),
                (
                    "take",
                    HostFunction::new(move |args, _| {
                        into.lock()
                            .unwrap()
                            .push(args.into_iter().next().unwrap_or_default());
                        HostValue::Undefined
                    })
                    .into(),
                ),
            ]
        });
    value(
        &rt,
        r#"take({ text: async () => "x" }); take({ text: take }); take(fs.rm); take({ a: fs.rm }); take(fs)"#,
    );
    let taken: Vec<Option<Json>> = taken
        .lock()
        .unwrap()
        .iter()
        .map(HostValue::to_json)
        .collect();
    assert_eq!(
        taken,
        [
            Some(json!({})),
            Some(json!({})),
            None,
            Some(json!({})),
            Some(json!({}))
        ]
    );
}

#[test]
fn a_promise_in_the_arguments_that_never_settles_waits_until_the_timeout() {
    let held = Held::default();
    let rt = web(
        &held,
        Translate {
            promises: TranslatePromises::Await,
            ..Translate::default()
        },
        Limits {
            timeout_ms: Some(50),
            ..Limits::default()
        },
    );
    let d = rt.execute("keep({ n: never() })").result.unwrap_err();
    assert_eq!(
        (d.kind.name(), d.message.as_str()),
        ("TimeoutExceeded", Some("Execution timed out after 50ms."))
    );
    assert!(held.lock().unwrap().is_empty());
}

#[test]
fn a_result_with_functions_is_handed_to_another_host_function_as_its_data() {
    let held = Held::default();
    assert_eq!(
        value(
            &lenient(&held),
            r#"return echo({ v: await fetch("https://a.test/") })"#
        ),
        json!({ "status": 200, "ok": true, "headers": {}, "handlers": [null] })
    );
}

#[test]
fn a_host_global_wins_over_a_built_in_and_a_binding_of_the_same_name() {
    let rt = Runtime::make().globals(|_| {
        [
            ("URL", HostFunction::new(|_, _| HostValue::Number(1.0))),
            ("n", HostFunction::new(|_, _| HostValue::Number(2.0))),
        ]
    });
    let mut bindings = serde_json::Map::new();
    bindings.insert("n".into(), Json::from(4));
    let outcome = rt.execute_with(
        "return [URL(), typeof URL.canParse, n()]",
        &ProgramOptions::new().bindings(bindings),
    );
    assert_eq!(outcome.result.unwrap(), json!([1, "undefined", 2]));
}

fn files() -> Runtime {
    Runtime::make().globals(|_| {
        [(
            "fs",
            HostValue::object([
                (
                    "readFile",
                    HostFunction::new(|args, _| {
                        HostValue::from(format!("text of {}", args[0].as_str().unwrap_or_default()))
                    })
                    .into(),
                ),
                (
                    "promises",
                    HostValue::object([(
                        "readFile",
                        HostFunction::new_async(|args, _| async move {
                            Ok(args.into_iter().next().unwrap_or_default())
                        })
                        .into(),
                    )]),
                ),
            ]),
        )]
    })
}

#[test]
fn import_require_and_dynamic_import_load_globals() {
    assert_eq!(
        value(
            &files(),
            r#"import fs, { readFile } from "node:fs"
            import * as ns from "fs"
            import { readFile as readAsync } from "fs/promises"
            const dynamic = await import("fs")
            return [readFile("a"), fs === require("fs"), ns.default === fs, dynamic === ns, await readAsync("b")]"#
        ),
        json!(["text of a", true, true, true, "b"])
    );
}

#[test]
fn a_module_that_is_not_provided_or_a_missing_export_fails_at_the_import() {
    let rt = files();
    assert_eq!(
        failure(&rt, r#"import yaml from "yaml""#),
        r#"Error: Cannot import "yaml": packages can't be installed here. (line 1, col 8)"#
    );
    assert_eq!(
        value(
            &rt,
            r#"try { await import("child_process") } catch (e) { return e.message }"#
        ),
        json!(r#"Cannot import "child_process": this runtime doesn't provide it."#)
    );
    assert_eq!(
        failure(&rt, r#"import { writeFile } from "fs""#),
        r#"SyntaxError: "fs" has no export named "writeFile". (line 1, col 10)"#
    );
    assert_eq!(
        failure(&Runtime::make(), r#"require("fs")"#),
        r#"Error: Cannot import "fs": this runtime doesn't provide it. (line 1, col 1)"#
    );
}

#[test]
fn a_module_name_loads_its_global() {
    let rt = Runtime::make()
        .globals(|_| {
            [(
                "Bun",
                HostValue::object([(
                    "file",
                    HostFunction::new(|args, _| {
                        HostValue::object([("name", args.into_iter().next().unwrap_or_default())])
                    })
                    .into(),
                )]),
            )]
        })
        .modules([("bun", "Bun")]);
    assert_eq!(
        value(
            &rt,
            r#"import Loaded, { file } from "bun"
            return [file("a").name, Loaded === Bun, typeof require("bun").file, typeof (await import("bun")).file]"#
        ),
        json!(["a", true, "function", "function"])
    );
}
