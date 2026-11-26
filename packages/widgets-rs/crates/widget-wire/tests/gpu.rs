//! GPU canvases in the wire (`widgets-gpu.md`, `widgets-binary.md` prop 38) and GPU batches in live posts: a host
//! that replays them itself ([`GpuHost`]) gets them in the order the program posted them, never ahead of a waiting
//! `render` or `draw` (`widgets-live.md`, Post rate), with the batch-shape failures made as the value is converted;
//! without one, they are dropped.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use psychoscript::{HostValue, TypedArray, TypedKind};
use serde_json::json;
use widget_wire::{
    Arg, CallError, DecodeError, GpuHost, LivePosts, Node, Post, decode_post, encode_post,
};

fn host(v: serde_json::Value) -> HostValue {
    HostValue::from_json(&v)
}

fn with(mut m: HostValue, key: &str, v: HostValue) -> HostValue {
    if let HostValue::Object(fields) = &mut m {
        fields.push((key.into(), v));
    }
    m
}

fn buffer(bytes: &[u8]) -> HostValue {
    HostValue::TypedArray(TypedArray::new(TypedKind::ArrayBuffer, bytes.to_vec()).unwrap())
}

/// A `gpu` post of one `buffer` op with handle `h` and `bytes`.
fn gpu(h: u32, bytes: &[u8]) -> HostValue {
    with(
        host(json!({ "type": "gpu", "ops": [["buffer", h, 16, 40]] })),
        "bytes",
        buffer(bytes),
    )
}

/// A frame request carrying that batch.
fn frame_gpu(h: u32, bytes: &[u8]) -> HostValue {
    let batch = with(
        host(json!({ "ops": [["buffer", h, 16, 40]] })),
        "bytes",
        buffer(bytes),
    );
    with(host(json!({ "type": "frame" })), "gpu", batch)
}

fn render(text: &str, gpu: &[&str]) -> HostValue {
    let mut children = vec![json!({ "type": "text", "text": text })];
    children.extend(
        gpu.iter()
            .map(|k| json!({ "type": "canvas", "key": k, "gpu": true, "height": 10 })),
    );
    host(json!({ "type": "render", "node": { "type": "column", "children": children } }))
}

/// A batch's first op's handle.
fn handle(ops: &[Arg]) -> String {
    match ops.first() {
        Some(Arg::List(op)) => match op.get(1) {
            Some(Arg::Num(h)) => format!("{h}"),
            _ => "?".into(),
        },
        _ => "none".into(),
    }
}

/// What the GPU host got, readably.
#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<String>>>);

impl Log {
    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().unwrap())
    }
}

impl GpuHost for Log {
    fn batch(&mut self, ops: &[Arg], bytes: &[u8]) {
        let handle = handle(ops);
        self.0
            .lock()
            .unwrap()
            .push(format!("batch {handle} {bytes:?}"));
    }
    fn shape_error(&mut self, ops: Option<&[Arg]>, message: String) {
        // `-`: the ops weren't a list.
        let handle = ops.map_or("-".into(), handle);
        self.0
            .lock()
            .unwrap()
            .push(format!("batch {handle} error: {message}"));
    }
    fn end_frame(&mut self) {
        self.0.lock().unwrap().push("end frame".into());
    }
    fn canvases(&mut self, keys: &[String]) {
        self.0
            .lock()
            .unwrap()
            .push(format!("canvases {}", keys.join(",")));
    }
    fn resize(&mut self, key: &str, width: u32, height: u32) {
        self.0
            .lock()
            .unwrap()
            .push(format!("resize {key} {width}x{height}"));
    }
}

fn posts(rate: f64) -> (LivePosts, Log) {
    let log = Log::default();
    let mut posts = LivePosts::with_rate(rate);
    posts.set_gpu(Box::new(log.clone()));
    (posts, log)
}

/// What the client got, readably.
fn read(bytes: &[Vec<u8>]) -> Vec<String> {
    bytes
        .iter()
        .map(|b| match decode_post(b).unwrap() {
            Post::Render(n) => match &n.children()[0] {
                Node::Text { text, .. } => text.clone(),
                _ => panic!(),
            },
            p => format!("{p:?}"),
        })
        .collect()
}

