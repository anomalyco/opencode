//! Uint8Array, TextEncoder, TextDecoder, atob and btoa.

use std::cell::RefCell;
use std::rc::Rc;

use super::{arg, describe_value, incompatible};
use crate::object::*;
use crate::ops::{MAX_ARRAY_LEN, MAX_STRING_LEN};
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

/// A Uint8Array: a view of `len` bytes at `start` in a buffer that subarrays share.
pub struct Bytes {
    pub buf: Rc<RefCell<Vec<u8>>>,
    pub start: usize,
    pub len: usize,
    /// A Node Buffer: text conversions default to UTF-8.
    pub buffer: bool,
}

impl Bytes {
    pub fn new(data: Vec<u8>, buffer: bool) -> Bytes {
        let len = data.len();
        Bytes {
            buf: Rc::new(RefCell::new(data)),
            start: 0,
            len,
            buffer,
        }
    }

    pub fn to_vec(&self) -> Vec<u8> {
        let b = self.buf.borrow();
        b[self.start..self.start + self.len].to_vec()
    }

    pub fn get(&self, i: usize) -> Option<u8> {
        if i < self.len {
            self.buf.borrow().get(self.start + i).copied()
        } else {
            None
        }
    }

    pub fn put(&self, i: usize, v: u8) {
        if i < self.len
            && let Some(slot) = self.buf.borrow_mut().get_mut(self.start + i)
        {
            *slot = v;
        }
    }

    pub fn view(&self, start: usize, end: usize, buffer: bool) -> Bytes {
        let end = end.max(start).min(self.len);
        let start = start.min(end);
        Bytes {
            buf: self.buf.clone(),
            start: self.start + start,
            len: end - start,
            buffer,
        }
    }
}

/// ToUint8: modulo 256, with NaN and infinities as 0.
pub fn to_u8(n: f64) -> u8 {
    if !n.is_finite() {
        return 0;
    }
    n.trunc().rem_euclid(256.0) as u8
}

pub fn new_bytes(vm: &mut Vm, data: Vec<u8>, buffer: bool) -> Value {
    super::ensure(vm, super::LAZY_BYTES);
    let proto = if buffer {
        vm.realm.std.buffer
    } else {
        vm.realm.std.uint8
    };
    Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::Bytes(Box::new(Bytes::new(data, buffer))),
    )))
}

pub fn view_value(vm: &mut Vm, b: Bytes) -> Value {
    let proto = if b.buffer {
        vm.realm.std.buffer
    } else {
        vm.realm.std.uint8
    };
    Value::Obj(vm.alloc(Obj::new(Some(proto), Kind::Bytes(Box::new(b)))))
}

pub fn as_bytes<'a>(vm: &'a Vm, v: &Value) -> Option<&'a Bytes> {
    match v {
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Bytes(b) => Some(b),
            _ => None,
        },
        _ => None,
    }
}

pub fn bytes_of(vm: &Vm, v: &Value) -> Option<Vec<u8>> {
    as_bytes(vm, v).map(Bytes::to_vec)
}

fn this_bytes(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && let Kind::Bytes(_) = vm.heap[*id as usize].kind
    {
        return Ok(*id);
    }
    Err(incompatible(
        vm,
        &format!("Uint8Array.prototype.{name}"),
        this,
    ))
}

pub fn bytes_ref<'a>(vm: &'a Vm, id: Id) -> &'a Bytes {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(b) => b,
        _ => unreachable!("checked by this_bytes"),
    }
}

fn len_of(vm: &Vm, id: Id) -> usize {
    bytes_ref(vm, id).len
}

// ---------- accessors ----------

pub fn get_prop(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    let b = bytes_ref(vm, id);
    if let Some(i) = vm.atoms.index(key) {
        return Some(match b.get(i as usize) {
            Some(v) => Value::Num(v as f64),
            None => Value::Undef,
        });
    }
    if key == vm.names.length {
        return Some(Value::Num(b.len as f64));
    }
    None
}

pub fn set_prop(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    if let Some(i) = vm.atoms.index(key) {
        return Some(
            super::builtin_number(vm, &val).map(|n| bytes_ref(vm, id).put(i as usize, to_u8(n))),
        );
    }
    if key == vm.names.length {
        return Some(Err(
            vm.type_error("Cannot assign to read only property 'length'.")
        ));
    }
    None
}

