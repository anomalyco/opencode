//! A host value as JSON text, for the generic data that stays JSON in the binary format (`state`, `submit`, `send`):
//! the same writer as psychoscript-mobile's for posts.

use psychoscript::HostValue;

/// A host value as `JSON.stringify` writes it: `undefined` and functions are left out of objects, `null` in arrays and
/// at the top; non-finite numbers are `null`.
pub(crate) fn write(value: &HostValue) -> String {
    let mut out = String::new();
    write_into(value, &mut out);
    out
}

fn write_into(value: &HostValue, out: &mut String) {
    match value {
        HostValue::Null => out.push_str("null"),
        HostValue::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        HostValue::Number(n) => number(*n, out),
        HostValue::String(s) => string(&s.to_string_lossy(), out),
        HostValue::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                match item {
                    Some(item) if !skipped(item) => write_into(item, out),
                    _ => out.push_str("null"),
                }
            }
            out.push(']');
        }
        HostValue::Object(fields) => {
            out.push('{');
            let mut first = true;
            for (k, v) in fields.iter().filter(|(_, v)| !skipped(v)) {
                if !first {
                    out.push(',');
                }
                first = false;
                string(&k.to_string_lossy(), out);
                out.push(':');
                write_into(v, out);
            }
            out.push('}');
        }
        other => match other.to_json() {
            Some(json) => out.push_str(&json.to_string()),
            None => out.push_str("null"),
        },
    }
}

/// What `JSON.stringify` leaves out of an object.
pub(crate) fn skipped(v: &HostValue) -> bool {
    matches!(
        v,
        HostValue::Undefined
            | HostValue::Function(_)
            | HostValue::Durable(_)
            | HostValue::Namespace(_)
            | HostValue::FunctionMarker
            | HostValue::Interrupt
    )
}

/// As `JSON.stringify` writes a number: `Number::toString` (`1e+21`, `18446744073709552000`), `null` if not finite.
fn number(n: f64, out: &mut String) {
    use std::fmt::Write as _;
    if !n.is_finite() {
        out.push_str("null");
    } else if n.fract() == 0.0 && n.abs() < 9.0e15 {
        let _ = write!(out, "{}", n as i64);
    } else {
        out.push_str(&crate::native::js_number(n));
    }
}

fn string(s: &str, out: &mut String) {
    out.push_str(&serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_owned()));
}