#[test]
fn a_gpu_canvas_crosses_as_prop_38_and_excludes_wgsl() {
    let bytes = encode_post(&render("t", &["scene"])).unwrap();
    let Post::Render(n) = decode_post(&bytes).unwrap() else {
        panic!()
    };
    assert!(matches!(&n.children()[1], Node::Canvas { gpu: true, .. }));
    let both = host(
        json!({ "type": "render", "node": { "type": "canvas", "gpu": true, "wgsl": "x", "height": 1 } }),
    );
    let bytes = encode_post(&both).unwrap();
    assert_eq!(
        decode_post(&bytes),
        Err(DecodeError::Invalid(
            "invalid view: a canvas's `gpu` and `wgsl` exclude each other".into()
        ))
    );
    let json =
        Node::from_value(&json!({ "type": "canvas", "gpu": true, "wgsl": "x", "height": 1 }));
    assert!(
        json.unwrap_err()
            .contains("`gpu` and `wgsl` exclude each other")
    );
}

#[test]
fn a_draw_to_a_gpu_canvas_throws() {
    let mut posts = LivePosts::new();
    posts
        .post(&render("t", &["scene"]), Instant::now())
        .unwrap();
    let draw = host(json!({ "type": "draw", "key": "scene", "commands": [] }));
    let Err(CallError::Throw(m)) = posts.post(&draw, Instant::now()) else {
        panic!()
    };
    assert_eq!(
        m,
        "Canvas \"scene\" is drawn by the GPU; it takes no draw commands"
    );
}

#[test]
fn batches_apply_at_once_when_nothing_waits() {
    let t = Instant::now();
    let (mut posts, log) = posts(240.0);
    let out = posts.post(&render("r", &["scene"]), t).unwrap().0;
    assert_eq!(read(&out), ["r"]);
    assert_eq!(log.take(), ["canvases scene"]);
    // A standalone batch; a frame request carrying one goes to the client without it, after `end_frame`.
    assert!(posts.post(&gpu(1, &[1, 2]), t).unwrap().0.is_empty());
    assert_eq!(
        read(&posts.post(&frame_gpu(2, &[3]), t).unwrap().0),
        ["Frame"]
    );
    assert_eq!(log.take(), ["batch 1 [1, 2]", "batch 2 [3]", "end frame"]);
    // One while it is pending: its batch, nothing else; once a frame came, a bare one ends the frame too.
    assert!(posts.post(&frame_gpu(3, &[]), t).unwrap().0.is_empty());
    assert!(
        posts
            .post(&host(json!({ "type": "frame" })), t)
            .unwrap()
            .0
            .is_empty()
    );
    assert_eq!(log.take(), ["batch 3 []"]);
    posts.delivered(&host(json!({ "type": "frame", "frame": {} })));
    assert_eq!(
        read(&posts.post(&host(json!({ "type": "frame" })), t).unwrap().0),
        ["Frame"]
    );
    assert_eq!(log.take(), ["end frame"]);
    // The same canvases again aren't given again; a size the program received is.
    posts.post(&render("r2", &["scene"]), t).unwrap();
    assert!(
        posts
            .received(&host(
                json!({ "type": "canvas", "key": "scene", "width": 600, "height": 400 })
            ))
            .is_empty()
    );
    assert!(
        posts
            .received(&host(json!({ "type": "event", "event": {} })))
            .is_empty()
    );
    assert_eq!(log.take(), ["resize scene 600x400"]);
}

