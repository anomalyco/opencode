//! Hooks around every call a program makes into the host, the counterpart of the reference's `Hooks`.
//!
//! A `before` hook is a future, so it can ask someone before a call goes ahead; failing denies the call, which then
//! fails the way the call itself would. An `after` hook is a plain function: it observes how a call ended and cannot
//! change it, and it must also run when a call is cancelled by dropping it, where there is nothing to await.

use std::future::Future;
use std::sync::Arc;

use crate::Json;
use crate::extension::{HostError, HostValue};
use crate::tool::{BoxFuture, ToolError};

/// A tool call the program is making, with its decoded input.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolInvocation {
    pub name: String,
    pub input: Json,
    /// The call's idempotency key, `<runId>:<callId>`: the same at every hook.
    pub key: String,
}

/// A call the program is making to an extension global, or to a function of a global object named by its path
/// (`fs.readFile`), with copies of its arguments.
#[derive(Clone, Debug)]
pub struct ExtensionInvocation {
    pub extension: String,
    pub name: String,
    pub args: Vec<HostValue>,
}

/// How a call ended.
#[derive(Clone, Copy, Debug)]
pub enum CallResult<'a, V> {
    Success(&'a V),
    /// The failure's message, or the thrown value as the program would print it.
    Failure(&'a str),
    Interrupted,
}

impl<V> CallResult<'_, V> {
    /// `"success"`, `"failure"` or `"interrupted"`.
    pub fn status(&self) -> &'static str {
        match self {
            CallResult::Success(_) => "success",
            CallResult::Failure(_) => "failure",
            CallResult::Interrupted => "interrupted",
        }
    }
}

pub type ToolBefore =
    dyn Fn(&ToolInvocation) -> BoxFuture<'static, Result<(), ToolError>> + Send + Sync;
pub type ToolAfter = dyn Fn(&ToolInvocation, CallResult<'_, Json>) + Send + Sync;
pub type ExtensionBefore =
    dyn Fn(&ExtensionInvocation) -> BoxFuture<'static, Result<(), HostError>> + Send + Sync;
pub type ExtensionAfter = dyn Fn(&ExtensionInvocation, CallResult<'_, HostValue>) + Send + Sync;

/// `tool.before`, `tool.after`, `extension.before` and `extension.after`.
#[derive(Clone, Default)]
pub struct Hooks {
    pub tool_before: Option<Arc<ToolBefore>>,
    pub tool_after: Option<Arc<ToolAfter>>,
    pub extension_before: Option<Arc<ExtensionBefore>>,
    pub extension_after: Option<Arc<ExtensionAfter>>,
}

impl Hooks {
    pub fn new() -> Self {
        Self::default()
    }

    /// `tool.before` that decides at once. A `ToolError` denies the call: the program's promise rejects with it.
    pub fn tool_before(
        self,
        f: impl Fn(&ToolInvocation) -> Result<(), ToolError> + Send + Sync + 'static,
    ) -> Self {
        self.tool_before_async(move |call| std::future::ready(f(call)))
    }

    /// `tool.before` as a future, such as a permission prompt.
    pub fn tool_before_async<F>(
        mut self,
        f: impl Fn(&ToolInvocation) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: Future<Output = Result<(), ToolError>> + Send + 'static,
    {
        self.tool_before = Some(Arc::new(move |call| Box::pin(f(call))));
        self
    }

    pub fn tool_after(
        mut self,
        f: impl Fn(&ToolInvocation, CallResult<'_, Json>) + Send + Sync + 'static,
    ) -> Self {
        self.tool_after = Some(Arc::new(f));
        self
    }

    /// `extension.before` that decides at once. A `HostError` denies the call: an asynchronous global's promise
    /// rejects with it and a synchronous global throws it.
    pub fn extension_before(
        self,
        f: impl Fn(&ExtensionInvocation) -> Result<(), HostError> + Send + Sync + 'static,
    ) -> Self {
        self.extension_before_async(move |call| std::future::ready(f(call)))
    }

    pub fn extension_before_async<F>(
        mut self,
        f: impl Fn(&ExtensionInvocation) -> F + Send + Sync + 'static,
    ) -> Self
    where
        F: Future<Output = Result<(), HostError>> + Send + 'static,
    {
        self.extension_before = Some(Arc::new(move |call| Box::pin(f(call))));
        self
    }

    pub fn extension_after(
        mut self,
        f: impl Fn(&ExtensionInvocation, CallResult<'_, HostValue>) + Send + Sync + 'static,
    ) -> Self {
        self.extension_after = Some(Arc::new(f));
        self
    }
}
