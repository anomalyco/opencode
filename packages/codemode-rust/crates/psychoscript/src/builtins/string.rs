//! String, Number and Math.

use super::fuel::{self, Conversions};
use super::{arg, regexp, to_index};
use crate::object::*;
use crate::ops::{Hint, MAX_STRING_LEN};
use crate::strings::{StrId, StrRef};
use crate::value::{
    Id, Value, is_js_whitespace, num_to_fixed, num_to_string, to_integer, to_uint32,
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
            ("raw", 1, string_raw),
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
            ("normalize", 0, s_normalize),
            ("match", 1, s_match),
            ("matchAll", 1, s_match_all),
            ("search", 1, s_search),
            ("isWellFormed", 0, s_is_well_formed),
            ("toWellFormed", 0, s_to_well_formed),
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
            ("toExponential", 1, n_to_exponential),
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
            ("f16round", 1, m_f16round),
            ("sumPrecise", 1, m_sum_precise),
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

/// The receiver's text; null and undefined fail with the method's name, as the reference's `simple` does.
fn this_str(vm: &mut Vm, this: &Value, callee: Id) -> Result<StrId, Value> {
    match this {
        Value::Str(s) => Ok(*s),
        Value::Undef | Value::Null => {
            let name = match vm.heap[callee as usize].kind {
                Kind::Native { name, .. } => vm.atoms.text(name).to_owned(),
                _ => String::new(),
            };
            Err(vm.type_error(&format!(
                "String.prototype.{name} called on null or undefined."
            )))
        }
        v => vm.string_of(v),
    }
}

/// The reference's `simple` for a `String.prototype` method: the receiver (with the string hint) and the arguments
/// the method reads (`hints`, one each) are one list of conversions (see `fuel::Conversions`), after the receiver's
/// null check and before `body` runs on the receiver's text and the arguments.
fn simple(
    vm: &mut Vm,
    callee: Id,
    this: Value,
    args: &[Value],
    hints: &[Hint],
    body: impl FnOnce(&mut Vm, &mut Conversions, StrId, &[Value]) -> Res,
) -> Res {
    let n = hints.len().min(args.len());
    let mut c = Conversions::default();
    if !matches!(this, Value::Obj(_)) && !args[..n].iter().any(|v| matches!(v, Value::Obj(_))) {
        let s = this_str(vm, &this, callee)?;
        let r = body(vm, &mut c, s, args);
        return c.finish(vm, r);
    }
    if this.is_nullish() {
        this_str(vm, &this, callee)?;
    }
    let mut list = Vec::with_capacity(args.len() + 1);
    list.push(this);
    list.extend_from_slice(&args[..n]);
    let mut kinds = Vec::with_capacity(n + 1);
    kinds.push(Hint::String);
    kinds.extend_from_slice(&hints[..n]);
    c.convert(vm, &kinds, &mut list, false)?;
    let s = this_str(vm, &list[0], callee)?;
    list.remove(0);
    list.extend_from_slice(&args[n..]);
    let r = body(vm, &mut c, s, &list);
    c.finish(vm, r)
}

/// The reference's `str`: argument `i` as text, once it is data (see `data_arg`).
fn arg_str(vm: &mut Vm, name: &str, args: &[Value], i: usize) -> Result<StrId, Value> {
    let v = data_arg(vm, name, args, i)?;
    vm.string_of(&v)
}

/// The reference's `requireDataArgument`: an argument a `String` method reads that is still a promise or a namespace
/// once the receiver and the arguments converted (conversion keeps both) is not data.
fn data_arg(vm: &mut Vm, name: &str, args: &[Value], i: usize) -> Res {
    let v = arg(args, i);
    if vm.is_opaque_operand(&v) {
        return Err(vm.invalid_data(&format!(
            "String.{name} expects argument {} to be a data value.",
            i + 1
        )));
    }
    Ok(v)
}

fn string_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if let Value::Uninit = this {
        return Err(vm.type_error(
            "new String(...) is not supported; call String(...) without new instead.",
        ));
    }
    if args.is_empty() {
        return Ok(vm.static_str(""));
    }
    fuel::with_primitives(vm, &[Hint::String], [args[0]], false, |vm, [v]| {
        Ok(Value::Str(vm.string_of(&v)?))
    })
}

fn string_from_char_code(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.len() == 1
        && let Value::Num(n) = args[0]
    {
        let c = (to_uint32(n) & 0xffff) as u16;
        return Ok(vm.char_str(c));
    }
    fuel::with_primitive_list(vm, &[Hint::Number], args, true, |vm, args| {
        let mut units = Vec::with_capacity(args.len());
        for a in args {
            units.push((to_uint32(vm.number_of(a)?) & 0xffff) as u16);
        }
        Ok(Value::Str(vm.atoms.alloc_units(&units)))
    })
}

fn string_raw(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let template = arg(args, 0);
    let raw = match template {
        Value::Obj(id) if !vm.is_namespace(id) => {
            let k = vm.atoms.intern_static("raw");
            vm.get_obj(id, k)
        }
        _ => Value::Undef,
    };
    if !matches!(raw, Value::Obj(_)) {
        return Err(vm.type_error("String.raw expects a template object with a raw array."));
    }
    let lk = vm.names.length;
    let len = vm.get(&raw, lk)?;
    let count = to_integer(vm.number_of(&len)?).max(0.0);
    if count > crate::ops::MAX_ARRAY_LEN as f64 {
        return Err(vm.range_error("Invalid array length"));
    }
    let count = count as usize;
    let mut parts = Vec::with_capacity(count * 2);
    for i in 0..count {
        parts.push(vm.get_elem(&raw, &Value::Num(i as f64))?);
        if i + 1 < count && i + 1 < args.len() {
            parts.push(args[i + 1]);
        }
    }
    fuel::with_primitive_list(vm, &[Hint::String], &parts, true, |vm, parts| {
        let mut out = String::new();
        for p in parts {
            let t = vm.string_of(p)?;
            out.push_str(vm.text(t));
        }
        if out.encode_utf16().count() > MAX_STRING_LEN {
            return Err(vm.range_error("Invalid string length"));
        }
        Ok(vm.string_val(out))
    })
}

