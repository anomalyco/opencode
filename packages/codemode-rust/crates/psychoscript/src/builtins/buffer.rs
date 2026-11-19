//! Node's Buffer: a Uint8Array whose text conversions default to UTF-8, with Node's encodings, errors and codes.

use super::bytes::{
    as_bytes, base64_decode_node, base64_encode, bytes_of, bytes_ref, hex_encode, new_bytes, to_u8,
    view_value,
};
use super::{arg, describe_value};
use crate::object::*;
use crate::ops::MAX_ARRAY_LEN;
use crate::value::{Id, Value, num_to_string, to_integer};
use crate::vm::{Res, Vm};

#[derive(Clone, Copy, PartialEq)]
enum Enc {
    Utf8,
    Hex,
    Base64,
    Base64Url,
    Latin1,
    Ascii,
    Utf16le,
}

fn encoding_of(name: &str) -> Option<Enc> {
    Some(match name.to_ascii_lowercase().as_str() {
        "utf8" | "utf-8" => Enc::Utf8,
        "hex" => Enc::Hex,
        "base64" => Enc::Base64,
        "base64url" => Enc::Base64Url,
        "latin1" | "binary" => Enc::Latin1,
        "ascii" => Enc::Ascii,
        "ucs2" | "ucs-2" | "utf16le" | "utf-16le" => Enc::Utf16le,
        _ => return None,
    })
}

/// A Node-style error: the program error of `kind` with Node's `code`.
fn node_error(vm: &mut Vm, kind: &str, message: &str, code: &str) -> Value {
    let proto = match kind {
        "RangeError" => vm.realm.range_error_proto,
        "TypeError" => vm.realm.type_error_proto,
        _ => vm.realm.error_proto,
    };
    let e = vm.make_error(proto, message);
    if let Value::Obj(id) = e {
        let k = vm.atoms.intern_static("code");
        let c = vm.str_val(code);
        vm.define(id, k, c);
    }
    e
}

/// How Node's argument errors show the value they received.
fn received(vm: &mut Vm, v: &Value) -> String {
    match v {
        Value::Undef | Value::Uninit => "undefined".into(),
        Value::Null => "null".into(),
        Value::Str(s) => {
            // Node cuts the value at 25 code units.
            let r = vm.atoms.sref(*s);
            let short = r.slice16(0, 25);
            let more = if r.len16() > 25 { "..." } else { "" };
            format!("type string ('{short}'{more})")
        }
        Value::Num(n) => format!("type number ({})", num_to_string(*n)),
        Value::Bool(b) => format!("type boolean ({b})"),
        Value::Obj(_) if vm.is_callable(v) => "function ".into(),
        Value::Obj(id) => {
            let ctor = vm.names.constructor;
            let name = match vm.get_obj(*id, ctor) {
                Value::Obj(c) => {
                    let nk = vm.names.name;
                    match vm.get_obj(c, nk) {
                        Value::Str(s) => vm.text(s).to_owned(),
                        _ => String::new(),
                    }
                }
                _ => String::new(),
            };
            if name.is_empty() {
                "[Object: null prototype]".into()
            } else {
                format!("an instance of {name}")
            }
        }
        Value::Sym(_) => "type symbol (Symbol(Symbol.iterator))".into(),
    }
}

fn encoding(vm: &mut Vm, v: &Value) -> Result<Option<Enc>, Value> {
    match v {
        Value::Undef => Ok(None),
        Value::Str(s) => match encoding_of(vm.text(*s)) {
            Some(e) => Ok(Some(e)),
            None => {
                let t = vm.text(*s).to_owned();
                Err(node_error(
                    vm,
                    "TypeError",
                    &format!("Unknown encoding: {t}"),
                    "ERR_UNKNOWN_ENCODING",
                ))
            }
        },
        v => {
            let s = vm.string_of(v)?;
            let t = vm.text(s).to_owned();
            Err(node_error(
                vm,
                "TypeError",
                &format!("Unknown encoding: {t}"),
                "ERR_UNKNOWN_ENCODING",
            ))
        }
    }
}

