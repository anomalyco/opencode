//! Images off the UI thread (synthesis 4.2, phase Pl). The host reads an image's header first, on the UI thread, and
//! admits it by its size: its bytes and pixels, and the decoded bytes its plugin and all plugins may hold
//! ([`crate::limits`]). An admitted image decodes on a worker, with a native context of the worker's own, into
//! pixels any thread may hold; the UI thread then only copies them into the app's context. Until then the node shows
//! nothing, and over a limit it shows a placeholder.
//!
//! OpenTUI's `Image::decode` takes the app's context, which stays on the UI thread, and keeps its handle to itself,
//! so the worker calls the native decoder and copies the pixels out itself.

#![allow(unsafe_code)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::{Rc, Weak};
use std::sync::{Arc, Condvar, Mutex, OnceLock, PoisonError, mpsc};

use opentui::app::ProxyError;
use opentui::native::{Context, ContextOptions};
use opentui::prelude::{App, AppProxy};
use opentui::sys;

use crate::limits;

/// The decoded bytes an image's job reserved for its plugin: the job holds them while it runs and its pixels wait for
/// the UI thread, and gives them back when it is dropped, unless its mount took them over with the pixels (review
/// bigboi 9). So a mount that closes, or a decode that fails, gives back nothing before the bytes are gone.
pub(crate) struct Reservation {
    plugin: Rc<str>,
    bytes: u64,
}

impl Reservation {
    /// Counts a job of `plugin` that reserved `bytes`, which the caller charged.
    pub(crate) fn new(plugin: Rc<str>, bytes: u64) -> Self {
        JOBS.with(|jobs| *jobs.borrow_mut().entry(plugin.to_string()).or_default() += 1);
        Self { plugin, bytes }
    }

    /// The mount holds the bytes from now on.
    pub(crate) fn take(&mut self) -> u64 {
        std::mem::take(&mut self.bytes)
    }
}

impl Drop for Reservation {
    fn drop(&mut self) {
        limits::release(&self.plugin, limits::Kind::Images, self.bytes);
        JOBS.with(|jobs| {
            let mut jobs = jobs.borrow_mut();
            if let Some(count) = jobs.get_mut(&*self.plugin) {
                *count -= 1;
            }
            jobs.retain(|_, count| *count > 0);
        });
    }
}

thread_local! {
    /// The image jobs of each plugin not done yet: decoding, or decoded and waiting for the UI thread.
    static JOBS: RefCell<HashMap<String, usize>> = RefCell::default();
}

/// The image jobs of plugin `plugin` this thread started and has not seen end.
pub fn jobs(plugin: &str) -> usize {
    JOBS.with(|jobs| jobs.borrow().get(plugin).copied().unwrap_or(0))
}

/// The plugins whose workers wait before they decode, for the tests: while [`Hold`] lives.
static HELD: (Mutex<Vec<String>>, Condvar) = (Mutex::new(Vec::new()), Condvar::new());

/// Holds the workers of plugin `plugin` before they decode, until it is dropped.
pub fn hold(plugin: &str) -> Hold {
    HELD.0.lock().unwrap_or_else(PoisonError::into_inner).push(plugin.to_owned());
    Hold(plugin.to_owned())
}

pub struct Hold(String);

impl Drop for Hold {
    fn drop(&mut self) {
        let mut held = HELD.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(at) = held.iter().position(|plugin| *plugin == self.0) {
            held.remove(at);
        }
        HELD.1.notify_all();
    }
}

/// Waits while the workers of `plugin` are held.
pub(crate) fn wait_held(plugin: &str) {
    let mut held = HELD.0.lock().unwrap_or_else(PoisonError::into_inner);
    while held.iter().any(|known| known == plugin) {
        held = HELD.1.wait(held).unwrap_or_else(PoisonError::into_inner);
    }
}

/// Straight-alpha RGBA8 pixels, rows without padding.
pub(crate) struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// The image workers: the decodes that run at once, however many images wait (review carbon 3.3).
const WORKERS: usize = 2;

/// What a worker decoded for job `0`, sent to the UI thread: a send to a full queue is tried again with the same.
struct Decoded(u64, Arc<Mutex<Option<Pixels>>>);

