//! What the GPU tests share: live widget programs with the preludes (`packages/widget/src`, read in place),
//! and a handler that keeps what the run tells the app.

#![allow(dead_code)]

use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use psychoscript_mobile::{GpuCanvasState, LiveExit, LiveHandler, LiveOptions, LiveRun, Program};
use serde_json::{Value, json};
use widget_wire::{Post, decode_post};

const PRELUDE: &str = include_str!("../../../../../widget/src/prelude.js");
const LIVE: &str = include_str!("../../../../../widget/src/prelude-live.js");
pub const CUBE: &str = include_str!("../../../../../widget/test/fixtures/gpu/cube.json");

/// A live widget template's program (`widgets.md`, Prelude and step ABI).
pub fn live_program(source: &str) -> Arc<Program> {
    let program =
        format!("{PRELUDE}\n{LIVE}\n{source}\nreturn await __widget_live(__input(), true)");
    Arc::new(Program::new(program, "__input".into()).unwrap())
}

#[derive(Debug)]
pub enum Event {
    Posts(Vec<Post>),
    Gpu(Option<String>, GpuCanvasState),
    Exit(LiveExit),
}

pub struct Handler(Mutex<Sender<Event>>);

impl LiveHandler for Handler {
    fn on_posts(&self, _messages_json: Vec<String>) {}
    fn on_posts_bytes(&self, messages: Vec<Vec<u8>>) {
        let posts = messages.iter().map(|m| decode_post(m).unwrap()).collect();
        let _ = self.0.lock().unwrap().send(Event::Posts(posts));
    }
    fn on_warning(&self, _message: String) {}
    fn on_exit(&self, exit: LiveExit) {
        let _ = self.0.lock().unwrap().send(Event::Exit(exit));
    }
    fn on_gpu_canvas(&self, key: Option<String>, state: GpuCanvasState) {
        let _ = self.0.lock().unwrap().send(Event::Gpu(key, state));
    }
}

pub struct Run {
    pub run: Arc<LiveRun>,
    pub rx: Receiver<Event>,
    /// What came besides what a test waited for.
    pub seen: Vec<Event>,
}

pub fn start(program: &Program, data: Value) -> Run {
    let (tx, rx) = channel();
    let options = LiveOptions {
        slice_budget_ms: 60_000,
        ..Default::default()
    };
    let run = program
        .start_live(
            json!({ "data": data }).to_string(),
            Box::new(Handler(Mutex::new(tx))),
            options,
            None,
            Some(widget_mobile::widget_encoder()),
        )
        .unwrap();
    Run {
        run,
        rx,
        seen: Vec::new(),
    }
}

/// A run continued from `snapshot`, with a new handler.
pub fn restore(snapshot: Vec<u8>) -> Run {
    let (tx, rx) = channel();
    let options = LiveOptions {
        slice_budget_ms: 60_000,
        ..Default::default()
    };
    let run = LiveRun::restore(
        snapshot,
        Box::new(Handler(Mutex::new(tx))),
        "__input".into(),
        options,
        None,
        Some(widget_mobile::widget_encoder()),
    )
    .unwrap();
    Run {
        run,
        rx,
        seen: Vec::new(),
    }
}

pub fn frame(i: usize) -> String {
    json!({ "type": "frame", "frame": { "t": i as f64 / 60.0, "dt": 1.0 / 60.0, "width": 300, "height": 200,
        "scale": 2, "pointer": null, "dark": false } })
    .to_string()
}

impl Run {
    /// Waits for an event `want` picks (one that came already first), keeping the others.
    pub fn wait<T>(&mut self, mut want: impl FnMut(&Event) -> Option<T>) -> T {
        if let Some((i, t)) = self
            .seen
            .iter()
            .enumerate()
            .find_map(|(i, e)| want(e).map(|t| (i, t)))
        {
            self.seen.remove(i);
            return t;
        }
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            let left = until.saturating_duration_since(Instant::now());
            let Ok(e) = self.rx.recv_timeout(left) else {
                panic!("no event in time, after {:?}", self.seen);
            };
            if let Some(t) = want(&e) {
                return t;
            }
            if let Event::Exit(exit) = &e {
                panic!("the run ended: {exit:?} after {:?}", self.seen);
            }
            self.seen.push(e);
        }
    }

    pub fn frame_request(&mut self) {
        self.wait(|e| match e {
            Event::Posts(p) if p.contains(&Post::Frame) => Some(()),
            _ => None,
        })
    }

    /// Answers `n` frame requests.
    pub fn frames(&mut self, n: usize) {
        for i in 0..n {
            self.frame_request();
            self.run.deliver(frame(i)).unwrap();
        }
    }

    /// Waits until the canvas `key` has an image (the device may still be being made as the run starts).
    pub fn live(&mut self, key: &str) {
        let state = self.wait(|e| match e {
            Event::Gpu(Some(k), s @ GpuCanvasState::Live { .. }) if k == key => Some(s.clone()),
            _ => None,
        });
        self.seen.push(Event::Gpu(Some(key.into()), state));
    }

    pub fn gpu_events(&self) -> Vec<(Option<String>, GpuCanvasState)> {
        self.seen
            .iter()
            .filter_map(|e| match e {
                Event::Gpu(k, s) => Some((k.clone(), s.clone())),
                _ => None,
            })
            .collect()
    }
}

