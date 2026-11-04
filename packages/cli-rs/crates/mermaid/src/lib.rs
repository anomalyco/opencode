//! The Mermaid plugin (P.3, `docs/P.3.md`): `opencode.merman`, a port of `packages/merman/src`. It draws
//! `mermaid` fences in the transcript as terminal text: flowcharts, sequence, state, gantt, gitgraph, and
//! timeline diagrams.
// Bounds checks keep TS's inclusive `right = left + width - 1` form, so each condition reads as its source.
#![allow(clippy::int_plus_one)]

pub mod core;
pub mod flowchart;
mod palette;
mod plugin;
mod render;

pub use palette::Palette;
pub use plugin::{ID, plugin};
pub use render::{Diagram, Rendered, Run, render};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Flowchart,
    Sequence,
    State,
    Timeline,
    GitGraph,
    Gantt,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Self::Flowchart => "flowchart",
            Self::Sequence => "sequence",
            Self::State => "state",
            Self::Timeline => "timeline",
            Self::GitGraph => "gitGraph",
            Self::Gantt => "gantt",
        }
    }
}

/// An otherwise valid diagram contains syntax this renderer does not support (TS `MermaidSyntaxError`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SyntaxError {
    pub kind: Kind,
    /// 1-based.
    pub line: usize,
    pub source: String,
    pub reason: String,
}

impl SyntaxError {
    pub fn new(kind: Kind, line: usize, source: &str, reason: &str) -> Self {
        Self { kind, line, source: source.to_string(), reason: reason.to_string() }
    }

    pub fn unsupported(kind: Kind, line: usize, source: &str) -> Self {
        Self::new(kind, line, source, "Unsupported syntax")
    }
}

impl std::fmt::Display for SyntaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} in {} diagram at line {}: \"{}\"", self.reason, self.kind.name(), self.line, self.source)
    }
}

/// The kind of diagram `content` is, by its first meaningful line (`detect.ts`).
pub fn detect(content: &str) -> Option<Kind> {
    if flowchart::parser::is_flowchart(content) {
        return Some(Kind::Flowchart);
    }
    None
}
