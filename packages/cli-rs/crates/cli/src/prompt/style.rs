//! Colors as picocolors 1.1 writes them, and the symbols of `@clack/prompts` (`common.ts`).

use std::io::IsTerminal;
use std::sync::OnceLock;

use super::State;

/// picocolors' `isColorSupported`: off with `NO_COLOR` or `--no-color`; on with `FORCE_COLOR`, `--color`,
/// `CI`, or a terminal on stdout whose `TERM` is not `dumb`. It looks at stdout even when a prompt
/// writes to stderr.
fn enabled() -> bool {
    static ENABLED: OnceLock<bool> = OnceLock::new();
    *ENABLED.get_or_init(|| {
        let set = |name| std::env::var_os(name).is_some_and(|value| !value.is_empty());
        let flag = |name: &str| std::env::args().any(|arg| arg == name);
        !(set("NO_COLOR") || flag("--no-color"))
            && (set("FORCE_COLOR")
                || flag("--color")
                || (std::io::stdout().is_terminal()
                    && std::env::var("TERM").as_deref() != Ok("dumb"))
                || set("CI"))
    })
}

/// picocolors' `formatter`: wraps `input` in `open` and `close`, and replaces every inner `close`
/// (searched from `open.len()`, as picocolors does) with `replace`, so nested styles survive.
fn format(input: &str, open: &str, close: &str, replace: &str) -> String {
    if !enabled() {
        return input.to_string();
    }
    // Every `close` starts with ESC, so a match always starts on a character boundary.
    let start =
        (open.len().min(input.len())..=input.len()).find(|index| input.is_char_boundary(*index));
    let Some(index) = start.and_then(|start| input[start..].find(close).map(|index| index + start))
    else {
        return format!("{open}{input}{close}");
    };
    let mut result = String::from(open);
    let mut cursor = 0;
    let mut next = Some(index);
    while let Some(index) = next {
        result.push_str(&input[cursor..index]);
        result.push_str(replace);
        cursor = index + close.len();
        next = input[cursor..].find(close).map(|found| found + cursor);
    }
    result.push_str(&input[cursor..]);
    result.push_str(close);
    result
}

macro_rules! color {
    ($($name:ident: $open:literal, $close:literal $(, $replace:literal)?;)*) => {
        $(pub fn $name(input: &str) -> String {
            format(input, $open, $close, color!(@replace $open $(, $replace)?))
        })*
    };
    (@replace $open:literal) => { $open };
    (@replace $open:literal, $replace:literal) => { $replace };
}

color! {
    reset: "\x1b[0m", "\x1b[0m";
    bold: "\x1b[1m", "\x1b[22m", "\x1b[22m\x1b[1m";
    dim: "\x1b[2m", "\x1b[22m", "\x1b[22m\x1b[2m";
    inverse: "\x1b[7m", "\x1b[27m";
    hidden: "\x1b[8m", "\x1b[28m";
    strikethrough: "\x1b[9m", "\x1b[29m";
    red: "\x1b[31m", "\x1b[39m";
    green: "\x1b[32m", "\x1b[39m";
    yellow: "\x1b[33m", "\x1b[39m";
    blue: "\x1b[34m", "\x1b[39m";
    magenta: "\x1b[35m", "\x1b[39m";
    cyan: "\x1b[36m", "\x1b[39m";
    gray: "\x1b[90m", "\x1b[39m";
    bg_white: "\x1b[47m", "\x1b[49m";
}

/// `is-unicode-supported` on Unix: everything but the Linux console.
pub fn unicode() -> bool {
    static UNICODE: OnceLock<bool> = OnceLock::new();
    *UNICODE.get_or_init(|| std::env::var("TERM").as_deref() != Ok("linux"))
}

fn pick(unicode: &'static str, fallback: &'static str) -> &'static str {
    if self::unicode() { unicode } else { fallback }
}

macro_rules! symbols {
    ($($name:ident: $unicode:literal, $fallback:literal;)*) => {
        $(#[allow(non_snake_case)] pub fn $name() -> &'static str { pick($unicode, $fallback) })*
    };
}

symbols! {
    S_STEP_ACTIVE: "◆", "*";
    S_STEP_CANCEL: "■", "x";
    S_STEP_ERROR: "▲", "x";
    S_STEP_SUBMIT: "◇", "o";
    S_BAR_START: "┌", "T";
    S_BAR: "│", "|";
    S_BAR_END: "└", "—";
    S_RADIO_ACTIVE: "●", ">";
    S_RADIO_INACTIVE: "○", " ";
    S_CHECKBOX_ACTIVE: "◻", "[•]";
    S_CHECKBOX_SELECTED: "◼", "[+]";
    S_CHECKBOX_INACTIVE: "◻", "[ ]";
    S_PASSWORD_MASK: "▪", "•";
    S_BAR_H: "─", "-";
    S_CORNER_TOP_RIGHT: "╮", "+";
    S_CONNECT_LEFT: "├", "+";
    S_CORNER_BOTTOM_RIGHT: "╯", "+";
    S_INFO: "●", "•";
    S_SUCCESS: "◆", "*";
    S_WARN: "▲", "!";
    S_ERROR: "■", "x";
}

/// The step symbol for a prompt state (`symbol` in `common.ts`).
pub fn symbol(state: State) -> String {
    match state {
        State::Initial | State::Active => cyan(S_STEP_ACTIVE()),
        State::Cancel => red(S_STEP_CANCEL()),
        State::Error => yellow(S_STEP_ERROR()),
        State::Submit => green(S_STEP_SUBMIT()),
    }
}
