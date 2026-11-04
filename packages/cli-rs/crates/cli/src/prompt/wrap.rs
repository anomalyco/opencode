//! `wrap-ansi` 8 in hard mode with its default trimming, which Clack applies to every frame, and the
//! `string-width` and `strip-ansi` it uses.

use std::sync::LazyLock;

use regex::Regex;
use unicode_width::UnicodeWidthChar;

static ANSI: LazyLock<Regex> = LazyLock::new(|| {
    // ansi-regex 6.
    Regex::new(concat!(
        r"[\x1b\x{9b}][\[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*",
        r"|[a-zA-Z\d]+(?:;[-a-zA-Z\d/#&.:=?%@~_]*)*)?\x07)",
        r"|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))",
    ))
    .expect("the ANSI pattern is valid")
});

static CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:\[(?P<code>\d+)m|\]8;;(?P<uri>.*)\x07)").expect("the SGR pattern is valid")
});

pub fn strip(text: &str) -> std::borrow::Cow<'_, str> {
    ANSI.replace_all(text, "")
}

/// Terminal columns of `text` without its escape sequences. Control characters take none.
pub fn width(text: &str) -> usize {
    strip(text)
        .chars()
        .map(|char| char.width().unwrap_or(0))
        .sum()
}

/// Wraps every line of `text` to `columns` (unbounded when stdout is not a terminal), trimming
/// whitespace at both ends of each row as `wrap-ansi` does by default.
pub fn wrap(text: &str, columns: Option<usize>) -> String {
    let columns = columns.unwrap_or(usize::MAX);
    text.replace("\r\n", "\n")
        .split('\n')
        .map(|line| exec(line, columns))
        .collect::<Vec<_>>()
        .join("\n")
}

fn exec(line: &str, columns: usize) -> String {
    if line.trim().is_empty() {
        return String::new();
    }
    let mut rows = vec![String::new()];
    for (index, word) in line.split(' ').enumerate() {
        let last = rows.last_mut().expect("rows is never empty");
        *last = last.trim_start().to_string();
        let mut length = width(last);
        if index != 0 && length > 0 {
            last.push(' ');
            length += 1;
        }
        let size = width(word);
        if size > columns {
            // Hard mode: a word longer than a row starts on its own row when that saves a break.
            let (size, columns, length) = (size as i64, columns as i64, length as i64);
            let here = 1 + (size - (columns - length) - 1).div_euclid(columns);
            let next = (size - 1).div_euclid(columns);
            if next < here {
                rows.push(String::new());
            }
            wrap_word(&mut rows, word, columns as usize);
            continue;
        }
        if length + size > columns && length > 0 && size > 0 {
            rows.push(String::new());
        }
        rows.last_mut().expect("rows is never empty").push_str(word);
    }
    let pre: Vec<char> = rows
        .iter()
        .map(|row| trim_end(row))
        .collect::<Vec<_>>()
        .join("\n")
        .chars()
        .collect();
    reopen_codes(&pre)
}

fn wrap_word(rows: &mut Vec<String>, word: &str, columns: usize) {
    let chars: Vec<char> = word.chars().collect();
    let mut escape = false;
    let mut link = false;
    let mut visible = width(rows.last().expect("rows is never empty"));
    for (index, &char) in chars.iter().enumerate() {
        let size = char.width().unwrap_or(0);
        if visible + size <= columns {
            rows.last_mut().expect("rows is never empty").push(char);
        } else {
            rows.push(char.to_string());
            visible = 0;
        }
        if char == '\x1b' || char == '\u{9b}' {
            escape = true;
            link = chars[index + 1..]
                .iter()
                .collect::<String>()
                .starts_with("]8;;");
        }
        if escape {
            if link {
                if char == '\x07' {
                    escape = false;
                    link = false;
                }
            } else if char == 'm' {
                escape = false;
            }
            continue;
        }
        visible += size;
        if visible == columns && index < chars.len() - 1 {
            rows.push(String::new());
            visible = 0;
        }
    }
    if visible == 0 && rows.len() > 1 && !rows.last().expect("rows is never empty").is_empty() {
        let last = rows.pop().expect("rows has two rows");
        rows.last_mut().expect("rows has one row").push_str(&last);
    }
}

