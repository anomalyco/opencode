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

#[allow(unsafe_code)]
unsafe extern "C" fn notifications_create(
    host: *const opencode_plugin::abi::HostApi,
    options: opencode_plugin::abi::Bytes,
    instance: *mut *mut std::ffi::c_void,
    out: *mut opencode_plugin::abi::Owned,
) -> i32 {
    let plugin = opencode_tui::plugins::notifications::plugin();
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe {
        opencode_plugin::abi::runtime::create("loopback.notifications", plugin.setup, host, options, instance, out)
    }
}

/// The screen after a permission request, which plays a sound, and a failure of a session that is not on screen,
/// which toasts with an "Open" action. With `loopback`, the notifications plugin is wired through the byte shims of
/// the C ABI (`Loopback`), where its events and effects cross as JSON, instead of running in process.
fn notified(loopback: bool) -> String {
    let config =
        r#"{"animations":false,"attention":{"sound":true,"volume":0.5},"plugins":["-opencode.notifications"]}"#;
    let (harness, memory) =
        mount(if loopback { config } else { r#"{"animations":false,"attention":{"sound":true,"volume":0.5}}"# });
    if loopback {
        let (definition, _) = opencode_plugin::loader::native::loopback(
            &opencode_tui::plugins::host::host(&harness.tui),
            notifications_create,
        )
        .unwrap();
        opencode_tui::plugins::host::add(&harness.tui, definition);
        harness.wait_for("Fix the parser");
    }
    ask(&memory);
    harness.wait("no sound reached the engine", || harness.tui.attention.sound.audio().is_some());
    assert!(loudest(&harness.tui).unwrap() > 0.01);
    memory.emit(&json!({
        "id": "evt_failed", "created": 2, "type": "session.execution.failed",
        "durable": { "aggregateID": "ses_b", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_b", "error": { "type": "unknown", "message": "the model went away" } },
    }));
    harness.wait_for("the model went away");
    harness.app.render();
    harness.app.text()
}

// Expected: the notifications plugin plays the same sound and shows the same session toast through the C ABI's byte
// shims as in process.
#[test]
fn notifications_act_the_same_through_the_c_abi_loopback() {
    let screen = notified(true);
    assert!(screen.contains("Session failed") && screen.contains("Open"), "{screen}");
    assert_eq!(screen, notified(false));
}