pub fn has_own(vm: &Vm, id: Id, key: Atom) -> bool {
    vm.atoms
        .index(key)
        .is_some_and(|i| (i as usize) < len_of(vm, id))
}

pub fn index_len(vm: &Vm, id: Id) -> usize {
    len_of(vm, id)
}

pub fn inspect(vm: &Vm, id: Id) -> String {
    let b = bytes_ref(vm, id);
    let data = b.to_vec();
    if b.buffer {
        let shown: Vec<String> = data.iter().take(50).map(|x| format!("{x:02x}")).collect();
        let more = if data.len() > 50 {
            format!(" ... {} more bytes", data.len() - 50)
        } else {
            String::new()
        };
        let shown = shown.join(" ");
        return format!(
            "<Buffer{}{more}>",
            if shown.is_empty() {
                String::new()
            } else {
                format!(" {shown}")
            }
        );
    }
    let list: Vec<String> = data.iter().map(u8::to_string).collect();
    format!("Uint8Array({}) [{}]", data.len(), list.join(","))
}

/// JSON form: index keys in `JSON.stringify`, and refused at the host boundary.
pub fn json_value(vm: &mut Vm, id: Id, boundary: bool) -> Res {
    if boundary {
        let p = vm.realm.type_error_proto;
        return Err(vm.failure(
            p,
            "A Uint8Array cannot cross to the host; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
            crate::DiagnosticKind::InvalidDataValue,
        ));
    }
    let data = bytes_ref(vm, id).to_vec();
    let o = vm.new_object();
    for (i, b) in data.iter().enumerate() {
        let k = vm.atoms.intern(&i.to_string());
        vm.define(o, k, Value::Num(*b as f64));
    }
    Ok(Value::Obj(o))
}

// ---------- base64 and hex ----------

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

pub fn base64_encode(data: &[u8], url: bool, pad: bool) -> String {
    let table = if url { B64URL } else { B64 };
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let n = (chunk[0] as u32) << 16
            | (chunk.get(1).copied().unwrap_or(0) as u32) << 8
            | chunk.get(2).copied().unwrap_or(0) as u32;
        out.push(table[(n >> 18) as usize & 63] as char);
        out.push(table[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(table[(n >> 6) as usize & 63] as char);
        } else if pad {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(table[n as usize & 63] as char);
        } else if pad {
            out.push('=');
        }
    }
    out
}

fn b64_value(c: char, url: Option<bool>) -> Option<u32> {
    Some(match c {
        'A'..='Z' => c as u32 - 'A' as u32,
        'a'..='z' => c as u32 - 'a' as u32 + 26,
        '0'..='9' => c as u32 - '0' as u32 + 52,
        '+' if url != Some(true) => 62,
        '/' if url != Some(true) => 63,
        '-' if url != Some(false) => 62,
        '_' if url != Some(false) => 63,
        _ => return None,
    })
}

/// Forgiving-base64 decode (WHATWG), as `atob` and `Uint8Array.fromBase64` read it.
pub fn base64_decode(text: &str) -> Option<Vec<u8>> {
    let mut s: Vec<char> = text
        .chars()
        .filter(|c| !matches!(c, ' ' | '\t' | '\n' | '\u{c}' | '\r'))
        .collect();
    if s.len().is_multiple_of(4) && s.last() == Some(&'=') {
        s.pop();
        if s.last() == Some(&'=') {
            s.pop();
        }
    }
    if s.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0;
    for c in s {
        let v = b64_value(c, Some(false))?;
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/// Lenient decode for Node's base64 and base64url: either alphabet, stopping at the first invalid character.
pub fn base64_decode_node(text: &str) -> Vec<u8> {
    let mut out = Vec::new();
    let mut acc = 0u32;
    let mut bits = 0;
    for c in text.chars() {
        if c == '=' {
            break;
        }
        let Some(v) = b64_value(c, None) else {
            if c.is_whitespace() {
                continue;
            }
            break;
        };
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    out
}

pub fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02x}")).collect()
}

fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) {
        return None;
    }
    let b = text.as_bytes();
    b.chunks(2)
        .map(|p| {
            let hi = (p[0] as char).to_digit(16)?;
            let lo = (p[1] as char).to_digit(16)?;
            Some((hi * 16 + lo) as u8)
        })
        .collect()
}

