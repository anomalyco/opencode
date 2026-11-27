//! Every node type and prop, draw op and post kind, written by the encoder from the VM's value and decoded, against
//! the same value's JSON read with Rune's rules: the decoded values must be the same. Then the encoder's failures,
//! and malformed bytes.

use std::sync::{Arc, Mutex};

use psychoscript::{HostFunction, HostValue, Runtime, Translate, TranslateFunctions};
use serde_json::{Value, json};
use widget_wire::{
    Arg, Batch, Command, DecodeError, DrawOutput, EncodeError, INVALID_DATA, INVALID_DRAW,
    INVALID_GPU, Node, Output, Post, StepOutput, decode_output, decode_post, encode_output,
    encode_post,
};

type Encoded = Result<Vec<u8>, EncodeError>;

/// Runs `src` with `__emit(value)` handing `value` to `encode` as a host function receives it (functions left out,
/// as psychoscript-mobile's `run_bytes` has it); returns what each call encoded and the program's result as JSON
/// (what the JSON path reads).
fn run(src: &str, encode: fn(&HostValue) -> Encoded) -> (Vec<Encoded>, Value) {
    let out: Arc<Mutex<Vec<Encoded>>> = Arc::default();
    let sink = out.clone();
    let translate = Translate {
        functions: TranslateFunctions::Drop,
        ..Translate::default()
    };
    let runtime = Runtime::make().translate(translate).globals(move |_run| {
        let sink = sink.clone();
        [(
            "__emit",
            HostFunction::new(move |args: Vec<HostValue>, _call| {
                sink.lock()
                    .unwrap()
                    .push(encode(args.first().unwrap_or(&HostValue::Undefined)));
                HostValue::Undefined
            }),
        )]
    });
    let data = runtime
        .execute(src)
        .result
        .unwrap_or_else(|d| panic!("run: {}", d.message_lossy()));
    let json = serde_json::from_str(&data.to_json_string()).unwrap();
    let encoded = std::mem::take(&mut *out.lock().unwrap());
    (encoded, json)
}

/// `expr`'s step output both ways.
fn step(expr: &str) -> (StepOutput, StepOutput) {
    let (enc, json) = run(
        &format!("const v = {expr}\n__emit(v)\nreturn v"),
        encode_output,
    );
    let bytes = enc.into_iter().next().unwrap().expect("encodes");
    let Output::Step(decoded) = decode_output(&bytes).expect("decodes") else {
        panic!("not a step")
    };
    (
        *decoded,
        StepOutput::from_value(&json).expect("the JSON is valid"),
    )
}

fn draw(commands: &str) -> (Vec<Command>, Vec<Command>) {
    let (enc, json) = run(
        &format!("const v = {{ commands: {commands} }}\n__emit(v)\nreturn v"),
        encode_output,
    );
    let bytes = enc.into_iter().next().unwrap().expect("encodes");
    let Output::Draw(decoded) = decode_output(&bytes).expect("decodes") else {
        panic!("not a draw")
    };
    (
        decoded,
        DrawOutput::from_value(&json).expect("valid").commands,
    )
}

/// A post's JSON read as Rune reads live posts.
fn post_from_json(v: &Value) -> Post {
    let batch = |b: &Value| Batch {
        ops: b["ops"]
            .as_array()
            .unwrap()
            .iter()
            .map(Arg::from_json)
            .collect(),
        bytes: b["expect"]
            .as_array()
            .map(|a| a.iter().map(|x| x.as_u64().unwrap() as u8).collect())
            .unwrap_or_default(),
    };
    match v["type"].as_str().unwrap() {
        "render" => Post::Render(Node::from_value(&v["node"]).unwrap()),
        "draw" => Post::Draw {
            id: v["id"].as_str().unwrap().to_owned(),
            commands: DrawOutput::from_value(&json!({ "commands": v["commands"] }))
                .unwrap()
                .commands,
        },
        "frame" if v.get("gpu").is_some() => Post::FrameGpu(batch(&v["gpu"])),
        "frame" => Post::Frame,
        "gpu" => Post::Gpu(batch(v)),
        "submit" => Post::Submit(v.get("value").cloned().unwrap_or(Value::Null)),
        "dismiss" => Post::Dismiss,
        "send" => Post::Send {
            value: v.get("value").cloned().unwrap_or(Value::Null),
            wake: v["wake"] != json!(false),
        },
        "capture" => Post::Capture(v["value"] == json!(true)),
        "storage" => Post::Storage {
            key: v["key"].as_str().unwrap().to_owned(),
            value: v.get("value").and_then(Value::as_str).map(str::to_owned),
        },
        t => panic!("{t}"),
    }
}

