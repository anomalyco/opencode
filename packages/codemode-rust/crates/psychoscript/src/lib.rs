//! PsychoScript: a confined, JavaScript-like language for calling host tools, embeddable in Rust.
//!
//! The public API below is shared with the benchmark and conformance harnesses, so change it only together with them.
//!
//! The pieces mirror the reference's (`packages/codemode`) in Rust form: [`Tool`] is `Tool.make`, [`Runtime`] is
//! `CodeMode.make`, [`Extension`] is `Extension.make`, [`Hooks`] are the call hooks, [`Program`] is
//! `runtime.program`, and [`RunOptions`] are a run's options, such as which of the runtime's extensions it gets.
//! Host work is a [`Future`](std::future::Future) instead of an Effect; [`Runtime::execute_async`] runs on any
//! executor, and [`Runtime::execute`] drives it on the calling thread.

mod codemode;
mod language;

// The modules of both layers by their short names, so their files name each other as `crate::vm`, `crate::tool`.
use codemode::{hooks, program, run, schema, search, tool};
use language::{
    builtins, bytecode, compiler, conversion, convert, cross, exec, extension, host, iteration,
    native, object, ops, promise, reach, snapshot, streaming, strings, value, vm,
};

pub use codemode::openapi;
pub(crate) use codemode::runtime::Setup;
pub use codemode::runtime::{Outcome, RunOptions, Runtime, ToolCall, ToolFn, search_signature};
#[cfg(feature = "test262")]
#[doc(hidden)]
pub use codemode::test262;
pub use language::diagnostic::{Diagnostic, DiagnosticKind, Limits};

pub use extension::{Extension, HostError, HostFunction, HostValue, SnapshotHooks};
pub use hooks::{CallResult, ExtensionInvocation, Hooks, ToolInvocation};
pub use program::{Program, RunOutcome, RunningCall, SuspendError, Suspended, Suspender};
pub use schema::Schema;
pub use serde_json::Value as Json;
pub use snapshot::{Snapshot, SnapshotError, from_bytes, to_bytes};
pub use streaming::{HttpBody, StreamingResponse};
pub use tool::{
    BoxFuture, ConfigError, Execute, Interrupted, Tool, ToolContext, ToolDescription, ToolError,
    tool_expression,
};
