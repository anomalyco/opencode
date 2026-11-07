//! Text measurement and Mermaid line helpers (`core/text.ts`, `core/text-lines.ts`, `core/mermaid.ts`).

use std::sync::LazyLock;

use regex::Regex;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

use super::entities::ENTITIES;

pub const LABEL_PADDING_X: i32 = 1;

/// The terminal width of `value` (TS `string-width`).
pub fn width(value: &str) -> i32 {
    if value.bytes().all(|byte| (0x20..0x7f).contains(&byte)) {
        return value.len() as i32;
    }
    value.graphemes(true).map(grapheme_width).sum()
}

/// A grapheme's width as `string-width` counts it: two for wide characters and emoji (by its first code point),
/// none for zero-width ones, else one.
pub fn grapheme_width(grapheme: &str) -> i32 {
    let Some(first) = grapheme.chars().next() else {
        return 0;
    };
    if super::wide::is_wide(first) {
        return 2;
    }
    i32::from(grapheme.width() > 0)
}

pub fn graphemes(value: &str) -> impl Iterator<Item = &str> {
    value.graphemes(true)
}

pub fn pad_label_line(value: &str) -> String {
    format!(" {value} ")
}

pub fn measure_label_width(value: &str) -> i32 {
    split_lines(value).iter().map(|line| width(line) + LABEL_PADDING_X * 2).max().unwrap_or(i32::MIN)
}

pub struct TextBox {
    pub width: i32,
    pub height: i32,
    pub lines: Vec<String>,
}

pub fn measure_text_box(value: &str, padding_x: i32, padding_y: i32, min_inner_width: i32) -> TextBox {
    let lines = split_lines(value);
    let inner = lines.iter().map(|line| width(line)).max().unwrap_or(0).max(min_inner_width);
    TextBox { width: inner + padding_x * 2, height: lines.len() as i32 + padding_y * 2, lines }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextRun {
    pub text: String,
    pub italic: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextLine {
    pub text: String,
    pub runs: Vec<TextRun>,
}

static BREAK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>").expect("break pattern"));
static ITALIC: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)</?(?:i|em)\s*>").expect("italic pattern"));

/// Splits `<br>` lines and `<i>`/`<em>` runs (`parseDiagramTextLines`).
pub fn parse_lines(value: &str) -> Vec<TextLine> {
    BREAK
        .split(value)
        .map(|line| {
            let source = js_trim(line);
            let mut runs = Vec::new();
            let mut italic = false;
            let mut offset = 0;
            for tag in ITALIC.find_iter(source) {
                if tag.start() > offset {
                    runs.push(TextRun { text: source[offset..tag.start()].to_string(), italic });
                }
                italic = !tag.as_str().starts_with("</");
                offset = tag.end();
            }
            if offset < source.len() {
                runs.push(TextRun { text: source[offset..].to_string(), italic });
            }
            TextLine { text: runs.iter().map(|run| run.text.as_str()).collect(), runs }
        })
        .collect()
}

pub fn split_lines(value: &str) -> Vec<String> {
    parse_lines(value).into_iter().map(|line| line.text).collect()
}

/// JavaScript's `String.prototype.trim`.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

pub struct NumberedLine<'a> {
    pub number: usize,
    pub text: &'a str,
}

/// Each line of `content`, trimmed, with its 1-based number (`numberedMermaidLines`).
pub fn numbered_lines(content: &str) -> impl Iterator<Item = NumberedLine<'_>> {
    content
        .split('\n')
        .enumerate()
        .map(|(index, line)| NumberedLine { number: index + 1, text: js_trim(line.strip_suffix('\r').unwrap_or(line)) })
}

/// The lines that are neither blank nor `%%` comments.
pub fn meaningful_lines(content: &str) -> impl Iterator<Item = NumberedLine<'_>> {
    numbered_lines(content).filter(|line| !line.text.is_empty() && !line.text.starts_with("%%"))
}

pub fn first_meaningful_line(content: &str) -> Option<&str> {
    meaningful_lines(content).next().map(|line| line.text)
}

