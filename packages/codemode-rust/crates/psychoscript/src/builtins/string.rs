//! String, Number and Math.

use super::{arg, to_index};
use crate::object::*;
use crate::ops::MAX_STRING_LEN;
use crate::strings::{StrId, StrRef};
use crate::value::{
    Id, Value, is_js_whitespace, num_to_fixed, num_to_radix, num_to_string, to_integer, to_uint32,
};
use crate::vm::{Res, Vm};

pub fn setup(vm: &mut Vm) {
    let sp = vm.realm.string_proto;
    let string = vm.ctor("String", 1, string_ctor, sp, Value::Undef);
    vm.methods(
        string,
        &[
            ("fromCharCode", 1, string_from_char_code),
            ("fromCodePoint", 1, string_from_code_point),
        ],
    );
    vm.methods(
        sp,
        &[
            ("charAt", 1, s_char_at),
            ("charCodeAt", 1, s_char_code_at),
            ("codePointAt", 1, s_code_point_at),
            ("at", 1, s_at),
            ("indexOf", 1, s_index_of),
            ("lastIndexOf", 1, s_last_index_of),
            ("includes", 1, s_includes),
            ("startsWith", 1, s_starts_with),
            ("endsWith", 1, s_ends_with),
            ("slice", 2, s_slice),
            ("substring", 2, s_substring),
            ("substr", 2, s_substr),
            ("toUpperCase", 0, s_to_upper),
            ("toLowerCase", 0, s_to_lower),
            ("toLocaleUpperCase", 0, s_to_upper),
            ("toLocaleLowerCase", 0, s_to_lower),
            ("trim", 0, s_trim),
            ("trimStart", 0, s_trim_start),
            ("trimEnd", 0, s_trim_end),
            ("trimLeft", 0, s_trim_start),
            ("trimRight", 0, s_trim_end),
            ("padStart", 2, s_pad_start),
            ("padEnd", 2, s_pad_end),
            ("repeat", 1, s_repeat),
            ("split", 2, s_split),
            ("replace", 2, s_replace),
            ("replaceAll", 2, s_replace_all),
            ("concat", 1, s_concat),
            ("toString", 0, s_to_string),
            ("valueOf", 0, s_to_string),
            ("localeCompare", 1, s_locale_compare),
            ("normalize", 0, s_to_string),
        ],
    );
    let iter = vm.native_fn("[Symbol.iterator]", 0, s_iterator, Value::Undef);
    vm.define_hidden(sp, SYM_ITERATOR, iter);

    let np = vm.realm.number_proto;
    let number = vm.ctor("Number", 1, number_ctor, np, Value::Undef);
    vm.methods(
        number,
        &[
            ("isInteger", 1, n_is_integer),
            ("isSafeInteger", 1, n_is_safe_integer),
            ("isFinite", 1, n_is_finite),
            ("isNaN", 1, n_is_nan),
            ("parseFloat", 1, super::object::global_parse_float),
            ("parseInt", 2, super::object::global_parse_int),
        ],
    );
    for (name, v) in [
        ("MAX_SAFE_INTEGER", 9007199254740991.0),
        ("MIN_SAFE_INTEGER", -9007199254740991.0),
        ("MAX_VALUE", f64::MAX),
        ("MIN_VALUE", 5e-324),
        ("EPSILON", f64::EPSILON),
        ("POSITIVE_INFINITY", f64::INFINITY),
        ("NEGATIVE_INFINITY", f64::NEG_INFINITY),
        ("NaN", f64::NAN),
    ] {
        vm.constant(number, name, Value::Num(v));
    }
    vm.methods(
        np,
        &[
            ("toFixed", 1, n_to_fixed),
            ("toString", 1, n_to_string),
            ("toPrecision", 1, n_to_precision),
            ("valueOf", 0, n_value_of),
            ("toLocaleString", 0, n_to_locale_string),
        ],
    );

    let math = vm.new_object();
    for (name, v) in [
        ("PI", std::f64::consts::PI),
        ("E", std::f64::consts::E),
        ("LN2", std::f64::consts::LN_2),
        ("LN10", std::f64::consts::LN_10),
        ("LOG2E", std::f64::consts::LOG2_E),
        ("LOG10E", std::f64::consts::LOG10_E),
        ("SQRT2", std::f64::consts::SQRT_2),
        ("SQRT1_2", std::f64::consts::FRAC_1_SQRT_2),
    ] {
        vm.constant(math, name, Value::Num(v));
    }
    vm.methods(
        math,
        &[
            ("floor", 1, m_floor),
            ("ceil", 1, m_ceil),
            ("round", 1, m_round),
            ("trunc", 1, m_trunc),
            ("sign", 1, m_sign),
            ("abs", 1, m_abs),
            ("sqrt", 1, m_sqrt),
            ("cbrt", 1, m_cbrt),
            ("exp", 1, m_exp),
            ("expm1", 1, m_expm1),
            ("log", 1, m_log),
            ("log2", 1, m_log2),
            ("log10", 1, m_log10),
            ("log1p", 1, m_log1p),
            ("sin", 1, m_sin),
            ("cos", 1, m_cos),
            ("tan", 1, m_tan),
            ("asin", 1, m_asin),
            ("acos", 1, m_acos),
            ("atan", 1, m_atan),
            ("sinh", 1, m_sinh),
            ("cosh", 1, m_cosh),
            ("tanh", 1, m_tanh),
            ("asinh", 1, m_asinh),
            ("acosh", 1, m_acosh),
            ("atanh", 1, m_atanh),
            ("fround", 1, m_fround),
            ("clz32", 1, m_clz32),
            ("atan2", 2, m_atan2),
            ("pow", 2, m_pow),
            ("imul", 2, m_imul),
            ("max", 2, m_max),
            ("min", 2, m_min),
            ("hypot", 2, m_hypot),
            ("random", 0, m_random),
        ],
    );
    vm.global("Math", Value::Obj(math));
}