#[test]
fn batches_wait_behind_counted_posts_and_keep_their_order() {
    // At 10 a second: 8 renders at once, the 9th waits.
    let t0 = Instant::now();
    let (mut posts, log) = posts(10.0);
    let mut out = Vec::new();
    for n in 0..9 {
        out.extend(
            posts
                .post(&render(&format!("r{n}"), &["scene"]), t0)
                .unwrap()
                .0,
        );
    }
    assert_eq!(read(&out).len(), 8);
    assert_eq!(log.take(), ["canvases scene"]);
    // A batch, a frame request carrying one, then a size and a bare frame request behind them: nothing yet but the
    // bare request itself (the frame it ends waits).
    assert!(posts.post(&gpu(1, &[1]), t0).unwrap().0.is_empty());
    assert!(posts.post(&frame_gpu(2, &[2]), t0).unwrap().0.is_empty());
    posts.received(&host(
        json!({ "type": "canvas", "key": "scene", "width": 10, "height": 20 }),
    ));
    posts.delivered(&host(json!({ "type": "frame", "frame": {} })));
    assert_eq!(
        read(&posts.post(&host(json!({ "type": "frame" })), t0).unwrap().0),
        ["Frame"]
    );
    assert!(log.take().is_empty());
    // A newer render takes the waiting one's place, ahead of the batches; they follow it as it goes.
    assert!(
        posts
            .post(&render("r9", &["scene", "hud"]), t0)
            .unwrap()
            .0
            .is_empty()
    );
    assert_eq!(posts.next_due(), Some(t0 + Duration::from_millis(100)));
    let out = posts.due(t0 + Duration::from_millis(100));
    assert_eq!(read(&out), ["r9", "Frame"]);
    assert_eq!(
        log.take(),
        [
            "batch 1 [1]",
            "batch 2 [2]",
            "end frame",
            "resize scene 10x20",
            "end frame",
            "canvases scene,hud"
        ]
    );
    assert_eq!(posts.next_due(), None);
}

#[test]
fn the_run_ending_releases_the_waiting_batches_in_order() {
    let t = Instant::now();
    let (mut posts, log) = posts(10.0);
    for n in 0..9 {
        posts.post(&render(&format!("r{n}"), &[]), t).unwrap();
    }
    posts.post(&gpu(1, &[]), t).unwrap();
    let out = posts
        .post(&host(json!({ "type": "submit", "value": 1 })), t)
        .unwrap()
        .0;
    assert_eq!(read(&out), ["r8", "Submit(Number(1))"]);
    assert_eq!(log.take(), ["batch 1 []"]);
}

#[test]
fn a_batch_of_the_wrong_shape_fails_as_it_is_converted() {
    let t = Instant::now();
    let (mut posts, log) = posts(240.0);
    let typed = HostValue::TypedArray(TypedArray::from_f32(&[1.0]));
    for post in [
        host(json!({ "type": "frame", "gpu": 5 })),
        host(json!({ "type": "gpu", "ops": { "op": 1 } })),
        host(json!({ "type": "gpu", "ops": [["buffer", 7, 16, 40]] })),
        with(
            host(json!({ "type": "gpu", "ops": [["buffer", 8, 16, 40]] })),
            "bytes",
            typed,
        ),
        with(
            host(json!({ "type": "gpu", "ops": [["buffer", 9, 16, 40]] })),
            "bytes",
            HostValue::Bytes(vec![1]),
        ),
    ] {
        posts.post(&post, t).unwrap();
        posts.delivered(&host(json!({ "type": "frame", "frame": {} })));
    }
    assert_eq!(
        log.take(),
        [
            "batch - error: a batch must be an object",
            "end frame",
            "batch - error: a batch's ops must be a list",
            "batch 7 error: a batch's bytes must be an ArrayBuffer",
            "batch 8 error: a batch's bytes must be an ArrayBuffer",
            "batch 9 error: a batch's bytes must be an ArrayBuffer",
        ]
    );
}

#[test]
fn without_a_gpu_host_batches_are_dropped() {
    // No GPU here (the program gets `gpu.available` false and posts none): a batch never reaches the client, a frame
    // request carrying one still does.
    let t = Instant::now();
    let mut posts = LivePosts::new();
    assert!(posts.post(&gpu(1, &[1]), t).unwrap().0.is_empty());
    assert_eq!(
        read(&posts.post(&frame_gpu(2, &[2]), t).unwrap().0),
        ["Frame"]
    );
    assert!(
        posts
            .post(&host(json!({ "type": "gpu", "ops": 5 })), t)
            .unwrap()
            .0
            .is_empty()
    );
}
