use std::fmt;

use psychoscript::{Diagnostic, DiagnosticKind};

/// Why a program didn't compile or a run failed: the same cases as `psychoscript-mobile`'s error. In JavaScript it is
/// an `Error` whose `name` is `"PsychoScriptError"`, with `type` (the variant, lowercase: `"syntax"`, `"runtime"`,
/// `"timeout"`, `"outputTooLarge"`, `"invalidInput"`, `"sliceBudget"`, `"invalidState"`, `"view"`, `"draw"`), `kind` (the
/// language's diagnostic kind), `line`/`column` (1-based) when known, and `phase` when it is a phase's own (`"view"`, `"draw"`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The source doesn't parse, or uses unsupported syntax (`ParseError`, `UnsupportedSyntax`).
    Syntax {
        kind: String,
        reason: String,
        line: Option<u32>,
        column: Option<u32>,
    },
    /// The run threw, or returned what isn't JSON data.
    Runtime {
        kind: String,
        reason: String,
        line: Option<u32>,
        column: Option<u32>,
    },
    /// The run went past `timeout_ms` of active time.
    Timeout { reason: String, timeout_ms: u64 },
    /// The result is over `max_output_bytes` of JSON.
    OutputTooLarge {
        reason: String,
        max_output_bytes: u64,
    },
    /// The input isn't JSON, or the options are invalid.
    InvalidInput { reason: String },
    /// A live run computed for more than `budget_ms` without waiting on its host, and was stopped.
    SliceBudget { reason: String, budget_ms: u64 },
    /// A live run's method its state doesn't allow.
    InvalidState { reason: String },
    /// A widget's view breaks a rule of views (widgets.md, "Keys and depth"): a program error in phase `view`.
    View { reason: String },
    /// A live widget's draw post is invalid (more than 2,000 commands): a program error in phase `draw`.
    Draw { reason: String },
}

impl Error {
    pub(crate) fn from_diagnostic(d: Diagnostic, timeout_ms: Option<u64>) -> Error {
        let kind = d.kind.name().to_owned();
        let reason = d.message_lossy();
        let (line, column) = d.location.map_or((None, None), |(l, c)| (Some(l), Some(c)));
        match d.kind {
            DiagnosticKind::TimeoutExceeded => Error::Timeout {
                reason,
                timeout_ms: timeout_ms.unwrap_or(0),
            },
            DiagnosticKind::ParseError | DiagnosticKind::UnsupportedSyntax => Error::Syntax {
                kind,
                reason,
                line,
                column,
            },
            _ => Error::Runtime {
                kind,
                reason,
                line,
                column,
            },
        }
    }

    pub(crate) fn invalid_input(reason: impl Into<String>) -> Error {
        Error::InvalidInput {
            reason: reason.into(),
        }
    }

    /// The message, as the language gives it.
    pub fn reason(&self) -> &str {
        match self {
            Error::Syntax { reason, .. }
            | Error::Runtime { reason, .. }
            | Error::Timeout { reason, .. }
            | Error::OutputTooLarge { reason, .. }
            | Error::InvalidInput { reason }
            | Error::SliceBudget { reason, .. }
            | Error::InvalidState { reason }
            | Error::View { reason }
            | Error::Draw { reason } => reason,
        }
    }

    /// The variant's name, as JavaScript sees it in `type`.
    pub fn type_name(&self) -> &'static str {
        match self {
            Error::Syntax { .. } => "syntax",
            Error::Runtime { .. } => "runtime",
            Error::Timeout { .. } => "timeout",
            Error::OutputTooLarge { .. } => "outputTooLarge",
            Error::InvalidInput { .. } => "invalidInput",
            Error::SliceBudget { .. } => "sliceBudget",
            Error::InvalidState { .. } => "invalidState",
            Error::View { .. } => "view",
            Error::Draw { .. } => "draw",
        }
    }

    /// The language's diagnostic kind, when there is one.
    pub fn kind(&self) -> Option<&str> {
        match self {
            Error::Syntax { kind, .. } | Error::Runtime { kind, .. } => Some(kind),
            Error::Timeout { .. } => Some("TimeoutExceeded"),
            _ => None,
        }
    }

    /// The widget phase it belongs to, when it isn't the step's or the run's: `"view"` or `"draw"`.
    pub fn phase(&self) -> Option<&'static str> {
        match self {
            Error::View { .. } => Some("view"),
            Error::Draw { .. } => Some("draw"),
            _ => None,
        }
    }

    /// Where in the source, 1-based, when known.
    pub fn location(&self) -> Option<(u32, u32)> {
        match self {
            Error::Syntax {
                line: Some(l),
                column: Some(c),
                ..
            }
            | Error::Runtime {
                line: Some(l),
                column: Some(c),
                ..
            } => Some((*l, *c)),
            _ => None,
        }
    }

    /// `{ type, kind?, message, line?, column?, phase? }`, as JSON.
    pub fn to_json(&self) -> String {
        let mut out = serde_json::Map::new();
        out.insert("type".into(), self.type_name().into());
        if let Some(kind) = self.kind() {
            out.insert("kind".into(), kind.into());
        }
        out.insert("message".into(), self.reason().into());
        if let Some((l, c)) = self.location() {
            out.insert("line".into(), l.into());
            out.insert("column".into(), c.into());
        }
        if let Some(phase) = self.phase() {
            out.insert("phase".into(), phase.into());
        }
        serde_json::Value::Object(out).to_string()
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason())
    }
}

impl std::error::Error for Error {}
