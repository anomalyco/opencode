use std::time::{Duration, Instant};

use serde_json::{Value, json};
use widget_web::{LiveExit, LiveOptions, LiveRun, Program, Pump};

const LOOP: &str = r#"
const input = __input()
__host.post({ type: "hello", n: input.n })
while (true) {
  const m = await __host.receive()
  if (m.type === "sleep") { const t = __host.now(); await __host.sleep(m.ms); __host.post({ type: "slept", took: __host.now() - t }) }
  if (m.type === "flood") { for (let i = 0; i < 300; i++) __host.post({ i }); __host.post({ type: "flooded" }) }
  if (m.type === "throw") throw new TypeError("bad frame")
  if (m.type === "resumed") __host.post({ type: "resumed", pausedMs: m.pausedMs })
  if (m.type === "fetch") {
    try { __host.post({ type: "fetched", response: await __host.fetch(m.request) }) }
    catch (e) { __host.post({ type: "rejected", kind: e.kind, message: e.message }) }
  }
  if (m.type === "done") return { ok: true }
}
"#;

fn start(options: LiveOptions) -> LiveRun {
    Program::new(LOOP, None)
        .unwrap()
        .start_live(r#"{"n":7}"#, options)
        .unwrap()
}

/// Pumps until the run waits with nothing woken, or ends; returns what it posted meanwhile.
fn settle(run: &mut LiveRun) -> Vec<Value> {
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let pump = run.pump(8.0);
        let outbox = run.take_outbox();
        // Views of 100 levels nest past serde_json's default limit of 128.
        let mut reader = serde_json::Deserializer::from_str(&outbox);
        reader.disable_recursion_limit();
        let batch: Vec<Value> = serde::Deserialize::deserialize(&mut reader).unwrap();
        out.extend(batch);
        match pump {
            Pump::Ended => return out,
            Pump::Wait(_) if !run.woken() => return out,
            _ if Instant::now() > deadline => panic!("the run didn't settle"),
            _ => std::thread::sleep(Duration::from_micros(200)),
        }
    }
}

fn posts(out: &[Value]) -> Vec<Value> {
    out.iter()
        .filter(|e| e["type"] == "post")
        .map(|e| e["message"].clone())
        .collect()
}

