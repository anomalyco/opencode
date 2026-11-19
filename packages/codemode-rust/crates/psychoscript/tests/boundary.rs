//! Host values crossing into programs and program values crossing out, and runtimes made with different host globals
//! and module names, against the reference's behaviour recorded in `conformance/boundary.json` by
//! `bun conformance/boundary.ts`. The globals are the generator's.

use std::sync::{Arc, Mutex};

use psychoscript::{
    Data, HostError, HostFunction, HostString, HostValue, Json, Limits, Returned, Runtime,
    Translate, TranslateFunctions, TranslatePromises,
};
use serde_json::json;

#[path = "../../../conformance/reference.rs"]
mod reference;

use reference::{describe, same};

type Log = Arc<Mutex<Vec<Json>>>;

fn fixture() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/boundary.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn outcome(o: &psychoscript::Outcome) -> Json {
    match &o.result {
        Ok(value) => json!({ "ok": true, "value": value.to_json() }),
        Err(d) => json!({ "ok": false, "kind": d.kind.name(), "message": d.message_lossy() }),
    }
}

fn number(j: &Json) -> f64 {
    match j {
        Json::String(s) if s == "NaN" => f64::NAN,
        Json::String(s) if s == "Infinity" => f64::INFINITY,
        Json::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
        j => j.as_f64().unwrap_or(f64::NAN),
    }
}

fn pairs(j: &Json) -> Vec<(String, String)> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p[0].as_str().unwrap().to_owned(),
                p[1].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

fn bytes(j: &Json) -> Vec<u8> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|b| b.as_u64().unwrap() as u8)
        .collect()
}

/// A string as `describe` writes it: itself, or `{ string: [code units] }`.
fn text_of(j: &Json) -> HostString {
    match j {
        Json::String(s) => s.into(),
        j => HostString::from_utf16(
            &j["string"]
                .as_array()
                .unwrap()
                .iter()
                .map(|u| u.as_u64().unwrap() as u16)
                .collect::<Vec<_>>(),
        ),
    }
}

/// A host value from the data `describe` writes: the generator's samples, as the host gives them.
fn undescribe(j: &Json) -> HostValue {
    let Json::Object(map) = j else {
        return HostValue::from_json(j);
    };
    let (tag, v) = map.iter().next().unwrap();
    match tag.as_str() {
        "undefined" => HostValue::Undefined,
        "number" => HostValue::Number(number(v)),
        "date" => HostValue::Date(number(v)),
        "regexp" => HostValue::RegExp {
            source: text_of(&v[0]),
            flags: v[1].as_str().unwrap().to_owned(),
        },
        "url" => HostValue::Url(v.as_str().unwrap().to_owned()),
        "string" => HostValue::String(text_of(j)),
        "params" => HostValue::SearchParams(pairs(v)),
        "headers" => HostValue::Headers(pairs(v)),
        "bytes" | "arrayBuffer" => HostValue::Bytes(bytes(v)),
        "buffer" => HostValue::Buffer(bytes(v)),
        "map" => HostValue::Map(
            v.as_array()
                .unwrap()
                .iter()
                .map(|e| (undescribe(&e[0]), undescribe(&e[1])))
                .collect(),
        ),
        "set" => HostValue::Set(v.as_array().unwrap().iter().map(undescribe).collect()),
        "array" => HostValue::Array(
            v.as_array()
                .unwrap()
                .iter()
                .map(|i| (i.get("hole").is_none()).then(|| undescribe(i)))
                .collect(),
        ),
        "error" => {
            let mut e = HostError::named(v["name"].as_str().unwrap(), text_of(&v["message"]));
            if let Some(cause) = v.get("cause") {
                e = e.with_cause(undescribe(cause));
            }
            for f in v["fields"].as_array().unwrap() {
                e = e.with_field(text_of(&f[0]), undescribe(&f[1]));
            }
            e.into()
        }
        "object" => HostValue::Object(
            v.as_array()
                .unwrap()
                .iter()
                .map(|f| (text_of(&f[0]), undescribe(&f[1])))
                .collect(),
        ),
        other => panic!("unknown sample tag {other}"),
    }
}

