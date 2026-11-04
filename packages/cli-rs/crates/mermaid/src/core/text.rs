//! Text measurement and Mermaid line helpers (`core/text.ts`, `core/text-lines.ts`, `core/mermaid.ts`).

use std::sync::LazyLock;

use regex::Regex;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

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
    split_lines(value)
        .iter()
        .map(|line| width(line) + LABEL_PADDING_X * 2)
        .max()
        .unwrap_or(i32::MIN)
}

pub struct TextBox {
    pub width: i32,
    pub height: i32,
    pub lines: Vec<String>,
}

pub fn measure_text_box(
    value: &str,
    padding_x: i32,
    padding_y: i32,
    min_inner_width: i32,
) -> TextBox {
    let lines = split_lines(value);
    let inner = lines
        .iter()
        .map(|line| width(line))
        .max()
        .unwrap_or(0)
        .max(min_inner_width);
    TextBox {
        width: inner + padding_x * 2,
        height: lines.len() as i32 + padding_y * 2,
        lines,
    }
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

static BREAK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)<br\s*/?>").expect("break pattern"));
static ITALIC: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)</?(?:i|em)\s*>").expect("italic pattern"));

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
                    runs.push(TextRun {
                        text: source[offset..tag.start()].to_string(),
                        italic,
                    });
                }
                italic = !tag.as_str().starts_with("</");
                offset = tag.end();
            }
            if offset < source.len() {
                runs.push(TextRun {
                    text: source[offset..].to_string(),
                    italic,
                });
            }
            TextLine {
                text: runs.iter().map(|run| run.text.as_str()).collect(),
                runs,
            }
        })
        .collect()
}

pub fn split_lines(value: &str) -> Vec<String> {
    parse_lines(value)
        .into_iter()
        .map(|line| line.text)
        .collect()
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
        .map(|(index, line)| NumberedLine {
            number: index + 1,
            text: js_trim(line.strip_suffix('\r').unwrap_or(line)),
        })
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
    let quoted = (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''));
    if quoted {
        // TS `slice(1, -1)`: a lone quote leaves nothing.
        return decode(
            trimmed
                .get(1..trimmed.len().saturating_sub(1))
                .unwrap_or(""),
        );
    }
    decode(trimmed)
}

/// HTML character references (`entities.decodeHTMLStrict`).
pub fn decode(value: &str) -> String {
    html_escape::decode_html_entities(value).into_owned()
}
