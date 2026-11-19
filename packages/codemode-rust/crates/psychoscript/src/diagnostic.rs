//! What a run ends with besides its value: diagnostics and their kinds, the limits it runs under, and its
//! interruption.

use std::fmt;

#[derive(Clone, Copy, Debug, Default)]
pub struct Limits {
    pub timeout_ms: Option<u64>,
    pub max_output_bytes: Option<usize>,
}

/// A diagnostic's kind: the language's own, or one a host function's failure names ([`Failure`](crate::Failure)),
/// the reference's `DiagnosticKind` string.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiagnosticKind {
    ParseError,
    UnsupportedSyntax,
    InvalidDataValue,
    TimeoutExceeded,
    ExecutionFailure,
    /// Warning only: additional warnings were omitted by `max_output_bytes`.
    Truncated,
    /// A kind a host failure names.
    Host(Box<str>),
}

impl DiagnosticKind {
    /// The reference's name for the kind, such as `"ExecutionFailure"`.
    pub fn name(&self) -> &str {
        match self {
            DiagnosticKind::ParseError => "ParseError",
            DiagnosticKind::UnsupportedSyntax => "UnsupportedSyntax",
            DiagnosticKind::InvalidDataValue => "InvalidDataValue",
            DiagnosticKind::TimeoutExceeded => "TimeoutExceeded",
            DiagnosticKind::ExecutionFailure => "ExecutionFailure",
            DiagnosticKind::Truncated => "Truncated",
            DiagnosticKind::Host(name) => name,
        }
    }

    /// The kind a name gives: the language's own kind by that name, or a host kind.
    pub fn named(name: &str) -> Self {
        match name {
            "ParseError" => DiagnosticKind::ParseError,
            "UnsupportedSyntax" => DiagnosticKind::UnsupportedSyntax,
            "InvalidDataValue" => DiagnosticKind::InvalidDataValue,
            "TimeoutExceeded" => DiagnosticKind::TimeoutExceeded,
            "ExecutionFailure" => DiagnosticKind::ExecutionFailure,
            "Truncated" => DiagnosticKind::Truncated,
            other => DiagnosticKind::Host(other.into()),
        }
    }
}

impl fmt::Display for DiagnosticKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.name())
    }
}

/// A program's failure or warning. Its message and suggestions keep the program's text exactly, unpaired surrogates
/// included ([`HostString`](crate::HostString)); [`Diagnostic::message_lossy`] gives a Rust `String`.
#[derive(Clone, Debug)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub message: crate::HostString,
    /// 1-based line and column in the program source, when known.
    pub location: Option<(u32, u32)>,
    /// What the model could do about it, as a host failure gives them.
    pub suggestions: Vec<crate::HostString>,
}

impl Diagnostic {
    /// The message as a Rust `String`, with U+FFFD for each unpaired surrogate.
    pub fn message_lossy(&self) -> String {
        self.message.to_string_lossy().into_owned()
    }

    /// The suggestions as Rust `String`s, with U+FFFD for each unpaired surrogate.
    pub fn suggestions_lossy(&self) -> Vec<String> {
        self.suggestions
            .iter()
            .map(|s| s.to_string_lossy().into_owned())
            .collect()
    }
}

/// A run that was interrupted, by a host call, instead of ending with an outcome.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Interrupted;

impl fmt::Display for Interrupted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("The run was interrupted.")
    }
}

impl std::error::Error for Interrupted {}