/// A string's bytes in `enc`: UTF-8 writes a lone surrogate as U+FFFD, the single-byte and UTF-16 encodings take
/// its code units.
fn encode(r: crate::strings::StrRef, enc: Enc) -> Vec<u8> {
    let s = r.s;
    match enc {
        Enc::Utf8 => crate::strings::host_text(s).as_bytes().to_vec(),
        Enc::Hex => {
            let b = s.as_bytes();
            let mut out = Vec::new();
            for p in b.chunks(2) {
                if p.len() < 2 {
                    break;
                }
                match ((p[0] as char).to_digit(16), (p[1] as char).to_digit(16)) {
                    (Some(h), Some(l)) => out.push((h * 16 + l) as u8),
                    _ => break,
                }
            }
            out
        }
        Enc::Base64 | Enc::Base64Url => base64_decode_node(s),
        Enc::Latin1 | Enc::Ascii => r.iter16().map(|u| u as u8).collect(),
        Enc::Utf16le => r.iter16().flat_map(|u| u.to_le_bytes()).collect(),
    }
}

fn decode(data: &[u8], enc: Enc) -> String {
    match enc {
        Enc::Utf8 => crate::strings::external_text(String::from_utf8_lossy(data).into_owned()),
        Enc::Hex => hex_encode(data),
        Enc::Base64 => base64_encode(data, false, true),
        Enc::Base64Url => base64_encode(data, true, false),
        Enc::Latin1 => data.iter().map(|b| *b as char).collect(),
        Enc::Ascii => data.iter().map(|b| (b & 0x7f) as char).collect(),
        Enc::Utf16le => {
            let units: Vec<u16> = data
                .as_chunks::<2>()
                .0
                .iter()
                .map(|p| u16::from_le_bytes(*p))
                .collect();
            // Lone surrogates stay, as the reference decodes them.
            crate::strings::from_units(&units)
        }
    }
}

pub fn setup(vm: &mut Vm) {
    let up = vm.realm.std.uint8;
    let proto = vm.plain(up);
    vm.realm.std.buffer = proto;
    let ctor = vm.ctor("Buffer", 2, buffer_call, proto, Value::Undef);
    vm.methods(
        ctor,
        &[
            ("from", 3, buffer_from),
            ("alloc", 3, buffer_alloc),
            ("allocUnsafe", 1, buffer_alloc_unsafe),
            ("allocUnsafeSlow", 1, buffer_alloc_unsafe),
            ("byteLength", 2, buffer_byte_length),
            ("concat", 2, buffer_concat),
            ("isBuffer", 1, buffer_is_buffer),
            ("isEncoding", 1, buffer_is_encoding),
            ("compare", 2, buffer_compare),
        ],
    );
    let k = vm.atoms.intern_static("poolSize");
    vm.define_hidden(ctor, k, Value::Num(8192.0));
    vm.methods(
        proto,
        &[
            ("toString", 3, b_to_string),
            ("toJSON", 0, b_to_json),
            ("slice", 2, b_slice),
            ("subarray", 2, b_slice),
            ("equals", 1, b_equals),
            ("compare", 5, b_compare),
            ("indexOf", 3, b_index_of),
            ("lastIndexOf", 3, b_last_index_of),
            ("includes", 3, b_includes),
            ("write", 4, b_write),
            ("fill", 4, b_fill),
            ("copy", 4, b_copy),
            ("swap16", 0, b_swap16),
            ("swap32", 0, b_swap32),
            ("swap64", 0, b_swap64),
        ],
    );
    for (i, (name, ..)) in NUMERIC.iter().enumerate() {
        let f = vm.native_fn(name, 2, b_numeric, Value::Num(i as f64));
        let k = vm.atoms.intern_static(name);
        vm.define_hidden(proto, k, f);
    }
}

fn wrap(vm: &mut Vm, data: Vec<u8>) -> Value {
    new_bytes(vm, data, true)
}

