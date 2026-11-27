//! The `wgsl` shorthand (`widgets.md`, GPU canvases; `widgets-gpu.md`): a full-screen triangle whose fragment stage is
//! the widget template's `shade`, fed the `widget` uniforms. It is a fixed batch replayed by its own
//! [`psychoscript_gpu::Gpu`], so its errors, limits and placeholder are a GPU canvas's.
//!
//! A shader that takes over 50 ms a frame three frames in a row stops and shows its last frame (`widgets.md`, GPU
//! canvases), a client error. A frame counts as slow when its GPU work is seen unfinished more than 50 ms after its
//! submit; a frame isn't drawn while the last one is still drawing, so a slow shader never queues work behind it.
//! Before that rule, whatever it has counted, a frame still unfinished 250 ms after its submit stops the canvas with
//! its placeholder (`widgets-gpu.md`, GPU hang; [`Gpu::poll`]): one frame that hangs is stopped by it, where the 50 ms
//! rule needs three. Nothing here waits for the GPU.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use psychoscript_gpu::{Canvas, ErrorKind, Gpu, GpuError, Stops};
use serde_json::json;

use crate::Arg;

/// A frame slower than this counts against a shader.
pub const SLOW_FRAME: Duration = Duration::from_millis(50);
/// Slow frames in a row that stop it.
pub const SLOW_FRAMES: u32 = 3;
/// Why a shader stopped on its last frame.
pub const SLOW_MESSAGE: &str = "the shader took over 50 ms a frame, three frames in a row";

/// What clients prepend to the widget template's `wgsl`.
pub const HEADER: &str = "struct Widget { resolution: vec2f, time: f32, scale: f32, pointer: vec4f, values: array<vec4f, 4> }
@group(0) @binding(0) var<uniform> widget: Widget;
";

/// What they append: the entry point, and the full-screen triangle's vertex stage.
const ENTRY: &str = "
@fragment fn widget_main(@builtin(position) p: vec4f) -> @location(0) vec4f { return shade(p.xy); }
@vertex fn widget_vertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    return vec4f(f32((i << 1u) & 2u) * 2.0 - 1.0, f32(i & 2u) * 2.0 - 1.0, 0.0, 1.0);
}
";

const KEY: &str = "wgsl";

/// A frame's `widget` uniforms, all but `resolution` (the size [`Shorthand::render`] takes).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Uniforms {
    /// Seconds since the canvas appeared.
    pub time: f32,
    pub scale: f32,
    /// `(x, y, down, 0)`, physical pixels.
    pub pointer: [f32; 4],
    /// The node's `values`, zero padded.
    pub values: [f32; 16],
}

/// One `wgsl` canvas.
pub struct Shorthand {
    gpu: Gpu,
    source: String,
    /// Its handles are `base + 1` to `base + 8`: after a device loss, new ones.
    base: u32,
    frame: Vec<Arg>,
    lines: usize,
    frames: Frames,
    /// It was too slow: stopped on its last frame.
    stopped: Option<GpuError>,
}

/// The 50 ms rule's count: the frame the GPU is drawing, and slow frames in a row.
#[derive(Default)]
struct Frames {
    drawing: Option<Drawing>,
    slow: u32,
}

/// A frame submitted to the GPU.
struct Drawing {
    at: Instant,
    done: Arc<AtomicBool>,
    /// Seen unfinished past [`SLOW_FRAME`], and counted.
    slow: bool,
}

impl Frames {
    /// A look at `now`: whether the frame is still drawing, counting it slow once it is past [`SLOW_FRAME`]; and
    /// whether that made [`SLOW_FRAMES`] in a row.
    fn look(&mut self, now: Instant) -> (bool, bool) {
        let Some(d) = &mut self.drawing else {
            return (false, false);
        };
        if d.done.load(Ordering::Acquire) {
            // Done between two looks, unseen past the limit: as fast as can be told.
            if !d.slow {
                self.slow = 0;
            }
            self.drawing = None;
            return (false, false);
        }
        if !d.slow && now.duration_since(d.at) > SLOW_FRAME {
            d.slow = true;
            self.slow += 1;
            return (true, self.slow >= SLOW_FRAMES);
        }
        (true, false)
    }
}

/// The frame's ops on handles from `base + 1`.
fn frame(base: u32) -> Vec<Arg> {
    let h = |n: u32| base + n;
    ops(json!([
        ["writeBuffer", h(4), 0, 0, 96],
        ["pass", { "colorAttachments": [{ "view": h(2), "resolveTarget": null, "clearValue": [0, 0, 0, 0], "loadOp": "clear", "storeOp": "store" }], "depthStencilAttachment": null }],
        ["setPipeline", h(7)],
        ["setBindGroup", 0, h(8), []],
        ["draw", 3, 1, 0, 0],
        ["end"],
        ["submit"],
    ]))
}