fn string_from_code_point(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    fuel::with_primitive_list(vm, &[Hint::Number], args, true, |vm, args| {
        let mut out = String::new();
        for a in args {
            let n = vm.number_of(a)?;
            match char::from_u32(n as u32) {
                Some(c) if n.fract() == 0.0 && n >= 0.0 => out.push(c),
                // The reference's host words every invalid code point alike.
                _ => {
                    return Err(vm.range_error(
                        "Arguments contain a value that is out of range of code points",
                    ));
                }
            }
        }
        Ok(vm.string_val(crate::strings::external_text(out)))
    })
}

fn pos_arg(vm: &mut Vm, name: &str, args: &[Value], i: usize) -> Result<f64, Value> {
    let v = data_arg(vm, name, args, i)?;
    Ok(to_integer(vm.number_of(&v)?))
}

fn s_char_at(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::Number], |vm, _, s, args| {
        let i = pos_arg(vm, "charAt", args, 0)?;
        let c = if i < 0.0 {
            None
        } else {
            vm.atoms.sref(s).code_unit(i as usize)
        };
        Ok(match c {
            Some(c) => vm.char_str(c),
            None => vm.static_str(""),
        })
    })
}

fn s_char_code_at(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::Number], |vm, _, s, args| {
        let i = pos_arg(vm, "charCodeAt", args, 0)?;
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
    })
}

fn s_code_point_at(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::Number], |vm, _, s, args| {
        let i = pos_arg(vm, "codePointAt", args, 0)?;
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
    })
}

fn s_at(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::Number], |vm, _, s, args| {
        let len = vm.atoms.sref(s).len16() as f64;
        let mut i = pos_arg(vm, "at", args, 0)?;
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

fn s_index_of(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::String, Hint::Number],
        |vm, _, s, args| {
            let n = arg_str(vm, "indexOf", args, 0)?;
            let len = vm.atoms.sref(s).len16() as f64;
            let from = pos_arg(vm, "indexOf", args, 1)?.clamp(0.0, len) as usize;
            let r = find16(vm.atoms.sref(s), vm.atoms.sref(n), from);
            Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
        },
    )
}

fn s_last_index_of(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::String, Hint::Number],
        |vm, _, s, args| {
            let n = arg_str(vm, "lastIndexOf", args, 0)?;
            let pos = {
                let v = data_arg(vm, "lastIndexOf", args, 1)?;
                vm.number_of(&v)?
            };
            let from = if pos.is_nan() {
                usize::MAX
            } else {
                to_integer(pos).max(0.0) as usize
            };
            let r = rfind16(vm.atoms.sref(s), vm.atoms.sref(n), from);
            Ok(Value::Num(r.map(|i| i as f64).unwrap_or(-1.0)))
        },
    )
}

/// `includes`, `startsWith` and `endsWith` reject a RegExp before converting their arguments.
fn reject_regexp(vm: &mut Vm, args: &[Value], name: &str) -> Result<(), Value> {
    if regexp::as_regexp(vm, &arg(args, 0)).is_some() {
        return Err(vm.type_error(&format!(
            "String.{name} cannot take a regular expression; use regex.test(string) or String.search instead."
        )));
    }
    Ok(())
}

fn s_includes(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        reject_regexp(vm, args, "includes")?;
        let listed = &args[..args.len().min(2)];
        let args = c.converted(vm, &[Hint::String, Hint::Number], listed, false)?;
        let n = arg_str(vm, "includes", &args, 0)?;
        let len = vm.atoms.sref(s).len16() as f64;
        let from = pos_arg(vm, "includes", &args, 1)?.clamp(0.0, len) as usize;
        Ok(Value::Bool(
            find16(vm.atoms.sref(s), vm.atoms.sref(n), from).is_some(),
        ))
    })
}

fn s_starts_with(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        reject_regexp(vm, args, "startsWith")?;
        let listed = &args[..args.len().min(2)];
        let args = c.converted(vm, &[Hint::String, Hint::Number], listed, false)?;
        let n = arg_str(vm, "startsWith", &args, 0)?;
        let len = vm.atoms.sref(s).len16() as f64;
        let from = pos_arg(vm, "startsWith", &args, 1)?.clamp(0.0, len) as usize;
        let (h, n) = (vm.atoms.sref(s), vm.atoms.sref(n));
        if h.ascii && n.ascii {
            return Ok(Value::Bool(h.s[from..].starts_with(n.s)));
        }
        let (h, n) = (h.utf16(), n.utf16());
        Ok(Value::Bool(
            h.len() >= from + n.len() && h[from..from + n.len()] == n[..],
        ))
    })
}

