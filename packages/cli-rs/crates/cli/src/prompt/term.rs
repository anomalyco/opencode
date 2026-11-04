//! The terminal side of a prompt: raw mode as Node's `setRawMode` sets it, terminal sizes, and key
//! decoding as Node's `readline.emitKeypressEvents` does it.

use std::collections::VecDeque;
use std::io::Write;
use std::os::fd::{AsFd, BorrowedFd};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use rustix::event::{PollFd, PollFlags, Timespec, poll};
use rustix::io::Errno;
use rustix::termios::{
    ControlModes, InputModes, LocalModes, OptionalActions, OutputModes, SpecialCodeIndex, Termios,
    isatty, tcgetattr, tcgetwinsize, tcsetattr,
};

use super::Output;

/// How long a lone ESC waits for the rest of a sequence (Clack's `escapeCodeTimeout`).
const ESCAPE_TIMEOUT: Duration = Duration::from_millis(50);

/// A duplicate of stdin's descriptor, kept for the whole process. Reads bypass std's buffer, which
/// nothing else in the CLI fills while a prompt runs.
fn stdin() -> BorrowedFd<'static> {
    static FD: std::sync::OnceLock<std::os::fd::OwnedFd> = std::sync::OnceLock::new();
    FD.get_or_init(|| {
        std::io::stdin()
            .as_fd()
            .try_clone_to_owned()
            .expect("stdin has a descriptor")
    })
    .as_fd()
}

/// Both ends are terminals, as `requireInteractive` in `packages/cli/src/ui/prompt.ts` checks.
pub fn interactive() -> bool {
    isatty(stdin()) && isatty(std::io::stdout())
}

/// `process.stdout.columns`: unset when stdout is not a terminal, and then Clack does not wrap.
pub fn columns() -> Option<usize> {
    let stdout = std::io::stdout();
    if !isatty(&stdout) {
        return None;
    }
    tcgetwinsize(&stdout)
        .ok()
        .map(|size| usize::from(size.ws_col))
        .filter(|columns| *columns > 0)
}

/// The rows of the prompt's output terminal, or 10 when it is not one (`limitOptions`).
pub fn rows(output: Output) -> usize {
    let size = match output {
        Output::Stdout => tcgetwinsize(std::io::stdout()),
        Output::Stderr => tcgetwinsize(std::io::stderr()),
    };
    match size {
        Ok(size) if output.is_terminal() => usize::from(size.ws_row),
        _ => 10,
    }
}

impl Output {
    pub(super) fn is_terminal(self) -> bool {
        match self {
            Output::Stdout => isatty(std::io::stdout()),
            Output::Stderr => isatty(std::io::stderr()),
        }
    }

    pub(super) fn write(self, text: &str) {
        // A closed terminal or pipe has nobody left to show the prompt to, so errors are dropped.
        let _ = match self {
            Output::Stdout => {
                let mut out = std::io::stdout().lock();
                out.write_all(text.as_bytes()).and_then(|()| out.flush())
            }
            Output::Stderr => {
                let mut out = std::io::stderr().lock();
                out.write_all(text.as_bytes()).and_then(|()| out.flush())
            }
        };
    }
}

/// Raw mode on stdin while alive, when stdin is a terminal. The flags are libuv's
/// `UV_TTY_MODE_RAW`, which keeps `ONLCR`, so `\n` still starts a new line.
pub struct Raw {
    saved: Option<Termios>,
}

impl Raw {
    pub fn enable() -> Raw {
        let saved = isatty(stdin()).then(|| tcgetattr(stdin()).ok()).flatten();
        if let Some(saved) = &saved {
            let mut raw = saved.clone();
            raw.input_modes -= InputModes::BRKINT
                | InputModes::ICRNL
                | InputModes::INPCK
                | InputModes::ISTRIP
                | InputModes::IXON;
            raw.output_modes |= OutputModes::ONLCR;
            raw.control_modes |= ControlModes::CS8;
            raw.local_modes -=
                LocalModes::ECHO | LocalModes::ICANON | LocalModes::IEXTEN | LocalModes::ISIG;
            raw.special_codes[SpecialCodeIndex::VMIN] = 1;
            raw.special_codes[SpecialCodeIndex::VTIME] = 0;
            let _ = tcsetattr(stdin(), OptionalActions::Now, &raw);
        }
        Raw { saved }
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        if let Some(saved) = &self.saved {
            let _ = tcsetattr(stdin(), OptionalActions::Now, saved);
        }
    }
}