/// A job for a worker.
struct Request {
    job: u64,
    plugin: String,
    bytes: Arc<[u8]>,
    size: (u32, u32),
    proxy: AppProxy,
}

/// What a job does with its pixels on the UI thread.
type Done = Box<dyn FnOnce(&App, Option<Pixels>, &mut Reservation)>;

/// A job whose pixels the UI thread has not handled: the app's handler that will, the bytes it reserved, what it does.
type Waiting = (Weak<()>, Reservation, Done);

thread_local! {
    /// The jobs whose pixels the UI thread has not handled: the app's handler that will, while it lives, the bytes
    /// the job reserved, and what it does with its pixels.
    static WAITING: RefCell<HashMap<u64, Waiting>> = RefCell::default();
    /// Each app's handler of [`Decoded`], while it lives.
    static HANDLERS: RefCell<HashMap<usize, Weak<()>>> = RefCell::default();
}

/// The jobs of each plugin a worker has taken and not finished, for the tests.
static TAKEN: Mutex<Vec<(String, usize)>> = Mutex::new(Vec::new());

/// The jobs of plugin `plugin` a worker has taken and not finished: [`WORKERS`] at most, however many wait.
pub fn taken(plugin: &str) -> usize {
    let taken = TAKEN.lock().unwrap_or_else(PoisonError::into_inner);
    taken.iter().find(|(known, _)| known == plugin).map_or(0, |(_, count)| *count)
}

fn take(plugin: &str, by: isize) {
    let mut taken = TAKEN.lock().unwrap_or_else(PoisonError::into_inner);
    match taken.iter_mut().find(|(known, _)| known == plugin) {
        Some((_, count)) => *count = count.saturating_add_signed(by),
        None => taken.push((plugin.to_owned(), by.max(0) as usize)),
    }
}

/// Decodes `bytes`, which name an image of `size`, on one of the [`WORKERS`], and runs `done` with the pixels on the UI
/// thread of `app`; `reserved` stays charged until then, or until the app is gone.
pub(crate) fn submit(
    app: &App,
    job: u64,
    plugin: &str,
    (bytes, size): (Arc<[u8]>, (u32, u32)),
    reserved: Reservation,
    done: impl FnOnce(&App, Option<Pixels>, &mut Reservation) + 'static,
) {
    let handler = handler(app);
    WAITING.with(|waiting| {
        let mut waiting = waiting.borrow_mut();
        // A job of an app that is gone gives back what it reserved: no reply will come.
        waiting.retain(|_, (handler, ..)| handler.strong_count() > 0);
        waiting.insert(job, (handler, reserved, Box::new(done)));
    });
    let request = Request { job, plugin: plugin.to_owned(), bytes, size, proxy: app.proxy() };
    let _ = queue().lock().unwrap_or_else(PoisonError::into_inner).send(request);
}

/// The handler of [`Decoded`] of `app`, registered once while the app lives.
fn handler(app: &App) -> Weak<()> {
    let key = crate::schedule::key(app);
    if let Some(alive) =
        HANDLERS.with(|handlers| handlers.borrow().get(&key).filter(|known| known.strong_count() > 0).cloned())
    {
        return alive;
    }
    let token = Rc::new(());
    let alive = Rc::downgrade(&token);
    app.on_message(move |cx, decoded: &Decoded| {
        let _ = &token;
        let waiting = WAITING.with(|waiting| waiting.borrow_mut().remove(&decoded.0));
        if let Some((_, mut reserved, done)) = waiting {
            let pixels = decoded.1.lock().unwrap_or_else(PoisonError::into_inner).take();
            done(cx.app(), pixels, &mut reserved);
        }
    });
    HANDLERS.with(|handlers| handlers.borrow_mut().insert(key, alive.clone()));
    alive
}