fn s_ends_with(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        reject_regexp(vm, args, "endsWith")?;
        let listed = &args[..args.len().min(2)];
        let args = c.converted(vm, &[Hint::String, Hint::Number], listed, false)?;
        let n = arg_str(vm, "endsWith", &args, 0)?;
        let len = vm.atoms.sref(s).len16();
        let end = match data_arg(vm, "endsWith", &args, 1)? {
            Value::Undef => len,
            v => to_integer(vm.number_of(&v)?).clamp(0.0, len as f64) as usize,
        };
        let h = vm.atoms.sref(s).utf16();
        let n = vm.atoms.sref(n).utf16();
        Ok(Value::Bool(
            end >= n.len() && h[end - n.len()..end] == n[..],
        ))
    })
}

fn s_slice(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::Number, Hint::Number],
        |vm, _, s, args| {
            let len = vm.atoms.sref(s).len16();
            let start = data_arg(vm, "slice", args, 0)?;
            let start = to_index(vm, &start, len, 0)?;
            let end = data_arg(vm, "slice", args, 1)?;
            let end = to_index(vm, &end, len, len)?;
            if start == 0 && end >= len {
                return Ok(Value::Str(s));
            }
            let out = vm.atoms.sref(s).slice16(start, end);
            Ok(vm.string_val(out))
        },
    )
}

fn s_substring(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::Number, Hint::Number],
        |vm, _, s, args| {
            let len = vm.atoms.sref(s).len16() as f64;
            let a = pos_arg(vm, "substring", args, 0)?.clamp(0.0, len) as usize;
            let b = match data_arg(vm, "substring", args, 1)? {
                Value::Undef => len as usize,
                v => to_integer(vm.number_of(&v)?).clamp(0.0, len) as usize,
            };
            let out = vm.atoms.sref(s).slice16(a.min(b), a.max(b));
            Ok(vm.string_val(out))
        },
    )
}

fn s_substr(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::Number, Hint::Number],
        |vm, _, s, args| {
            let len = vm.atoms.sref(s).len16();
            let start = data_arg(vm, "substr", args, 0)?;
            let start = to_index(vm, &start, len, 0)?;
            let count = match data_arg(vm, "substr", args, 1)? {
                Value::Undef => len,
                v => to_integer(vm.number_of(&v)?).max(0.0) as usize,
            };
            let out = vm.atoms.sref(s).slice16(start, start.saturating_add(count));
            Ok(vm.string_val(out))
        },
    )
}

fn map_text(vm: &mut Vm, callee: Id, this: &Value, f: fn(&str) -> String) -> Res {
    simple(vm, callee, *this, &[], &[], |vm, _, s, _| {
        let out = f(vm.text(s));
        Ok(vm.string_val(out))
    })
}

fn s_to_upper(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    map_text(vm, callee, &this, str::to_uppercase)
}

fn s_to_lower(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    map_text(vm, callee, &this, str::to_lowercase)
}

fn s_trim(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    map_text(vm, callee, &this, |s| {
        s.trim_matches(is_js_whitespace).to_owned()
    })
}

fn s_trim_start(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    map_text(vm, callee, &this, |s| {
        s.trim_start_matches(is_js_whitespace).to_owned()
    })
}

fn s_trim_end(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    map_text(vm, callee, &this, |s| {
        s.trim_end_matches(is_js_whitespace).to_owned()
    })
}

fn pad(vm: &mut Vm, callee: Id, this: Value, args: &[Value], at_start: bool) -> Res {
    let name = if at_start { "padStart" } else { "padEnd" };
    simple(
        vm,
        callee,
        this,
        args,
        &[Hint::Number, Hint::String],
        |vm, _, s, args| {
            let target = pos_arg(vm, name, args, 0)?;
            if target > MAX_STRING_LEN as f64 {
                return Err(vm.range_error("Invalid string length"));
            }
            let fill = match arg(args, 1) {
                Value::Undef => " ".to_owned(),
                _ => {
                    let f = arg_str(vm, name, args, 1)?;
                    vm.text(f).to_owned()
                }
            };
            let len = vm.atoms.sref(s).len16();
            if target <= len as f64 || fill.is_empty() {
                return Ok(Value::Str(s));
            }
            let need = target as usize - len;
            let padding: Vec<u16> = crate::strings::units_of(&fill)
                .into_iter()
                .cycle()
                .take(need)
                .collect();
            let padding = crate::strings::from_units(&padding);
            let out = if at_start {
                padding + vm.text(s)
            } else {
                vm.text(s).to_owned() + &padding
            };
            Ok(vm.string_val(out))
        },
    )
}

fn s_pad_start(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    pad(vm, callee, this, args, true)
}

fn s_pad_end(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    pad(vm, callee, this, args, false)
}

fn s_repeat(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::Number], |vm, _, s, args| {
        let n = pos_arg(vm, "repeat", args, 0)?;
        if n < 0.0 || n.is_infinite() {
            return Err(vm.range_error("String.repeat expects a finite non-negative count."));
        }
        if vm.text(s).len() as f64 * n > MAX_STRING_LEN as f64 {
            return Err(vm.range_error("Invalid string length"));
        }
        let out = vm.text(s).repeat(n as usize);
        Ok(vm.string_val(out))
    })
}

fn s_split(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], split)
}

