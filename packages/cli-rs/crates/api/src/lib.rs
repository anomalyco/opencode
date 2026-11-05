//! HTTP API client: generated types and methods, transports, events, and sockets.

pub mod client;
pub mod client_mcp;
pub mod error;
pub mod events;
pub mod generated;
pub mod id;
pub mod memory;
pub mod pty;
pub mod query;
pub mod sse;
pub mod transport;
pub mod ws;

pub use opencode_api_types::{de, js, ser};