pub fn cube_source() -> String {
    let f: Value = serde_json::from_str(CUBE).unwrap();
    f["source"].as_str().unwrap().to_owned()
}

/// The cube's image: the clear color in the corners, the lit blue in the middle (as widget-gpu's own test has it).
pub fn assert_cube(w: u32, h: u32, p: &[u8]) {
    let at =
        |x: u32, y: u32| -> [u8; 4] { p[((y * w + x) * 4) as usize..][..4].try_into().unwrap() };
    assert_eq!(at(2, 2), [13, 13, 20, 255]);
    assert_eq!(at(w - 3, h - 3), [13, 13, 20, 255]);
    let [r, g, b, a] = at(w / 2, h / 2);
    assert_eq!(a, 255);
    assert!(b > 60 && b > g && g > r, "{:?}", at(w / 2, h / 2));
    let lit = (w / 2 - 30..w / 2 + 30)
        .filter(|&x| at(x, h / 2)[2] > 40)
        .count();
    assert_eq!(lit, 60);
}

/// Red into canvas `c`, every frame; on a device loss it tells the app (`send`) and starts again on a new device.
pub const RED: &str = r#"
async function main() {
  widget.render(ui.canvas({ key: "c", gpu: true, height: 10 }))
  for (;;) {
    const device = await widget.gpu.requestDevice()
    let lost = false
    device.lost.then((info) => { lost = true; __host.post({ type: "send", value: info }) })
    const context = widget.gpu.getContext("c")
    context.configure({ device, format: widget.gpu.getPreferredCanvasFormat(), alphaMode: "opaque" })
    while (!lost) {
      await widget.frame()
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: "clear", storeOp: "store", clearValue: [1, 0, 0, 1] }] })
      pass.end()
      device.queue.submit([encoder.finish()])
    }
  }
}"#;

/// A real surface for `w` × `h`: a `CAMetalLayer` on macOS, an `AImageReader`'s window on Android.
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
pub mod real {
    use std::ffi::c_void;
    use std::sync::Arc;