/// The reference's `split` body: the limit, then a separator that is not a RegExp, are one list of conversions.
fn split(vm: &mut Vm, c: &mut Conversions, s: StrId, args: &[Value]) -> Res {
    let re = regexp::as_regexp(vm, &arg(args, 0));
    let mut listed = [
        arg(args, 1),
        if re.is_some() {
            Value::Undef
        } else {
            arg(args, 0)
        },
    ];
    c.convert(vm, &[Hint::Number, Hint::String], &mut listed, false)?;
    // Whether there is a limit is the argument's question; a limit that converts to undefined is NaN, so zero.
    let limit = match (arg(args, 1), listed[0]) {
        (Value::Undef, _) => Value::Undef,
        (_, Value::Undef) => Value::Num(f64::NAN),
        (_, v) => data_arg(vm, "split", &[Value::Undef, v], 1)?,
    };
    if let Some(re) = re {
        return regexp::string_split(vm, s, re, limit);
    }
    let limit = match limit {
        Value::Undef => u32::MAX as usize,
        v => to_uint32(vm.number_of(&v)?) as usize,
    };
    let parts: Vec<Value> = match arg(args, 0) {
        Value::Undef if limit == 0 => Vec::new(),
        Value::Undef => vec![Value::Str(s)],
        _ => {
            let sep = arg_str(vm, "split", &listed[1..], 0)?;
            if vm.text(sep).is_empty() {
                let units = vm.atoms.sref(s).utf16();
                units.iter().take(limit).map(|c| vm.char_str(*c)).collect()
            } else if vm.atoms.is_wtf(s) || vm.atoms.is_wtf(sep) {
                // A separator can cut a pair, so carriers split by code units.
                let (h, n) = (vm.atoms.sref(s).utf16(), vm.atoms.sref(sep).utf16());
                let mut pieces = Vec::new();
                let (mut start, mut i) = (0, 0);
                while pieces.len() < limit && i + n.len() <= h.len() {
                    if h[i..i + n.len()] == n[..] {
                        pieces.push(h[start..i].to_vec());
                        i += n.len();
                        start = i;
                    } else {
                        i += 1;
                    }
                }
                if pieces.len() < limit {
                    pieces.push(h[start..].to_vec());
                }
                pieces
                    .iter()
                    .map(|p| Value::Str(vm.atoms.alloc_units(p)))
                    .collect()
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

fn replace(vm: &mut Vm, callee: Id, this: Value, args: &[Value], all: bool) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        replace_in(vm, c, s, args, all)
    })
}

/// The reference's `replace` body: a pattern that is not a RegExp, then a replacement that is not a callback, are
/// one list of conversions.
fn replace_in(vm: &mut Vm, c: &mut Conversions, s: StrId, args: &[Value], all: bool) -> Res {
    let re = regexp::as_regexp(vm, &arg(args, 0));
    let rep = arg(args, 1);
    let callable = super::supported_callback(vm, &rep);
    // A function callback sites don't admit fails once the pattern converted.
    let refused = !callable && vm.type_of(&rep) == "function";
    let mut listed = [
        if re.is_some() {
            Value::Undef
        } else {
            arg(args, 0)
        },
        if callable { Value::Undef } else { rep },
    ];
    c.convert(vm, &[Hint::String], &mut listed, false)?;
    if refused {
        let name = format!("String.{}", if all { "replaceAll" } else { "replace" });
        return Err(super::unsupported_callable(
            vm,
            &name,
            "replacer",
            "(match) => fn(match)",
        ));
    }
    let name = if all { "replaceAll" } else { "replace" };
    if let Some(re) = re {
        let rep = if callable {
            rep
        } else {
            data_arg(vm, name, &listed, 1)?
        };
        return regexp::string_replace(vm, c, s, re, &rep, all);
    }
    let pat = arg_str(vm, name, &listed, 0)?;
    let rep = if callable { rep } else { listed[1] };
    let template = if callable {
        None
    } else {
        let t = arg_str(vm, name, &listed, 1)?;
        Some(vm.text(t).to_owned())
    };
    if !(vm.atoms.sref(s).ascii && vm.atoms.sref(pat).ascii) {
        return replace16(vm, c, s, pat, &rep, template, all);
    }
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
    // With a callback, the reference finds the matches, then hands them to its prelude's `replaceWith`.
    if callable {
        c.handoff(vm);
    }
    if positions.is_empty() {
        if callable {
            vm.bytecode_builtin();
        }
        return Ok(Value::Str(s));
    }
    if callable {
        let mut gaps = Vec::with_capacity(positions.len());
        let mut calls = Vec::with_capacity(positions.len());
        let mut last = 0;
        for pos in positions {
            gaps.push(vm.str_val(&subject[last..pos]));
            let offset = subject[..pos].encode_utf16().count() as f64;
            calls.push(vec![Value::Str(pat), Value::Num(offset), Value::Str(s)]);
            last = pos + needle.len();
        }
        let tail = vm.str_val(&subject[last..]);
        return enter_replace_with(vm, rep, gaps, calls, tail, false);
    }
    let mut out = String::new();
    let mut last = 0;
    for pos in positions {
        out.push_str(&subject[last..pos]);
        if let Some(t) = &template {
            out.push_str(&expand_replacement(t, &needle, pos, &subject));
        }
        last = pos + needle.len();
    }
    out.push_str(&subject[last..]);
    Ok(vm.string_val(out))
}

// The slots of a `replace` frame with a callback: the callback, the text so far, the next match, how many there are,
// and whether the text is checked against the longest string after each; then, for each match, the text before it and
// its call's arguments (an internal array), then the text after the last.
const REP_F: usize = 0;
const REP_OUT: usize = 1;
const REP_K: usize = 2;
const REP_N: usize = 3;
const REP_CHECK: usize = 4;
/// Set while a callback's result is converted by a call (see `Frame::convert`).
const REP_CONV: usize = 5;
const REP_MATCHES: usize = 6;

/// Pushes a frame that replaces each match with what the callback `f` returns for it, as the reference's prelude
/// `replaceWith` does once the matches are found: the result as a string, then `String`'s fifty and a back-edge.
pub(crate) fn enter_replace_with(
    vm: &mut Vm,
    f: Value,
    gaps: Vec<Value>,
    calls: Vec<Vec<Value>>,
    tail: Value,
    check: bool,
) -> Res {
    let empty = vm.static_str("");
    let n = calls.len();
    let mut slots = vec![
        f,
        empty,
        Value::Num(0.0),
        Value::Num(n as f64),
        Value::Bool(check),
        Value::Num(0.0),
    ];
    for (gap, args) in gaps.into_iter().zip(calls) {
        let args = vm.new_array(args);
        slots.extend([gap, args]);
    }
    slots.push(tail);
    let callee = match f {
        Value::Obj(id) => id,
        _ => 0,
    };
    vm.enter_native(
        crate::native::NativeOp::ReplaceWith,
        callee,
        Value::Undef,
        &slots,
    )
}

/// The step of a `replace` frame.
pub(crate) fn replace_with_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let mut k = fr.index(vm, REP_K);
    let append = |vm: &mut Vm, piece: Value| {
        if let (Value::Str(o), Value::Str(p)) = (fr.get(vm, REP_OUT), piece) {
            let joined = vm.concat_strs(&[o, p]);
            fr.set(vm, REP_OUT, joined);
        }
    };
    match input {
        Input::Returned(r) => {
            let r = r.get();
            let converted = fr.index(vm, REP_CONV) == 1;
            fr.set_index(vm, REP_CONV, 0);
            if !converted && vm.converts_by_call(&r, crate::ops::Hint::String) {
                fr.set_index(vm, REP_CONV, 1);
                return fr.convert(vm, r, crate::ops::Hint::String);
            }
            let r = vm.string_of(&r)?;
            super::fuel::native(vm);
            super::fuel::step(vm);
            append(vm, Value::Str(r));
            if matches!(fr.get(vm, REP_CHECK), Value::Bool(true))
                && let Value::Str(o) = fr.get(vm, REP_OUT)
                && vm.text(o).len() > MAX_STRING_LEN
            {
                return Err(vm.range_error("Invalid string length"));
            }
            k += 1;
            fr.set_index(vm, REP_K, k);
        }
        Input::Threw(e) => return Err(e),
        Input::Start | Input::Finished(_) => {}
    }
    let n = fr.index(vm, REP_N);
    if k >= n {
        let tail = fr.get(vm, REP_MATCHES + 2 * n);
        append(vm, tail);
        vm.bytecode_builtin();
        return Ok(Step::Done(fr.get(vm, REP_OUT)));
    }
    let gap = fr.get(vm, REP_MATCHES + 2 * k);
    append(vm, gap);
    let args = match fr
        .get(vm, REP_MATCHES + 2 * k + 1)
        .as_obj()
        .map(|a| &vm.heap[a as usize].kind)
    {
        Some(crate::object::Kind::Array(items)) => items.clone(),
        _ => Vec::new(),
    };
    let f = fr.slot(vm, REP_F);
    vm.stack.extend_from_slice(&[f, crate::value::Slot::UNDEF]);
    vm.stack
        .extend(args.iter().map(|v| crate::value::Slot::pack(*v)));
    vm.native_call(args.len())
}

