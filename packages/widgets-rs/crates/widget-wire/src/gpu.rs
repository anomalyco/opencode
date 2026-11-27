//! Section `G`: a GPU batch (`widgets-gpu.md`, Transport), `{ ops, bytes }`. The ops are written as a small
//! tag-length-value tree; `bytes` (an `ArrayBuffer` or typed array) are borrowed from the program in place
//! (`TypedArray::with_bytes`) and copied once, into the message.

use psychoscript::HostValue;
use serde_json::Value;

use crate::decode::{Cursor, Malformed};
use crate::encode::{put_str, varint};
use crate::json;
use crate::schema::{MAX_ARG_DEPTH, MAX_GPU_BYTES, MAX_GPU_OPS};

/// A batch's op arguments, and a batch ready to replay: psychoscript-gpu's batch format (its `README.md`, Transport).
pub use psychoscript_gpu::{Arg, Batch};

fn too_deep() -> String {
    format!("a GPU op nests deeper than {MAX_ARG_DEPTH} levels")
}

/// An argument as JSON reads it: `undefined` and functions left out of objects and `null` in lists, but numbers as
/// they are, `NaN` and infinities too (`widgets-gpu.md`, Transport).
fn put_arg(out: &mut Vec<u8>, a: &HostValue, depth: usize) -> Result<(), String> {
    if depth > MAX_ARG_DEPTH {
        return Err(too_deep());
    }
    match a {
        HostValue::Bool(b) => out.push(if *b { 2 } else { 1 }),
        // Every number as it is, `NaN` and infinities too (`widgets-gpu.md`, Transport).
        HostValue::Number(n) => {
            out.push(3);
            out.extend_from_slice(&n.to_le_bytes());
        }
        HostValue::String(s) => {
            out.push(4);
            put_str(out, &s.to_string_lossy());
        }
        HostValue::Array(items) => {
            out.push(5);
            varint(out, items.len() as u64);
            for i in items {
                match i {
                    Some(i) if !json::skipped(i) => put_arg(out, i, depth + 1)?,
                    _ => out.push(0),
                }
            }
        }
        HostValue::Object(fields) => {
            out.push(6);
            let kept = || fields.iter().filter(|(_, v)| !json::skipped(v));
            varint(out, kept().count() as u64);
            for (k, v) in kept() {
                put_str(out, &k.to_string_lossy());
                put_arg(out, v, depth + 1)?;
            }
        }
        HostValue::Null | HostValue::Undefined => out.push(0),
        other => put_json(out, &other.to_json().unwrap_or(Value::Null), depth)?,
    }
    Ok(())
}

fn put_json(out: &mut Vec<u8>, v: &Value, depth: usize) -> Result<(), String> {
    if depth > MAX_ARG_DEPTH {
        return Err(too_deep());
    }
    match v {
        Value::Null => out.push(0),
        Value::Bool(b) => out.push(if *b { 2 } else { 1 }),
        Value::Number(n) => {
            out.push(3);
            out.extend_from_slice(&n.as_f64().unwrap_or(0.0).to_le_bytes());
        }
        Value::String(s) => {
            out.push(4);
            put_str(out, s);
        }
        Value::Array(items) => {
            out.push(5);
            varint(out, items.len() as u64);
            for i in items {
                put_json(out, i, depth + 1)?;
            }
        }
        Value::Object(fields) => {
            out.push(6);
            varint(out, fields.len() as u64);
            for (k, v) in fields {
                put_str(out, k);
                put_json(out, v, depth + 1)?;
            }
        }
    }
    Ok(())
}

fn over_bytes(n: usize) -> String {
    format!("a GPU batch's bytes are {n} bytes, over the limit of {MAX_GPU_BYTES}")
}

/// A posted batch (`{ ops, bytes }`) as the spec's host checks take it in (`widgets-gpu.md`, Host checks: a native
/// host makes these three as it converts the value): its ops and its bytes, the program's `ArrayBuffer`; or the
/// failure, with the ops when they are a list (they decide which canvases it stops). The limits on ops and bytes are
/// the host checks' (`widget-gpu`).
type Ops<'a> = &'a [Option<HostValue>];