// ---------- Uint8Array ----------

pub fn setup(vm: &mut Vm) {
    let op = vm.realm.object_proto;
    let proto = vm.plain(op);
    vm.realm.std.uint8 = proto;
    super::accessors(vm, proto, &["length"]);
    let ctor = vm.ctor("Uint8Array", 3, uint8_ctor, proto, Value::Undef);
    vm.methods(
        ctor,
        &[
            ("from", 1, uint8_from),
            ("of", 0, uint8_of),
            ("fromBase64", 1, uint8_from_base64),
            ("fromHex", 1, uint8_from_hex),
        ],
    );
    vm.methods(
        proto,
        &[
            ("at", 1, u_at),
            ("slice", 2, u_slice),
            ("subarray", 2, u_subarray),
            ("set", 1, u_set),
            ("fill", 1, u_fill),
            ("reverse", 0, u_reverse),
            ("sort", 1, u_sort),
            ("indexOf", 1, u_index_of),
            ("lastIndexOf", 1, u_last_index_of),
            ("includes", 1, u_includes),
            ("join", 1, u_join),
            ("toString", 0, u_to_string),
            ("toBase64", 0, u_to_base64),
            ("toHex", 0, u_to_hex),
            ("keys", 0, u_keys),
            ("entries", 0, u_entries),
            ("forEach", 1, u_for_each),
            ("map", 1, u_map),
            ("filter", 1, u_filter),
            ("find", 1, u_find),
            ("findIndex", 1, u_find_index),
            ("findLast", 1, u_find_last),
            ("findLastIndex", 1, u_find_last_index),
            ("some", 1, u_some),
            ("every", 1, u_every),
            ("reduce", 1, u_reduce),
            ("reduceRight", 1, u_reduce_right),
        ],
    );
    let values = vm.method(proto, "values", 0, u_values);
    vm.define_hidden(proto, SYM_ITERATOR, values);

    let ep = vm.plain(op);
    vm.realm.std.text_encoder = ep;
    vm.ctor("TextEncoder", 0, encoder_ctor, ep, Value::Undef);
    vm.method(ep, "encode", 0, encoder_encode);
    let utf8 = vm.static_str("utf-8");
    let ek = vm.atoms.intern_static("encoding");
    vm.define_hidden(ep, ek, utf8);

    let dp = vm.plain(op);
    vm.realm.std.text_decoder = dp;
    super::accessors(vm, dp, &["encoding", "fatal", "ignoreBOM"]);
    vm.ctor("TextDecoder", 0, decoder_ctor, dp, Value::Undef);
    vm.method(dp, "decode", 0, decoder_decode);

    let atob = vm.native_fn("atob", 1, global_atob, Value::Undef);
    vm.global("atob", atob);
    let btoa = vm.native_fn("btoa", 1, global_btoa, Value::Undef);
    vm.global("btoa", btoa);
}

fn requires_new(vm: &mut Vm, this: &Value, name: &str) -> Result<(), Value> {
    if matches!(this, Value::Uninit) {
        Ok(())
    } else {
        Err(vm.type_error(&format!("Constructor {name} requires 'new'.")))
    }
}

fn is_iterable(vm: &mut Vm, v: &Value) -> bool {
    match v {
        Value::Obj(id) => {
            matches!(
                vm.heap[*id as usize].kind,
                Kind::Array(_) | Kind::Map(_) | Kind::Set(_) | Kind::Generator(_)
            ) || !matches!(vm.get_obj(*id, SYM_ITERATOR), Value::Undef | Value::Null)
        }
        Value::Str(_) => true,
        _ => false,
    }
}

/// The values a Uint8Array, array or iterable describes, each mapped (with the original values) then converted.
fn collect(
    vm: &mut Vm,
    source: &Value,
    name: &str,
    mapper: Option<(Value, Value)>,
) -> Result<Vec<u8>, Value> {
    if let (Some(b), None) = (bytes_of(vm, source), &mapper) {
        return Ok(b);
    }
    if !is_iterable(vm, source) {
        let d = describe_value(vm, source);
        return Err(vm.type_error(&format!(
            "{name} expects a Uint8Array, an array, or an iterable of numbers, received {d}."
        )));
    }
    let mut values = vm.iterate_to_vec(source)?;
    if let Some((f, this_arg)) = mapper {
        for (i, v) in values.iter_mut().enumerate() {
            *v = vm.call(&f, this_arg, &[*v, Value::Num(i as f64)])?;
        }
    }
    let mut out = Vec::with_capacity(values.len());
    for v in values {
        out.push(to_u8(super::builtin_number(vm, &v)?));
    }
    Ok(out)
}