/// A key as `emitKeypressEvents` reports it. `name` is `None` for unnamed characters and
/// `"undefined"` for unknown escape sequences, as in Node.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Key {
    pub name: Option<String>,
    pub ctrl: bool,
    pub meta: bool,
    pub shift: bool,
    pub sequence: String,
}

impl Key {
    pub fn is(&self, name: &str) -> bool {
        self.name.as_deref() == Some(name)
    }
}

/// One keypress: the typed text (`None` for escape sequences) and the key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Press {
    pub char: Option<String>,
    pub key: Key,
}

/// Reads keypresses from stdin. Bytes that arrive after a prompt has finished stay buffered for the
/// next one.
pub struct Keys {
    bytes: Vec<u8>,
    chars: VecDeque<char>,
    stop: Option<Arc<AtomicBool>>,
}

enum Fill {
    Data,
    Timeout,
    End,
}

impl Keys {
    pub fn new() -> Keys {
        Keys {
            bytes: Vec::new(),
            chars: VecDeque::new(),
            stop: None,
        }
    }

    /// A reader that gives up (as at the end of input) once `stop` is set.
    pub fn stoppable(stop: Arc<AtomicBool>) -> Keys {
        Keys {
            bytes: Vec::new(),
            chars: VecDeque::new(),
            stop: Some(stop),
        }
    }

    /// The next keypress, or `None` at the end of input.
    pub fn next(&mut self) -> Option<Press> {
        loop {
            if let Some(press) = decode(&mut |after_escape| self.pull(after_escape))? {
                return Some(press);
            }
        }
    }

    /// The next character; `Some("")` when the character after an ESC does not arrive in time,
    /// `None` at the end of input.
    fn pull(&mut self, after_escape: bool) -> Option<String> {
        loop {
            if let Some(char) = self.chars.pop_front() {
                return Some(char.to_string());
            }
            let timeout = after_escape.then_some(ESCAPE_TIMEOUT);
            match self.fill(timeout) {
                Fill::Data => continue,
                Fill::Timeout => return Some(String::new()),
                Fill::End => return None,
            }
        }
    }

    fn fill(&mut self, timeout: Option<Duration>) -> Fill {
        let deadline = timeout.map(|timeout| Instant::now() + timeout);
        loop {
            if self
                .stop
                .as_ref()
                .is_some_and(|stop| stop.load(Ordering::Relaxed))
            {
                return Fill::End;
            }
            let left = deadline.map(|deadline| deadline.saturating_duration_since(Instant::now()));
            if left == Some(Duration::ZERO) {
                return Fill::Timeout;
            }
            // A stoppable reader wakes up regularly to look at its flag.
            let wait = match (left, &self.stop) {
                (Some(left), Some(_)) => Some(left.min(ESCAPE_TIMEOUT)),
                (None, Some(_)) => Some(ESCAPE_TIMEOUT),
                (left, None) => left,
            };
            let spec = wait.map(|wait| Timespec {
                tv_sec: wait.as_secs() as _,
                tv_nsec: wait.subsec_nanos() as _,
            });
            let fd = stdin();
            let mut fds = [PollFd::new(&fd, PollFlags::IN)];
            match poll(&mut fds, spec.as_ref()) {
                Ok(0) => continue,
                Ok(_) => {}
                Err(Errno::INTR) => continue,
                Err(_) => return Fill::End,
            }
            let mut buffer = [0u8; 1024];
            match rustix::io::read(stdin(), &mut buffer) {
                Ok(0) => return Fill::End,
                Ok(count) => {
                    self.bytes.extend_from_slice(&buffer[..count]);
                    self.decode_utf8();
                    if !self.chars.is_empty() {
                        return Fill::Data;
                    }
                }
                Err(Errno::INTR | Errno::AGAIN) => continue,
                Err(_) => return Fill::End,
            }
        }
    }

