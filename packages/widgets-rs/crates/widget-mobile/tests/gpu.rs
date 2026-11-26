//! GPU canvases end to end (`widgets-gpu.md`): live widget programs replay their batches on this machine's device
//! (Metal on macOS, Vulkan elsewhere: lavapipe on a machine without a GPU, the Android emulator's), headless and into
//! real surfaces (a `CAMetalLayer` on macOS, an `AImageReader`'s window on Android, whose presented pixels are read
//! back). A device loss is `gpu_loss.rs`'s, in a process of its own.

#![cfg(feature = "gpu")]

mod gpu_support;

use std::time::Duration;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use std::time::Instant;

use gpu_support::*;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use psychoscript_mobile::LiveRun;
use psychoscript_mobile::{GpuCanvasState, GpuErrorKind, Program, gpu_device};
use serde_json::json;
use widget_wire::Post;

#[test]
fn the_live_input_tells_the_program_its_gpu() {
    let p = Program::new(
        "const __widget_protocol = 2\nconst { gpu } = __input()\n__host.post({ type: \"send\", value: gpu })\nawait __host.receive()".into(),
        "__input".into(),
    )
    .unwrap();
    let mut r = start(&p, json!(null));
    let gpu = r.wait(|e| match e {
        Event::Posts(p) => p.iter().find_map(|p| match p {
            Post::Send { value, .. } => Some(value.clone()),
            _ => None,
        }),
        _ => None,
    });
    let format = if cfg!(any(target_os = "macos", target_os = "ios")) {
        "bgra8unorm"
    } else {
        "rgba8unorm"
    };
    assert_eq!(gpu, json!({ "available": true, "format": format }));
    // Made off the run's thread: the input didn't wait for it.
    let until = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let d = loop {
        if let Some(d) = gpu_device() {
            break d;
        }
        assert!(std::time::Instant::now() < until);
        std::thread::sleep(std::time::Duration::from_millis(1));
    };
    eprintln!(
        "device: {} ({}), made in {:.1} ms",
        d.adapter, d.backend, d.made_ms
    );
    r.run.stop();
}

#[test]
fn the_cube_draws_headless() {
    let mut r = start(&live_program(&cube_source()), json!({}));
    // As an app would on attaching a surface: the canvas's size first.
    r.run
        .deliver(
            json!({ "type": "canvas", "key": "cube", "width": 600, "height": 480 }).to_string(),
        )
        .unwrap();
    r.frames(4);
    r.frame_request();
    r.live("cube");
    let (w, h, p) = r.run.gpu_pixels("cube").expect("an image");
    assert_eq!((w, h), (600, 480));
    assert_cube(w, h, &p);
    assert_eq!(
        r.gpu_events(),
        [(Some("cube".into()), GpuCanvasState::Live { opaque: true })]
    );
    // No batch reached the app.
    let posts: Vec<&Post> = r
        .seen
        .iter()
        .filter_map(|e| match e {
            Event::Posts(p) => Some(p),
            _ => None,
        })
        .flatten()
        .collect();
    assert!(
        posts
            .iter()
            .all(|p| !matches!(p, Post::Gpu(_) | Post::FrameGpu(_)))
    );
    let s = r.run.gpu_stats().unwrap();
    eprintln!(
        "cube: {} batches, replay {:.0} µs a batch (max {:.0})",
        s.batches,
        s.replay_us / s.batches as f64,
        s.replay_max_us
    );
    r.run.stop();
}

#[test]
fn a_batch_of_the_wrong_shape_stops_the_canvases_and_the_run_goes_on() {
    let source = r#"
async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  __host.post({ type: "frame", gpu: { ops: [], bytes: [1, 2] } })
  await widget.frame()
  __host.post({ type: "submit", value: "on" })
}"#;
    let mut r = start(&live_program(source), json!({}));
    let stopped = r.wait(|e| match e {
        Event::Gpu(k, s @ GpuCanvasState::Stopped { .. }) => Some((k.clone(), s.clone())),
        _ => None,
    });
    // At the post that carried it.
    assert!(
        matches!(&stopped, (None, GpuCanvasState::Stopped { kind: GpuErrorKind::Program, message, report: true, line: Some(_), column: Some(_) })
            if message == "a batch's bytes must be an ArrayBuffer"),
        "{stopped:?}"
    );
    r.run.deliver(frame(0)).unwrap();
    r.wait(|e| match e {
        Event::Posts(p) if p.iter().any(|p| matches!(p, Post::Submit(v) if v == "on")) => Some(()),
        _ => None,
    });
}