pub fn strip_quotes(value: &str) -> String {
    let trimmed = js_trim(value);
    let quoted =
        (trimmed.starts_with('"') && trimmed.ends_with('"')) || (trimmed.starts_with('\'') && trimmed.ends_with('\''));
    if quoted {
        // TS `slice(1, -1)`: a lone quote leaves nothing.
        return decode(trimmed.get(1..trimmed.len().saturating_sub(1)).unwrap_or(""));
    }
    decode(trimmed)
}

/// HTML character references (`entities.decodeHTMLStrict`): `&name;`, `&#digits;` and `&#xhex;`, each with its
/// semicolon. Anything else stays as written.
pub fn decode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at + 1..];
        match reference(rest) {
            Some((decoded, length)) => {
                out.push_str(&decoded);
                rest = &rest[length..];
            }
            None => out.push('&'),
        }
    }
    out.push_str(rest);
    out
}

/// The reference at the start of `text` (just after `&`) and the bytes it takes, its `;` included.
fn reference(text: &str) -> Option<(String, usize)> {
    if let Some(number) = text.strip_prefix('#') {
        let (radix, digits, skip) = match number.strip_prefix(['x', 'X']) {
            Some(hex) => (16, hex, 2),
            None => (10, number, 1),
        };
        let length = digits.find(|char: char| !char.is_digit(radix)).unwrap_or(digits.len());
        if length == 0 || digits.as_bytes().get(length) != Some(&b';') {
            return None;
        }
        // Past the last code point the value only needs to stay out of range.
        let code = digits[..length]
            .chars()
            .fold(0u32, |code, digit| code.saturating_mul(radix).saturating_add(digit.to_digit(radix).unwrap()));
        return Some((code_point(code).to_string(), skip + length + 1));
    }
    let length = text.find(|char: char| !char.is_ascii_alphanumeric()).unwrap_or(text.len());
    if text.as_bytes().get(length) != Some(&b';') {
        return None;
    }
    let index = ENTITIES.binary_search_by(|(name, _)| name.cmp(&&text[..length])).ok()?;
    Some((ENTITIES[index].1.to_owned(), length + 1))
}

/// `replaceCodePoint`: surrogates and values past U+10FFFF become U+FFFD, and NUL and the C1 controls that
/// Windows-1252 assigns become what the HTML standard maps them to.
fn code_point(code: u32) -> char {
    let mapped = match code {
        0 => 0xfffd,
        0x80 => 0x20ac,
        0x82 => 0x201a,
        0x83 => 0x0192,
        0x84 => 0x201e,
        0x85 => 0x2026,
        0x86 => 0x2020,
        0x87 => 0x2021,
        0x88 => 0x02c6,
        0x89 => 0x2030,
        0x8a => 0x0160,
        0x8b => 0x2039,
        0x8c => 0x0152,
        0x8e => 0x017d,
        0x91 => 0x2018,
        0x92 => 0x2019,
        0x93 => 0x201c,
        0x94 => 0x201d,
        0x95 => 0x2022,
        0x96 => 0x2013,
        0x97 => 0x2014,
        0x98 => 0x02dc,
        0x99 => 0x2122,
        0x9a => 0x0161,
        0x9b => 0x203a,
        0x9c => 0x0153,
        0x9e => 0x017e,
        0x9f => 0x0178,
        _ => code,
    };
    char::from_u32(mapped).unwrap_or('\u{fffd}')
}

#[cfg(test)]
mod tests {
    use super::super::entities::{CASES, ENTITIES};
    use super::decode;

    #[test]
    fn decodes_every_entity_of_the_table() {
        assert!(ENTITIES.is_sorted_by(|a, b| a.0 < b.0));
        for (name, value) in ENTITIES {
            assert_eq!(decode(&format!("<&{name};>")), format!("<{value}>"), "{name}");
            assert_eq!(decode(&format!("&{name}")), format!("&{name}"), "{name}");
        }
    }

    #[test]
    fn decodes_as_decode_html_strict() {
        for (input, expected) in CASES {
            assert_eq!(decode(input), *expected, "{input:?}");
        }
    }
}