/// `replace` by code units, for a subject or pattern beyond ASCII: matches and an empty pattern's positions fall
/// between code units, even inside a pair.
fn replace16(
    vm: &mut Vm,
    c: &Conversions,
    s: StrId,
    pat: StrId,
    rep: &Value,
    template: Option<String>,
    all: bool,
) -> Res {
    let subject = vm.atoms.sref(s).utf16();
    let needle = vm.atoms.sref(pat).utf16();
    let template = template.map(|t| crate::strings::units_of(&t));
    let mut positions = Vec::new();
    if needle.is_empty() {
        if all {
            positions.extend(0..=subject.len());
        } else {
            positions.push(0);
        }
    } else {
        let mut i = 0;
        while i + needle.len() <= subject.len() {
            if subject[i..i + needle.len()] == needle[..] {
                positions.push(i);
                if !all {
                    break;
                }
                i += needle.len();
            } else {
                i += 1;
            }
        }
    }
    let callable = template.is_none();
    if callable {
        c.handoff(vm);
    }
    if positions.is_empty() {
        if callable {
            vm.bytecode_builtin();
        }
        return Ok(Value::Str(s));
    }
    if callable {
        let mut gaps = Vec::with_capacity(positions.len());
        let mut calls = Vec::with_capacity(positions.len());
        let mut last = 0;
        for pos in positions {
            gaps.push(Value::Str(vm.atoms.alloc_units(&subject[last..pos])));
            calls.push(vec![Value::Str(pat), Value::Num(pos as f64), Value::Str(s)]);
            last = pos + needle.len();
        }
        let tail = Value::Str(vm.atoms.alloc_units(&subject[last..]));
        return enter_replace_with(vm, *rep, gaps, calls, tail, false);
    }
    let mut out: Vec<u16> = Vec::with_capacity(subject.len());
    let mut last = 0;
    for pos in positions {
        out.extend_from_slice(&subject[last..pos]);
        if let Some(t) = &template {
            expand_replacement16(&mut out, t, &needle, pos, &subject);
        }
        last = pos + needle.len();
    }
    out.extend_from_slice(&subject[last..]);
    Ok(Value::Str(vm.atoms.alloc_units(&out)))
}

