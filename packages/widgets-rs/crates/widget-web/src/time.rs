//! `std::time::Instant` panics in a browser: `web-time` reads `performance.now()` there.

#[cfg(not(target_arch = "wasm32"))]
pub use std::time::Instant;
#[cfg(target_arch = "wasm32")]
pub use web_time::Instant;