fn uint8_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "Uint8Array")?;
    let source = arg(args, 0);
    if let Value::Obj(_) = source {
        let data = collect(vm, &source, "new Uint8Array(...)", None)?;
        return Ok(new_bytes(vm, data, false));
    }
    let n = match source {
        Value::Undef => 0.0,
        v => super::builtin_number(vm, &v)?,
    };
    if n.fract() != 0.0 || !n.is_finite() || n < 0.0 {
        let s = vm.string_of(&source)?;
        let s = vm.text(s).to_owned();
        return Err(vm.range_error(&format!("Invalid typed array length: {s}")));
    }
    if n > MAX_ARRAY_LEN as f64 {
        return Err(vm.range_error("Invalid array length"));
    }
    Ok(new_bytes(vm, vec![0; n as usize], false))
}

fn optional_callback(vm: &mut Vm, f: &Value, name: &str) -> Result<Option<Value>, Value> {
    if let Value::Undef = f {
        return Ok(None);
    }
    super::require_callback(vm, f, name).map(Some)
}

fn uint8_from(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mapper = optional_callback(vm, &arg(args, 1), "Uint8Array.from")?;
    let data = collect(
        vm,
        &arg(args, 0),
        "Uint8Array.from",
        mapper.map(|f| (f, arg(args, 2))),
    )?;
    Ok(new_bytes(vm, data, false))
}

fn uint8_of(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut data = Vec::with_capacity(args.len());
    for a in args {
        data.push(to_u8(super::builtin_number(vm, a)?));
    }
    Ok(new_bytes(vm, data, false))
}

fn uint8_from_base64(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let Value::Str(s) = arg(args, 0) else {
        return Err(vm.type_error("Uint8Array.fromBase64 expects a string."));
    };
    match base64_decode(vm.text(s)) {
        Some(d) => Ok(new_bytes(vm, d, false)),
        None => Err(vm.syntax_error("Uint8Array.fromBase64: the string is not valid base64.")),
    }
}

fn uint8_from_hex(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let Value::Str(s) = arg(args, 0) else {
        return Err(vm.type_error("Uint8Array.fromHex expects a string."));
    };
    match hex_decode(vm.text(s)) {
        Some(d) => Ok(new_bytes(vm, d, false)),
        None => Err(vm.syntax_error("Uint8Array.fromHex: the string is not valid hex.")),
    }
}

/// A relative index (negative counts from the end), clamped to `0..=len`; `undefined` is `default`.
pub fn rel_index(vm: &mut Vm, v: &Value, len: usize, default: usize) -> Result<usize, Value> {
    if let Value::Undef = v {
        return Ok(default);
    }
    let n = super::builtin_integer(vm, v)?;
    Ok(if n < 0.0 {
        (len as f64 + n).max(0.0) as usize
    } else {
        n.min(len as f64) as usize
    })
}

fn u_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "at")?;
    let len = len_of(vm, id) as f64;
    let mut i = super::builtin_integer(vm, &arg(args, 0))?;
    if i < 0.0 {
        i += len;
    }
    if i < 0.0 || i >= len {
        return Ok(Value::Undef);
    }
    Ok(match bytes_ref(vm, id).get(i as usize) {
        Some(b) => Value::Num(b as f64),
        None => Value::Undef,
    })
}

fn range(vm: &mut Vm, id: Id, args: &[Value]) -> Result<(usize, usize), Value> {
    let len = len_of(vm, id);
    let start = rel_index(vm, &arg(args, 0), len, 0)?;
    let end = rel_index(vm, &arg(args, 1), len, len)?;
    Ok((start, end.max(start)))
}

fn u_slice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "slice")?;
    let (s, e) = range(vm, id, args)?;
    let data = bytes_ref(vm, id).view(s, e, false).to_vec();
    Ok(new_bytes(vm, data, false))
}

fn u_subarray(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "subarray")?;
    let (s, e) = range(vm, id, args)?;
    let v = bytes_ref(vm, id).view(s, e, false);
    Ok(view_value(vm, v))
}