fn this_str(vm: &mut Vm, this: &Value) -> Result<StrId, Value> {
    match this {
        Value::Str(s) => Ok(*s),
        Value::Undef | Value::Null => {
            Err(vm.type_error("String.prototype method called on null or undefined"))
        }
        v => vm.string_of(v),
    }
}

fn arg_str(vm: &mut Vm, args: &[Value], i: usize) -> Result<StrId, Value> {
    let v = arg(args, i);
    vm.string_of(&v)
}

fn string_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if let Value::Uninit = this {
        return Err(
            vm.type_error("String wrapper objects are not supported; call String(value) instead")
        );
    }
    if args.is_empty() {
        return Ok(vm.static_str(""));
    }
    match &args[0] {
        Value::Sym(_) => Ok(vm.static_str("Symbol(Symbol.iterator)")),
        v => Ok(Value::Str(vm.string_of(v)?)),
    }
}

fn string_from_char_code(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.len() == 1
        && let Value::Num(n) = args[0]
    {
        let c = (to_uint32(n) & 0xffff) as u16;
        return Ok(vm.char_str(c));
    }
    let mut units = Vec::with_capacity(args.len());
    for a in args {
        units.push((to_uint32(vm.number_of(a)?) & 0xffff) as u16);
    }
    Ok(vm.string_val(String::from_utf16_lossy(&units)))
}

fn string_from_code_point(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut out = String::new();
    for a in args {
        let n = vm.number_of(a)?;
        match char::from_u32(n as u32) {
            Some(c) if n.fract() == 0.0 && n >= 0.0 => out.push(c),
            _ => return Err(vm.range_error(&format!("Invalid code point {}", num_to_string(n)))),
        }
    }
    Ok(vm.string_val(out))
}

fn pos_arg(vm: &mut Vm, args: &[Value], i: usize) -> Result<f64, Value> {
    Ok(to_integer(vm.number_of(&arg(args, i))?))
}

fn s_char_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let i = pos_arg(vm, args, 0)?;
    let c = if i < 0.0 {
        None
    } else {
        vm.atoms.sref(s).code_unit(i as usize)
    };
    Ok(match c {
        Some(c) => vm.char_str(c),
        None => vm.static_str(""),
    })
}

