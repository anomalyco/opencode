//! What the TUI prints after it exits (E.1, row G14): the wordmark, the updated version, and the open
//! session with the command that continues it (`util/presentation.ts`, `app.tsx:485-490`).
//!
//! E.18b records an installed update with [`Epilogue::updated_version`]. `app::run` [`print`]s [`text`] once the
//! terminal is restored.

use crate::prelude::*;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[90m";

const LOGO_LEFT: [&str; 4] =
    ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"];
const LOGO_RIGHT: [&str; 4] =
    ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"];

/// The updated version an install recorded (`EpilogueProvider`).
#[derive(Default)]
pub struct Epilogue {
    updated_version: RefCell<Option<String>>,
}

impl Epilogue {
    pub fn updated_version(&self, version: String) {
        *self.updated_version.borrow_mut() = Some(version);
    }
}

/// The text to print after exit, or none when there is nothing to say. The session is the one the session
/// route shows when the TUI quits, its title cut to 50 characters (`Locale.truncate`). An untitled session reads
/// "New session" or "Child session" (`displayLabel`), where TS prints an empty title (D131-epilogue-untitled).
pub fn text(tui: &Tui) -> Option<String> {
    let session = match tui.route() {
        Route::Session { id } => {
            let title = tui.data.read(|state| {
                let session = state.session(&id);
                let child = session.is_some_and(|session| session.parent_id.is_some());
                session
                    .and_then(|session| session.title.clone())
                    .filter(|title| !title.is_empty())
                    .unwrap_or_else(|| crate::features::session_links::display_label(None, child))
            });
            Some((opencode_ui::select::truncate(&title, 50), id))
        }
        _ => None,
    };
    let session = session.as_ref().map(|(title, id)| (title.as_str(), id.0.as_str()));
    let updated = tui.epilogue.updated_version.borrow().clone();
    // The command name in the continue hint. TS prints "opencode"; this client names itself, so the hint
    // reopens the client the user ran.
    let cli_name = std::env::var("OPENCODE_CLI_NAME").unwrap_or_else(|_| "opencode-native".to_owned());
    render(session, updated.as_deref(), &cli_name)
}

/// Prints `text` and a newline on stdout (`process.stdout.write(text + "\n")`), once the renderer has put the terminal
/// back. On Windows that turned the console's escape sequences off again, and conhost would show the colors as
/// `←[90m`; TS writes through libuv, which turns them on for a console it writes to. So they go on for this write,
/// and back to what they were after it.
pub fn print(text: &str) {
    let _ = write(&mut Stdout::default(), &mut std::io::stdout().lock(), text);
}

/// The console's escape sequences around the write.
trait Console {
    fn escapes_on(&mut self);
    fn restore(&mut self);
}

fn write(console: &mut impl Console, out: &mut impl std::io::Write, text: &str) -> std::io::Result<()> {
    console.escapes_on();
    let written = writeln!(out, "{text}").and_then(|()| out.flush());
    console.restore();
    written
}

/// The console stdout writes to; off Windows a terminal always interprets escape sequences.
#[derive(Default)]
struct Stdout {
    /// The mode `escapes_on` replaced; none when stdout is not a console.
    #[cfg(windows)]
    saved: Option<u32>,
}

impl Console for Stdout {
    fn escapes_on(&mut self) {
        #[cfg(windows)]
        {
            use opencode_util::win;
            self.saved = win::console_mode(std::io::stdout());
            if let Some(mode) = self.saved {
                let _ = win::set_console_mode(std::io::stdout(), win::vt_output_mode(mode));
            }
        }
    }

    fn restore(&mut self) {
        #[cfg(windows)]
        if let Some(mode) = self.saved.take() {
            let _ = opencode_util::win::set_console_mode(std::io::stdout(), mode);
        }
    }
}

fn render(session: Option<(&str, &str)>, updated: Option<&str>, cli: &str) -> Option<String> {
    if session.is_none() && updated.is_none() {
        return None;
    }
    let row = |label: &str, value: &str| format!("  {DIM}{label:<10}{RESET}{BOLD}{value}{RESET}");
    let mut lines = wordmark("  ");
    lines.push(String::new());
    if let Some(version) = updated {
        lines.push(format!("  {DIM}Run {RESET}{BOLD}{cli}{RESET}{DIM} to use {RESET}{BOLD}{version}{RESET}"));
        lines.push(String::new());
    }
    if let Some((title, id)) = session {
        lines.push(row("Session", &opencode_ui::terminal_text(title)));
        lines.push(row("Continue", &format!("{cli} -s {id}")));
        lines.push(String::new());
    }
    Some(lines.join("\n"))
}

fn wordmark(pad: &str) -> Vec<String> {
    let draw = |line: &str, fg: &str, shadow: &str, bg: &str| -> String {
        line.chars()
            .map(|char| match char {
                '_' => format!("{bg} {RESET}"),
                '^' => format!("{fg}{bg}▀{RESET}"),
                '~' => format!("{shadow}▀{RESET}"),
                ' ' => " ".to_owned(),
                char => format!("{fg}{char}{RESET}"),
            })
            .collect()
    };
    LOGO_LEFT
        .iter()
        .zip(LOGO_RIGHT)
        .map(|(left, right)| {
            let left = draw(left, DIM, "\x1b[38;5;235m", "\x1b[48;5;235m");
            let right = draw(right, RESET, "\x1b[38;5;238m", "\x1b[48;5;238m");
            format!("{pad}{left} {right}")
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prints_nothing_without_a_session_or_update() {
        assert_eq!(render(None, None, "opencode"), None);
    }

    #[test]
    fn prints_the_session_and_its_continue_command() {
        let text = render(Some(("Fix the parser", "ses_b")), None, "opencode").unwrap();
        let plain = strip(&text);
        let lines: Vec<&str> = plain.lines().collect();
        assert_eq!(lines[1], "  █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█");
        assert_eq!(lines[5], "  Session   Fix the parser");
        assert_eq!(lines[6], "  Continue  opencode -s ses_b");
        assert!(text.ends_with('\n'), "a trailing empty line, as in TS");
        assert!(text.contains("\x1b[90mSession   \x1b[0m\x1b[1mFix the parser\x1b[0m"));
    }

    #[test]
    fn prints_the_updated_version_first() {
        let text = strip(&render(Some(("A", "ses_a")), Some("2.1.0"), "opencode").unwrap());
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[5], "  Run opencode to use 2.1.0");
        assert_eq!(lines[7], "  Session   A");
    }

    #[test]
    fn the_session_title_cannot_write_escape_sequences() {
        let text = render(Some(("x\x1b]52;c;cHduZWQ=\x07y\u{9b}", "ses_b")), None, "opencode").unwrap();
        assert!(text.contains("\x1b[1mxy\x1b[0m"), "{text:?}");
    }

    /// D131 N1: the renderer has restored the console when the epilogue is written, so the write turns escape
    /// sequences on before it and restores the mode only once the text is flushed.
    #[test]
    fn writes_with_escape_sequences_on() {
        struct Log<'a>(&'a RefCell<Vec<String>>);
        impl Console for Log<'_> {
            fn escapes_on(&mut self) {
                self.0.borrow_mut().push("escapes on".into());
            }
            fn restore(&mut self) {
                self.0.borrow_mut().push("restore".into());
            }
        }
        impl std::io::Write for Log<'_> {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0.borrow_mut().push(String::from_utf8_lossy(bytes).into_owned());
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                self.0.borrow_mut().push("flush".into());
                Ok(())
            }
        }
        let log = RefCell::new(Vec::new());
        write(&mut Log(&log), &mut Log(&log), "\x1b[1mA\x1b[0m").unwrap();
        assert_eq!(log.into_inner(), ["escapes on", "\x1b[1mA\x1b[0m", "\n", "flush", "restore"]);
    }

    fn strip(text: &str) -> String {
        let mut out = String::new();
        let mut chars = text.chars();
        while let Some(char) = chars.next() {
            if char == '\x1b' {
                chars.by_ref().find(|char| *char == 'm');
                continue;
            }
            out.push(char);
        }
        out
    }
}
