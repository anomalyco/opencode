//! The shared draw command checks (`packages/widget/test/fixtures/draw.json`, read in place; `specs/v2/widgets.md`,
//! Canvas, Draw command checks): each case's commands, as they cross to the host, encode to the commands its
//! `valid` reads as (decoded back, and the same bytes as `valid` itself encodes to), or fail with exactly its `error`.
//! Each case runs four ways: a live `draw` post and a draw step with the values as they crossed (an `undefined` array
//! item as `undefined`, then as a hole), a draw step with them as JSON reads them, and the JSON reading
//! ([`DrawOutput::from_value`]).

use std::time::Instant;

use psychoscript::{Data, HostValue};
use serde_json::{Map, Value, json};
use widget_wire::{
    CallError, Command, DrawOutput, INVALID_DRAW, LivePosts, NativeStep, Output, Post,
    decode_output, decode_post,
};

fn cases() -> Vec<Value> {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../widget/test/fixtures/draw.json"
    );
    let v: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases = v["cases"].as_array().unwrap().clone();
    assert_eq!(cases.len(), 89);
    cases
}

/// A case's commands (or its `valid`), `repeat` expanded.
fn commands(v: &Value) -> Value {
    match v.get("repeat") {
        Some(r) => Value::Array(vec![
            r["command"].clone();
            r["count"].as_u64().unwrap() as usize
        ]),
        None => v.clone(),
    }
}

/// The value as the host gets it: `"$NaN"`, `"$±Infinity"` and `"$undefined"` the values they stand for, an
/// `undefined` array item a hole when `holes`.
fn crossed(v: &Value, holes: bool) -> HostValue {
    match v {
        Value::String(s) if s == "$NaN" => HostValue::Number(f64::NAN),
        Value::String(s) if s == "$Infinity" => HostValue::Number(f64::INFINITY),
        Value::String(s) if s == "$-Infinity" => HostValue::Number(f64::NEG_INFINITY),
        Value::String(s) if s == "$undefined" => HostValue::Undefined,
        Value::Array(a) => HostValue::Array(
            a.iter()
                .map(|i| match crossed(i, holes) {
                    HostValue::Undefined if holes => None,
                    i => Some(i),
                })
                .collect(),
        ),
        Value::Object(o) => HostValue::Object(
            o.iter()
                .map(|(k, v)| (k.as_str().into(), crossed(v, holes)))
                .collect(),
        ),
        v => HostValue::from_json(v),
    }
}

/// The value as JSON reads it: non-finite numbers and `undefined` array items `null`, `undefined` fields left out.
fn as_json(v: &Value) -> Value {
    match v {
        Value::String(s)
            if ["$NaN", "$Infinity", "$-Infinity", "$undefined"].contains(&s.as_str()) =>
        {
            Value::Null
        }
        Value::Array(a) => Value::Array(a.iter().map(as_json).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .filter(|(_, v)| v.as_str() != Some("$undefined"))
                .map(|(k, v)| (k.clone(), as_json(v)))
                .collect::<Map<_, _>>(),
        ),
        v => v.clone(),
    }
}

/// A live `draw` post of `commands` on a rendered canvas: its commands' bytes (section `D`) and what they decode to,
/// or the failure's message.
fn live(commands: HostValue) -> Result<(Vec<u8>, Vec<Command>), String> {
    let now = Instant::now();
    let mut posts = LivePosts::new();
    let canvas = HostValue::from_json(
        &json!({ "type": "render", "node": { "type": "canvas", "key": "c", "height": 1 } }),
    );
    posts.post(&canvas, now).unwrap();
    let draw = HostValue::Object(vec![
        ("type".into(), "draw".into()),
        ("key".into(), "c".into()),
        ("commands".into(), commands),
    ]);
    match posts.post(&draw, now) {
        Ok((bytes, None)) => {
            let [bytes] = &bytes[..] else {
                panic!("one post")
            };
            let Post::Draw { commands, .. } = decode_post(bytes).unwrap() else {
                panic!("a draw")
            };
            // The section after the version, the post kind and the canvas id.
            let d = bytes.iter().position(|b| *b == b'D').unwrap();
            Ok((bytes[d..].to_vec(), commands))
        }
        Err(CallError::Invalid(e)) => {
            assert_eq!(e.kind, INVALID_DRAW, "{}", e.message);
            Err(e.message)
        }
        other => panic!("{other:?}"),
    }
}

/// A draw step emitting `commands`, as [`live`].
fn step(commands: HostValue) -> Result<(Vec<u8>, Vec<Command>), String> {
    let mut step = NativeStep::new(true);
    step.emit(&[commands]).unwrap();
    match step.finish(&Data::Null) {
        Ok(bytes) => {
            let Output::Draw(commands) = decode_output(&bytes).unwrap() else {
                panic!("a draw")
            };
            Ok((bytes[1..].to_vec(), commands))
        }
        Err(e) => {
            assert_eq!(e.kind, INVALID_DRAW, "{}", e.message);
            Err(e.message)
        }
    }
}

#[test]
fn every_host_checks_draw_commands_the_same() {
    let mut errors = 0;
    for case in cases() {
        let name = case["name"].as_str().unwrap();
        let given = match case.get("commands") {
            Some(c) => c.clone(),
            None => commands(&case),
        };
        let ways = [
            ("live", live(crossed(&given, false))),
            ("live, holes", live(crossed(&given, true))),
            ("step", step(crossed(&given, false))),
            ("step, holes", step(crossed(&given, true))),
            (
                "step, as JSON",
                step(HostValue::from_json(&as_json(&given))),
            ),
        ];
        let json =
            DrawOutput::from_value(&json!({ "commands": as_json(&given) })).map(|d| d.commands);
        match (case.get("error"), case.get("valid")) {
            (Some(error), None) => {
                errors += 1;
                let error = error.as_str().unwrap();
                for (way, got) in ways {
                    assert_eq!(got.err().as_deref(), Some(error), "{name}: {way}");
                }
                assert_eq!(json.err().as_deref(), Some(error), "{name}: JSON");
            }
            (None, Some(valid)) => {
                let valid = commands(valid);
                // The normalised commands, as clients read them and as they encode.
                let expected = DrawOutput::from_value(&json!({ "commands": valid }))
                    .unwrap_or_else(|e| panic!("{name}: valid: {e}"))
                    .commands;
                let (bytes, _) = live(HostValue::from_json(&valid)).unwrap();
                for (way, got) in ways {
                    let got = got.unwrap_or_else(|e| panic!("{name}: {way}: {e}"));
                    assert_eq!(got.1, expected, "{name}: {way}");
                    assert_eq!(got.0, bytes, "{name}: {way}: the bytes of `valid`");
                }
                assert_eq!(json.unwrap(), expected, "{name}: JSON");
            }
            _ => panic!("{name}"),
        }
    }
    assert_eq!(errors, 73);
}
