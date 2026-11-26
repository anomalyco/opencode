//! Very heavy shaders, on demand only (`cargo test --release --test gpu_heavy -- --ignored --nocapture
//! --test-threads=1`): real GPU hangs, which make the OS recover the GPU (on a Mac the whole screen blanks a moment);
//! run one test, once, when the proof needs it:
//! a `ShaderCanvas` and a live GPU canvas whose frames take `HEAVY_MS` (default 1200) on this machine's GPU, drawn
//! for a while as an app would. What the app's thread waits, how long another queue on the same GPU (the app's own
//! UI stands in) waits for a tiny frame meanwhile, what the app is told, and that the device draws again after.

#![cfg(all(
    feature = "gpu",
    any(target_os = "macos", target_os = "ios", target_os = "android")
))]

mod gpu_support;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use gpu_support::*;
use psychoscript_mobile::{GpuCanvasState, GpuErrorKind, GpuFailure, gpu_device, gpu_wait_idle};
use serde_json::json;
use widget_mobile::ShaderCanvas;
use widget_wire::Post;

const HEAVY: &str = "fn shade(frag: vec2f) -> vec4f {
    var v = frag.x * 0.001 + frag.y;
    for (var i = 0; i < i32(widget.values[0].x); i++) { v = fract(sin(v + f32(i)) * 43758.5453); }
    return vec4f(v, 0.5, 0.0, 1.0);
}";

const SIZE: u32 = 512;

fn block<F: std::future::Future>(f: F) -> F::Output {
    let mut f = std::pin::pin!(f);
    loop {
        let waker = std::task::Waker::noop();
        if let std::task::Poll::Ready(v) =
            f.as_mut().poll(&mut std::task::Context::from_waker(waker))
        {
            return v;
        }
        std::thread::yield_now();
    }
}

/// A device of its own on the same GPU.
fn other_device() -> (wgpu::Device, wgpu::Queue) {
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL | wgpu::Backends::VULKAN,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = block(instance.request_adapter(&Default::default())).unwrap();
    block(adapter.request_device(&wgpu::DeviceDescriptor {
        required_limits: adapter.limits(),
        ..Default::default()
    }))
    .unwrap()
}

fn wait_done(device: &wgpu::Device, queue: &wgpu::Queue) {
    let done = Arc::new(AtomicBool::new(false));
    let flag = done.clone();
    queue.on_submitted_work_done(move || flag.store(true, Ordering::Release));
    while !done.load(Ordering::Acquire) {
        let _ = device.poll(wgpu::PollType::Poll);
        std::thread::sleep(Duration::from_micros(200));
    }
}

/// The shader's iterations for a frame of `HEAVY_MS` at `SIZE` × `SIZE`, measured on a device of its own.
fn iterations() -> f32 {
    let ms: f64 = std::env::var("HEAVY_MS").map_or(1200.0, |v| v.parse().unwrap());
    let (device, queue) = other_device();
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let mut n = 500.0f32;
    loop {
        // A new one each time: three frames over 50 ms in a row would stop it.
        let mut s =
            widget_wire::shorthand::Shorthand::new(device.clone(), queue.clone(), format, HEAVY)
                .unwrap();
        let mut u = widget_wire::shorthand::Uniforms::default();
        u.values[0] = n;
        let at = Instant::now();
        s.render(SIZE, SIZE, &u).unwrap();
        wait_done(&device, &queue);
        let took = at.elapsed().as_secs_f64() * 1e3;
        if took >= 25.0 {
            let n = (n as f64 * ms / took) as f32;
            eprintln!(
                "calibrated: {took:.1} ms at {} iterations, so {n} for {ms} ms a frame",
                n as f64 * took / ms
            );
            return n;
        }
        n *= 2.0;
    }
}

/// Another GPU client: a tiny frame every 16 ms on a queue of its own, in turn red and blue, read back; how long each
/// took to complete, since when the one it is on has waited, and how many weren't drawn (a GPU that dropped them, or a
/// device lost).
struct Probe {
    stop: Arc<AtomicBool>,
    took: Arc<std::sync::Mutex<Probed>>,
}

/// How long each frame took, since when the one it's on has waited, how many weren't drawn.
type Probed = (Vec<f64>, Option<Instant>, u32);

