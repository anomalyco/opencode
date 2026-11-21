//! Sans-I/O protocol implementation for the OpenCode machine worker:
//! join string decoding, Noise XX authenticated handshake, and message framing.

#![forbid(unsafe_code)]

use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub mod frames;
pub mod join;
pub mod link;

#[cfg(test)]
mod tests;

/// A 32-byte join secret. Zeroized on drop and redacted in `Debug` output.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Secret([u8; 32]);

impl Secret {
    /// Wrap a 32-byte secret value, zeroizing the caller's stack copy on move.
    #[must_use]
    pub fn from_bytes(mut bytes: [u8; 32]) -> Self {
        let secret = Self(bytes);
        bytes.zeroize();
        secret
    }

    /// Borrow the raw 32-byte secret.
    #[must_use]
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

impl From<[u8; 32]> for Secret {
    fn from(bytes: [u8; 32]) -> Self {
        Self::from_bytes(bytes)
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret([REDACTED])")
    }
}
