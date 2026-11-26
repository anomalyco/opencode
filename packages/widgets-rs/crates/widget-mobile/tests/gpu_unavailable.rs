//! A GPU that turns out to be missing (`widgets-gpu.md`: unavailable is not an error), in a process of its own: the
//! device is the process's. A live run told `available: true` while the device was still being made gets `lost`,
//! its canvases `unavailable`; a `ShaderCanvas` returns the client error once.

#![cfg(feature = "gpu")]

mod gpu_support;

use gpu_support::*;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use psychoscript_mobile::GpuFailure;
use psychoscript_mobile::{GpuCanvasState, Program, gpu_fail_devices};
use serde_json::json;
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
use std::time::{Duration, Instant};
use widget_mobile::ShaderCanvas;
use widget_wire::Post;

#[test]
fn a_device_that_cant_be_made() {
    gpu_fail_devices(300);
    let p = Program::new(
        "const __widget_protocol = 2\nconst { gpu } = __input()\n__host.post({ type: \"send\", value: gpu })\n__host.post({ type: \"send\", value: await __host.receive() })\nawait __host.receive()".into(),
        "__input".into(),
    )
    .unwrap();
    let mut r = start(&p, json!(null));
    let sends = |r: &mut Run| {
        r.wait(|e| match e {
            Event::Posts(p) => p.iter().find_map(|p| match p {
                Post::Send { value, .. } => Some(value.clone()),
                _ => None,
            }),
            _ => None,
        })
    };
    // Told at once, while the device is being made.
    let format = if cfg!(any(target_os = "macos", target_os = "ios")) {
        "bgra8unorm"
    } else {
        "rgba8unorm"
    };
    assert_eq!(
        sends(&mut r),
        json!({ "available": true, "format": format })
    );
    // It can't be: its canvases go unavailable, and the program loses its GPU as on a device loss.
    let reason = r.wait(|e| match e {
        Event::Gpu(None, GpuCanvasState::Unavailable { reason }) => Some(reason.clone()),
        _ => None,
    });
    assert_eq!(reason, "no GPU device (as the test asked)");
    let lost = sends(&mut r);
    assert_eq!(lost["type"], "gpu");
    assert_eq!(lost["lost"], "unknown");
    assert_eq!(lost["message"], "no GPU device (as the test asked)");
    r.run.stop();

    // A run that starts once it is known: `available` false, the canvases unavailable, no loss.
    let mut r = start(&p, json!(null));
    assert_eq!(
        sends(&mut r),
        json!({ "available": false, "format": format })
    );
    let reason = r.wait(|e| match e {
        Event::Gpu(None, GpuCanvasState::Unavailable { reason }) => Some(reason.clone()),
        _ => None,
    });
    assert_eq!(reason, "no GPU device (as the test asked)");
    r.run.stop();

    // A shader canvas: made at once, `render` returns the client error once.
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
    {
        let real = real::surface(8, 8);
        let surface = real.surface.clone();
        let canvas = ShaderCanvas::new(
            "fn shade(frag: vec2f) -> vec4f { return vec4f(1.0); }".into(),
            surface,
            8,
            8,
        );
        let until = Instant::now() + Duration::from_secs(10);
        let e = loop {
            match canvas.render(0.0, 1.0, vec![], vec![]) {
                Ok(()) => {
                    assert!(Instant::now() < until);
                    std::thread::sleep(Duration::from_millis(2));
                }
                Err(e) => break e,
            }
        };
        assert!(matches!(e, GpuFailure::Client { .. }), "{e:?}");
        assert_eq!(canvas.render(0.0, 1.0, vec![], vec![]), Ok(()));
    }
}