/// Each post in `list` (a JS array expression) both ways.
fn posts(list: &str) -> Vec<(Post, Post)> {
    let (enc, json) = run(
        &format!(
            "const list = {list}\nfor (const m of list) __emit(m)\nreturn JSON.parse(JSON.stringify(list))"
        ),
        encode_post,
    );
    enc.into_iter()
        .zip(json.as_array().unwrap())
        .map(|(b, v)| {
            (
                decode_post(&b.expect("encodes")).expect("decodes"),
                post_from_json(v),
            )
        })
        .collect()
}

const EVERY_NODE: &str = r##"{
  state: { n: 1, list: [1, "two", null, { deep: true }], text: "é ✓ 🎉" },
  view: { type: "column", gap: 8, align: "center", fullscreen: true, capture: "pointer", children: [
    { type: "row", gap: 4, align: "end", wrap: true, children: [
      { type: "text", text: "title", style: "title", tone: "muted" },
      { type: "text", text: "body", style: "body", tone: "accent" },
      { type: "text", text: "caption", style: "caption", tone: "success" },
      { type: "text", text: "code", style: "code", tone: "warning" },
      { type: "text", text: "error", tone: "error" },
      { type: "text", text: "default", tone: "default", style: "nope" },
    ] },
    { type: "row", align: "start", fullscreen: false, children: [] },
    { type: "row", align: "stretch", capture: "none" },
    { type: "column", align: "start", children: [{ type: "markdown", text: "**md**" }, { type: "divider" }] },
    { type: "column", align: "end" },
    { type: "column", align: "stretch" },
    { type: "image", src: "https://example.com/a.png", alt: "an image", aspect: 1.5 },
    { type: "image", src: "data:image/png;base64,AAAA" },
    { type: "carousel", id: "c", index: 2, fullscreen: true, capture: "pointer", children: [
      { type: "card", id: "k", selected: true, fullscreen: false, capture: "pointer", children: [{ type: "text", text: "in a card" }] },
      { type: "card", children: [] },
    ] },
    { type: "carousel", children: [{ type: "text", text: "x" }] },
    { type: "button", id: "b1", label: "Go", variant: "primary", disabled: true },
    { type: "button", id: "b2", label: "Maybe", variant: "secondary" },
    { type: "button", id: "b3", label: "Delete", variant: "danger", disabled: false },
    { type: "button", id: "b4", label: "Default" },
    { type: "checkbox", id: "cb", label: "Check", checked: true, disabled: true },
    { type: "checkbox", id: "cb2", label: "Unchecked", checked: false },
    { type: "slider", id: "s", label: "Volume", value: 0.25, min: -1, max: 1e6, step: 0.125 },
    { type: "slider", id: "s2", value: 3, min: 0, max: 10 },
    { type: "select", id: "sel", label: "Pick", options: [{ value: "a", label: "A", description: "first" }, { value: "b", label: "B" }, { value: "c", label: "C", description: null }], value: "b" },
    { type: "select", id: "multi", options: [{ value: "a", label: "A" }], value: ["a", "b"], multiple: true },
    { type: "select", id: "none", options: [], value: [], multiple: true },
    { type: "select", id: "unset", options: [{ value: "a", label: "A" }] },
    { type: "input", id: "in", label: "Name", value: "Ada", placeholder: "your name", multiline: true },
    { type: "input", id: "in2", value: "" },
    { type: "canvas", id: "cv", height: 120, width: 300, fps: 30, duration: 2.5, alt: "chart", poster: "p.png", pointer: true, fill: false, fullscreen: true, capture: "pointer" },
    { type: "canvas", height: 64, wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", values: [0.5, -2, 1e-9] },
    { type: "canvas", height: 32, wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(0.0); }", values: [] },
    { type: "stack", children: [
      { type: "canvas", height: 100, place: "fill" },
      { type: "text", text: "tl", place: "top-left", inset: 4 },
      { type: "text", text: "t", place: "top", inset: { top: 1, left: 2 } },
      { type: "text", text: "tr", place: "top-right", inset: { top: 1, right: 2, bottom: 3, left: 4 } },
      { type: "text", text: "l", place: "left" },
      { type: "text", text: "c", place: "center" },
      { type: "text", text: "r", place: "right" },
      { type: "text", text: "bl", place: "bottom-left" },
      { type: "button", id: "bb", label: "b", place: "bottom" },
      { type: "column", place: "bottom-right", inset: 0, children: [{ type: "divider" }] },
      { type: "text", text: "plain" },
    ] },
    { type: "future-node", whatever: 1, children: [{ type: "text", text: "dropped" }] },
  ] },
}"##;