fn ops(v: serde_json::Value) -> Vec<Arg> {
    match Arg::from_json(&v) {
        Arg::List(l) => l,
        _ => Vec::new(),
    }
}

impl Shorthand {
    /// Compiles the widget template's `wgsl`. A WGSL error is the program's, its line and column the template's.
    pub fn new(
        device: wgpu::Device,
        queue: wgpu::Queue,
        format: wgpu::TextureFormat,
        wgsl: &str,
    ) -> Result<Shorthand, GpuError> {
        let mut s = Shorthand {
            gpu: Gpu::new(device, queue, format)?,
            source: format!("{HEADER}{wgsl}{ENTRY}"),
            base: 0,
            frame: frame(0),
            lines: wgsl.lines().count(),
            frames: Frames::default(),
            stopped: None,
        };
        s.gpu.resize(KEY, 0, 0);
        s.setup()?;
        Ok(s)
    }

    fn setup(&mut self) -> Result<(), GpuError> {
        let format = self.gpu.preferred_format();
        let h = |n: u32| self.base + n;
        let setup = ops(json!([
            ["context", h(1), KEY, format, "premultiplied"],
            ["view", h(2), h(1), { "dimension": "2d", "baseMipLevel": 0, "mipLevelCount": 1, "baseArrayLayer": 0, "arrayLayerCount": 1 }],
            ["shader", h(3), self.source],
            ["buffer", h(4), 96, 64 | 8],
            ["bindGroupLayout", h(5), { "entries": [{ "binding": 0, "visibility": 3, "sampler": null, "texture": null,
                "buffer": { "type": "uniform", "hasDynamicOffset": false, "minBindingSize": 0 } }] }],
            ["pipelineLayout", h(6), [h(5)]],
            ["renderPipeline", h(7), {
                "layout": h(6),
                "vertex": { "module": h(3), "entryPoint": "widget_vertex", "buffers": [] },
                "fragment": { "module": h(3), "entryPoint": "widget_main",
                    "targets": [{ "format": format, "blend": null, "writeMask": 15 }] },
                "primitive": { "topology": "triangle-list", "stripIndexFormat": null, "frontFace": "ccw", "cullMode": "none" },
                "depthStencil": null,
                "multisample": { "count": 1, "mask": 4294967295u32, "alphaToCoverageEnabled": false },
            }],
            ["bindGroup", h(8), { "layout": h(5), "entries": [{ "binding": 0, "resource": { "buffer": h(4), "offset": 0, "size": -1 } }] }],
        ]));
        self.gpu.apply(&setup, &[]).map_err(|e| self.relocate(e))
    }

    /// A WGSL position in the template's lines, or none when it falls outside them.
    fn relocate(&self, mut e: GpuError) -> GpuError {
        let header = HEADER.lines().count();
        if let Some(at) = e.message.rfind(" (WGSL line ") {
            let line = e.message[at + 12..]
                .split(',')
                .next()
                .and_then(|l| l.parse::<usize>().ok());
            match line {
                Some(l) if l > header && l <= header + self.lines => {
                    let rest = e.message[at..].replacen(
                        &format!("line {l},"),
                        &format!("line {},", l - header),
                        1,
                    );
                    e.message.replace_range(at.., &rest);
                }
                _ => e.message.truncate(at),
            }
        }
        e
    }

    /// Draws a frame at `width` × `height` physical pixels, unless the last one is still drawing (it is skipped) or
    /// the shader stopped. Never waits for the GPU.
    pub fn render(&mut self, width: u32, height: u32, u: &Uniforms) -> Result<(), GpuError> {
        let _ = self.gpu.poll();
        if self.stopped.is_some() || self.gpu.error(KEY).is_some() || self.drawing() {
            return Ok(());
        }
        self.gpu.resize(KEY, width, height);
        let mut f = [0f32; 24];
        f[..4].copy_from_slice(&[width as f32, height as f32, u.time, u.scale]);
        f[4..8].copy_from_slice(&u.pointer);
        f[8..].copy_from_slice(&u.values);
        let mut bytes = [0u8; 96];
        for (b, f) in bytes.as_chunks_mut::<4>().0.iter_mut().zip(f) {
            b.copy_from_slice(&f.to_le_bytes());
        }
        let r = self.gpu.apply(&self.frame, &bytes);
        self.gpu.end_frame();
        let done = Arc::new(AtomicBool::new(false));
        let flag = done.clone();
        self.gpu
            .queue()
            .on_submitted_work_done(move || flag.store(true, Ordering::Release));
        self.frames.drawing = Some(Drawing {
            at: Instant::now(),
            done,
            slow: false,
        });
        r
    }