fn s_char_code_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let i = pos_arg(vm, args, 0)?;
    if i < 0.0 {
        return Ok(Value::Num(f64::NAN));
    }
    Ok(Value::Num(
        vm.atoms
            .sref(s)
            .code_unit(i as usize)
            .map(|c| c as f64)
            .unwrap_or(f64::NAN),
    ))
}

fn s_code_point_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let i = pos_arg(vm, args, 0)?;
    let units = vm.atoms.sref(s).utf16();
    if i < 0.0 || i as usize >= units.len() {
        return Ok(Value::Undef);
    }
    let i = i as usize;
    let a = units[i];
    if (0xd800..0xdc00).contains(&a)
        && let Some(&b) = units.get(i + 1)
        && (0xdc00..0xe000).contains(&b)
    {
        return Ok(Value::Num(
            (((a as u32 - 0xd800) << 10) + (b as u32 - 0xdc00) + 0x10000) as f64,
        ));
    }
    Ok(Value::Num(a as f64))
}

fn s_at(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let len = vm.atoms.sref(s).len16() as f64;
    let mut i = pos_arg(vm, args, 0)?;
    if i < 0.0 {
        i += len;
    }
    if i < 0.0 || i >= len {
        return Ok(Value::Undef);
    }
    Ok(match vm.atoms.sref(s).code_unit(i as usize) {
        Some(c) => vm.char_str(c),
        None => Value::Undef,
    })
}

/// Finds `needle` in `hay` at or after code unit `from`, in code units.
fn find16(hay: StrRef, needle: StrRef, from: usize) -> Option<usize> {
    if hay.ascii && needle.ascii {
        if from > hay.s.len() {
            return None;
        }
        return hay.s[from..].find(needle.s).map(|i| i + from);
    }
    let h = hay.utf16();
    let n = needle.utf16();
    if n.is_empty() {
        return if from <= h.len() { Some(from) } else { None };
    }
    if n.len() > h.len() {
        return None;
    }
    (from..=h.len() - n.len()).find(|&i| h[i..i + n.len()] == n[..])
}

fn rfind16(hay: StrRef, needle: StrRef, from: usize) -> Option<usize> {
    let h = hay.utf16();
    let n = needle.utf16();
    if n.len() > h.len() {
        return None;
    }
    let start = from.min(h.len() - n.len());
    (0..=start).rev().find(|&i| h[i..i + n.len()] == n[..])
}

fn s_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = arg_str(vm, args, 0)?;
    let len = vm.atoms.sref(s).len16() as f64;
    let from = pos_arg(vm, args, 1)?.clamp(0.0, len) as usize;
    let r = find16(vm.atoms.sref(s), vm.atoms.sref(n), from);
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn s_last_index_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = arg_str(vm, args, 0)?;
    let pos = vm.number_of(&arg(args, 1))?;
    let from = if pos.is_nan() {
        usize::MAX
    } else {
        to_integer(pos).max(0.0) as usize
    };
    let r = rfind16(vm.atoms.sref(s), vm.atoms.sref(n), from);
    Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
}

fn s_includes(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = arg_str(vm, args, 0)?;
    let len = vm.atoms.sref(s).len16() as f64;
    let from = pos_arg(vm, args, 1)?.clamp(0.0, len) as usize;
    Ok(Value::Bool(
        find16(vm.atoms.sref(s), vm.atoms.sref(n), from).is_some(),
    ))
}

fn s_starts_with(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = arg_str(vm, args, 0)?;
    let len = vm.atoms.sref(s).len16() as f64;
    let from = pos_arg(vm, args, 1)?.clamp(0.0, len) as usize;
    let (h, n) = (vm.atoms.sref(s), vm.atoms.sref(n));
    if h.ascii && n.ascii {
        return Ok(Value::Bool(h.s[from..].starts_with(n.s)));
    }
    let (h, n) = (h.utf16(), n.utf16());
    Ok(Value::Bool(
        h.len() >= from + n.len() && h[from..from + n.len()] == n[..],
    ))
}

