//! Serde helpers the generated types use.

use std::borrow::Cow;
use std::fmt;

use serde::de::{DeserializeOwned, Error, MapAccess, Unexpected, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// What an empty struct schema accepts: any JSON value but `null`, kept as it arrived. It defaults to `{}`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(transparent)]
pub struct NotNull(pub Value);

impl Default for NotNull {
    fn default() -> Self {
        Self(Value::Object(serde_json::Map::new()))
    }
}

impl<'de> Deserialize<'de> for NotNull {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        match Value::deserialize(deserializer)? {
            Value::Null => Err(D::Error::invalid_type(Unexpected::Unit, &"any value but null")),
            value => Ok(Self(value)),
        }
    }
}

/// The JSON text with each lone UTF-16 surrogate escape (`\ud83d` without its pair) written as `\ufffd`, or `None` when
/// it has none. `JSON.parse` keeps a lone surrogate, which `JSON.stringify` writes for a string cut inside a pair;
/// serde_json rejects it, and a Rust string cannot hold one. For a second parse after a failed first one.
pub fn well_formed(text: &[u8]) -> Option<Vec<u8>> {
    let escape = |at: usize| -> Option<u16> {
        let digits = text.get(at..at + 6)?.strip_prefix(b"\\u")?;
        u16::from_str_radix(std::str::from_utf8(digits).ok()?, 16).ok()
    };
    let (mut out, mut copied, mut at) = (None::<Vec<u8>>, 0, 0);
    while let Some(offset) = text.get(at..).and_then(|rest| rest.iter().position(|byte| *byte == b'\\')) {
        at += offset;
        let Some(unit) = escape(at) else {
            at += 2;
            continue;
        };
        let pair =
            (0xd800..0xdc00).contains(&unit) && escape(at + 6).is_some_and(|low| (0xdc00..0xe000).contains(&low));
        if pair || !(0xd800..0xe000).contains(&unit) {
            at += if pair { 12 } else { 6 };
            continue;
        }
        let out = out.get_or_insert_with(Vec::new);
        out.extend_from_slice(&text[copied..at]);
        out.extend_from_slice(b"\\ufffd");
        at += 6;
        copied = at;
    }
    out.map(|mut out| {
        out.extend_from_slice(&text[copied..]);
        out
    })
}

/// For an optional and nullable field: absent is `None` (through `#[serde(default)]`), `null` is
/// `Some(None)`, and a value is `Some(Some(value))`.
pub fn double_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Reads a union member's tag without keeping it: any string, as the `String` it replaces accepted.
pub fn tag<'de, D: Deserializer<'de>>(deserializer: D) -> Result<(), D::Error> {
    struct TagVisitor;
    impl Visitor<'_> for TagVisitor {
        type Value = ();
        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string")
        }
        fn visit_str<E: Error>(self, _: &str) -> Result<(), E> {
            Ok(())
        }
    }
    deserializer.deserialize_str(TagVisitor)
}

/// The name serde_json's `RawValue` asks for. serde_json then hands over the value's text instead of
/// parsing it; any other deserializer gives the value itself.
const RAW_TOKEN: &str = "$serde_json::private::RawValue";

/// A union's JSON before its member is known: the text, borrowed when the input allows, from serde_json
/// (and from a `Value`, which serde_json prints), or else the value itself (a buffered `#[serde(flatten)]`).
pub enum Raw<'de> {
    Text(Cow<'de, str>),
    Value(Value),
}

/// A field of a union's object, as far as a tag needs it.
#[derive(Debug, PartialEq)]
pub enum Field<'a> {
    Absent,
    Str(Cow<'a, str>),
    Bool(bool),
    Other,
}

impl Field<'_> {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::Str(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Self::Bool(value) => Some(*value),
            _ => None,
        }
    }
}

impl Raw<'_> {
    /// The field `key` of an object, read up to that field only. A value that is not an object has no
    /// fields. Unlike `Value::get`, a repeated key gives its first value; JSON from the server has none.
    pub fn field(&self, key: &str) -> Field<'_> {
        match self {
            Self::Text(text) => scan_field(text, key),
            Self::Value(value) => match value.get(key) {
                None => Field::Absent,
                Some(Value::String(value)) => Field::Str(Cow::Borrowed(value)),
                Some(Value::Bool(value)) => Field::Bool(*value),
                Some(_) => Field::Other,
            },
        }
    }

    /// Decodes the value as `T`, for trying the members of an untagged union in turn.
    pub fn decode<T: DeserializeOwned>(&self) -> Result<T, serde_json::Error> {
        match self {
            Self::Text(text) => serde_json::from_str(text),
            Self::Value(value) => T::deserialize(value),
        }
    }

    /// Decodes the member of a tagged union once its tag is known.
    pub fn variant<T: DeserializeOwned, E: Error>(&self) -> Result<T, E> {
        self.decode().map_err(custom)
    }

    /// The value of a member this client does not know, kept as it arrived.
    pub fn unknown<E: Error>(&self) -> Result<Value, E> {
        match self {
            Self::Text(text) => serde_json::from_str(text).map_err(custom),
            Self::Value(value) => Ok(value.clone()),
        }
    }
}

