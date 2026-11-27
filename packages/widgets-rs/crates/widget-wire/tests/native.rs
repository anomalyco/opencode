//! Native tree building against the conformance fixtures (`packages/widget/test/fixtures/wire`, widget protocol 2,
//! read in place): each fixture's `built` view (the view as emitted, functions as `"$function"`)
//! walked as it is encoded gives exactly the bytes of its `view`, its `handlers` and its `canvases`, or its `error`.
//! (widget-mobile's `wire` tests run the same fixtures through the VM.)

use std::collections::{BTreeMap, BTreeSet};

use serde::Deserialize;
use std::time::{Duration, Instant};

fn now() -> Instant {
    Instant::now()
}

use psychoscript::{Data, HostValue};
use serde_json::{Value, json};
use widget_wire::{
    CallError, DEEP, DRAW_KEY, KEY, LivePosts, NativeStep, Post, decode_output, decode_post,
    encode_output, encode_post,
};

fn fixtures() -> Vec<(String, Value)> {
    let dir = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../widget/test/fixtures/wire"
    );
    let mut list: Vec<_> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().path())
        .map(|p| {
            // Views nest up to 150 levels (`depth-150`): read without serde_json's recursion limit.
            let text = std::fs::read_to_string(&p).unwrap();
            let mut reader = serde_json::Deserializer::from_str(&text);
            reader.disable_recursion_limit();
            let v = Value::deserialize(&mut reader).unwrap();
            (p.file_stem().unwrap().to_string_lossy().into_owned(), v)
        })
        .collect();
    list.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(list.len(), 59);
    list
}

/// A fixture's `built`, as the host gets it: `"$function"` a marker, `"$NaN"` and `"$±Infinity"` numbers.
fn built(v: &Value) -> HostValue {
    match v {
        Value::String(s) if s == "$function" => HostValue::FunctionMarker,
        Value::String(s) if s == "$NaN" => HostValue::Number(f64::NAN),
        Value::String(s) if s == "$Infinity" => HostValue::Number(f64::INFINITY),
        Value::String(s) if s == "$-Infinity" => HostValue::Number(f64::NEG_INFINITY),
        Value::Array(a) => HostValue::Array(a.iter().map(|i| Some(built(i))).collect()),
        Value::Object(o) => HostValue::Object(
            o.iter()
                .map(|(k, v)| (k.as_str().into(), built(v)))
                .collect(),
        ),
        v => HostValue::from_json(v),
    }
}

fn host(v: &Value) -> HostValue {
    HostValue::from_json(v)
}

fn ids(v: &Value) -> BTreeSet<String> {
    v.as_object().unwrap().keys().cloned().collect()
}

#[test]
fn steps_encode_the_fixtures() {
    let mut checked = 0;
    for (name, f) in fixtures() {
        let Some(view) = f.get("built") else { continue };
        let mut step = NativeStep::default();
        let emitted = step.emit(&[built(view)]);
        match f.get("error") {
            Some(e) if e["view"] == true => {
                assert_eq!(emitted, Ok(()), "{name}");
                assert_eq!(step.failure(), e["message"].as_str(), "{name}");
            }
            Some(e)
                if e["message"]
                    .as_str()
                    .unwrap()
                    .contains("contains a function") =>
            {
                assert_eq!(emitted, Err(CallError::Function { arg: 1 }), "{name}");
            }
            // A failure of the run's result (`typed-array-in-state`): the view is fine.
            Some(_) => assert_eq!((emitted, step.failure()), (Ok(()), None), "{name}"),
            None => {
                assert_eq!((emitted, step.failure()), (Ok(()), None), "{name}");
                // The view's bytes exactly; the JSON (written by psychoscript) as the same values.
                let result = Data::from_json(&f["result"]);
                let bytes = step.finish(&result).unwrap();
                let view =
                    encode_post(&host(&json!({ "type": "render", "node": f["view"] }))).unwrap();
                assert!(bytes.ends_with(&view[2..]), "{name}");
                let mut whole = f["result"].clone();
                whole["view"] = f["view"].clone();
                assert_eq!(
                    decode_output(&bytes).unwrap(),
                    decode_output(&encode_output(&host(&whole)).unwrap()).unwrap(),
                    "{name}"
                );
            }
        }
        checked += 1;
    }
    assert_eq!(checked, 58);
}