#[test]
fn posts_receives_and_finishes() {
    let mut run = start(LiveOptions::default());
    assert_eq!(
        posts(&settle(&mut run)),
        vec![json!({ "type": "hello", "n": 7 })]
    );
    run.deliver(r#"{"type":"done"}"#).unwrap();
    settle(&mut run);
    assert_eq!(
        run.exit(),
        Some(&LiveExit::Finished {
            result_json: r#"{"ok":true}"#.into()
        })
    );
    assert!(run.deliver("{}").is_err());
}

#[test]
fn sleeps_report_their_timer_and_pause_freezes_them() {
    let mut run = start(LiveOptions::default());
    settle(&mut run);
    run.deliver(r#"{"type":"sleep","ms":40}"#).unwrap();
    assert!(posts(&settle(&mut run)).is_empty());
    let Pump::Wait(Some(left)) = run.pump(8.0) else {
        panic!("expected a timer")
    };
    assert!(left > 0.0 && left <= 40.0, "{left}");
    run.pause().unwrap();
    assert_eq!(run.pump(8.0), Pump::Wait(None));
    std::thread::sleep(Duration::from_millis(60));
    assert!(
        posts(&settle(&mut run)).is_empty(),
        "a paused sleep doesn't end"
    );
    run.resume().unwrap();
    let mut seen = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(2);
    while seen.len() < 2 && Instant::now() < deadline {
        seen.extend(posts(&settle(&mut run)));
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(seen[0]["type"], "slept");
    assert!(seen[0]["took"].as_f64().unwrap() < 55.0, "{seen:?}");
    assert_eq!(seen[1]["type"], "resumed");
    assert!(seen[1]["pausedMs"].as_f64().unwrap() >= 55.0);
}

#[test]
fn deliveries_wait_while_paused() {
    let mut run = start(LiveOptions::default());
    settle(&mut run);
    run.pause().unwrap();
    run.deliver(r#"{"type":"throw"}"#).unwrap();
    settle(&mut run);
    assert!(run.exit().is_none());
    run.resume().unwrap();
    settle(&mut run);
    match run.exit() {
        Some(LiveExit::Failed { error }) => {
            assert!(error.reason().contains("bad frame"), "{error}")
        }
        other => panic!("{other:?}"),
    }
}

/// A generic run has no post rate: the widget rule lives in native runs.
#[test]
fn generic_runs_post_without_a_rate() {
    let mut run = start(LiveOptions::default());
    settle(&mut run);
    run.deliver(r#"{"type":"flood"}"#).unwrap();
    let out = settle(&mut run);
    assert_eq!(posts(&out).len(), 301);
    assert_eq!(out.iter().filter(|e| e["type"] == "warning").count(), 0);
}

#[test]
fn fetches_need_the_capability_and_go_through_the_host() {
    let mut denied = start(LiveOptions::default());
    settle(&mut denied);
    denied
        .deliver(r#"{"type":"fetch","request":{"url":"https://api.example.com/x"}}"#)
        .unwrap();
    assert_eq!(posts(&settle(&mut denied))[0]["kind"], "CapabilityDenied");

    let mut run = start(LiveOptions {
        https_hosts: Some(vec!["api.example.com".into()]),
        ..Default::default()
    });
    settle(&mut run);
    run.deliver(r#"{"type":"fetch","request":{"url":"https://other.example.com/x"}}"#)
        .unwrap();
    assert_eq!(posts(&settle(&mut run))[0]["kind"], "CapabilityDenied");
    run.deliver(
        r#"{"type":"fetch","request":{"url":"https://api.example.com/x","method":"post","headers":{"Cookie":"a","X-Key":"k"},"body":"hi"}}"#,
    )
    .unwrap();
    let out = settle(&mut run);
    let request = out
        .iter()
        .find(|e| e["type"] == "fetch")
        .expect("a fetch for the host");
    assert_eq!(request["method"], "POST");
    assert_eq!(request["headers"], json!([["x-key", "k"]]));
    assert_eq!(request["body"], "hi");
    let id = request["id"].as_u64().unwrap();
    run.fetch_done(
        id,
        r#"{"status":201,"url":"https://api.example.com/x","headers":[["content-type","application/json"]]}"#,
        br#"{"a":1}"#.to_vec(),
    );
    let fetched = posts(&settle(&mut run));
    assert_eq!(fetched[0]["response"]["status"], 201);
    assert_eq!(fetched[0]["response"]["body"], r#"{"a":1}"#);

    run.deliver(r#"{"type":"fetch","request":{"url":"https://api.example.com/slow"}}"#)
        .unwrap();
    let id = settle(&mut run)[0]["id"].as_u64().unwrap();
    run.fetch_failed(id, "Timeout", "no response within 15 s");
    assert_eq!(posts(&settle(&mut run))[0]["kind"], "Timeout");

    run.deliver(r#"{"type":"fetch","request":{"url":"https://api.example.com/never"}}"#)
        .unwrap();
    let id = settle(&mut run)[0]["id"].as_u64().unwrap();
    run.stop();
    assert_eq!(run.exit(), Some(&LiveExit::Stopped));
    let out: Vec<Value> = serde_json::from_str(&run.take_outbox()).unwrap();
    assert_eq!(out, vec![json!({ "type": "cancel", "id": id })]);
}

#[test]
fn native_runs_build_render_trees_and_draw_by_key() {
    const NATIVE: &str = r#"
const view = { type: "column", children: [
  [null, { type: "canvas", key: "board", height: 10, onPointer: () => {} }],
  { type: "canvas", key: "sky", wgsl: "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", height: 10 },
] }
const interactive = __host.post({ type: "render", node: view })
const still = __host.post({ type: "render", node: { ...view, children: [view.children[1]] } })
__host.post({ type: "render", node: view })
__host.post({ type: "draw", key: "board", commands: [["rect", 0, 0, 1, 1, { fill: "accent" }]] })
const caught = []
for (const key of ["nope", "sky"]) {
  try { __host.post({ type: "draw", key, commands: [] }) } catch (e) { caught.push(e.message) }
}
// A function anywhere but a node's handler props fails the call with the runtime's TypeError.
const functions = [
  () => __host.post({ type: "send", value: { f: () => 1 } }),
  () => __host.post({ type: "draw", key: "board", commands: [["rect", 0, 0, 1, 1, { fill: () => 1 }]] }),
  () => __host.post({ type: "render", node: { type: "text", text: "x", extra: [() => 1] } }),
  () => __host.post({ type: "render", node: { type: "button", label: "b", id: () => 1 } }),
  () => __host.post({ type: "render", node: { type: "column", children: [() => 1] } }),
  () => __host.post({ type: "render", node: view }, () => 1),
  () => __host.now(() => 1),
]
// A real TypeError, sync or async.
const named = (e) => (e instanceof TypeError && e.constructor === TypeError ? "" : "not a TypeError: ") + e.name + ": " + e.message
for (const f of functions) {
  try { f() } catch (e) { caught.push(named(e)) }
}
try { await __host.sleep(() => 1) } catch (e) { caught.push(named(e)) }
__host.post({ type: "result", interactive, still, caught })
"#;
    let mut run = Program::new(NATIVE, None)
        .unwrap()
        .start_live(
            "null",
            LiveOptions {
                native: true,
                ..Default::default()
            },
        )
        .unwrap();
    let out = posts(&settle(&mut run));
    assert_eq!(
        out[0],
        json!({ "type": "render", "node": { "type": "column", "children": [
            { "type": "canvas", "height": 10, "id": "0/:board", "pointer": true },
            { "type": "canvas", "wgsl": "fn shade(p: vec2f) -> vec4f { return vec4f(1.0); }", "height": 10, "id": "0/:sky" },
        ] } })
    );
    assert_eq!(out[1]["node"]["children"][0]["id"], "0/:sky");
    assert_eq!(out[2], out[0]);
    assert_eq!(
        out[3],
        json!({ "type": "draw", "id": "0/:board", "commands": [["rect", 0, 0, 1, 1, { "fill": "accent" }]] })
    );
    assert_eq!(
        out[4],
        json!({ "type": "result", "interactive": true, "still": false, "caught": [
            "No canvas with key \"nope\" in the rendered view",
            "Canvas \"sky\" is drawn by its wgsl; it takes no draw commands",
            "TypeError: Argument 1 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 2 to __host.post contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.now contains a function, which cannot be passed to the host.",
            "TypeError: Argument 1 to __host.sleep contains a function, which cannot be passed to the host.",
        ] })
    );
    assert_eq!(out.len(), 5);
}

/// A live program on the prelude, started natively with a post rate of `rate` a second.
fn start_widget(source: &str, rate: u32) -> LiveRun {
    let program = format!(
        "{}\n{source}\nreturn await __widget_live(__input(), true)",
        live_prelude()
    );
    Program::new(&program, None)
        .unwrap()
        .start_live(
            r#"{"data":null}"#,
            LiveOptions {
                native: true,
                max_posts_per_second: rate,
                ..Default::default()
            },
        )
        .unwrap()
}

/// Pumps `run` as a host does, its timers included, for `ms` or until it ends; returns what it posted meanwhile.
fn run_for(run: &mut LiveRun, ms: u64) -> Vec<Value> {
    let mut out = Vec::new();
    let deadline = Instant::now() + Duration::from_millis(ms);
    loop {
        let pump = run.pump(8.0);
        out.extend(posts(&parse(&run.take_outbox())));
        if pump == Pump::Ended || Instant::now() >= deadline {
            return out;
        }
        std::thread::sleep(Duration::from_micros(500));
    }
}

fn parse(outbox: &str) -> Vec<Value> {
    let mut reader = serde_json::Deserializer::from_str(outbox);
    reader.disable_recursion_limit();
    serde::Deserialize::deserialize(&mut reader).unwrap()
}

/// The texts of the text views rendered in `out`.
fn texts(out: &[Value]) -> Vec<String> {
    out.iter()
        .filter(|m| m["type"] == "render" && m["node"]["type"] == "text")
        .map(|m| m["node"]["text"].as_str().unwrap_or_default().to_owned())
        .collect()
}

/// The post rate (widgets-live.md): 30 renders at 10 a second: 8 at once (the burst), then the latest alone a tenth of
/// a second later; ending sends what waits first, before an answer.
#[test]
fn renders_over_the_post_rate_wait_and_coalesce() {
    let mut run = start_widget(
        "async function main() {\n  for (let i = 0; i < 30; i++) widget.render(ui.text(String(i)))\n  await widget.sleep(1000)\n  widget.submit(1)\n}",
        10,
    );
    let first: Vec<String> = (0..8).map(|i| i.to_string()).collect();
    let mut out = run_for(&mut run, 60);
    assert_eq!(texts(&out), first);
    out.extend(run_for(&mut run, 100));
    assert_eq!(texts(&out), [first.clone(), vec!["29".into()]].concat());
    out.extend(run_for(&mut run, 3000));
    assert_eq!(out.last().unwrap()["type"], "submit");
    assert!(matches!(run.exit(), Some(LiveExit::Finished { .. })));
    for last in ["widget.submit(1)", "return"] {
        let mut run = start_widget(
            &format!(
                "async function main() {{\n  for (let i = 0; i < 30; i++) widget.render(ui.text(String(i)))\n  {last}\n}}"
            ),
            10,
        );
        let out = run_for(&mut run, 3000);
        assert_eq!(
            texts(&out),
            [first.clone(), vec!["29".into()]].concat(),
            "{last}"
        );
        let after: Vec<&str> = out
            .iter()
            .skip(9)
            .filter_map(|m| m["type"].as_str())
            .collect();
        let want: &[&str] = if last == "return" { &[] } else { &["submit"] };
        assert_eq!(after, want, "{last}");
    }
    // A client stop drops what waits.
    let mut run = start_widget(
        "async function main() {\n  for (let i = 0; i < 30; i++) widget.render(ui.text(String(i)))\n  await widget.sleep(1000)\n}",
        10,
    );
    let out = run_for(&mut run, 30);
    run.stop();
    assert_eq!(texts(&out), first);
    assert_eq!(run.take_outbox(), "[]");
}

/// Draws coalesce by canvas key; a frame request under load is never counted or held.
#[test]
fn a_frame_request_under_load_is_answered_and_draws_coalesce_by_canvas() {
    let mut run = start_widget(
        r#"async function main() {
  widget.render(ui.column([ui.canvas({ key: "a", height: 1 }), ui.canvas({ key: "b", height: 1 })]))
  for (let i = 0; i < 20; i++) { widget.draw("a", [["alpha", i / 100]]); widget.draw("b", [["alpha", i / 50]]) }
  const frame = await widget.frame()
  widget.render(ui.text("frame " + frame.t))
}"#,
        10,
    );
    let mut out = run_for(&mut run, 20);
    // The render and 7 draws took the burst; the frame request went out at once, ahead of the waiting draws.
    let kinds: Vec<&str> = out.iter().map(|m| m["type"].as_str().unwrap()).collect();
    assert_eq!(
        kinds,
        [vec!["render"], vec!["draw"; 7], vec!["frame"]].concat()
    );
    run.deliver(r#"{"type":"frame","frame":{"t":1,"dt":0,"width":2,"height":2,"scale":1,"pointer":null,"dark":true,"fullscreen":false,"close":null}}"#)
        .unwrap();
    out.extend(run_for(&mut run, 3000));
    let draws: Vec<Value> = out
        .iter()
        .filter(|m| m["type"] == "draw")
        .map(|m| json!([m["id"], m["commands"]]))
        .collect();
    assert_eq!(draws.len(), 9);
    assert_eq!(
        draws[7..],
        [
            json!(["0/:b", [["alpha", 0.38]]]),
            json!(["0/:a", [["alpha", 0.19]]])
        ]
    );
    assert_eq!(texts(&out), ["frame 1"]);
    assert_eq!(out.last().unwrap()["type"], "render");
    assert!(matches!(run.exit(), Some(LiveExit::Finished { .. })));
}

/// A 120 Hz game posting a render and two draws a frame (360 a second): every frame request goes out, the counted posts
/// stay within the rate, and the last frame's view and drawings arrive.
#[test]
fn a_game_at_120_hz_runs_every_frame_and_shows_its_last_one() {
    let mut run = start_widget(
        r#"async function main() {
  for (let n = 0; n < 120; n++) {
    const frame = await widget.frame()
    widget.render(ui.column([ui.text("n " + n), ui.canvas({ key: "a", height: 1 }), ui.canvas({ key: "b", height: 1 })]))
    widget.draw("a", [["alpha", n / 1000]])
    widget.draw("b", [["alpha", n / 200]])
  }
}"#,
        240,
    );
    let started = Instant::now();
    let mut out: Vec<Value> = Vec::new();
    let (mut frames, mut answered) = (0, 0);
    let mut counted_in_a_second = 0;
    while run.exit().is_none() && started.elapsed() < Duration::from_secs(5) {
        let tick = Instant::now();
        let posted = run_for(&mut run, 0);
        frames += posted.iter().filter(|m| m["type"] == "frame").count();
        if started.elapsed() <= Duration::from_secs(1) {
            counted_in_a_second += posted
                .iter()
                .filter(|m| m["type"] == "render" || m["type"] == "draw")
                .count();
        }
        out.extend(posted);
        // Each frame request is answered on the next display frame, as the page does.
        if answered < frames && run.exit().is_none() {
            answered += 1;
            run.deliver(&format!(
                r#"{{"type":"frame","frame":{{"t":{},"dt":0.008,"width":2,"height":2,"scale":1,"pointer":null,"dark":true,"fullscreen":false,"close":null}}}}"#,
                answered as f64 / 120.0
            ))
            .unwrap();
        }
        std::thread::sleep(Duration::from_secs_f64(1.0 / 120.0).saturating_sub(tick.elapsed()));
    }
    out.extend(run_for(&mut run, 0));
    assert_eq!(frames, 120);
    assert!(counted_in_a_second <= 240 + 8 + 3, "{counted_in_a_second}");
    assert!(
        matches!(run.exit(), Some(LiveExit::Finished { .. })),
        "{:?}",
        run.exit()
    );
    let last_render = out.iter().rev().find(|m| m["type"] == "render").unwrap();
    assert_eq!(last_render["node"]["children"][0]["text"], "n 119");
    let last_b = out
        .iter()
        .rev()
        .find(|m| m["type"] == "draw" && m["id"] == "0/:b")
        .unwrap();
    assert_eq!(last_b["commands"], json!([["alpha", 0.595]]));
}

/// A draw post without a string key is an invalid post: the run ends.
#[test]
fn a_draw_post_without_a_string_key_ends_the_run() {
    for post in [
        r#"__host.post({ type: "draw", id: "0", commands: [] })"#,
        r#"__host.post({ type: "draw", key: 1, commands: [] })"#,
    ] {
        let mut run = start_widget(
            &format!(
                "async function main() {{\n  widget.render(ui.canvas({{ key: \"c\", height: 1 }}))\n  try {{ {post} }} catch (e) {{ widget.send(\"caught\") }}\n}}"
            ),
            240,
        );
        let out = run_for(&mut run, 3000);
        assert_eq!(out.len(), 1, "{post}: {out:?}");
        match run.exit() {
            Some(LiveExit::Failed { error }) => {
                assert_eq!(error.reason(), "A draw post needs a string key", "{post}")
            }
            other => panic!("{post}: {other:?}"),
        }
    }
}

/// A draw post goes to the client as its canvas's id and commands only; one over 2,000 commands is an invalid post,
/// which ends the run in phase `draw`, what waits for the post rate going out first.
#[test]
fn draw_posts_carry_id_and_commands_and_end_the_run_over_2000_commands() {
    let mut run = start_widget(
        r#"async function main() {
  widget.render(ui.canvas({ key: "c", height: 1 }))
  __host.post({ type: "draw", key: "c", commands: [["rect", 0, 0, 1, 1, { fill: "accent" }]], extra: 1 })
  for (let i = 0; i < 10; i++) widget.render(ui.canvas({ key: "c", height: i + 1 }))
  try { widget.draw("c", Array.from({ length: 2001 }, () => ["save"])) } catch (e) { widget.send("caught") }
  widget.send("after")
}"#,
        240,
    );
    let out = run_for(&mut run, 3000);
    assert_eq!(
        out[1],
        json!({ "type": "draw", "id": ":c", "commands": [["rect", 0, 0, 1, 1, { "fill": "accent" }]] })
    );
    // The latest render goes out (at once or when the run ends); nothing after the invalid draw does.
    assert_eq!(out.last().unwrap()["node"]["height"], 10, "{out:?}");
    assert!(out.iter().all(|m| m["type"] != "send"), "{out:?}");
    match run.exit() {
        Some(LiveExit::Failed { error }) => {
            assert_eq!(error.phase(), Some("draw"));
            assert_eq!(
                error.reason(),
                "2001 draw commands is over the budget of 2000 per frame"
            );
        }
        other => panic!("{other:?}"),
    }
}

/// Every command is checked when the program posts it, with the other hosts' rules and messages: the first invalid one
/// ends the run in phase `draw`, named by its index; valid ones of every kind go through.
#[test]
fn an_invalid_draw_command_ends_the_run_in_phase_draw() {
    let draw = |commands: &str| {
        let mut run = start_widget(
            &format!(
                "async function main() {{\n  widget.render(ui.canvas({{ key: \"c\", height: 1 }}))\n  __host.post({{ type: \"draw\", key: \"c\"{commands} }})\n  widget.send(\"after\")\n}}"
            ),
            240,
        );
        let out = run_for(&mut run, 3000);
        match run.exit() {
            Some(LiveExit::Failed { error }) => {
                assert_eq!(error.phase(), Some("draw"), "{commands}");
                assert!(
                    out.iter()
                        .all(|m| m["type"] != "send" && m["type"] != "draw"),
                    "{out:?}"
                );
                Err(error.reason().to_owned())
            }
            Some(LiveExit::Finished { .. }) => {
                Ok(out.into_iter().find(|m| m["type"] == "draw").unwrap())
            }
            other => panic!("{commands}: {other:?}"),
        }
    };
    for (commands, message) in [
        (
            r#", commands: [["save"], ["rect", 0, 0, 1, 1, "accent"]]"#,
            "draw command 1: a paint is an object",
        ),
        (
            r#", commands: [["blur", 1]]"#,
            "draw command 0: unknown draw command \"blur\"",
        ),
        (
            r#", commands: [["alpha", "x"]]"#,
            "draw command 0: \"alpha\" argument 1 must be a finite number",
        ),
        (
            r#", commands: [["rect", 0, 0, 1, NaN, {}]]"#,
            "draw command 0: \"rect\" argument 4 must be a finite number",
        ),
        (
            r##", commands: [["circle", 0, 0, 1, { fill: "#12" }]]"##,
            "draw command 0: not a color",
        ),
        (
            r#", commands: [["line", 0, 0, 1, 1, { stroke: "accent", width: "2" }]]"#,
            "draw command 0: a stroke's width must be a finite number",
        ),
        (
            r#", commands: [["rect", 0, 0, 1, 1, { fill: { linear: [0, 0, 1], stops: [] } }]]"#,
            "draw command 0: a linear gradient takes 4 numbers",
        ),
        (
            r#", commands: [["rect", 0, 0, 1, 1, { fill: { radial: [0, 0, 1], stops: [[0]] } }]]"#,
            "draw command 0: a stop is [offset, color]",
        ),
        (
            r#", commands: [["path", [["M", 0, 0], ["X", 1]], {}]]"#,
            "draw command 0: unknown path segment",
        ),
        (
            r#", commands: [["text", 0, 0]]"#,
            "draw command 0: \"text\" is missing argument 3",
        ),
        (
            r#", commands: [["text", 0, 0, "t", { size: "big" }]]"#,
            "draw command 0: a text size must be a finite number",
        ),
        (
            r#", commands: [["image", 1, 0, 0, 1, 1]]"#,
            "draw command 0: \"image\" takes a src",
        ),
        (
            r#", commands: [5]"#,
            "draw command 0: a command is an array",
        ),
        (
            r#", commands: [[1]]"#,
            "draw command 0: a command starts with its name",
        ),
        (r#", commands: "x""#, "draw commands must be a list"),
        ("", "draw commands must be a list"),
    ] {
        assert_eq!(draw(commands), Err(message.to_owned()), "{commands}");
    }
    // Every kind, as the prelude's builder writes it, goes through as it was posted.
    let valid = r##"ui.draw().save().translate(1, 2).rotate(0.5).scale(2).alpha(0.5).rect(0, 0, 1, 1, "accent").rrect(0, 0, 4, 4, 1, { fill: { linear: [0, 0, 1, 1], stops: [[0, "#fff"], [1, "#000000aa"]] }, stroke: "border", width: 2, cap: "round" }).circle(1, 1, 1, { fill: { radial: [1, 1, 1], stops: [[0, "bg"]] } }).line(0, 0, 1, 1, "muted").path([["M", 0, 0], ["L", 1, 1], ["Q", 1, 0, 2, 2], ["C", 0, 0, 1, 1, 2, 2], ["Z"]], "success").text(0, 10, "hi", { size: 12, weight: 600, align: "center", color: "#abc", mono: true }).image("a.png", 0, 0, 1, 1).restore().commands"##;
    let posted = draw(&format!(", commands: {valid}")).expect("valid commands");
    assert_eq!(posted["commands"].as_array().unwrap().len(), 13);
}

/// GPU batches (widgets-gpu.md, Transport) go out at once, in a frame request or on their own, as they are for the
/// client's checks: their ops as JSON and an `ArrayBuffer`'s bytes in the byte outbox, named by `[offset, length]`;
/// other bytes `null`, a batch that isn't an object whole. A render names its GPU canvases' ids by key.
#[test]
fn gpu_batches_carry_their_ops_and_bytes() {
    let mut run = start_widget(
        r#"async function main() {
  widget.render(ui.column([ui.canvas({ key: "scene", gpu: true, height: 10 }), ui.canvas({ key: "flat", height: 10 })]))
  const data = new Float32Array([1, 2])
  __host.post({ type: "gpu", ops: [["context", 1, "scene", "bgra8unorm", "opaque"], ["buffer", 3, 8, 40], ["writeBuffer", 3, 0, 0, 8]], bytes: data.buffer })
  __host.post({ type: "frame", gpu: { ops: [["writeBuffer", 3, 0, 0, 4]], bytes: new Uint32Array([7]).buffer } })
  __host.post({ type: "gpu", ops: "x", bytes: new Uint8Array(2) })
  __host.post({ type: "gpu", bytes: new ArrayBuffer(1) })
  __host.post({ type: "frame", gpu: 5 })
  try { widget.draw("scene", []) } catch (e) { widget.send(e.message) }
  try { __host.post({ type: "gpu", ops: [["shader", 4, () => 1]], bytes: new ArrayBuffer(0) }) } catch (e) { widget.send(e.name) }
}"#,
        240,
    );
    let mut out = Vec::new();
    let mut bytes = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let pump = run.pump(8.0);
        out.extend(placeless(posts(&parse(&run.take_outbox()))));
        bytes.extend(run.take_bytes());
        if pump == Pump::Ended || Instant::now() > deadline {
            break;
        }
    }
    assert_eq!(
        out[0]["gpu"],
        json!({ "scene": out[0]["node"]["children"][0]["id"] })
    );
    assert_eq!(
        out[1],
        json!({ "type": "gpu", "batch": { "ops": [
            ["context", 1, "scene", "bgra8unorm", "opaque"],
            ["buffer", 3, 8, 40],
            ["writeBuffer", 3, 0, 0, 8],
        ], "bytes": [0, 8] } })
    );
    assert_eq!(
        out[2],
        json!({ "type": "frame", "gpu": { "ops": [["writeBuffer", 3, 0, 0, 4]], "bytes": [8, 4] } })
    );
    assert_eq!(
        out[3],
        json!({ "type": "gpu", "batch": { "ops": "x", "bytes": null } })
    );
    assert_eq!(
        out[4],
        json!({ "type": "gpu", "batch": { "bytes": [12, 1] } })
    );
    assert_eq!(out[5], json!({ "type": "frame", "gpu": 5 }));
    let floats: Vec<u8> = [1.0f32, 2.0].iter().flat_map(|f| f.to_le_bytes()).collect();
    assert_eq!(
        bytes,
        [floats, 7u32.to_le_bytes().to_vec(), vec![0]].concat()
    );
    assert_eq!(
        out[6]["value"],
        "Canvas \"scene\" is drawn by the GPU; it takes no draw commands"
    );
    assert_eq!(out[7]["value"], "TypeError");
}

/// A GPU batch's ops cross as JSON reads them (widgets-gpu.md, Transport): an `undefined` list item is `null`, an
/// `undefined` member is absent. Numbers stay as they are: a non-finite one, written `null`, is listed by its path in
/// `nonFinite` for the client to put back; a batch without one has no `nonFinite`.
#[test]
fn gpu_batch_ops_keep_non_finite_numbers_by_path() {
    let mut run = start_widget(
        r#"async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 10 }))
  __host.post({ type: "gpu", ops: [["pass", { colorAttachments: [undefined, { clearValue: [0, NaN, Infinity], "a\"b": -Infinity, gone: undefined }] }], ["buffer", 1, NaN, 4]], bytes: new ArrayBuffer(0) })
  __host.post({ type: "frame", gpu: { ops: NaN, bytes: new ArrayBuffer(0) } })
  __host.post({ type: "gpu", ops: [["buffer", 2, null, 4]], bytes: new ArrayBuffer(0) })
}"#,
        240,
    );
    let out = placeless(run_for(&mut run, 200));
    assert_eq!(
        out[1],
        json!({ "type": "gpu", "batch": {
            "ops": [["pass", { "colorAttachments": [null, { "clearValue": [0, null, null], "a\"b": null }] }], ["buffer", 1, null, 4]],
            "nonFinite": [
                [[0, 1, "colorAttachments", 1, "clearValue", 1], "NaN"],
                [[0, 1, "colorAttachments", 1, "clearValue", 2], "Infinity"],
                [[0, 1, "colorAttachments", 1, "a\"b"], "-Infinity"],
                [[1, 2], "NaN"],
            ],
            "bytes": [0, 0],
        } })
    );
    assert_eq!(
        out[2],
        json!({ "type": "frame", "gpu": { "ops": null, "nonFinite": [[[], "NaN"]], "bytes": [0, 0] } })
    );
    assert_eq!(
        out[3],
        json!({ "type": "gpu", "batch": { "ops": [["buffer", 2, null, 4]], "bytes": [0, 0] } })
    );
}

/// A GPU batch never overtakes a waiting render or draw: it waits behind them (taking no token) and goes out right
/// after the post before it, with its bytes; a frame request without a batch still goes out at once.
#[test]
fn gpu_batches_wait_in_order_behind_waiting_posts() {
    let mut run = start_widget(
        r#"async function main() {
  for (let i = 0; i < 10; i++) widget.render(ui.column([ui.text(String(i)), ui.canvas({ key: "scene", gpu: true, height: 1 })]))
  __host.post({ type: "gpu", ops: [["context", 1, "scene", "bgra8unorm", "opaque"]], bytes: new Uint8Array([9, 8]).buffer })
  __host.post({ type: "frame" })
  __host.post({ type: "frame", gpu: { ops: [["submit"]], bytes: new Uint8Array([7]).buffer } })
  await widget.sleep(1000)
}"#,
        10,
    );
    let (mut out, mut bytes) = (Vec::new(), Vec::new());
    let collect = |run: &mut LiveRun, ms, out: &mut Vec<Value>, bytes: &mut Vec<u8>| {
        out.extend(run_for(run, ms));
        bytes.extend(run.take_bytes());
    };
    collect(&mut run, 30, &mut out, &mut bytes);
    let kinds = |out: &[Value]| -> Vec<String> {
        out.iter()
            .map(|m| match m["type"].as_str().unwrap() {
                "render" => format!(
                    "render {}",
                    m["node"]["children"][0]["text"].as_str().unwrap()
                ),
                other => other.to_owned(),
            })
            .collect()
    };
    // The burst's 8 renders, and the bare frame request at once; the batches wait behind render 9.
    assert_eq!(
        kinds(&out),
        [
            "render 0", "render 1", "render 2", "render 3", "render 4", "render 5", "render 6",
            "render 7", "frame"
        ]
    );
    assert!(out[8].get("gpu").is_none());
    collect(&mut run, 150, &mut out, &mut bytes);
    assert_eq!(kinds(&out)[9..], ["render 9", "gpu", "frame"]);
    assert_eq!(out[10]["batch"]["bytes"], json!([0, 2]));
    assert_eq!(out[11]["gpu"]["bytes"], json!([2, 1]));
    assert_eq!(bytes, [9, 8, 7]);
}

/// Posts without their GPU batches' `at` (a_gpu_batch_carries_the_line_of_its_frame_request).
fn placeless(mut out: Vec<Value>) -> Vec<Value> {
    for m in &mut out {
        m.as_object_mut().unwrap().remove("at");
    }
    out
}

/// A live program on the live prelude, run natively.
fn widget(source: &str) -> (Vec<Value>, Option<LiveExit>) {
    let program = format!(
        "{}\n{source}\nreturn await __widget_live(__input(), true)",
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
    let out = posts(&settle(&mut run));
    (out, run.exit().cloned())
}

/// Uncaught, a function where none may go fails the run as the runtime's TypeError, at the call, sync or async; so
/// does a draw to an unknown canvas key.
#[test]
fn a_function_posted_where_none_may_go_fails_the_run_at_the_call() {
    for (call, line) in [
        ("widget.send({ f: () => 1 })", 2),
        ("__host.post({ type: \"send\", value: 1 }, () => 1)", 2),
        ("await __host.sleep(() => 1)", 2),
        ("await __host.receive(() => 1)", 2),
        ("__host.now(() => 1)", 2),
    ] {
        let (_, exit) = widget(&format!("async function main() {{\n  {call}\n}}"));
        let Some(LiveExit::Failed { error }) = exit else {
            panic!("{call}: {exit:?}")
        };
        assert!(
            error.reason().starts_with("TypeError: Argument ")
                && error
                    .reason()
                    .contains(" contains a function, which cannot be passed to the host.")
                && error.location().is_some() == (line > 0),
            "{call}: {error}"
        );
        if line > 0 && !call.starts_with("widget.") {
            assert_eq!(
                error.location().map(|(l, _)| l),
                Some(prelude_lines() + 1 + line),
                "{call}"
            );
        }
    }
    let (_, exit) = widget(
        "async function main() {\n  __host.post({ type: \"draw\", key: \"nope\", commands: [] })\n}",
    );
    let Some(LiveExit::Failed { error }) = exit else {
        panic!("{exit:?}")
    };
    assert_eq!(
        (error.reason(), error.location().map(|(l, _)| l)),
        (
            format!(
                "Error: No canvas with key \"nope\" in the rendered view (line {}, col 3)",
                prelude_lines() + 3
            )
            .as_str(),
            Some(prelude_lines() + 3)
        )
    );
}

/// What a live program has before its source (`packages/widget/src`, read in place): the prelude, a newline, the
/// live prelude.
fn live_prelude() -> String {
    let read = |name: &str| {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../widget/src")
                .join(name),
        )
        .unwrap()
    };
    format!("{}\n{}", read("prelude.js"), read("prelude-live.js"))
}

/// The live prelude's lines; it ends with a newline, so with the joining one the widget template starts two lines on.
fn prelude_lines() -> u32 {
    live_prelude().lines().count() as u32
}

#[test]
fn a_render_that_breaks_a_rule_of_views_ends_the_run_in_phase_view() {
    let view = |reason: &str| {
        Some(LiveExit::Failed {
            error: widget_web::Error::View {
                reason: reason.into(),
            },
        })
    };
    // Rendered first, then the key of another type: the first render went out, the run ends at the second.
    let (out, exit) = widget(
        r#"async function main() {
  widget.render(ui.text("first"))
  try { widget.render(ui.column([ui.button("b", { key: {} })])) } catch (e) { widget.send("caught " + e.message) }
  widget.send("after")
}"#,
    );
    assert_eq!(
        out,
        vec![json!({ "type": "render", "node": { "type": "text", "text": "first" } })]
    );
    assert_eq!(exit, view(widget_web::tree::KEY));
    // 100 levels render; 101 end the run.
    let deep = |levels: usize| {
        format!(
            "async function main() {{\n  let node = ui.text(\"x\")\n  for (let i = 1; i < {levels}; i++) node = ui.column([node])\n  widget.render(node)\n}}"
        )
    };
    let (out, exit) = widget(&deep(100));
    assert_eq!(
        (out.len(), exit),
        (
            1,
            Some(LiveExit::Finished {
                result_json: "null".into()
            })
        )
    );
    let (out, exit) = widget(&deep(101));
    assert!(out.is_empty());
    assert_eq!(exit, view(widget_web::tree::DEEP));
    // Deep only in a prop, past the boundary of 202: the boundary's own error, which the program gets.
    let (_, exit) = widget(
        r#"async function main() {
  widget.render(ui.text("x", { extra: JSON.parse("[".repeat(210) + "]".repeat(210)) }))
}"#,
    );
    match exit {
        Some(LiveExit::Failed { error }) => {
            assert!(
                error.reason().contains("exceeds the maximum value depth"),
                "{error}"
            )
        }
        other => panic!("{other:?}"),
    }
}

/// A live program on the live prelude with its own lines declared (`program_lines`), as the web host runs it: its
/// posts and how it ended, and the program's line of the template's first line.
fn located(source: &str, https_hosts: Option<Vec<String>>) -> (Vec<Value>, Option<LiveExit>, u32) {
    let first = prelude_lines() + 2;
    let program = format!(
        "{}\n{source}\nreturn await __widget_live(__input(), true)",
        live_prelude()
    );
    let mut run = Program::new(&program, None)
        .unwrap()
        .start_live(
            r#"{"data":null,"gpu":{"available":true,"format":"bgra8unorm"}}"#,
            LiveOptions {
                native: true,
                https_hosts,
                program_lines: Some((first, first + source.lines().count() as u32 - 1)),
                ..Default::default()
            },
        )
        .unwrap();
    let out = posts(&settle(&mut run));
    (out, run.exit().cloned(), first)
}

/// How a located run failed: its kind, phase, and line in the template (`first` its first line) with a column.
fn failure(exit: Option<LiveExit>, first: u32) -> (Option<String>, Option<&'static str>, u32) {
    let Some(LiveExit::Failed { error }) = exit else {
        panic!("{exit:?}")
    };
    let (line, column) = error.location().expect("a location");
    assert!(column > 0);
    (
        error.kind().map(str::to_owned),
        error.phase(),
        line + 1 - first,
    )
}

/// An uncaught `__host.fetch` rejection ends the run with its kind, at the call.
#[test]
fn an_uncaught_fetch_rejection_keeps_its_kind() {
    let (_, exit, first) = located(
        "async function main() {\n  await __host.fetch({ url: \"https://example.org\", method: \"GET\", headers: {} })\n}\n",
        None,
    );
    assert_eq!(
        failure(exit, first),
        (Some("CapabilityDenied".into()), None, 2)
    );
}

/// An uncaught `widget.fetch` denial (the prelude rethrows the rejection) is a fetch error at the template's call.
#[test]
fn an_uncaught_widget_fetch_denial_is_a_fetch_error_at_its_line() {
    let (_, exit, first) = located(
        "async function main() {\n  widget.render(ui.text(\"x\"))\n  await widget.fetch(\"https://example.org/a\")\n}\n",
        Some(vec!["api.example.com".into()]),
    );
    assert_eq!(
        failure(exit, first),
        (Some("CapabilityDenied".into()), None, 3)
    );
}

/// A GPU batch's post carries its line and column (`at`): the template's frame request that posted it.
#[test]
fn a_gpu_batch_carries_the_line_of_its_frame_request() {
    let (out, _, first) = located(
        r#"async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const device = await widget.gpu.requestDevice()
  widget.gpu.getContext("scene").configure({ device, format: widget.gpu.getPreferredCanvasFormat() })
  device.createBuffer({ size: 64 * 1024 * 1024 + 4, usage: GPUBufferUsage.VERTEX })
  for (let i = 0; i < 20; i++) await widget.frame()
}
"#,
        None,
    );
    let frame = out
        .iter()
        .find(|m| m["type"] == "frame" && m["gpu"].is_object())
        .expect("a frame request with a batch");
    assert_eq!(frame["at"][0], first + 5);
    assert!(frame["at"][1].as_u64().unwrap() > 0);
}

/// A check of the GPU recording API (the prelude's) fails at the template's call.
#[test]
fn a_recording_api_error_is_at_its_line() {
    let (_, exit, first) = located(
        r#"async function main() {
  widget.render(ui.canvas({ key: "scene", gpu: true, height: 100 }))
  const device = await widget.gpu.requestDevice()
  device.createBuffer()
  await widget.frame()
}
"#,
        None,
    );
    assert_eq!(
        failure(exit, first),
        (Some("ExecutionFailure".into()), None, 4)
    );
}

/// An invalid draw fails in phase `draw` at the template's `widget.draw`.
#[test]
fn an_invalid_draw_is_at_its_line() {
    let (_, exit, first) = located(
        "async function main() {\n  widget.render(ui.canvas({ key: \"c\", height: 10 }))\n  widget.draw(\"c\", [[\"bogus\"]])\n  await widget.frame()\n}\n",
        None,
    );
    assert_eq!(failure(exit, first), (None, Some("draw"), 3));
}