/// Decodes a union through its `from_raw`, which is not generic over the deserializer: so the members' decoders are
/// built once, in this crate, rather than again in every crate and for every deserializer that decodes the union.
pub fn union<'de, T, D: Deserializer<'de>>(
    deserializer: D,
    from_raw: fn(&Raw) -> Result<T, serde_json::Error>,
) -> Result<T, D::Error> {
    from_raw(&Raw::deserialize(deserializer)?).map_err(D::Error::custom)
}

/// The inner error's text without the position inside the member, so that the outer deserializer
/// reports the error at the member, as it did when members decoded from a `Value`.
fn custom<E: Error>(error: serde_json::Error) -> E {
    let text = error.to_string();
    let position = format!(" at line {} column {}", error.line(), error.column());
    E::custom(text.strip_suffix(&position).unwrap_or(&text))
}

impl<'de: 'a, 'a> Deserialize<'de> for Raw<'a> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_newtype_struct(RAW_TOKEN, RawVisitor(std::marker::PhantomData))
    }
}

struct RawVisitor<'a>(std::marker::PhantomData<&'a ()>);

impl<'de: 'a, 'a> Visitor<'de> for RawVisitor<'a> {
    type Value = Raw<'a>;

    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("any valid JSON value")
    }

    fn visit_newtype_struct<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        Value::deserialize(deserializer).map(Raw::Value)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        // serde_json hands the text over as a map of one entry keyed by the token.
        let Some(first) = map.next_key::<Key>()? else { return Ok(Raw::Value(Value::Object(serde_json::Map::new()))) };
        let first = match first {
            Key::Token => return map.next_value::<Str>().map(|text| Raw::Text(text.0)),
            Key::Other(key) => key,
        };
        let mut object = serde_json::Map::new();
        object.insert(first, map.next_value()?);
        while let Some((key, value)) = map.next_entry()? {
            object.insert(key, value);
        }
        Ok(Raw::Value(Value::Object(object)))
    }
}

enum Key {
    Token,
    Other(String),
}

impl<'de> Deserialize<'de> for Key {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct KeyVisitor;
        impl Visitor<'_> for KeyVisitor {
            type Value = Key;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a string key")
            }
            fn visit_str<E: Error>(self, value: &str) -> Result<Key, E> {
                Ok(if value == RAW_TOKEN { Key::Token } else { Key::Other(value.to_owned()) })
            }
        }
        deserializer.deserialize_str(KeyVisitor)
    }
}

/// A string borrowed from the JSON when it has no escape, as the generated views of streamed events decode one. It
/// accepts what a `String` accepts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Str<'a>(pub Cow<'a, str>);

impl Str<'_> {
    /// Whether it borrows from the JSON, having had no escape to decode.
    pub fn borrowed(&self) -> bool {
        matches!(self.0, Cow::Borrowed(_))
    }
}

impl std::ops::Deref for Str<'_> {
    type Target = str;

    fn deref(&self) -> &str {
        &self.0
    }
}

impl<'de: 'a, 'a> Deserialize<'de> for Str<'a> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct StrVisitor;
        impl<'de> Visitor<'de> for StrVisitor {
            type Value = Str<'de>;
            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a string")
            }
            fn visit_borrowed_str<E: Error>(self, value: &'de str) -> Result<Str<'de>, E> {
                Ok(Str(Cow::Borrowed(value)))
            }
            fn visit_str<E: Error>(self, value: &str) -> Result<Str<'de>, E> {
                Ok(Str(Cow::Owned(value.to_owned())))
            }
            fn visit_string<E: Error>(self, value: String) -> Result<Str<'de>, E> {
                Ok(Str(Cow::Owned(value)))
            }
        }
        deserializer.deserialize_str(StrVisitor)
    }
}

/// `Raw::field`, read from the text up to that field. On text that is not valid JSON it may find nothing or the wrong
/// field, but it never reads past the end, so it can read the tag of text nothing has checked yet. A string with an
/// escape is decoded by serde_json.
fn scan_field<'a>(text: &'a str, key: &str) -> Field<'a> {
    scan(text, key).unwrap_or(Field::Absent)
}

fn scan<'a>(text: &'a str, key: &str) -> Option<Field<'a>> {
    let bytes = text.as_bytes();
    let mut at = skip_space(bytes, 0);
    if bytes.get(at) != Some(&b'{') {
        return None;
    }
    at += 1;
    loop {
        at = skip_space(bytes, at);
        if bytes.get(at) != Some(&b'"') {
            return None;
        }
        let end = string_end(bytes, at)?;
        let matches = string(text, at, end) == key;
        at = skip_space(bytes, end.0) + 1;
        at = skip_space(bytes, at);
        if matches {
            return Some(match *bytes.get(at)? {
                b'"' => Field::Str(string(text, at, string_end(bytes, at)?)),
                b't' => Field::Bool(true),
                b'f' => Field::Bool(false),
                _ => Field::Other,
            });
        }
        at = skip_space(bytes, value_end(bytes, at)?);
        if bytes.get(at) != Some(&b',') {
            return None;
        }
        at += 1;
    }
}

