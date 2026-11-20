//! JavaScript semantics the TypeScript client relies on: `localeCompare` ordering and `Number` conversions.

use std::cmp::Ordering;

use percent_encoding::{AsciiSet, NON_ALPHANUMERIC, utf8_percent_encode};

/// `encodeURIComponent`, for both path parameters and the location header.
pub fn encode_component(value: &str) -> String {
    const COMPONENT: &AsciiSet = &NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'!')
        .remove(b'~')
        .remove(b'*')
        .remove(b'\'')
        .remove(b'(')
        .remove(b')');
    utf8_percent_encode(value, COMPONENT).to_string()
}

/// `decodeURIComponent`, or `None` where it throws: a `%` without two hex digits, or bytes that are not UTF-8.
pub fn decode_component(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            out.push(bytes[index]);
            index += 1;
            continue;
        }
        // `from_str_radix` alone would take a sign: `%+5`.
        let hex = value.get(index + 1..index + 3).filter(|hex| hex.bytes().all(|byte| byte.is_ascii_hexdigit()))?;
        out.push(u8::from_str_radix(hex, 16).ok()?);
        index += 3;
    }
    String::from_utf8(out).ok()
}

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
    let sign = if value < 0.0 { "-" } else { "" };
    let (digits, n) = shortest(value.abs());
    let k = digits.len() as i32;
    let body = match n {
        _ if k <= n && n <= 21 => format!("{digits}{}", "0".repeat((n - k) as usize)),
        1..=21 => format!("{}.{}", &digits[..n as usize], &digits[n as usize..]),
        -5..=0 => format!("0.{}{digits}", "0".repeat(n.unsigned_abs() as usize)),
        _ => {
            let (first, rest) = digits.split_at(1);
            let point = if rest.is_empty() { "" } else { "." };
            format!("{first}{point}{rest}e{}{}", if n > 0 { "+" } else { "-" }, (n - 1).abs())
        }
    };
    format!("{sign}{body}")
}

/// The shortest digits that read back as `value`, and `n` with `value = 0.digits × 10^n`. Of two such digit strings
/// equally near `value`, ECMAScript takes the even one, where Rust's formatting takes the larger.
fn shortest(value: f64) -> (String, i32) {
    let text = format!("{value:e}");
    let (mantissa, exponent) = text.split_once('e').expect("an exponent");
    let mut digits = mantissa.replace('.', "");
    let n = exponent.parse::<i32>().expect("an exponent") + 1;
    let last = digits.as_bytes()[digits.len() - 1];
    // A tie needs a value one digit longer than its shortest digits, which only a value of about 16 digits has.
    if digits.len() >= 15 && last % 2 == 1 {
        let lower = format!("{}{}", &digits[..digits.len() - 1], char::from(last - 1));
        let exact = format!("{value:.800e}");
        let exact = exact.split_once('e').expect("an exponent").0.replace('.', "");
        let even = format!("{}.{}e{}", &lower[..1], &lower[1..], n - 1);
        if exact.trim_end_matches('0') == format!("{lower}5") && even.parse() == Ok(value) {
            digits = lower;
        }
    }
    (digits, n)
}

