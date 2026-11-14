//! The HTTP API's generated types and the serde and JavaScript helpers they use. `opencode-api`
//! re-exports them at their old paths and adds the transports.

pub mod de;
pub mod js;
pub mod ser;
pub mod types;

pub use types::*;

/// A generated declared error type and the `_tag` (or `name`) that identifies it on the wire.
pub trait TaggedError: serde::de::DeserializeOwned {
    const TAG: &'static str;
}
