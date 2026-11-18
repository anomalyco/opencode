//! The pipe carrier's frames (synthesis 3.3): a length (`u32`, little-endian), a kind byte and the payload. The length
//! is checked against the kind's cap before anything is allocated, so a header that says 4 GiB costs nothing. A frame
//! cut short, of an unknown kind or over its cap breaks the stream: nothing after it can be trusted, and the carrier
//! fails the JS host.

use std::io::{self, Read, Write};

/// A control message: JSON.
pub const CONTROL: u8 = 0;
/// A revision of a mount's tree: JSON, which may be larger.
pub const TREE: u8 = 1;
/// The first bytes of a control message from the JS host too large for one frame (CT-36: a plugin's stored value of
/// 1 MB): the pieces before a control frame, and that frame's payload, joined, are the message.
pub const PIECE: u8 = 2;

/// The largest control frame (synthesis 4.3, bigboi's limits).
pub const CONTROL_CAP: usize = 256 << 10;
/// The largest tree frame: a first open of 410 cards crossed 2.27 MB on the library carrier (P4).
pub const TREE_CAP: usize = 8 << 20;

/// Why a stream of frames broke.
#[derive(Debug, PartialEq, Eq)]
pub enum Broken {
    /// The stream ended inside a frame: `got` of the `want` bytes of its header and payload.
    Truncated {
        got: usize,
        want: usize,
    },
    UnknownKind(u8),
    TooLarge {
        kind: u8,
        len: usize,
    },
    Io(String),
}

impl std::fmt::Display for Broken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Broken::Truncated { got, want } => write!(f, "a frame cut short: {got} of {want} bytes"),
            Broken::UnknownKind(kind) => write!(f, "a frame of unknown kind {kind}"),
            Broken::TooLarge { kind, len } => write!(f, "a frame of kind {kind} and {len} bytes, over its cap"),
            Broken::Io(error) => write!(f, "{error}"),
        }
    }
}

fn cap(kind: u8) -> Option<usize> {
    match kind {
        CONTROL | PIECE => Some(CONTROL_CAP),
        TREE => Some(TREE_CAP),
        _ => None,
    }
}

/// Writes one frame.
pub fn write(out: &mut impl Write, kind: u8, payload: &[u8]) -> io::Result<()> {
    let len = u32::try_from(payload.len()).map_err(|_| io::Error::other("a frame over 4 GiB"))?;
    let mut head = [0u8; 5];
    head[..4].copy_from_slice(&len.to_le_bytes());
    head[4] = kind;
    out.write_all(&head)?;
    out.write_all(payload)
}

/// One frame as bytes, header included.
pub fn encode(kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(payload.len() + 5);
    // A `Vec` takes every write.
    let _ = write(&mut out, kind, payload);
    out
}

/// Reads the next frame: its kind and payload, `Ok(None)` at a clean end of the stream (between frames).
pub fn read(input: &mut impl Read) -> Result<Option<(u8, Vec<u8>)>, Broken> {
    let mut head = [0u8; 5];
    let got = fill(input, &mut head)?;
    if got == 0 {
        return Ok(None);
    }
    if got < head.len() {
        return Err(Broken::Truncated { got, want: head.len() });
    }
    let len = u32::from_le_bytes([head[0], head[1], head[2], head[3]]) as usize;
    let kind = head[4];
    let cap = cap(kind).ok_or(Broken::UnknownKind(kind))?;
    if len > cap {
        return Err(Broken::TooLarge { kind, len });
    }
    let mut payload = vec![0u8; len];
    let got = fill(input, &mut payload)?;
    if got < len {
        return Err(Broken::Truncated { got: head.len() + got, want: head.len() + len });
    }
    Ok(Some((kind, payload)))
}

