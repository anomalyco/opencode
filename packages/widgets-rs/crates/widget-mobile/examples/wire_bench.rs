//! The binary format (`ValueEncoder.widget()`) against JSON on the bench workloads (`tests/fixtures/workloads`),
//! host and Rust client together:
//!
//! ```sh
//! cargo run --release -p widget-mobile --example wire_bench [filter]
//! ```
//!
//! - Steps: a session holding `data` (as the README suggests); JSON is `session.run` (on `prelude-scripted.js`,
//!   protocol 1's entry, where the prelude builds the tree)
//!   and the client's `serde_json` + `StepOutput::from_value`, binary is `session.run_bytes` of a native host (the
//!   encoder builds the tree) and `widget_wire::decode_output`.
//! - Live: at most 120 frames a second (under the post rate), from delivering a frame to the program's next frame request, the posts decoded on the run's thread (JSON:
//!   `serde_json` + Rune's readers; binary: `decode_post`). `live-gpu` posts a 64 KB vertex buffer and 64 B of uniforms
//!   per frame as a GPU batch: JSON numbers (all a JSON post can carry) against the typed arrays' bytes.
//!
//! Medians in µs; Swift and Kotlin decoders aren't measured here.

use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use psychoscript_mobile::{
    GpuCanvasState, LiveExit, LiveHandler, LiveOptions, Program, RunOptions, ValueEncoder,
};
use serde_json::{Value, json};
use widget_wire::{Arg, DrawOutput, Node, StepOutput, decode_output, decode_post};

const STEP: &str = "\nreturn __widget_step(__input())";
const EMIT: &str = "\nreturn __widget_native_step(__input())";
const LIVE: &str = "\nreturn await __widget_live(__input())";
const NATIVE_LIVE: &str = "\nreturn await __widget_live(__input(), true)";