/// The queue of the workers, which it starts.
fn queue() -> &'static Mutex<mpsc::Sender<Request>> {
    static QUEUE: OnceLock<Mutex<mpsc::Sender<Request>>> = OnceLock::new();
    QUEUE.get_or_init(|| {
        let (sender, receiver) = mpsc::channel::<Request>();
        let receiver = Arc::new(Mutex::new(receiver));
        for index in 0..WORKERS {
            let receiver = receiver.clone();
            let work = move || {
                loop {
                    let request = receiver.lock().unwrap_or_else(PoisonError::into_inner).recv();
                    let Ok(request) = request else { return };
                    take(&request.plugin, 1);
                    wait_held(&request.plugin);
                    let pixels = decode_as(&request.bytes, request.size);
                    take(&request.plugin, -1);
                    let pixels = Arc::new(Mutex::new(pixels));
                    while request.proxy.send(Decoded(request.job, pixels.clone())) == Err(ProxyError::Full) {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                    }
                }
            };
            let _ = std::thread::Builder::new().name(format!("plugin-image-{index}")).spawn(work);
        }
        Mutex::new(sender)
    })
}

/// Decodes `bytes` into pixels of `size`, as their header named it, or of `size` turned (an orientation); `None` for
/// any other: a header that names another size than the image decodes to is not shown (review carbon 3.1).
fn decode_as(bytes: &[u8], size: (u32, u32)) -> Option<Pixels> {
    decode(bytes).filter(|pixels| (pixels.width, pixels.height) == size || (pixels.height, pixels.width) == size)
}

/// Decodes `bytes` on the calling thread, in a native context of its own that it destroys before it returns: `None`
/// when they do not decode.
pub(crate) fn decode(bytes: &[u8]) -> Option<Pixels> {
    let context = Context::new(ContextOptions { object_capacity: 16, render_cells_max: 1 }).ok()?;
    let raw = context.as_raw();
    let mut handle = sys::ot_handle::default();
    // SAFETY: `raw` is valid while `context` lives, on this thread, which made it; `bytes` is read for its length
    // during the call; `handle` is written.
    if unsafe { sys::ot_image_decode(raw, bytes.as_ptr(), bytes.len() as u64, &mut handle) } != sys::OT_OK {
        return None;
    }
    let mut info = sys::ot_image_info::default();
    // SAFETY: `handle` names an image of `raw`, which `info` is written from.
    let pixels = (unsafe { sys::ot_image_get_info(raw, &handle, &mut info) } == sys::OT_OK)
        .then(|| {
            let stride = info.width.checked_mul(4)?;
            let mut rgba = vec![0u8; stride as usize * info.height as usize];
            // SAFETY: `rgba` holds `height` rows of `stride` bytes, all of which the call may write.
            let status = unsafe {
                sys::ot_image_copy_pixels(
                    raw,
                    &handle,
                    rgba.as_mut_ptr(),
                    rgba.len() as u64,
                    stride,
                    sys::OT_IMAGE_RGBA8,
                )
            };
            (status == sys::OT_OK).then_some(Pixels { width: info.width, height: info.height, rgba })
        })
        .flatten();
    // SAFETY: the image is the context's and is not used after.
    unsafe { sys::ot_image_destroy(raw, &handle) };
    pixels
}

/// The width and height the header of a PNG, GIF, JPEG or WebP image names; `None` for no image, or one without
/// pixels.
pub(crate) fn size(bytes: &[u8]) -> Option<(u32, u32)> {
    // One reader for the host and the plugins, which read a header before they show it.
    opencode_plugin_abi::image_size(bytes)
}