#[test]
fn every_node_type_and_prop_decodes_as_its_json() {
    let (bin, json) = step(EVERY_NODE);
    assert_eq!(bin, json);
    // The comparison covers what it should: a few spot checks.
    let kids = bin.view.children();
    assert!(matches!(kids[3].children()[1], Node::Divider));
    assert!(matches!(kids.last(), Some(Node::Unknown)));
    let Node::Stack { children } = &kids[kids.len() - 2] else {
        panic!()
    };
    assert_eq!(children.layers.len(), 11);
    assert_eq!(children.layers[3].inset.left, 4.0);
}

#[test]
fn children_are_flattened_as_clients_read_them() {
    let (enc, _) = run(
        r#"__emit({ state: 0, view: { type: "column", children: [[{ type: "markdown", text: "md" }, null], false, undefined, [[{ type: "divider" }]], [], 0 && 1] } })
           return null"#,
        encode_output,
    );
    let Output::Step(s) = decode_output(enc[0].as_ref().unwrap()).unwrap() else {
        panic!()
    };
    let (flat, _) = step(
        r#"{ state: 0, view: { type: "column", children: [{ type: "markdown", text: "md" }, { type: "divider" }] } }"#,
    );
    assert_eq!(s.view.children()[..2], flat.view.children()[..]);
    assert_eq!(s.view.children()[2..], [Node::Unknown]);
}

#[test]
fn step_flags_and_generic_data_decode_as_their_json() {
    for expr in [
        r#"{ state: 1, view: { type: "divider" } }"#,
        r#"{ view: { type: "divider" } }"#,
        r#"{ state: { a: [1, 2.5, "x"] }, view: { type: "divider" }, submit: { answer: 42 } }"#,
        r#"{ state: null, view: { type: "divider" }, submit: null }"#,
        r#"{ state: 0, view: { type: "divider" }, dismiss: true }"#,
        r#"{ state: 0, view: { type: "divider" }, dismiss: false, submit: undefined }"#,
        r#"{ state: 0, view: { type: "divider" }, send: { value: { msg: "hi" }, wake: false } }"#,
        r#"{ state: 0, view: { type: "divider" }, send: { value: "hi", wake: true } }"#,
        r#"{ state: 0, view: { type: "divider" }, send: { value: [1] } }"#,
        r#"{ state: 0, view: { type: "divider" }, send: {} }"#,
        r#"{ state: 0, view: { type: "divider" }, send: null }"#,
        r#"{ state: { f: () => 1, u: undefined, n: NaN }, view: { type: "divider" }, submit: [undefined, -0] }"#,
    ] {
        let (bin, json) = step(expr);
        assert_eq!(bin, json, "{expr}");
    }
}