/// `live` says whether the canvas is opaque, from its context's `alphaMode`: once as it goes live, again only when a
/// reconfigure changes it, never per frame.
#[test]
fn live_says_whether_the_canvas_is_opaque() {
    let source = r#"
async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  const device = await widget.gpu.requestDevice()
  const context = widget.gpu.getContext("c")
  const draw = async (frames) => {
    for (let i = 0; i < frames; i++) {
      await widget.frame()
      const encoder = device.createCommandEncoder()
      encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0.5, 0.5] }] }).end()
      device.queue.submit([encoder.finish()])
    }
  }
  const format = widget.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: "premultiplied" })
  await draw(3)
  context.configure({ device, format, alphaMode: "premultiplied" })
  await draw(3)
  context.configure({ device, format, alphaMode: "opaque" })
  await draw(3)
  await widget.frame()
}"#;
    let mut r = start(&live_program(source), json!({}));
    r.run
        .deliver(json!({ "type": "canvas", "key": "c", "width": 8, "height": 8 }).to_string())
        .unwrap();
    // Nine frames drawn (what the program posts while the device is made replays once it is there).
    r.frames(9);
    r.frame_request();
    r.wait(|e| matches!(e, Event::Gpu(_, GpuCanvasState::Live { opaque: true })).then_some(()));
    r.seen.push(Event::Gpu(
        Some("c".into()),
        GpuCanvasState::Live { opaque: true },
    ));
    std::thread::sleep(Duration::from_millis(100));
    while let Ok(e) = r.rx.try_recv() {
        r.seen.push(e);
    }
    let lives: Vec<_> = (r.gpu_events().into_iter())
        .filter(|(_, s)| matches!(s, GpuCanvasState::Live { .. }))
        .collect();
    assert_eq!(
        lives,
        [
            (Some("c".into()), GpuCanvasState::Live { opaque: false }),
            (Some("c".into()), GpuCanvasState::Live { opaque: true })
        ]
    );
    r.run.stop();
}

#[test]
fn frames_replay_on_the_device() {
    let mut r = start(&live_program(RED), json!({}));
    r.run
        .deliver(json!({ "type": "canvas", "key": "c", "width": 64, "height": 32 }).to_string())
        .unwrap();
    r.frames(3);
    r.frame_request();
    r.live("c");
    let (w, h, p) = r.run.gpu_pixels("c").unwrap();
    assert_eq!((w, h), (64, 32));
    assert!(p.chunks(4).all(|px| px == [255, 0, 0, 255]));
    r.run.stop();
}