fn s_ends_with(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = arg_str(vm, args, 0)?;
    let len = vm.atoms.sref(s).len16();
    let end = match arg(args, 1) {
        Value::Undef => len,
        v => to_integer(vm.number_of(&v)?).clamp(0.0, len as f64) as usize,
    };
    let h = vm.atoms.sref(s).utf16();
    let n = vm.atoms.sref(n).utf16();
    Ok(Value::Bool(
        end >= n.len() && h[end - n.len()..end] == n[..],
    ))
}

fn s_slice(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let len = vm.atoms.sref(s).len16();
    let start = to_index(vm, &arg(args, 0), len, 0)?;
    let end = to_index(vm, &arg(args, 1), len, len)?;
    if start == 0 && end >= len {
        return Ok(Value::Str(s));
    }
    let out = vm.atoms.sref(s).slice16(start, end);
    Ok(vm.string_val(out))
}

fn s_substring(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let len = vm.atoms.sref(s).len16() as f64;
    let a = pos_arg(vm, args, 0)?.clamp(0.0, len) as usize;
    let b = match arg(args, 1) {
        Value::Undef => len as usize,
        v => to_integer(vm.number_of(&v)?).clamp(0.0, len) as usize,
    };
    let out = vm.atoms.sref(s).slice16(a.min(b), a.max(b));
    Ok(vm.string_val(out))
}

fn s_substr(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let len = vm.atoms.sref(s).len16();
    let start = to_index(vm, &arg(args, 0), len, 0)?;
    let count = match arg(args, 1) {
        Value::Undef => len,
        v => to_integer(vm.number_of(&v)?).max(0.0) as usize,
    };
    let out = vm.atoms.sref(s).slice16(start, start.saturating_add(count));
    Ok(vm.string_val(out))
}

fn map_text(vm: &mut Vm, this: &Value, f: fn(&str) -> String) -> Res {
    let s = this_str(vm, this)?;
    let out = f(vm.text(s));
    Ok(vm.string_val(out))
}

fn s_to_upper(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_text(vm, &this, str::to_uppercase)
}

fn s_to_lower(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_text(vm, &this, str::to_lowercase)
}

fn s_trim(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_text(vm, &this, |s| s.trim_matches(is_js_whitespace).to_owned())
}

fn s_trim_start(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_text(vm, &this, |s| {
        s.trim_start_matches(is_js_whitespace).to_owned()
    })
}

fn s_trim_end(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    map_text(vm, &this, |s| {
        s.trim_end_matches(is_js_whitespace).to_owned()
    })
}

fn pad(vm: &mut Vm, this: Value, args: &[Value], at_start: bool) -> Res {
    let s = this_str(vm, &this)?;
    let target = to_integer(vm.number_of(&arg(args, 0))?);
    let fill = match arg(args, 1) {
        Value::Undef => " ".to_owned(),
        v => {
            let f = vm.string_of(&v)?;
            vm.text(f).to_owned()
        }
    };
    let len = vm.atoms.sref(s).len16();
    if target <= len as f64 || fill.is_empty() {
        return Ok(Value::Str(s));
    }
    if target > MAX_STRING_LEN as f64 {
        return Err(vm.range_error("Invalid string length"));
    }
    let need = target as usize - len;
    let padding: Vec<u16> = fill.encode_utf16().cycle().take(need).collect();
    let padding = String::from_utf16_lossy(&padding);
    let out = if at_start {
        padding + vm.text(s)
    } else {
        vm.text(s).to_owned() + &padding
    };
    Ok(vm.string_val(out))
}

fn s_pad_start(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    pad(vm, this, args, true)
}

fn s_pad_end(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    pad(vm, this, args, false)
}

fn s_repeat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let n = to_integer(vm.number_of(&arg(args, 0))?);
    if n < 0.0 || n.is_infinite() {
        return Err(vm.range_error(&format!("Invalid count value: {}", num_to_string(n))));
    }
    if vm.text(s).len() as f64 * n > MAX_STRING_LEN as f64 {
        return Err(vm.range_error("Invalid string length"));
    }
    let out = vm.text(s).repeat(n as usize);
    Ok(vm.string_val(out))
}