const EVERY_COMMAND: &str = r##"[
  ["save"], ["restore"],
  ["translate", 1.5, -2], ["rotate", 3.14159], ["scale", 2, 0.5],
  ["alpha", 0.5], ["alpha", 2], ["alpha", -1],
  ["rect", 0, 0, 10, 20, { fill: "#abc" }],
  ["rect", 1, 2, 3, 4, { fill: "#a1b2c3", stroke: "#a1b2c380", width: 2.5, cap: "round" }],
  ["rect", 1, 2, 3, 4, { stroke: "text", width: -3 }],
  ["rrect", 0, 0, 10, 20, 4, { fill: "muted", stroke: "accent", cap: "butt" }],
  ["circle", 5, 5, 3, { fill: "bg", stroke: "surface", width: undefined }],
  ["line", 0, 0, 10, 10, { stroke: "border", width: 1, fill: undefined }],
  ["rect", 0, 0, 1, 1, { fill: "success" }], ["rect", 0, 0, 1, 1, { fill: "warning" }],
  ["rect", 0, 0, 1, 1, { fill: "error" }], ["rect", 0, 0, 1, 1, {}],
  ["rect", 0, 0, 1, 1, { fill: { linear: [0, 0, 10, 0], stops: [[0, "#000"], [0.5, "accent"], [2, "#ffffff80"]] } }],
  ["circle", 0, 0, 5, { fill: { radial: [1, 2, 3], stops: [[-1, "text"], [1, "#123456"]] }, stroke: "#fff" }],
  ["rect", 0, 0, 1, 1, { fill: { linear: [0, 0, 1, 1], radial: [0, 0, 1], stops: [] } }],
  ["path", [["M", 0, 0], ["L", 10, 0], ["Q", 1, 2, 3, 4], ["C", 1, 2, 3, 4, 5, 6], ["Z"]], { fill: "#f00", stroke: "text" }],
  ["path", [], { stroke: "text" }],
  ["text", 10, 20, "hello é ✓", { size: 16, weight: 600, align: "center", color: "accent", mono: true }],
  ["text", 0, 0, "defaults", {}],
  ["text", 0, 0, "no options"],
  ["text", 0, 0, "clamped", { size: 9999, weight: 700, align: "right" }],
  ["text", 0, 0, "clamped", { size: 0.1, weight: 500, align: "left", color: "#00ff00", mono: false }],
  ["text", 0, 0, "undefined fields", { weight: undefined, size: undefined, color: undefined }],
  ["text", 0, 0, "null style", null],
  ["image", "https://example.com/i.png", 1, 2, 30, 40],
]"##;

#[test]
fn every_draw_op_decodes_as_its_json() {
    let (bin, json) = draw(EVERY_COMMAND);
    assert_eq!(bin.len(), 31);
    assert_eq!(bin, json);
}

#[test]
fn every_post_kind_decodes_as_its_json() {
    let pairs = posts(&format!(
        r##"(() => {{
  const vertices = new Float32Array([0.5, -1, 3.25, 1e-7])
  const uniforms = new Uint32Array([1, 2, 0xffffffff])
  const all = new ArrayBuffer(vertices.byteLength + uniforms.byteLength)
  new Uint8Array(all).set(new Uint8Array(vertices.buffer), 0)
  new Uint8Array(all).set(new Uint8Array(uniforms.buffer), vertices.byteLength)
  const ops = [
    ["writeBuffer", 4, 0, 0, vertices.byteLength],
    ["writeBuffer", 6, 0, 16, uniforms.byteLength],
    ["pass", {{ colorAttachments: [{{ view: 1, loadOp: "clear", clearValue: [0, 0, 0, 1], skip: undefined }}], depthStencilAttachment: null }}],
    ["setBindGroup", 0, 20, []],
    ["shader", 7, "@fragment fn fs() -> @location(0) vec4f {{ return vec4f(1.0); }}"],
    ["flags", true, false, null, [undefined, 1]],
    ["end"],
  ]
  const expect = (bytes) => Array.from(new Uint8Array(bytes))
  return [
    {{ type: "render", node: {EVERY_NODE}.view }},
    {{ type: "render", node: {{ type: "text", text: "small" }} }},
    {{ type: "render", node: {{ type: "table", columns: [{{ label: "Day" }}, {{ label: "kg", align: "end" }}], rows: [["Nov 27", 79.6], ["Nov 26", 1e21]], sort: {{ column: 1, descending: true }}, selected: 1, id: "0/:t", selectable: true, sortable: true }} }},
    {{ type: "draw", id: "0/:chart", commands: {EVERY_COMMAND} }},
    {{ type: "draw", id: "", commands: [] }},
    {{ type: "frame" }},
    {{ type: "frame", gpu: {{ ops, bytes: all }}, expect: undefined }},
    {{ type: "frame", gpu: {{ ops: [["submit"]], bytes: vertices.buffer }} }},
    {{ type: "frame", gpu: {{ ops: [], bytes: new ArrayBuffer(0) }} }},
    {{ type: "gpu", ops, bytes: all }},
    {{ type: "submit", value: {{ choice: "b", n: [1, 2] }} }},
    {{ type: "submit", value: null }},
    {{ type: "submit" }},
    {{ type: "dismiss" }},
    {{ type: "send", value: "hi", wake: true }},
    {{ type: "send", value: {{ a: 1 }}, wake: false }},
    {{ type: "send", value: null }},
    {{ type: "capture", value: true }},
    {{ type: "capture", value: false }},
    {{ type: "storage", key: "entry:2026-11-27:é", value: JSON.stringify({{ kcal: 500 }}) }},
    {{ type: "storage", key: "k".repeat(256), value: "x".repeat(65536) }},
    {{ type: "storage", key: "entry:1" }},
  ].map((m) => {{
    if (m.type === "gpu") m.expect = expect(all)
    if (m.gpu) m.gpu.expect = m.gpu.bytes ? expect(m.gpu.bytes.buffer ?? m.gpu.bytes) : []
    return m
  }})
}})()"##
    ));
    assert_eq!(pairs.len(), 22);
    for (i, (bin, json)) in pairs.iter().enumerate() {
        assert_eq!(bin, json, "post {i}");
    }
    let Post::FrameGpu(b) = &pairs[6].0 else {
        panic!()
    };
    assert_eq!(&b.bytes[..4], &0.5f32.to_le_bytes());
    assert_eq!(&b.bytes[16..20], &1u32.to_le_bytes());
    assert_eq!(b.bytes.len(), 28);
}