    /// Whether the last frame is still drawing, counting it slow once it is past [`SLOW_FRAME`]; the third slow
    /// frame in a row stops the shader.
    fn drawing(&mut self) -> bool {
        if self.frames.drawing.is_none() {
            return false;
        }
        if !psychoscript_gpu::poll(self.gpu.device()) {
            // The device is lost: the frame won't finish, and doesn't count.
            self.gpu.lost();
            self.frames.drawing = None;
            return false;
        }
        let (drawing, stop) = self.frames.look(Instant::now());
        if stop {
            self.stopped = Some(GpuError {
                kind: ErrorKind::Client,
                message: SLOW_MESSAGE.into(),
                canvases: Stops::All,
            });
        }
        drawing
    }

    /// Watches the frame the GPU is drawing for the slow-frame and hang rules, as [`Shorthand::render`] does: call it
    /// each display frame while not rendering (an `fps: 0` shader), so a frame that hangs stops the canvas. Never
    /// waits.
    pub fn poll(&mut self) {
        let _ = self.gpu.poll();
        if self.stopped.is_none() && self.gpu.error(KEY).is_none() {
            self.drawing();
        }
    }

    /// Whether it stopped for being too slow ([`Shorthand::error`] is then a client error): show its last frame
    /// ([`Shorthand::canvas`]), not the placeholder. Not once a GPU hang stopped it.
    pub fn too_slow(&self) -> bool {
        self.stopped.is_some() && self.gpu.error(KEY).is_none()
    }

    /// The canvas's texture, once rendered: premultiplied, sRGB-encoded colors.
    pub fn canvas(&self) -> Option<Canvas<'_>> {
        self.gpu.canvas(KEY)
    }

    /// The error that stopped it: the program's, the client's (a GPU hang among them, [`psychoscript_gpu::HANG_MESSAGE`]), or a
    /// client error for a shader too slow ([`Shorthand::too_slow`]).
    pub fn error(&self) -> Option<&GpuError> {
        self.gpu.error(KEY).or(self.stopped.as_ref())
    }

    /// The device is lost ([`Gpu::lost`]): call it as soon as the host knows, before [`Shorthand::reset`]. A frame in
    /// flight at the loss is a strike if a frame finished since the last strike (one per reset, as [`Gpu::lost`]
    /// counts); the second within [`psychoscript_gpu::STRIKE_WINDOW`] stops the shader with [`psychoscript_gpu::HANG_MESSAGE`] and its
    /// placeholder.
    pub fn lost(&mut self) {
        self.lost_at(Instant::now());
    }

    /// [`Shorthand::lost`], the loss at `now` (a test's clock).
    pub fn lost_at(&mut self, now: Instant) {
        self.gpu.lost_at(now);
        self.frames.drawing = None;
    }

    /// After a device loss: the same shader on `device`. One that stopped for being too slow or a GPU hang stays
    /// stopped.
    pub fn reset(&mut self, device: wgpu::Device, queue: wgpu::Queue) -> Result<(), GpuError> {
        self.frames = Frames::default();
        self.gpu.reset(device, queue)?;
        // Handles keep counting up: the shader's are new ones on the new device.
        self.base = self.gpu.last_handle() as u32;
        self.frame = frame(self.base);
        self.setup()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 50 ms rule at controlled times: a frame counts slow once seen unfinished past 50 ms; three in a row stop
    /// the shader; a frame seen finished first resets the count.
    #[test]
    fn the_50_ms_rule() {
        let t0 = Instant::now();
        let ms = |n: u64| t0 + Duration::from_millis(n);
        let mut f = Frames::default();
        let submit = |f: &mut Frames, at: u64| {
            let done = Arc::new(AtomicBool::new(false));
            f.drawing = Some(Drawing {
                at: ms(at),
                done: done.clone(),
                slow: false,
            });
            done
        };
        // Two slow frames, then a fast one: the count starts again.
        for at in [0, 100] {
            let done = submit(&mut f, at);
            assert_eq!(f.look(ms(at + 30)), (true, false));
            assert_eq!(f.look(ms(at + 51)), (true, false));
            assert_eq!(f.look(ms(at + 70)), (true, false));
            done.store(true, Ordering::Release);
            assert_eq!(f.look(ms(at + 80)), (false, false));
        }
        assert_eq!(f.slow, 2);
        let done = submit(&mut f, 200);
        done.store(true, Ordering::Release);
        assert_eq!(f.look(ms(260)), (false, false));
        assert_eq!(f.slow, 0);
        // Three slow frames in a row: the third look past 50 ms stops it, once.
        for (i, at) in [300u64, 400, 500].into_iter().enumerate() {
            let done = submit(&mut f, at);
            assert_eq!(f.look(ms(at + 51)), (true, i == 2));
            assert_eq!(f.look(ms(at + 90)), (true, false));
            done.store(true, Ordering::Release);
            assert_eq!(f.look(ms(at + 95)), (false, false));
        }
        // Nothing drawing: nothing to look at.
        assert_eq!(f.look(ms(1000)), (false, false));
    }
}