fn s_split(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let limit = match arg(args, 1) {
        Value::Undef => u32::MAX as usize,
        v => to_uint32(vm.number_of(&v)?) as usize,
    };
    let sep = arg(args, 0);
    let parts: Vec<Value> = match sep {
        Value::Undef => vec![Value::Str(s)],
        _ => {
            let sep = vm.string_of(&sep)?;
            if vm.text(sep).is_empty() {
                let units = vm.atoms.sref(s).utf16();
                units.iter().take(limit).map(|c| vm.char_str(*c)).collect()
            } else {
                let pieces: Vec<String> = vm
                    .text(s)
                    .split(vm.text(sep))
                    .take(limit)
                    .map(str::to_owned)
                    .collect();
                pieces.into_iter().map(|p| vm.string_val(p)).collect()
            }
        }
    };
    Ok(vm.new_array(parts))
}

fn expand_replacement(template: &str, matched: &str, pos: usize, subject: &str) -> String {
    let mut out = String::new();
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '$' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('$') => {
                chars.next();
                out.push('$');
            }
            Some('&') => {
                chars.next();
                out.push_str(matched);
            }
            Some('`') => {
                chars.next();
                out.push_str(&subject[..pos]);
            }
            Some('\'') => {
                chars.next();
                out.push_str(&subject[pos + matched.len()..]);
            }
            _ => out.push('$'),
        }
    }
    out
}

fn replace(vm: &mut Vm, this: Value, args: &[Value], all: bool) -> Res {
    let s = this_str(vm, &this)?;
    let pat = arg_str(vm, args, 0)?;
    let rep = arg(args, 1);
    let callable = vm.is_callable(&rep);
    let template = if callable {
        None
    } else {
        let t = vm.string_of(&rep)?;
        Some(vm.text(t).to_owned())
    };
    let subject = vm.text(s).to_owned();
    let needle = vm.text(pat).to_owned();
    let mut positions = Vec::new();
    if needle.is_empty() {
        if all {
            positions.extend(subject.char_indices().map(|(i, _)| i));
            positions.push(subject.len());
        } else {
            positions.push(0);
        }
    } else {
        let mut from = 0;
        while let Some(i) = subject[from..].find(&needle) {
            positions.push(from + i);
            from += i + needle.len();
            if !all {
                break;
            }
        }
    }
    if positions.is_empty() {
        return Ok(Value::Str(s));
    }
    let mut out = String::new();
    let mut last = 0;
    for pos in positions {
        out.push_str(&subject[last..pos]);
        match &template {
            Some(t) => out.push_str(&expand_replacement(t, &needle, pos, &subject)),
            None => {
                let offset = subject[..pos].encode_utf16().count() as f64;
                let r = vm.call(
                    &rep,
                    Value::Undef,
                    &[Value::Str(pat), Value::Num(offset), Value::Str(s)],
                )?;
                let r = vm.string_of(&r)?;
                out.push_str(vm.text(r));
            }
        }
        last = pos + needle.len();
    }
    out.push_str(&subject[last..]);
    Ok(vm.string_val(out))
}

fn s_replace(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    replace(vm, this, args, false)
}

fn s_replace_all(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    replace(vm, this, args, true)
}

fn s_concat(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let mut out = vm.text(s).to_owned();
    for a in args {
        let t = vm.string_of(a)?;
        out.push_str(vm.text(t));
    }
    Ok(vm.string_val(out))
}

fn s_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    match this {
        Value::Str(s) => Ok(Value::Str(s)),
        _ => Err(vm.type_error("String.prototype.toString requires that 'this' be a String")),
    }
}

fn s_locale_compare(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    let o = arg_str(vm, args, 0)?;
    let (a, b) = (vm.text(s), vm.text(o));
    // Case-insensitive first, then lowercase before uppercase, like the default collation for plain text.
    let order = a.to_lowercase().cmp(&b.to_lowercase()).then_with(|| {
        a.chars()
            .zip(b.chars())
            .find(|(x, y)| x != y)
            .map(|(x, y)| y.is_lowercase().cmp(&x.is_lowercase()))
            .unwrap_or(a.len().cmp(&b.len()))
    });
    Ok(Value::Num(match order {
        std::cmp::Ordering::Less => -1.0,
        std::cmp::Ordering::Equal => 0.0,
        std::cmp::Ordering::Greater => 1.0,
    }))
}

