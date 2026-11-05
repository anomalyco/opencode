//! JavaScript semantics the TypeScript client relies on: `localeCompare` ordering and `Number` conversions.

use std::cmp::Ordering;

/// `a.localeCompare(b)` for the root locale, as Bun's ICU orders ASCII: punctuation and symbols
/// first in ICU's order, then digits, then letters without regard to case; ties go to lowercase
/// first, then to code points. Other characters sort after letters by code point.
pub fn locale_compare(a: &str, b: &str) -> Ordering {
    a.chars()
        .map(primary)
        .cmp(b.chars().map(primary))
        .then_with(|| a.chars().map(char::is_uppercase).cmp(b.chars().map(char::is_uppercase)))
        .then_with(|| a.cmp(b))
}

// ICU's root order of the ASCII punctuation and symbols, checked against Bun.
const SYMBOLS: &str = " _-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primary(c: char) -> (u8, u32) {
    if let Some(index) = SYMBOLS.find(c) {
        return (0, index as u32);
    }
    if c.is_ascii_digit() {
        return (1, c as u32);
    }
    if c.is_ascii_alphabetic() {
        return (2, c.to_ascii_lowercase() as u32);
    }
    (3, c as u32)
}

/// `Number.prototype.toString()`: shortest round-trip digits, with exponent notation outside
/// `[1e-6, 1e21)`.
pub fn number_to_string(value: f64) -> String {
    if value == 0.0 {
        return "0".to_owned();
    }
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity" } else { "-Infinity" }.to_owned();
    }
    if (1e-6..1e21).contains(&value.abs()) {
        return format!("{value}");
    }
    // Rust writes `1e21` and `1e-7`; JavaScript writes `1e+21` and `1e-7`.
    let text = format!("{value:e}");
    match text.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => format!("{mantissa}e+{exponent}"),
        _ => text,
    }
}

/// `Number(text)`, with NaN as `None`: surrounding whitespace is ignored, an empty text is 0, `0x`,
/// `0o` and `0b` prefixes read unsigned integers, and `Infinity` may carry a sign.
pub fn parse_number(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.is_empty() {
        return Some(0.0);
    }
    let radix = [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)]
        .iter()
        .find_map(|(prefix, radix)| text.strip_prefix(prefix).map(|digits| (digits, *radix)));
    if let Some((digits, radix)) = radix {
        if digits.is_empty() {
            return None;
        }
        return digits
            .chars()
            .try_fold(0.0, |value, c| c.to_digit(radix).map(|digit| value * f64::from(radix) + f64::from(digit)));
    }
    // Rust also reads `inf`, `infinity` in any case, and `nan`; JavaScript reads only `Infinity`.
    if text.strip_prefix(['+', '-']).unwrap_or(text) != "Infinity"
        && text.bytes().any(|byte| byte.is_ascii_alphabetic() && !matches!(byte, b'e' | b'E'))
    {
        return None;
    }
    text.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_compare_matches_bun() {
        // From `bun -e` with `toSorted((a, b) => a.localeCompare(b))`.
        let mut words = [
            "a-b",
            "a/b",
            "ab",
            "a.b",
            "A-b",
            "a_b",
            "aB",
            "Ab",
            "ab",
            "9",
            "10",
            "~",
            "openai/gpt-5",
            "openai-x/a",
            "OpenAI/b",
            "Alpha",
            "beta",
            "alpha",
        ];
        words.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(
            words,
            [
                "~",
                "10",
                "9",
                "a_b",
                "a-b",
                "A-b",
                "a.b",
                "a/b",
                "ab",
                "ab",
                "aB",
                "Ab",
                "alpha",
                "Alpha",
                "beta",
                "openai-x/a",
                "OpenAI/b",
                "openai/gpt-5",
            ]
        );
    }

    #[test]
    fn numbers_print_as_javascript_does() {
        let cases = [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (850.25, "850.25"),
            (1e20, "100000000000000000000"),
            (1e21, "1e+21"),
            (1.5e22, "1.5e+22"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
        ];
        for (value, text) in cases {
            assert_eq!(number_to_string(value), text, "{value}");
        }
    }

    #[test]
    fn numbers_parse_as_javascript_does() {
        let cases = [
            ("", Some(0.0)),
            ("  42 ", Some(42.0)),
            ("-1.5e3", Some(-1500.0)),
            (".5", Some(0.5)),
            ("0x1F", Some(31.0)),
            ("0o17", Some(15.0)),
            ("0B101", Some(5.0)),
            ("0x", None),
            ("0x+1", None),
            ("-0x10", None),
            ("Infinity", Some(f64::INFINITY)),
            ("-Infinity", Some(f64::NEG_INFINITY)),
            ("infinity", None),
            ("inf", None),
            ("NaN", None),
            ("12px", None),
            ("1_000", None),
        ];
        for (text, number) in cases {
            assert_eq!(parse_number(text), number, "{text:?}");
        }
    }
}