/// `value.constructor.name` as the host sees it.
fn constructor(v: &HostValue) -> &'static str {
    match v {
        HostValue::Undefined | HostValue::Null | HostValue::Interrupt => "undefined",
        HostValue::Bool(_) => "Boolean",
        HostValue::Number(_) => "Number",
        HostValue::String(_) => "String",
        HostValue::Array(_) => "Array",
        HostValue::Object(_) => "Object",
        HostValue::Map(_) => "Map",
        HostValue::Set(_) => "Set",
        HostValue::Function(_) | HostValue::Durable(_) | HostValue::Namespace(_) => "Function",
        HostValue::Error(_) | HostValue::Failure(_) => "Error",
        HostValue::Date(_) => "Date",
        HostValue::RegExp { .. } => "RegExp",
        HostValue::Url(_) => "URL",
        HostValue::SearchParams(_) => "URLSearchParams",
        HostValue::Headers(_) => "Headers",
        HostValue::Bytes(_) => "Uint8Array",
        HostValue::Buffer(_) => "Buffer",
        HostValue::Response(_) => "StreamingResponse",
    }
}

/// The probe runtime: `tools`, `keep`, `make` and `kind`, with functions dropped and promises awaited.
fn probe(samples: &Json, kept: &Log) -> Runtime {
    let (samples, kept) = (samples.clone(), kept.clone());
    Runtime::make()
        .translate(Translate {
            functions: TranslateFunctions::Drop,
            promises: TranslatePromises::Await,
        })
        .globals(move |_| {
            let (samples, kept) = (samples.clone(), kept.clone());
            [
                ("tools", HostValue::from(reference::tools())),
                (
                    "keep",
                    HostFunction::new(move |args, _| {
                        let value = args.into_iter().next().unwrap_or_default();
                        kept.lock().unwrap().push(describe(&value));
                        value
                    })
                    .takes_functions()
                    .length(1)
                    .into(),
                ),
                (
                    "make",
                    HostFunction::new(move |args, _| {
                        undescribe(&samples[args[0].as_str().unwrap_or_default()])
                    })
                    .takes_functions()
                    .length(1)
                    .into(),
                ),
                (
                    "kind",
                    HostFunction::new(|args, _| {
                        HostValue::from(constructor(args.first().unwrap_or(&HostValue::Undefined)))
                    })
                    .takes_functions()
                    .length(1)
                    .into(),
                ),
            ]
        })
}

#[test]
fn the_samples_cross_back_as_the_reference_describes_them() {
    let fixture = fixture();
    for (name, described) in fixture["boundary"]["samples"].as_object().unwrap() {
        let mut expected = described.clone();
        // An `ArrayBuffer` crosses as a `Uint8Array`.
        if let Some(b) = expected.get("arrayBuffer").cloned() {
            expected = json!({ "bytes": b });
        }
        assert!(same(&describe(&undescribe(described)), &expected), "{name}");
    }
}

