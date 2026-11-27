//! A device loss (`widgets-gpu.md`, Errors and device loss), in a process of its own: the device is the process's.
//! The program is told at once, what it posts until the new device is ready waits and replays on it, and its
//! canvases draw again.

#![cfg(feature = "gpu")]

mod gpu_support;

use gpu_support::*;
use psychoscript_mobile::{GpuCanvasState, Program, gpu_device, gpu_lose_device};
use serde_json::json;
use widget_wire::Post;

/// One test at a time: the device is the process's, so a test's loss is every running test's, and each counts what
/// its own runs are told.
fn alone() -> std::sync::MutexGuard<'static, ()> {
    static ONE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    ONE.lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[test]
fn a_lost_device_is_told_to_the_program_and_replaced() {
    let _alone = alone();
    let mut r = start(&live_program(RED), json!({}));
    r.run
        .deliver(json!({ "type": "canvas", "key": "c", "width": 16, "height": 16 }).to_string())
        .unwrap();
    r.frames(3);
    r.live("c");
    gpu_lose_device();
    r.wait(|e| {
        matches!(e, Event::Gpu(Some(k), GpuCanvasState::Lost { .. }) if k == "c").then_some(())
    });
    // The prelude resolves `device.lost`; the program says so and asks for a new device.
    let lost = r.wait(|e| match e {
        Event::Posts(p) => p.iter().find_map(|p| match p {
            Post::Send { value, .. } => Some(value.clone()),
            _ => None,
        }),
        _ => None,
    });
    assert_eq!(lost["reason"], "destroyed");
    // Frames go on while the new device is made (what the program posts meanwhile waits), until it draws again.
    let lives = |r: &Run| {
        r.gpu_events()
            .iter()
            .filter(|(k, s)| k.as_deref() == Some("c") && matches!(s, GpuCanvasState::Live { .. }))
            .count()
    };
    for i in 3.. {
        r.frame_request();
        if lives(&r) == 2 {
            break;
        }
        assert!(i < 2000, "{:?}", r.gpu_events());
        r.run.deliver(frame(i)).unwrap();
    }
    eprintln!("a new device in {:.1} ms", gpu_device().unwrap().made_ms);
    let (w, h, p) = r.run.gpu_pixels("c").expect("drawn again");
    assert_eq!((w, h), (16, 16));
    assert!(p.chunks(4).all(|px| px == [255, 0, 0, 255]));
    // Drawn again: live again, and no error stopped a canvas.
    let events = r.gpu_events();
    assert_eq!(
        events
            .iter()
            .filter(|(k, s)| k.as_deref() == Some("c") && matches!(s, GpuCanvasState::Live { .. }))
            .count(),
        2,
        "{events:?}"
    );
    assert!(
        !events
            .iter()
            .any(|(_, s)| matches!(s, GpuCanvasState::Stopped { .. })),
        "{events:?}"
    );
    r.run.stop();

    // A canvas an error stopped keeps its placeholder through a loss: only the others are told `Lost`.
    let p = Program::new(TWO.into(), "__input".into()).unwrap();
    let mut r = start(&p, json!(null));
    for k in ["a", "b"] {
        r.run
            .deliver(json!({ "type": "canvas", "key": k, "width": 8, "height": 8 }).to_string())
            .unwrap();
    }
    r.frames(3);
    r.frame_request();
    r.wait(|e| {
        matches!(e, Event::Gpu(Some(k), GpuCanvasState::Stopped { .. }) if k == "b").then_some(())
    });
    r.live("a");
    gpu_lose_device();
    r.wait(|e| {
        matches!(e, Event::Gpu(Some(k), GpuCanvasState::Lost { .. }) if k == "a").then_some(())
    });
    // The program's `send` of the loss comes after every state the host told for it.
    r.wait(|e| match e {
        Event::Posts(p) => p
            .iter()
            .any(|p| matches!(p, Post::Send { value, .. } if value["type"] == "gpu"))
            .then_some(()),
        _ => None,
    });
    let lost: Vec<_> = (r.gpu_events().into_iter())
        .filter(|(_, s)| matches!(s, GpuCanvasState::Lost { .. }))
        .collect();
    assert!(lost.is_empty(), "{lost:?}");
    r.run.stop();
}

/// A `wgsl` canvas draws on through a device loss (`Shorthand::reset` on the new device), telling nothing.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn a_shader_canvas_draws_on_after_a_loss() {
    let _alone = alone();
    use std::time::{Duration, Instant};
    use widget_mobile::ShaderCanvas;
    let surface = real::surface(64, 64);
    let canvas = ShaderCanvas::new(
        "fn shade(frag: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }".into(),
        surface.surface.clone(),
        64,
        64,
    );
    let frames = |n: u64| {
        let until = Instant::now() + Duration::from_secs(60);
        while canvas.presents() < n {
            assert_eq!(canvas.render(0.0, 1.0, vec![], vec![]), Ok(()));
            assert!(Instant::now() < until, "{} presented", canvas.presents());
            std::thread::sleep(Duration::from_millis(16));
        }
    };
    frames(3);
    gpu_lose_device();
    let before = canvas.presents();
    frames(before + 3);
}
