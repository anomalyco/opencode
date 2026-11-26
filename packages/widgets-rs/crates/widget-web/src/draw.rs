//! A draw's commands checked (widgets.md, Canvas, "Draw command checks"), the same in every host: from the values as
//! they crossed to the normalised commands clients get, as JSON, or the exact failure (a program error in phase
//! `draw`). Shared cases: `packages/widget/test/fixtures/draw.json`.

use std::fmt::Write as _;

use psychoscript::HostValue;

/// The most commands a draw may have (widgets-live.md, "Lifecycle and budgets").
pub(crate) const MAX_COMMANDS: usize = 2000;

const TOKENS: [&str; 9] = [
    "text", "muted", "accent", "bg", "surface", "border", "success", "warning", "error",
];

type Item = Option<HostValue>;
type Checked = Result<(), String>;

/// A draw step's commands: read as JSON reads them first (functions and `undefined` fields left out, `undefined` and
/// function items and non-finite numbers `null`), then checked.
pub(crate) fn check_read(commands: &HostValue) -> Result<String, String> {
    check(&json(commands))
}

/// A draw's commands, as they crossed: the normalised commands as JSON, or the failure's message.
pub(crate) fn check(commands: &HostValue) -> Result<String, String> {
    let HostValue::Array(list) = commands else {
        return Err("draw commands must be a list".into());
    };
    if list.len() > MAX_COMMANDS {
        return Err(format!(
            "{} draw commands is over the budget of {MAX_COMMANDS} per frame",
            list.len()
        ));
    }
    let mut out = String::with_capacity(list.len() * 24 + 2);
    out.push('[');
    for (i, c) in list.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        command(c.as_ref(), &mut out).map_err(|e| format!("draw command {i}: {e}"))?;
    }
    out.push(']');
    Ok(out)
}