    use psychoscript_mobile::GpuSurface;

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub struct Surface {
        pub surface: Arc<GpuSurface>,
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub fn surface(_w: u32, _h: u32) -> Surface {
        use std::ffi::c_char;
        #[link(name = "QuartzCore", kind = "framework")]
        unsafe extern "C" {}
        #[link(name = "objc")]
        unsafe extern "C" {
            fn objc_getClass(name: *const c_char) -> *mut c_void;
            fn sel_registerName(name: *const c_char) -> *const c_void;
            fn objc_msgSend();
        }
        #[link(name = "CoreFoundation", kind = "framework")]
        unsafe extern "C" {
            fn CFRelease(cf: *const c_void);
        }
        // SAFETY: `[CAMetalLayer new]`, a +1 reference the surface retains again.
        unsafe {
            let send: unsafe extern "C" fn(*mut c_void, *const c_void) -> *mut c_void =
                std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
            let layer = send(
                objc_getClass(c"CAMetalLayer".as_ptr()),
                sel_registerName(c"new".as_ptr()),
            );
            let surface = GpuSurface::metal_layer(layer as u64).unwrap();
            CFRelease(layer);
            Surface { surface }
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    impl Surface {
        /// A presented image can't be read back from a `CAMetalLayer`.
        pub fn pixels(&self) -> Option<(u32, u32, Vec<u8>)> {
            None
        }
    }

    #[cfg(target_os = "android")]
    pub struct Surface {
        pub surface: Arc<GpuSurface>,
        reader: *mut c_void,
    }

    #[cfg(target_os = "android")]
    #[link(name = "mediandk")]
    unsafe extern "C" {
        fn AImageReader_newWithUsage(
            width: i32,
            height: i32,
            format: i32,
            usage: u64,
            max_images: i32,
            reader: *mut *mut c_void,
        ) -> i32;
        fn AImageReader_getWindow(reader: *mut c_void, window: *mut *mut c_void) -> i32;
        fn AImageReader_acquireLatestImage(reader: *mut c_void, image: *mut *mut c_void) -> i32;
        fn AImageReader_delete(reader: *mut c_void);
        fn AImage_getPlaneData(
            image: *mut c_void,
            plane: i32,
            data: *mut *mut u8,
            len: *mut i32,
        ) -> i32;
        fn AImage_getPlaneRowStride(image: *mut c_void, plane: i32, stride: *mut i32) -> i32;
        fn AImage_getWidth(image: *mut c_void, width: *mut i32) -> i32;
        fn AImage_getHeight(image: *mut c_void, height: *mut i32) -> i32;
        fn AImage_delete(image: *mut c_void);
    }

    #[cfg(target_os = "android")]
    #[link(name = "android")]
    unsafe extern "C" {
        fn ANativeWindow_acquire(window: *mut c_void);
    }

    #[cfg(target_os = "android")]
    pub fn surface(w: u32, h: u32) -> Surface {
        // RGBA_8888, read by the CPU.
        const RGBA: i32 = 1;
        const CPU_READ_OFTEN: u64 = 3;
        // SAFETY: the NDK's calls with valid out pointers; the window gets a reference of the surface's own.
        unsafe {
            let mut reader = std::ptr::null_mut();
            assert_eq!(
                AImageReader_newWithUsage(w as i32, h as i32, RGBA, CPU_READ_OFTEN, 4, &mut reader),
                0
            );
            let mut window = std::ptr::null_mut();
            assert_eq!(AImageReader_getWindow(reader, &mut window), 0);
            ANativeWindow_acquire(window);
            let surface = GpuSurface::android_window(window as u64).unwrap();
            Surface { surface, reader }
        }
    }

    #[cfg(target_os = "android")]
    impl Surface {
        /// The image last presented into the window, as RGBA8.
        pub fn pixels(&self) -> Option<(u32, u32, Vec<u8>)> {
            // SAFETY: as above.
            unsafe {
                let mut image = std::ptr::null_mut();
                for _ in 0..200 {
                    if AImageReader_acquireLatestImage(self.reader, &mut image) == 0 {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                if image.is_null() {
                    return None;
                }
                let (mut w, mut h, mut stride, mut len) = (0, 0, 0, 0);
                let mut data = std::ptr::null_mut();
                AImage_getWidth(image, &mut w);
                AImage_getHeight(image, &mut h);
                AImage_getPlaneRowStride(image, 0, &mut stride);
                AImage_getPlaneData(image, 0, &mut data, &mut len);
                let bytes = std::slice::from_raw_parts(data, len as usize);
                let mut out = Vec::with_capacity((w * h * 4) as usize);
                for y in 0..h as usize {
                    out.extend_from_slice(&bytes[y * stride as usize..][..w as usize * 4]);
                }
                AImage_delete(image);
                Some((w as u32, h as u32, out))
            }
        }
    }

    #[cfg(target_os = "android")]
    impl Drop for Surface {
        fn drop(&mut self) {
            // SAFETY: made in `surface`; the window it gave has a reference of its own until the surface drops.
            unsafe { AImageReader_delete(self.reader) };
        }
    }
}

/// Canvases `a` and `b` cleared red each frame, by hand-made batches (handles the program counts); at frame 1 a batch
/// into `b` names no pipeline, which stops `b`. On a loss it tells the app (`send`), posts a batch naming a handle from
/// before, and starts again with new handles.
pub const TWO: &str = r#"const __widget_protocol = 2
const { gpu } = __input()
const post = __host.post
const none = new ArrayBuffer(0)
post({ type: "render", node: { type: "column", children: [
  { type: "canvas", key: "a", gpu: true, height: 10 }, { type: "canvas", key: "b", gpu: true, height: 10 }] } })
const pass = (view) => ["pass", { colorAttachments: [{ view, resolveTarget: null, clearValue: [1, 0, 0, 1],
  loadOp: "clear", storeOp: "store" }], depthStencilAttachment: null }]
const view = (h, of) => ["view", h, of, { dimension: "2d", baseMipLevel: 0, mipLevelCount: 1, baseArrayLayer: 0,
  arrayLayerCount: 1 }]
let next = 1
const setup = () => {
  const a = next, b = next + 2
  next += 4
  post({ type: "gpu", ops: [["context", a, "a", gpu.format, "opaque"], view(a + 1, a),
    ["context", b, "b", gpu.format, "opaque"], view(b + 1, b)], bytes: none })
  return [a + 1, b + 1]
}
let views = setup()
let frame = 0
post({ type: "frame" })
for (;;) {
  const m = await __host.receive()
  if (m.type === "gpu" && m.lost) {
    post({ type: "gpu", ops: [["destroy", 2]], bytes: none })
    post({ type: "send", value: m })
    views = setup()
    continue
  }
  if (m.type !== "frame") continue
  if (frame === 1) post({ type: "gpu", ops: [pass(views[1]), ["setPipeline", 999], ["end"], ["submit"]], bytes: none })
  frame++
  post({ type: "frame", gpu: { ops: [pass(views[0]), ["end"], pass(views[1]), ["end"], ["submit"]], bytes: none } })
}
"#;