    /// Moves the complete UTF-8 characters to `chars`; invalid bytes become U+FFFD, as Node's
    /// `StringDecoder` makes them.
    fn decode_utf8(&mut self) {
        let mut rest = self.bytes.as_slice();
        loop {
            match std::str::from_utf8(rest) {
                Ok(text) => {
                    self.chars.extend(text.chars());
                    rest = &[];
                    break;
                }
                Err(error) => {
                    let (valid, after) = rest.split_at(error.valid_up_to());
                    self.chars
                        .extend(std::str::from_utf8(valid).expect("checked above").chars());
                    match error.error_len() {
                        Some(length) => {
                            self.chars.push_back('\u{fffd}');
                            rest = &after[length..];
                        }
                        None => {
                            rest = after;
                            break;
                        }
                    }
                }
            }
        }
        self.bytes = rest.to_vec();
    }
}

const ESC: &str = "\x1b";

/// `emitKeys` from Node's `lib/internal/readline/utils.js`. Returns `None` at the end of input,
/// `Some(None)` for input that is not a keypress.
fn decode(pull: &mut dyn FnMut(bool) -> Option<String>) -> Option<Option<Press>> {
    let digit = |text: &str| text.len() == 1 && text.as_bytes()[0].is_ascii_digit();
    let mut ch = pull(false)?;
    let mut s = ch.clone();
    let mut escaped = false;
    let mut key = Key::default();
    if ch == ESC {
        escaped = true;
        ch = pull(true)?;
        s += &ch;
        if ch == ESC {
            ch = pull(true)?;
            s += &ch;
        }
    }
    if escaped && (ch == "O" || ch == "[") {
        let mut code = ch.clone();
        let mut modifier = 0u32;
        if ch == "O" {
            ch = pull(false)?;
            s += &ch;
            if digit(&ch) {
                modifier = ch.parse::<u32>().expect("a digit").saturating_sub(1);
                ch = pull(false)?;
                s += &ch;
            }
            code += &ch;
        } else {
            ch = pull(false)?;
            s += &ch;
            if ch == "[" {
                code += &ch;
                ch = pull(false)?;
                s += &ch;
            }
            let start = s.len() - ch.len();
            if digit(&ch) {
                ch = pull(false)?;
                s += &ch;
                if digit(&ch) {
                    ch = pull(false)?;
                    s += &ch;
                    if digit(&ch) {
                        ch = pull(false)?;
                        s += &ch;
                    }
                }
            }
            if ch == ";" {
                ch = pull(false)?;
                s += &ch;
                if digit(&ch) {
                    s += &pull(false)?;
                }
            }
            let (part, found) = command(&s[start..]);
            code += &part;
            modifier = found;
        }
        key.ctrl = modifier & 4 != 0;
        key.meta = modifier & 10 != 0;
        key.shift = modifier & 1 != 0;
        let (name, shift, ctrl) = sequence_name(&code);
        key.name = Some(name.to_string());
        key.shift |= shift;
        key.ctrl |= ctrl;
    } else {
        let first = ch.chars().next();
        let (name, meta) = match ch.as_str() {
            "\r" => (Some("return".to_string()), escaped),
            "\n" => (Some("enter".to_string()), escaped),
            "\t" => (Some("tab".to_string()), escaped),
            "\x08" | "\x7f" => (Some("backspace".to_string()), escaped),
            ESC => (Some("escape".to_string()), escaped),
            " " => (Some("space".to_string()), escaped),
            _ if !escaped && first.is_some_and(|first| first <= '\x1a') => {
                key.ctrl = true;
                let code = first.expect("checked") as u8;
                (Some(char::from(code + b'a' - 1).to_string()), false)
            }
            _ if first.is_some_and(|first| first.is_ascii_alphanumeric()) && ch.len() == 1 => {
                key.shift = first.is_some_and(|first| first.is_ascii_uppercase());
                (Some(ch.to_ascii_lowercase()), escaped)
            }
            _ if escaped => (
                (if ch.is_empty() {
                    Some("escape".to_string())
                } else {
                    None
                }),
                true,
            ),
            _ => (None, false),
        };
        key.name = name;
        key.meta = meta;
    }
    key.sequence = s.clone();
    if !s.is_empty() && (key.name.is_some() || escaped) {
        return Some(Some(Press {
            char: (!escaped).then_some(s),
            key,
        }));
    }
    if s.chars().count() == 1 {
        return Some(Some(Press { char: Some(s), key }));
    }
    Some(None)
}

