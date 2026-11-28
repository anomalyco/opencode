//! Framed Noise transport messages after the handshake completes.
//!
//! Each carrier message is one Noise transport message whose plaintext is a tag byte
//! (`0x00` final, `0x01` more) followed by a piece of one application message. A `more`
//! piece is always exactly [`MAX_PIECE`] (65,518) bytes. Each direction rekeys after
//! every [`REKEY_INTERVAL`] (`2^20`) transport messages it carries (the welcome included),
//! without resetting the nonce.

use std::fmt;

use zeroize::{Zeroize, Zeroizing};

/// Noise maximum message length in bytes (revision 34).
pub const MAX_NOISE_MESSAGE: usize = 65_535;
/// AES-GCM authentication tag length in bytes.
pub const TAG_LEN: usize = 16;
/// Maximum payload piece per frame: `65_535 - 16 (tag) - 1 (frame tag) = 65_518`.
pub const MAX_PIECE: usize = MAX_NOISE_MESSAGE - TAG_LEN - 1;
/// Largest application message either side sends or accepts (160 MiB).
pub const MAX_MESSAGE: usize = 160 * 1024 * 1024;
/// Number of transport messages carried per direction before `REKEY()` runs (`2^20`).
pub const REKEY_INTERVAL: u64 = 1 << 20;

const TAG_FINAL: u8 = 0x00;
const TAG_MORE: u8 = 0x01;

/// Best-effort wrapper around `snow::TransportState` that overwrites both cipher keys on
/// drop. This is best effort only: `rekey_manually` assigns without a zeroization barrier,
/// and `snow` drops its DH private keys, chaining key, and temporary copies without wiping.
pub(crate) struct TransportGuard(snow::TransportState);

impl TransportGuard {
    pub(crate) fn new(transport: snow::TransportState) -> Self {
        Self(transport)
    }

    pub(crate) fn inner_mut(&mut self) -> &mut snow::TransportState {
        &mut self.0
    }
}

impl Drop for TransportGuard {
    fn drop(&mut self) {
        self.0.rekey_manually(Some(&[0u8; 32]), Some(&[0u8; 32]));
    }
}

/// Reason a framed session operation failed. Every error ends the session.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameError {
    /// The session was already ended by an earlier error.
    Closed,
    /// The outgoing or reassembled message exceeds [`MAX_MESSAGE`].
    TooLong,
    /// Carrier length out of bounds, empty decrypted frame, short `more`, or unknown tag.
    BadFrame,
    /// Noise authentication/decryption failed or nonce exhausted.
    Decrypt,
    /// Noise encryption failed (for example nonce exhaustion).
    Encrypt,
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => f.write_str("session is closed"),
            Self::TooLong => f.write_str("message exceeds maximum size"),
            Self::BadFrame => f.write_str("invalid frame"),
            Self::Decrypt => f.write_str("frame decryption failed"),
            Self::Encrypt => f.write_str("frame encryption failed"),
        }
    }
}

impl std::error::Error for FrameError {}

struct ActiveSession {
    transport: TransportGuard,
    sent: u64,
    received: u64,
    rekey_interval: u64,
    max_message: usize,
    pending: Vec<u8>,
}

impl Drop for ActiveSession {
    fn drop(&mut self) {
        self.pending.zeroize();
    }
}

/// An authenticated, framed Noise transport session.
///
/// Any error from [`Self::encode`] or [`Self::push`] ends the session immediately and
/// clears its transport state and partial receive buffer.
pub struct Session {
    machine: String,
    active: Option<ActiveSession>,
}

impl fmt::Debug for Session {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Session")
            .field("machine", &self.machine)
            .field("closed", &self.is_closed())
            .finish_non_exhaustive()
    }
}

