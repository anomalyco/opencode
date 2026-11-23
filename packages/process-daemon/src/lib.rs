pub mod client;
pub mod daemon;
mod ghostty;
#[cfg(all(target_os = "linux", target_env = "musl"))]
mod musl;
#[cfg(any(unix, windows))]
mod ownership;
pub mod protocol;
pub mod service;
#[cfg(any(unix, windows))]
mod transport;
