//! Live OpenCode widgets as the apps run them: the widget prelude and the `minigame` built-in (copies from anomalyco/opencode
//! `packages/widget/src/`, in `fixtures/`), which wait on several host calls at once (`Promise.race` of `receive` and
//! `sleep`). Waiting must not count against the slice budget.

use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use psychoscript_mobile::{GpuCanvasState, LiveExit, LiveHandler, LiveOptions, LiveRun, Program};

const PRELUDE: &str = include_str!("fixtures/prelude.js");
const MINIGAME: &str = include_str!("fixtures/minigame.js");

enum Event {
    Post(serde_json::Value),
    Exit(LiveExit),
}

struct Handler(Mutex<Sender<Event>>);

impl LiveHandler for Handler {
    fn on_posts_bytes(&self, _messages: Vec<Vec<u8>>) {}
    fn on_posts(&self, messages_json: Vec<String>) {
        let tx = self.0.lock().unwrap();
        for m in messages_json {
            let _ = tx.send(Event::Post(serde_json::from_str(&m).unwrap()));
        }
    }
    fn on_warning(&self, _message: String) {}
    fn on_gpu_canvas(&self, _key: Option<String>, _state: GpuCanvasState) {}
    fn on_exit(&self, exit: LiveExit) {
        let _ = self.0.lock().unwrap().send(Event::Exit(exit));
    }
}

fn start(source: &str, data: serde_json::Value) -> (Arc<LiveRun>, Receiver<Event>) {
    let program = Program::new(
        format!("{PRELUDE}\n{source}\nreturn await __widget_live(__input())"),
        "__input".into(),
    )
    .unwrap();
    let (tx, rx) = channel();
    let run = program
        .start_live(
            serde_json::json!({ "data": data }).to_string(),
            Box::new(Handler(Mutex::new(tx))),
            LiveOptions::default(),
            None,
            None,
        )
        .unwrap();
    (run, rx)
}

#[test]
fn waiting_with_a_timeout_isnt_computing() {
    let source =
        "async function main() { const n = await widget.next({ timeout: 300 }); widget.submit(n) }";
    let started = Instant::now();
    let (_run, rx) = start(source, serde_json::json!({}));
    loop {
        match rx.recv_timeout(Duration::from_secs(5)).expect("an event") {
            Event::Post(p) => assert_eq!(
                p,
                serde_json::json!({ "type": "submit", "value": { "type": "timeout" } })
            ),
            Event::Exit(exit) => {
                assert_eq!(
                    exit,
                    LiveExit::Finished {
                        result_json: "null".into()
                    }
                );
                break;
            }
        }
    }
    assert!(started.elapsed() >= Duration::from_millis(300));
}

#[test]
fn minigame_plays_at_60_fps() {
    let (run, rx) = start(
        MINIGAME,
        serde_json::json!({ "title": "Tap", "seconds": 1 }),
    );
    let frame = |t: f64| {
        serde_json::json!({ "type": "frame", "frame": {
            "t": t, "dt": 1.0 / 60.0, "width": 360, "height": 320, "scale": 3, "pointer": null, "dark": false } })
        .to_string()
    };
    let start = Instant::now();
    let (mut draws, mut tapped, mut submitted) = (0, false, false);
    while start.elapsed() < Duration::from_secs(4) {
        match rx.recv_timeout(Duration::from_millis(500)) {
            // Frames as a display delivers them: at the next vsync after a request.
            Ok(Event::Post(p)) if p["type"] == "frame" => {
                std::thread::sleep(Duration::from_millis(16));
                run.deliver(frame(start.elapsed().as_secs_f64())).unwrap();
            }
            Ok(Event::Post(p)) if p["type"] == "draw" => {
                draws += 1;
                if !tapped {
                    tapped = true;
                    let tap = serde_json::json!({ "type": "event", "event": { "id": "board", "type": "pointer",
                        "value": { "kind": "down", "x": 10, "y": 10, "width": 360, "height": 320 } } });
                    run.deliver(tap.to_string()).unwrap();
                }
            }
            Ok(Event::Post(p)) if p["type"] == "render" && draws > 10 && !submitted => {
                // The result screen: submit.
                submitted = true;
                let press = serde_json::json!({ "type": "event", "event": { "id": "submit", "type": "press" } });
                run.deliver(press.to_string()).unwrap();
            }
            Ok(Event::Post(_)) => {}
            Ok(Event::Exit(exit)) => {
                assert_eq!(
                    exit,
                    LiveExit::Finished {
                        result_json: "null".into()
                    }
                );
                assert!(draws > 30, "{draws} draws");
                return;
            }
            Err(_) => {}
        }
    }
    panic!("the game didn't finish: {draws} draws, submitted {submitted}");
}
