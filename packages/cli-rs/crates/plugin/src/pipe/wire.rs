//! The pipe carrier's frames: a length (`u32`, little-endian), a kind byte and the payload. The length is checked
//! against the kind's cap before anything is allocated, so a header that says 4 GiB costs nothing. A frame cut short,
//! of an unknown kind or over its cap breaks the stream: nothing after it can be trusted, and the carrier fails the JS
//! host.

use std::io::{self, Read, Write};

/// A control message: JSON.
pub const CONTROL: u8 = 0;
/// A revision of a mount's tree: JSON, which may be larger.
pub const TREE: u8 = 1;
/// Payload fragment. Concatenate consecutive pieces with the following control frame.
pub const PIECE: u8 = 2;

/// The largest control frame.
pub const CONTROL_CAP: usize = 256 << 10;
/// The largest tree frame: a first open of 410 cards crossed 2.27 MB on the library carrier.
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

    #[test]
    fn complete_frames_survive_every_stream_cut() {
        for kind in [CONTROL, TREE, PIECE] {
            for len in 0..=32 {
                let payload: Vec<u8> = (0..len).map(|n| n as u8 ^ 0xff).collect();
                let first = encode(TREE, b"prefix");
                let frame = encode(kind, &payload);
                for cut in 0..=frame.len() {
                    let stream = [first.as_slice(), &frame[..cut]].concat();
                    let mut input = stream.as_slice();
                    assert_eq!(read(&mut input), Ok(Some((TREE, b"prefix".to_vec()))));
                    match cut {
                        0 => assert_eq!(read(&mut input), Ok(None)),
                        cut if cut == frame.len() => {
                            assert_eq!(read(&mut input), Ok(Some((kind, payload.clone()))));
                            assert_eq!(read(&mut input), Ok(None));
                        }
                        got => assert_eq!(
                            read(&mut input),
                            Err(Broken::Truncated { got, want: if got < 5 { 5 } else { frame.len() } })
                        ),
                    }
                }
            }
        }
    }

    #[test]
    fn caps_and_kinds_are_checked_before_the_payload() {
        for (kind, max) in [(CONTROL, CONTROL_CAP), (PIECE, CONTROL_CAP), (TREE, TREE_CAP)] {
            let frame = encode(kind, &vec![0; max]);
            let (_, payload) = read(&mut frame.as_slice()).unwrap().unwrap();
            assert_eq!(payload.len(), max);
            for len in [max as u32 + 1, u32::MAX] {
                let header = [len.to_le_bytes().as_slice(), &[kind]].concat();
                assert_eq!(read(&mut header.as_slice()), Err(Broken::TooLarge { kind, len: len as usize }));
            }
        }
        for kind in 3..=u8::MAX {
            assert_eq!(read(&mut [0, 0, 0, 0, kind].as_slice()), Err(Broken::UnknownKind(kind)));
        }
    }
}