/// Waits until the run has presented at least `n` images (presents beyond the surface's rate are skipped).
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
fn presents(run: &LiveRun, n: u64) {
    let until = Instant::now() + Duration::from_secs(60);
    while run.gpu_stats().unwrap().presents < n {
        assert!(Instant::now() < until, "{:?}", run.gpu_stats());
        std::thread::sleep(Duration::from_millis(5));
    }
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn the_cube_presents_into_a_real_surface() {
    let surface = real::surface(600, 480);
    let mut r = start(&live_program(&cube_source()), json!({}));
    // Attaching gives the program the canvas's size.
    r.run
        .attach_surface("cube".into(), surface.surface.clone(), 600, 480);
    // As a display link would: a frame each 1/120 s.
    for i in 0..30 {
        r.frame_request();
        std::thread::sleep(Duration::from_millis(8));
        r.run.deliver(frame(i)).unwrap();
    }
    presents(&r.run, 1);
    let (w, h, p) = r.run.gpu_pixels("cube").unwrap();
    assert_eq!((w, h), (600, 480));
    assert_cube(w, h, &p);
    if let Some((w, h, p)) = surface.pixels() {
        assert_eq!((w, h), (600, 480));
        assert_cube(w, h, &p);
        eprintln!("the presented image is the cube");
    }
    let s = r.run.gpu_stats().unwrap();
    eprintln!(
        "cube into a surface: {} batches, replay {:.0} µs a frame after the first (that one {:.0}, its pipelines); {} presents, {:.0} µs each (max {:.0})",
        s.batches,
        (s.replay_us - s.replay_max_us) / (s.batches - 1) as f64,
        s.replay_max_us,
        s.presents,
        s.present_us / s.presents as f64,
        s.present_max_us
    );
    // Detached, it is never presented to again: the run goes on.
    r.run.detach_surface("cube".into());
    let before = r.run.gpu_stats().unwrap().presents;
    r.frames(5);
    std::thread::sleep(Duration::from_millis(100));
    assert_eq!(r.run.gpu_stats().unwrap().presents, before);
    drop(surface);
    r.frames(2);
    r.run.stop();
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn a_canvas_clamped_to_4096_is_scaled_to_its_surface() {
    let (sw, sh) = (4200, 64);
    let surface = real::surface(sw, sh);
    let mut r = start(&live_program(RED), json!({}));
    r.run
        .attach_surface("c".into(), surface.surface.clone(), sw, sh);
    r.frames(4);
    presents(&r.run, 2);
    let (w, h, _) = r.run.gpu_pixels("c").unwrap();
    assert_eq!((w, h), psychoscript_gpu::clamp_size(sw, sh));
    if let Some((w, h, p)) = surface.pixels() {
        assert_eq!((w, h), (sw, sh));
        assert!(p.chunks(4).all(|px| px == [255, 0, 0, 255]));
    }
    r.run.stop();
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn a_shader_canvas_draws_into_a_real_surface() {
    use psychoscript_mobile::GpuFailure;
    use widget_mobile::ShaderCanvas;
    let surface = real::surface(128, 64);
    let wgsl = "fn shade(frag: vec2f) -> vec4f { return vec4f(0.0, frag.x / widget.resolution.x, widget.values[0].x, 1.0); }";
    let started = Instant::now();
    let canvas = ShaderCanvas::new(wgsl.into(), surface.surface.clone(), 128, 64);
    let made = started.elapsed();
    let mut values = vec![0.0; 16];
    values[0] = 1.0;
    // As a display link would, a frame each 1/120 s; `render` only records it.
    let mut calls = Vec::new();
    for i in 0..120 {
        let started = Instant::now();
        canvas
            .render(i as f32 / 120.0, 2.0, vec![0.0; 4], values.clone())
            .unwrap();
        calls.push(started.elapsed().as_secs_f64() * 1e6);
        std::thread::sleep(Duration::from_millis(8));
    }
    let until = Instant::now() + Duration::from_secs(10);
    while canvas.presents() == 0 {
        assert!(Instant::now() < until, "nothing presented");
        std::thread::sleep(Duration::from_millis(5));
    }
    calls.sort_by(f64::total_cmp);
    eprintln!(
        "shader canvas: made in {:.0} µs; render() on the calling thread {:.1} µs (median), {:.1} µs (max); {} of 120 frames presented",
        made.as_secs_f64() * 1e6,
        calls[calls.len() / 2],
        calls[calls.len() - 1],
        canvas.presents()
    );
    if let Some((w, h, p)) = surface.pixels() {
        assert_eq!((w, h), (128, 64));
        let at = |x: usize| &p[x * 4..x * 4 + 4];
        assert_eq!(at(0)[2], 255);
        assert!(
            at(127)[1] > 250 && at(0)[1] < 5,
            "{:?} {:?}",
            at(0),
            at(127)
        );
    }
    // A WGSL error is the program's, its line the template's: `render` returns it once it is known, then nothing.
    let bad = ShaderCanvas::new(
        "fn shade(frag: vec2f) -> vec4f {\n  return nope;\n}".into(),
        surface.surface.clone(),
        8,
        8,
    );
    let message = loop {
        match bad.render(0.0, 1.0, vec![], vec![]) {
            Ok(()) => {
                assert!(Instant::now() < until + Duration::from_secs(10));
                std::thread::sleep(Duration::from_millis(2));
            }
            Err(GpuFailure::Program { reason }) => break reason,
            Err(e) => panic!("{e:?}"),
        }
    };
    assert_eq!(bad.render(0.0, 1.0, vec![], vec![]), Ok(()));
    assert!(message.contains("line 2"), "{message}");
}

#[test]
fn a_snapshot_keeps_the_stops_and_drops_handles_from_before() {
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
        matches!(e, Event::Gpu(Some(k), GpuCanvasState::Stopped { kind: GpuErrorKind::Program, message, report: true, .. })
            if k == "b" && message == "gpu op 1: no handle 999")
        .then_some(())
    });
    r.live("a");
    r.run.pause().unwrap();
    let snapshot = r.run.snapshot().unwrap();

    // Restored: the program loses its device (it sends the message on), `b` is told stopped again (not to report),
    // the batch naming a handle from before is dropped, and `a` draws again on new handles.
    let mut r = restore(snapshot);
    let stopped = GpuCanvasState::Stopped {
        kind: GpuErrorKind::Program,
        message: "gpu op 1: no handle 999".into(),
        report: false,
        line: None,
        column: None,
    };
    r.wait(|e| matches!(e, Event::Gpu(Some(k), s) if k == "b" && *s == stopped).then_some(()));
    let lost = r.wait(|e| match e {
        Event::Posts(p) => p.iter().find_map(|p| match p {
            Post::Send { value, .. } => Some(value.clone()),
            _ => None,
        }),
        _ => None,
    });
    assert_eq!(lost, json!({ "type": "gpu", "lost": "unknown" }));
    for k in ["a", "b"] {
        r.run
            .deliver(json!({ "type": "canvas", "key": k, "width": 8, "height": 8 }).to_string())
            .unwrap();
    }
    for i in 0..4 {
        r.run.deliver(frame(i)).unwrap();
    }
    r.live("a");
    let (_, _, p) = r.run.gpu_pixels("a").unwrap();
    assert!(p.chunks(4).all(|px| px == [255, 0, 0, 255]));
    // Nothing else: `b` stays stopped, no error is reported.
    std::thread::sleep(Duration::from_millis(100));
    while let Ok(e) = r.rx.try_recv() {
        r.seen.push(e);
    }
    let events = r.gpu_events();
    assert!(
        events.iter().all(|(k, s)| match s {
            GpuCanvasState::Live { .. } => k.as_deref() == Some("a"),
            GpuCanvasState::Stopped { report, .. } => !report,
            _ => false,
        }),
        "{events:?}"
    );
    r.run.stop();
}

#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn a_surface_not_laid_out_gives_the_program_no_size() {
    let p = Program::new(
        "const __widget_protocol = 2\nfor (;;) { const m = await __host.receive(); if (m.type === \"canvas\" || m.type === \"ping\") __host.post({ type: \"send\", value: m }) }".into(),
        "__input".into(),
    )
    .unwrap();
    let mut r = start(&p, json!(null));
    let surface = real::surface(8, 8);
    // The sizes the program got: everything delivered before a `ping` it echoes after them.
    let sizes = |r: &mut Run| {
        r.run
            .deliver(json!({ "type": "ping" }).to_string())
            .unwrap();
        let last = r.wait(|e| match e {
            Event::Posts(p) => p
                .iter()
                .any(|p| matches!(p, Post::Send { value, .. } if value["type"] == "ping"))
                .then(|| p.clone()),
            _ => None,
        });
        r.seen.push(Event::Posts(last));
        let sent: Vec<serde_json::Value> = r
            .seen
            .drain(..)
            .filter_map(|e| match e {
                Event::Posts(p) => Some(p),
                _ => None,
            })
            .flatten()
            .filter_map(|p| match p {
                Post::Send { value, .. } if value["type"] == "canvas" => Some(value),
                _ => None,
            })
            .collect();
        sent
    };
    r.run
        .attach_surface("c".into(), surface.surface.clone(), 0, 0);
    assert_eq!(sizes(&mut r), Vec::<serde_json::Value>::new());
    r.run
        .attach_surface("c".into(), surface.surface.clone(), 8, 0);
    assert_eq!(sizes(&mut r), Vec::<serde_json::Value>::new());
    r.run
        .attach_surface("c".into(), surface.surface.clone(), 8, 6);
    assert_eq!(
        sizes(&mut r),
        [json!({ "type": "canvas", "key": "c", "width": 8, "height": 6 })]
    );
    // Not laid out again, then the same size: nothing new.
    r.run
        .attach_surface("c".into(), surface.surface.clone(), 0, 0);
    r.run
        .attach_surface("c".into(), surface.surface.clone(), 8, 6);
    assert_eq!(sizes(&mut r), Vec::<serde_json::Value>::new());
    r.run.stop();
}