/// `v` as JSON reads it.
fn json(v: &HostValue) -> HostValue {
    match v {
        HostValue::Number(n) if !n.is_finite() => HostValue::Null,
        HostValue::Array(items) => HostValue::Array(
            items
                .iter()
                .map(|i| match i {
                    None
                    | Some(
                        HostValue::Undefined | HostValue::FunctionMarker | HostValue::Function(_),
                    ) => Some(HostValue::Null),
                    Some(i) => Some(json(i)),
                })
                .collect(),
        ),
        HostValue::Object(fields) => HostValue::Object(
            fields
                .iter()
                .filter(|(_, v)| {
                    !matches!(
                        v,
                        HostValue::Undefined | HostValue::FunctionMarker | HostValue::Function(_)
                    )
                })
                .map(|(k, v)| (k.clone(), json(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

/// An object's field: `None` when absent or `undefined`; `null` is a value.
fn field<'a>(v: &'a HostValue, name: &str) -> Option<&'a HostValue> {
    v.get(name).filter(|v| !matches!(v, HostValue::Undefined))
}

fn number(n: f64, out: &mut String) {
    out.push_str(ryu_js::Buffer::new().format_finite(n));
}

fn string(s: &str, out: &mut String) {
    let _ = write!(out, "{}", serde_json::Value::from(s));
}

fn finite(v: Option<&HostValue>, what: &str) -> Result<f64, String> {
    match v {
        Some(HostValue::Number(n)) if n.is_finite() => Ok(*n),
        _ => Err(format!("{what} must be a finite number")),
    }
}

fn color(v: Option<&HostValue>, out: &mut String) -> Checked {
    if let Some(HostValue::String(s)) = v
        && let Some(s) = s.as_str()
        && match s.strip_prefix('#') {
            None => TOKENS.contains(&s),
            Some(hex) => {
                matches!(hex.len(), 3 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit())
            }
        }
    {
        string(s, out);
        return Ok(());
    }
    Err("not a color".into())
}

fn command(v: Option<&HostValue>, out: &mut String) -> Checked {
    let Some(HostValue::Array(a)) = v else {
        return Err("a command is an array".into());
    };
    let Some(Some(HostValue::String(op))) = a.first() else {
        return Err("a command starts with its name".into());
    };
    let op = op.to_string_lossy();
    let op = &*op;
    // The arguments a command takes after its name, and how many of them may be left off.
    let (count, optional) = match op {
        "save" | "restore" => (0, 0),
        "rotate" | "alpha" => (1, 0),
        "translate" | "scale" | "path" => (2, 0),
        "circle" => (4, 0),
        "rect" | "line" | "image" => (5, 0),
        "rrect" => (6, 0),
        "text" => (4, 1),
        _ => return Err(format!("unknown draw command \"{op}\"")),
    };
    if a.len() > count + 1 {
        return Err(format!("\"{op}\" has more than {count} arguments"));
    }
    if a.len() < count + 1 - optional {
        return Err(format!("\"{op}\" is missing argument {}", a.len()));
    }
    let at = |i: usize| a.get(i).and_then(Item::as_ref);
    let n = |i: usize| finite(at(i), &format!("\"{op}\" argument {i}"));
    out.push('[');
    string(op, out);
    match op {
        "save" | "restore" => {}
        "alpha" => {
            out.push(',');
            number(n(1)?.clamp(0.0, 1.0), out);
        }
        "path" => {
            let Some(HostValue::Array(segments)) = at(1) else {
                return Err("\"path\" takes a list of segments".into());
            };
            out.push_str(",[");
            for (i, s) in segments.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                segment(s.as_ref(), out)?;
            }
            out.push_str("],");
            paint(at(2), out)?;
        }
        "text" => {
            let (x, y) = (n(1)?, n(2)?);
            let Some(HostValue::String(text)) = at(3) else {
                return Err("\"text\" argument 3 must be a string".into());
            };
            out.push(',');
            number(x, out);
            out.push(',');
            number(y, out);
            out.push(',');
            string(&text.to_string_lossy(), out);
            out.push(',');
            style(at(4), out)?;
        }
        "image" => {
            let Some(HostValue::String(src)) = at(1) else {
                return Err("\"image\" takes a src".into());
            };
            out.push(',');
            string(&src.to_string_lossy(), out);
            for i in 2..=5 {
                out.push(',');
                number(n(i)?, out);
            }
        }
        _ => {
            // Numbers, then a paint for the shapes.
            let shape = matches!(op, "rect" | "rrect" | "circle" | "line");
            let numbers = if shape { count - 1 } else { count };
            for i in 1..=numbers {
                out.push(',');
                number(n(i)?, out);
            }
            if shape {
                out.push(',');
                paint(at(count), out)?;
            }
        }
    }
    out.push(']');
    Ok(())
}

fn segment(v: Option<&HostValue>, out: &mut String) -> Checked {
    let Some(HostValue::Array(s)) = v else {
        return Err("a path segment is an array".into());
    };
    let verb = match s.first() {
        Some(Some(HostValue::String(verb))) => verb.as_str(),
        _ => None,
    };
    let count = match verb {
        Some("M" | "L") => 2,
        Some("Q") => 4,
        Some("C") => 6,
        Some("Z") => 0,
        _ => return Err("unknown path segment".into()),
    };
    let verb = verb.unwrap_or_default();
    if s.len() != count + 1 {
        return Err(format!(
            "a \"{verb}\" path segment takes {count} coordinates"
        ));
    }
    out.push('[');
    string(verb, out);
    for c in &s[1..] {
        out.push(',');
        number(finite(c.as_ref(), "a path coordinate")?, out);
    }
    out.push(']');
    Ok(())
}

/// Writes `"name":` before a field, with the comma when one came before.
fn key(name: &str, first: &mut bool, out: &mut String) {
    if !std::mem::take(first) {
        out.push(',');
    }
    out.push('"');
    out.push_str(name);
    out.push_str("\":");
}

fn paint(v: Option<&HostValue>, out: &mut String) -> Checked {
    let Some(m @ HostValue::Object(_)) = v else {
        return Err("a paint is an object".into());
    };
    out.push('{');
    let first = &mut true;
    if let Some(fill) = field(m, "fill") {
        key("fill", first, out);
        match fill {
            HostValue::Object(_) => gradient(fill, out)?,
            _ => color(Some(fill), out)?,
        }
    }
    if let Some(stroke) = field(m, "stroke") {
        key("stroke", first, out);
        color(Some(stroke), out)?;
    }
    if let Some(width) = field(m, "width") {
        let width = finite(Some(width), "a stroke's width")?.max(0.0);
        key("width", first, out);
        number(width, out);
    }
    if let Some(cap) = field(m, "cap") {
        let Some(cap @ ("butt" | "round")) = cap.as_str() else {
            return Err("a stroke's cap must be \"butt\" or \"round\"".into());
        };
        key("cap", first, out);
        string(cap, out);
    }
    out.push('}');
    Ok(())
}

fn gradient(m: &HostValue, out: &mut String) -> Checked {
    let coordinates = |name: &str, count: usize| -> Result<Option<Vec<f64>>, String> {
        let Some(list) = field(m, name) else {
            return Ok(None);
        };
        match list {
            HostValue::Array(items) if items.len() == count => items
                .iter()
                .map(|i| finite(i.as_ref(), name))
                .collect::<Result<Vec<_>, _>>()
                .map(Some),
            _ => Err(format!("a {name} gradient takes {count} numbers")),
        }
    };
    // Both are checked when present; with both, it is linear.
    let (linear, radial) = (coordinates("linear", 4)?, coordinates("radial", 3)?);
    let (name, shape) = match (linear, radial) {
        (Some(c), _) => ("linear", c),
        (None, Some(c)) => ("radial", c),
        (None, None) => return Err("a gradient needs linear or radial".into()),
    };
    let Some(HostValue::Array(stops)) = field(m, "stops") else {
        return Err("a gradient needs stops".into());
    };
    out.push_str("{\"");
    out.push_str(name);
    out.push_str("\":[");
    for (i, c) in shape.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        number(*c, out);
    }
    out.push_str("],\"stops\":[");
    for (i, stop) in stops.iter().enumerate() {
        let Some(HostValue::Array(pair)) = stop else {
            return Err("a stop is [offset, color]".into());
        };
        if pair.len() != 2 {
            return Err("a stop is [offset, color]".into());
        }
        if i > 0 {
            out.push(',');
        }
        let offset = finite(pair[0].as_ref(), "a stop's offset")?.clamp(0.0, 1.0);
        out.push('[');
        number(offset, out);
        out.push(',');
        color(pair[1].as_ref(), out)?;
        out.push(']');
    }
    out.push_str("]}");
    Ok(())
}

/// A text's style: left off, `undefined` or `null` is `{}`.
fn style(v: Option<&HostValue>, out: &mut String) -> Checked {
    let m = match v {
        None | Some(HostValue::Undefined | HostValue::Null) => {
            out.push_str("{}");
            return Ok(());
        }
        Some(m @ HostValue::Object(_)) => m,
        Some(_) => return Err("a text style is an object".into()),
    };
    out.push('{');
    let first = &mut true;
    if let Some(size) = field(m, "size") {
        let size = finite(Some(size), "a text size")?.clamp(1.0, 512.0);
        key("size", first, out);
        number(size, out);
    }
    if let Some(weight) = field(m, "weight") {
        let Some(weight) = weight
            .as_f64()
            .filter(|w| [400.0, 500.0, 600.0, 700.0].contains(w))
        else {
            return Err("a text weight must be 400, 500, 600 or 700".into());
        };
        key("weight", first, out);
        number(weight, out);
    }
    if let Some(align) = field(m, "align") {
        let Some(align @ ("left" | "center" | "right")) = align.as_str() else {
            return Err("a text align must be \"left\", \"center\" or \"right\"".into());
        };
        key("align", first, out);
        string(align, out);
    }
    if let Some(c) = field(m, "color") {
        key("color", first, out);
        color(Some(c), out)?;
    }
    if let Some(mono) = field(m, "mono") {
        let HostValue::Bool(mono) = mono else {
            return Err("a text mono must be true or false".into());
        };
        key("mono", first, out);
        out.push_str(if *mono { "true" } else { "false" });
    }
    out.push('}');
    Ok(())
}