/// `expand_replacement` in code units.
fn expand_replacement16(
    out: &mut Vec<u16>,
    template: &[u16],
    matched: &[u16],
    pos: usize,
    subject: &[u16],
) {
    let dollar = b'$' as u16;
    let mut i = 0;
    while i < template.len() {
        let c = template[i];
        i += 1;
        if c != dollar {
            out.push(c);
            continue;
        }
        match template
            .get(i)
            .map(|n| *n as u8 as char)
            .filter(|_| template[i] < 128)
        {
            Some('$') => out.push(dollar),
            Some('&') => out.extend_from_slice(matched),
            Some('`') => out.extend_from_slice(&subject[..pos]),
            Some('\'') => out.extend_from_slice(&subject[pos + matched.len()..]),
            _ => {
                out.push(dollar);
                continue;
            }
        }
        i += 1;
    }
}

fn s_replace(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    replace(vm, callee, this, args, false)
}

fn s_replace_all(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    replace(vm, callee, this, args, true)
}

fn s_concat(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        let args = c.converted(vm, &[Hint::String], args, false)?;
        let mut out = vm.text(s).to_owned();
        for i in 0..args.len() {
            let t = arg_str(vm, "concat", &args, i)?;
            out.push_str(vm.text(t));
        }
        Ok(vm.string_val(out))
    })
}

fn s_to_string(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |_, _, s, _| Ok(Value::Str(s)))
}

fn s_locale_compare(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    use icu_collator::options::{CollatorOptions, Strength};
    use icu_collator::{Collator, CollatorBorrowed};
    // The root collation the reference's host uses for its default locale (en-US), built once per process.
    static COLLATOR: std::sync::LazyLock<Option<CollatorBorrowed<'static>>> =
        std::sync::LazyLock::new(|| {
            Collator::try_new(Default::default(), CollatorOptions::default()).ok()
        });
    static PRIMARY: std::sync::LazyLock<Option<CollatorBorrowed<'static>>> =
        std::sync::LazyLock::new(|| {
            let mut options = CollatorOptions::default();
            options.strength = Some(Strength::Primary);
            Collator::try_new(Default::default(), options).ok()
        });
    simple(vm, callee, this, args, &[Hint::String], |vm, _, s, args| {
        let o = arg_str(vm, "localeCompare", args, 0)?;
        let (a, b) = (vm.atoms.sref(s), vm.atoms.sref(o));
        let order = match (COLLATOR.as_ref(), PRIMARY.as_ref()) {
            (Some(c), Some(p)) if a.units.is_some() || b.units.is_some() => {
                compare_lone(c, p, &a.utf16(), &b.utf16())
            }
            (Some(c), _) => c.compare(a.s, b.s),
            _ => a.cmp16(b),
        };
        Ok(Value::Num(match order {
            std::cmp::Ordering::Less => -1.0,
            std::cmp::Ordering::Equal => 0.0,
            std::cmp::Ordering::Greater => 1.0,
        }))
    })
}

/// Collates strings with lone surrogates as the reference's ICU does, where each weighs like an unassigned code
/// point of its own value: above every assigned character, below private use and U+FFFD. ICU4X weighs them as
/// U+FFFD, so they stand in as U+D7FF, the unassigned code point just below them, and strings equal at the primary
/// level then order by their lone surrogates, which ICU tells apart at that level.
fn compare_lone(
    full: &icu_collator::CollatorBorrowed,
    primary: &icu_collator::CollatorBorrowed,
    a: &[u16],
    b: &[u16],
) -> std::cmp::Ordering {
    let lone = |u: &[u16]| -> (Vec<u16>, Vec<u16>) {
        let mut text = Vec::with_capacity(u.len());
        let mut lone = Vec::new();
        for r in char::decode_utf16(u.iter().copied()) {
            match r {
                Ok(c) => {
                    let mut buf = [0u16; 2];
                    text.extend_from_slice(c.encode_utf16(&mut buf));
                }
                Err(e) => {
                    text.push(0xD7FF);
                    lone.push(e.unpaired_surrogate());
                }
            }
        }
        (text, lone)
    };
    let ((ta, la), (tb, lb)) = (lone(a), lone(b));
    if primary.compare_utf16(&ta, &tb).is_eq() && la != lb {
        return la.cmp(&lb);
    }
    full.compare_utf16(&ta, &tb)
}

/// The reference's `withPattern`: a RegExp as is, anything else a list of its own, converted with the string hint.
fn pattern_value(vm: &mut Vm, c: &mut Conversions, args: &[Value]) -> Res {
    let mut p = [arg(args, 0)];
    if regexp::as_regexp(vm, &p[0]).is_some() {
        return Ok(p[0]);
    }
    c.convert(vm, &[Hint::String], &mut p, false)?;
    Ok(p[0])
}

fn s_match(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        let p = pattern_value(vm, c, args)?;
        regexp::string_match(vm, s, &p)
    })
}

fn s_match_all(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        let p = pattern_value(vm, c, args)?;
        regexp::string_match_all(vm, s, &p)
    })
}

fn s_search(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, c, s, args| {
        let p = pattern_value(vm, c, args)?;
        regexp::string_search(vm, s, &p)
    })
}

fn s_normalize(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[Hint::String], |vm, _, s, args| {
        normalize(vm, s, args)
    })
}

