//! JSON text to and from [`HostValue`]s, with no `serde_json::Value` in between: a run's input, delivered messages,
//! and posted ones.

use std::fmt;

use psychoscript::{HostError, HostString, HostValue};
use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};

/// JSON text read as a host value: numbers as `f64`, objects keeping their keys' order.
pub(crate) struct Input(pub(crate) HostValue);

impl Input {
    pub(crate) fn parse(text: &str) -> Result<HostValue, serde_json::Error> {
        serde_json::from_str::<Input>(text).map(|i| i.0)
    }
}

impl<'de> Deserialize<'de> for Input {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Input, D::Error> {
        d.deserialize_any(Json).map(Input)
    }
}

struct Json;

impl<'de> Visitor<'de> for Json {
    type Value = HostValue;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("JSON")
    }

    fn visit_unit<E>(self) -> Result<HostValue, E> {
        Ok(HostValue::Null)
    }

    fn visit_bool<E>(self, b: bool) -> Result<HostValue, E> {
        Ok(HostValue::Bool(b))
    }

    fn visit_i64<E>(self, n: i64) -> Result<HostValue, E> {
        Ok(HostValue::Number(n as f64))
    }

    fn visit_u64<E>(self, n: u64) -> Result<HostValue, E> {
        Ok(HostValue::Number(n as f64))
    }

    fn visit_f64<E>(self, n: f64) -> Result<HostValue, E> {
        Ok(HostValue::Number(n))
    }

    fn visit_str<E>(self, s: &str) -> Result<HostValue, E> {
        Ok(HostValue::String(s.into()))
    }

    fn visit_string<E>(self, s: String) -> Result<HostValue, E> {
        Ok(HostValue::String(s.into()))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<HostValue, A::Error> {
        let mut items = Vec::with_capacity(seq.size_hint().unwrap_or(0));
        while let Some(Input(item)) = seq.next_element()? {
            items.push(Some(item));
        }
        Ok(HostValue::Array(items))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<HostValue, A::Error> {
        let mut fields: Vec<(HostString, HostValue)> =
            Vec::with_capacity(map.size_hint().unwrap_or(0));
        // A repeated key stays repeated: the run sets it again, so its last value wins at its first
        // place, as with `JSON.parse`.
        while let Some((key, Input(value))) = map.next_entry::<String, Input>()? {
            fields.push((key.into(), value));
        }
        Ok(HostValue::Object(fields))
    }
}

/// A host call's argument as `JSON.stringify` writes it (`undefined` is left out of objects, `null` in arrays and at
/// the top; non-finite numbers are `null`), or `None` when it holds a function, which a host call's argument may not.
pub(crate) fn write_checked(value: &HostValue) -> Option<String> {
    let mut out = String::new();
    write_into(value, &mut out, &mut false).then_some(out)
}

/// A GPU batch's ops as [`write_checked`] writes them, and, when they hold non-finite numbers (which it writes as
/// `null`), those numbers by path from the ops, `[[path, "NaN" | "Infinity" | "-Infinity"], …]`: ops are read as JSON
/// reads them except that numbers stay as they are (widgets-gpu.md, Transport), so the client puts them back.
pub(crate) fn write_ops(value: &HostValue) -> Option<(String, Option<String>)> {
    let mut out = String::new();
    let mut seen = false;
    if !write_into(value, &mut out, &mut seen) {
        return None;
    }
    if !seen {
        return Some((out, None));
    }
    let mut list = String::from("[");
    non_finite(value, &mut Vec::new(), &mut list);
    list.push(']');
    Some((out, Some(list)))
}

/// A step on the way to a value inside ops: a list index or an object key.
enum Step<'a> {
    Index(usize),
    Key(&'a HostString),
}

/// Lists the non-finite numbers in `value`, at `path`, where [`write_into`] writes them.
fn non_finite<'a>(value: &'a HostValue, path: &mut Vec<Step<'a>>, list: &mut String) {
    match value {
        HostValue::Number(n) if !n.is_finite() => {
            if list.len() > 1 {
                list.push(',');
            }
            list.push_str("[[");
            for (i, step) in path.iter().enumerate() {
                if i > 0 {
                    list.push(',');
                }
                match step {
                    Step::Index(i) => list.push_str(&i.to_string()),
                    Step::Key(k) => string(&k.to_string_lossy(), list),
                }
            }
            list.push_str("],");
            list.push_str(if n.is_nan() {
                r#""NaN""#
            } else if *n > 0.0 {
                r#""Infinity""#
            } else {
                r#""-Infinity""#
            });
            list.push(']');
        }
        HostValue::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                if let Some(item) = item.as_ref().filter(|item| !skipped(item)) {
                    path.push(Step::Index(i));
                    non_finite(item, path, list);
                    path.pop();
                }
            }
        }
        HostValue::Object(fields) => {
            for (k, v) in fields.iter().filter(|(_, v)| !skipped(v)) {
                path.push(Step::Key(k));
                non_finite(v, path, list);
                path.pop();
            }
        }
        _ => {}
    }
}

