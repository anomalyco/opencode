//! Program values, strings and number formatting.

use std::fmt::Write as _;

use crate::strings::StrId;

/// Index of an object in the run's heap.
pub type Id = u32;

/// A program value. `Uninit` marks a binding in its temporal dead zone and never escapes to programs.
#[derive(Clone, Copy, Debug, Default)]
#[repr(C, u64)]
pub enum Value {
    #[default]
    Undef,
    Null,
    Bool(bool),
    Num(f64),
    Str(StrId),
    Obj(Id),
    /// A well-known symbol; only `Symbol.iterator` exists.
    Sym(u32),
    Uninit,
}

impl Value {
    #[inline]
    pub fn is_nullish(&self) -> bool {
        matches!(self, Value::Undef | Value::Null)
    }

    pub fn as_obj(&self) -> Option<Id> {
        match self {
            Value::Obj(id) => Some(*id),
            _ => None,
        }
    }
}

/// `Number.prototype.toString()` with radix 10.
pub fn num_to_string(x: f64) -> String {
    let mut out = String::new();
    write_num(&mut out, x);
    out
}

pub fn write_num(out: &mut String, x: f64) {
    if x.is_nan() {
        out.push_str("NaN");
        return;
    }
    if x == 0.0 {
        out.push('0');
        return;
    }
    if x.is_infinite() {
        out.push_str(if x > 0.0 { "Infinity" } else { "-Infinity" });
        return;
    }
    if x.fract() == 0.0 && x.abs() < 1e21 {
        if x.abs() < 9.0e18 {
            let _ = write!(out, "{}", x as i64);
            return;
        }
        let _ = write!(out, "{x}");
        return;
    }
    if x < 0.0 {
        out.push('-');
    }
    let e = format!("{:e}", x.abs());
    let (mantissa, exp) = e.split_once('e').unwrap_or((&e, "0"));
    let exp: i32 = exp.parse().unwrap_or(0);
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1;
    if k <= n && n <= 21 {
        out.push_str(&digits);
        for _ in 0..(n - k) {
            out.push('0');
        }
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(&digits);
    } else {
        let e = n - 1;
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if e < 0 { '-' } else { '+' });
        let _ = write!(out, "{}", e.abs());
    }
}

/// `Number.prototype.toString(radix)` for radix other than 10.
pub fn num_to_radix(x: f64, radix: u32) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    let neg = x < 0.0;
    let x = x.abs();
    let mut int = x.trunc();
    let mut frac = x - int;
    let mut digits = Vec::new();
    if int == 0.0 {
        digits.push(b'0');
    }
    while int >= 1.0 {
        let d = (int % radix as f64) as u32;
        digits.push(std::char::from_digit(d, radix).unwrap_or('0') as u8);
        int = (int / radix as f64).trunc();
    }
    digits.reverse();
    let mut s = String::from_utf8(digits).unwrap_or_default();
    if frac > 0.0 {
        s.push('.');
        let mut n = 0;
        while frac > 0.0 && n < 52 {
            frac *= radix as f64;
            let d = frac.trunc() as u32;
            s.push(std::char::from_digit(d, radix).unwrap_or('0'));
            frac -= d as f64;
            n += 1;
        }
    }
    if neg { format!("-{s}") } else { s }
}

/// `Number.prototype.toFixed`, rounding the exact binary value half away from zero like JavaScript.
pub fn num_to_fixed(x: f64, digits: usize) -> String {
    if !x.is_finite() {
        return num_to_string(x);
    }
    let exact = format!("{:.1100}", x.abs());
    let (int, frac) = exact.split_once('.').unwrap_or((&exact, ""));
    let mut buf: Vec<u8> = int.bytes().chain(frac.bytes().take(digits)).collect();
    let round_up = frac.as_bytes().get(digits).is_some_and(|d| *d >= b'5');
    if round_up {
        let mut i = buf.len();
        loop {
            if i == 0 {
                buf.insert(0, b'1');
                break;
            }
            i -= 1;
            if buf[i] == b'9' {
                buf[i] = b'0';
            } else {
                buf[i] += 1;
                break;
            }
        }
    }
    let split = buf.len() - digits;
    let mut out = String::new();
    let negative = x < 0.0 && buf.iter().any(|b| *b != b'0');
    if negative {
        out.push('-');
    }
    out.push_str(std::str::from_utf8(&buf[..split]).unwrap_or("0"));
    if digits > 0 {
        out.push('.');
        out.push_str(std::str::from_utf8(&buf[split..]).unwrap_or(""));
    }
    out
}

pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{9}' | '\u{a}' | '\u{b}' | '\u{c}' | '\u{d}' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

/// ToNumber applied to a string.
pub fn str_to_num(s: &str) -> f64 {
    let t = s.trim_matches(is_js_whitespace);
    if t.is_empty() {
        return 0.0;
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if t.len() > 2 && body.len() == t.len() {
        let radix = match &t[..2] {
            "0x" | "0X" => 16,
            "0o" | "0O" => 8,
            "0b" | "0B" => 2,
            _ => 0,
        };
        if radix != 0 {
            let mut v = 0.0f64;
            for c in t[2..].chars() {
                match c.to_digit(radix) {
                    Some(d) => v = v * radix as f64 + d as f64,
                    None => return f64::NAN,
                }
            }
            return v;
        }
    }
    if !is_decimal_literal(body) {
        return f64::NAN;
    }
    body.parse::<f64>().map(|v| sign * v).unwrap_or(f64::NAN)
}

fn is_decimal_literal(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let mut digits = i > int_start;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let f = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        digits |= i > f;
    }
    if !digits {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let e = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == e {
            return false;
        }
    }
    i == b.len()
}

/// The longest decimal prefix `parseFloat` accepts.
pub fn parse_float_prefix(s: &str) -> f64 {
    let t = s.trim_start_matches(is_js_whitespace);
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    if t[i..].starts_with("Infinity") {
        return if b.first() == Some(&b'-') {
            f64::NEG_INFINITY
        } else {
            f64::INFINITY
        };
    }
    let start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    if i < b.len() && b[i] == b'.' {
        i += 1;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
    }
    if i == start || &t[start..i] == "." {
        return f64::NAN;
    }
    let mantissa_end = i;
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        let mut j = i + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let d = j;
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        if j > d {
            i = j;
        }
    }
    let end = if i > mantissa_end { i } else { mantissa_end };
    t[..end].parse::<f64>().unwrap_or(f64::NAN)
}

pub fn to_int32(x: f64) -> i32 {
    if x.is_finite() && x.abs() < 2147483648.0 {
        return x as i32;
    }
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc().rem_euclid(4294967296.0);
    m as u32 as i32
}

pub fn to_uint32(x: f64) -> u32 {
    to_int32(x) as u32
}

/// ToIntegerOrInfinity.
pub fn to_integer(x: f64) -> f64 {
    if x.is_nan() { 0.0 } else { x.trunc() + 0.0 }
}