fn normalize(vm: &mut Vm, s: StrId, args: &[Value]) -> Res {
    use unicode_normalization::UnicodeNormalization;
    let form = match arg(args, 0) {
        Value::Undef => "NFC".to_owned(),
        _ => {
            let f = arg_str(vm, "normalize", args, 0)?;
            vm.text(f).to_owned()
        }
    };
    let text = vm.text(s);
    let out: String = match form.as_str() {
        "NFC" => text.nfc().collect(),
        "NFD" => text.nfd().collect(),
        "NFKC" => text.nfkc().collect(),
        "NFKD" => text.nfkd().collect(),
        _ => {
            let mut q = String::new();
            crate::convert::quote(&mut q, &form);
            return Err(vm.range_error(&format!(
                "String.normalize expects the form \"NFC\", \"NFD\", \"NFKC\", or \"NFKD\" (got {q})."
            )));
        }
    };
    if out == text {
        return Ok(Value::Str(s));
    }
    Ok(vm.string_val(out))
}

fn s_is_well_formed(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, _, s, _| {
        Ok(Value::Bool(vm.atoms.sref(s).well_formed()))
    })
}

fn s_to_well_formed(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, _, s, _| {
        if vm.atoms.sref(s).well_formed() {
            return Ok(Value::Str(s));
        }
        let fixed = String::from_utf16_lossy(&vm.atoms.sref(s).utf16());
        Ok(vm.string_val(crate::strings::external_text(fixed)))
    })
}

fn s_iterator(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    simple(vm, callee, this, args, &[], |vm, _, s, _| {
        vm.get_iterator(&Value::Str(s))
    })
}

// ---------- Number ----------

fn number_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if let Value::Uninit = this {
        return Err(vm.type_error(
            "new Number(...) is not supported; call Number(...) without new instead.",
        ));
    }
    if args.is_empty() {
        return Ok(Value::Num(0.0));
    }
    fuel::with_primitives(vm, &[Hint::Number], [args[0]], false, |vm, [v]| {
        Ok(Value::Num(vm.number_of(&v)?))
    })
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

fn this_num(vm: &mut Vm, this: &Value, name: &str) -> Result<f64, Value> {
    match this {
        Value::Num(n) => Ok(*n),
        _ => Err(vm.type_error(&format!(
            "Number.prototype.{name} requires that 'this' be a Number."
        ))),
    }
}

/// The reference's `formatting`: after the receiver's check, the one argument is a list of conversions.
fn formatting(vm: &mut Vm, args: &[Value], body: impl FnOnce(&mut Vm, &[Value]) -> Res) -> Res {
    fuel::with_primitives(vm, &[Hint::Number], [arg(args, 0)], false, |vm, digits| {
        body(vm, &digits)
    })
}

fn n_to_fixed(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this, "toFixed")?;
    formatting(vm, args, |vm, args| {
        let d = to_integer(vm.number_of(&arg(args, 0))?);
        if !(0.0..=100.0).contains(&d) {
            return Err(vm.range_error("toFixed() argument must be between 0 and 100"));
        }
        if x.abs() >= 1e21 {
            return Ok(vm.string_val(num_to_string(x)));
        }
        // The sign stays even when the digits round to zero: `(-0.0001).toFixed(2)` is "-0.00".
        let sign = if x < 0.0 { "-" } else { "" };
        Ok(vm.string_val(format!("{sign}{}", num_to_fixed(x.abs(), d as usize))))
    })
}

fn n_to_string(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this, "toString")?;
    formatting(vm, args, |vm, args| {
        let radix = match arg(args, 0) {
            Value::Undef => 10.0,
            v => to_integer(vm.number_of(&v)?),
        };
        if !(2.0..=36.0).contains(&radix) {
            return Err(vm.range_error("toString() radix argument must be between 2 and 36"));
        }
        Ok(vm.string_val(if radix == 10.0 {
            num_to_string(x)
        } else {
            super::numfmt::to_radix(x, radix as u32)
        }))
    })
}

fn n_to_exponential(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this, "toExponential")?;
    formatting(vm, args, |vm, args| {
        let digits = match arg(args, 0) {
            Value::Undef => None,
            v => Some(to_integer(vm.number_of(&v)?)),
        };
        if !x.is_finite() {
            return Ok(vm.string_val(num_to_string(x)));
        }
        if digits.is_some_and(|d| !(0.0..=100.0).contains(&d)) {
            return Err(vm.range_error("toExponential() argument must be between 0 and 100"));
        }
        let out = super::numfmt::to_exponential(x, digits.map(|d| d as usize));
        Ok(vm.string_val(out))
    })
}

fn n_to_precision(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this, "toPrecision")?;
    formatting(vm, args, |vm, args| {
        if let Value::Undef = arg(args, 0) {
            return Ok(vm.string_val(num_to_string(x)));
        }
        let p = to_integer(vm.number_of(&arg(args, 0))?);
        if !x.is_finite() {
            return Ok(vm.string_val(num_to_string(x)));
        }
        if !(1.0..=100.0).contains(&p) {
            return Err(vm.range_error("toPrecision() argument must be between 1 and 100"));
        }
        let out = super::numfmt::to_precision(x, p as usize);
        Ok(vm.string_val(out))
    })
}

fn n_value_of(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(Value::Num(this_num(vm, &this, "valueOf")?))
}

fn n_to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let x = this_num(vm, &this, "toLocaleString")?;
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
            let f: fn(f64) -> f64 = $f;
            if let Some(Value::Obj(_)) = args.first() {
                return math(vm, &args[..1], |xs| f(xs[0]));
            }
            let x = n0(vm, args)?;
            Ok(Value::Num(f(x)))
        }
    };
}