fn skip_space(bytes: &[u8], mut at: usize) -> usize {
    while bytes.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    at
}

/// The index after the closing quote of the string that opens at `start`, and whether the string has an escape.
fn string_end(bytes: &[u8], start: usize) -> Option<(usize, bool)> {
    let (mut at, mut escaped) = (start + 1, false);
    loop {
        match *bytes.get(at)? {
            b'"' => return Some((at + 1, escaped)),
            b'\\' => {
                escaped = true;
                at += 2;
            }
            _ => at += 1,
        }
    }
}

/// The string that opens at `start` and that [`string_end`] ended, decoded by serde_json only when it has an escape.
fn string(text: &str, start: usize, (end, escaped): (usize, bool)) -> Cow<'_, str> {
    if !escaped {
        return Cow::Borrowed(&text[start + 1..end - 1]);
    }
    Cow::Owned(serde_json::from_str(&text[start..end]).unwrap_or_default())
}

/// The index after the value that starts at `start`.
fn value_end(bytes: &[u8], start: usize) -> Option<usize> {
    match *bytes.get(start)? {
        b'"' => string_end(bytes, start).map(|(end, _)| end),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut at = start;
            loop {
                match *bytes.get(at)? {
                    b'"' => {
                        at = string_end(bytes, at)?.0;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(at + 1);
                        }
                    }
                    _ => {}
                }
                at += 1;
            }
        }
        _ => {
            let mut at = start;
            while !matches!(bytes.get(at), None | Some(b',' | b'}' | b']')) && !bytes[at].is_ascii_whitespace() {
                at += 1;
            }
            Some(at)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_match_value_get() {
        let cases = [
            r#"{"type":"a","b":[1,{"type":"no"}]}"#,
            r#"{"b":{"type":"no"},"type":"a\"b"}"#,
            r#"{ "a" : [1, "x]}", {"b": "}"}] , "type" : "a" }"#,
            r#"{"t\u0079pe":"x"}"#,
            r#"{"a":"\\","type":"x"}"#,
            r#"{"a":-1.5e3,"b":null,"c":true,"type":false}"#,
            "{\n\t\"type\"\r\n:\n\"a\"\n}",
            r#"{"type":true}"#,
            r#"{"type":7}"#,
            r#"{"type":null}"#,
            r#"{"type":{"x":1}}"#,
            r#"{}"#,
            r#"{"a":{"type":"x"},"b":[],"c":1}"#,
            r#""type""#,
            r#"[{"type":"a"}]"#,
        ];
        for json in cases {
            let value: Value = serde_json::from_str(json).unwrap();
            let text = Raw::Text(Cow::Borrowed(json));
            let parsed = Raw::Value(value.clone());
            assert_eq!(text.field("type"), parsed.field("type"), "{json}");
            assert_eq!(text.field("type").as_str(), value.get("type").and_then(Value::as_str), "{json}");
            assert_eq!(text.field("type").as_bool(), value.get("type").and_then(Value::as_bool), "{json}");
            assert_eq!(text.unknown::<serde_json::Error>().unwrap(), value, "{json}");
        }
    }

    #[test]
    fn a_tag_reads_from_text_nothing_checked() {
        let json = r#"{ "a" : [1, "x]}\"", {"b": "}"}], "c":{"d":"\\"}, "type" : "a\"b" }"#;
        for end in 0..=json.len() {
            let _ = Raw::Text(Cow::Borrowed(&json[..end])).field("type");
        }
        assert_eq!(Raw::Text(Cow::Borrowed(json)).field("type").as_str(), Some("a\"b"));
    }

    #[test]
    fn a_member_error_is_reported_at_the_member() {
        use crate::types::SessionMessageCompaction;
        let json = r#"[{"status":"running","type":7}]"#;
        let error = serde_json::from_str::<Vec<SessionMessageCompaction>>(json).unwrap_err();
        assert_eq!(error.to_string(), "invalid type: integer `7`, expected a string at line 1 column 31");
    }

    #[test]
    fn a_buffered_value_decodes_without_text() {
        #[derive(Deserialize)]
        struct Outer<'a> {
            #[serde(flatten, borrow)]
            buffered: Inner<'a>,
        }
        #[derive(Deserialize)]
        struct Inner<'a> {
            #[serde(borrow)]
            inner: Raw<'a>,
        }
        let outer: Outer = serde_json::from_str(r#"{"inner":{"type":"a"},"z":1}"#).unwrap();
        assert!(matches!(outer.buffered.inner, Raw::Value(_)));
        assert_eq!(outer.buffered.inner.field("type").as_str(), Some("a"));
    }
}
