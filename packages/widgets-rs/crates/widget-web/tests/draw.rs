//! The draw command checks against the shared fixtures (`packages/widget/test/fixtures/draw.json`, read in place):
//! every case through a draw step (the commands read as JSON reads them) and a live `widget.draw` (as they
//! cross) gives exactly its normalised commands, or fails with exactly its message in phase `draw`.

use std::path::Path;
use std::time::{Duration, Instant};

use serde_json::Value;
use widget_web::{Error, LiveExit, LiveOptions, Program, Pump};

const SPECIAL: [&str; 4] = ["NaN", "Infinity", "-Infinity", "undefined"];

/// The case's commands as a JavaScript expression, `"$NaN"` and the like as those values.
fn expression(case: &Value) -> String {
    if let Some(repeat) = case.get("repeat") {
        return format!(
            "Array.from({{ length: {} }}, () => {})",
            repeat["count"], repeat["command"]
        );
    }
    let mut text = case["commands"].to_string();
    for name in SPECIAL {
        text = text.replace(&format!("\"${name}\""), name);
    }
    text
}

/// What the case expects: the normalised commands, or the failure's message.
fn expected(case: &Value) -> Result<Value, String> {
    if let Some(error) = case.get("error") {
        return Err(error.as_str().unwrap().to_owned());
    }
    let valid = &case["valid"];
    Ok(match valid.get("repeat") {
        Some(repeat) => Value::Array(vec![
            repeat["command"].clone();
            repeat["count"].as_u64().unwrap() as usize
        ]),
        None => valid.clone(),
    })
}

/// A file of `@opencode/widget` (`packages/widget`), read in place.
fn read(name: &str) -> String {
    std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../widget")
            .join(name),
    )
    .unwrap()
}

/// A step program's prelude; a live one's adds the live prelude (`packages/widget/src`).
fn prelude() -> String {
    read("src/prelude.js")
}

fn live_prelude() -> String {
    format!(
        "{}\n{}",
        read("src/prelude.js"),
        read("src/prelude-live.js")
    )
}

fn parse(text: &str) -> Value {
    serde_json::from_str(text).expect("JSON")
}

fn failure(error: &Error) -> String {
    assert_eq!(error.phase(), Some("draw"), "{error}");
    error.reason().to_owned()
}

fn step(expression: &str) -> Result<Value, String> {
    let program = format!(
        "{}\nfunction view() {{ return ui.canvas({{ key: \"c\", height: 1 }}) }}\nfunction draw() {{ return {expression} }}\nreturn __widget_native_step(__input())",
        prelude()
    );
    let input = r#"{"phase":"draw","data":null,"state":{},"frame":{"id":":c","t":0,"dt":0,"width":10,"height":10,"scale":1,"pointer":null,"dark":false}}"#;
    Program::new(&program, None)
        .unwrap()
        .run_draw(input, None, None)
        .map(|out| parse(&out))
        .map_err(|e| failure(&e))
}

fn live(expression: &str) -> Result<Value, String> {
    let program = format!(
        "{}\nasync function main() {{\n  widget.render(ui.canvas({{ key: \"c\", height: 1 }}))\n  widget.draw(\"c\", {expression})\n}}\nreturn await __widget_live(__input(), true)",
        live_prelude()
    );
    let mut run = Program::new(&program, None)
        .unwrap()
        .start_live(
            r#"{"data":null}"#,
            LiveOptions {
                native: true,
                ..Default::default()
            },
        )
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut posts = Vec::new();
    loop {
        let pump = run.pump(8.0);
        let out = parse(&run.take_outbox());
        posts.extend(out.as_array().unwrap().iter().cloned());
        if pump == Pump::Ended || Instant::now() > deadline {
            break;
        }
        std::thread::sleep(Duration::from_micros(200));
    }
    match run.exit() {
        Some(LiveExit::Failed { error }) => Err(failure(error)),
        Some(LiveExit::Finished { .. }) => Ok(posts
            .iter()
            .find(|e| e["message"]["type"] == "draw")
            .map(|e| {
                assert_eq!(e["message"]["id"], ":c");
                e["message"]["commands"].clone()
            })
            .unwrap_or(Value::Array(Vec::new()))),
        other => panic!("{other:?}"),
    }
}

#[test]
fn every_draw_fixture_checks_alike_in_a_step_and_a_live_draw() {
    let fixture = parse(&read("test/fixtures/draw.json"));
    let cases = fixture["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 89);
    for case in cases {
        let name = case["name"].as_str().unwrap();
        let (expression, want) = (expression(case), expected(case));
        assert_eq!(step(&expression), want, "step: {name}");
        assert_eq!(live(&expression), want, "live: {name}");
    }
}
