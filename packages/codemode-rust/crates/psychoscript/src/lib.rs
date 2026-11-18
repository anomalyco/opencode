//! PsychoScript: a confined, JavaScript-like language for calling host tools, embeddable in Rust.
//!
//! The public API below is shared with the benchmark and conformance harnesses, so change it only together with them.
//!
//! The pieces mirror the reference's (`packages/codemode`) in Rust form: [`Tool`] is `Tool.make`, [`Runtime`] is
//! `CodeMode.make`, [`Extension`] is `Extension.make`, [`Hooks`] are the call hooks, and [`Program`] is
//! `runtime.program`. Host work is a [`Future`](std::future::Future) instead of an Effect; [`Runtime::execute_async`]
//! runs on any executor, and [`Runtime::execute`] drives it on the calling thread.

mod builtins;
mod bytecode;
mod compiler;
mod convert;
mod cross;
mod exec;
mod extension;
mod hooks;
mod host;
mod native;
mod object;
pub mod openapi;
mod ops;
mod program;
mod promise;
mod reach;
mod run;
mod schema;
mod search;
mod snapshot;
mod streaming;
mod strings;
#[cfg(feature = "test262")]
#[doc(hidden)]
pub mod test262;
mod tool;
mod value;
mod vm;

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

/// A host tool: plain data in, plain data out. A failure is thrown into the program as an error.
pub type ToolFn = Box<dyn Fn(&Json) -> Result<Json, String> + Send + Sync>;

#[derive(Clone, Copy, Debug, Default)]
pub struct Limits {
    pub timeout_ms: Option<u64>,
    pub max_tool_calls: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticKind {
    ParseError,
    UnsupportedSyntax,
    UnknownTool,
    InvalidToolInput,
    InvalidToolOutput,
    InvalidDataValue,
    ToolCallLimitExceeded,
    TimeoutExceeded,
    ToolFailure,
    ExecutionFailure,
    /// Warning only: additional warnings were omitted by `max_output_bytes`.
    Truncated,
}

impl DiagnosticKind {
    /// The reference's name for the kind, such as `"UnknownTool"`.
    pub fn name(self) -> &'static str {
        match self {
            DiagnosticKind::ParseError => "ParseError",
            DiagnosticKind::UnsupportedSyntax => "UnsupportedSyntax",
            DiagnosticKind::UnknownTool => "UnknownTool",
            DiagnosticKind::InvalidToolInput => "InvalidToolInput",
            DiagnosticKind::InvalidToolOutput => "InvalidToolOutput",
            DiagnosticKind::InvalidDataValue => "InvalidDataValue",
            DiagnosticKind::ToolCallLimitExceeded => "ToolCallLimitExceeded",
            DiagnosticKind::TimeoutExceeded => "TimeoutExceeded",
            DiagnosticKind::ToolFailure => "ToolFailure",
            DiagnosticKind::ExecutionFailure => "ExecutionFailure",
            DiagnosticKind::Truncated => "Truncated",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub message: String,
    /// 1-based line and column in the program source, when known.
    pub location: Option<(u32, u32)>,
    /// What the model could do about it, such as `"Use search to find available tools."`.
    pub suggestions: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ToolCall {
    pub path: String,
    pub input: Json,
}

#[derive(Clone, Debug)]
pub struct Outcome {
    /// `Ok(value)` is JSON-safe; `undefined` becomes `null`.
    pub result: Result<Json, Diagnostic>,
    /// Non-fatal diagnostics.
    pub warnings: Vec<Diagnostic>,
    pub logs: Vec<String>,
    /// Whether `max_output_bytes` cut the retained result or logs.
    pub truncated: bool,
    pub tool_calls: Vec<ToolCall>,
}

/// What a runtime shares with every run it starts.
pub(crate) struct Setup {
    pub registry: tool::Registry,
    pub hooks: Hooks,
    pub extensions: Vec<Extension>,
    pub limits: Limits,
}

/// Reusable runtime: tools, extensions, hooks and limits are fixed, each `execute` is an independent run.
pub struct Runtime {
    setup: Setup,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            setup: Setup {
                registry: tool::Registry::default(),
                hooks: Hooks::default(),
                extensions: Vec::new(),
                limits: Limits::default(),
            },
        }
    }

    /// Registers a tool at a dotted path, callable as `tools.<path>(input)`; `"git.status"` is `tools.git.status`.
    /// Its schemas accept anything, so its signature is `(unknown): Promise<unknown>`.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment.
    pub fn tool(
        self,
        path: &str,
        f: impl Fn(&Json) -> Result<Json, String> + Send + Sync + 'static,
    ) -> Self {
        self.with_tool(
            path,
            Tool::new("", move |input, _| f(&input).map_err(ToolError::from))
                .output(Schema::render_only(Json::Object(Default::default()))),
        )
    }