fn this_buf(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Bytes(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(super::incompatible(
        vm,
        &format!("Buffer.prototype.{name}"),
        this,
    ))
}

fn bytes_from(vm: &mut Vm, value: &Value, second: &Value, third: &Value) -> Result<Vec<u8>, Value> {
    if let Value::Str(s) = value {
        let enc = encoding(vm, second)?.unwrap_or(Enc::Utf8);
        return Ok(encode(vm.atoms.sref(*s), enc));
    }
    if let Some(data) = bytes_of(vm, value) {
        let offset = match second {
            Value::Undef => 0.0,
            v => vm.number_of(v)?,
        };
        let start = to_integer(offset).clamp(0.0, data.len() as f64) as usize;
        let end = match third {
            Value::Undef => data.len(),
            v => (start as f64 + to_integer(vm.number_of(v)?))
                .clamp(start as f64, data.len() as f64) as usize,
        };
        return Ok(data[start..end].to_vec());
    }
    if let Value::Obj(id) = value {
        let id = *id;
        if matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
            vm.densify(id)?;
        }
        if let Kind::Array(items) = &vm.heap[id as usize].kind {
            let items = items.clone();
            let mut out = Vec::with_capacity(items.len());
            for v in items {
                out.push(to_u8(vm.number_of(&v)?));
            }
            return Ok(out);
        }
        let (tk, dk) = (
            vm.atoms.intern_static("type"),
            vm.atoms.intern_static("data"),
        );
        let t = vm.get_obj(id, tk);
        let d = vm.get_obj(id, dk);
        if let (Value::Str(t), Value::Obj(did)) = (t, d)
            && vm.text(t) == "Buffer"
            && matches!(vm.heap[did as usize].kind, Kind::Array(_))
            && vm.densify(did).is_ok()
            && let Kind::Array(items) = &vm.heap[did as usize].kind
        {
            let items = items.clone();
            let mut out = Vec::with_capacity(items.len());
            for v in items {
                out.push(to_u8(vm.number_of(&v)?));
            }
            return Ok(out);
        }
        let lk = vm.names.length;
        if let Value::Num(n) = vm.get_obj(id, lk) {
            let n = to_integer(n).clamp(0.0, MAX_ARRAY_LEN as f64) as usize;
            let mut out = Vec::with_capacity(n);
            for i in 0..n {
                let v = vm.get_elem(value, &Value::Num(i as f64))?;
                out.push(to_u8(vm.number_of(&v)?));
            }
            return Ok(out);
        }
    }
    let d = describe_value(vm, value);
    Err(node_error(
        vm,
        "TypeError",
        &format!(
            "The first argument must be of type string or an instance of Buffer, Uint8Array, or Array or an Array-like Object. Received {d}"
        ),
        "ERR_INVALID_ARG_TYPE",
    ))
}

fn buffer_call(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let data = bytes_from(vm, &arg(args, 0), &arg(args, 1), &arg(args, 2))?;
    Ok(wrap(vm, data))
}

fn buffer_from(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    buffer_call(vm, Value::Undef, args, 0)
}

fn size(vm: &mut Vm, v: &Value) -> Result<usize, Value> {
    let n = vm.number_of(v)?;
    if n.fract() != 0.0 || !n.is_finite() || n < 0.0 || n > MAX_ARRAY_LEN as f64 {
        let s = vm.string_of(v)?;
        let s = vm.text(s).to_owned();
        return Err(node_error(
            vm,
            "RangeError",
            &format!("The argument 'size' is invalid. Received {s}"),
            "ERR_OUT_OF_RANGE",
        ));
    }
    Ok(n as usize)
}

/// Fills `data[start..end]` with a fill value as Node's `fill` reads it.
fn fill_with(vm: &mut Vm, data: &mut [u8], value: &Value, enc: Option<Enc>) -> Result<(), Value> {
    let pattern = match value {
        Value::Str(s) => {
            let p = encode(vm.atoms.sref(*s), enc.unwrap_or(Enc::Utf8));
            if p.is_empty() && !data.is_empty() {
                vec![0]
            } else {
                p
            }
        }
        Value::Num(n) => vec![to_u8(*n)],
        Value::Bool(b) => vec![*b as u8],
        v => match bytes_of(vm, v) {
            Some(b) => b,
            None => vec![to_u8(vm.number_of(v)?)],
        },
    };
    if pattern.is_empty() {
        return Ok(());
    }
    for (i, slot) in data.iter_mut().enumerate() {
        *slot = pattern[i % pattern.len()];
    }
    Ok(())
}

fn buffer_alloc(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let n = size(vm, &arg(args, 0))?;
    let mut data = vec![0; n];
    let fill = arg(args, 1);
    if !matches!(fill, Value::Undef) {
        let enc = if let Value::Str(_) = fill {
            encoding(vm, &arg(args, 2))?
        } else {
            None
        };
        fill_with(vm, &mut data, &fill, enc)?;
    }
    Ok(wrap(vm, data))
}

fn buffer_alloc_unsafe(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let n = size(vm, &arg(args, 0))?;
    Ok(wrap(vm, vec![0; n]))
}

fn buffer_byte_length(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let v = arg(args, 0);
    if let Some(b) = as_bytes(vm, &v) {
        return Ok(Value::Num(b.len as f64));
    }
    let s = vm.string_of(&v)?;
    let enc = encoding(vm, &arg(args, 1))?.unwrap_or(Enc::Utf8);
    let text = vm.text(s);
    let n = match enc {
        Enc::Utf8 => crate::strings::host_text(text).len(),
        Enc::Latin1 | Enc::Ascii => vm.atoms.sref(s).len16(),
        Enc::Utf16le => vm.atoms.sref(s).len16() * 2,
        Enc::Hex => text.len() / 2,
        Enc::Base64 | Enc::Base64Url => {
            let mut len = text.len();
            let b = text.as_bytes();
            if len > 0 && b[len - 1] == b'=' {
                len -= 1;
            }
            if len > 0 && b[len - 1] == b'=' {
                len -= 1;
            }
            len * 3 / 4
        }
    };
    Ok(Value::Num(n as f64))
}

