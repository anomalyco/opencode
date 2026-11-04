//! The prompts of Effect CLI (`effect/src/cli/Prompt.ts`) that the wizard uses: select, confirm, toggle,
//! integer, and text. They look different from the Clack prompts in `crate::prompt`, whose raw mode and key
//! decoding they share.

use std::io::Write;
use std::sync::OnceLock;

use crate::prompt::{self, Keys, Press};

/// Esc, Ctrl+C, or Ctrl+D ended the input (`Terminal.QuitError`).
#[derive(Debug)]
pub struct Quit;

pub const RESET: &str = "\x1b[0m";
pub const BOLD: &str = "\x1b[1m";
const ITALIC: &str = "\x1b[3m";
const UNDERLINE: &str = "\x1b[4m";
pub const RED: &str = "\x1b[31m";
pub const GREEN: &str = "\x1b[32m";
pub const MAGENTA: &str = "\x1b[35m";
pub const WHITE: &str = "\x1b[37m";
pub const BLACK_BRIGHT: &str = "\x1b[90m";
pub const CYAN_BRIGHT: &str = "\x1b[96m";

const SHOW: &str = "\x1b[?25h";
const HIDE: &str = "\x1b[?25l";
const SAVE: &str = "\x1b[s";
const RESTORE: &str = "\x1b[u";
const ERASE_LINE: &str = "\x1b[2K";
const CURSOR_LEFT: &str = "\x1b[G";
const BEEP: &str = "\x07";

// The default (non-Windows) theme.
const PREFIX: &str = "?";
const ARROW_UP: &str = "↑";
const ARROW_DOWN: &str = "↓";
const TICK: &str = "✔";
const ELLIPSIS: &str = "…";
const POINTER_SMALL: &str = "›";
const POINTER: &str = "❯";
const DESCRIPTION_SEPARATOR: &str = "- ";
const TOGGLE_SEPARATOR: &str = "/";
const PRIMARY: &str = CYAN_BRIGHT;
const MUTED: &str = BLACK_BRIGHT;
const SUCCESS: &str = GREEN;
const ERROR: &str = RED;
const SUBMITTED: &str = WHITE;

/// `Ansi.detectColors`: stdout is a terminal and `NO_COLOR` is unset or empty.
pub fn colors() -> bool {
    static COLORS: OnceLock<bool> = OnceLock::new();
    *COLORS.get_or_init(|| {
        use std::io::IsTerminal;
        std::io::stdout().is_terminal()
            && std::env::var_os("NO_COLOR").is_none_or(|value| value.is_empty())
    })
}

/// `Ansi.annotate`: the styles, the text, and a reset, or the text alone without colors.
pub fn annotate(text: &str, styles: &[&str]) -> String {
    match colors() {
        true => format!("{}{text}{RESET}", styles.concat()),
        false => text.to_string(),
    }
}

/// `Console.log`.
pub fn log(text: &str) {
    write(&format!("{text}\n"));
}

fn write(text: &str) {
    let mut stdout = std::io::stdout().lock();
    let _ = stdout
        .write_all(text.as_bytes())
        .and_then(|()| stdout.flush());
}

fn columns() -> usize {
    prompt::stdout_size().1.unwrap_or(0)
}

/// JavaScript's `length`, in UTF-16 units.
fn length(text: &str) -> usize {
    text.encode_utf16().count()
}

fn symbol(symbol: &str, styles: &[&str]) -> String {
    match symbol.is_empty() {
        true => String::new(),
        false => annotate(symbol, styles),
    }
}

fn separate(symbol: &str, text: &str) -> String {
    match symbol.is_empty() {
        true => text.to_string(),
        false => format!("{symbol} {text}"),
    }
}

/// `renderPrompt`: the symbol, the message, the trailing symbol, and the value, on one line.
fn render_prompt(value: &str, message: &str, leading: &str, trailing: &str, plain: bool) -> String {
    let lines: Vec<String> = message
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line))
        .map(|line| match plain {
            true => line.to_string(),
            false => annotate(line, &[BOLD]),
        })
        .collect();
    let mut output = match leading.is_empty() {
        true => String::new(),
        false => format!("{leading} "),
    };
    output += &lines.join("\n");
    if !trailing.is_empty() {
        output += &format!(" {trailing}");
    }
    if !value.is_empty() {
        output += &format!(" {value}");
    } else if !trailing.is_empty() {
        output += " ";
    }
    output
}

