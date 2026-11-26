//! The native host against the conformance fixtures (`packages/widget/test/fixtures/wire`, read in place, with
//! `packages/widget/src/prelude.js`). Each fixture holds a widget template `source` and a step `input`, `built` (the
//! view as emitted, each function as `"$function"`) when it crosses, and either `view`, `handlers`, `canvases` and
//! `result`, or `error`. The view the walk must write byte for byte is `JSON.stringify(JSON.parse(..).view)`
//! ([`stringify`]).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use psychoscript::{
    HostFunction, HostValue, Limits, Runtime, Translate, TranslateFunctions, TranslatePromises,
};
use serde_json::Value;
use widget_web::tree::{DEEP, Walk, WalkError};
use widget_web::{Error, Program};

const ENTRY: &str = "\nreturn __widget_native_step(__input())";

/// `@opencode/widget` (`packages/widget`).
fn widget() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../widget")
}

fn dir() -> PathBuf {
    widget().join("test/fixtures/wire")
}

/// A fixture's JSON as `JSON.stringify` writes it once `JSON.parse` has read it: numbers as ECMAScript writes them
/// (`Number::toString`), an object's array-index keys first in ascending order, then the others in order.
fn stringify(v: &Value, out: &mut String) {
    match v {
        Value::Number(n) => {
            out.push_str(ryu_js::Buffer::new().format(n.as_f64().expect("a number")));
        }
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                stringify(item, out);
            }
            out.push(']');
        }
        Value::Object(props) => {
            let index = |k: &str| {
                k.parse::<u32>()
                    .ok()
                    .filter(|i| *i != u32::MAX && i.to_string() == k)
            };
            let mut keys: Vec<&String> = props.keys().collect();
            keys.sort_by_key(|k| index(k).map_or((1, 0), |i| (0, i)));
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).unwrap());
                out.push(':');
                stringify(&props[k], out);
            }
            out.push('}');
        }
        // null, booleans, and strings, which `serde_json` escapes as `JSON.stringify` does.
        other => out.push_str(&serde_json::to_string(other).unwrap()),
    }
}

/// A fixture's `built` as the host value `__widget_emit` gets.
fn host(v: &Value) -> HostValue {
    match v {
        Value::Null => HostValue::Null,
        Value::Bool(b) => HostValue::Bool(*b),
        Value::Number(n) => HostValue::Number(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => match s.as_str() {
            "$function" => HostValue::FunctionMarker,
            "$NaN" => HostValue::Number(f64::NAN),
            "$Infinity" => HostValue::Number(f64::INFINITY),
            "$-Infinity" => HostValue::Number(f64::NEG_INFINITY),
            s => HostValue::String(s.into()),
        },
        Value::Array(items) => HostValue::Array(items.iter().map(|i| Some(host(i))).collect()),
        Value::Object(props) => HostValue::Object(
            props
                .iter()
                .map(|(k, v)| (k.as_str().into(), host(v)))
                .collect(),
        ),
    }
}

/// An emitted view as a fixture's `built` writes it.
fn built(v: &HostValue) -> Value {
    match v {
        HostValue::Null | HostValue::Undefined => Value::Null,
        HostValue::Bool(b) => Value::Bool(*b),
        HostValue::Number(n) if n.is_nan() => "$NaN".into(),
        HostValue::Number(n) if n.is_infinite() => {
            (if *n > 0.0 { "$Infinity" } else { "$-Infinity" }).into()
        }
        HostValue::Number(n) if n.fract() == 0.0 && n.abs() < 9e15 => (*n as i64).into(),
        HostValue::Number(n) => (*n).into(),
        HostValue::String(s) => s.to_string_lossy().into_owned().into(),
        HostValue::FunctionMarker => "$function".into(),
        HostValue::Array(items) => Value::Array(
            items
                .iter()
                .map(|i| i.as_ref().map_or(Value::Null, built))
                .collect(),
        ),
        HostValue::Object(props) => Value::Object(
            props
                .iter()
                .filter(|(_, v)| !matches!(v, HostValue::Undefined))
                .map(|(k, v)| (k.to_string_lossy().into_owned(), built(v)))
                .collect(),
        ),
        other => panic!("not in a view: {other:?}"),
    }
}

struct Fixture {
    name: String,
    json: Value,
    wire: Option<String>,
}

impl Fixture {
    fn map(&self, field: &str) -> BTreeMap<String, String> {
        self.json[field]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or_default().to_owned()))
            .collect()
    }

    fn program(&self) -> String {
        format!(
            "{}\n{}{ENTRY}",
            prelude(),
            self.json["source"].as_str().unwrap_or_default()
        )
    }
}