/// Reads until `buffer` is full or the stream ends; how many bytes it read.
fn fill(input: &mut impl Read, buffer: &mut [u8]) -> Result<usize, Broken> {
    let mut got = 0;
    while got < buffer.len() {
        match input.read(&mut buffer[got..]) {
            Ok(0) => break,
            Ok(read) => got += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(Broken::Io(error.to_string())),
        }
    }
    Ok(got)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frames(mut bytes: &[u8]) -> Result<Vec<(u8, Vec<u8>)>, Broken> {
        let mut out = Vec::new();
        while let Some(frame) = read(&mut bytes)? {
            out.push(frame);
        }
        Ok(out)
    }

    // Expected: frames come back as they were written, of both kinds and of no bytes, and a stream that ends between
    // frames ends cleanly.
    #[test]
    fn frames_round_trip() {
        let mut bytes = encode(CONTROL, b"{\"type\":\"hello\"}");
        bytes.extend(encode(TREE, b"[]"));
        bytes.extend(encode(CONTROL, b""));
        let read = frames(&bytes).unwrap();
        assert_eq!(read, vec![(CONTROL, b"{\"type\":\"hello\"}".to_vec()), (TREE, b"[]".to_vec()), (CONTROL, vec![])]);
    }

    // Expected (fault operator "a buffer cut short, of an unknown kind, or random bytes" on the pipe): every cut of a
    // stream inside a frame is `Truncated`, never a frame, and nothing past the stream is read. A cut in the header
    // wants the header, whose length is not read yet.
    #[test]
    fn a_stream_cut_inside_a_frame_is_refused() {
        let bytes = encode(CONTROL, b"0123456789");
        for cut in 1..bytes.len() {
            let want = if cut < 5 { 5 } else { bytes.len() };
            assert_eq!(frames(&bytes[..cut]), Err(Broken::Truncated { got: cut, want }), "cut at {cut}");
        }
    }

    // Expected: a header over its kind's cap, by one byte, is refused before its payload is allocated or read; a frame
    // at the cap is read. An unknown kind is refused.
    #[test]
    fn caps_and_kinds_are_checked_before_the_payload() {
        let at = encode(CONTROL, &vec![b' '; CONTROL_CAP]);
        assert_eq!(frames(&at).unwrap().len(), 1);
        let mut over = (CONTROL_CAP as u32 + 1).to_le_bytes().to_vec();
        over.push(CONTROL);
        assert_eq!(frames(&over), Err(Broken::TooLarge { kind: CONTROL, len: CONTROL_CAP + 1 }));
        let mut huge = u32::MAX.to_le_bytes().to_vec();
        huge.push(TREE);
        assert_eq!(frames(&huge), Err(Broken::TooLarge { kind: TREE, len: u32::MAX as usize }));
        let tree = encode(TREE, &vec![b' '; CONTROL_CAP + 1]);
        assert_eq!(frames(&tree).unwrap().len(), 1, "a tree may be larger than a control frame");
        // A piece of a control message has the control frame's cap (CT-36).
        let mut piece = (CONTROL_CAP as u32 + 1).to_le_bytes().to_vec();
        piece.push(PIECE);
        assert_eq!(frames(&piece), Err(Broken::TooLarge { kind: PIECE, len: CONTROL_CAP + 1 }));
        assert_eq!(frames(&encode(3, b"x")), Err(Broken::UnknownKind(3)));
    }

    // Expected: random bytes are refused or read as frames within their caps; never a panic, never more than the stream.
    #[test]
    fn random_bytes_are_refused_or_framed() {
        let mut seed = 0x9e37_79b9_7f4a_7c15u64;
        for _ in 0..2_000 {
            let len = (seed % 64) as usize;
            let bytes: Vec<u8> = (0..len)
                .map(|_| {
                    seed ^= seed << 13;
                    seed ^= seed >> 7;
                    seed ^= seed << 17;
                    seed as u8
                })
                .collect();
            if let Ok(read) = frames(&bytes) {
                let total: usize = read.iter().map(|(_, payload)| payload.len() + 5).sum();
                assert_eq!(total, bytes.len());
            }
        }
    }
}