fn u_set(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "set")?;
    let data = collect(vm, &arg(args, 0), "Uint8Array.set", None)?;
    let offset = match arg(args, 1) {
        Value::Undef => 0.0,
        v => super::builtin_integer(vm, &v)?,
    };
    let len = len_of(vm, id);
    if offset < 0.0 || data.len() as f64 + offset > len as f64 {
        return Err(vm.range_error("Uint8Array.set: the source does not fit at that offset."));
    }
    let b = bytes_ref(vm, id);
    for (i, v) in data.iter().enumerate() {
        b.put(offset as usize + i, *v);
    }
    Ok(Value::Undef)
}

fn u_fill(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "fill")?;
    let v = to_u8(super::builtin_number(vm, &arg(args, 0))?);
    let len = len_of(vm, id);
    let s = rel_index(vm, &arg(args, 1), len, 0)?;
    let e = rel_index(vm, &arg(args, 2), len, len)?;
    let b = bytes_ref(vm, id);
    for i in s..e {
        b.put(i, v);
    }
    Ok(this)
}

fn u_reverse(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "reverse")?;
    let b = bytes_ref(vm, id);
    let mut data = b.to_vec();
    data.reverse();
    for (i, v) in data.into_iter().enumerate() {
        b.put(i, v);
    }
    Ok(this)
}

fn u_sort(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "sort")?;
    let cmp = arg(args, 0);
    let mut data = bytes_ref(vm, id).to_vec();
    if let Value::Undef = cmp {
        data.sort_unstable();
    } else {
        let list: Vec<Value> = data.iter().map(|b| Value::Num(*b as f64)).collect();
        let sorted = super::array::sort_values(vm, list, &cmp, "Uint8Array.sort")?;
        data = sorted
            .iter()
            .map(|v| match v {
                Value::Num(n) => to_u8(*n),
                _ => 0,
            })
            .collect();
    }
    let b = bytes_ref(vm, id);
    for (i, v) in data.into_iter().enumerate() {
        b.put(i, v);
    }
    Ok(this)
}

/// A search value: only numbers can equal a byte.
fn search_value(v: &Value) -> f64 {
    match v {
        Value::Num(n) => *n,
        _ => f64::NAN,
    }
}

fn u_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "indexOf")?;
    let x = search_value(&arg(args, 0));
    let len = len_of(vm, id);
    let from = rel_index(vm, &arg(args, 1), len, 0)?;
    let data = bytes_ref(vm, id).to_vec();
    Ok(Value::Num(
        (from..len)
            .find(|i| data[*i] as f64 == x)
            .map(|i| i as f64)
            .unwrap_or(-1.0),
    ))
}

fn u_last_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "lastIndexOf")?;
    let x = search_value(&arg(args, 0));
    let len = len_of(vm, id) as f64;
    let from = if args.len() < 2 {
        len - 1.0
    } else {
        let n = super::builtin_integer(vm, &args[1])?;
        if n < 0.0 { len + n } else { n.min(len - 1.0) }
    };
    let data = bytes_ref(vm, id).to_vec();
    if from < 0.0 {
        return Ok(Value::Num(-1.0));
    }
    Ok(Value::Num(
        (0..=from as usize)
            .rev()
            .find(|i| data[*i] as f64 == x)
            .map(|i| i as f64)
            .unwrap_or(-1.0),
    ))
}

fn u_includes(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "includes")?;
    let x = search_value(&arg(args, 0));
    let len = len_of(vm, id);
    let from = rel_index(vm, &arg(args, 1), len, 0)?;
    let data = bytes_ref(vm, id).to_vec();
    Ok(Value::Bool((from..len).any(|i| data[i] as f64 == x)))
}

fn join_bytes(data: &[u8], sep: &str) -> String {
    let parts: Vec<String> = data.iter().map(u8::to_string).collect();
    parts.join(sep)
}

fn u_join(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "join")?;
    let sep = match arg(args, 0) {
        Value::Undef => ",".to_owned(),
        v => {
            let s = vm.string_of(&v)?;
            vm.text(s).to_owned()
        }
    };
    let out = join_bytes(&bytes_ref(vm, id).to_vec(), &sep);
    if out.len() > MAX_STRING_LEN {
        return Err(vm.range_error("Invalid string length"));
    }
    Ok(vm.string_val(out))
}