fn fixture(path: &str) -> String {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/workloads/");
    std::fs::read_to_string(format!("{dir}{path}")).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// The preludes, in place in `packages/widget`: the native one, and the scripted one the JSON path runs on.
const PRELUDE: &str = include_str!("../../../../widget/src/prelude.js");
const SCRIPTED: &str = include_str!("../../../../widget/test/fixtures/scripted-prelude.js");

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

/// Times `f` for about `budget`, after a warm-up; median µs.
fn time(budget: Duration, mut f: impl FnMut()) -> f64 {
    for _ in 0..20 {
        f();
    }
    let (start, mut samples) = (Instant::now(), Vec::new());
    while start.elapsed() < budget || samples.len() < 30 {
        let t = Instant::now();
        f();
        samples.push(t.elapsed().as_secs_f64() * 1e6);
    }
    median(samples)
}

fn change(json: f64, bin: f64) -> String {
    format!("{:+.0}%", (bin / json - 1.0) * 100.0)
}

fn steps(filter: &str) {
    let w: Value = serde_json::from_str(&fixture("workloads.json")).unwrap();
    let (prelude, scripted) = (PRELUDE.to_owned(), SCRIPTED.to_owned());
    println!(
        "| step | JSON run | JSON decode | JSON total | binary run | binary decode | binary total | change | bytes JSON → binary |"
    );
    println!("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    let budget = Duration::from_millis(1500);
    let options = RunOptions::default();
    for w in w["step"].as_array().unwrap() {
        let name = w["name"].as_str().unwrap();
        if !name.contains(filter) {
            continue;
        }
        let template = fixture(&format!("templates/{}.js", w["program"].as_str().unwrap()));
        let mut own: Value =
            serde_json::from_str(&fixture(&format!("inputs/{name}.json"))).unwrap();
        let data = own.as_object_mut().unwrap().shift_remove("data").unwrap();
        let (fields, own) = (json!({ "data": data }).to_string(), own.to_string());
        let session = |prelude: &str, tail: &str| {
            Arc::new(
                Program::new(format!("{prelude}\n{template}{tail}"), "__input".into()).unwrap(),
            )
            .session(fields.clone())
            .unwrap()
        };
        let (s_json, s_bin) = (session(&scripted, STEP), session(&prelude, EMIT));
        let encoder = widget_mobile::widget_encoder();
        let draw = w["phase"] == "draw";
        let text = s_json.run(own.clone(), options.clone()).unwrap();
        let bytes = s_bin
            .run_bytes(own.clone(), encoder.clone(), options.clone())
            .unwrap();
        let run_json = time(budget, || {
            drop(s_json.run(own.clone(), options.clone()).unwrap())
        });
        let decode_json = time(budget, || {
            let v: Value = serde_json::from_str(&text).unwrap();
            if draw {
                drop(DrawOutput::from_value(&v).unwrap())
            } else {
                drop(StepOutput::from_value(&v).unwrap())
            }
        });
        let run_bin = time(budget, || {
            drop(
                s_bin
                    .run_bytes(own.clone(), encoder.clone(), options.clone())
                    .unwrap(),
            )
        });
        let decode_bin = time(budget, || drop(decode_output(&bytes).unwrap()));
        let (tj, tb) = (run_json + decode_json, run_bin + decode_bin);
        println!(
            "| {name} | {run_json:.1} | {decode_json:.1} | {tj:.1} | {run_bin:.1} | {decode_bin:.1} | {tb:.1} | {} | {} → {} |",
            change(tj, tb),
            text.len(),
            bytes.len()
        );
    }
}

/// Decodes each wake-up's posts as the client would, and says when the program asked for a frame.
struct Client {
    frames: Mutex<Sender<usize>>,
}

fn post_kind(v: &Value) -> bool {
    match v["type"].as_str() {
        Some("render") => drop(std::hint::black_box(Node::from_value(&v["node"]).unwrap())),
        Some("draw") => drop(std::hint::black_box(
            DrawOutput::from_value(&json!({ "commands": v["commands"] })).unwrap(),
        )),
        Some("frame") => {
            if let Some(g) = v.get("gpu") {
                let ops: Vec<Arg> = g["ops"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(Arg::from_json)
                    .collect();
                let bytes: Vec<u8> = g["bytes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .flat_map(|x| (x.as_f64().unwrap() as f32).to_le_bytes())
                    .collect();
                std::hint::black_box((ops, bytes));
            }
            return true;
        }
        _ => {}
    }
    false
}

impl LiveHandler for Client {
    fn on_posts(&self, messages_json: Vec<String>) {
        let bytes = messages_json.iter().map(String::len).sum();
        let frame = messages_json
            .iter()
            .map(|t| post_kind(&serde_json::from_str(t).unwrap()))
            .fold(false, |a, b| a | b);
        if frame {
            let _ = self.frames.lock().unwrap().send(bytes);
        }
    }
    fn on_posts_bytes(&self, messages: Vec<Vec<u8>>) {
        let bytes = messages.iter().map(Vec::len).sum();
        let frame = messages.iter().fold(false, |a, m| {
            let post = std::hint::black_box(decode_post(m).unwrap());
            a | matches!(
                post,
                widget_wire::Post::Frame | widget_wire::Post::FrameGpu(_)
            )
        });
        if frame {
            let _ = self.frames.lock().unwrap().send(bytes);
        }
    }
    fn on_warning(&self, _message: String) {}
    fn on_gpu_canvas(&self, _key: Option<String>, _state: GpuCanvasState) {}
    fn on_exit(&self, exit: LiveExit) {
        if !matches!(exit, LiveExit::Stopped) {
            panic!("{exit:?}");
        }
    }
}

/// Median µs from delivering a frame to the next frame request decoded, and bytes per frame.
fn live_run(
    source: &str,
    input: &str,
    encoder: Option<Arc<ValueEncoder>>,
    frames: usize,
) -> (f64, f64) {
    let (tx, rx): (Sender<usize>, Receiver<usize>) = channel();
    let options = LiveOptions::default();
    let program = Program::new(source.into(), "__input".into()).unwrap();
    let run = program
        .start_live(
            input.into(),
            Box::new(Client {
                frames: Mutex::new(tx),
            }),
            options,
            None,
            encoder,
        )
        .unwrap();
    let wait = || {
        rx.recv_timeout(Duration::from_secs(10))
            .expect("a frame request")
    };
    wait();
    let (mut samples, mut bytes) = (Vec::new(), 0);
    // Frames at 120 Hz at most, so no `render` or `draw` waits for the post rate (`widgets-live.md`): each frame is
    // timed alone, from its delivery to the next frame request.
    let paced = Instant::now();
    for i in 0..60 + frames {
        if let Some(left) = (paced + Duration::from_secs_f64(i as f64 / 120.0))
            .checked_duration_since(Instant::now())
        {
            std::thread::sleep(left);
        }
        let t = i as f64 / 60.0;
        let frame = format!(
            r#"{{"type":"frame","frame":{{"t":{t},"dt":0.016666666666666666,"width":600,"height":320,"scale":2,"pointer":null,"dark":false}}}}"#
        );
        let start = Instant::now();
        run.deliver(frame).unwrap();
        let b = wait();
        if i >= 60 {
            samples.push(start.elapsed().as_secs_f64() * 1e6);
            bytes += b;
        }
    }
    run.stop();
    (median(samples), bytes as f64 / frames as f64)
}

/// A GPU canvas frame per `widgets-gpu.md` without the prelude (it has no `widget.gpu` yet): two writes and a render
/// pass of 10 meshes per frame, the batch riding in the frame request.
const GPU: &str = r#"const __widget_protocol = 2
const typed = __input().typed
const FLOATS = 16384
// The JSON run keeps its numbers in plain arrays: a JSON post can't carry typed arrays' bytes.
const vertices = typed ? new Float32Array(FLOATS) : new Array(FLOATS).fill(0)
const uniforms = typed ? new Float32Array(16) : new Array(16).fill(0)
let t = 0
while (true) {
  for (let i = 0; i < FLOATS; i++) vertices[i] = Math.sin(t + i * 0.001)
  for (let i = 0; i < 16; i++) uniforms[i] = Math.cos(t * (i + 1))
  const ops = [["writeBuffer", 4, 0, 0, FLOATS * 4], ["writeBuffer", 6, 0, FLOATS * 4, 64]]
  ops.push(["pass", { colorAttachments: [{ view: 1, loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }], depthStencilAttachment: { view: 3, depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" } }])
  ops.push(["setPipeline", 8], ["setViewport", 0, 0, 1200, 640, 0, 1], ["setScissorRect", 0, 0, 1200, 640])
  for (let m = 0; m < 10; m++) ops.push(["setBindGroup", 0, 20 + m, []], ["setVertexBuffer", 0, 4, m * 6400, 6400], ["setIndexBuffer", 5, "uint16", 0, -1], ["drawIndexed", 600, 1, 0, 0, 0])
  ops.push(["end"], ["submit"])
  let bytes
  if (typed) {
    bytes = new ArrayBuffer(FLOATS * 4 + 64)
    const out = new Uint8Array(bytes)
    out.set(new Uint8Array(vertices.buffer), 0)
    out.set(new Uint8Array(uniforms.buffer), FLOATS * 4)
  } else {
    bytes = [...vertices, ...uniforms]
  }
  __host.post({ type: "frame", gpu: { ops, bytes } })
  const m = await __host.receive()
  t = m.frame.t
}
"#;

fn live(filter: &str) {
    let w: Value = serde_json::from_str(&fixture("workloads.json")).unwrap();
    let (prelude, scripted) = (PRELUDE.to_owned(), SCRIPTED.to_owned());
    println!("\n| live (per frame) | JSON | binary | change | bytes/frame JSON → binary |");
    println!("| --- | ---: | ---: | ---: | ---: |");
    let mut list: Vec<(String, String, String, String, String)> = w["live"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            let name = w["name"].as_str().unwrap().to_owned();
            let template = fixture(&format!("templates/{}.js", w["program"].as_str().unwrap()));
            let input = fixture(&format!("inputs/{name}.json"));
            (
                name,
                format!("{scripted}\n{template}{LIVE}"),
                format!("{prelude}\n{template}{NATIVE_LIVE}"),
                input.clone(),
                input,
            )
        })
        .collect();
    list.push((
        "live-gpu".into(),
        GPU.into(),
        GPU.into(),
        r#"{"typed":false}"#.into(),
        r#"{"typed":true}"#.into(),
    ));
    for (name, source_json, source_bin, input_json, input_bin) in list {
        if !name.contains(filter) {
            continue;
        }
        let (mut json, mut bin) = (Vec::new(), Vec::new());
        let (mut bj, mut bb) = (0.0, 0.0);
        for _ in 0..3 {
            let (t, b) = live_run(&source_json, &input_json, None, 300);
            json.push(t);
            bj = b;
            let (t, b) = live_run(
                &source_bin,
                &input_bin,
                Some(widget_mobile::widget_encoder()),
                300,
            );
            bin.push(t);
            bb = b;
        }
        let (j, b) = (median(json), median(bin));
        println!(
            "| {name} | {j:.1} | {b:.1} | {} | {bj:.0} → {bb:.0} |",
            change(j, b)
        );
    }
}

fn main() {
    let filter = std::env::args().nth(1).unwrap_or_default();
    steps(&filter);
    live(&filter);
}