#[test]
fn renders_find_the_fixtures_handlers_and_canvases() {
    for (name, f) in fixtures() {
        let (Some(view), None) = (f.get("built"), f.get("error")) else {
            continue;
        };
        let mut posts = LivePosts::new();
        let render = HostValue::Object(vec![
            ("type".into(), "render".into()),
            ("node".into(), built(view)),
        ]);
        let (bytes, handled) = posts.post(&render, now()).unwrap();
        let render_bytes =
            encode_post(&host(&json!({ "type": "render", "node": f["view"] }))).unwrap();
        assert_eq!(bytes, std::slice::from_ref(&render_bytes), "{name}");
        let handlers = ids(&f["handlers"]);
        assert_eq!(handled, Some(!handlers.is_empty()), "{name}");
        let found: BTreeMap<String, String> = posts
            .last_render()
            .handlers
            .iter()
            .map(|(id, event)| (id.clone(), event.to_string()))
            .collect();
        let expected: BTreeMap<String, String> = f["handlers"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        assert_eq!(found, expected, "{name}");
        let canvases: BTreeMap<String, String> = posts
            .last_render()
            .canvases
            .iter()
            .map(|c| (c.key.clone(), c.id.clone()))
            .collect();
        let expected: BTreeMap<String, String> = f["canvases"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
            .collect();
        assert_eq!(canvases, expected, "{name}");

        // Waiting for a token, a render is walked and checked at once; it goes out when the run ends.
        let mut busy = LivePosts::new();
        let text = host(&json!({ "type": "render", "node": { "type": "text", "text": "t" } }));
        let t = now();
        for _ in 0..8 {
            assert_eq!(busy.post(&text, t).unwrap().0.len(), 1);
        }
        assert_eq!(busy.post(&render, t).unwrap(), (vec![], handled));
        assert_eq!(busy.last_render(), posts.last_render());
        assert_eq!(busy.release(), [render_bytes], "{name}");
    }
}

/// A column nesting `levels` levels: columns, each the only child of the one above, `arrays` of them as arrays.
fn deep(levels: usize, arrays: bool) -> HostValue {
    let mut v = HostValue::from_json(&json!({ "type": "button", "label": "b", "onPress": null }));
    if let HostValue::Object(f) = &mut v {
        f[2].1 = HostValue::FunctionMarker;
    }
    for _ in 1..levels {
        v = if arrays {
            HostValue::Array(vec![Some(v)])
        } else {
            HostValue::Object(vec![
                ("type".into(), "column".into()),
                ("children".into(), HostValue::Array(vec![Some(v)])),
            ])
        };
    }
    if arrays {
        HostValue::Object(vec![
            ("type".into(), "column".into()),
            ("children".into(), v),
        ])
    } else {
        v
    }
}

#[test]
fn views_nest_at_most_100_levels() {
    for (levels, arrays, fails) in [
        (100, false, false),
        (101, false, true),
        (100, true, false),
        (101, true, true),
    ] {
        let mut step = NativeStep::default();
        step.emit(&[deep(levels, arrays)]).unwrap();
        assert_eq!(step.failure(), fails.then_some(DEEP), "{levels} {arrays}");
        let mut posts = LivePosts::new();
        let render = HostValue::Object(vec![
            ("type".into(), "render".into()),
            ("node".into(), deep(levels, arrays)),
        ]);
        let r = posts.post(&render, now());
        if fails {
            assert_eq!(r, Err(CallError::View(DEEP.into())));
        } else {
            assert_eq!(r.unwrap().1, Some(true));
        }
    }
    // A string below level 100 doesn't count; the check comes before the key's.
    let s = |levels| {
        let mut v = HostValue::from_json(&json!(["text"]));
        let mut key =
            HostValue::from_json(&json!({ "type": "column", "key": [1], "children": [] }));
        for _ in 1..levels {
            v = HostValue::Object(vec![
                ("type".into(), "column".into()),
                ("children".into(), v),
            ]);
            key = HostValue::Object(vec![
                ("type".into(), "column".into()),
                ("children".into(), HostValue::Array(vec![Some(key)])),
            ]);
        }
        (v, key)
    };
    let (text, key) = s(101);
    let mut step = NativeStep::default();
    step.emit(&[text]).unwrap();
    assert_eq!(step.failure(), None);
    step.emit(&[key]).unwrap();
    assert_eq!(step.failure(), Some(DEEP));
    let (_, key) = s(100);
    step.emit(&[key]).unwrap();
    assert_eq!(step.failure(), Some(KEY));
}

#[test]
fn the_prelude_can_say_the_view_fails() {
    let mut step = NativeStep::default();
    step.emit(&[HostValue::Null, DEEP.into()]).unwrap();
    assert_eq!(step.failure(), Some(DEEP));
    assert_eq!(
        step.emit(&[HostValue::Null, HostValue::FunctionMarker]),
        Err(CallError::Function { arg: 2 })
    );
    let mut posts = LivePosts::new();
    let failed = HostValue::Object(vec![
        ("type".into(), "render".into()),
        ("node".into(), HostValue::Null),
        ("failure".into(), DEEP.into()),
    ]);
    assert_eq!(
        posts.post(&failed, now()),
        Err(CallError::View(DEEP.into()))
    );
}

#[test]
fn functions_fail_posts_where_none_may_go() {
    let mut posts = LivePosts::new();
    let with = |json: Value, path: &[&str]| {
        let mut v = host(&json);
        let mut at = &mut v;
        for k in path {
            let HostValue::Object(f) = at else { panic!() };
            at = &mut f.iter_mut().find(|(n, _)| n == *k).unwrap().1;
        }
        *at = HostValue::FunctionMarker;
        v
    };
    for (m, path) in [
        (
            json!({ "type": "submit", "value": { "a": 0 } }),
            &["value", "a"][..],
        ),
        (json!({ "type": "send", "value": 0 }), &["value"][..]),
        (
            json!({ "type": "frame", "gpu": { "ops": [], "x": 0 } }),
            &["gpu", "x"][..],
        ),
        (
            json!({ "type": "render", "node": { "type": "text", "text": "t" }, "extra": 0 }),
            &["extra"][..],
        ),
        (
            json!({ "type": "render", "node": { "type": "text", "text": "t", "extra": { "deep": 0 } } }),
            &["node", "extra", "deep"][..],
        ),
        (
            json!({ "type": "render", "node": { "type": "button", "label": "b", "id": 0 } }),
            &["node", "id"][..],
        ),
    ] {
        assert_eq!(
            posts.post(&with(m.clone(), path), now()),
            Err(CallError::Function { arg: 1 }),
            "{m}"
        );
    }
    // Handler props of any node may hold one; a marker key is a key of another type.
    let ok = with(
        json!({ "type": "render", "node": { "type": "text", "text": "t", "onChange": 0 } }),
        &["node", "onChange"],
    );
    assert_eq!(posts.post(&ok, now()).unwrap().1, Some(false));
    let key = with(
        json!({ "type": "render", "node": { "type": "text", "text": "t", "key": 0 } }),
        &["node", "key"],
    );
    assert_eq!(posts.post(&key, now()), Err(CallError::View(KEY.into())));
}

#[test]
fn draws_name_their_canvas_by_key() {
    let mut posts = LivePosts::new();
    let node = json!({ "type": "column", "children": [
        { "type": "canvas", "key": "chart", "height": 10 },
        { "type": "canvas", "key": 7, "height": 10 },
        { "type": "canvas", "key": "shader", "height": 10, "wgsl": "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }" },
        { "type": "canvas", "key": "chart", "height": 10 },
    ] });
    let (_, handled) = posts
        .post(&host(&json!({ "type": "render", "node": node })), now())
        .unwrap();
    assert_eq!(handled, Some(false));
    let commands = json!([["rect", 0, 0, 1, 1, { "fill": "accent" }]]);
    for (key, id) in [(json!("chart"), "0/:chart"), (json!("7"), "0/:7")] {
        let (bytes, ret) = posts
            .post(
                &host(&json!({ "type": "draw", "key": key, "commands": commands })),
                now(),
            )
            .unwrap();
        let expected = encode_post(&host(
            &json!({ "type": "draw", "id": id, "commands": commands }),
        ))
        .unwrap();
        assert_eq!((bytes, ret), (vec![expected], None));
    }
    assert_eq!(
        posts.post(
            &host(&json!({ "type": "draw", "key": "nope", "commands": [] })),
            now()
        ),
        Err(CallError::Throw(
            "No canvas with key \"nope\" in the rendered view".into()
        ))
    );
    assert_eq!(
        posts.post(
            &host(&json!({ "type": "draw", "key": "shader", "commands": [] })),
            now()
        ),
        Err(CallError::Throw(
            "Canvas \"shader\" is drawn by its wgsl; it takes no draw commands".into()
        ))
    );
    let Err(CallError::Invalid(e)) = posts.post(
        &host(&json!({ "type": "draw", "key": "chart", "commands": [["blur"]] })),
        now(),
    ) else {
        panic!()
    };
    assert_eq!(e.kind, "InvalidDraw");
    // A draw without a string key is an invalid post (phase `main`).
    for key in [json!(7), json!(null)] {
        let Err(CallError::End(e)) = posts.post(
            &host(&json!({ "type": "draw", "key": key, "commands": [] })),
            now(),
        ) else {
            panic!()
        };
        assert_eq!((e.kind, e.message.as_str()), ("InvalidDataValue", DRAW_KEY));
    }
    let Err(CallError::End(e)) = posts.post(
        &host(&json!({ "type": "draw", "id": "0/:chart", "commands": [] })),
        now(),
    ) else {
        panic!()
    };
    assert_eq!(e.message, DRAW_KEY);
    let (bytes, ret) = posts
        .post(&host(&json!({ "type": "frame" })), now())
        .unwrap();
    assert_eq!((decode_post(&bytes[0]).unwrap(), ret), (Post::Frame, None));
    posts
        .post(
            &host(&json!({ "type": "render", "node": { "type": "text", "text": "t" } })),
            now(),
        )
        .unwrap();
    assert!(matches!(
        posts.post(
            &host(&json!({ "type": "draw", "key": "chart", "commands": [] })),
            now()
        ),
        Err(CallError::Throw(_))
    ));
}

#[test]
fn keys_are_written_as_javascript_writes_them() {
    let keys = [
        HostValue::Number(1.5),
        HostValue::Number(-12.25),
        HostValue::Number(1e21),
        HostValue::Number(1e-7),
        HostValue::Number(0.30000000000000004),
        HostValue::Number(123456789012345680000.0),
        HostValue::Number(-0.0),
        HostValue::Number(1e-6),
        HostValue::Number(5e-324),
        HostValue::Number(1.7976931348623157e308),
        HostValue::Number(1e20),
        HostValue::Number(f64::NAN),
        HostValue::Number(f64::INFINITY),
        HostValue::Number(f64::NEG_INFINITY),
        HostValue::Bool(true),
        HostValue::Bool(false),
        "a b/é~*'()!".into(),
        "k~2".into(),
    ];
    let expected = [
        ":1.5",
        ":-12.25",
        ":1e%2B21",
        ":1e-7",
        ":0.30000000000000004",
        ":123456789012345680000",
        ":0",
        ":0.000001",
        ":5e-324",
        ":1.7976931348623157e%2B308",
        ":100000000000000000000",
        ":NaN",
        ":Infinity",
        ":-Infinity",
        ":true",
        ":false",
        ":a%20b%2F%C3%A9~*'()!",
        ":k~2",
    ];
    let children = keys
        .into_iter()
        .map(|k| {
            Some(HostValue::Object(vec![
                ("type".into(), "button".into()),
                ("key".into(), k),
                ("label".into(), "b".into()),
            ]))
        })
        .collect();
    let node = HostValue::Object(vec![
        ("type".into(), "row".into()),
        ("children".into(), HostValue::Array(children)),
    ]);
    let render = HostValue::Object(vec![
        ("type".into(), "render".into()),
        ("node".into(), node),
    ]);
    let (bytes, _) = LivePosts::new().post(&render, now()).unwrap();
    let Post::Render(widget_wire::Node::Row { children, .. }) = decode_post(&bytes[0]).unwrap()
    else {
        panic!()
    };
    let ids: Vec<String> = children
        .iter()
        .map(|c| match c {
            widget_wire::Node::Button { id, .. } => id.clone(),
            _ => panic!(),
        })
        .collect();
    let expected: Vec<String> = expected.iter().map(|s| format!("0/{s}")).collect();
    assert_eq!(ids, expected);
}

/// A render of text `n` over canvases `a` and `b`.
fn frame_render(n: usize) -> HostValue {
    host(
        &json!({ "type": "render", "node": { "type": "column", "children": [
        { "type": "text", "text": format!("r{n}") },
        { "type": "canvas", "key": "a", "height": 1 },
        { "type": "canvas", "key": "b", "height": 1 },
    ] } }),
    )
}

fn draw(key: &str, n: usize) -> HostValue {
    host(&json!({ "type": "draw", "key": key, "commands": [["translate", n, 0]] }))
}

/// What the client got, readably: `r<n>` for a render, `<key><n>` for a draw, else the post kind.
fn read(bytes: &[Vec<u8>]) -> Vec<String> {
    bytes
        .iter()
        .map(|b| match decode_post(b).unwrap() {
            Post::Render(n) => match &n.children()[0] {
                widget_wire::Node::Text { text, .. } => text.clone(),
                _ => panic!(),
            },
            Post::Draw { id, commands } => {
                let widget_wire::Command::Translate(n, _) = commands[0] else {
                    panic!()
                };
                format!("{}{n}", &id[id.len() - 1..])
            }
            p => format!("{p:?}"),
        })
        .collect()
}

#[test]
fn a_burst_of_renders_coalesces_and_the_last_goes_out_in_time_or_at_the_end() {
    // 30 renders at 10/s: 8 at once, then render 29 alone after 100 ms.
    let t0 = Instant::now();
    let mut posts = LivePosts::with_rate(10.0);
    let mut out = Vec::new();
    for n in 0..30 {
        out.extend(posts.post(&frame_render(n), t0).unwrap().0);
    }
    assert_eq!(
        read(&out),
        (0..8).map(|n| format!("r{n}")).collect::<Vec<_>>()
    );
    assert!(posts.due(t0 + Duration::from_millis(99)).is_empty());
    assert_eq!(posts.next_due(), Some(t0 + Duration::from_millis(100)));
    assert_eq!(read(&posts.due(t0 + Duration::from_millis(100))), ["r29"]);
    assert_eq!(posts.next_due(), None);

    // With a submit straight after the burst: 8 renders, render 29, then the submit.
    let mut posts = LivePosts::with_rate(10.0);
    let mut out = Vec::new();
    for n in 0..30 {
        out.extend(posts.post(&frame_render(n), t0).unwrap().0);
    }
    out.extend(
        posts
            .post(&host(&json!({ "type": "submit", "value": 1 })), t0)
            .unwrap()
            .0,
    );
    let mut expected: Vec<String> = (0..8).map(|n| format!("r{n}")).collect();
    expected.extend(["r29".into(), "Submit(Number(1))".into()]);
    assert_eq!(read(&out), expected);
}

#[test]
fn draws_coalesce_by_key_and_frame_requests_dont_wait() {
    // A render, then 20 draws on `a` and 20 on `b`, alternating, at 10/s.
    let t0 = Instant::now();
    let mut posts = LivePosts::with_rate(10.0);
    let mut out = posts.post(&frame_render(0), t0).unwrap().0;
    for n in 0..20 {
        out.extend(posts.post(&draw("a", n), t0).unwrap().0);
        out.extend(posts.post(&draw("b", n), t0).unwrap().0);
    }
    assert_eq!(read(&out), ["r0", "a0", "b0", "a1", "b1", "a2", "b2", "a3"]);
    // A frame request while they wait goes out at once; another one while it is pending changes nothing.
    let frame = host(&json!({ "type": "frame" }));
    assert_eq!(read(&posts.post(&frame, t0).unwrap().0), ["Frame"]);
    assert_eq!(posts.post(&frame, t0).unwrap().0, Vec::<Vec<u8>>::new());
    posts.delivered(&host(&json!({ "type": "frame", "frame": {} })));
    assert_eq!(read(&posts.post(&frame, t0).unwrap().0), ["Frame"]);
    // The latest `b`, then the latest `a`, 100 ms apart.
    assert_eq!(read(&posts.due(t0 + Duration::from_millis(100))), ["b19"]);
    assert_eq!(
        read(&posts.due(t0 + Duration::from_millis(150))),
        Vec::<String>::new()
    );
    assert_eq!(read(&posts.due(t0 + Duration::from_millis(200))), ["a19"]);
}

#[test]
fn a_120_hz_game_gets_every_frame_request_and_its_last_frame() {
    // Each frame a render and two draws (360 posts/s) at the spec's 240/s, over 120 frames.
    let t0 = Instant::now();
    let mut posts = LivePosts::new();
    let frame = host(&json!({ "type": "frame" }));
    let mut out = Vec::new();
    for f in 0..120 {
        let t = t0 + Duration::from_secs_f64(f as f64 / 120.0);
        posts.delivered(&host(&json!({ "type": "frame", "frame": {} })));
        out.extend(posts.due(t));
        for post in [frame_render(f), draw("a", f), draw("b", f), frame.clone()] {
            out.extend(posts.post(&post, t).unwrap().0);
        }
    }
    let during = read(&out);
    assert_eq!(during.iter().filter(|p| *p == "Frame").count(), 120);
    let counted = during.len() - 120;
    assert!(counted <= 248, "{counted}");
    let end = read(&posts.release());
    assert_eq!(end, ["r119", "a119", "b119"]);
    let last = |prefix: char| {
        during
            .iter()
            .chain(&end)
            .rfind(|p| p.starts_with(prefix))
            .cloned()
    };
    assert_eq!(
        (last('r'), last('a'), last('b')),
        (
            Some("r119".into()),
            Some("a119".into()),
            Some("b119".into())
        )
    );
}
