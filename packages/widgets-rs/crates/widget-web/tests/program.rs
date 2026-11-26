use widget_web::{Error, LiveOptions, Program, Pump};

const STEP: &str = r#"
function __widget_step(input) {
  if (input.phase === "init") return { state: { n: 0 }, view: { type: "text", text: "0" } }
  const n = input.state.n + 1
  return { state: { n }, view: { type: "text", text: String(n) } }
}
return __widget_step(__input())
"#;

#[test]
fn runs_a_step_per_input() {
    let program = Program::new(STEP, None).unwrap();
    let init = program
        .run(r#"{"phase":"init","data":{}}"#, Some(250), None)
        .unwrap();
    assert_eq!(
        init,
        r#"{"state":{"n":0},"view":{"type":"text","text":"0"}}"#
    );
    let next = program
        .run(
            r#"{"phase":"event","data":{},"state":{"n":4},"event":{"id":"x","type":"press"}}"#,
            Some(250),
            None,
        )
        .unwrap();
    assert_eq!(
        next,
        r#"{"state":{"n":5},"view":{"type":"text","text":"5"}}"#
    );
}

#[test]
fn syntax_errors_have_a_place() {
    let e = Program::new("let x = ;", None).unwrap_err();
    assert!(matches!(e, Error::Syntax { line: Some(1), .. }), "{e:?}");
    assert_eq!(e.type_name(), "syntax");
}

#[test]
fn runs_time_out_and_throw() {
    let spin = Program::new("while (true) {}", None).unwrap();
    assert!(matches!(
        spin.run("null", Some(20), None),
        Err(Error::Timeout { timeout_ms: 20, .. })
    ));
    let throws = Program::new("throw new TypeError('bad')", None).unwrap();
    let e = throws.run("null", None, None).unwrap_err();
    assert_eq!(e.kind(), Some("ExecutionFailure"));
    assert!(e.reason().contains("TypeError: bad"), "{e}");
    assert!(e.to_json().contains(r#""type":"runtime""#));
}

#[test]
fn inputs_and_outputs_are_checked() {
    let echo = Program::new("return __input()", None).unwrap();
    assert!(matches!(
        echo.run("{", None, None),
        Err(Error::InvalidInput { .. })
    ));
    assert!(matches!(
        echo.run(r#""a long string""#, None, Some(4)),
        Err(Error::OutputTooLarge {
            max_output_bytes: 4,
            ..
        })
    ));
    let named = Program::new("return input().a", Some("input".into())).unwrap();
    assert_eq!(
        named.run(r#"{"a":[1,"x"]}"#, None, None).unwrap(),
        r#"[1,"x"]"#
    );
}

/// Typed arrays are the language's (psychoscript 0.1): plain runs and widget runs (`run_step`, native live runs)
/// alike have them.
#[test]
fn every_run_has_typed_arrays() {
    let probe = "typeof Float32Array + \" \" + typeof ArrayBuffer";
    let plain = Program::new(&format!("return {probe}"), None).unwrap();
    assert_eq!(
        plain.run("null", None, None).unwrap(),
        r#""function function""#
    );
    let step = Program::new(
        &format!("__widget_emit({{ type: \"text\", text: {probe} }})\nreturn {{ state: {{}} }}"),
        None,
    )
    .unwrap();
    assert!(
        step.run_step("null", None, None)
            .unwrap()
            .contains(r#""text":"function function""#)
    );
    let mut live = Program::new(
        &format!("__host.post({{ type: \"probe\", text: {probe} }})"),
        None,
    )
    .unwrap()
    .start_live(
        "null",
        LiveOptions {
            native: true,
            ..Default::default()
        },
    )
    .unwrap();
    while live.pump(8.0) != Pump::Ended {}
    assert!(live.take_outbox().contains(r#""text":"function function""#));
}