fn shape(
    batch: &HostValue,
) -> Result<(Ops<'_>, &psychoscript::TypedArray), (Option<Ops<'_>>, String)> {
    if !matches!(batch, HostValue::Object(_)) {
        return Err((None, "a batch must be an object".into()));
    }
    let Some(HostValue::Array(ops)) = batch.get("ops") else {
        return Err((None, "a batch's ops must be a list".into()));
    };
    match batch.get("bytes") {
        Some(HostValue::TypedArray(t)) if t.kind() == psychoscript::TypedKind::ArrayBuffer => {
            Ok((ops, t))
        }
        _ => Err((Some(ops), "a batch's bytes must be an ArrayBuffer".into())),
    }
}

/// Section `G` from the VM's batch value (`{ ops, bytes }`).
pub(crate) fn encode(batch: &HostValue, out: &mut Vec<u8>) -> Result<(), String> {
    let (ops, bytes) = shape(batch).map_err(|(_, message)| message)?;
    out.push(b'G');
    let at = out.len();
    out.extend_from_slice(&[0; 4]);
    varint(out, ops.len() as u64);
    for op in ops {
        put_arg(out, op.as_ref().unwrap_or(&HostValue::Null), 1)?;
    }
    let len = u32::try_from(out.len() - at - 4).map_err(|_| "a GPU batch's ops are too large")?;
    out[at..at + 4].copy_from_slice(&len.to_le_bytes());
    bytes.with_bytes(|b| {
        let len = u32::try_from(b.len()).map_err(|_| "a GPU batch's bytes are too large")?;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(b);
        Ok(())
    })
}

/// An argument as JSON reads it (`undefined` and functions left out of objects and `null` in lists, other kinds as
/// their JSON), but numbers as they are, `NaN` and infinities too (`widgets-gpu.md`, Transport); past
/// [`MAX_ARG_DEPTH`], `null`, which no op takes.
fn arg(a: &HostValue, depth: usize) -> Arg {
    if depth > MAX_ARG_DEPTH {
        return Arg::Null;
    }
    match a {
        HostValue::Bool(b) => Arg::Bool(*b),
        HostValue::Number(n) => Arg::Num(*n),
        HostValue::String(s) => Arg::Str(s.to_string_lossy().into_owned()),
        HostValue::Array(items) => Arg::List(
            items
                .iter()
                .map(|i| match i {
                    Some(i) if !json::skipped(i) => arg(i, depth + 1),
                    _ => Arg::Null,
                })
                .collect(),
        ),
        HostValue::Object(fields) => Arg::Obj(
            fields
                .iter()
                .filter(|(_, v)| !json::skipped(v))
                .map(|(k, v)| (k.to_string_lossy().into_owned(), arg(v, depth + 1)))
                .collect(),
        ),
        HostValue::Null | HostValue::Undefined => Arg::Null,
        other => Arg::from_json(&other.to_json().unwrap_or(Value::Null)),
    }
}

/// The ops as JSON reads them.
fn args(ops: &[Option<HostValue>]) -> Vec<Arg> {
    ops.iter()
        .map(|o| match o {
            Some(o) if !json::skipped(o) => arg(o, 1),
            _ => Arg::Null,
        })
        .collect()
}

/// A posted batch for a host that replays it: `f` gets its ops as JSON reads them and its bytes, the program's
/// `ArrayBuffer` borrowed in place, or the failure of its shape, with the ops when they are a list.
pub(crate) fn read<R>(
    batch: &HostValue,
    f: impl FnOnce(Result<(Vec<Arg>, &[u8]), (Option<Vec<Arg>>, String)>) -> R,
) -> R {
    match shape(batch) {
        Ok((ops, bytes)) => {
            let ops = args(ops);
            bytes.with_bytes(|b| f(Ok((ops, b))))
        }
        Err((ops, message)) => f(Err((ops.map(args), message))),
    }
}