    /// Registers a schema-described tool at a dotted path. A later tool at the same canonical path replaces it.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment, as the reference throws from `CodeMode.make`.
    pub fn with_tool(self, path: &str, tool: Tool) -> Self {
        self.try_with_tool(path, tool)
            .unwrap_or_else(|e| panic!("{e}"))
    }

    pub fn try_with_tool(mut self, path: &str, tool: Tool) -> Result<Self, ConfigError> {
        tool::check_path(path)?;
        self.setup.registry.insert(path, tool);
        Ok(self)
    }

    /// Describes the namespace at a dotted path, like the reference's `Namespace.make`. The description is
    /// model-visible through search: it matches every tool under the namespace.
    ///
    /// # Panics
    ///
    /// When the path has an empty segment.
    pub fn namespace(mut self, path: &str, description: &str) -> Self {
        if let Err(e) = tool::check_path(path) {
            panic!("{e}");
        }
        self.setup.registry.namespace(path, description);
        self
    }

    /// Adds host globals. See [`Extension`].
    ///
    /// # Panics
    ///
    /// When a global shadows a built-in or another extension's global.
    pub fn extension(self, extension: Extension) -> Self {
        self.try_extension(extension)
            .unwrap_or_else(|e| panic!("{e}"))
    }

    pub fn try_extension(mut self, extension: Extension) -> Result<Self, ConfigError> {
        for (name, _) in extension.globals() {
            let taken = host::BUILTIN_GLOBALS.contains(&name.as_str())
                || self
                    .setup
                    .extensions
                    .iter()
                    .any(|e| e.globals().iter().any(|(n, _)| n == name));
            if taken {
                return Err(ConfigError(format!(
                    "Extension \"{}\" global \"{name}\" is already defined.",
                    extension.name()
                )));
            }
        }
        self.setup.extensions.push(extension);
        Ok(self)
    }

    pub fn hooks(mut self, hooks: Hooks) -> Self {
        self.setup.hooks = hooks;
        self
    }

    /// # Panics
    ///
    /// When `timeout_ms` is `Some(0)`, which the reference refuses with a `RangeError`.
    pub fn limits(mut self, limits: Limits) -> Self {
        assert!(
            limits.timeout_ms != Some(0),
            "timeoutMs must be a safe integer greater than or equal to 1."
        );
        self.setup.limits = limits;
        self
    }

    /// Every tool with its exact path, description and generated TypeScript signature, sorted by path.
    pub fn catalog(&self) -> Vec<ToolDescription> {
        self.setup
            .registry
            .entries()
            .iter()
            .map(tool::Entry::describe)
            .collect()
    }

    /// Parses, compiles and runs `code` on the calling thread, blocking on asynchronous host work. `bindings` become
    /// top-level constants. An interrupted run ends with an `ExecutionFailure` saying so; [`Program::run`] tells the
    /// two apart.
    pub fn execute(&self, code: &str, bindings: &serde_json::Map<String, Json>) -> Outcome {
        run::execute(self, code, bindings)
    }

    /// Runs `code` as a future on any executor. Dropping it interrupts the run and every host call in flight; a tool
    /// can interrupt it too, and then it ends with [`Interrupted`].
    pub async fn execute_async(
        &self,
        code: &str,
        bindings: &serde_json::Map<String, Json>,
    ) -> Result<Outcome, Interrupted> {
        self.program(code, bindings, None).run_async().await
    }

    /// A program ready to run once; nothing runs until [`Program::run`] or [`Program::run_async`]. Host calls get the keys `<run_id>:<callId>`; a random run id by default.
    pub fn program<'a>(
        &'a self,
        code: &'a str,
        bindings: &serde_json::Map<String, Json>,
        run_id: Option<&str>,
    ) -> Program<'a> {
        Program::new(self, code, bindings, run_id)
    }

    /// A program continuing a suspended run, from its state or from [`to_bytes`]. It keeps the limits it was saved
    /// with. Fails with a [`SnapshotError`] when the state was saved by another build, with other extensions, from a
    /// source that no longer compiles the same, or is malformed.
    pub fn resume(&self, state: &Snapshot) -> Result<Program<'_>, SnapshotError> {
        Program::resume(self, state)
    }

    /// [`Runtime::resume`] from bytes.
    pub fn resume_bytes(&self, bytes: &[u8]) -> Result<Program<'_>, SnapshotError> {
        let state = from_bytes(bytes)?;
        Program::resume(self, &state)
    }

    pub(crate) fn setup(&self) -> &Setup {
        &self.setup
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}

/// The exact callable signature of the built-in `search(...)`, for host-owned instructions.
pub fn search_signature() -> String {
    search::search_signature()
}
