//! The HTTP API's generated types and the serde and JavaScript helpers they use. `opencode-api`
//! re-exports them at their old paths and adds the transports.

pub mod call;
pub mod client;
pub mod de;
pub mod js;
pub mod kinds;
pub mod ser;
pub mod tool;
#[macro_use]
mod type_macros;
pub mod types;

pub use types::*;

/// A generated declared error type and the `_tag` (or `name`) that identifies it on the wire.
pub trait TaggedError: serde::de::DeserializeOwned {
    const TAG: &'static str;
}
