//! The `wgsl` shorthand (`widgets.md`, GPU canvases; `widgets-gpu.md`): a canvas's fragment shader, drawn on the
//! app's device by `widget_wire::shorthand::Shorthand` and presented into the app's surface, in step and live widgets alike. The
//! app's calls only record what to draw: a thread of the canvas's own waits for the device, compiles the shader and
//! renders and presents the newest frame, so the UI thread never waits on the GPU.

#[cfg(feature = "test-hooks")]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use psychoscript_mobile::{GpuFailure, GpuSurface};

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A frame's `widget` uniforms, as `render` gives them.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Uniforms {
    time: f32,
    scale: f32,
    pointer: [f32; 4],
    values: [f32; 16],
}

#[derive(Default)]
struct State {
    size: (u32, u32),
    /// The newest frame not drawn yet.
    frame: Option<Uniforms>,
    /// What stopped the canvas, and whether `render` returned it.
    error: Option<GpuFailure>,
    told: bool,
    /// Stopped for being too slow: its last frame stays, presented again at a new size.
    slow: bool,
    stop: bool,
}

struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    /// The surface, held by the canvas's thread while it presents (dropping the canvas waits for that alone).
    #[cfg_attr(not(feature = "gpu"), allow(dead_code))]
    attached: Mutex<Option<imp::Attached>>,
    #[cfg(feature = "test-hooks")]
    #[cfg_attr(not(feature = "gpu"), allow(dead_code))]
    presents: AtomicU64,
}

/// A `canvas({ wgsl, values })`: make one per canvas (it returns at once) and call [`ShaderCanvas::render`] on the
/// app's display link at the canvas's `fps`, pausing as the widget does when it isn't visible. Both are cheap on the
/// calling thread: a thread of the canvas's own compiles the shader once the device is ready (nothing is drawn
/// before), then draws and presents the newest frame. Drop it before its surface goes (Android `surfaceDestroyed`):
/// once dropped it never touches the surface again (a present in progress finishes first).
#[derive(uniffi::Object)]
pub struct ShaderCanvas {
    shared: Arc<Shared>,
}

impl std::fmt::Debug for ShaderCanvas {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ShaderCanvas")
    }
}

#[uniffi::export]
impl ShaderCanvas {
    /// The widget template's `wgsl` for `surface`, `width` × `height` physical pixels. Doesn't wait: a WGSL error or
    /// the lack of a GPU comes from `render` once it is known.
    #[uniffi::constructor]
    pub fn new(
        wgsl: String,
        surface: Arc<GpuSurface>,
        width: u32,
        height: u32,
    ) -> Arc<ShaderCanvas> {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                size: (width.max(1), height.max(1)),
                ..State::default()
            }),
            wake: Condvar::new(),
            attached: Mutex::new(None),
            #[cfg(feature = "test-hooks")]
            presents: AtomicU64::new(0),
        });
        imp::start(&shared, wgsl, surface, width, height);
        Arc::new(ShaderCanvas { shared })
    }

    /// The canvas's new size in physical pixels, from its next frame.
    pub fn resize(&self, width: u32, height: u32) {
        lock(&self.shared.state).size = (width.max(1), height.max(1));
    }

    /// A frame to draw: `time` in seconds since the canvas appeared, `scale` the display scale, `pointer`
    /// `[x, y, down, 0]` in physical pixels, `values` the node's (up to 16). It is drawn and presented off the calling
    /// thread; frames that come faster than the surface takes them are skipped for the newest. Returns, once, what
    /// stopped the canvas for good: `Program` for a WGSL error (its line and column the template's: report it, phase
    /// `gpu`), `Client` without a GPU (log it); either way show the placeholder (`poster`, else `alt`, else the error).
    /// A shader over 50 ms a frame three frames in a row returns `Client` (reason `the shader took over 50 ms a frame,
    /// three frames in a row`): log it and
    /// keep the surface, which keeps its last frame.
    pub fn render(
        &self,
        time: f32,
        scale: f32,
        pointer: Vec<f32>,
        values: Vec<f32>,
    ) -> Result<(), GpuFailure> {
        let mut u = Uniforms {
            time,
            scale,
            ..Uniforms::default()
        };
        for (to, from) in u.pointer.iter_mut().zip(&pointer) {
            *to = *from;
        }
        for (to, from) in u.values.iter_mut().zip(&values) {
            *to = *from;
        }
        let mut st = lock(&self.shared.state);
        let stopped = match &st.error {
            Some(e) if !st.told => Some(e.clone()),
            _ => None,
        };
        st.told |= stopped.is_some();
        if st.error.is_none() || st.slow {
            st.frame = Some(u);
            drop(st);
            self.shared.wake.notify_one();
        }
        stopped.map_or(Ok(()), Err)
    }
}