fn read_arg(c: &mut Cursor, depth: usize) -> Result<Arg, Malformed> {
    if depth > MAX_ARG_DEPTH {
        return Err(Malformed(too_deep()));
    }
    Ok(match c.u8()? {
        0 => Arg::Null,
        1 => Arg::Bool(false),
        2 => Arg::Bool(true),
        3 => Arg::Num(c.f64()?),
        4 => Arg::Str(c.str()?.to_owned()),
        5 => {
            let n = c.count(1)?;
            let mut l = Vec::with_capacity(n);
            for _ in 0..n {
                l.push(read_arg(c, depth + 1)?);
            }
            Arg::List(l)
        }
        6 => {
            let n = c.count(2)?;
            let mut l = Vec::with_capacity(n);
            for _ in 0..n {
                let k = c.str()?.to_owned();
                l.push((k, read_arg(c, depth + 1)?));
            }
            Arg::Obj(l)
        }
        t => return Err(Malformed(format!("unknown GPU arg tag {t}"))),
    })
}

/// Section `G` at the cursor.
pub(crate) fn decode(c: &mut Cursor) -> Result<Batch, Malformed> {
    c.expect(b'G')?;
    let ops_len = c.u32()? as usize;
    let mut ops_c = Cursor::new(c.take(ops_len)?);
    let n = ops_c.varint()?;
    if n > MAX_GPU_OPS as u64 {
        return Err(Malformed(format!("{n} GPU ops is over the limit")));
    }
    let mut ops = Vec::with_capacity((n as usize).min(ops_len));
    for _ in 0..n {
        ops.push(read_arg(&mut ops_c, 1)?);
    }
    ops_c.end("GPU ops")?;
    let len = c.u32()? as usize;
    if len > MAX_GPU_BYTES {
        return Err(Malformed(over_bytes(len)));
    }
    let bytes = c.take(len)?.to_vec();
    Ok(Batch { ops, bytes })
}

/// A batch as the GPU conformance fixtures write a posted one (`widgets-gpu.md`, Conformance): `{ frame, ops, bytes }`,
/// `ops` as posted (numbers JSON can't hold as `{ "$num": "NaN" }` and the like), `bytes` base64, or `null` when not an
/// `ArrayBuffer`. Without a batch: a frame request that carries none, `{ frame: true, ops: [], bytes: "" }`.
#[cfg(feature = "test-hooks")]
pub(crate) fn recorded(frame: bool, batch: Option<&HostValue>) -> Value {
    let Some(batch) = batch else {
        return serde_json::json!({ "frame": frame, "ops": [], "bytes": "" });
    };
    let ops = batch.get("ops").map_or(Arg::Null, |o| arg(o, 1));
    let bytes = match batch.get("bytes") {
        Some(HostValue::TypedArray(t)) if t.kind() == psychoscript::TypedKind::ArrayBuffer => {
            Value::String(t.with_bytes(base64))
        }
        _ => Value::Null,
    };
    serde_json::json!({ "frame": frame, "ops": arg_json(&ops), "bytes": bytes })
}

#[cfg(feature = "test-hooks")]
fn arg_json(a: &Arg) -> Value {
    match a {
        Arg::Null => Value::Null,
        Arg::Bool(b) => Value::Bool(*b),
        Arg::Num(n) => match serde_json::Number::from_f64(*n) {
            Some(n) => Value::Number(n),
            None => {
                let name = match () {
                    _ if n.is_nan() => "NaN",
                    _ if *n > 0.0 => "Infinity",
                    _ => "-Infinity",
                };
                serde_json::json!({ "$num": name })
            }
        },
        Arg::Str(s) => Value::String(s.clone()),
        Arg::List(l) => Value::Array(l.iter().map(arg_json).collect()),
        Arg::Obj(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), arg_json(v))).collect()),
    }
}

#[cfg(feature = "test-hooks")]
fn base64(b: &[u8]) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(b.len().div_ceil(3) * 4);
    for c in b.chunks(3) {
        let n = (c[0] as u32) << 16
            | (*c.get(1).unwrap_or(&0) as u32) << 8
            | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            match i <= c.len() {
                true => out.push(ABC[(n >> (18 - 6 * i) & 63) as usize] as char),
                false => out.push('='),
            }
        }
    }
    out
}
