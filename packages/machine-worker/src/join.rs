//! Join string decoding (`ocjoin_<canonical base64url JSON>`).
//!
//! This decoder accepts everything the home's encoder prints and what a later v1 home may
//! add: unknown `reach` kinds containing ordinary JSON objects are dropped, and unknown
//! top-level object fields are deliberately ignored (matching Effect's `Schema.Struct`
//! default) for forward compatibility. It is deliberately stricter than the TypeScript
//! decoder on spellings the home never prints — refusing JSON arrays, floats/exponents/`-0`
//! for `v` or `expires`, duplicate fields, lone surrogates or invalid UTF-8, padded or
//! non-canonical base64 inside the JSON, and out-of-range numbers or extreme nesting inside
//! unknown `reach` entries.

use std::fmt;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use zeroize::{Zeroize, Zeroizing};

use crate::Secret;

/// Required prefix for v1 join strings.
pub const PREFIX: &str = "ocjoin_";

/// Maximum accepted join string length in bytes.
pub const MAX_LENGTH: usize = 4_096;

/// `Number.MAX_SAFE_INTEGER` in JavaScript (`2^53 - 1`), the upper bound on `expires`.
const MAX_SAFE_INTEGER: u64 = (1u64 << 53) - 1;

const KEY_LEN: usize = 32;

/// A way to reach the home server that this worker understands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reach {
    /// A direct URL endpoint for the home server.
    Url(String),
}

/// Decoded contents of a v1 join string.
#[derive(Debug)]
pub struct Join {
    /// The home server's pinned Ed25519 public key.
    pub home: [u8; KEY_LEN],
    /// The one-time enrolment secret for this machine.
    pub secret: Secret,
    /// Expiry timestamp in milliseconds since the Unix epoch (`0..=2^53 - 1`).
    pub expires: u64,
    /// Reach entries understood by this worker; unknown kinds are dropped.
    pub reach: Vec<Reach>,
}

/// A join string could not be decoded or failed validation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JoinError;

impl fmt::Display for JoinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("invalid join string")
    }
}

impl std::error::Error for JoinError {}

#[derive(Deserialize)]
struct Wire {
    v: u64,
    home: String,
    secret: String,
    expires: u64,
    reach: Vec<serde_json::Map<String, serde_json::Value>>,
}

impl Drop for Wire {
    fn drop(&mut self) {
        self.secret.zeroize();
    }
}

/// Decode and validate a v1 join string.
pub fn decode(text: &str) -> Result<Join, JoinError> {
    if text.len() > MAX_LENGTH {
        return Err(JoinError);
    }
    let encoded = text.strip_prefix(PREFIX).ok_or(JoinError)?;
    let raw = Zeroizing::new(URL_SAFE_NO_PAD.decode(encoded).map_err(|_| JoinError)?);
    // Serde's derived struct deserializer also accepts JSON sequences (`[1, ...]`);
    // require a JSON object before deserializing.
    let first = raw
        .iter()
        .find(|&&b| !matches!(b, b' ' | b'\t' | b'\r' | b'\n'));
    if first != Some(&b'{') {
        return Err(JoinError);
    }
    let mut wire: Wire = serde_json::from_slice(&raw).map_err(|_| JoinError)?;
    if wire.v != 1 || wire.expires > MAX_SAFE_INTEGER {
        return Err(JoinError);
    }

    let home = decode_key(&wire.home)?;
    let secret_bytes = Zeroizing::new(decode_key(&wire.secret)?);
    let secret = Secret::from_bytes(*secret_bytes);

    let reach = std::mem::take(&mut wire.reach)
        .into_iter()
        .filter_map(|entry| {
            if entry.get("type").and_then(serde_json::Value::as_str) != Some("url") {
                return None;
            }
            let url = entry.get("url").and_then(serde_json::Value::as_str)?;
            Some(Reach::Url(url.to_owned()))
        })
        .collect();

    Ok(Join {
        home,
        secret,
        expires: wire.expires,
        reach,
    })
}

fn decode_key(encoded: &str) -> Result<[u8; KEY_LEN], JoinError> {
    let bytes = Zeroizing::new(URL_SAFE_NO_PAD.decode(encoded).map_err(|_| JoinError)?);
    let slice: &[u8] = &bytes;
    slice.try_into().map_err(|_| JoinError)
}