fn error_of(src: &str, encode: fn(&HostValue) -> Encoded) -> EncodeError {
    let (enc, _) = run(&format!("__emit({src})\nreturn null"), encode);
    enc.into_iter()
        .next()
        .unwrap()
        .expect_err("fails to encode")
}

#[test]
fn invalid_outputs_and_posts_fail_to_encode() {
    for (src, why) in [
        ("1", "a step must return an object"),
        (r#"{ commands: 1 }"#, "must be a list"),
        (
            r#"{ commands: [["rect", 0, 0, 1, NaN, {}]] }"#,
            "draw command 0: \"rect\" argument 4 must be a finite number",
        ),
        (
            r#"{ commands: [["rect", 0, 0, 1, 1, "red"]] }"#,
            "a paint is an object",
        ),
        (
            r##"{ commands: [["rect", 0, 0, 1, 1, { fill: "#12" }]] }"##,
            "not a color",
        ),
        (
            r#"{ commands: [["blur", 1]] }"#,
            "unknown draw command \"blur\"",
        ),
        (
            r#"{ commands: [["path", [["X", 1]], {}]] }"#,
            "unknown path segment",
        ),
        (r#"{ commands: [["text", 0, 0]] }"#, "missing argument 3"),
        (
            r#"{ commands: [["text", 0, 0, "x", { size: "big" }]] }"#,
            "a text size",
        ),
        (r#"{ commands: [["image", 1, 0, 0, 1, 1]] }"#, "takes a src"),
        (
            r#"{ commands: Array.from({ length: 2001 }, () => ["save"]) }"#,
            "2001 draw commands is over the budget of 2000",
        ),
    ] {
        let e = error_of(src, encode_output);
        let kind = if src == "1" {
            INVALID_DATA
        } else {
            INVALID_DRAW
        };
        assert!(e.message.contains(why) && e.kind == kind, "{src}: {e}");
    }
    for (src, why) in [
        ("1", "invalid post: a post is an object with a type"),
        (r#"{ type: "explode" }"#, "unknown post type \"explode\""),
        (r#"{ type: "draw", commands: [] }"#, "needs its canvas's id"),
        (
            r#"{ type: "storage", key: "" }"#,
            "a storage post needs a key of 1 to 256 characters",
        ),
        (
            r#"{ type: "storage", key: "k".repeat(257) }"#,
            "a storage post needs a key of 1 to 256",
        ),
        (
            r#"{ type: "storage", key: "a", value: 1 }"#,
            "value must be JSON text of at most 64 KiB",
        ),
        (
            r#"{ type: "storage", key: "a", value: "é".repeat(32769) }"#,
            "value must be JSON text of at most 64 KiB",
        ),
        (
            r#"{ type: "draw", id: "x", commands: [["nope"]] }"#,
            "draw command 0",
        ),
        // The batch's shape, in the spec's words (`widgets-gpu.md`, Host checks).
        (
            r#"{ type: "frame", gpu: 5 }"#,
            "invalid post: a batch must be an object",
        ),
        (
            r#"{ type: "frame", gpu: { bytes: new ArrayBuffer(4) } }"#,
            "invalid post: a batch's ops must be a list",
        ),
        (
            r#"{ type: "frame", gpu: { ops: [], bytes: [1, 2, 3] } }"#,
            "invalid post: a batch's bytes must be an ArrayBuffer",
        ),
        (
            r#"{ type: "gpu", ops: [], bytes: new Float32Array(1) }"#,
            "invalid post: a batch's bytes must be an ArrayBuffer",
        ),
        (
            r#"{ type: "gpu", ops: [] }"#,
            "invalid post: a batch's bytes must be an ArrayBuffer",
        ),
    ] {
        let e = error_of(src, encode_post);
        let kind = match () {
            _ if src.contains("\"draw\"") => INVALID_DRAW,
            _ if src.contains("gpu") => INVALID_GPU,
            _ => INVALID_DATA,
        };
        assert!(e.message.contains(why) && e.kind == kind, "{src}: {e}");
    }
    // The limits on ops and bytes are the host checks' (`widget-gpu`), not the encoder's.
    let (enc, _) = run(
        "__emit({ type: 'gpu', ops: Array.from({ length: 20001 }, () => ['end']), bytes: new ArrayBuffer(4 * 1024 * 1024 + 4) })\nreturn null",
        encode_post,
    );
    // It encodes; a decoder holds a message to its own bounds.
    let bytes = enc[0].as_ref().expect("encodes");
    assert!(
        matches!(decode_post(bytes), Err(DecodeError::Malformed(_))),
        "{:?}",
        decode_post(bytes)
    );
}

/// A GPU op's numbers are read as they are, `NaN` and infinities too (`widgets-gpu.md`, Transport); JSON can't hold
/// them, so this is the binary alone.
#[test]
fn a_gpu_ops_non_finite_numbers_stay_numbers() {
    let (enc, _) = run(
        "__emit({ type: 'gpu', ops: [['x', NaN, Infinity, -Infinity, [undefined, NaN], { a: undefined, b: -Infinity }]], bytes: new ArrayBuffer(0) })\nreturn null",
        encode_post,
    );
    let Post::Gpu(b) = decode_post(enc[0].as_ref().unwrap()).unwrap() else {
        panic!()
    };
    let Arg::List(op) = &b.ops[0] else { panic!() };
    let num = |a: &Arg| match a {
        Arg::Num(n) => *n,
        a => panic!("{a:?}"),
    };
    assert!(num(&op[1]).is_nan());
    assert_eq!(
        (num(&op[2]), num(&op[3])),
        (f64::INFINITY, f64::NEG_INFINITY)
    );
    let Arg::List(l) = &op[4] else { panic!() };
    assert!(matches!(l[0], Arg::Null) && num(&l[1]).is_nan());
    assert!(
        matches!(&op[5], Arg::Obj(o) if o.len() == 1 && o[0].0 == "b" && num(&o[0].1) == f64::NEG_INFINITY)
    );
}

#[test]
fn optional_props_of_the_wrong_shape_are_left_out() {
    // The JSON path fails these views; the encoder leaves the props out (`widgets-binary.md`, Rules for the encoder),
    // so the client sees the defaults.
    let (enc, _) = run(
        r#"__emit({ state: 0, view: { type: "column", gap: "wide", align: 3, children: [
             { type: "slider", id: "s", label: 5, value: 1, min: 0, max: 2, step: NaN },
             { type: "image", src: "a", aspect: Infinity, alt: null },
             { type: "text", text: "t", tone: "loud", place: "middle", inset: { top: "x" } },
             { type: "canvas", height: 10, values: [1, NaN], wgsl: "w" },
             "a string child", 7, true,
           ] } })
           return null"#,
        encode_output,
    );
    let Output::Step(s) = decode_output(enc[0].as_ref().unwrap()).unwrap() else {
        panic!()
    };
    assert_eq!(
        s.view.children()[..4],
        [
            Node::Slider {
                id: "s".into(),
                label: None,
                value: 1.0,
                min: 0.0,
                max: 2.0,
                step: None
            },
            Node::Image {
                src: "a".into(),
                alt: None,
                aspect: None
            },
            Node::Text {
                text: "t".into(),
                style: Default::default(),
                tone: Default::default()
            },
            Node::Canvas {
                id: None,
                height: 10.0,
                width: None,
                fps: None,
                duration: None,
                alt: None,
                poster: None,
                wgsl: Some("w".into()),
                values: vec![],
                pointer: false,
                gpu: false,
                fill: None,
                fullscreen: None,
                capture: None,
            },
        ]
    );
    assert!(s.view.children()[4..].iter().all(|n| *n == Node::Unknown));
    // A select whose options lack a label has none: a required prop missing, a program error either way.
    let (enc, _) = run(
        r#"__emit({ state: 0, view: { type: "select", id: "x", options: [{ value: "a" }] } })
           return null"#,
        encode_output,
    );
    assert!(
        matches!(decode_output(enc[0].as_ref().unwrap()), Err(DecodeError::Invalid(e)) if e.contains("options"))
    );
}

#[test]
fn malformed_bytes_are_malformed_never_a_panic() {
    let (outputs, _) = run(
        &format!("__emit({EVERY_NODE})\n__emit({{ commands: {EVERY_COMMAND} }})\nreturn null"),
        encode_output,
    );
    let (posts, _) = run(
        r#"for (const m of [
             { type: "render", node: { type: "column", children: [{ type: "text", text: "x" }, { type: "select", id: "s", options: [{ value: "a", label: "A", description: "d" }], value: ["a"] }] } },
             { type: "frame", gpu: { ops: [["pass", { a: [1, "x", null, true] }]], bytes: new Float32Array([1, 2]).buffer } },
             { type: "send", value: { a: 1 }, wake: false },
           ]) __emit(m)
           return null"#,
        encode_post,
    );
    let outputs: Vec<Vec<u8>> = outputs.into_iter().map(Result::unwrap).collect();
    let posts: Vec<Vec<u8>> = posts.into_iter().map(Result::unwrap).collect();
    type Decodes = fn(&[u8]) -> bool;
    let decoders: [(&[Vec<u8>], Decodes); 2] = [
        (&outputs, |b| decode_output(b).is_ok()),
        (&posts, |b| decode_post(b).is_ok()),
    ];
    let mut seed = 0x2545_f491_4f6c_dd1du64;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    for (messages, ok) in decoders {
        for m in messages {
            assert!(ok(m));
            // Every truncation, and a byte past the end.
            for n in 0..m.len() {
                assert!(!ok(&m[..n]), "a {n}-byte prefix of {} decoded", m.len());
            }
            let mut longer = m.clone();
            longer.push(0);
            assert!(!ok(&longer));
            // Another version.
            let mut v2 = m.clone();
            v2[0] = 2;
            assert!(!ok(&v2));
            // Random corruption: any result but a panic.
            for _ in 0..20_000 {
                let mut c = m.clone();
                for _ in 0..1 + random() % 4 {
                    let i = (random() as usize) % c.len();
                    c[i] = random() as u8;
                }
                let _ = ok(&c);
            }
        }
    }
    // Nesting past the bound: 101 columns, each with one child.
    let mut ints = Vec::new();
    for _ in 0..101 {
        ints.extend([1, 0, 1]);
    }
    ints.extend([13, 0]);
    let render = |ints: &[u8]| {
        let n = ints.len();
        [
            &[1u8, 1, b'N', (n as u8) | 0x80, (n >> 7) as u8, 0, 0][..],
            ints,
        ]
        .concat()
    };
    assert!(
        matches!(decode_post(&render(&ints)), Err(DecodeError::Malformed(e)) if e.contains("deeper than 100"))
    );
    assert!(decode_post(&render(&ints[3..])).is_ok());
    // Huge counts don't allocate their size.
    for b in [
        vec![1, 1, b'N', 0xff, 0xff, 0xff, 0xff, 0x0f, 0, 0],
        vec![
            1, b'D', 1, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0, 0, 0, 0,
        ],
        vec![1, 9, b'G', 6, 0, 0, 0, 0xff, 0xff, 0xff, 0xff, 0x0f, 0],
    ] {
        let post = decode_post(&b).map(|_| ());
        let output = decode_output(&b).map(|_| ());
        assert!(
            matches!(post, Err(DecodeError::Malformed(_)))
                && matches!(output, Err(DecodeError::Malformed(_)))
        );
    }
}