fn u_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "toString")?;
    let out = join_bytes(&bytes_ref(vm, id).to_vec(), ",");
    Ok(vm.string_val(out))
}

fn u_to_base64(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "toBase64")?;
    let out = base64_encode(&bytes_ref(vm, id).to_vec(), false, true);
    Ok(vm.string_val(out))
}

fn u_to_hex(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_bytes(vm, &this, "toHex")?;
    let out = hex_encode(&bytes_ref(vm, id).to_vec());
    Ok(vm.string_val(out))
}

fn u_iter(vm: &mut Vm, this: &Value, name: &str, kind: IterKind) -> Res {
    let id = this_bytes(vm, this, name)?;
    Ok(super::iterator::exotic_iter(vm, id, kind))
}

fn u_keys(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    u_iter(vm, &this, "keys", IterKind::Keys)
}

fn u_values(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    u_iter(vm, &this, "values", IterKind::Values)
}

fn u_entries(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    u_iter(vm, &this, "entries", IterKind::Entries)
}

/// One step of a live iterator over bytes.
pub fn iter_step(vm: &mut Vm, target: Id, pos: usize, kind: IterKind) -> Option<Value> {
    let b = bytes_ref(vm, target).get(pos)?;
    Some(match kind {
        IterKind::Keys => Value::Num(pos as f64),
        IterKind::Values => Value::Num(b as f64),
        IterKind::Entries => vm.new_array(vec![Value::Num(pos as f64), Value::Num(b as f64)]),
    })
}

fn byte_at(vm: &Vm, id: Id, i: usize) -> Value {
    match bytes_ref(vm, id).get(i) {
        Some(b) => Value::Num(b as f64),
        None => Value::Undef,
    }
}

/// Calls `f(byte, index, bytes)` over the length fixed at the start, in order or reversed, until `stop`.
fn walk(
    vm: &mut Vm,
    this: &Value,
    args: &[Value],
    name: &str,
    reverse: bool,
    stop: &mut dyn FnMut(&mut Vm, usize, Value, Value) -> Option<Value>,
) -> Result<Option<Value>, Value> {
    let id = this_bytes(vm, this, name)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Uint8Array.{name}"))?;
    let this_arg = arg(args, 1);
    let len = len_of(vm, id);
    for k in 0..len {
        let i = if reverse { len - 1 - k } else { k };
        let item = byte_at(vm, id, i);
        let r = vm.call(&f, this_arg, &[item, Value::Num(i as f64), *this])?;
        if let Some(v) = stop(vm, i, item, r) {
            return Ok(Some(v));
        }
    }
    Ok(None)
}

fn u_for_each(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    walk(vm, &this, args, "forEach", false, &mut |_, _, _, _| None)?;
    Ok(Value::Undef)
}

fn u_map(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let mut out = Vec::new();
    let mut err = None;
    walk(vm, &this, args, "map", false, &mut |vm, _, _, r| {
        match super::builtin_number(vm, &r) {
            Ok(n) => out.push(to_u8(n)),
            Err(e) => err = Some(e),
        }
        None
    })?;
    if let Some(e) = err {
        return Err(e);
    }
    Ok(new_bytes(vm, out, false))
}

fn u_filter(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let mut out = Vec::new();
    walk(vm, &this, args, "filter", false, &mut |vm, _, item, r| {
        if vm.truthy(&r)
            && let Value::Num(n) = item
        {
            out.push(n as u8);
        }
        None
    })?;
    Ok(new_bytes(vm, out, false))
}

fn find_in(vm: &mut Vm, this: Value, args: &[Value], name: &str, last: bool, index: bool) -> Res {
    let r = walk(vm, &this, args, name, last, &mut |vm, i, item, r| {
        if vm.truthy(&r) {
            Some(if index { Value::Num(i as f64) } else { item })
        } else {
            None
        }
    })?;
    Ok(r.unwrap_or(if index {
        Value::Num(-1.0)
    } else {
        Value::Undef
    }))
}

fn u_find(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    find_in(vm, this, args, "find", false, false)
}

fn u_find_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    find_in(vm, this, args, "findIndex", false, true)
}

fn u_find_last(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    find_in(vm, this, args, "findLast", true, false)
}

fn u_find_last_index(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    find_in(vm, this, args, "findLastIndex", true, true)
}