fn buffer_concat(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let list = arg(args, 0);
    if let Value::Obj(id) = list
        && matches!(vm.heap[id as usize].kind, Kind::Array(_))
    {
        vm.densify(id)?;
    }
    let items = match list {
        Value::Obj(id) => match &vm.heap[id as usize].kind {
            Kind::Array(items) => items.clone(),
            _ => Vec::new(),
        },
        _ => Vec::new(),
    };
    if !matches!(&list, Value::Obj(id) if matches!(vm.heap[*id as usize].kind, Kind::Array(_))) {
        let d = describe_value(vm, &list);
        return Err(vm.type_error(&format!(
            "Buffer.concat expects an array of Buffers, received {d}."
        )));
    }
    let mut parts = Vec::with_capacity(items.len());
    for item in &items {
        match bytes_of(vm, item) {
            Some(b) => parts.push(b),
            None => {
                let d = describe_value(vm, item);
                return Err(vm.type_error(&format!(
                    "Buffer.concat expects an array of Buffers, received {d} in it."
                )));
            }
        }
    }
    let total = match arg(args, 1) {
        Value::Undef => parts.iter().map(Vec::len).sum(),
        v => size(vm, &v)?,
    };
    let mut out: Vec<u8> = parts.concat();
    out.resize(total, 0);
    Ok(wrap(vm, out))
}

fn buffer_is_buffer(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        as_bytes(vm, &arg(args, 0)).is_some_and(|b| b.buffer),
    ))
}

fn buffer_is_encoding(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(match arg(args, 0) {
        Value::Str(s) => encoding_of(vm.text(s)).is_some(),
        _ => false,
    }))
}

fn ordering(o: std::cmp::Ordering) -> Value {
    Value::Num(match o {
        std::cmp::Ordering::Less => -1.0,
        std::cmp::Ordering::Equal => 0.0,
        std::cmp::Ordering::Greater => 1.0,
    })
}

fn buffer_compare(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    match (bytes_of(vm, &arg(args, 0)), bytes_of(vm, &arg(args, 1))) {
        (Some(a), Some(b)) => Ok(ordering(a.cmp(&b))),
        _ => Err(vm.type_error("Buffer.compare expects two Buffers or Uint8Arrays.")),
    }
}

// ---------- prototype ----------

fn b_to_string(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "toString")?;
    let data = bytes_ref(vm, id).to_vec();
    let enc = encoding(vm, &arg(args, 0))?.unwrap_or(Enc::Utf8);
    let start = match arg(args, 1) {
        Value::Undef => 0.0,
        v => vm.number_of(&v)?.max(0.0),
    };
    let end = match arg(args, 2) {
        Value::Undef => data.len() as f64,
        v => vm.number_of(&v)?.min(data.len() as f64),
    };
    let (s, e) = (
        to_integer(start) as usize,
        to_integer(end).max(0.0) as usize,
    );
    let part = if s < e && s < data.len() {
        &data[s..e]
    } else {
        &[][..]
    };
    let out = decode(part, enc);
    Ok(vm.string_val(out))
}

fn b_to_json(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "toJSON")?;
    let data: Vec<Value> = bytes_ref(vm, id)
        .to_vec()
        .into_iter()
        .map(|b| Value::Num(b as f64))
        .collect();
    let arr = vm.new_array(data);
    let o = vm.new_object();
    let (tk, dk) = (
        vm.atoms.intern_static("type"),
        vm.atoms.intern_static("data"),
    );
    let t = vm.static_str("Buffer");
    vm.define(o, tk, t);
    vm.define(o, dk, arr);
    Ok(Value::Obj(o))
}

fn b_slice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "slice")?;
    let len = bytes_ref(vm, id).len as f64;
    let clamp = |vm: &mut Vm, v: &Value, fallback: f64| -> Result<usize, Value> {
        if let Value::Undef = v {
            return Ok(fallback as usize);
        }
        let n = vm.number_of(v)?;
        let i = if n.is_nan() { 0.0 } else { n.trunc() };
        Ok(if i < 0.0 {
            (len + i).max(0.0) as usize
        } else {
            i.min(len) as usize
        })
    };
    let s = clamp(vm, &arg(args, 0), 0.0)?;
    let e = clamp(vm, &arg(args, 1), len)?;
    let v = bytes_ref(vm, id).view(s, e, true);
    Ok(view_value(vm, v))
}