fn s_iterator(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let s = this_str(vm, &this)?;
    vm.get_iterator(&Value::Str(s))
}

// ---------- Number ----------

fn number_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if let Value::Uninit = this {
        return Err(
            vm.type_error("Number wrapper objects are not supported; call Number(value) instead")
        );
    }
    if args.is_empty() {
        return Ok(Value::Num(0.0));
    }
    Ok(Value::Num(vm.number_of(&args[0])?))
}

fn num_arg(args: &[Value]) -> Option<f64> {
    match args.first() {
        Some(Value::Num(n)) => Some(*n),
        _ => None,
    }
}

fn n_is_integer(_vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        num_arg(args).is_some_and(|n| n.is_finite() && n.fract() == 0.0),
    ))
}

fn n_is_safe_integer(_vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(num_arg(args).is_some_and(|n| {
        n.fract() == 0.0 && n.abs() <= 9007199254740991.0
    })))
}

fn n_is_finite(_vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(num_arg(args).is_some_and(f64::is_finite)))
}

fn n_is_nan(_vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(num_arg(args).is_some_and(f64::is_nan)))
}

fn this_num(vm: &mut Vm, this: &Value) -> Result<f64, Value> {
    match this {
        Value::Num(n) => Ok(*n),
        _ => Err(vm.type_error("Number.prototype method called on an incompatible receiver")),
    }
}

fn n_to_fixed(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this)?;
    let d = to_integer(vm.number_of(&arg(args, 0))?);
    if !(0.0..=100.0).contains(&d) {
        return Err(vm.range_error("toFixed() digits argument must be between 0 and 100"));
    }
    if x.abs() >= 1e21 {
        return Ok(vm.string_val(num_to_string(x)));
    }
    Ok(vm.string_val(num_to_fixed(x, d as usize)))
}

fn n_to_string(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this)?;
    let radix = match arg(args, 0) {
        Value::Undef => 10.0,
        v => to_integer(vm.number_of(&v)?),
    };
    if !(2.0..=36.0).contains(&radix) {
        return Err(vm.range_error("toString() radix must be between 2 and 36"));
    }
    Ok(vm.string_val(if radix == 10.0 {
        num_to_string(x)
    } else {
        num_to_radix(x, radix as u32)
    }))
}

fn n_to_precision(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this)?;
    if let Value::Undef = arg(args, 0) {
        return Ok(vm.string_val(num_to_string(x)));
    }
    let p = to_integer(vm.number_of(&arg(args, 0))?);
    if !(1.0..=100.0).contains(&p) {
        return Err(vm.range_error("toPrecision() argument must be between 1 and 100"));
    }
    if !x.is_finite() || x == 0.0 {
        return Ok(vm.string_val(if x == 0.0 {
            num_to_fixed(0.0, p as usize - 1)
        } else {
            num_to_string(x)
        }));
    }
    let e = x.abs().log10().floor() as i32;
    let p = p as i32;
    if e < -6 || e >= p {
        let s = format!("{:.*e}", (p - 1) as usize, x);
        let (m, ex) = s.split_once('e').unwrap_or((&s, "0"));
        let ex: i32 = ex.parse().unwrap_or(0);
        return Ok(vm.string_val(format!(
            "{m}e{}{}",
            if ex < 0 { "-" } else { "+" },
            ex.abs()
        )));
    }
    Ok(vm.string_val(num_to_fixed(x, (p - 1 - e).max(0) as usize)))
}

fn n_value_of(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(Value::Num(this_num(vm, &this)?))
}

fn n_to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this)?;
    if !x.is_finite() {
        return Ok(vm.string_val(num_to_string(x)));
    }
    let fixed = num_to_fixed(x, 3);
    let fixed = fixed.trim_end_matches('0').trim_end_matches('.');
    let (int, frac) = fixed.split_once('.').unwrap_or((fixed, ""));
    let (sign, digits) = int.strip_prefix('-').map(|d| ("-", d)).unwrap_or(("", int));
    let mut grouped = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let out = if frac.is_empty() {
        format!("{sign}{grouped}")
    } else {
        format!("{sign}{grouped}.{frac}")
    };
    Ok(vm.string_val(out))
}