/// Rust only, for tests and benchmarks (feature `test-hooks`).
#[cfg(feature = "test-hooks")]
impl ShaderCanvas {
    /// Frames presented so far.
    pub fn presents(&self) -> u64 {
        self.shared.presents.load(Ordering::SeqCst)
    }
}

impl Drop for ShaderCanvas {
    fn drop(&mut self) {
        lock(&self.shared.state).stop = true;
        self.shared.wake.notify_one();
        // Waits for a present in progress, then the surface is released.
        let _released = lock(&self.shared.attached).take();
    }
}

#[cfg(feature = "gpu")]
mod imp {
    use std::sync::Arc;
    use std::time::Duration;

    use psychoscript_gpu::clamp_size;
    use psychoscript_mobile::gpu::device::{self, Dev, Watch};
    use widget_wire::shorthand::{SLOW_MESSAGE, Shorthand, Uniforms};

    /// A GPU hang that stopped the shader (`widgets-gpu.md`; a client error, the placeholder shows).
    fn hung(shorthand: &Shorthand) -> Option<GpuFailure> {
        (!shorthand.too_slow())
            .then(|| shorthand.error().cloned())
            .flatten()
            .map(Into::into)
    }

    pub(super) use psychoscript_mobile::gpu::present::Attached;
    use psychoscript_mobile::gpu::present::{Blit, Frame, Shown};
    use psychoscript_mobile::{GpuFailure, GpuSurface};

    use super::{PoisonError, Shared, lock};

    /// Starts the canvas's thread.
    pub(super) fn start(
        shared: &Arc<Shared>,
        wgsl: String,
        surface: Arc<GpuSurface>,
        width: u32,
        height: u32,
    ) {
        *lock(&shared.attached) = Some(Attached::new(surface, width, height));
        let s = shared.clone();
        let spawned = std::thread::Builder::new()
            .name("psychoscript-gpu-shader".into())
            .spawn(move || run(&s, &wgsl));
        if spawned.is_err() {
            fail(shared, GpuFailure::client("no thread for the canvas"));
        }
    }

    fn fail(s: &Shared, e: GpuFailure) {
        lock(&s.state).error = Some(e);
    }

    /// The device once it is made (polled, so dropping the canvas meanwhile ends the thread at once), or why none.
    fn device(s: &Shared) -> Option<Result<Arc<Dev>, String>> {
        device::prepare();
        loop {
            if let Some(ready) = device::ready() {
                return Some(ready);
            }
            let st = lock(&s.state);
            if st.stop {
                return None;
            }
            let (st, _) = s
                .wake
                .wait_timeout(st, Duration::from_millis(5))
                .unwrap_or_else(PoisonError::into_inner);
            if st.stop {
                return None;
            }
        }
    }

    fn compile(dev: &Dev, wgsl: &str) -> Result<Shorthand, GpuFailure> {
        let submits = device::submits();
        let made = Shorthand::new(dev.device.clone(), dev.queue.clone(), dev.format, wgsl);
        drop(submits);
        Ok(made?)
    }

