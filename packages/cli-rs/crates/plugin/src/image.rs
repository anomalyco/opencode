//! Images off the UI thread (synthesis 4.2, phase Pl). The host reads an image's header first, on the UI thread, and
//! admits it by its size: its bytes and pixels, and the decoded bytes its plugin and all plugins may hold
//! ([`crate::limits`]). An admitted image decodes on a worker, with a native context of the worker's own, into
//! pixels any thread may hold; the UI thread then only copies them into the app's context. Until then the node shows
//! nothing, and over a limit it shows a placeholder.
//!
//! OpenTUI's `Image::decode` takes the app's context, which stays on the UI thread, and keeps its handle to itself,
//! so the worker calls the native decoder and copies the pixels out itself.

#![allow(unsafe_code)]

use opentui::native::{Context, ContextOptions};
use opentui::sys;

/// Straight-alpha RGBA8 pixels, rows without padding.
pub(crate) struct Pixels {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
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

/// The width and height the header of a PNG, GIF, JPEG or WebP image names.
pub(crate) fn size(bytes: &[u8]) -> Option<(u32, u32)> {
    let at = |from: usize, len: usize| bytes.get(from..from + len);
    let be = |from: usize, len: usize| Some(at(from, len)?.iter().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    let le =
        |from: usize, len: usize| Some(at(from, len)?.iter().rev().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be(16, 4)?, be(20, 4)?));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((le(6, 2)?, le(8, 2)?));
    }
    if bytes.starts_with(b"RIFF") && at(8, 4) == Some(b"WEBP") {
        return match at(12, 4)? {
            b"VP8 " => Some((le(26, 2)? & 0x3fff, le(28, 2)? & 0x3fff)),
            b"VP8L" => {
                let bits = le(21, 4)?;
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le(24, 3)? + 1, le(27, 3)? + 1)),
            _ => None,
        };
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    // JPEG: the segments up to the first start of frame, which holds the size.
    let mut from = 2;
    loop {
        if *bytes.get(from)? != 0xff {
            return None;
        }
        let marker = *bytes.get(from + 1)?;
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            return Some((be(from + 7, 2)?, be(from + 5, 2)?));
        }
        from += 2 + be(from + 2, 2)? as usize;
    }
}

/// What an image node shows.
#[derive(Clone)]
pub enum Picture {
    /// Decoded, in the app's context.
    Ready(opentui::native::Image),
    /// Admitted, and decoding on a worker; or bytes that did not decode, which show nothing.
    Pending,
    /// Past a limit, or not an image: the node shows a placeholder.
    Over,
}
