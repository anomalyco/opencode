use std::sync::LazyLock;

use regex::Regex;
use unicode_segmentation::UnicodeSegmentation;

use super::entities::ENTITIES;

pub const LABEL_PADDING_X: i32 = 1;

/// The terminal width of `value` (TS `string-width`).
pub fn width(value: &str) -> i32 {
    if value.bytes().all(|byte| (0x20..0x7f).contains(&byte)) {
        return value.len() as i32;
    }
    value.graphemes(true).map(grapheme_width).sum()
}

/// A grapheme's width as `string-width` 7 counts it: none when it starts with a control, zero-width, combining or
/// variation character, or is one default-ignorable character; two when it starts with a wide character or holds an
/// emoji, a flag or a keycap; else one.
pub fn grapheme_width(grapheme: &str) -> i32 {
    let mut chars = grapheme.chars();
    let Some(first) = chars.next() else { return 0 };
    let rest = chars.as_str();
    if ignored(first) || (rest.is_empty() && default_ignorable(first)) {
        return 0;
    }
    // Hangul fillers are wide unless alone, when they are default-ignorable.
    let wide = super::wide::is_wide(first) || matches!(first, '\u{115f}' | '\u{3164}');
    let keycap =
        "#*0123456789".contains(first) && (rest.starts_with('\u{20e3}') || rest.starts_with("\u{fe0f}\u{20e3}"));
    if wide || keycap || rest.chars().any(emoji) || flag(grapheme) { 2 } else { 1 }
}

/// An emoji after the first character: `is_wide` without the East Asian wide letters and ideographs.
fn emoji(c: char) -> bool {
    let code = u32::from(c);
    super::wide::is_wide(c) && (code < 0x1100 || (0x2000..0x2e80).contains(&code) || (0x1f000..0x20000).contains(&code))
        || matches!(code, 0x3030 | 0x303d | 0x3297 | 0x3299)
}

/// The regional indicator pairs `emoji-regex` matches, by their letters.
const FLAGS: &str = "ACADAEAFAGAIALAMAOAQARASATAUAWAXAZBABBBDBEBFBGBHBIBJBLBMBNBOBQBRBSBTBVBWBYBZCACCCDCFCGCHCICKCLCMCNCOCPCQCRCUCVCWCXCYCZDEDGDJDKDMDODZEAECEEEGEHERESETEUFIFJFKFMFOFRGAGBGDGEGFGGGHGIGLGMGNGPGQGRGSGTGUGWGYHKHMHNHRHTHUICIDIEILIMINIOIQIRISITJEJMJOJPKEKGKHKIKMKNKPKRKWKYKZLALBLCLILKLRLSLTLULVLYMAMCMDMEMFMGMHMKMLMMMNMOMPMQMRMSMTMUMVMWMXMYMZNANCNENFNGNINLNONPNRNUNZOMPAPEPFPGPHPKPLPMPNPRPSPTPWPYQARERORSRURWSASBSCSDSESGSHSISJSKSLSMSNSOSRSSSTSVSXSYSZTATCTDTFTGTHTJTKTLTMTNTOTRTTTVTWTZUAUGUMUNUSUYUZVAVCVEVGVIVNVUWFWSXKYEYTZAZMZW";

fn flag(grapheme: &str) -> bool {
    let letter =
        |c: char| char::from_u32(u32::from(c).wrapping_sub(0x1f1e6) + u32::from(b'A')).filter(char::is_ascii_uppercase);
    let letters: Vec<Option<char>> = grapheme.chars().map(letter).collect();
    letters.windows(2).any(|pair| match pair {
        [Some(a), Some(b)] => FLAGS.as_bytes().chunks(2).any(|code| code == [*a as u8, *b as u8]),
        _ => false,
    })
}

fn ignored(c: char) -> bool {
    matches!(u32::from(c),
        0..=0x1f | 0x7f..=0x9f | 0x200b..=0x200f | 0xfeff | 0x300..=0x36f | 0x1ab0..=0x1aff | 0x1dc0..=0x1dff
        | 0x20d0..=0x20ff | 0xfe20..=0xfe2f | 0xfe00..=0xfe0f)
}

/// Unicode's `Default_Ignorable_Code_Point`.
fn default_ignorable(c: char) -> bool {
    matches!(u32::from(c),
        0xad | 0x34f | 0x61c | 0x115f..=0x1160 | 0x17b4..=0x17b5 | 0x180b..=0x180f | 0x200b..=0x200f
        | 0x202a..=0x202e | 0x2060..=0x206f | 0x3164 | 0xfe00..=0xfe0f | 0xfeff | 0xffa0 | 0xfff0..=0xfff8
        | 0x1bca0..=0x1bca3 | 0x1d173..=0x1d17a | 0xe0000..=0xe0fff)
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
    value.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
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

/// Accessibility directives describe the diagram but do not draw rows. A block ends on a line containing only `}`.
#[derive(Default)]
pub(crate) struct Accessibility {
    in_description: bool,
}

impl Accessibility {
    pub(crate) fn skip(&mut self, line: &str) -> bool {
        static DIRECTIVE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^acc(?:Title|Descr)(?::|\s|$)").unwrap());
        static BLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^accDescr\s*\{$").unwrap());
        if self.in_description {
            self.in_description = line != "}";
            return true;
        }
        self.in_description = BLOCK.is_match(line);
        self.in_description || DIRECTIVE.is_match(line)
    }
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
    use super::{decode, grapheme_width};

    /// Widths `string-width` 7 gives each grapheme.
    #[test]
    fn measures_graphemes_as_string_width() {
        for (grapheme, width) in [
            ("\u{0}", 0),
            ("\u{7}", 0),
            ("\u{85}", 0),
            ("\u{483}", 1),
            ("\u{600}", 1),
            ("\u{ad}", 0),
            ("\u{3164}", 0),
            ("\u{3164}\u{301}", 2),
            ("\u{d7b0}", 1),
            ("\u{e0067}", 0),
            ("\u{e0067}\u{301}", 1),
            ("\u{e31}", 1),
            ("\u{fe0f}\u{1f3fb}", 0),
            ("\u{1f1e9}", 1),
            ("\u{1f1e9}\u{1f1f0}", 2),
            ("\u{1f1f0}\u{1f1e9}", 1),
            ("#\u{20e3}", 2),
            ("#\u{fe0f}\u{20e3}", 2),
            ("1\u{fe0f}", 1),
            ("\u{a9}", 2),
            ("a\u{1f3fb}", 2),
            ("\u{600}\u{4e2d}", 1),
            ("\u{600}\u{1f600}", 2),
            ("\u{1f3f4}\u{e0067}\u{e0062}\u{e007f}", 2),
            ("\u{4e2d}", 2),
            ("e\u{301}", 1),
        ] {
            assert_eq!(grapheme_width(grapheme), width, "{:?}", grapheme.escape_unicode().to_string());
        }
    }

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