fn u_some(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = walk(vm, &this, args, "some", false, &mut |vm, _, _, r| {
        vm.truthy(&r).then_some(Value::Bool(true))
    })?;
    Ok(r.unwrap_or(Value::Bool(false)))
}

fn u_every(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let r = walk(vm, &this, args, "every", false, &mut |vm, _, _, r| {
        (!vm.truthy(&r)).then_some(Value::Bool(false))
    })?;
    Ok(r.unwrap_or(Value::Bool(true)))
}

fn reduce(vm: &mut Vm, this: Value, args: &[Value], right: bool) -> Res {
    let name = if right { "reduceRight" } else { "reduce" };
    let id = this_bytes(vm, &this, name)?;
    let f = super::require_callback(vm, &arg(args, 0), &format!("Uint8Array.{name}"))?;
    let len = len_of(vm, id);
    let order: Vec<usize> = if right {
        (0..len).rev().collect()
    } else {
        (0..len).collect()
    };
    let mut iter = order.into_iter();
    let mut acc = if args.len() > 1 {
        args[1]
    } else {
        match iter.next() {
            Some(i) => byte_at(vm, id, i),
            None => {
                return Err(vm.type_error(&format!(
                    "Uint8Array.{name} of an empty array with no initial value."
                )));
            }
        }
    };
    for i in iter {
        let item = byte_at(vm, id, i);
        acc = vm.call(&f, Value::Undef, &[acc, item, Value::Num(i as f64), this])?;
    }
    Ok(acc)
}

fn u_reduce(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, false)
}

fn u_reduce_right(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    reduce(vm, this, args, true)
}

// ---------- TextEncoder and TextDecoder ----------

pub struct Decoder {
    pub fatal: bool,
    pub ignore_bom: bool,
    pub(crate) queued: Vec<u8>,
    pub(crate) seen: bool,
}

fn encoder_ctor(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "TextEncoder")?;
    let proto = vm.realm.std.text_encoder;
    Ok(Value::Obj(vm.alloc(Obj::new(Some(proto), Kind::Ordinary))))
}

fn encoder_encode(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let s = match arg(args, 0) {
        Value::Undef => String::new(),
        v => {
            let s = vm.string_of(&v)?;
            vm.text(s).to_owned()
        }
    };
    Ok(new_bytes(vm, s.into_bytes(), false))
}

const UTF8_LABELS: [&str; 6] = [
    "unicode-1-1-utf-8",
    "unicode11utf8",
    "unicode20utf8",
    "utf-8",
    "utf8",
    "x-unicode20utf8",
];

fn decoder_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    requires_new(vm, &this, "TextDecoder")?;
    let label = match arg(args, 0) {
        Value::Undef => "utf-8".to_owned(),
        v => {
            let s = vm.string_of(&v)?;
            vm.text(s)
                .trim_matches(|c: char| c.is_ascii_whitespace())
                .to_lowercase()
        }
    };
    if !UTF8_LABELS.contains(&label.as_str()) {
        return Err(vm.range_error(&format!(
            "The \"{label}\" encoding is not supported; only UTF-8 is."
        )));
    }
    let mut flag = |name: &'static str| -> bool {
        match arg(args, 1) {
            Value::Obj(o) => {
                let k = vm.atoms.intern_static(name);
                let v = vm.get_obj(o, k);
                vm.truthy(&v)
            }
            _ => false,
        }
    };
    let fatal = flag("fatal");
    let ignore_bom = flag("ignoreBOM");
    let proto = vm.realm.std.text_decoder;
    let d = Decoder {
        fatal,
        ignore_bom,
        queued: Vec::new(),
        seen: false,
    };
    Ok(Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::TextDecoder(Box::new(d)),
    ))))
}

pub fn decoder_prop(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    let Kind::TextDecoder(d) = &vm.heap[id as usize].kind else {
        return None;
    };
    let (fatal, ignore) = (d.fatal, d.ignore_bom);
    match vm.atoms.text(key) {
        "encoding" => Some(vm.static_str("utf-8")),
        "fatal" => Some(Value::Bool(fatal)),
        "ignoreBOM" => Some(Value::Bool(ignore)),
        _ => None,
    }
}

