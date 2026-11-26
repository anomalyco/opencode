//! The `wgsl` shorthand ([`widget_wire::shorthand`]) on a real device (Vulkan: lavapipe on a machine without a GPU;
//! `--features metal` on a Mac): its frames by their pixels, WGSL errors, the 50 ms rule, hangs, strikes and device
//! loss.

mod common;

use psychoscript_gpu::{ErrorKind, HANG_MESSAGE};
use widget_wire::shorthand::{SLOW_MESSAGE, Shorthand, Uniforms};

const W: u32 = 64;
const H: u32 = 64;
const RGBA: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

#[test]
fn a_shorthand_moves_between_threads() {
    fn send<T: Send>() {}
    send::<Shorthand>();
}

/// The tests that time GPU work run alone: lavapipe's threads are shared, so the others wait for them.
static GPU: std::sync::RwLock<()> = std::sync::RwLock::new(());

fn timed() -> std::sync::RwLockWriteGuard<'static, ()> {
    GPU.write()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn shared() -> std::sync::RwLockReadGuard<'static, ()> {
    GPU.read()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// Polls `f` every 10 ms until it gives something, for at most `seconds`.
fn until<T>(seconds: f64, mut f: impl FnMut() -> Option<T>) -> Option<T> {
    let start = std::time::Instant::now();
    while start.elapsed().as_secs_f64() < seconds {
        if let Some(t) = f() {
            return Some(t);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    None
}

const PLASMA: &str = "fn shade(frag: vec2f) -> vec4f {
    let uv = frag / widget.resolution;
    return vec4f(uv.x * widget.values[0].x, widget.values[0].y, widget.pointer.z, 1.0);
}";

#[test]
fn the_wgsl_shorthand() {
    let _gpu = shared();
    let (device, queue) = common::device();
    let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, PLASMA).unwrap();
    let mut values = [0.0; 16];
    values[0] = 1.0;
    values[1] = 0.5;
    let u = Uniforms {
        time: 1.0,
        scale: 2.0,
        pointer: [0.0, 0.0, 1.0, 0.0],
        values,
    };
    s.render(W, H, &u).unwrap();
    // A frame isn't drawn while the last one still is.
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    s.render(W, H, &u).unwrap();
    let canvas = s.canvas().unwrap();
    assert_eq!(
        (canvas.alpha, canvas.version),
        (psychoscript_gpu::AlphaMode::Premultiplied, 2)
    );
    let p = common::read(&device, &queue, canvas.texture);
    let (left, right) = (p[(32 * W) as usize], p[(32 * W + W - 1) as usize]);
    assert_eq!((left[1], left[2], left[3]), (128, 255, 255));
    assert!(left[0] < 5 && right[0] > 250, "{left:?} {right:?}");

    let wgsl = "fn shade(frag: vec2f) -> vec4f {\n  return vec4f(frag, 0.0 1.0);\n}";
    let Err(e) = Shorthand::new(device, queue, RGBA, wgsl) else {
        panic!("compiled")
    };
    assert_eq!(e.kind, ErrorKind::Program);
    assert!(
        e.message.ends_with("(WGSL line 2, column 26)"),
        "{}",
        e.message
    );
}

/// Renders `s` every 5 ms for at most `seconds`, or until it stops for being too slow: how many calls, and the
/// longest one took.
fn run_for(s: &mut Shorthand, seconds: f64) -> (u32, std::time::Duration) {
    let start = std::time::Instant::now();
    let (mut calls, mut longest) = (0, std::time::Duration::ZERO);
    let u = Uniforms {
        scale: 1.0,
        ..Default::default()
    };
    while start.elapsed().as_secs_f64() < seconds && !s.too_slow() {
        let at = std::time::Instant::now();
        s.render(256, 256, &u).unwrap();
        longest = longest.max(at.elapsed());
        calls += 1;
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    (calls, longest)
}

/// Over 50 ms a frame three frames in a row: the shader stops on its last frame, a client error; `render` never
/// waits for the GPU.
#[test]
fn a_shader_too_slow_stops_on_its_last_frame() {
    let _timed = timed();
    let Some((device, queue)) = common::hang_device() else {
        return;
    };
    // Frames of about 120 ms: past 50, well under the 250 ms of a hang.
    let steps = steps_for(&device, &queue, 120);
    let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, &costly(steps)).unwrap();
    let (calls, longest) = run_for(&mut s, 30.0);
    assert!(s.too_slow(), "not stopped after {calls} calls");
    let e = s.error().unwrap();
    assert_eq!(
        (e.kind, e.message.as_str()),
        (ErrorKind::Client, SLOW_MESSAGE)
    );
    // Three frames drew (or were drawing): one at a time, never queued behind each other.
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let version = s.canvas().unwrap().version;
    assert_eq!(version, 3, "{calls} calls");
    // It keeps its last frame, and draws no more.
    s.render(256, 256, &Uniforms::default()).unwrap();
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    assert_eq!(s.canvas().unwrap().version, version);
    assert!(
        longest < std::time::Duration::from_millis(40),
        "a render took {longest:?}"
    );
    eprintln!("stopped after {calls} calls; the longest took {longest:?}");

    // A light shader at the same pace doesn't stop.
    let mut s = Shorthand::new(device, queue, RGBA, PLASMA).unwrap();
    let (calls, _) = run_for(&mut s, 1.0);
    assert!(!s.too_slow() && s.error().is_none());
    assert!(s.canvas().unwrap().version > 10, "{calls} calls");
}

