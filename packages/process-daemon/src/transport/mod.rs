//! Local byte-stream transport boundary. Protocol framing and authentication live
//! above this module. Cancellation interrupts pending I/O; successful response
//! completion is separate so cancelling a connection cannot discard its final
//! frame before the peer has had a chance to read it.
//!
//! The daemon polls `Listener::accept`; connection reads/writes run only on its
//! handler threads. A separate `Cancellation` can wake both directions without
//! waiting for either handler or peer. `finish_response` and a disconnect
//! monitor's `finish` are delivery operations, not aliases for cancellation.
//! In particular, a future named-pipe backend must not emulate Unix half-close:
//! it must retain final bytes until peer close or a bounded, cancellable deadline.

#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub(crate) use unix::{Cancellation, Connection, Listener};

#[cfg(windows)]
mod retained;

#[cfg(windows)]
pub(crate) mod windows;
#[cfg(windows)]
pub(crate) use windows::{Cancellation, Connection, Listener};