/// `Boolean(value)` for a JSON value. A JSON number is never `NaN`.
pub fn truthy(value: &serde_json::Value) -> bool {
    use serde_json::Value;
    match value {
        Value::Null | Value::Bool(false) => false,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

/// `String(value)` for a JSON value.
pub fn js_string(value: &serde_json::Value) -> String {
    use serde_json::Value;
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(value) => value.to_string(),
        Value::String(value) => value.clone(),
        Value::Number(number) => match (number.as_i64(), number.as_u64(), number.as_f64()) {
            (Some(value), _, _) => value.to_string(),
            (_, Some(value), _) => value.to_string(),
            (_, _, Some(value)) => number_to_string(value),
            _ => number.to_string(),
        },
        Value::Array(items) => items.iter().map(js_string).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".to_owned(),
    }
}

/// JavaScript's white space, as `\s` and `String.prototype.trim` see it: Unicode's, but U+0085, and the BOM.
pub fn is_whitespace(c: char) -> bool {
    (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}'
}

/// `Number(text)`, with NaN as `None`: surrounding whitespace is ignored, an empty text is 0, `0x`,
/// `0o` and `0b` prefixes read unsigned integers, and `Infinity` may carry a sign.
pub fn parse_number(text: &str) -> Option<f64> {
    let text = text.trim_matches(is_whitespace);
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

/// Why a URL with a non-ASCII host does not parse (deviation A10-ascii-hosts).
pub const ASCII_HOST: &str = "a host name must be ASCII; write an international name in its punycode (xn--) form";

/// Why a URL a user typed does not parse.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UrlError {
    /// The host is not ASCII after percent-decoding; the message names the input.
    NonAsciiHost(String),
    Invalid(url::ParseError),
}

impl std::fmt::Display for UrlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UrlError::NonAsciiHost(input) => write!(f, "{input}: {ASCII_HOST}"),
            UrlError::Invalid(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for UrlError {}

/// `new URL(input)` for a URL from outside the program: typed, read from a file or the environment,
/// or sent by a server or an ACP client. `url` is built without IDNA (deviation A10-ascii-hosts),
/// and its stub asserts on some non-ASCII hosts, so they are rejected here first. This module is
/// the only place allowed to call `url::Url::parse` (see `clippy.toml`).
#[allow(clippy::disallowed_methods)]
pub fn parse_url(input: &str) -> Result<url::Url, UrlError> {
    if special_host(&normalize(input)).is_some_and(|host| !decodes_to_ascii(&host)) {
        return Err(UrlError::NonAsciiHost(input.to_owned()));
    }
    url::Url::parse(input).map_err(UrlError::Invalid)
}

/// `new URL(input, base)`, checked as [`parse_url`] checks: `input` replaces the host when it has a
/// scheme or starts with two slashes.
#[allow(clippy::disallowed_methods)]
pub fn join_url(base: &url::Url, input: &str) -> Result<url::Url, UrlError> {
    let normalized = normalize(input);
    let scheme = normalized
        .split_once(':')
        .map(|(scheme, _)| scheme)
        .filter(|scheme| {
            scheme.starts_with(|c: char| c.is_ascii_alphabetic())
                && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        })
        .is_some();
    let authority = normalized.starts_with(['/', '\\']) && normalized[1..].starts_with(['/', '\\']);
    let absolute = match (scheme, authority) {
        (true, _) => normalized,
        (false, true) => format!("{}:{normalized}", base.scheme()),
        (false, false) => String::new(),
    };
    if special_host(&absolute).is_some_and(|host| !decodes_to_ascii(&host)) {
        return Err(UrlError::NonAsciiHost(input.to_owned()));
    }
    base.join(input).map_err(UrlError::Invalid)
}

/// `url.hostname = host`, checked as [`parse_url`] checks.
#[allow(clippy::disallowed_methods)]
pub fn set_host(url: &mut url::Url, host: Option<&str>) -> Result<(), UrlError> {
    if let Some(host) = host.filter(|host| !decodes_to_ascii(host)) {
        return Err(UrlError::NonAsciiHost(host.to_owned()));
    }
    url.set_host(host).map_err(UrlError::Invalid)
}

// Surrounding C0 controls and spaces trimmed, tabs and newlines dropped, as the WHATWG parser does.
fn normalize(input: &str) -> String {
    input.trim_matches(|c: char| c <= ' ').chars().filter(|c| !matches!(c, '\t' | '\n' | '\r')).collect()
}

// The host and port of a normalized URL whose scheme maps its host through IDNA, found as the
// WHATWG parser finds them, with `\` as `/`.
fn special_host(input: &str) -> Option<String> {
    let (scheme, rest) = input.split_once(':')?;
    let slash = |c: char| matches!(c, '/' | '\\');
    let rest = match scheme.to_ascii_lowercase().as_str() {
        "http" | "https" | "ws" | "wss" | "ftp" => rest.trim_start_matches(slash),
        "file" if rest.starts_with(slash) && rest[1..].starts_with(slash) => &rest[2..],
        _ => return None,
    };
    let authority = rest.split(|c: char| slash(c) || matches!(c, '?' | '#')).next().unwrap_or_default();
    Some(authority.rsplit('@').next().unwrap_or_default().to_owned())
}

fn decodes_to_ascii(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.iter().enumerate().all(|(index, byte)| {
        let encoded = (*byte == b'%')
            .then(|| bytes.get(index + 1..index + 3))
            .flatten()
            .and_then(|hex| std::str::from_utf8(hex).ok())
            .and_then(|hex| u8::from_str_radix(hex, 16).ok());
        byte.is_ascii() && encoded.is_none_or(|byte| byte.is_ascii())
    })
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
            (123e-20, "1.23e-18"),
            (-0.000_001_5, "-0.0000015"),
            // Exact ties between two shortest digit strings go to the even one; the sums are exact.
            (794_828_407_152_630.0 + 0.25, "794828407152630.2"),
            (862_745_139_194.0 + 0.156_25, "862745139194.1562"),
        ];
        for (value, text) in cases {
            assert_eq!(number_to_string(value), text, "{value}");
        }
    }

    #[test]
    fn components_decode_as_javascript_does() {
        for (text, decoded) in [
            ("a%20b%C3%bC", Some("a bü")),
            ("日本%41", Some("日本A")),
            ("%", None),
            ("%4", None),
            ("%+5", None),
            ("%é", None),
            ("%C3", None),
        ] {
            assert_eq!(decode_component(text).as_deref(), decoded, "{text:?}");
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
            ("\u{feff}7\u{2028}", Some(7.0)),
            ("\u{85}7", None),
        ];
        for (text, number) in cases {
            assert_eq!(parse_number(text), number, "{text:?}");
        }
    }

    #[test]
    fn parse_url_rejects_non_ascii_hosts_without_panicking() {
        let rejected = [
            "https://bücher.example",
            "https://Bücher.example",
            "https://%42%C3%BCcher.example",
            "HTTP:\\\\Bücher.example/x",
            "http:Bücher.example",
            " wss://user:pässword@Bücher.example:443/",
            "file://Bücher.example/share",
        ];
        for input in rejected {
            let error = parse_url(input).unwrap_err();
            assert_eq!(error, UrlError::NonAsciiHost(input.to_owned()), "{input:?}");
            assert_eq!(
                error.to_string(),
                format!("{input}: a host name must be ASCII; write an international name in its punycode (xn--) form")
            );
        }
        let parsed = [
            ("https://xn--bcher-kva.example", "https://xn--bcher-kva.example/"),
            ("https://Example.com/Bücher?q=ü#ü", "https://example.com/B%C3%BCcher?q=%C3%BC#%C3%BC"),
            ("https://ü@example.com", "https://%C3%BC@example.com/"),
            ("file:///Bücher/x", "file:///B%C3%BCcher/x"),
            ("mailto:ü@Bücher.example", "mailto:%C3%BC@B%C3%BCcher.example"),
        ];
        for (input, url) in parsed {
            assert_eq!(parse_url(input).map(String::from), Ok(url.to_owned()), "{input:?}");
        }
        assert_eq!(parse_url("bücher.example"), Err(UrlError::Invalid(url::ParseError::RelativeUrlWithoutBase)));
    }

    #[test]
    fn join_url_rejects_non_ascii_hosts_without_panicking() {
        let base = parse_url("https://example.com/a/b").unwrap();
        for input in
            ["https://Bücher.example", "//Bücher.example/x", " \\\\%42%C3%BCcher.example", "wss://Bücher.example"]
        {
            assert_eq!(join_url(&base, input), Err(UrlError::NonAsciiHost(input.to_owned())), "{input:?}");
        }
        let joined = [
            ("/auth/connect/Bücher", "https://example.com/auth/connect/B%C3%BCcher"),
            ("Bücher.example/x", "https://example.com/a/B%C3%BCcher.example/x"),
            ("//xn--bcher-kva.example/x", "https://xn--bcher-kva.example/x"),
            ("zed://Bücher.example", "zed://B%C3%BCcher.example"),
        ];
        for (input, url) in joined {
            assert_eq!(join_url(&base, input).map(String::from), Ok(url.to_owned()), "{input:?}");
        }
        let file = parse_url("file:///a/b").unwrap();
        assert_eq!(join_url(&file, "//Bücher.example/x"), Err(UrlError::NonAsciiHost("//Bücher.example/x".to_owned())));
        assert_eq!(join_url(&file, "/Bücher").map(String::from), Ok("file:///B%C3%BCcher".to_owned()));
        let mut url = base.clone();
        assert_eq!(
            set_host(&mut url, Some("Bücher.example")),
            Err(UrlError::NonAsciiHost("Bücher.example".to_owned()))
        );
        assert_eq!(
            set_host(&mut url, Some("LocalHost")).map(|()| url.to_string()),
            Ok("https://localhost/a/b".to_owned())
        );
    }
}
