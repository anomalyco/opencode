//! PsychoScript: a confined, JavaScript-like language for calling host tools, embeddable in Rust.
//!
//! The public API below is shared with the benchmark and conformance harnesses, so change it only together with them.

use std::collections::BTreeMap;

mod builtins;
mod bytecode;
mod compiler;
mod convert;
mod object;
mod ops;
mod promise;
mod run;
mod strings;
mod value;
mod vm;

pub use serde_json::Value as Json;

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
    InvalidDataValue,
    ToolCallLimitExceeded,
    TimeoutExceeded,
    ToolFailure,
    ExecutionFailure,
}

#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub message: String,
    /// 1-based line and column in the program source, when known.
    pub location: Option<(u32, u32)>,
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
    pub logs: Vec<String>,
    pub tool_calls: Vec<ToolCall>,
}

/// Reusable runtime: tools and limits are fixed, each `execute` is an independent run.
pub struct Runtime {
    tools: BTreeMap<String, ToolFn>,
    limits: Limits,
}

impl Runtime {
    pub fn new() -> Self {
        Self {
            tools: BTreeMap::new(),
            limits: Limits::default(),
        }
    }

    /// Registers a tool at a dotted path, callable as `tools.<path>(input)`; `"git.status"` is `tools.git.status`.
    pub fn tool(
        mut self,
        path: &str,
        f: impl Fn(&Json) -> Result<Json, String> + Send + Sync + 'static,
    ) -> Self {
        self.tools.insert(path.to_owned(), Box::new(f));
        self
    }

    pub fn limits(mut self, limits: Limits) -> Self {
        self.limits = limits;
        self
    }

    /// Parses, compiles and runs `code`. `bindings` become top-level constants.
    pub fn execute(&self, code: &str, bindings: &serde_json::Map<String, Json>) -> Outcome {
        run::execute(self, code, bindings)
    }
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}
