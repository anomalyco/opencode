//! The prompt terminal where there is no backend (neither Unix nor Windows): never interactive, so prompts
//! fail as they do without a terminal, and the input ends at once. Sizes come from OpenTUI's console.

use std::io::IsTerminal;
use std::time::Duration;

use super::{Output, Read};

pub fn interactive() -> bool {
    false
}

/// `process.stdout.columns`: unset when stdout is not a terminal.
pub fn columns() -> Option<usize> {
    std::io::stdout().is_terminal().then(|| opentui::term::size().ok()).flatten().map(|size| usize::from(size.0))
}

/// `process.stdout.rows`: unset when stdout is not a terminal.
pub fn stdout_rows() -> Option<usize> {
    std::io::stdout().is_terminal().then(|| opentui::term::size().ok()).flatten().map(|size| usize::from(size.1))
}

/// The rows of the prompt's output terminal, or 10 when it is not one (`limitOptions`).
pub fn rows(output: Output) -> usize {
    output.is_terminal().then(|| opentui::term::size().ok()).flatten().map_or(10, |size| usize::from(size.1))
}

impl Output {
    pub(in crate::prompt) fn is_terminal(self) -> bool {
        match self {
            Output::Stdout => std::io::stdout().is_terminal(),
            Output::Stderr => std::io::stderr().is_terminal(),
        }
    }
}

/// Raw mode is not taken: the console keeps its modes.
pub struct Raw;

impl Raw {
    pub fn enable(_output: Output) -> Raw {
        Raw
    }
}

/// Nothing to put back.
pub fn restore() {}

pub(super) fn read(_wait: Option<Duration>, _buffer: &mut [u8]) -> Read {
    Read::End
}