/// Where a streamed chunk can be decoded up to: before an incomplete trailing sequence, or after the first error
/// in fatal mode.
fn stream_boundary(bytes: &[u8], fatal: bool) -> (usize, bool) {
    let mut next = if fatal {
        0
    } else {
        bytes.len().saturating_sub(3)
    };
    while next < bytes.len() {
        let start = next;
        let lead = bytes[next];
        next += 1;
        if lead < 0x80 {
            continue;
        }
        if !(0xc2..=0xf4).contains(&lead) {
            if fatal {
                return (next, true);
            }
            continue;
        }
        let width = if lead < 0xe0 {
            2
        } else if lead < 0xf0 {
            3
        } else {
            4
        };
        let mut lower = match lead {
            0xe0 => 0xa0,
            0xf0 => 0x90,
            _ => 0x80,
        };
        let mut upper = match lead {
            0xed => 0x9f,
            0xf4 => 0x8f,
            _ => 0xbf,
        };
        while next < start + width {
            if next == bytes.len() {
                return (start, false);
            }
            let b = bytes[next];
            if b < lower || b > upper {
                if fatal {
                    return (next, true);
                }
                break;
            }
            next += 1;
            lower = 0x80;
            upper = 0xbf;
        }
    }
    (next, false)
}

fn decoder_decode(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = match this {
        Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::TextDecoder(_)) => id,
        _ => return Err(incompatible(vm, "TextDecoder.prototype.decode", &this)),
    };
    let input = arg(args, 0);
    let chunk = match input {
        Value::Undef => Vec::new(),
        v => match bytes_of(vm, &v) {
            Some(b) => b,
            None => {
                let d = describe_value(vm, &v);
                return Err(vm.type_error(&format!(
                    "TextDecoder.decode expects a Uint8Array, received {d}."
                )));
            }
        },
    };
    let stream = match arg(args, 1) {
        Value::Undef => false,
        Value::Obj(o) => {
            let k = vm.atoms.intern_static("stream");
            let v = vm.get_obj(o, k);
            vm.truthy(&v)
        }
        Value::Null => false,
        _ => return Err(vm.type_error("TextDecoder.decode expects an options object.")),
    };
    let Kind::TextDecoder(d) = &mut vm.heap[id as usize].kind else {
        return Ok(Value::Undef);
    };
    let mut bytes = std::mem::take(&mut d.queued);
    bytes.extend_from_slice(&chunk);
    let (end, error) = if stream {
        stream_boundary(&bytes, d.fatal)
    } else {
        (bytes.len(), false)
    };
    d.queued = bytes[end.min(bytes.len())..].to_vec();
    let strip = !d.ignore_bom && !d.seen;
    if !stream {
        d.seen = false;
    }
    let fatal = d.fatal;
    if error {
        return Err(vm.type_error("TextDecoder.decode: the input is not valid utf-8."));
    }
    let part = &bytes[..end.min(bytes.len())];
    let text = if fatal {
        match std::str::from_utf8(part) {
            Ok(s) => s.to_owned(),
            Err(_) => {
                return Err(vm.type_error("TextDecoder.decode: the input is not valid utf-8."));
            }
        }
    } else {
        String::from_utf8_lossy(part).into_owned()
    };
    if stream
        && !text.is_empty()
        && let Kind::TextDecoder(d) = &mut vm.heap[id as usize].kind
    {
        d.seen = true;
    }
    let text = match text.strip_prefix('\u{feff}') {
        Some(rest) if strip => rest.to_owned(),
        _ => text,
    };
    Ok(vm.string_val(text))
}

// ---------- atob and btoa ----------

fn global_atob(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        return Err(vm.type_error("atob requires 1 argument (a string)"));
    }
    let s = vm.string_of(&args[0])?;
    match base64_decode(vm.text(s)) {
        Some(d) => {
            let out: String = d.into_iter().map(char::from).collect();
            Ok(vm.string_val(out))
        }
        None => Err(vm.type_error("The string contains invalid characters.")),
    }
}

fn global_btoa(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        return Err(vm.type_error("btoa requires 1 argument (a string)"));
    }
    let s = vm.string_of(&args[0])?;
    let mut data = Vec::new();
    for c in vm.text(s).chars() {
        if c as u32 > 0xff {
            return Err(vm.type_error("The string contains invalid characters."));
        }
        data.push(c as u8);
    }
    let out = base64_encode(&data, false, true);
    Ok(vm.string_val(out))
}