fn b_equals(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "equals")?;
    let other = arg(args, 0);
    let Some(b) = bytes_of(vm, &other) else {
        let d = describe_value(vm, &other);
        return Err(vm.type_error(&format!(
            "The \"otherBuffer\" argument must be an instance of Buffer or Uint8Array. Received {d}"
        )));
    };
    Ok(Value::Bool(bytes_ref(vm, id).to_vec() == b))
}

fn range_arg(
    vm: &mut Vm,
    v: &Value,
    name: &str,
    default: usize,
    max: usize,
) -> Result<usize, Value> {
    match v {
        Value::Undef => Ok(default),
        Value::Num(n) => {
            if *n < 0.0 || *n > max as f64 || n.fract() != 0.0 {
                return Err(node_error(
                    vm,
                    "RangeError",
                    &format!(
                        "The value of \"{name}\" is out of range. It must be >= 0 and <= {max}. Received {}",
                        num_to_string(*n)
                    ),
                    "ERR_OUT_OF_RANGE",
                ));
            }
            Ok(*n as usize)
        }
        v => {
            let d = received(vm, v);
            Err(node_error(
                vm,
                "TypeError",
                &format!("The \"{name}\" argument must be of type number. Received {d}"),
                "ERR_INVALID_ARG_TYPE",
            ))
        }
    }
}

fn b_compare(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "compare")?;
    let target = arg(args, 0);
    let Some(t) = bytes_of(vm, &target) else {
        let d = describe_value(vm, &target);
        return Err(node_error(
            vm,
            "TypeError",
            &format!(
                "The \"target\" argument must be an instance of Buffer or Uint8Array. Received {d}"
            ),
            "ERR_INVALID_ARG_TYPE",
        ));
    };
    let s = bytes_ref(vm, id).to_vec();
    let ts = range_arg(vm, &arg(args, 1), "targetStart", 0, t.len())?;
    let te = range_arg(vm, &arg(args, 2), "targetEnd", t.len(), t.len())?;
    let ss = range_arg(vm, &arg(args, 3), "sourceStart", 0, s.len())?;
    let se = range_arg(vm, &arg(args, 4), "sourceEnd", s.len(), s.len())?;
    let a = &s[ss.min(se)..se];
    let b = &t[ts.min(te)..te];
    Ok(ordering(a.cmp(b)))
}

/// The bytes a search value stands for, as Node's `indexOf` reads it.
fn needle(vm: &mut Vm, v: &Value, enc: &Value) -> Result<Vec<u8>, Value> {
    match v {
        Value::Str(s) => {
            let enc = encoding(vm, enc)?.unwrap_or(Enc::Utf8);
            Ok(encode(vm.atoms.sref(*s), enc))
        }
        Value::Num(n) => Ok(vec![to_u8(*n)]),
        v => match bytes_of(vm, v) {
            Some(b) => Ok(b),
            None => {
                let d = describe_value(vm, v);
                Err(node_error(
                    vm,
                    "TypeError",
                    &format!(
                        "The \"value\" argument must be one of type number or string or an instance of Buffer or Uint8Array. Received {d}"
                    ),
                    "ERR_INVALID_ARG_TYPE",
                ))
            }
        },
    }
}

fn search(vm: &mut Vm, this: &Value, args: &[Value], name: &str, last: bool) -> Result<f64, Value> {
    let id = this_buf(vm, this, name)?;
    let hay = bytes_ref(vm, id).to_vec();
    let (offset, enc) = match arg(args, 1) {
        Value::Str(_) => (Value::Undef, arg(args, 1)),
        o => (o, arg(args, 2)),
    };
    let n = needle(vm, &arg(args, 0), &enc)?;
    let len = hay.len() as f64;
    let from = match offset {
        Value::Undef => {
            if last {
                len
            } else {
                0.0
            }
        }
        v => {
            let x = vm.number_of(&v)?;
            if x.is_nan() {
                if last { len } else { 0.0 }
            } else {
                let x = x.trunc();
                if x < 0.0 {
                    (len + x).max(if last { -1.0 } else { 0.0 })
                } else {
                    x
                }
            }
        }
    };
    if n.is_empty() {
        return Ok(from.min(len));
    }
    if n.len() > hay.len() {
        return Ok(-1.0);
    }
    let max_start = hay.len() - n.len();
    if last {
        if from < 0.0 {
            return Ok(-1.0);
        }
        let start = (from as usize).min(max_start);
        Ok((0..=start)
            .rev()
            .find(|&i| hay[i..i + n.len()] == n[..])
            .map(|i| i as f64)
            .unwrap_or(-1.0))
    } else {
        let start = from as usize;
        if start > max_start {
            return Ok(-1.0);
        }
        Ok((start..=max_start)
            .find(|&i| hay[i..i + n.len()] == n[..])
            .map(|i| i as f64)
            .unwrap_or(-1.0))
    }
}