fn fixtures() -> Vec<Fixture> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir()).expect("the fixtures") {
        let path = entry.expect("an entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        // The depth fixtures nest past serde_json's default limit of 128.
        let text = std::fs::read_to_string(&path).expect("read");
        let mut reader = serde_json::Deserializer::from_str(&text);
        reader.disable_recursion_limit();
        let json: Value = serde::Deserialize::deserialize(&mut reader).expect("JSON");
        out.push(Fixture {
            name: json["name"].as_str().unwrap_or_default().to_owned(),
            wire: json.get("view").map(|view| {
                let mut wire = String::new();
                stringify(view, &mut wire);
                wire
            }),
            json,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(out.len(), 58);
    out
}

/// The prelude a fixture's program starts with (`packages/widget/src/prelude.js`).
fn prelude() -> String {
    std::fs::read_to_string(widget().join("src/prelude.js")).expect("the prelude")
}

/// What the walk of `view` gives: its JSON, handlers (id -> event) and canvases (key -> id).
type Walked = Result<(String, BTreeMap<String, String>, BTreeMap<String, String>), WalkError>;

fn walk(view: &HostValue) -> Walked {
    let mut out = String::new();
    let tree = Walk::new().handlers().run(view, &mut out)?;
    // A later node with the same id takes it, as in the prelude's table.
    let handlers = tree
        .handlers
        .unwrap_or_default()
        .into_iter()
        .map(|(id, event)| (id, event.to_owned()))
        .collect();
    let canvases = tree
        .canvases
        .into_iter()
        .map(|(k, (id, _))| (k, id))
        .collect();
    Ok((out, handlers, canvases))
}

/// What a fixture expects of the walk of its view.
fn expected(f: &Fixture) -> Walked {
    let error = &f.json["error"];
    if error["view"] == true {
        let message = error["message"].as_str().unwrap_or_default();
        return Err(WalkError::View(
            [widget_web::tree::KEY, DEEP]
                .into_iter()
                .find(|m| *m == message)
                .expect("a view failure"),
        ));
    }
    if error["message"]
        .as_str()
        .is_some_and(|m| m.contains("contains a function"))
    {
        return Err(WalkError::Function);
    }
    Ok((
        f.wire.clone().unwrap_or_default(),
        f.map("handlers"),
        f.map("canvases"),
    ))
}

#[test]
fn every_fixture_walks_from_its_built_view() {
    let mut walked = 0;
    for f in fixtures() {
        if f.json.get("built").is_none() {
            continue;
        }
        let got = walk(&host(&f.json["built"]));
        let want = expected(&f);
        match (&got, &want) {
            // A failing step's view: its error, unless the run fails for another reason (the result's).
            (Ok(_), Ok(_)) if f.wire.is_none() => {}
            _ => assert_eq!(got, want, "{}", f.name),
        }
        walked += 1;
    }
    assert_eq!(walked, 57);
}

/// Each fixture's program run natively on its input with real function markers: the view `__widget_emit` gets is
/// `built` and walks to the fixture's (view byte for byte, handlers, canvases), and `Program::run_step` gives the
/// fixture's `result` and view, or fails with its `error`.
#[test]
fn every_fixture_runs_natively_to_its_view_result_or_error() {
    let mut count = 0;
    for f in fixtures() {
        let program = f.program();
        // The run with an `__widget_emit` that keeps what it gets.
        let input = host(&f.json["input"]);
        let emitted: Arc<Mutex<Vec<Vec<HostValue>>>> = Arc::default();
        let keep = emitted.clone();
        let runtime = Runtime::make()
            .globals(move |_run| {
                let input = input.clone();
                let keep = keep.clone();
                [
                    ("__input", HostFunction::new(move |_, _| input.clone())),
                    (
                        "__widget_emit",
                        HostFunction::new(move |args, _| {
                            keep.lock().unwrap().push(args);
                            HostValue::Undefined
                        }),
                    ),
                ]
            })
            .translate(Translate {
                functions: TranslateFunctions::Mark,
                promises: TranslatePromises::Error,
            })
            .limits(Limits {
                max_value_depth: Some(202),
                ..Limits::default()
            });
        let _ = runtime.execute(program.as_str());
        let emitted = std::mem::take(&mut *emitted.lock().unwrap());
        if let Some(want) = f.json.get("built") {
            assert_eq!(emitted.len(), 1, "{}: one emit", f.name);
            assert_eq!(&built(&emitted[0][0]), want, "{}: built", f.name);
            let got = walk(&emitted[0][0]);
            match expected(&f) {
                Ok(_) if f.wire.is_none() => assert!(got.is_ok(), "{}", f.name),
                want => assert_eq!(got, want, "{}", f.name),
            }
        } else {
            // Too deep to cross: the prelude hands over the reason instead.
            assert_eq!(emitted.len(), 1, "{}: one emit", f.name);
            assert!(
                matches!(&emitted[0][..], [HostValue::Null, HostValue::String(s)] if s == DEEP)
            );
        }

        // The host's own entry point.
        let step = Program::new(&program, None).unwrap().run_step(
            &f.json["input"].to_string(),
            None,
            None,
        );
        let error = &f.json["error"];
        match step {
            Ok(text) => {
                assert!(error.is_null(), "{}: expected {error}, got {text}", f.name);
                let wire = f.wire.as_deref().expect("a view");
                assert!(
                    text.ends_with(&format!(",\"view\":{wire}}}")),
                    "{}: the view in {text}",
                    f.name
                );
                let mut reader = serde_json::Deserializer::from_str(&text);
                reader.disable_recursion_limit();
                let mut output: Value = serde::Deserialize::deserialize(&mut reader).expect("JSON");
                output.as_object_mut().unwrap().shift_remove("view");
                assert_eq!(output, f.json["result"], "{}: the result", f.name);
            }
            Err(e) => {
                let want = error["message"].as_str().unwrap_or("(no error)");
                assert_eq!(
                    (matches!(e, Error::View { .. }), e.reason()),
                    (error["view"] == true, want),
                    "{}",
                    f.name
                );
            }
        }
        count += 1;
    }
    assert_eq!(count, 58);
}

/// The walk counts levels itself, for views the boundary lets through (its default depth stops them at 16 levels).
#[test]
fn a_view_nests_at_most_100_levels() {
    let leaf = || HostValue::object([("type", HostValue::String("text".into()))]);
    let column = |child: HostValue| {
        HostValue::object([
            ("type", HostValue::String("column".into())),
            ("children", HostValue::array([child])),
        ])
    };
    let nest = |levels: usize, wrap: &dyn Fn(HostValue) -> HostValue| {
        (1..levels).fold(leaf(), |node, _| wrap(node))
    };
    assert!(
        Walk::new()
            .run(&nest(100, &column), &mut String::new())
            .is_ok()
    );
    assert_eq!(
        Walk::new()
            .run(&nest(101, &column), &mut String::new())
            .err(),
        Some(WalkError::View(DEEP))
    );
    // An array inside children counts as a level: 50 columns of `[[node]]` put the leaf at level 101.
    let arrays = |child: HostValue| column(HostValue::array([child]));
    assert!(
        Walk::new()
            .run(&nest(50, &arrays), &mut String::new())
            .is_ok()
    );
    assert_eq!(
        Walk::new()
            .run(&nest(51, &arrays), &mut String::new())
            .err(),
        Some(WalkError::View(DEEP))
    );
    // Strings don't count: a string at level 101 is fine.
    let strings = (1..100).fold(column(HostValue::String("x".into())), |node, _| {
        column(node)
    });
    assert!(Walk::new().run(&strings, &mut String::new()).is_ok());
}

/// A widget step's boundary is 202 values deep (widgets.md, "Native hosts"): a view of 100 levels crosses and walks,
/// one of 101 fails in phase view, nested children or arrays alike; a prop deeper than the boundary fails where it
/// crosses.
#[test]
fn a_native_step_takes_views_of_100_levels() {
    let step = |view: &str| {
        let program = format!("{}\nfunction view() {{\n{view}\n}}{ENTRY}", prelude());
        Program::new(&program, None).unwrap().run_step(
            r#"{"phase":"init","data":null}"#,
            None,
            None,
        )
    };
    let nested = |levels: usize, wrap: &str| {
        format!(
            "let node = ui.button(\"deep\", {{ onPress: (s) => s }})\nfor (let i = 1; i < {levels}; i++) node = {wrap}\nreturn node"
        )
    };
    let id = vec!["0"; 100].join("/");
    let out = step(&nested(100, "ui.column([node])")).expect("100 levels");
    assert!(out.contains(&format!("\"id\":\"{id}\"")), "{out}");
    let id = std::iter::once("0")
        .chain(vec!["0.0"; 49])
        .collect::<Vec<_>>()
        .join("/");
    let out = step(&nested(50, "ui.column([[node]])")).expect("100 levels in arrays");
    assert!(out.contains(&format!("\"id\":\"{id}\"")), "{out}");
    assert_eq!(
        step(&nested(101, "ui.column([node])")),
        Err(Error::View {
            reason: DEEP.into()
        })
    );
    assert_eq!(
        step(&nested(51, "ui.column([[node]])")),
        Err(Error::View {
            reason: DEEP.into()
        })
    );
    let too_deep =
        step(r#"return ui.text("x", { extra: JSON.parse("[".repeat(210) + "]".repeat(210)) })"#);
    assert!(
        matches!(&too_deep, Err(e) if e.reason().contains("exceeds the maximum value depth of 202")),
        "{too_deep:?}"
    );
}

/// A function where none may go is the runtime's own `TypeError` to a program that catches it.
#[test]
fn a_caught_function_error_is_a_real_type_error() {
    let program = format!(
        "{}\nfunction view() {{\n  try {{ __widget_emit(ui.text(\"x\", {{ f: () => 1 }})) }} catch (e) {{\n    return ui.text([e instanceof TypeError, e.constructor === TypeError, e.name, e.message].join(\" | \"))\n  }}\n}}{ENTRY}",
        prelude()
    );
    let out = Program::new(&program, None)
        .unwrap()
        .run_step(r#"{"phase":"init","data":null}"#, None, None)
        .unwrap();
    assert!(
        out.ends_with(r#""view":{"type":"text","text":"true | true | TypeError | Argument 1 to __widget_emit contains a function, which cannot be passed to the host."}}"#),
        "{out}"
    );
}

#[test]
fn a_key_with_a_lone_surrogate_is_a_program_error() {
    let lone = psychoscript::HostString::from_utf16(&[0xd800]);
    let view = HostValue::object([
        ("type", HostValue::String("column".into())),
        (
            "children",
            HostValue::Array(vec![Some(HostValue::object([
                ("type", HostValue::String("text".into())),
                ("key", HostValue::String(lone)),
            ]))]),
        ),
    ]);
    assert_eq!(
        Walk::new().run(&view, &mut String::new()).err(),
        Some(WalkError::Uri)
    );
}

/// The walk's cost on the biggest fixtures:
/// `cargo test --release -p widget-web --test tree -- --ignored --nocapture`.
#[test]
#[ignore = "timings: run in release with --ignored"]
fn timings() {
    let all = fixtures();
    for name in ["grid-200", "builtin-suggestions"] {
        let f = all.iter().find(|f| f.name == name).expect(name);
        let view = host(&f.json["built"]);
        let mut out = String::new();
        let runs = 400;
        let mut best = f64::MAX;
        for _ in 0..runs {
            out.clear();
            let t = Instant::now();
            Walk::new().run(&view, &mut out).expect("walks");
            best = best.min(t.elapsed().as_secs_f64() * 1e6);
        }
        println!("{name}: {best:.1} µs (min of {runs}), {} bytes", out.len());
    }
}

/// A native draw step: the commands `__widget_emit` gets are read as JSON reads them (functions and `undefined` fields
/// left out, an `undefined` item `null`), then checked and normalised; `[]` when `draw` returns nothing. The checks
/// themselves: `tests/draw.rs`.
#[test]
fn a_draw_step_emits_its_commands_as_json_reads_them() {
    let draw = |source: &str| {
        let program = format!("{}\n{source}{ENTRY}", prelude());
        Program::new(&program, None).unwrap().run_draw(
            r#"{"phase":"draw","data":null,"state":{},"frame":{"id":"0/:c","width":2,"height":2}}"#,
            None,
            None,
        )
    };
    assert_eq!(
        draw(r##"function draw(state, data, frame) {
  return ui.draw().rect(0, 0, 1, 1, "accent").commands.concat([["text", 1, 2, frame.key, undefined], ["rect", 0, 0, 1, 1, { u: undefined, f: () => 1, fill: "#fff" }]])
}"##)
        .unwrap(),
        r##"[["rect",0,0,1,1,{"fill":"accent"}],["text",1,2,"c",{}],["rect",0,0,1,1,{"fill":"#fff"}]]"##
    );
    assert_eq!(
        draw("function draw() {\n  return [[\"text\", 1, NaN, \"t\"]]\n}"),
        Err(Error::Draw {
            reason: "draw command 0: \"text\" argument 2 must be a finite number".into()
        })
    );
    assert_eq!(draw("function draw() {}").unwrap(), "[]");
    assert_eq!(draw("").unwrap(), "[]");
    assert!(draw("function draw() { throw new Error('no') }").is_err());
}

/// Whole native steps on the biggest fixtures (the view emitted and walked here, functions as markers), and a draw
/// step of the heatmap (its commands emitted).
#[test]
#[ignore = "timings: run in release with --ignored"]
fn step_timings() {
    let all = fixtures();
    for name in ["grid-200", "builtin-suggestions", "builtin-heatmap"] {
        let f = all.iter().find(|f| f.name == name).expect(name);
        let input = f.json["input"].to_string();
        let native = Program::new(&f.program(), None).unwrap();
        let mut best = f64::MAX;
        let mut output = String::new();
        for _ in 0..200 {
            let t = Instant::now();
            output = native.run_step(&input, None, None).expect("runs");
            best = best.min(t.elapsed().as_secs_f64() * 1e6);
        }
        println!("{name}: native step {best:.0} µs (min of 200)");
        if name == "builtin-heatmap" {
            let state: Value = serde_json::from_str::<Value>(&output).unwrap()["state"].clone();
            let draw = serde_json::json!({ "phase": "draw", "data": f.json["input"]["data"], "state": state,
                "frame": { "id": "0", "t": 0, "dt": 0, "width": 640, "height": 320, "scale": 2, "pointer": null,
                "dark": true, "fullscreen": false, "close": null } })
            .to_string();
            let mut best = f64::MAX;
            for _ in 0..200 {
                let t = Instant::now();
                native.run_draw(&draw, None, None).expect("draws");
                best = best.min(t.elapsed().as_secs_f64() * 1e6);
            }
            println!("{name}: native draw step {best:.0} µs (min of 200)");
        }
    }
}