#[test]
fn values_crossing_the_boundary_match_the_reference() {
    let fixture = fixture();
    let samples = &fixture["boundary"]["samples"];
    let programs = fixture["boundary"]["programs"].as_array().unwrap();
    assert!(programs.len() >= 30);
    let mut failures = Vec::new();
    for program in programs {
        let kept: Log = Arc::default();
        let rt = probe(samples, &kept);
        let code = program["code"].as_str().unwrap();
        let o = rt.execute(code);
        let actual = json!({ "outcome": outcome(&o), "kept": *kept.lock().unwrap() });
        let expected = json!({ "outcome": program["outcome"], "kept": program["kept"] });
        if !same(&actual, &expected) {
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

/// A set of globals the configuration cases pick from, with its module names.
type Set = (Vec<(String, HostValue)>, Vec<(String, String)>);

fn library(name: &str, seen: &Log) -> Set {
    let saw = |name: &'static str, seen: &Log| {
        let seen = seen.clone();
        move |args: &[HostValue]| {
            seen.lock()
                .unwrap()
                .push(json!([name, args.iter().map(describe).collect::<Vec<_>>()]));
        }
    };
    let global = |name: &str, v: HostValue| vec![(name.to_owned(), v)];
    let modules = |pairs: &[(&str, &str)]| {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect::<Vec<_>>()
    };
    match name {
        "later" => {
            let saw = saw("later", seen);
            let f = HostFunction::new_async(move |args, _| {
                let saw = saw.clone();
                async move {
                    saw(&args[..1]);
                    Ok(HostValue::Number(
                        args[0].as_f64().unwrap_or(f64::NAN) + 1.0,
                    ))
                }
            })
            .length(1);
            (global("later", f.into()), Vec::new())
        }
        "files" => {
            let saw = saw("read", seen);
            let f = HostFunction::new(move |_, _| {
                saw(&[]);
                HostValue::from("text")
            });
            (global("read", f.into()), Vec::new())
        }
        "glob" => {
            let saw = saw("Glob", seen);
            let f = HostFunction::new(move |args, _| {
                saw(&args[..1]);
                let pattern = args[0].as_str().unwrap_or_default().to_owned();
                let matcher = HostFunction::new(move |args, _| {
                    HostValue::Bool(args[0].as_str().unwrap_or_default().ends_with(&pattern))
                })
                .named("match")
                .length(1)
                .takes_functions();
                HostValue::object([("match", matcher.into())])
            })
            .constructible()
            .length(1);
            (global("Glob", f.into()), Vec::new())
        }
        "sum" => {
            let saw = saw("Sum", seen);
            let f = HostFunction::new(move |args, _| {
                saw(&args);
                let total: f64 = args.iter().map(|a| a.as_f64().unwrap_or(f64::NAN)).sum();
                Returned::Block(Box::pin(async move {
                    Ok(HostValue::object([("total", HostValue::Number(total))]))
                }))
            })
            .constructible();
            (global("Sum", f.into()), Vec::new())
        }
        "plain" => (
            global(
                "plain",
                HostFunction::new(|_, _| HostValue::Number(1.0)).into(),
            ),
            Vec::new(),
        ),
        "bun" => {
            let file = HostFunction::new(|args, _| {
                HostValue::object([("name", args.into_iter().next().unwrap_or_default())])
            })
            .length(1);
            (
                global("Bun", HostValue::object([("file", file.into())])),
                modules(&[("bun", "Bun")]),
            )
        }
        "one" | "two" => {
            let (name, id) = if name == "one" {
                ("A", "a")
            } else {
                ("B", "b")
            };
            let f = HostFunction::new(move |_, _| HostValue::from(id));
            (
                global(name, HostValue::object([("id", f.into())])),
                modules(&[("shared", name)]),
            )
        }
        "fs" => {
            let read = HostFunction::new(|args, _| {
                HostValue::from(format!("text of {}", args[0].as_str().unwrap_or_default()))
            })
            .length(1);
            let promised =
                HostFunction::new_async(|args, _| async move { Ok(args[0].clone()) }).length(1);
            (
                global(
                    "fs",
                    HostValue::object([
                        ("readFile", read.into()),
                        (
                            "promises",
                            HostValue::object([("readFile", promised.into())]),
                        ),
                    ]),
                ),
                Vec::new(),
            )
        }
        other => panic!("unknown set {other}"),
    }
}

fn names(j: &Json) -> Vec<String> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|n| n.as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn runtimes_made_with_different_globals_and_module_names_match_the_reference() {
    let fixture = fixture();
    let cases = fixture["configuration"].as_array().unwrap();
    assert!(cases.len() >= 30);
    let mut failures = Vec::new();
    for case in cases {
        let seen: Log = Arc::default();
        let picked = names(&case["globals"]);
        let named = match &case["modules"] {
            Json::Null => picked.clone(),
            m => names(m),
        };
        // A later set's module name wins.
        let mut modules: Vec<(String, String)> = Vec::new();
        for set in &named {
            for (k, v) in library(set, &seen).1 {
                match modules.iter_mut().find(|(m, _)| *m == k) {
                    Some(entry) => entry.1 = v,
                    None => modules.push((k, v)),
                }
            }
        }
        let translate = Translate {
            functions: match case["translate"]["functions"].as_str() {
                Some("drop") => TranslateFunctions::Drop,
                _ => TranslateFunctions::Error,
            },
            promises: match case["translate"]["promises"].as_str() {
                Some("await") => TranslatePromises::Await,
                _ => TranslatePromises::Error,
            },
        };
        let globals_seen = seen.clone();
        let rt = Runtime::make()
            .modules(modules)
            .translate(translate)
            .globals(move |_| {
                picked
                    .iter()
                    .flat_map(|set| library(set, &globals_seen).0)
                    .collect::<Vec<_>>()
            });
        let code = case["code"].as_str().unwrap();
        let o = rt.execute(code);
        let actual = json!({ "outcome": outcome(&o), "seen": *seen.lock().unwrap() });
        let expected = json!({ "outcome": case["outcome"], "seen": case["seen"] });
        if !same(&actual, &expected) {
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

/// A host value as data, for bindings.
fn data_of(v: &HostValue) -> Data {
    match v {
        HostValue::Null | HostValue::Undefined => Data::Null,
        HostValue::Bool(b) => Data::Bool(*b),
        HostValue::Number(n) => Data::from(json!(n)),
        HostValue::String(s) => Data::String(s.clone()),
        HostValue::Array(items) => Data::Array(
            items
                .iter()
                .map(|i| i.as_ref().map_or(Data::Null, data_of))
                .collect(),
        ),
        HostValue::Object(fields) => Data::Object(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), data_of(v)))
                .collect(),
        ),
        other => panic!("not data: {other:?}"),
    }
}

/// A diagnostic as the generator records it: its kind, and its message and suggestions as `describe` writes a string.
fn described_diagnostic(d: &psychoscript::Diagnostic) -> Json {
    let mut out = json!({ "kind": d.kind.name(), "message": reference::text(&d.message) });
    if !d.suggestions.is_empty() {
        out["suggestions"] = Json::Array(d.suggestions.iter().map(reference::text).collect());
    }
    out
}

/// A result's value as `describe` writes it.
fn described_data(d: &Data) -> Json {
    match d {
        Data::Null => Json::Null,
        Data::Bool(b) => json!(b),
        Data::Number(n) => Json::Number(n.clone()),
        Data::String(s) => reference::text(s),
        Data::Array(items) => {
            json!({ "array": items.iter().map(described_data).collect::<Vec<_>>() })
        }
        Data::Object(fields) => json!({
            "object": fields
                .iter()
                .map(|(k, v)| json!([reference::text(k), described_data(v)]))
                .collect::<Vec<_>>()
        }),
    }
}

#[test]
fn results_and_logs_keep_unpaired_surrogates_as_the_reference_does() {
    let fixture = fixture();
    let cases = fixture["results"].as_array().unwrap();
    assert!(cases.len() >= 4);
    let mut failures = Vec::new();
    for case in cases {
        let rt = Runtime::make().limits(Limits {
            timeout_ms: None,
            max_output_bytes: case["limits"]["maxOutputBytes"]
                .as_u64()
                .map(|n| n as usize),
        });
        let code = case["code"].as_str().unwrap();
        let mut options = psychoscript::ProgramOptions::new();
        if let Some(HostValue::Object(fields)) = case.get("bindings").map(undescribe) {
            options = options.bindings(fields.into_iter().map(|(k, v)| (k, data_of(&v))));
        }
        let o = rt.execute_with(code, &options);
        let mut actual = match &o.result {
            Ok(value) => json!({ "value": described_data(value) }),
            Err(d) => json!({ "error": described_diagnostic(d) }),
        };
        actual["warnings"] = Json::Array(o.warnings.iter().map(described_diagnostic).collect());
        actual["logs"] = Json::Array(o.logs.iter().map(reference::text).collect());
        actual["truncated"] = json!(o.truncated);
        let mut expected = json!({});
        for key in ["value", "error", "warnings", "logs", "truncated"] {
            if let Some(v) = case.get(key) {
                expected[key] = v.clone();
            }
        }
        if !same(&actual, &expected) {
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