/// The reference's Math methods: the arguments a method reads (`args`) are one list of conversions with the number
/// hint, then `f` runs on their numbers.
fn math(vm: &mut Vm, args: &[Value], f: impl FnOnce(&[f64]) -> f64) -> Res {
    fuel::with_primitive_list(vm, &[Hint::Number], args, false, |vm, args| {
        let mut xs = Vec::with_capacity(args.len());
        for a in args {
            xs.push(vm.number_of(a)?);
        }
        Ok(Value::Num(f(&xs)))
    })
}

/// The first two arguments, which a two-argument Math method reads, padded with `undefined`.
fn two(args: &[Value]) -> [Value; 2] {
    [arg(args, 0), arg(args, 1)]
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
math1!(m_f16round, super::numfmt::f16_round);
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

fn m_sum_precise(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    // The reference's prelude `Math$sumPrecise`: a back-edge per value, then `$SumPrecise`.
    super::fuel::method(vm);
    let source = arg(args, 0);
    if !vm.is_iterable(&source) {
        return Err(vm.not_iterable(&source, crate::bytecode::ITER_FOR_OF));
    }
    let values = vm.new_array(Vec::new());
    crate::native::enter_for_of_sub(
        vm,
        crate::native::NativeOp::Callbacks,
        super::object::SUB_SUM_PRECISE,
        callee,
        Value::Undef,
        source,
        &[values],
    )
}

/// `Math.sumPrecise` over its values: its own slot is the numbers read so far, an internal array.
pub(crate) struct SumPrecise;

impl crate::native::ForOf for SumPrecise {
    fn item(vm: &mut Vm, fr: crate::native::Frame, x: Value) -> Result<crate::native::Flow, Value> {
        let Value::Num(_) = x else {
            return Err(vm.type_error("Math.sumPrecise expects an iterable of numbers."));
        };
        let values = fr
            .get(vm, crate::native::FOR_OF_SLOTS)
            .as_obj()
            .unwrap_or(0);
        let Kind::Array(items) = &mut vm.heap[values as usize].kind else {
            return Ok(crate::native::Flow::Next);
        };
        if items.len() >= crate::ops::MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length"));
        }
        items.push(x);
        Ok(crate::native::Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: crate::native::Frame) -> Res {
        let values = fr
            .get(vm, crate::native::FOR_OF_SLOTS)
            .as_obj()
            .unwrap_or(0);
        let values: Vec<f64> = match &vm.heap[values as usize].kind {
            Kind::Array(items) => items.iter().map(Value::as_num).collect(),
            _ => Vec::new(),
        };
        super::fuel::native(vm);
        vm.bytecode_builtin();
        Ok(Value::Num(super::numfmt::sum_precise(&values)))
    }
}

fn m_atan2(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.iter().take(2).any(|v| matches!(v, Value::Obj(_))) {
        return math(vm, &two(args), |xs| xs[0].atan2(xs[1]));
    }
    let (y, x) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(y.atan2(x)))
}

fn m_pow(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.iter().take(2).any(|v| matches!(v, Value::Obj(_))) {
        return math(vm, &two(args), |xs| crate::vm::js_pow(xs[0], xs[1]));
    }
    let (x, y) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(crate::vm::js_pow(x, y)))
}

fn imul(x: f64, y: f64) -> f64 {
    (to_uint32(x) as i32).wrapping_mul(to_uint32(y) as i32) as f64
}

fn m_imul(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.iter().take(2).any(|v| matches!(v, Value::Obj(_))) {
        return math(vm, &two(args), |xs| imul(xs[0], xs[1]));
    }
    let (x, y) = (n0(vm, args)?, n1(vm, args)?);
    Ok(Value::Num(imul(x, y)))
}

fn m_max(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    fuel::with_primitive_list(vm, &[Hint::Number], args, false, |vm, args| {
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
    })
}

fn m_min(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    fuel::with_primitive_list(vm, &[Hint::Number], args, false, |vm, args| {
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
    })
}

fn m_hypot(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    // Every argument converts before any is examined, so a later conversion's throw is not skipped.
    math(vm, args, hypot)
}

/// `Math.hypot` as JavaScriptCore computes it: libm for two values, a scaled sum for three, and a running scaled
/// fused sum beyond.
fn hypot(xs: &[f64]) -> f64 {
    if xs.iter().any(|x| x.is_infinite()) {
        return f64::INFINITY;
    }
    if xs.iter().any(|x| x.is_nan()) {
        return f64::NAN;
    }
    match xs {
        [] => 0.0,
        [x] => x.abs(),
        [x, y] => x.hypot(*y),
        [x, y, z] => {
            let (x, y, z) = (x.abs(), y.abs(), z.abs());
            let a = x.max(y).max(z);
            if a == 0.0 {
                return 0.0;
            }
            let (x, y, z) = (x / a, y / a, z / a);
            a * (x * x + y * y + z * z).sqrt()
        }
        _ => {
            let (mut max, mut sum) = (0.0f64, 0.0f64);
            for x in xs {
                let a = x.abs();
                if max < a {
                    let s = max / a;
                    sum = sum.mul_add(s * s, 1.0);
                    max = a;
                } else if max != 0.0 {
                    let s = a / max;
                    sum = s.mul_add(s, sum);
                }
            }
            if max == 0.0 { 0.0 } else { sum.sqrt() * max }
        }
    }
}

fn m_random(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    let mut x = vm.rng;
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    vm.rng = x;
    Ok(Value::Num((x >> 11) as f64 / (1u64 << 53) as f64))
}