impl Probe {
    fn start() -> Probe {
        let stop = Arc::new(AtomicBool::new(false));
        let took = Arc::new(std::sync::Mutex::new((Vec::new(), None, 0)));
        let (flag, out) = (stop.clone(), took.clone());
        std::thread::spawn(move || {
            let (device, queue) = other_device();
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width: 256,
                    height: 256,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            let view = texture.create_view(&Default::default());
            let mut i = 0u32;
            while !flag.load(Ordering::SeqCst) {
                i += 1;
                let color = [wgpu::Color::RED, wgpu::Color::BLUE][(i % 2) as usize];
                let at = Instant::now();
                out.lock().unwrap().1 = Some(at);
                let mut e = device.create_command_encoder(&Default::default());
                drop(e.begin_render_pass(&wgpu::RenderPassDescriptor {
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &view,
                        resolve_target: None,
                        depth_slice: None,
                        ops: wgpu::Operations {
                            load: wgpu::LoadOp::Clear(color),
                            store: wgpu::StoreOp::Store,
                        },
                    })],
                    ..Default::default()
                }));
                let read = device.create_buffer(&wgpu::BufferDescriptor {
                    label: None,
                    size: 256,
                    usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                e.copy_texture_to_buffer(
                    texture.as_image_copy(),
                    wgpu::TexelCopyBufferInfo {
                        buffer: &read,
                        layout: wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(256),
                            rows_per_image: None,
                        },
                    },
                    wgpu::Extent3d {
                        width: 1,
                        height: 1,
                        depth_or_array_layers: 1,
                    },
                );
                queue.submit([e.finish()]);
                read.slice(..).map_async(wgpu::MapMode::Read, |_| {});
                let polled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    device.poll(wgpu::PollType::wait_indefinitely())
                }));
                let drawn = polled.as_ref().is_ok_and(|p| p.is_ok())
                    && read.slice(..).get_mapped_range().is_ok_and(|px| {
                        px[0] == if i.is_multiple_of(2) { 255 } else { 0 }
                            && px[2] == if i.is_multiple_of(2) { 0 } else { 255 }
                    });
                let mut o = out.lock().unwrap();
                o.0.push(at.elapsed().as_secs_f64() * 1e3);
                o.1 = None;
                o.2 += u32::from(!drawn);
                drop(o);
                if polled.is_err() {
                    break;
                }
                std::thread::sleep(Duration::from_millis(16).saturating_sub(at.elapsed()));
            }
        });
        Probe { stop, took }
    }

    fn finish(self) -> String {
        self.stop.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100));
        let (mut t, waiting, missed) = self.took.lock().unwrap().clone();
        t.sort_by(f64::total_cmp);
        let at = |q: f64| {
            t.get(((t.len().max(1) - 1) as f64 * q) as usize)
                .copied()
                .unwrap_or(f64::NAN)
        };
        let stuck = waiting.map_or(String::new(), |w| {
            format!("; STUCK: one has waited {:?}", w.elapsed())
        });
        format!(
            "another queue's tiny frames: {} done, {missed} NOT DRAWN, median {:.1} ms, p99 {:.1} ms, max {:.1} ms{stuck}",
            t.len(),
            at(0.5),
            at(0.99),
            at(1.0)
        )
    }
}

/// How long the shared device's GPU work took to finish, waiting 5 s at most.
fn idle() -> String {
    let at = Instant::now();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        gpu_wait_idle();
        let _ = tx.send(());
    });
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(()) => format!("the GPU was busy {:?} more", at.elapsed()),
        Err(_) => "the GPU is STUCK: its work unfinished 5 s on".into(),
    }
}

/// The app's display link: `tick` every 16 ms for `seconds`; the longest one took.
fn display_link(seconds: f64, mut tick: impl FnMut(usize) -> bool) -> Duration {
    let start = Instant::now();
    let mut longest = Duration::ZERO;
    let mut i = 0;
    while start.elapsed().as_secs_f64() < seconds {
        let at = Instant::now();
        if !tick(i) {
            break;
        }
        longest = longest.max(at.elapsed());
        i += 1;
        std::thread::sleep(Duration::from_millis(16).saturating_sub(at.elapsed()));
    }
    longest
}