/// If `s` is a canonical array index ("0", "17", not "01"), returns it.
pub fn index_of_key(s: &str) -> Option<u32> {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 10 || (b.len() > 1 && b[0] == b'0') {
        return None;
    }
    let mut v: u64 = 0;
    for c in b {
        if !c.is_ascii_digit() {
            return None;
        }
        v = v * 10 + (c - b'0') as u64;
    }
    if v < u32::MAX as u64 {
        Some(v as u32)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_formatting() {
        assert_eq!(num_to_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(num_to_string(1e21), "1e+21");
        assert_eq!(num_to_string(1.5e-7), "1.5e-7");
        assert_eq!(num_to_string(123456789012.0), "123456789012");
        assert_eq!(num_to_string(-1e-7), "-1e-7");
        assert_eq!(num_to_string(0.000001), "0.000001");
        assert_eq!(num_to_fixed(1.23456, 2), "1.23");
        assert_eq!(num_to_fixed(2.5, 0), "3");
        assert_eq!(num_to_fixed(1.005, 2), "1.00");
        assert_eq!(num_to_radix(255.0, 16), "ff");
    }

    #[test]
    fn string_to_number() {
        assert_eq!(str_to_num(" 3.5 "), 3.5);
        assert!(str_to_num("x").is_nan());
        assert!(str_to_num("inf").is_nan());
        assert_eq!(str_to_num(""), 0.0);
        assert_eq!(str_to_num("0x1f"), 31.0);
        assert_eq!(parse_float_prefix("2.5e1x"), 25.0);
    }
}

const QNAN: u64 = 0x7ff8_0000_0000_0000;
const TAGGED: u64 = 0xfff9_0000_0000_0000;
const T_UNDEF: u64 = 0xfff9;
const T_NULL: u64 = 0xfffa;
const T_BOOL: u64 = 0xfffb;
const T_STR: u64 = 0xfffc;
const T_OBJ: u64 = 0xfffd;
const T_SYM: u64 = 0xfffe;
const T_UNINIT: u64 = 0xffff;

/// A value packed into one word (NaN-boxing), for the VM stack and closure cells. Numbers are their own bits, with
/// every NaN canonicalized; other values live in the negative quiet-NaN space with a 32-bit payload.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct Slot(pub u64);

impl Default for Slot {
    fn default() -> Self {
        Slot::UNDEF
    }
}

impl Slot {
    pub const UNDEF: Slot = Slot(T_UNDEF << 48);
    pub const UNINIT: Slot = Slot(T_UNINIT << 48);

    #[inline(always)]
    pub fn num(f: f64) -> Slot {
        if f.is_nan() {
            Slot(QNAN)
        } else {
            Slot(f.to_bits())
        }
    }

    #[inline(always)]
    pub fn is_num(self) -> bool {
        self.0 < TAGGED
    }

    #[inline(always)]
    pub fn f(self) -> f64 {
        f64::from_bits(self.0)
    }

    #[inline(always)]
    pub fn is_str(self) -> bool {
        self.0 >> 48 == T_STR
    }

    #[inline(always)]
    pub fn payload(self) -> u32 {
        self.0 as u32
    }

    #[inline(always)]
    pub fn pack(v: Value) -> Slot {
        match v {
            Value::Num(f) => Slot::num(f),
            Value::Undef => Slot::UNDEF,
            Value::Null => Slot(T_NULL << 48),
            Value::Bool(b) => Slot(T_BOOL << 48 | b as u64),
            Value::Str(s) => Slot(T_STR << 48 | s as u64),
            Value::Obj(o) => Slot(T_OBJ << 48 | o as u64),
            Value::Sym(s) => Slot(T_SYM << 48 | s as u64),
            Value::Uninit => Slot::UNINIT,
        }
    }

    #[inline(always)]
    pub fn get(self) -> Value {
        if self.0 < TAGGED {
            return Value::Num(f64::from_bits(self.0));
        }
        let p = self.0 as u32;
        match self.0 >> 48 {
            T_UNDEF => Value::Undef,
            T_NULL => Value::Null,
            T_BOOL => Value::Bool(p != 0),
            T_STR => Value::Str(p),
            T_OBJ => Value::Obj(p),
            T_SYM => Value::Sym(p),
            _ => Value::Uninit,
        }
    }
}

#[cfg(test)]
mod slot_tests {
    use super::*;

    #[test]
    fn packing_round_trips() {
        for v in [
            Value::Num(-0.0),
            Value::Num(f64::NEG_INFINITY),
            Value::Num(1.5),
            Value::Str(7),
            Value::Obj(u32::MAX),
        ] {
            assert_eq!(format!("{:?}", Slot::pack(v).get()), format!("{v:?}"));
        }
        assert!(Slot::pack(Value::Num(f64::from_bits(0xffff_0000_0000_0001))).get_num_is_nan());
        assert!(matches!(
            Slot::pack(Value::Bool(true)).get(),
            Value::Bool(true)
        ));
        assert!(matches!(Slot::UNINIT.get(), Value::Uninit));
    }

    impl Slot {
        fn get_num_is_nan(self) -> bool {
            matches!(self.get(), Value::Num(n) if n.is_nan())
        }
    }
}