fn b_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Num(search(vm, &this, args, "indexOf", false)?))
}

fn b_last_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Num(search(vm, &this, args, "lastIndexOf", true)?))
}

fn b_includes(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        search(vm, &this, args, "includes", false)? >= 0.0,
    ))
}

fn b_write(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "write")?;
    let Value::Str(s) = arg(args, 0) else {
        let d = describe_value(vm, &arg(args, 0));
        return Err(node_error(
            vm,
            "TypeError",
            &format!("The \"string\" argument must be of type string. Received {d}"),
            "ERR_INVALID_ARG_TYPE",
        ));
    };
    let len = bytes_ref(vm, id).len;
    let (offset, length, enc) = match (arg(args, 1), arg(args, 2)) {
        (e @ Value::Str(_), _) => (Value::Undef, Value::Undef, e),
        (o, e @ Value::Str(_)) => (o, Value::Undef, e),
        (o, l) => (o, l, arg(args, 3)),
    };
    let offset = range_arg(vm, &offset, "offset", 0, len)?;
    let length = range_arg(vm, &length, "length", len - offset, len)?;
    let enc = encoding(vm, &enc)?.unwrap_or(Enc::Utf8);
    let mut data = encode(vm.atoms.sref(s), enc);
    let room = length.min(len - offset);
    if data.len() > room {
        data.truncate(room);
        if enc == Enc::Utf8 {
            while !data.is_empty() && std::str::from_utf8(&data).is_err() {
                data.pop();
            }
        }
    }
    let b = bytes_ref(vm, id);
    for (i, v) in data.iter().enumerate() {
        b.put(offset + i, *v);
    }
    Ok(Value::Num(data.len() as f64))
}

fn b_fill(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "fill")?;
    let len = bytes_ref(vm, id).len;
    let value = arg(args, 0);
    let (offset, end, enc) = match (arg(args, 1), arg(args, 2)) {
        (e @ Value::Str(_), _) => (Value::Undef, Value::Undef, e),
        (o, e @ Value::Str(_)) => (o, Value::Undef, e),
        (o, l) => (o, l, arg(args, 3)),
    };
    let offset = range_arg(vm, &offset, "offset", 0, len)?;
    let end = range_arg(vm, &end, "end", len, len)?;
    let enc = if let Value::Str(_) = value {
        encoding(vm, &enc)?
    } else {
        None
    };
    if offset >= end {
        return Ok(this);
    }
    let mut data = vec![0; end - offset];
    fill_with(vm, &mut data, &value, enc)?;
    let b = bytes_ref(vm, id);
    for (i, v) in data.into_iter().enumerate() {
        b.put(offset + i, v);
    }
    Ok(this)
}

fn b_copy(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_buf(vm, &this, "copy")?;
    let target = arg(args, 0);
    let Value::Obj(tid) = target else {
        return Err(node_error(
            vm,
            "TypeError",
            "The \"target\" argument must be an instance of Buffer or Uint8Array.",
            "ERR_INVALID_ARG_TYPE",
        ));
    };
    if !matches!(vm.heap[tid as usize].kind, Kind::Bytes(_)) {
        let d = describe_value(vm, &target);
        return Err(node_error(
            vm,
            "TypeError",
            &format!(
                "The \"target\" argument must be an instance of Buffer or Uint8Array. Received {d}"
            ),
            "ERR_INVALID_ARG_TYPE",
        ));
    }
    let src = bytes_ref(vm, id).to_vec();
    let tlen = bytes_ref(vm, tid).len;
    let ts = range_arg(vm, &arg(args, 1), "targetStart", 0, usize::MAX >> 12)?;
    let ss = range_arg(vm, &arg(args, 2), "sourceStart", 0, src.len())?;
    let se = match arg(args, 3) {
        Value::Undef => src.len(),
        v => range_arg(vm, &v, "sourceEnd", src.len(), usize::MAX >> 12)?.min(src.len()),
    };
    if ts >= tlen || ss >= se {
        return Ok(Value::Num(0.0));
    }
    let n = (se - ss).min(tlen - ts);
    let t = bytes_ref(vm, tid);
    for i in 0..n {
        t.put(ts + i, src[ss + i]);
    }
    Ok(Value::Num(n as f64))
}