impl Session {
    pub(crate) fn new(
        machine: String,
        transport: TransportGuard,
        received: u64,
        rekey_interval: u64,
    ) -> Self {
        Self {
            machine,
            active: Some(ActiveSession {
                transport,
                sent: 0,
                received,
                rekey_interval,
                max_message: MAX_MESSAGE,
                pending: Vec::new(),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn from_transport_for_test(
        machine: String,
        transport: snow::TransportState,
        sent: u64,
        received: u64,
        rekey_interval: u64,
        max_message: usize,
    ) -> Self {
        assert!(rekey_interval > 0, "rekey interval must be non-zero");
        Self {
            machine,
            active: Some(ActiveSession {
                transport: TransportGuard::new(transport),
                sent,
                received,
                rekey_interval,
                max_message,
                pending: Vec::new(),
            }),
        }
    }

    #[cfg(test)]
    pub(crate) fn set_max_message_for_test(&mut self, max_message: usize) {
        if let Some(active) = self.active.as_mut() {
            active.max_message = max_message;
        }
    }

    /// The machine name the home welcomed this worker as.
    #[must_use]
    pub fn machine(&self) -> &str {
        &self.machine
    }

    /// Whether the session has been ended by an error.
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.active.is_none()
    }

    /// Encode one application message into ordered Noise carrier messages.
    ///
    /// Refuses messages over [`MAX_MESSAGE`] before allocating any frames and ends the session.
    pub fn encode(&mut self, message: &[u8]) -> Result<Vec<Vec<u8>>, FrameError> {
        let Some(active) = self.active.as_mut() else {
            return Err(FrameError::Closed);
        };

        if !fits_within_cap(0, message.len(), active.max_message) {
            self.close();
            return Err(FrameError::TooLong);
        }

        let frame_count = message.len().div_ceil(MAX_PIECE).max(1);
        let mut frames = Vec::with_capacity(frame_count);
        let mut plaintext = Zeroizing::new(Vec::with_capacity(1 + message.len().min(MAX_PIECE)));

        let mut offset = 0;
        for _ in 0..frame_count {
            let end = (offset + MAX_PIECE).min(message.len());
            let is_last = end == message.len();
            let chunk = &message[offset..end];

            plaintext.clear();
            plaintext.push(if is_last { TAG_FINAL } else { TAG_MORE });
            plaintext.extend_from_slice(chunk);

            let mut ciphertext = vec![0u8; plaintext.len() + TAG_LEN];
            let written = match active
                .transport
                .inner_mut()
                .write_message(&plaintext, &mut ciphertext)
            {
                Ok(n) => n,
                Err(_) => {
                    self.close();
                    return Err(FrameError::Encrypt);
                }
            };
            ciphertext.truncate(written);

            active.sent += 1;
            if active.sent.is_multiple_of(active.rekey_interval) {
                active.transport.inner_mut().rekey_outgoing();
            }

            frames.push(ciphertext);
            offset = end;
        }

        Ok(frames)
    }

    /// Push one received Noise carrier message, returning `Ok(Some(message))` once the
    /// final frame of an application message arrives.
    ///
    /// Any decryption error, invalid frame, or oversized message ends the session.
    pub fn push(&mut self, carrier_message: &[u8]) -> Result<Option<Vec<u8>>, FrameError> {
        let Some(active) = self.active.as_mut() else {
            return Err(FrameError::Closed);
        };

        if carrier_message.len() < TAG_LEN || carrier_message.len() > MAX_NOISE_MESSAGE {
            self.close();
            return Err(FrameError::BadFrame);
        }

        let mut plaintext = Zeroizing::new(vec![0u8; carrier_message.len() - TAG_LEN]);
        let len = match active
            .transport
            .inner_mut()
            .read_message(carrier_message, &mut plaintext)
        {
            Ok(n) => n,
            Err(_) => {
                self.close();
                return Err(FrameError::Decrypt);
            }
        };
        plaintext.truncate(len);

        active.received += 1;
        if active.received.is_multiple_of(active.rekey_interval) {
            active.transport.inner_mut().rekey_incoming();
        }

        let Some((&tag, piece)) = plaintext.split_first() else {
            self.close();
            return Err(FrameError::BadFrame);
        };

        match tag {
            TAG_FINAL => {}
            TAG_MORE if piece.len() == MAX_PIECE => {}
            _ => {
                self.close();
                return Err(FrameError::BadFrame);
            }
        }

        if !fits_within_cap(active.pending.len(), piece.len(), active.max_message) {
            self.close();
            return Err(FrameError::TooLong);
        }

        if tag == TAG_FINAL {
            if active.pending.is_empty() {
                return Ok(Some(piece.to_vec()));
            }
            let mut complete = std::mem::take(&mut active.pending);
            complete.extend_from_slice(piece);
            return Ok(Some(complete));
        }

        active.pending.extend_from_slice(piece);
        Ok(None)
    }

    fn close(&mut self) {
        self.active = None;
    }
}

pub(crate) fn fits_within_cap(current: usize, added: usize, cap: usize) -> bool {
    current.checked_add(added).is_some_and(|total| total <= cap)
}