fn is_function(v: &HostValue) -> bool {
    matches!(v, HostValue::Function(_) | HostValue::FunctionMarker)
}

/// What a host call throws for a function in its argument `n` (from 1), as the runtime does without `"mark"`
/// (widgets.md, "Native hosts"): its `TypeError`, located at the call, with the function's name as the program called
/// it.
pub(crate) fn carried(n: usize, name: &str) -> HostValue {
    HostError::located(
        "TypeError",
        format!("Argument {n} to {name} contains a function, which cannot be passed to the host."),
    )
}

/// Fails with [`carried`] for the first of `args`, from index `from`, that is or holds a function.
pub(crate) fn unmarked(args: &[HostValue], name: &str, from: usize) -> Result<(), HostValue> {
    match args.iter().skip(from).position(has_function) {
        Some(i) => Err(carried(from + i + 1, name)),
        None => Ok(()),
    }
}

fn has_function(v: &HostValue) -> bool {
    match v {
        HostValue::Function(_) | HostValue::FunctionMarker => true,
        HostValue::Array(items) => items.iter().flatten().any(has_function),
        HostValue::Object(fields) => fields.iter().any(|(_, v)| has_function(v)),
        HostValue::Map(entries) => entries
            .iter()
            .any(|(k, v)| has_function(k) || has_function(v)),
        HostValue::Set(items) => items.iter().any(has_function),
        _ => false,
    }
}

/// Writes `value`; false when it holds a function. `seen`: set when it writes a non-finite number (as `null`).
fn write_into(value: &HostValue, out: &mut String, seen: &mut bool) -> bool {
    match value {
        HostValue::Null => out.push_str("null"),
        HostValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        HostValue::Number(n) => {
            *seen |= !n.is_finite();
            number(*n, out)
        }
        HostValue::String(s) => string(&s.to_string_lossy(), out),
        HostValue::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                match item {
                    Some(item) if is_function(item) => return false,
                    Some(item) if !skipped(item) => {
                        if !write_into(item, out, seen) {
                            return false;
                        }
                    }
                    _ => out.push_str("null"),
                }
            }
            out.push(']');
        }
        HostValue::Object(fields) => {
            out.push('{');
            let mut first = true;
            for (k, v) in fields.iter() {
                if is_function(v) {
                    return false;
                }
                if skipped(v) {
                    continue;
                }
                if !first {
                    out.push(',');
                }
                first = false;
                string(&k.to_string_lossy(), out);
                out.push(':');
                if !write_into(v, out, seen) {
                    return false;
                }
            }
            out.push('}');
        }
        HostValue::Function(_) | HostValue::FunctionMarker => return false,
        HostValue::Map(_) | HostValue::Set(_) if has_function(value) => return false,
        other => match other.to_json() {
            Some(json) => out.push_str(&json.to_string()),
            None => out.push_str("null"),
        },
    }
    true
}

/// What `JSON.stringify` leaves out of an object, functions aside.
fn skipped(v: &HostValue) -> bool {
    matches!(
        v,
        HostValue::Undefined
            | HostValue::Durable(_)
            | HostValue::Namespace(_)
            | HostValue::Interrupt
    )
}

fn number(n: f64, out: &mut String) {
    use std::fmt::Write as _;
    if !n.is_finite() {
        out.push_str("null");
    } else if n.fract() == 0.0 && n.abs() < 9.0e15 {
        let _ = write!(out, "{}", n as i64);
    } else {
        out.push_str(
            &serde_json::Number::from_f64(n).map_or_else(|| "null".to_owned(), |n| n.to_string()),
        );
    }
}

fn string(s: &str, out: &mut String) {
    out.push_str(&serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_owned()));
}