#[test]
#[ignore]
fn a_heavy_shader_canvas() {
    let n = iterations();
    let surface = real::surface(SIZE, SIZE);
    let probe = Probe::start();
    let start = Instant::now();
    let canvas = ShaderCanvas::new(HEAVY.into(), surface.surface.clone(), SIZE, SIZE);
    let mut told = Vec::new();
    let longest = display_link(20.0, |i| {
        match canvas.render(i as f32 / 60.0, 1.0, vec![0.0; 4], vec![n]) {
            Ok(()) => {}
            Err(e) => told.push((start.elapsed(), e)),
        }
        true
    });
    eprintln!(
        "render() on the app's thread: longest {longest:?}; told {told:?}; {} presents",
        canvas.presents()
    );
    let at = Instant::now();
    drop(canvas);
    eprintln!("dropping the canvas took {:?}", at.elapsed());
    eprintln!("{}", idle());
    eprintln!("{}", probe.finish());
    assert!(
        matches!(told.as_slice(), [(_, GpuFailure::Client { .. })]),
        "{told:?}"
    );

    // The device draws again.
    let light = ShaderCanvas::new(
        "fn shade(frag: vec2f) -> vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }".into(),
        surface.surface.clone(),
        SIZE,
        SIZE,
    );
    let until = Instant::now() + Duration::from_secs(60);
    while light.presents() < 3 {
        assert_eq!(light.render(0.0, 1.0, vec![], vec![]), Ok(()));
        assert!(Instant::now() < until);
        std::thread::sleep(Duration::from_millis(16));
    }
    eprintln!(
        "a light shader canvas presents after it; device {:?}",
        gpu_device()
    );
}

const LIVE: &str = r#"
const SHADER = `
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(3.0, 1.0), vec2f(-1.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}
@group(0) @binding(0) var<uniform> n: vec4f;
@fragment fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  var v = frag.x * 0.001 + frag.y;
  for (var i = 0; i < i32(n.x); i++) { v = fract(sin(v + f32(i)) * 43758.5453); }
  return vec4f(v, 0.5, 0.0, 1.0);
}`

async function main(data) {
  widget.render(ui.canvas({ key: "heavy", gpu: true, height: 200 }))
  for (;;) {
    const device = await widget.gpu.requestDevice()
    let lost = false
    device.lost.then((l) => { lost = true; __host.post({ type: "send", value: { type: "lost", reason: l.reason } }) })
    const context = widget.gpu.getContext("heavy")
    const format = widget.gpu.getPreferredCanvasFormat()
    context.configure({ device, format })
    const module = device.createShaderModule({ code: SHADER })
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format }] },
    })
    const buffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    device.queue.writeBuffer(buffer, 0, new Float32Array([data.iterations, 0, 0, 0]))
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] })
    while (!lost) {
      await widget.frame()
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
    }
  }
}
"#;

