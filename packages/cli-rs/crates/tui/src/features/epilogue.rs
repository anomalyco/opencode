//! Exit summary and command to continue the last session.

use crate::prelude::*;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[90m";

const LOGO_LEFT: [&str; 4] =
    ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"];
const LOGO_RIGHT: [&str; 4] =
    ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"];

#[derive(Default)]
pub struct Epilogue {
    updated_version: RefCell<Option<String>>,
}

impl Epilogue {
    pub fn updated_version(&self, version: String) {
        *self.updated_version.borrow_mut() = Some(version);
    }
}

/// Build the exit text from the current session. An untitled session uses its display label.
pub fn text(tui: &Tui) -> Option<String> {
    let route = tui.route();
    let session = match &*route {
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
    // Use this client's executable name so the hint reopens it.
    let cli_name = std::env::var("OPENCODE_CLI_NAME").unwrap_or_else(|_| "opencode-native".to_owned());
    render(session, updated.as_deref(), &cli_name)
}

/// Print the exit text after terminal restoration. Windows console output needs escape processing enabled until the
/// write flushes.
pub fn print(text: &str) {
    let _ = write(&mut Stdout::default(), &mut std::io::stdout().lock(), text);
}

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
    fn the_session_title_cannot_write_escape_sequences() {
        let text = render(Some(("x\x1b]52;c;cHduZWQ=\x07y\u{9b}", "ses_b")), None, "opencode").unwrap();
        assert!(text.contains("\x1b[1mxy\x1b[0m"), "{text:?}");
    }

    // The Windows console needs escape processing on until the write flushes; no other system takes that path.
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
}
