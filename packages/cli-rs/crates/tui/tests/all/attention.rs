//! Attention sounds (E.19b) through the whole TUI: an event the notifications plugin reacts to hands its sound to the
//! audio engine. Tests never open a playback device, so the engine mixes without one and the test reads the mix.

use std::sync::Arc;
use std::time::Duration;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::{Deps, Tui};
use serde_json::json;

use crate::support::{self, Harness};

fn mount(config: &str) -> (Harness, Memory) {
    let mut routes = vec![MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} }))];
    routes.extend(support::session_routes(&support::test_session("ses_a", "Fix the parser")));
    let memory = Memory::new(routes);
    let deps = Deps {
        config: support::config(support::decode(config)),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let harness = support::mount(100, 30, deps);
    harness.wait_for("Fix the parser");
    (harness, memory)
}

/// The loudest sample of the next second of the engine's mix, if the engine exists.
fn loudest(tui: &Tui) -> Option<f32> {
    let audio = tui.attention.sound.audio()?;
    let mut samples = vec![0.0; 48_000 * 2];
    audio.mix(&mut samples, 2).unwrap();
    Some(samples.iter().fold(0.0, |peak: f32, sample| peak.max(sample.abs())))
}

fn ask(memory: &Memory) {
    memory.emit(&json!({
        "id": "evt_asked", "created": 1, "type": "permission.asked",
        "data": { "id": "per_1", "sessionID": "ses_a", "action": "shell", "resources": ["ls -la"], "save": [] },
    }));
}

#[test]
fn a_permission_request_hands_its_sound_to_the_engine() {
    let (harness, memory) = mount(r#"{"animations":false,"attention":{"sound":true,"volume":0.5}}"#);
    ask(&memory);
    harness.wait("no sound reached the engine", || harness.tui.attention.sound.audio().is_some());
    let peak = loudest(&harness.tui).unwrap();
    assert!(peak > 0.01, "the permission sound is in the mix: {peak}");
}

#[test]
fn sounds_off_creates_no_engine() {
    let (harness, memory) = mount(r#"{"animations":false,"attention":{"sound":false}}"#);
    ask(&memory);
    harness.wait_for("Permission required");
    harness.app.wait_until(Duration::from_millis(100), || false);
    assert!(loudest(&harness.tui).is_none());
}
