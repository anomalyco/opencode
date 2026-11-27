//! PsychoScript in the browser: wasm-bindgen bindings over the `psychoscript` crate, the web counterpart of
//! `psychoscript-mobile`, for hosts that run on one thread (a Web Worker) and hand programs JSON.
//!
//! With feature `language` (default): [`Program`] compiles a source once; [`Program::run`] runs it with its JSON
//! input behind one sync host function (`__input()` unless named otherwise) and returns its completion value as JSON;
//! [`Program::start_live`] starts a [`LiveRun`] instead, a long-running program with `__host` (`post`, `receive`,
//! `sleep`, `now`, `fetch`) that the host drives from its event loop with [`LiveRun::pump`].
//!
//! The native parts are plain Rust (tested natively); `wasm` holds the JavaScript bindings, built for
//! `wasm32-unknown-unknown` only.

#[cfg(feature = "language")]
mod draw;
#[cfg(feature = "language")]
mod error;
#[cfg(feature = "language")]
pub mod fetch;
#[cfg(feature = "language")]
mod json;
#[cfg(feature = "language")]
mod live;
#[cfg(feature = "language")]
mod program;
#[cfg(feature = "language")]
mod time;
#[cfg(feature = "language")]
pub mod tree;
#[cfg(target_arch = "wasm32")]
mod wasm;

#[cfg(feature = "language")]
pub use error::Error;
#[cfg(feature = "language")]
pub use live::{LiveExit, LiveOptions, LiveRun, Pump};
#[cfg(feature = "language")]
pub use program::Program;