#[test]
#[ignore]
fn a_heavy_live_canvas() {
    let n = iterations();
    let mut r = start(&live_program(LIVE), json!({ "iterations": n }));
    let surface = real::surface(SIZE, SIZE);
    r.run
        .attach_surface("heavy".into(), surface.surface.clone(), SIZE, SIZE);
    let probe = Probe::start();
    let (mut requests, mut answered) = (0, 0);
    let longest = display_link(25.0, |i| {
        while let Ok(e) = r.rx.try_recv() {
            if matches!(&e, Event::Posts(p) if p.contains(&Post::Frame)) {
                requests += 1;
            }
            r.seen.push(e);
        }
        if requests > answered {
            r.run.deliver(frame(i)).unwrap();
            answered += 1;
        }
        true
    });
    let stats = r.run.gpu_stats().unwrap();
    eprintln!(
        "25 s: {answered} frames answered, {} batches replayed (longest {:.0} ms); the app's thread: longest tick {longest:?}",
        stats.batches,
        stats.replay_max_us / 1e3
    );
    eprintln!("{}", idle());
    let at = Instant::now();
    r.run.stop();
    eprintln!("stop() took {:?}", at.elapsed());
    eprintln!("{}", probe.finish());
    let events = r.gpu_events();
    let count = |f: fn(&GpuCanvasState) -> bool| events.iter().filter(|(_, s)| f(s)).count();
    eprintln!(
        "the app was told: lost {} times, live {} times; others {:?}",
        count(|s| matches!(s, GpuCanvasState::Lost { .. })),
        count(|s| matches!(s, GpuCanvasState::Live { .. })),
        events
            .iter()
            .filter(|(_, s)| !matches!(
                s,
                GpuCanvasState::Lost { .. } | GpuCanvasState::Live { .. }
            ))
            .collect::<Vec<_>>()
    );
    let lost: Vec<_> = (r.seen.iter())
        .filter_map(|e| match e {
            Event::Posts(p) => Some(p.iter().filter(|p| matches!(p, Post::Send { .. }))),
            _ => None,
        })
        .flatten()
        .collect();
    eprintln!(
        "the program got {} losses, the first {:?}",
        lost.len(),
        lost.first()
    );
    assert!(
        !events
            .iter()
            .any(|(_, s)| matches!(s, GpuCanvasState::Stopped { report: true, .. }))
    );
    // A frame this slow stops the canvas once, a client error (not reported): a hang (unfinished after 1 s), or the
    // GPU giving up on it (Metal), which loses the device once. The GPU hangs at most once.
    let stops: Vec<_> = (events.iter())
        .filter(|(_, s)| matches!(s, GpuCanvasState::Stopped { .. }))
        .collect();
    // At most once: a stop (a client error, not reported); none told to the app.
    // (A second loss: on Metal, the device made after a GPU timeout may see its first work fail while the GPU recovers.)
    assert!(stops.len() <= 1 && lost.len() <= 2, "{events:?}");
    assert!(
        stops.iter().all(|(_, s)| matches!(
            s,
            GpuCanvasState::Stopped {
                kind: GpuErrorKind::Client,
                report: false,
                ..
            }
        )),
        "{events:?}"
    );
    assert_eq!(
        count(|s| matches!(s, GpuCanvasState::Lost { .. })),
        0,
        "{events:?}"
    );
    let ms: f64 = std::env::var("HEAVY_MS").map_or(1200.0, |v| v.parse().unwrap());
    // Well under a second a frame it draws on, as slowly as the GPU does; well over, it hangs once.
    if ms < 300.0 {
        assert!(stops.is_empty() && lost.is_empty(), "{events:?}");
    }
    if ms >= 2000.0 {
        assert_eq!(stops.len(), 1, "{events:?}");
    }
}

fn read(device: &wgpu::Device, queue: &wgpu::Queue, t: &wgpu::Texture) -> Vec<u8> {
    let (w, h) = (t.width(), t.height());
    let row = (w * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: None,
        size: (row * h) as u64,
        usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
        mapped_at_creation: false,
    });
    let mut e = device.create_command_encoder(&Default::default());
    e.copy_texture_to_buffer(
        t.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: None,
            },
        },
        t.size(),
    );
    queue.submit([e.finish()]);
    buffer.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
    let data = buffer.slice(..).get_mapped_range().unwrap().to_vec();
    data.chunks(row as usize)
        .flat_map(|r| r[..(w * 4) as usize].to_vec())
        .collect()
}

/// One heavy frame at a time, each longer: how long it took and whether it drew.
#[test]
#[ignore]
fn heavy_frames_alone() {
    let (device, queue) = other_device();
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let mut n = 32000.0f32;
    for _ in 0..9 {
        let mut s =
            widget_wire::shorthand::Shorthand::new(device.clone(), queue.clone(), format, HEAVY)
                .unwrap();
        let mut u = widget_wire::shorthand::Uniforms::default();
        u.values[0] = n;
        let at = Instant::now();
        s.render(SIZE, SIZE, &u).unwrap();
        wait_done(&device, &queue);
        let took = at.elapsed();
        let p = read(&device, &queue, &s.canvas().unwrap().texture.clone());
        let drawn = p.chunks(4).filter(|px| px[1] > 100).count();
        eprintln!(
            "{n} iterations: {took:?}, {drawn} of {} pixels drawn",
            p.len() / 4
        );
        n *= 2.0;
    }
}