/// A fragment shader of `widget.values[0].x` steps a pixel.
const COSTLY: &str = "fn shade(frag: vec2f) -> vec4f {
    var v = frag.x * 0.001 + frag.y;
    for (var i = 0; i < i32(widget.values[0].x); i++) { v = fract(sin(v + f32(i)) * 43758.5453); }
    return vec4f(v, 0.0, 0.0, 1.0);
}";

/// [`COSTLY`] with a fixed number of steps.
fn costly(steps: u32) -> String {
    COSTLY.replace("i32(widget.values[0].x)", &steps.to_string())
}

/// The steps a pixel for a 256 × 256 [`COSTLY`] frame of about `ms` on this machine now (lavapipe's speed varies
/// with load): measured on a frame of 2,000.
fn steps_for(device: &wgpu::Device, queue: &wgpu::Queue, ms: u32) -> u32 {
    let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, COSTLY).unwrap();
    let mut u = Uniforms {
        scale: 1.0,
        ..Default::default()
    };
    u.values[0] = 2000.0;
    let mut took = std::time::Duration::ZERO;
    for _ in 0..2 {
        let at = std::time::Instant::now();
        s.render(256, 256, &u).unwrap();
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        took = at.elapsed();
    }
    (2000.0 * ms as f64 / took.as_secs_f64().max(1e-3) / 1000.0) as u32
}

/// A frame still drawing 250 ms after its submit stops the shader with its placeholder: one frame that hangs is
/// stopped by it, where the 50 ms rule needs three; and after two slow frames, it overrides the 50 ms rule's stop.
#[test]
fn a_shader_frame_that_hangs_stops_the_canvas() {
    let _timed = timed();
    let Some((device, queue)) = common::hang_device() else {
        return;
    };
    let (slow, hangs) = (
        steps_for(&device, &queue, 120),
        steps_for(&device, &queue, 800),
    );
    // `frames` slow frames, then one that hangs: whether the 50 ms rule stopped it first, and how long it took.
    let run = |frames: u64| {
        let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, COSTLY).unwrap();
        let start = std::time::Instant::now();
        let (mut longest, mut was_slow) = (std::time::Duration::ZERO, false);
        let hung = until(20.0, || {
            let drawn = s.canvas().map_or(0, |c| c.version);
            let mut u = Uniforms {
                scale: 1.0,
                ..Default::default()
            };
            u.values[0] = if drawn < frames { slow } else { hangs } as f32;
            let at = std::time::Instant::now();
            s.render(256, 256, &u).unwrap();
            longest = longest.max(at.elapsed());
            was_slow |= s.too_slow();
            s.error().filter(|e| e.message == HANG_MESSAGE).cloned()
        });
        let e = hung.expect("no hang");
        assert_eq!(e.kind, ErrorKind::Client);
        assert!(!s.too_slow(), "a hang shows the placeholder");
        assert!(
            longest < std::time::Duration::from_millis(40),
            "a render took {longest:?}"
        );
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        (s, was_slow, start.elapsed())
    };
    let (mut s, was_slow, took) = run(0);
    assert!(
        !was_slow,
        "one frame: the hang stops it, not the 50 ms rule"
    );
    assert!(took >= psychoscript_gpu::HANG);
    // Stopped for good, a device loss included.
    s.reset(device.clone(), queue.clone()).unwrap();
    s.poll();
    assert_eq!(s.error().map(|e| e.message.as_str()), Some(HANG_MESSAGE));
    // Two slow frames, then one that hangs: the 50 ms rule stops it on its last frame, then the hang.
    let (_, was_slow, _) = run(2);
    assert!(
        was_slow,
        "the third slow frame stops it on its last frame first"
    );
}

/// A shader with a frame in flight at a loss gets a strike if a frame finished since the last; the second within
/// 30 s stops it with the hang's placeholder. Losses in a row with no frame finished in between are one strike.
#[test]
fn a_shader_struck_twice_stops() {
    let _gpu = shared();
    let (device, queue) = common::device();
    let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, PLASMA).unwrap();
    let t0 = std::time::Instant::now();
    let u = Uniforms {
        scale: 1.0,
        ..Default::default()
    };
    // A frame seen finished.
    let finish = |s: &mut Shorthand| {
        s.render(W, H, &u).unwrap();
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        s.poll();
    };
    // A loss at `at` s with a frame in flight; the error after the reset.
    let lose = |s: &mut Shorthand, at: u64| {
        s.render(W, H, &u).unwrap();
        s.lost_at(t0 + std::time::Duration::from_secs(at));
        s.reset(device.clone(), queue.clone()).unwrap();
        s.poll();
        s.error().map(|e| e.message.clone())
    };
    finish(&mut s);
    assert_eq!(lose(&mut s, 0), None);
    assert_eq!(lose(&mut s, 1), None);
    assert_eq!(lose(&mut s, 2), None);
    finish(&mut s);
    assert_eq!(lose(&mut s, 10).as_deref(), Some(HANG_MESSAGE));
    assert!(!s.too_slow());
}

/// A shader drawn again after a device loss: its handles are new ones on the new device.
#[test]
fn a_shader_draws_again_after_a_loss() {
    let _gpu = shared();
    let (device, queue) = common::device();
    let mut s = Shorthand::new(device.clone(), queue.clone(), RGBA, PLASMA).unwrap();
    let u = Uniforms {
        scale: 1.0,
        ..Default::default()
    };
    for i in 1..=3 {
        s.render(W, H, &u).unwrap();
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        s.poll();
        assert_eq!(s.error(), None, "after {} losses", i - 1);
        assert_eq!(s.canvas().unwrap().version, i);
        s.lost();
        s.reset(device.clone(), queue.clone()).unwrap();
        assert!(s.canvas().is_none());
    }
}