    fn run(s: &Shared, wgsl: &str) {
        let mut dev = match device(s) {
            None => return,
            Some(Err(why)) => return fail(s, GpuFailure::client(why)),
            Some(Ok(dev)) => dev,
        };
        let mut shorthand = match compile(&dev, wgsl) {
            Ok(shorthand) => shorthand,
            Err(e) => return fail(s, e),
        };
        let mut blit = Blit::default();
        // The canvas's version last drawn, and last presented (at what size).
        let mut drawn = 0;
        let mut shown = (0, (0, 0));
        // The frame the GPU is on: presented once it is done (a present never waits behind it, and the shader is looked
        // at while it draws, for the slow rule).
        let mut drawing: Option<Arc<Watch>> = None;
        let mut slow = false;
        loop {
            // The newest frame, at the newest size; while the GPU is on one, every 2 ms without.
            let (u, size) = {
                let mut st = lock(&s.state);
                loop {
                    if st.stop {
                        return;
                    }
                    if st.frame.is_none() && drawing.is_some() {
                        st = (s.wake.wait_timeout(st, Duration::from_millis(2)))
                            .unwrap_or_else(PoisonError::into_inner)
                            .0;
                        if st.stop {
                            return;
                        }
                        break (st.frame.take(), st.size);
                    }
                    if let Some(u) = st.frame.take() {
                        break (Some(u), st.size);
                    }
                    st = s.wake.wait(st).unwrap_or_else(PoisonError::into_inner);
                }
            };
            if drawing.as_ref().is_some_and(|w| w.done(&dev)) {
                drawing = None;
            }
            if u.is_none() {
                // No frame from the app: the one the GPU is on is still watched (the hang rule).
                shorthand.poll();
                if let Some(e) = hung(&shorthand) {
                    return fail(s, e);
                }
                if drawing.is_some() {
                    continue;
                }
            }
            // After a device loss, the same shader on the new device; no frames until there is one.
            let Some(now) = device::current() else {
                continue;
            };
            if now.generation != dev.generation {
                // A frame the GPU hung on (`Shorthand::lost`: the loss found it unfinished) would hang every new
                // device: it stops, a client error, and as its frame is lost the placeholder shows.
                shorthand.lost();
                if let Some(e) = hung(&shorthand) {
                    return fail(s, e);
                }
                // One stopped for being too slow stays stopped.
                if slow {
                    return;
                }
                dev = now;
                (drawing, drawn, shown) = (None, 0, (0, (0, 0)));
                let submits = device::submits();
                let reset = shorthand.reset(dev.device.clone(), dev.queue.clone());
                drop(submits);
                if let Err(e) = reset {
                    return fail(s, e.into());
                }
            }
            if let Some(u) = u {
                let uniforms = Uniforms {
                    time: u.time,
                    scale: u.scale,
                    pointer: u.pointer,
                    values: u.values,
                };
                let (w, h) = clamp_size(size.0, size.1);
                let submits = device::submits();
                let rendered = shorthand.render(w, h, &uniforms);
                // `render` draws nothing while the last frame is still drawing.
                let new = shorthand
                    .canvas()
                    .map(|c| c.version)
                    .filter(|v| *v != drawn);
                if let Some(v) = new {
                    drawn = v;
                    drawing = Some(device::watch(&dev, &submits));
                }
                drop(submits);
                if let Err(e) = rendered {
                    return fail(s, e.into());
                }
                if let Some(e) = hung(&shorthand) {
                    return fail(s, e);
                }
                // Over 50 ms a frame, three frames in a row (`widgets-gpu.md`): it stops, its last frame stays on
                // the surface (not the placeholder), and the app is told once, a client error (logged, not
                // reported).
                if shorthand.too_slow() && !slow {
                    slow = true;
                    let mut st = lock(&s.state);
                    st.error = Some(GpuFailure::client(SLOW_MESSAGE));
                    st.slow = true;
                }
            }
            if drawing.is_some() {
                continue;
            }
            // A new image (or, stopped for being too slow, the last one at a new size).
            let Some(c) = shorthand
                .canvas()
                .filter(|c| c.version != shown.0 || (slow && size != shown.1))
            else {
                continue;
            };
            let version = c.version;
            let frame = Frame {
                texture: c.texture.clone(),
                alpha: c.alpha,
                dev: dev.clone(),
            };
            let mut attached = lock(&s.attached);
            let Some(a) = attached.as_mut() else { return };
            a.resize(size.0, size.1);
            match a.present(&frame, &mut blit) {
                Ok(Shown::Yes) => {
                    shown = (version, size);
                    #[cfg(feature = "test-hooks")]
                    s.presents.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                // No texture in time: the next frame tries again.
                Ok(_) => {}
                Err(why) => {
                    *attached = None;
                    return fail(s, GpuFailure::client(why));
                }
            }
        }
    }
}

#[cfg(not(feature = "gpu"))]
mod imp {
    use std::sync::Arc;

    use psychoscript_mobile::{GpuFailure, GpuSurface};

    use super::{Shared, lock};

    pub(super) struct Attached;

    pub(super) fn start(s: &Arc<Shared>, _: String, _: Arc<GpuSurface>, _: u32, _: u32) {
        lock(&s.state).error = Some(GpuFailure::client("this build has no GPU canvases"));
    }
}