// ---------- Math ----------

fn n0(vm: &mut Vm, args: &[Value]) -> Result<f64, Value> {
    match args.first() {
        Some(Value::Num(n)) => Ok(*n),
        Some(v) => vm.number_of(v),
        None => Ok(f64::NAN),
    }
}

fn n1(vm: &mut Vm, args: &[Value]) -> Result<f64, Value> {
    match args.get(1) {
        Some(Value::Num(n)) => Ok(*n),
        Some(v) => vm.number_of(v),
        None => Ok(f64::NAN),
    }
}

macro_rules! math1 {
    ($name:ident, $f:expr) => {
        fn $name(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
            let x = n0(vm, args)?;
            let f: fn(f64) -> f64 = $f;
            Ok(Value::Num(f(x)))
        }
    };
}

math1!(m_floor, f64::floor);
math1!(m_ceil, f64::ceil);
math1!(m_trunc, f64::trunc);
math1!(m_abs, f64::abs);
math1!(m_sqrt, f64::sqrt);
math1!(m_cbrt, f64::cbrt);
math1!(m_exp, f64::exp);
math1!(m_expm1, f64::exp_m1);
math1!(m_log, f64::ln);
math1!(m_log2, f64::log2);
math1!(m_log10, f64::log10);
math1!(m_log1p, f64::ln_1p);
math1!(m_sin, f64::sin);
math1!(m_cos, f64::cos);
math1!(m_tan, f64::tan);
math1!(m_asin, f64::asin);
math1!(m_acos, f64::acos);
math1!(m_atan, f64::atan);
math1!(m_sinh, f64::sinh);
math1!(m_cosh, f64::cosh);
math1!(m_tanh, f64::tanh);
math1!(m_asinh, f64::asinh);
math1!(m_acosh, f64::acosh);
math1!(m_atanh, f64::atanh);
math1!(m_fround, |x| x as f32 as f64);
math1!(m_clz32, |x| to_uint32(x).leading_zeros() as f64);
math1!(m_sign, |x| if x.is_nan() || x == 0.0 {
    x
} else {
    x.signum()
});
math1!(m_round, |x| {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let r = x.floor();
    let v = if x - r >= 0.5 { r + 1.0 } else { r };
    if v == 0.0 && x < 0.0 { -0.0 } else { v }
});

fn m_atan2(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let (y, x) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(y.atan2(x)))
}

fn m_pow(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let (x, y) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(crate::vm::js_pow(x, y)))
}

fn m_imul(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let (x, y) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(
        (to_uint32(x) as i32).wrapping_mul(to_uint32(y) as i32) as f64,
    ))
}

fn m_max(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut r = f64::NEG_INFINITY;
    for a in args {
        let x = vm.number_of(a)?;
        if x.is_nan() || r.is_nan() {
            r = f64::NAN;
        } else if x > r || (x == 0.0 && r == 0.0 && !x.is_sign_negative()) {
            r = x;
        }
    }
    Ok(Value::Num(r))
}

fn m_min(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut r = f64::INFINITY;
    for a in args {
        let x = vm.number_of(a)?;
        if x.is_nan() || r.is_nan() {
            r = f64::NAN;
        } else if x < r || (x == 0.0 && r == 0.0 && x.is_sign_negative()) {
            r = x;
        }
    }
    Ok(Value::Num(r))
}

fn m_hypot(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut sum = 0.0;
    for a in args {
        let x = vm.number_of(a)?;
        if x.is_infinite() {
            return Ok(Value::Num(f64::INFINITY));
        }
        sum += x * x;
    }
    Ok(Value::Num(sum.sqrt()))
}

fn m_random(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    let mut x = vm.rng;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    vm.rng = x;
    Ok(Value::Num((x >> 11) as f64 / (1u64 << 53) as f64))
}
