//! What a run ends with besides its value: diagnostics and their kinds, and the limits it runs under.

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