/// `stringVisibleTrimSpacesRight`: drops trailing spaces but keeps trailing escape sequences.
fn trim_end(row: &str) -> String {
    let words: Vec<&str> = row.split(' ').collect();
    let last = words
        .iter()
        .rposition(|word| width(word) > 0)
        .map_or(0, |index| index + 1);
    if last == words.len() {
        return row.to_string();
    }
    words[..last].join(" ") + &words[last..].concat()
}

/// Closes the open color or link before each row break and reopens it after, as `wrap-ansi` does.
fn reopen_codes(pre: &[char]) -> String {
    let mut result = String::new();
    let mut code: Option<u32> = None;
    let mut url: Option<String> = None;
    for (index, &char) in pre.iter().enumerate() {
        result.push(char);
        if char == '\x1b' || char == '\u{9b}' {
            let rest: String = pre[index..].iter().collect();
            if let Some(found) = CODE.captures(&rest) {
                if let Some(value) = found.name("code") {
                    code = value.as_str().parse().ok().filter(|value| *value != 39);
                } else if let Some(value) = found.name("uri") {
                    url = Some(value.as_str().to_string()).filter(|value| !value.is_empty());
                }
            }
        }
        let close = code.and_then(close_code);
        if pre.get(index + 1) == Some(&'\n') {
            if url.is_some() {
                result.push_str("\x1b]8;;\x07");
            }
            if let Some(close) = close {
                result.push_str(&format!("\x1b[{close}m"));
            }
        } else if char == '\n' {
            if let (Some(code), Some(_)) = (code, close) {
                result.push_str(&format!("\x1b[{code}m"));
            }
            if let Some(url) = &url {
                result.push_str(&format!("\x1b]8;;{url}\x07"));
            }
        }
    }
    result
}

/// `ansi-styles` `codes`: the close code of an open code.
fn close_code(code: u32) -> Option<u32> {
    match code {
        0 => Some(0),
        1 | 2 => Some(22),
        3 => Some(23),
        4 => Some(24),
        7 => Some(27),
        8 => Some(28),
        9 => Some(29),
        53 => Some(55),
        30..=37 | 90..=97 => Some(39),
        40..=47 | 100..=107 => Some(49),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_and_wraps_like_wrap_ansi() {
        // Expected values from `wrap-ansi` 8.1 (`wrap(text, columns, { hard: true })`).
        let cases: &[(&str, Option<usize>, &str)] = &[
            ("│  ", None, "│"),
            ("   leading", None, "leading"),
            ("   ", None, ""),
            ("a b  ", Some(80), "a b"),
            ("hello world", Some(5), "hello\nworld"),
            ("abcdefghij", Some(4), "abcd\nefgh\nij"),
            ("ab cdefghij", Some(4), "ab\ncdef\nghij"),
            ("\x1b[36m│\x1b[39m  ", None, "\x1b[36m│\x1b[39m"),
            (
                "\x1b[2mabcdef\x1b[22m",
                Some(3),
                "\x1b[2mabc\x1b[22m\n\x1b[2mdef\x1b[22m",
            ),
            ("one\n  two", None, "one\ntwo"),
        ];
        for (text, columns, expected) in cases {
            assert_eq!(wrap(text, *columns), *expected, "{text:?} at {columns:?}");
        }
    }

    #[test]
    fn measures_without_escapes() {
        assert_eq!(width("\x1b[32m◇\x1b[39m  ok"), 5);
        assert_eq!(width("日本"), 4);
        assert_eq!(strip("\x1b[?25l\x1b[2Kx"), "x");
    }
}