fn active_symbols() -> (String, String) {
    (symbol(PREFIX, &[PRIMARY]), symbol(POINTER_SMALL, &[MUTED]))
}

fn submitted_symbols() -> (String, String) {
    (symbol(TICK, &[SUCCESS]), symbol(ELLIPSIS, &[MUTED]))
}

/// `eraseText`: erases the rows `text` takes.
fn erase_text(text: &str, columns: usize) -> String {
    if columns == 0 {
        return format!("{ERASE_LINE}\x1b[1G");
    }
    let rows: usize = text
        .split('\n')
        .map(|line| 1 + length(line).saturating_sub(1) / columns)
        .sum();
    erase_lines(rows)
}

fn erase_lines(rows: usize) -> String {
    let mut command = String::new();
    for index in 0..rows {
        command += ERASE_LINE;
        if index + 1 < rows {
            command += "\x1b[1A";
        }
    }
    if rows > 0 {
        command += CURSOR_LEFT;
    }
    command
}

fn lines(text: &str, columns: usize) -> usize {
    match columns {
        0 => text.split('\n').count(),
        _ => text
            .split('\n')
            .map(|line| length(line).div_ceil(columns))
            .sum(),
    }
}

fn clear_with_error(output: &str, columns: usize, error: &str) -> String {
    if error.is_empty() {
        return erase_text(output, columns);
    }
    format!(
        "\x1b[{}B{}{}",
        lines(error, columns),
        erase_text(&format!("\n{error}"), columns),
        erase_text(output, columns)
    )
}

fn render_error(error: Option<&str>, plain: bool) -> String {
    let Some(error) = error else {
        return String::new();
    };
    let lines: Vec<&str> = error.split('\n').collect();
    if plain {
        return separate(POINTER_SMALL, &lines.join("\n"));
    }
    let lines: Vec<String> = lines
        .iter()
        .map(|line| annotate(line, &[ITALIC, ERROR]))
        .collect();
    format!(
        "{SAVE}\n{}{RESTORE}",
        separate(&symbol(POINTER_SMALL, &[ERROR]), &lines.join("\n"))
    )
}

enum Action<S, O> {
    Beep,
    Next(S),
    Submit(O),
}

trait Prompt {
    type State: Clone;
    type Output;
    fn next(&self, state: &Self::State) -> String;
    fn submitted(&self, state: &Self::State, value: &Self::Output) -> String;
    fn process(&self, press: &Press, state: &Self::State) -> Action<Self::State, Self::Output>;
    fn clear(&self, state: &Self::State, columns: usize) -> String;
}

/// `runLoop`: draws a frame, reads a key, and acts on it, until a submit or the end of input.
fn run<P: Prompt>(prompt: &P, initial: P::State) -> Result<P::Output, Quit> {
    let result = prompt::with_keys(|keys: &mut Keys| {
        let mut state = initial;
        write(&prompt.next(&state));
        loop {
            let press = keys.next().ok_or(Quit)?;
            match prompt.process(&press, &state) {
                Action::Beep => write(BEEP),
                Action::Next(next) => {
                    let clear = prompt.clear(&state, columns());
                    state = next;
                    write(&(clear + &prompt.next(&state)));
                }
                Action::Submit(value) => {
                    let clear = prompt.clear(&state, columns());
                    write(&(clear + &prompt.submitted(&state, &value)));
                    // Each prompt reads from a queue of its own, which goes away with the keys left in it.
                    keys.discard();
                    return Ok(value);
                }
            }
            // NodeTerminal ends the input after delivering a quit key.
            let key = &press.key;
            if key.is("escape") || (key.ctrl && (key.is("c") || key.is("d"))) {
                return Err(Quit);
            }
        }
    });
    write(SHOW);
    result
}

fn name(press: &Press) -> &str {
    press.key.name.as_deref().unwrap_or("")
}

