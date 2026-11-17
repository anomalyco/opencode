//! encodeURI, encodeURIComponent, decodeURI and decodeURIComponent.

use super::arg;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

const URI_MARKS: &str = "-_.!~*'()";
const URI_RESERVED: &str = ";/?:@&=+$,";

pub fn setup(vm: &mut Vm) {
    for (name, f) in [
        ("encodeURI", encode_uri as crate::vm::NativeFn),
        ("encodeURIComponent", encode_uri_component),
        ("decodeURI", decode_uri),
        ("decodeURIComponent", decode_uri_component),
    ] {
        let v = vm.native_fn(name, 1, f, Value::Undef);
        vm.global(name, v);
    }
}

/// Percent-encodes `s` as UTF-8, or fails on a lone surrogate, which has no UTF-8 form.
fn encode(s: &str, keep: &str) -> Option<String> {
    let decoded;
    let s = if crate::strings::has_mark(s) {
        decoded = String::from_utf16(&crate::strings::units_of(s)).ok()?;
        &decoded
    } else {
        s
    };
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c.is_ascii_alphanumeric() || keep.contains(c) {
            out.push(c);
        } else {
            let mut buf = [0u8; 4];
            for b in c.encode_utf8(&mut buf).bytes() {
                out.push_str(&format!("%{b:02X}"));
            }
        }
    }
    Some(out)
}

fn hex(b: &[u8], i: usize) -> Option<u8> {
    if b.get(i) != Some(&b'%') {
        return None;
    }
    let h = (*b.get(i + 1)? as char).to_digit(16)?;
    let l = (*b.get(i + 2)? as char).to_digit(16)?;
    Some((h * 16 + l) as u8)
}

/// Decodes `%XX` escapes as UTF-8, leaving escapes of the `reserved` characters as they are.
fn decode(s: &str, reserved: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'%' {
            out.push(b[i]);
            i += 1;
            continue;
        }
        let lead = hex(b, i)?;
        if lead < 0x80 {
            if reserved.contains(lead as char) {
                out.extend_from_slice(&b[i..i + 3]);
            } else {
                out.push(lead);
            }
            i += 3;
            continue;
        }
        let n = match lead {
            0xc0..=0xdf => 2,
            0xe0..=0xef => 3,
            0xf0..=0xf7 => 4,
            _ => return None,
        };
        let mut seq = vec![lead];
        let mut j = i + 3;
        for _ in 1..n {
            let c = hex(b, j)?;
            if c & 0xc0 != 0x80 {
                return None;
            }
            seq.push(c);
            j += 3;
        }
        // from_utf8 rejects overlong forms, surrogates and code points above U+10FFFF, as the spec does.
        let ch = std::str::from_utf8(&seq).ok()?;
        out.extend_from_slice(ch.as_bytes());
        if ch == "\u{10FFFF}" {
            // The rest of the output is the input's text, so a decoded MARK is doubled to stay one.
            out.extend_from_slice(ch.as_bytes());
        }
        i = j;
    }
    String::from_utf8(out).ok()
}

fn input(vm: &mut Vm, args: &[Value]) -> Result<String, Value> {
    super::builtin_string(vm, &arg(args, 0))
}

fn run(vm: &mut Vm, args: &[Value], name: &str, f: impl Fn(&str) -> Option<String>) -> Res {
    let s = input(vm, args)?;
    match f(&s) {
        Some(out) => Ok(vm.string_val(out)),
        None => {
            let p = vm.realm.std.uri_error;
            let why = if name.starts_with("encode") {
                "String contained an illegal UTF-16 sequence."
            } else {
                "URI error"
            };
            Err(vm.failure(
                p,
                &format!("{name} received malformed URI data: {why}"),
                crate::DiagnosticKind::ExecutionFailure,
            ))
        }
    }
}

fn encode_uri(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let keep = format!("{URI_RESERVED}{URI_MARKS}#");
    run(vm, args, "encodeURI", |s| encode(s, &keep))
}

fn encode_uri_component(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    run(vm, args, "encodeURIComponent", |s| encode(s, URI_MARKS))
}

fn decode_uri(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let reserved = format!("{URI_RESERVED}#");
    run(vm, args, "decodeURI", |s| decode(s, &reserved))
}

fn decode_uri_component(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    run(vm, args, "decodeURIComponent", |s| decode(s, ""))
}
