//! A shader too slow (`widgets.md`, GPU canvases), in a process of its own, on demand (`--ignored`): its work grows
//! until the GPU takes over 50 ms a frame, which may make the GPU's watchdog stop it (about 50 ms in on Apple's GPUs),
//! and the OS then recovers the GPU, the whole screen's included.

#![cfg(all(
    feature = "gpu",
    any(target_os = "macos", target_os = "ios", target_os = "android")
))]

mod gpu_support;

use std::time::{Duration, Instant};

use gpu_support::*;

/// A shader over 50 ms a frame three frames in a row (`widgets-gpu.md`): `render` returns it once, a client error, and
/// the canvas keeps its last frame, presented again at a new size. Its work grows until it is that slow here.
#[test]
#[ignore]
fn a_shader_too_slow_keeps_its_last_frame() {
    use psychoscript_mobile::GpuFailure;
    use widget_mobile::ShaderCanvas;
    const HEAVY: &str = "fn shade(frag: vec2f) -> vec4f {
    var v = frag.x * 0.001 + frag.y;
    for (var i = 0; i < i32(widget.values[0].x); i++) { v = fract(sin(v + f32(i)) * 43758.5453); }
    return vec4f(v, 0.5, 0.0, 1.0);
}";
    let surface = real::surface(256, 256);
    let canvas = ShaderCanvas::new(HEAVY.into(), surface.surface.clone(), 256, 256);
    let until = Instant::now() + Duration::from_secs(120);
    let (mut work, mut grown) = (1000.0f32, Instant::now());
    let why = loop {
        // Gently, so each step has frames enough for the 50 ms rule before the 250 ms one.
        if grown.elapsed() > Duration::from_secs(1) && work < 1e7 {
            (work, grown) = (work * 1.5, Instant::now());
        }
        match canvas.render(0.0, 1.0, vec![0.0; 4], vec![work]) {
            Ok(()) => {}
            Err(GpuFailure::Client { reason }) => break reason,
            Err(e) => panic!("{e:?}"),
        }
        assert!(Instant::now() < until, "not stopped at {work} iterations");
        std::thread::sleep(Duration::from_millis(5));
    };
    assert_eq!(why, widget_wire::shorthand::SLOW_MESSAGE);
    // Told once; the last frame stays on the surface.
    assert_eq!(canvas.render(0.0, 1.0, vec![0.0; 4], vec![work]), Ok(()));
    let shown = |done: &dyn Fn() -> bool| {
        let until = Instant::now() + Duration::from_secs(60);
        while !done() {
            assert_eq!(canvas.render(0.0, 1.0, vec![0.0; 4], vec![work]), Ok(()));
            assert!(Instant::now() < until, "{} presented", canvas.presents());
            std::thread::sleep(Duration::from_millis(10));
        }
    };
    shown(&|| canvas.presents() > 0);
    let presented = canvas.presents();
    // At a new size, the same last frame is presented again.
    canvas.resize(200, 100);
    shown(&|| {
        surface
            .pixels()
            .map_or(canvas.presents() > presented, |(w, h, _)| {
                (w, h) == (200, 100)
            })
    });
    if let Some((_, _, p)) = surface.pixels() {
        assert!(
            p.chunks(4).all(|px| px[3] == 255 && px[1] > 100),
            "not the last frame"
        );
    }
    // And nothing more.
    let presented = canvas.presents();
    for _ in 0..10 {
        assert_eq!(canvas.render(0.0, 1.0, vec![0.0; 4], vec![work]), Ok(()));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(canvas.presents(), presented);
    eprintln!("stopped at {work} iterations a pixel");
}