/// The code and modifier of a CSI command, as Node's two patterns read it.
fn command(cmd: &str) -> (String, u32) {
    let bytes = cmd.as_bytes();
    let digits = bytes
        .iter()
        .take_while(|byte| byte.is_ascii_digit())
        .count();
    // /^(?:(\d\d?)(?:;(\d))?([~^$])|(\d{3}~))$/
    if digits == 3 && cmd.len() == 4 && bytes[3] == b'~' {
        return (cmd.to_string(), 0);
    }
    if (1..=2).contains(&digits) {
        let rest = &cmd[digits..];
        let (modifier, end) = match rest.as_bytes() {
            [b';', digit, end] if digit.is_ascii_digit() => (u32::from(digit - b'0'), *end),
            [end] => (1, *end),
            _ => (0, 0),
        };
        if matches!(end, b'~' | b'^' | b'$') {
            return (
                format!("{}{}", &cmd[..digits], char::from(end)),
                modifier.saturating_sub(1),
            );
        }
    }
    // /^((\d;)?(\d))?([A-Za-z])$/
    let letter = |byte: &u8| byte.is_ascii_alphabetic();
    match bytes {
        [end] if letter(end) => (char::from(*end).to_string(), 0),
        [digit, end] if digit.is_ascii_digit() && letter(end) => (
            char::from(*end).to_string(),
            u32::from(digit - b'0').saturating_sub(1),
        ),
        [first, b';', digit, end]
            if first.is_ascii_digit() && digit.is_ascii_digit() && letter(end) =>
        {
            (
                char::from(*end).to_string(),
                u32::from(digit - b'0').saturating_sub(1),
            )
        }
        _ => (cmd.to_string(), 0),
    }
}

