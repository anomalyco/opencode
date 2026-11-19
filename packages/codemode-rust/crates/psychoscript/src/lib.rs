//! PsychoScript: a confined, JavaScript-like language whose programs call the host's functions, embeddable in Rust.
//!
//! This crate is the Rust implementation of the reference's language layer (`src/language/` of `@opencode/codemode`):
//! [`Runtime`] is `Runtime.make`, [`HostFunction`] is `Host.fn`, [`DurableFunction`] is `Host.durableFn`,
//! [`Namespace`] is `Host.namespace`, [`Failure`] is `Host.fail` and `Host.missing`, and [`Program`] is
//! `runtime.program`. Host work is a [`Future`](std::future::Future) instead of an Effect; [`Runtime::execute_async`]
//! runs on any executor, and [`Runtime::execute`] drives it on the calling thread.
//!
//! The public API below is shared with the benchmark and conformance harnesses, so change it only together with them.

mod builtins;
mod bytecode;
mod compiler;
mod conversion;
mod convert;
mod cross;
mod data;
mod diagnostic;
mod exec;
mod host;
mod host_function;
mod iteration;
mod native;
mod nesting;
mod object;
mod offload;
mod ops;
mod program;
mod promise;
mod reach;
mod run;
mod runtime;
mod snapshot;
mod streaming;
mod strings;
#[cfg(feature = "test262")]
#[doc(hidden)]
pub mod test262;
mod value;
mod vm;

pub use data::Data;
pub use diagnostic::{Diagnostic, DiagnosticKind, Interrupted, Limits};
pub use exec::BoxFuture;
pub use host_function::{
    Call, CallType, DurableCall, DurableFunction, Failure, HostError, HostFunction, HostResult,
    HostString, HostValue, Namespace, Resolved, Returned, SnapshotHooks,
};
pub use program::{Program, RunOutcome, RunningCall, SuspendError, Suspended, Suspender};
pub use runtime::{
    Outcome, ProgramOptions, Run, Runtime, Translate, TranslateFunctions, TranslatePromises,
};
pub use serde_json::Value as Json;
pub use snapshot::{Snapshot, SnapshotError, from_bytes, to_bytes};
pub use streaming::{HttpBody, StreamingResponse};

/// The names bound in every program before its host globals, the reference's `globalNames`.
pub fn global_names() -> &'static [&'static str] {
    host::GLOBAL_NAMES
}