/// The GPU time of each widget's submits on a device just made, when its shaders and pipelines are fresh, for the 250 ms
/// hang rule (`widgets-gpu.md`, GPU hang): the four example templates (opencode `widgets` 1ef86872b) and the built-in
/// `wgsl` canvases (`backdrop.js`'s presets), at 1200 × 800, each about 1.2 s. "new device": the first device, as the
/// app starts; "after a loss": a canvas recompiling on the device that replaced a lost one (a template, which doesn't
/// recreate its device, in a new run).
#[test]
#[ignore]
fn fresh_gpu_times() {
    use psychoscript_mobile::{gpu_lose_device, gpu_submit_times};
    const TEMPLATES: [(&str, &str, &str); 4] = [
        (
            "cube",
            "cube",
            include_str!("../../../../widget/test/fixtures/gpu/templates/cube.js"),
        ),
        (
            "maze",
            "maze",
            include_str!("../../../../widget/test/fixtures/gpu/templates/maze.js"),
        ),
        (
            "post-process",
            "post",
            include_str!("../../../../widget/test/fixtures/gpu/templates/post-process.js"),
        ),
        (
            "textured-quad",
            "quad",
            include_str!("../../../../widget/test/fixtures/gpu/templates/textured-quad.js"),
        ),
    ];
    const SHADERS: [(&str, &str); 3] = [
        ("plasma", include_str!("fixtures/gpu/plasma.wgsl")),
        ("aurora", include_str!("fixtures/gpu/aurora.wgsl")),
        ("waves", include_str!("fixtures/gpu/waves.wgsl")),
    ];
    let (w, h) = (1200, 800);
    gpu_submit_times();
    let mut worst = (0f64, String::new());
    let mut report = |name: &str, phase: &str, t: Vec<f64>| {
        let first: Vec<String> = t.iter().take(5).map(|ms| format!("{ms:.1}")).collect();
        let max = t.iter().copied().fold(0f64, f64::max);
        if max > worst.0 {
            worst = (max, format!("{name}, {phase}"));
        }
        eprintln!(
            "{name:>13} {phase:<12}: {:>3} submits, the first five {:?} ms, max {max:.1} ms",
            t.len(),
            first
        );
        assert!(!t.is_empty(), "{name} {phase}: no submits");
    };
    let run = |key: &str, src: &str| {
        let surface = real::surface(w, h);
        let mut r = start(&live_program(src), json!({}));
        r.run
            .attach_surface(key.into(), surface.surface.clone(), w, h);
        let (mut requests, mut answered) = (0, 0);
        display_link(1.2, |i| {
            while let Ok(e) = r.rx.try_recv() {
                if matches!(&e, Event::Posts(p) if p.contains(&Post::Frame)) {
                    requests += 1;
                }
                r.seen.push(e);
            }
            if requests > answered {
                r.run.deliver(frame(i)).unwrap();
                answered += 1;
            }
            true
        });
        eprintln!("{}", idle());
        let events = r.gpu_events();
        assert!(
            !events
                .iter()
                .any(|(_, s)| matches!(s, GpuCanvasState::Stopped { .. })),
            "{events:?}"
        );
        (r, surface)
    };
    for (name, key, src) in TEMPLATES {
        // A device of its own: the one there is lost, the next made fresh.
        if gpu_device().is_some() {
            gpu_lose_device();
        }
        gpu_submit_times();
        let (r, _surface) = run(key, src);
        report(name, "new device", gpu_submit_times());
        // Lost while it runs; a new run on the device that replaced it.
        gpu_lose_device();
        r.run.stop();
        drop(r);
        gpu_submit_times();
        let (r, _surface) = run(key, src);
        report(name, "after a loss", gpu_submit_times());
        r.run.stop();
    }
    for (name, wgsl) in SHADERS {
        if gpu_device().is_some() {
            gpu_lose_device();
        }
        gpu_submit_times();
        let surface = real::surface(w, h);
        let canvas = ShaderCanvas::new(wgsl.into(), surface.surface.clone(), w, h);
        let frames = |c: &ShaderCanvas| {
            display_link(1.2, |i| {
                let values = vec![1.0, 0.18, 0.83, 0.75];
                assert_eq!(c.render(i as f32 / 60.0, 2.0, vec![0.0; 4], values), Ok(()));
                true
            });
            eprintln!("{}", idle());
        };
        frames(&canvas);
        report(name, "new device", gpu_submit_times());
        gpu_lose_device();
        gpu_submit_times();
        frames(&canvas);
        report(name, "after a loss", gpu_submit_times());
    }
    eprintln!(
        "the longest submit: {:.1} ms, {} (the hang rule: 250 ms); device {:?}",
        worst.0,
        worst.1,
        gpu_device()
    );
}