/// The key name of an escape sequence code, with the shift and ctrl it implies. Unknown codes are
/// named `"undefined"`, as in Node.
fn sequence_name(code: &str) -> (&'static str, bool, bool) {
    match code {
        "[P" | "OP" | "[11~" | "[[A" => ("f1", false, false),
        "[Q" | "OQ" | "[12~" | "[[B" => ("f2", false, false),
        "[R" | "OR" | "[13~" | "[[C" => ("f3", false, false),
        "[S" | "OS" | "[14~" | "[[D" => ("f4", false, false),
        "[15~" | "[[E" => ("f5", false, false),
        "[17~" => ("f6", false, false),
        "[18~" => ("f7", false, false),
        "[19~" => ("f8", false, false),
        "[20~" => ("f9", false, false),
        "[21~" => ("f10", false, false),
        "[23~" => ("f11", false, false),
        "[24~" => ("f12", false, false),
        "[200~" => ("paste-start", false, false),
        "[201~" => ("paste-end", false, false),
        "[A" | "OA" => ("up", false, false),
        "[B" | "OB" => ("down", false, false),
        "[C" | "OC" => ("right", false, false),
        "[D" | "OD" => ("left", false, false),
        "[E" | "OE" => ("clear", false, false),
        "[F" | "OF" | "[4~" | "[8~" => ("end", false, false),
        "[H" | "OH" | "[1~" | "[7~" => ("home", false, false),
        "[2~" => ("insert", false, false),
        "[3~" => ("delete", false, false),
        "[5~" | "[[5~" => ("pageup", false, false),
        "[6~" | "[[6~" => ("pagedown", false, false),
        "[a" => ("up", true, false),
        "[b" => ("down", true, false),
        "[c" => ("right", true, false),
        "[d" => ("left", true, false),
        "[e" => ("clear", true, false),
        "[2$" => ("insert", true, false),
        "[3$" => ("delete", true, false),
        "[5$" => ("pageup", true, false),
        "[6$" => ("pagedown", true, false),
        "[7$" => ("home", true, false),
        "[8$" => ("end", true, false),
        "Oa" => ("up", false, true),
        "Ob" => ("down", false, true),
        "Oc" => ("right", false, true),
        "Od" => ("left", false, true),
        "Oe" => ("clear", false, true),
        "[2^" => ("insert", false, true),
        "[3^" => ("delete", false, true),
        "[5^" => ("pageup", false, true),
        "[6^" => ("pagedown", false, true),
        "[7^" => ("home", false, true),
        "[8^" => ("end", false, true),
        "[Z" => ("tab", true, false),
        _ => ("undefined", false, false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn presses(input: &str) -> Vec<Press> {
        let mut chars: VecDeque<String> = input.chars().map(String::from).collect();
        let mut pull =
            |after_escape: bool| chars.pop_front().or_else(|| after_escape.then(String::new));
        std::iter::from_fn(|| decode(&mut pull)).flatten().collect()
    }

    fn key(name: Option<&str>, sequence: &str) -> Key {
        Key {
            name: name.map(String::from),
            sequence: sequence.to_string(),
            ..Key::default()
        }
    }

    #[test]
    fn decodes_like_emit_keypress_events() {
        // Expected values from Bun's `readline.emitKeypressEvents`.
        let cases: Vec<(&str, Vec<Press>)> = vec![
            (
                "a",
                vec![Press {
                    char: Some("a".into()),
                    key: key(Some("a"), "a"),
                }],
            ),
            (
                "A",
                vec![Press {
                    char: Some("A".into()),
                    key: Key {
                        shift: true,
                        ..key(Some("a"), "A")
                    },
                }],
            ),
            (
                "\r",
                vec![Press {
                    char: Some("\r".into()),
                    key: key(Some("return"), "\r"),
                }],
            ),
            (
                "\n",
                vec![Press {
                    char: Some("\n".into()),
                    key: key(Some("enter"), "\n"),
                }],
            ),
            (
                "\x03",
                vec![Press {
                    char: Some("\x03".into()),
                    key: Key {
                        ctrl: true,
                        ..key(Some("c"), "\x03")
                    },
                }],
            ),
            (
                "\x1b[A",
                vec![Press {
                    char: None,
                    key: key(Some("up"), "\x1b[A"),
                }],
            ),
            (
                "\x1b[1;5C",
                vec![Press {
                    char: None,
                    key: Key {
                        ctrl: true,
                        ..key(Some("right"), "\x1b[1;5C")
                    },
                }],
            ),
            (
                "\x1b[3~",
                vec![Press {
                    char: None,
                    key: key(Some("delete"), "\x1b[3~"),
                }],
            ),
            (
                "\x1b[Z",
                vec![Press {
                    char: None,
                    key: Key {
                        shift: true,
                        ..key(Some("tab"), "\x1b[Z")
                    },
                }],
            ),
            (
                "\x1bb",
                vec![Press {
                    char: None,
                    key: Key {
                        meta: true,
                        ..key(Some("b"), "\x1bb")
                    },
                }],
            ),
            (
                "\x1b",
                vec![Press {
                    char: None,
                    key: Key {
                        meta: true,
                        ..key(Some("escape"), "\x1b")
                    },
                }],
            ),
            (
                ".",
                vec![Press {
                    char: Some(".".into()),
                    key: key(None, "."),
                }],
            ),
            (
                "é",
                vec![Press {
                    char: Some("é".into()),
                    key: key(None, "é"),
                }],
            ),
            (
                "\x1b[99x",
                vec![Press {
                    char: None,
                    key: key(Some("undefined"), "\x1b[99x"),
                }],
            ),
        ];
        for (input, expected) in cases {
            assert_eq!(presses(input), expected, "{input:?}");
        }
    }
}