fn swap(vm: &mut Vm, this: Value, size: usize) -> Res {
    let id = this_buf(vm, &this, &format!("swap{}", size * 8))?;
    let mut data = bytes_ref(vm, id).to_vec();
    if !data.len().is_multiple_of(size) {
        return Err(node_error(
            vm,
            "RangeError",
            &format!("Buffer size must be a multiple of {}-bits", size * 8),
            "ERR_INVALID_BUFFER_SIZE",
        ));
    }
    for chunk in data.chunks_mut(size) {
        chunk.reverse();
    }
    let b = bytes_ref(vm, id);
    for (i, v) in data.into_iter().enumerate() {
        b.put(i, v);
    }
    Ok(this)
}

fn b_swap16(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    swap(vm, this, 2)
}
fn b_swap32(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    swap(vm, this, 4)
}
fn b_swap64(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    swap(vm, this, 8)
}

#[derive(Clone, Copy)]
enum Num {
    U,
    I,
    F,
}

/// Name, write?, kind, byte width (0: from the byteLength argument), little-endian.
const NUMERIC: [(&str, bool, Num, usize, bool); 46] = [
    ("readUInt8", false, Num::U, 1, true),
    ("readUint8", false, Num::U, 1, true),
    ("readInt8", false, Num::I, 1, true),
    ("readUInt16LE", false, Num::U, 2, true),
    ("readUint16LE", false, Num::U, 2, true),
    ("readUInt16BE", false, Num::U, 2, false),
    ("readUint16BE", false, Num::U, 2, false),
    ("readInt16LE", false, Num::I, 2, true),
    ("readInt16BE", false, Num::I, 2, false),
    ("readUInt32LE", false, Num::U, 4, true),
    ("readUint32LE", false, Num::U, 4, true),
    ("readUInt32BE", false, Num::U, 4, false),
    ("readUint32BE", false, Num::U, 4, false),
    ("readInt32LE", false, Num::I, 4, true),
    ("readInt32BE", false, Num::I, 4, false),
    ("readFloatLE", false, Num::F, 4, true),
    ("readFloatBE", false, Num::F, 4, false),
    ("readDoubleLE", false, Num::F, 8, true),
    ("readDoubleBE", false, Num::F, 8, false),
    ("readUIntLE", false, Num::U, 0, true),
    ("readUIntBE", false, Num::U, 0, false),
    ("readIntLE", false, Num::I, 0, true),
    ("readIntBE", false, Num::I, 0, false),
    ("writeUInt8", true, Num::U, 1, true),
    ("writeUint8", true, Num::U, 1, true),
    ("writeInt8", true, Num::I, 1, true),
    ("writeUInt16LE", true, Num::U, 2, true),
    ("writeUint16LE", true, Num::U, 2, true),
    ("writeUInt16BE", true, Num::U, 2, false),
    ("writeUint16BE", true, Num::U, 2, false),
    ("writeInt16LE", true, Num::I, 2, true),
    ("writeInt16BE", true, Num::I, 2, false),
    ("writeUInt32LE", true, Num::U, 4, true),
    ("writeUint32LE", true, Num::U, 4, true),
    ("writeUInt32BE", true, Num::U, 4, false),
    ("writeUint32BE", true, Num::U, 4, false),
    ("writeInt32LE", true, Num::I, 4, true),
    ("writeInt32BE", true, Num::I, 4, false),
    ("writeFloatLE", true, Num::F, 4, true),
    ("writeFloatBE", true, Num::F, 4, false),
    ("writeDoubleLE", true, Num::F, 8, true),
    ("writeDoubleBE", true, Num::F, 8, false),
    ("writeUIntLE", true, Num::U, 0, true),
    ("writeUIntBE", true, Num::U, 0, false),
    ("writeIntLE", true, Num::I, 0, true),
    ("writeIntBE", true, Num::I, 0, false),
];