/// The built-in backdrop template's aurora (opencode `widget-templates/backdrop.js`, widgets 3efef1c62): it compiles
/// and draws on this device (the iOS Simulator's included).
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
#[test]
fn the_aurora_draws() {
    use widget_mobile::ShaderCanvas;
    const AURORA: &str = include_str!("fixtures/gpu/aurora.wgsl");
    let surface = real::surface(320, 160);
    let canvas = ShaderCanvas::new(AURORA.into(), surface.surface.clone(), 320, 160);
    // (speed, accent): the template's teal.
    let values = vec![1.0, 0.18, 0.83, 0.75];
    for i in 0..60 {
        canvas
            .render(i as f32 / 60.0, 2.0, vec![0.0; 4], values.clone())
            .unwrap();
        std::thread::sleep(Duration::from_millis(8));
    }
    let until = Instant::now() + Duration::from_secs(20);
    while canvas.presents() == 0 {
        assert_eq!(
            canvas.render(1.0, 2.0, vec![0.0; 4], values.clone()),
            Ok(())
        );
        assert!(Instant::now() < until, "nothing presented");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        canvas.render(1.0, 2.0, vec![0.0; 4], values.clone()),
        Ok(())
    );
    eprintln!("the aurora: {} frames presented", canvas.presents());
    if let Some((w, h, p)) = surface.pixels() {
        assert_eq!((w, h), (320, 160));
        // A night sky with a glow: dark at the bottom, lit somewhere above, opaque.
        assert!(p.chunks(4).all(|px| px[3] == 255));
        assert!(p.chunks(4).any(|px| px[1] > 60), "no glow");
    }
}
