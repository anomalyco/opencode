//! Interactive prompts for the non-TUI commands, drawn and driven as `@clack/prompts` 1.0.0-alpha.1
//! does for `packages/cli`. Step C.p.
//!
//! Every prompt is a builder that ends in a blocking `prompt()`, which returns `Err(Cancelled)` on
//! Ctrl+C or Escape. The TS commands then print `cancel("Cancelled")` and exit with 130
//! (`packages/cli/src/ui/prompt.ts`):
//!
//! ```ignore
//! let name = prompt::text("Name").placeholder("Ada").prompt();
//! let Ok(name) = name else {
//!     prompt::cancel("Cancelled");
//!     return Err(output::Exit(130).into());
//! };
//! ```
//!
//! As in Clack, prompts also run when stdin or stdout is not a terminal: keys come from the input as
//! it is, and the frames are written without colors. Commands that need a person check
//! [`is_interactive`] first, as `requireInteractive` does. Unlike Clack, which waits forever, a
//! prompt whose input ends is cancelled.

// A few options only `opencode-prompt-demo` uses (P-CLI compares them with Clack) carry their own
// `dead_code` allowance. The wizard (C.15) draws Effect CLI's prompts and uses only `with_keys`, `Keys`,
// `Press`, and `stdout_size`.

mod autocomplete;
mod confirm;
mod core;
mod line;
mod select;
mod spinner;
mod style;
mod term;
mod text;
mod wrap;

pub use autocomplete::{View, autocomplete};
pub use confirm::confirm;
pub use core::with_keys;
pub use select::{Choice, multiselect, select};
pub use spinner::spinner;
pub use style::*;
pub use term::{Keys, Press};
pub use text::{password, text};

/// The user cancelled a prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Cancelled")
    }
}

impl std::error::Error for Cancelled {}

/// A prompt's state, which picks its symbol and frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Initial,
    Active,
    Error,
    Submit,
    Cancel,
}

/// Where a prompt draws. Clack's `output` option; `session export` draws on stderr.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Output {
    #[default]
    Stdout,
    Stderr,
}

type Validate<'a, V> = Box<dyn Fn(&V) -> Option<String> + 'a>;

/// Whether stdin and stdout are both terminals.
pub fn is_interactive() -> bool {
    term::interactive()
}

/// `process.stdout.rows` and `process.stdout.columns`, for custom frames: unset without a terminal.
pub fn stdout_size() -> (Option<usize>, Option<usize>) {
    (term::stdout_rows(), term::columns())
}

/// Puts the terminal back as it was before a prompt took raw mode, when one holds it. The CLI runs this as a
/// shutdown step, so a SIGTERM during a prompt does not leave the shell in raw mode.
pub fn restore_terminal() {
    term::restore();
}

/// `┌  title`: opens a group of prompts.
pub fn intro(title: &str) {
    Output::Stdout.intro(title);
}

/// `└  message`: closes a group of prompts.
pub fn outro(message: &str) {
    Output::Stdout.outro(message);
}

/// `└  message` in red: closes a group of prompts that was cancelled.
pub fn cancel(message: &str) {
    Output::Stdout.cancel(message);
}

/// The messages with Clack's `output` option, for commands that keep stdout for data.
impl Output {
    pub fn intro(self, title: &str) {
        self.write(&format!("{}  {title}\n", gray(S_BAR_START())));
    }

    pub fn outro(self, message: &str) {
        self.write(&format!("{}\n{}  {message}\n\n", gray(S_BAR()), gray(S_BAR_END())));
    }

    pub fn cancel(self, message: &str) {
        self.write(&format!("{}  {}\n\n", gray(S_BAR_END()), red(message)));
    }

    /// `log.message(message, { symbol, output })`.
    pub fn log(self, message: &str, symbol: &str) {
        let bar = gray(S_BAR());
        let mut parts = vec![bar.clone()];
        for (index, line) in message.split('\n').enumerate() {
            let lead = if index == 0 { symbol } else { bar.as_str() };
            parts.push(if line.is_empty() { lead.to_string() } else { format!("{lead}  {line}") });
        }
        self.write(&format!("{}\n", parts.join("\n")));
    }
}

#[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
/// A boxed note with a title, its lines dim.
pub fn note(message: &str, title: &str) {
    note_with(message, title, dim);
}

#[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
/// [`note`] with each line styled by `format`.
pub fn note_with(message: &str, title: &str, format: impl Fn(&str) -> String) {
    // Clack measures in UTF-16 units of the text without escape sequences.
    let length = |text: &str| wrap::strip(text).encode_utf16().count();
    let lines: Vec<String> = std::iter::once(String::new())
        .chain(message.split('\n').map(format))
        .chain(std::iter::once(String::new()))
        .collect();
    let title_length = length(title);
    let width = lines.iter().map(|line| length(line)).max().unwrap_or(0).max(title_length) + 2;
    let body: Vec<String> = lines
        .iter()
        .map(|line| format!("{}  {line}{}{}", gray(S_BAR()), " ".repeat(width - length(line)), gray(S_BAR())))
        .collect();
    Output::Stdout.write(&format!(
        "{}\n{}  {} {}\n{}\n{}\n",
        gray(S_BAR()),
        green(S_STEP_SUBMIT()),
        reset(title),
        gray(&(S_BAR_H().repeat(width.saturating_sub(title_length + 1).max(1)) + S_CORNER_TOP_RIGHT())),
        body.join("\n"),
        gray(&(S_CONNECT_LEFT().to_string() + &S_BAR_H().repeat(width + 2) + S_CORNER_BOTTOM_RIGHT())),
    ));
}

/// `log.*`: a message under a bar, its first line after a symbol.
pub mod log {
    use super::*;

    /// `log.message` with the default bar symbol.
    pub fn message(message: &str) {
        with_symbol(message, &gray(S_BAR()));
    }

    pub fn info(message: &str) {
        with_symbol(message, &blue(S_INFO()));
    }

    pub fn success(message: &str) {
        with_symbol(message, &green(S_SUCCESS()));
    }

    pub fn step(message: &str) {
        with_symbol(message, &green(S_STEP_SUBMIT()));
    }

    pub fn warn(message: &str) {
        with_symbol(message, &yellow(S_WARN()));
    }

    pub fn error(message: &str) {
        with_symbol(message, &red(S_ERROR()));
    }

    /// `log.message(message, { symbol })` with the default spacing of one bar line.
    pub fn with_symbol(message: &str, symbol: &str) {
        Output::Stdout.log(message, symbol);
    }
}
