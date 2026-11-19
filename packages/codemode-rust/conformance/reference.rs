//! The Rust side of `conformance/reference.ts`: the `tools` host global the generators define, and `describe`, which
//! writes a host value as data the way the recordings do. Each replay includes this file with `#[path]`.

#![allow(dead_code)]

use psychoscript::{Failure, HostFunction, HostString, HostValue, Json, Namespace, Resolved};
use serde_json::json;

/// The `tools` namespace of `conformance/reference.ts`: `tools.echo`, `tools.fail` and `tools.git.status`, all async;
/// any other path is an async function that rejects with `NotFound`, and listing the names under a path that is
/// neither a namespace nor a function throws `NotFound`.
pub fn tools() -> Namespace {
    let echo = HostFunction::new_async(|args, _| async move {
        Ok(match args.first() {
            Some(HostValue::Object(fields)) => fields
                .iter()
                .find(|(k, _)| k == "id")
                .map_or(HostValue::Null, |(_, v)| v.clone()),
            _ => HostValue::Null,
        })
    })
    .length(1);
    let fail =
        HostFunction::new_async(|_, _| async { Err(Failure::new("HostFailure", "boom").into()) })
            .length(1);
    let status = HostFunction::new_async(|_, _| async {
        Ok(HostValue::object([
            ("branch", HostValue::from("main")),
            ("dirty", HostValue::Bool(true)),
        ]))
    })
    .length(1);
    Namespace::new(
        |path| match path {
            [] => Ok(vec!["echo".into(), "fail".into(), "git".into()]),
            [git] if git == "git" => Ok(vec!["status".into()]),
            [f] if f == "echo" || f == "fail" => Ok(Vec::new()),
            [git, status] if git == "git" && status == "status" => Ok(Vec::new()),
            _ => Err(Failure::new(
                "NotFound",
                exact("No namespace at tools.", &joined_exact(path), "."),
            )
            .into()),
        },
        move |path| -> Resolved {
            match path {
                [f] if f == "echo" => echo.clone().into(),
                [f] if f == "fail" => fail.clone().into(),
                [git, s] if git == "git" && s == "status" => status.clone().into(),
                _ => {
                    let message = exact("No function at tools.", &joined_exact(path), ".");
                    HostFunction::new_async(move |_, _| {
                        let message = message.clone();
                        async move { Err(Failure::new("NotFound", message).into()) }
                    })
                    .length(1)
                    .into()
                }
            }
        },
    )
}

/// A host value as data, as `describe` in `conformance/reference.ts` writes it.
pub fn describe(v: &HostValue) -> Json {
    match v {
        HostValue::Undefined | HostValue::Interrupt => json!({ "undefined": true }),
        HostValue::Null => Json::Null,
        HostValue::Bool(b) => json!(b),
        HostValue::Number(n) if n.is_nan() => json!({ "number": "NaN" }),
        HostValue::Number(n) if n.is_infinite() => {
            json!({ "number": if *n > 0.0 { "Infinity" } else { "-Infinity" } })
        }
        HostValue::Number(n) => number(*n),
        HostValue::String(s) => text(s),
        HostValue::Function(f) => json!({ "function": f.name() }),
        HostValue::Durable(_) | HostValue::Namespace(_) => json!({ "function": "" }),
        HostValue::Date(t) if t.is_nan() => json!({ "date": "NaN" }),
        HostValue::Date(t) => json!({ "date": number(*t) }),
        HostValue::RegExp { source, flags } => json!({ "regexp": [text(source), flags] }),
        HostValue::Url(href) => json!({ "url": href }),
        HostValue::SearchParams(pairs) => json!({ "params": pairs }),
        HostValue::Headers(entries) => json!({ "headers": entries }),
        HostValue::Buffer(b) => json!({ "buffer": b }),
        HostValue::Bytes(b) => json!({ "bytes": b }),
        HostValue::Map(entries) => json!({
            "map": entries.iter().map(|(k, x)| json!([describe(k), describe(x)])).collect::<Vec<_>>()
        }),
        HostValue::Set(items) => json!({ "set": items.iter().map(describe).collect::<Vec<_>>() }),
        HostValue::Array(items) => json!({
            "array": items
                .iter()
                .map(|i| i.as_ref().map_or(json!({ "hole": true }), describe))
                .collect::<Vec<_>>()
        }),
        HostValue::Error(e) => {
            let mut error = serde_json::Map::new();
            error.insert("name".into(), text(&e.name));
            error.insert("message".into(), text(&e.message));
            if let Some(cause) = &e.cause {
                error.insert("cause".into(), describe(cause));
            }
            error.insert(
                "fields".into(),
                Json::Array(
                    e.fields
                        .iter()
                        .map(|(k, x)| json!([text(k), describe(x)]))
                        .collect(),
                ),
            );
            json!({ "error": error })
        }
        HostValue::Failure(f) => json!({
            "error": { "name": "Error", "message": text(&f.message), "fields": [] }
        }),
        HostValue::Response(_) => json!({ "object": [] }),
        HostValue::Object(fields) => json!({
            "object": fields.iter().map(|(k, x)| json!([text(k), describe(x)])).collect::<Vec<_>>()
        }),
    }
}

/// A namespace path's names joined with `.`, unpaired surrogates kept, as the reference's `path.join(".")`.
pub fn joined_exact(path: &[HostString]) -> HostString {
    let mut units = Vec::new();
    for (i, k) in path.iter().enumerate() {
        if i > 0 {
            units.push(u16::from(b'.'));
        }
        units.extend_from_slice(&k.to_utf16());
    }
    HostString::from_utf16(&units)
}

/// `before + text + after`, unpaired surrogates in `text` kept.
pub fn exact(before: &str, text: &HostString, after: &str) -> HostString {
    let units: Vec<u16> = before
        .encode_utf16()
        .chain(text.to_utf16().iter().copied())
        .chain(after.encode_utf16())
        .collect();
    HostString::from_utf16(&units)
}

/// A namespace path as text, its names joined with `.` (U+FFFD for an unpaired surrogate), for messages.
pub fn joined(path: &[HostString]) -> String {
    path.iter()
        .map(|k| k.to_string())
        .collect::<Vec<_>>()
        .join(".")
}

/// A string as `describe` writes it: the string itself, or `{ string: [code units] }` when it has an unpaired
/// surrogate, which JSON can't hold.
pub fn text(s: &HostString) -> Json {
    match s.as_str() {
        Some(s) => json!(s),
        None => json!({ "string": s.to_utf16() }),
    }
}

/// A number as JSON writes it: an integer when it is one.
fn number(n: f64) -> Json {
    if n.fract() == 0.0 && n.abs() < 9.0e15 && !(n == 0.0 && n.is_sign_negative()) {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// JSON equality where numbers compare by value, so `3` equals `3.0`.
pub fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|((kx, vx), (ky, vy))| kx == ky && same(vx, vy))
        }
        _ => a == b,
    }
}