fn input(press: &Press) -> &str {
    press.char.as_deref().unwrap_or("")
}

pub struct Select {
    pub message: String,
    /// The titles and their descriptions.
    pub choices: Vec<(String, Option<String>)>,
}

const MAX_PER_PAGE: usize = 10;

impl Select {
    /// The index of the chosen choice.
    pub fn prompt(&self) -> Result<usize, Quit> {
        run(self, 0)
    }

    fn header(&self, leading: &str, trailing: &str, plain: bool) -> String {
        render_prompt("", &self.message, leading, trailing, plain)
    }

    fn choices(&self, cursor: usize, plain: bool) -> String {
        let total = self.choices.len();
        let (start, end) = entries_to_display(cursor, total, MAX_PER_PAGE);
        (start..end)
            .map(|index| {
                let paging = match index {
                    _ if index == start && start > 0 => ARROW_UP,
                    _ if index + 1 == end && end < total => ARROW_DOWN,
                    _ => " ",
                };
                let selected = index == cursor;
                let prefix = match (selected, plain) {
                    (true, true) => format!("{POINTER}{paging}"),
                    (true, false) => format!("{}{paging}", symbol(POINTER, &[PRIMARY])),
                    (false, _) => format!("{paging} "),
                };
                let (title, description) = &self.choices[index];
                let title = match selected && !plain {
                    true => annotate(title, &[UNDERLINE, PRIMARY]),
                    false => title.clone(),
                };
                let description = match description {
                    Some(description) if selected => {
                        let text = format!("{DESCRIPTION_SEPARATOR}{description}");
                        match plain {
                            true => text,
                            false => annotate(&text, &[MUTED]),
                        }
                    }
                    _ => String::new(),
                };
                format!("{prefix}{title} {description}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

impl Prompt for Select {
    type State = usize;
    type Output = usize;

    fn next(&self, state: &usize) -> String {
        let (leading, trailing) = active_symbols();
        format!(
            "{HIDE}{}\n{}",
            self.header(&leading, &trailing, false),
            self.choices(*state, false)
        )
    }

    fn submitted(&self, state: &usize, _: &usize) -> String {
        let (leading, trailing) = submitted_symbols();
        format!(
            "{} {}\n",
            self.header(&leading, &trailing, false),
            annotate(&self.choices[*state].0, &[SUBMITTED])
        )
    }

    fn process(&self, press: &Press, state: &usize) -> Action<usize, usize> {
        let total = self.choices.len();
        match name(press) {
            "k" | "up" => Action::Next(if *state == 0 { total - 1 } else { state - 1 }),
            "j" | "down" => Action::Next(if *state + 1 == total { 0 } else { state + 1 }),
            "tab" => Action::Next((state + 1) % total),
            "enter" | "return" => Action::Submit(*state),
            _ => Action::Beep,
        }
    }

    fn clear(&self, state: &usize, columns: usize) -> String {
        let text = format!(
            "{}\n{}",
            self.header(PREFIX, POINTER_SMALL, true),
            self.choices(*state, true)
        );
        erase_text(&text, columns) + ERASE_LINE + CURSOR_LEFT
    }
}

fn entries_to_display(cursor: usize, total: usize, max: usize) -> (usize, usize) {
    let start = (total as i64 - max as i64)
        .min(cursor as i64 - (max / 2) as i64)
        .max(0) as usize;
    (start, (start + max).min(total))
}

pub struct Confirm {
    pub message: String,
    pub labels: (&'static str, &'static str),
    pub placeholders: (&'static str, &'static str),
}

impl Confirm {
    /// `Confirm` with its default labels and `initial: false`.
    pub fn new(message: String) -> Confirm {
        Confirm {
            message,
            labels: ("yes", "no"),
            placeholders: ("(Y/n)", "(y/N)"),
        }
    }

    pub fn prompt(&self) -> Result<bool, Quit> {
        run(self, false)
    }
}

impl Prompt for Confirm {
    type State = bool;
    type Output = bool;

    fn next(&self, state: &bool) -> String {
        let (leading, trailing) = active_symbols();
        let placeholder = if *state {
            self.placeholders.0
        } else {
            self.placeholders.1
        };
        let value = annotate(placeholder, &[MUTED]);
        format!(
            "{HIDE}{}",
            render_prompt(&value, &self.message, &leading, &trailing, false)
        )
    }

    fn submitted(&self, _: &bool, value: &bool) -> String {
        let (leading, trailing) = submitted_symbols();
        let label = if *value { self.labels.0 } else { self.labels.1 };
        render_prompt(label, &self.message, &leading, &trailing, false) + "\n"
    }

    fn process(&self, press: &Press, state: &bool) -> Action<bool, bool> {
        let value = input(press).to_lowercase();
        match name(press) {
            "enter" | "return" => Action::Submit(*state),
            // /^y|t$/ and /^n|f$/.
            _ if value.starts_with('y') || value.ends_with('t') => Action::Submit(true),
            _ if value.starts_with('n') || value.ends_with('f') => Action::Submit(false),
            _ => Action::Beep,
        }
    }

    fn clear(&self, state: &bool, columns: usize) -> String {
        let placeholder = if *state {
            self.placeholders.0
        } else {
            self.placeholders.1
        };
        let text = render_prompt(placeholder, &self.message, PREFIX, POINTER_SMALL, true);
        erase_text(&text, columns) + ERASE_LINE + CURSOR_LEFT
    }
}

pub struct Toggle {
    pub message: String,
    pub active: &'static str,
    pub inactive: &'static str,
}

impl Toggle {
    /// Starts on the active value.
    pub fn prompt(&self) -> Result<bool, Quit> {
        run(self, true)
    }

    fn toggle(&self, value: bool, submitted: bool) -> String {
        let separator = symbol(TOGGLE_SEPARATOR, &[MUTED]);
        let selected = [UNDERLINE, if submitted { SUBMITTED } else { PRIMARY }];
        let (active, inactive) = match value {
            true => (annotate(self.active, &selected), self.inactive.to_string()),
            false => (self.active.to_string(), annotate(self.inactive, &selected)),
        };
        format!("{active} {}", separate(&separator, &inactive))
    }
}

impl Prompt for Toggle {
    type State = bool;
    type Output = bool;

    fn next(&self, state: &bool) -> String {
        let (leading, trailing) = active_symbols();
        let toggle = self.toggle(*state, false);
        format!(
            "{HIDE}{}",
            render_prompt(&toggle, &self.message, &leading, &trailing, false)
        )
    }

    fn submitted(&self, state: &bool, _: &bool) -> String {
        let (leading, trailing) = submitted_symbols();
        render_prompt(
            &self.toggle(*state, true),
            &self.message,
            &leading,
            &trailing,
            false,
        ) + "\n"
    }

    fn process(&self, press: &Press, state: &bool) -> Action<bool, bool> {
        // Node names the space key "space", so Effect's `" "` case never matches.
        match name(press) {
            "0" | "j" | "delete" | "right" | "down" => Action::Next(false),
            "1" | "k" | "left" | "up" => Action::Next(true),
            "tab" => Action::Next(!state),
            "enter" | "return" => Action::Submit(*state),
            _ => Action::Beep,
        }
    }

    fn clear(&self, _: &bool, columns: usize) -> String {
        let toggle = format!(
            "{} {}",
            self.active,
            separate(TOGGLE_SEPARATOR, self.inactive)
        );
        let text = render_prompt(&toggle, &self.message, PREFIX, POINTER_SMALL, true);
        erase_text(&text, columns) + ERASE_LINE + CURSOR_LEFT
    }
}

#[derive(Clone)]
struct Field {
    cursor: usize,
    value: String,
    error: Option<String>,
}

impl Field {
    fn new(value: String) -> Field {
        Field {
            cursor: value.chars().count(),
            value,
            error: None,
        }
    }

    fn with(&self, value: String) -> Field {
        Field {
            value,
            error: None,
            ..self.clone()
        }
    }
}

pub struct Int {
    pub message: String,
    pub default: Option<i64>,
    pub min: Option<i64>,
    pub max: Option<i64>,
}

impl Int {
    pub fn prompt(&self) -> Result<i64, Quit> {
        let initial = self
            .default
            .map(|value| value.to_string())
            .unwrap_or_default();
        run(self, Field::new(initial))
    }

    fn output(
        &self,
        state: &Field,
        leading: &str,
        trailing: &str,
        plain: bool,
        submitted: bool,
    ) -> String {
        let value = match submitted || plain {
            true => state.value.clone(),
            false if state.error.is_some() => annotate(&state.value, &[ERROR]),
            false => annotate(&state.value, &[UNDERLINE, PRIMARY]),
        };
        render_prompt(&value, &self.message, leading, trailing, plain)
    }
}

impl Prompt for Int {
    type State = Field;
    type Output = i64;

    fn next(&self, state: &Field) -> String {
        let (leading, trailing) = active_symbols();
        self.output(state, &leading, &trailing, false, false)
            + &render_error(state.error.as_deref(), false)
    }

    fn submitted(&self, state: &Field, _: &i64) -> String {
        let (leading, trailing) = submitted_symbols();
        self.output(state, &leading, &trailing, false, true) + "\n"
    }

    fn process(&self, press: &Press, state: &Field) -> Action<Field, i64> {
        if press.key.ctrl && press.key.is("u") {
            return Action::Next(Field::new(String::new()));
        }
        match name(press) {
            "backspace" => match state.value.is_empty() {
                true => Action::Beep,
                false => {
                    let mut value = state.value.clone();
                    value.pop();
                    Action::Next(state.with(value))
                }
            },
            "k" | "up" => Action::Next(state.with(match state.value.as_str() {
                "" | "-" => "1".into(),
                value => (parse_int(value).unwrap_or(0) + 1).to_string(),
            })),
            "j" | "down" => Action::Next(state.with(match state.value.as_str() {
                "" | "-" => "-1".into(),
                value => (parse_int(value).unwrap_or(0) - 1).to_string(),
            })),
            "enter" | "return" => {
                let Some(value) = parse_int(&state.value) else {
                    return Action::Next(Field {
                        error: Some("Must provide an integer value".into()),
                        ..state.clone()
                    });
                };
                let error = match (self.min, self.max) {
                    (Some(min), _) if value < min => {
                        Some(format!("{value} must be greater than or equal to {min}"))
                    }
                    (_, Some(max)) if value > max => {
                        Some(format!("{value} must be less than or equal to {max}"))
                    }
                    _ => None,
                };
                match error {
                    Some(error) => Action::Next(Field {
                        error: Some(error),
                        ..state.clone()
                    }),
                    None => Action::Submit(value),
                }
            }
            _ => {
                let input = input(press);
                if state.value.is_empty() && input == "-" {
                    return Action::Next(state.with("-".into()));
                }
                match parse_int(&format!("{}{input}", state.value)) {
                    Some(value) => Action::Next(state.with(value.to_string())),
                    None => Action::Beep,
                }
            }
        }
    }

    fn clear(&self, state: &Field, columns: usize) -> String {
        let error = render_error(state.error.as_deref(), true);
        let output = self.output(state, PREFIX, POINTER_SMALL, true, false);
        clear_with_error(&output, columns, &error) + ERASE_LINE + CURSOR_LEFT
    }
}

/// JavaScript's `parseInt(text)`: optional whitespace and sign, then the leading digits.
fn parse_int(text: &str) -> Option<i64> {
    let text = text.trim_start();
    let (negative, rest) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let value = digits.parse::<i64>().ok()?;
    Some(if negative { -value } else { value })
}

pub struct Text {
    pub message: String,
}

impl Text {
    pub fn prompt(&self) -> Result<String, Quit> {
        run(self, Field::new(String::new()))
    }

    fn output(
        &self,
        state: &Field,
        leading: &str,
        trailing: &str,
        plain: bool,
        submitted: bool,
    ) -> String {
        let value = match plain || state.value.is_empty() {
            true => state.value.clone(),
            false if state.error.is_some() => annotate(&state.value, &[ERROR]),
            false if submitted => annotate(&state.value, &[SUBMITTED]),
            false => annotate(&state.value, &[UNDERLINE, PRIMARY]),
        };
        render_prompt(&value, &self.message, leading, trailing, plain)
    }
}

impl Prompt for Text {
    type State = Field;
    type Output = String;

    fn next(&self, state: &Field) -> String {
        let (leading, trailing) = active_symbols();
        let offset = state.cursor as i64 - state.value.chars().count() as i64;
        let moved = match offset {
            0 => String::new(),
            offset if offset > 0 => format!("\x1b[{offset}C"),
            offset => format!("\x1b[{}D", -offset),
        };
        self.output(state, &leading, &trailing, false, false)
            + &render_error(state.error.as_deref(), false)
            + &moved
    }

    fn submitted(&self, state: &Field, _: &String) -> String {
        let (leading, trailing) = submitted_symbols();
        self.output(state, &leading, &trailing, false, true) + "\n"
    }

    fn process(&self, press: &Press, state: &Field) -> Action<Field, String> {
        let at = |field: &Field, cursor: usize| Field {
            cursor,
            error: None,
            ..field.clone()
        };
        let length = state.value.chars().count();
        if press.key.ctrl {
            return match name(press) {
                "u" => Action::Next(Field::new(String::new())),
                "a" => Action::Next(at(state, 0)),
                "e" => Action::Next(at(state, length)),
                _ => Action::Beep,
            };
        }
        match name(press) {
            "backspace" => match state.cursor {
                0 => Action::Beep,
                cursor => {
                    let mut chars: Vec<char> = state.value.chars().collect();
                    chars.remove(cursor - 1);
                    Action::Next(Field {
                        cursor: cursor - 1,
                        value: chars.into_iter().collect(),
                        error: None,
                    })
                }
            },
            "left" => match state.cursor {
                0 => Action::Beep,
                cursor => Action::Next(at(state, cursor - 1)),
            },
            "right" => match state.cursor >= length {
                true => Action::Beep,
                false => Action::Next(at(state, state.cursor + 1)),
            },
            "home" => Action::Next(at(state, 0)),
            "end" => Action::Next(at(state, length)),
            "enter" | "return" => Action::Submit(state.value.clone()),
            // The default value is "", so Tab only redraws a non-empty value.
            "tab" => match state.value.is_empty() {
                true => Action::Beep,
                false => Action::Next(at(state, length)),
            },
            _ => {
                let input = input(press);
                let before: String = state.value.chars().take(state.cursor).collect();
                let after: String = state.value.chars().skip(state.cursor).collect();
                Action::Next(Field {
                    cursor: state.cursor + input.chars().count(),
                    value: format!("{before}{input}{after}"),
                    error: None,
                })
            }
        }
    }

    fn clear(&self, state: &Field, columns: usize) -> String {
        let error = render_error(state.error.as_deref(), true);
        let output = self.output(state, PREFIX, POINTER_SMALL, true, false);
        clear_with_error(&output, columns, &error) + ERASE_LINE + CURSOR_LEFT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_int_reads_like_javascript() {
        let cases = [
            ("", None),
            ("-", None),
            ("--1", None),
            ("a", None),
            ("05", Some(5)),
            ("5a", Some(5)),
            ("-12", Some(-12)),
            (" 7", Some(7)),
            ("+3", Some(3)),
        ];
        for (text, expected) in cases {
            assert_eq!(parse_int(text), expected, "parseInt({text:?})");
        }
    }

    #[test]
    fn select_pages_like_effect() {
        // entriesToDisplay(cursor, total, 10)
        let cases = [
            (0, 3, (0, 3)),
            (0, 12, (0, 10)),
            (5, 12, (0, 10)),
            (6, 12, (1, 11)),
            (11, 12, (2, 12)),
        ];
        for (cursor, total, expected) in cases {
            assert_eq!(
                entries_to_display(cursor, total, 10),
                expected,
                "cursor {cursor} of {total}"
            );
        }
    }

    #[test]
    fn erase_counts_wrapped_rows() {
        assert_eq!(erase_text("abc", 0), "\x1b[2K\x1b[1G");
        assert_eq!(
            erase_text("abcd\nx", 2),
            "\x1b[2K\x1b[1A\x1b[2K\x1b[1A\x1b[2K\x1b[G"
        );
        assert_eq!(lines("abc\n\nx", 2), 3);
    }
}