fn offset_arg(vm: &mut Vm, v: &Value, len: usize, width: usize) -> Result<usize, Value> {
    let n = match v {
        Value::Undef => 0.0,
        Value::Num(n) => *n,
        v => {
            let d = received(vm, v);
            return Err(node_error(
                vm,
                "TypeError",
                &format!("The \"offset\" argument must be of type number. Received {d}"),
                "ERR_INVALID_ARG_TYPE",
            ));
        }
    };
    if n.fract() != 0.0 || !n.is_finite() {
        return Err(node_error(
            vm,
            "RangeError",
            &format!(
                "The value of \"offset\" is out of range. It must be an integer. Received {}",
                num_to_string(n)
            ),
            "ERR_OUT_OF_RANGE",
        ));
    }
    if len < width {
        return Err(node_error(
            vm,
            "RangeError",
            "Attempt to access memory outside buffer bounds",
            "ERR_BUFFER_OUT_OF_BOUNDS",
        ));
    }
    if n < 0.0 || n > (len - width) as f64 {
        return Err(node_error(
            vm,
            "RangeError",
            &format!(
                "The value of \"offset\" is out of range. It must be >= 0 and <= {}. Received {}",
                len - width,
                num_to_string(n)
            ),
            "ERR_OUT_OF_RANGE",
        ));
    }
    Ok(n as usize)
}

fn b_numeric(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let which = match vm.native_data(callee) {
        Value::Num(n) => n as usize,
        _ => 0,
    };
    let (name, write, kind, fixed, le) = NUMERIC[which];
    let id = this_buf(vm, &this, name)?;
    let len = bytes_ref(vm, id).len;
    let (value, offset_v, width_v) = if write {
        (arg(args, 0), arg(args, 1), arg(args, 2))
    } else {
        (Value::Undef, arg(args, 0), arg(args, 1))
    };
    let width = if fixed > 0 {
        fixed
    } else {
        match width_v {
            Value::Num(n) if (1.0..=6.0).contains(&n) && n.fract() == 0.0 => n as usize,
            v => {
                let shown = match v {
                    Value::Num(n) => num_to_string(n),
                    _ => describe_value(vm, &v),
                };
                return Err(node_error(
                    vm,
                    "RangeError",
                    &format!(
                        "The value of \"byteLength\" is out of range. It must be >= 1 and <= 6. Received {shown}"
                    ),
                    "ERR_OUT_OF_RANGE",
                ));
            }
        }
    };
    let offset = offset_arg(vm, &offset_v, len, width)?;
    let b = bytes_ref(vm, id);
    if !write {
        let mut raw: Vec<u8> = (0..width).map(|i| b.get(offset + i).unwrap_or(0)).collect();
        if !le {
            raw.reverse();
        }
        let v = match kind {
            Num::F if width == 4 => f32::from_le_bytes([raw[0], raw[1], raw[2], raw[3]]) as f64,
            Num::F => {
                let mut a = [0u8; 8];
                a.copy_from_slice(&raw);
                f64::from_le_bytes(a)
            }
            Num::U => raw.iter().rev().fold(0u64, |acc, x| acc << 8 | *x as u64) as f64,
            Num::I => {
                let u = raw.iter().rev().fold(0u64, |acc, x| acc << 8 | *x as u64);
                let bits = width * 8;
                let sign = 1u64 << (bits - 1);
                if u & sign != 0 {
                    u as f64 - (1u64 << bits) as f64
                } else {
                    u as f64
                }
            }
        };
        return Ok(Value::Num(v));
    }
    let x = vm.number_of(&value)?;
    let raw: Vec<u8> = match kind {
        Num::F if width == 4 => (x as f32).to_le_bytes().to_vec(),
        Num::F => x.to_le_bytes().to_vec(),
        Num::U | Num::I => {
            let bits = width as i32 * 8;
            let (min, max) = match kind {
                Num::U => (0.0, 2f64.powi(bits) - 1.0),
                _ => (-(2f64.powi(bits - 1)), 2f64.powi(bits - 1) - 1.0),
            };
            if !(x >= min && x <= max) {
                let range = if width > 4 {
                    let p = bits;
                    match kind {
                        Num::U => format!(">= 0 and < 2 ** {p}"),
                        _ => format!(">= -(2 ** {}) and < 2 ** {}", p - 1, p - 1),
                    }
                } else {
                    format!(">= {} and <= {}", num_to_string(min), num_to_string(max))
                };
                return Err(node_error(
                    vm,
                    "RangeError",
                    &format!(
                        "The value of \"value\" is out of range. It must be {range}. Received {}",
                        num_to_string(x)
                    ),
                    "ERR_OUT_OF_RANGE",
                ));
            }
            let v = x.trunc() as i64 as u64;
            (0..width).map(|i| (v >> (8 * i)) as u8).collect()
        }
    };
    let b = bytes_ref(vm, id);
    for i in 0..width {
        let byte = raw[if le { i } else { width - 1 - i }];
        b.put(offset + i, byte);
    }
    Ok(Value::Num((offset + width) as f64))
}