/// What an image node shows.
#[derive(Clone)]
pub enum Picture {
    /// Decoded, in the app's context.
    Ready(opentui::native::Image),
    /// Admitted, and decoding on a worker; or bytes that did not decode, which show nothing.
    Pending,
    /// Past a limit: the node shows a placeholder.
    Over,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG of `width` by `height` opaque pixels, stored without compression.
    fn png(width: u32, height: u32) -> Vec<u8> {
        fn chunk(out: &mut Vec<u8>, kind: &[u8], data: &[u8]) {
            out.extend((data.len() as u32).to_be_bytes());
            let mut checked = kind.to_vec();
            checked.extend(data);
            let mut crc = !0u32;
            for byte in &checked {
                crc ^= u32::from(*byte);
                for _ in 0..8 {
                    crc = if crc & 1 != 0 { (crc >> 1) ^ 0xedb8_8320 } else { crc >> 1 };
                }
            }
            out.extend(&checked);
            out.extend((!crc).to_be_bytes());
        }
        let raw: Vec<u8> =
            (0..height).flat_map(|_| std::iter::once(0).chain((0..width).flat_map(|_| [9, 9, 9, 255]))).collect();
        let mut zlib = vec![0x78, 0x01, 1];
        zlib.extend((raw.len() as u16).to_le_bytes());
        zlib.extend((!(raw.len() as u16)).to_le_bytes());
        zlib.extend(&raw);
        let (mut a, mut b) = (1u32, 0u32);
        for byte in &raw {
            a = (a + u32::from(*byte)) % 65_521;
            b = (b + a) % 65_521;
        }
        zlib.extend(((b << 16) | a).to_be_bytes());
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        chunk(
            &mut out,
            b"IHDR",
            &[width.to_be_bytes(), height.to_be_bytes()]
                .concat()
                .into_iter()
                .chain([8, 6, 0, 0, 0])
                .collect::<Vec<_>>(),
        );
        chunk(&mut out, b"IDAT", &zlib);
        chunk(&mut out, b"IEND", &[]);
        out
    }

    // Expected (rows for the reviews' mutants CM1 to CM3, and carbon 3.1): each format's header names its size as the
    // format lays it out, written here from the formats' specifications; a JPEG's fill bytes, a marker without a
    // length, and a comment that holds what looks like a frame header are read as the decoder reads them; a header that
    // names no pixels names no image.
    #[test]
    fn a_header_names_the_size_its_format_lays_out() {
        let le16 = |value: u16| value.to_le_bytes();
        let gif = [b"GIF89a".as_slice(), &le16(300), &le16(200), &[0; 8]].concat();
        let riff = |kind: &[u8], body: &[u8]| [b"RIFF".as_slice(), &[0; 4], b"WEBP", kind, &[0; 4], body].concat();
        let vp8 = riff(b"VP8 ", &[[0; 6].as_slice(), &le16(300), &le16(200), &[0; 4]].concat());
        let bits: u32 = 299 | (199 << 14);
        let vp8l = riff(b"VP8L", &[[0x2f].as_slice(), &bits.to_le_bytes(), &[0; 4]].concat());
        let vp8x = riff(b"VP8X", &[[0; 4].as_slice(), &[43, 1, 0], &[199, 0, 0], &[0; 4]].concat());
        let sof = |width: u16, height: u16| {
            [[0xff, 0xc0, 0, 17, 8].as_slice(), &height.to_be_bytes(), &width.to_be_bytes(), &[3; 12]].concat()
        };
        let jpeg = [[0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0].as_slice(), &sof(300, 200)].concat();
        // Fill bytes before a marker, a restart marker without a length, and a comment whose bytes look like a frame
        // header of 1 by 1.
        let comment = [[0xff, 0xfe, 0, 23].as_slice(), &sof(1, 1)].concat();
        let padded =
            [[0xff, 0xd8, 0xff, 0xff, 0xff, 0xd0].as_slice(), &comment, &[0xff, 0xff], &sof(300, 200)[1..]].concat();
        for (name, bytes) in [
            ("png", png(300, 200)),
            ("gif", gif),
            ("vp8", vp8),
            ("vp8l", vp8l),
            ("vp8x", vp8x),
            ("jpeg", jpeg),
            ("padded", padded),
        ] {
            assert_eq!(size(&bytes), Some((300, 200)), "{name}");
        }
        assert_eq!(size(&png(0, 200)), None, "no pixels");
        assert_eq!(size(b"not an image"), None);
    }

    // Expected (carbon 3.1): a worker shows only pixels of the size the header named, or that size turned.
    #[test]
    fn a_decode_of_another_size_than_the_header_named_shows_nothing() {
        let bytes = png(3, 2);
        assert!(decode_as(&bytes, (3, 2)).is_some());
        assert!(decode_as(&bytes, (2, 3)).is_some(), "turned");
        assert!(decode_as(&bytes, (1, 1)).is_none(), "a header that names less");
    }
}
