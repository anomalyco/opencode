//! Number formatting with JavaScriptCore's results: radix strings, `toExponential` and `toPrecision`.

/// The exact decimal digits of a finite positive `x` and the power of ten of the first one.
fn exact_digits(x: f64) -> (Vec<u8>, i32) {
    let s = format!("{:.1100e}", x);
    let (mantissa, exp) = s.split_once('e').unwrap_or((&s, "0"));
    let digits: Vec<u8> = mantissa
        .bytes()
        .filter(u8::is_ascii_digit)
        .map(|b| b - b'0')
        .collect();
    let end = digits.iter().rposition(|d| *d != 0).map_or(1, |i| i + 1);
    (digits[..end].to_vec(), exp.parse().unwrap_or(0))
}

/// `n` significant digits of a finite positive `x`, rounded half up on the exact value, and the exponent.
fn rounded(x: f64, n: usize) -> (Vec<u8>, i32) {
    let (mut digits, mut e) = exact_digits(x);
    let up = digits.get(n).is_some_and(|d| *d >= 5);
    digits.resize(n, 0);
    if up {
        let mut i = n;
        loop {
            if i == 0 {
                digits.insert(0, 1);
                digits.truncate(n);
                e += 1;
                break;
            }
            i -= 1;
            if digits[i] == 9 {
                digits[i] = 0;
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    (digits, e)
}

/// The shortest round-trip digits of a finite positive `x`, and the exponent.
fn shortest(x: f64) -> (Vec<u8>, i32) {
    let (digits, e) = crate::value::shortest_digits(x);
    (digits.bytes().map(|b| b - b'0').collect(), e)
}

fn text(d: &[u8]) -> String {
    d.iter().map(|d| (b'0' + d) as char).collect()
}

fn exponential(sign: &str, digits: &[u8], e: i32) -> String {
    let mut out = String::from(sign);
    out.push_str(&text(&digits[..1]));
    if digits.len() > 1 {
        out.push('.');
        out.push_str(&text(&digits[1..]));
    }
    out.push('e');
    out.push(if e < 0 { '-' } else { '+' });
    out.push_str(&e.abs().to_string());
    out
}

/// `Number.prototype.toExponential` for a finite `x`; `None` digits means as many as needed.
pub fn to_exponential(x: f64, fraction: Option<usize>) -> String {
    let sign = if x < 0.0 { "-" } else { "" };
    let x = x.abs();
    if x == 0.0 {
        let n = fraction.unwrap_or(0);
        return exponential("", &vec![0; n + 1], 0);
    }
    let (digits, e) = match fraction {
        Some(f) => rounded(x, f + 1),
        None => shortest(x),
    };
    exponential(sign, &digits, e)
}

/// `Number.prototype.toPrecision` for a finite `x` and a precision in 1..=100.
pub fn to_precision(x: f64, p: usize) -> String {
    let sign = if x < 0.0 { "-" } else { "" };
    let x = x.abs();
    let (digits, e) = if x == 0.0 {
        (vec![0; p], 0)
    } else {
        rounded(x, p)
    };
    if e < -6 || e >= p as i32 {
        return exponential(sign, &digits, e);
    }
    let mut out = String::from(sign);
    if e >= 0 {
        let int = e as usize + 1;
        out.push_str(&text(&digits[..int]));
        if p > int {
            out.push('.');
            out.push_str(&text(&digits[int..]));
        }
    } else {
        out.push_str("0.");
        for _ in 0..(-e - 1) {
            out.push('0');
        }
        out.push_str(&text(&digits));
    }
    out
}

/// The exact digits of a non-negative integral `x` in `radix`.
fn integer_digits(x: f64, radix: u32) -> Vec<u32> {
    if x < 9.007_199_254_740_992e15 {
        let mut n = x as u64;
        let mut out = Vec::new();
        loop {
            out.push((n % radix as u64) as u32);
            n /= radix as u64;
            if n == 0 {
                break;
            }
        }
        out.reverse();
        return out;
    }
    let bits = x.to_bits();
    let exp = ((bits >> 52) & 0x7ff) as i64 - 1075;
    let mantissa = (bits & ((1 << 52) - 1)) | (1 << 52);
    // Little-endian 32-bit limbs of mantissa * 2^exp (exp > 0 here).
    let mut limbs: Vec<u64> = vec![mantissa & 0xffff_ffff, mantissa >> 32];
    for _ in 0..exp {
        let mut carry = 0;
        for l in limbs.iter_mut() {
            let v = (*l << 1) | carry;
            *l = v & 0xffff_ffff;
            carry = v >> 32;
        }
        if carry > 0 {
            limbs.push(carry);
        }
    }
    let mut out = Vec::new();
    while limbs.iter().any(|l| *l != 0) {
        let mut rem = 0u64;
        for l in limbs.iter_mut().rev() {
            let cur = (rem << 32) | *l;
            *l = cur / radix as u64;
            rem = cur % radix as u64;
        }
        out.push(rem as u32);
        while limbs.last() == Some(&0) {
            limbs.pop();
        }
    }
    out.reverse();
    out
}

/// A non-negative dyadic number with `FRAC` 32-bit limbs after the point: exact for the fraction and the
/// half-ulp of any double, as JavaScriptCore's `Uint16WithFraction` is.
struct Fixed(Vec<u32>);

const FRAC: usize = 34;
const LIMBS: usize = FRAC + 2;

impl Fixed {
    /// `x / 2^shift`, for a finite non-negative double below 2^32.
    fn new(x: f64, shift: u32) -> Fixed {
        let bits = x.to_bits();
        let raw_exp = ((bits >> 52) & 0x7ff) as i64;
        let (m, e) = if raw_exp == 0 {
            (bits & ((1 << 52) - 1), -1074)
        } else {
            ((bits & ((1 << 52) - 1)) | (1 << 52), raw_exp - 1075)
        };
        let shift_total = e + (FRAC as i64) * 32 - shift as i64;
        let mut limbs = vec![0u32; LIMBS];
        if shift_total >= 0 {
            let s = shift_total as usize;
            let (word, bit) = (s / 32, s % 32);
            let wide = (m as u128) << bit;
            for k in 0..4 {
                if word + k < LIMBS {
                    limbs[word + k] = (wide >> (32 * k)) as u32;
                }
            }
        }
        Fixed(limbs)
    }

    fn mul_small(&mut self, r: u32) {
        let mut carry = 0u64;
        for l in self.0.iter_mut() {
            let v = *l as u64 * r as u64 + carry;
            *l = v as u32;
            carry = v >> 32;
        }
    }

    /// Takes the integer part out, leaving the fraction.
    fn floor_and_subtract(&mut self) -> u32 {
        let d = self.0[FRAC];
        self.0[FRAC] = 0;
        self.0[FRAC + 1] = 0;
        d
    }

    fn cmp_half(&self) -> std::cmp::Ordering {
        let mut half = vec![0u32; LIMBS];
        half[FRAC - 1] = 1 << 31;
        self.cmp_limbs(&half)
    }

    fn cmp_limbs(&self, other: &[u32]) -> std::cmp::Ordering {
        for i in (0..LIMBS).rev() {
            match self.0[i].cmp(&other[i]) {
                std::cmp::Ordering::Equal => {}
                o => return o,
            }
        }
        std::cmp::Ordering::Equal
    }

    fn sum_greater_than_one(&self, other: &Fixed) -> bool {
        let mut sum = vec![0u32; LIMBS];
        let mut carry = 0u64;
        for (i, s) in sum.iter_mut().enumerate() {
            let v = self.0[i] as u64 + other.0[i] as u64 + carry;
            *s = v as u32;
            carry = v >> 32;
        }
        let mut one = vec![0u32; LIMBS];
        one[FRAC] = 1;
        Fixed(sum).cmp_limbs(&one) == std::cmp::Ordering::Greater
    }
}

fn next_after(x: f64, up: bool) -> f64 {
    if up {
        f64::from_bits(x.to_bits() + 1)
    } else if x == 0.0 {
        0.0
    } else {
        f64::from_bits(x.to_bits() - 1)
    }
}

/// `Number.prototype.toString(radix)` for radix other than 10, as JavaScriptCore writes it: exact integer digits,
/// then the fewest fraction digits that still identify the double.
pub fn to_radix(x: f64, radix: u32) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let negative = x < 0.0;
    let number = x.abs();
    let mut integer = number.floor();
    let fraction_part = number - integer;
    let digit_char = |d: u32| std::char::from_digit(d, radix).unwrap_or('0');
    let mut frac = String::new();
    if fraction_part != 0.0 {
        let integer_odd = integer <= 9_007_199_254_740_991.0 && (integer as i64) & 1 == 1;
        let mut odd_in_odd_radix = integer_odd;
        let mut digit = integer_odd as u32;
        let mut fraction = Fixed::new(fraction_part, 0);
        let mut rounding_up = false;
        let delta_next = next_after(number, true) - number;
        let delta_last = number - next_after(number, false);
        let mut half_next = Fixed::new(delta_next, 1);
        let mut half_last = Fixed::new(delta_last, 1);
        loop {
            let c = fraction.cmp_half();
            let odd = if radix & 1 == 1 {
                odd_in_odd_radix
            } else {
                digit & 1 == 1
            };
            if c == std::cmp::Ordering::Greater || (c == std::cmp::Ordering::Equal && odd) {
                if fraction.sum_greater_than_one(&half_next) {
                    rounding_up = true;
                    break;
                }
            } else if fraction.cmp_limbs(&half_last.0) == std::cmp::Ordering::Less {
                break;
            }
            fraction.mul_small(radix);
            digit = fraction.floor_and_subtract();
            frac.push(digit_char(digit));
            if digit & 1 == 1 {
                odd_in_odd_radix = !odd_in_odd_radix;
            }
            half_next.mul_small(radix);
            half_last.mul_small(radix);
        }
        let top = digit_char(radix - 1);
        if rounding_up {
            while frac.ends_with(top) {
                frac.pop();
            }
            match frac.pop() {
                Some(c) => {
                    let d = c.to_digit(radix).unwrap_or(0);
                    frac.push(digit_char(d + 1));
                }
                None => integer += 1.0,
            }
        } else {
            while frac.ends_with('0') {
                frac.pop();
            }
        }
    }
    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.extend(integer_digits(integer, radix).into_iter().map(digit_char));
    if !frac.is_empty() {
        out.push('.');
        out.push_str(&frac);
    }
    out
}

/// `Math.f16round`: the nearest binary16 value, ties to even, rounded directly from the double.
pub fn f16_round(x: f64) -> f64 {
    if !x.is_finite() || x == 0.0 {
        return x;
    }
    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let a = x.abs();
    if a >= 65520.0 {
        return sign * f64::INFINITY;
    }
    // Spacing of binary16 values around `a`: 2^(e - 10), with subnormals at 2^-24.
    let e = a.log2().floor().max(-14.0);
    let mut e = e as i32;
    if 2f64.powi(e) > a {
        e -= 1;
    }
    let e = e.max(-14);
    let ulp = 2f64.powi(e - 10);
    let q = a / ulp;
    let r = q.round();
    let r = if (q - q.trunc()) == 0.5 && r % 2.0 != 0.0 {
        r - 1.0
    } else {
        r
    };
    sign * r * ulp
}

// Math.sumPrecise: a port of JavaScriptCore's small xsum accumulator (WTF PreciseSum, after Radford Neal's xsum),
// so results match the reference's host bit for bit, including its rounding of negative sums.
const XM_BITS: i64 = 52;
const XE_MASK: i64 = (1 << 11) - 1;
const XM_MASK: i64 = (1 << XM_BITS) - 1;
const XE_BIAS: i64 = (1 << 10) - 1;
const XSIGN: i64 = i64::MIN;
const XLOW_EXP_BITS: i64 = 5;
const XLOW_EXP_MASK: i64 = (1 << XLOW_EXP_BITS) - 1;
const XSCHUNKS: usize = (1 << (11 - XLOW_EXP_BITS)) + 3;
const XLOW_M_BITS: i64 = 1 << XLOW_EXP_BITS;
const XLOW_M_MASK: i64 = (1i64 << XLOW_M_BITS) - 1;
const XCARRY_TERMS: i64 = (1 << (63 - XM_BITS)) - 1;

struct Xsum {
    chunk: [i64; XSCHUNKS],
    adds_until_propagate: i64,
    inf: i64,
    nan: i64,
    count: usize,
    has_pos: bool,
}

impl Xsum {
    fn new() -> Xsum {
        Xsum {
            chunk: [0; XSCHUNKS],
            adds_until_propagate: XCARRY_TERMS,
            inf: 0,
            nan: 0,
            count: 0,
            has_pos: false,
        }
    }

    fn add_inf_nan(&mut self, ivalue: i64) {
        let mantissa = ivalue & XM_MASK;
        if mantissa == 0 {
            if self.inf == 0 {
                self.inf = ivalue;
            } else if self.inf != ivalue {
                self.inf = f64::NAN.to_bits() as i64;
            }
        } else if (self.nan & XM_MASK) <= mantissa {
            self.nan = ivalue & !XSIGN;
        }
    }

    fn carry_propagate(&mut self) -> usize {
        let mut u = XSCHUNKS as i64 - 1;
        while 0 <= u && self.chunk[u as usize] == 0 {
            if u == 0 {
                self.adds_until_propagate = XCARRY_TERMS - 1;
                return 0;
            }
            u -= 1;
        }
        let mut i: i64 = 0;
        let mut uix: i64 = -1;
        loop {
            let mut cv;
            loop {
                cv = self.chunk[i as usize];
                if cv != 0 {
                    break;
                }
                i += 1;
                if i > u {
                    break;
                }
            }
            if i > u {
                break;
            }
            let chigh = cv >> XLOW_M_BITS;
            if chigh == 0 {
                uix = i;
                i += 1;
                if i > u {
                    break;
                }
                continue;
            }
            if u == i {
                if chigh == -1 {
                    uix = i;
                    break;
                }
                u = i + 1;
            }
            let clow = cv & XLOW_M_MASK;
            if clow != 0 {
                uix = i;
            }
            self.chunk[i as usize] = clow;
            if i + 1 >= XSCHUNKS as i64 {
                self.add_inf_nan((XE_MASK << XM_BITS) | XM_MASK);
                u = i;
            } else {
                self.chunk[i as usize + 1] = self.chunk[i as usize + 1].wrapping_add(chigh);
            }
            i += 1;
            if i > u {
                break;
            }
        }
        if uix < 0 {
            self.adds_until_propagate = XCARRY_TERMS - 1;
            return 0;
        }
        while self.chunk[uix as usize] == -1 && uix > 0 {
            self.chunk[uix as usize - 1] =
                self.chunk[uix as usize - 1].wrapping_add(-(1i64 << XLOW_M_BITS));
            self.chunk[uix as usize] = 0;
            uix -= 1;
        }
        self.adds_until_propagate = XCARRY_TERMS - 1;
        uix as usize
    }

    fn add(&mut self, value: f64) {
        self.count += 1;
        self.has_pos = self.has_pos || !value.is_sign_negative();
        if self.adds_until_propagate == 0 {
            self.carry_propagate();
        }
        let ivalue = value.to_bits() as i64;
        let exp = (ivalue >> XM_BITS) & XE_MASK;
        let mut mantissa = ivalue & XM_MASK;
        let high = (exp >> XLOW_EXP_BITS) as usize;
        let mut low = exp & XLOW_EXP_MASK;
        if exp == 0 {
            if mantissa == 0 {
                self.adds_until_propagate -= 1;
                return;
            }
            low = 1;
        } else if exp == XE_MASK {
            self.add_inf_nan(ivalue);
            self.adds_until_propagate -= 1;
            return;
        } else {
            mantissa |= 1 << XM_BITS;
        }
        let lo = (((mantissa as u64) << low) as i64) & XLOW_M_MASK;
        let hi = mantissa >> (XLOW_M_BITS - low);
        if ivalue < 0 {
            self.chunk[high] = self.chunk[high].wrapping_sub(lo);
            self.chunk[high + 1] = self.chunk[high + 1].wrapping_sub(hi);
        } else {
            self.chunk[high] = self.chunk[high].wrapping_add(lo);
            self.chunk[high + 1] = self.chunk[high + 1].wrapping_add(hi);
        }
        self.adds_until_propagate -= 1;
    }

    fn compute(&mut self) -> f64 {
        if self.nan != 0 {
            return f64::from_bits(self.nan as u64);
        }
        if self.inf != 0 {
            return f64::from_bits(self.inf as u64);
        }
        if self.count == 0 {
            return -0.0;
        }
        let i = self.carry_propagate();
        let c = self.chunk;
        let mut ivalue = c[i];
        if i <= 1 {
            if ivalue == 0 {
                return if self.has_pos { 0.0 } else { -0.0 };
            }
            if i == 0 {
                let mut intv = if 0 <= ivalue { ivalue } else { -ivalue };
                intv >>= 1;
                if ivalue < 0 {
                    intv |= XSIGN;
                }
                return f64::from_bits(intv as u64);
            }
            let intv = ivalue
                .wrapping_mul(1i64 << (XLOW_M_BITS - 1))
                .wrapping_add(c[0] >> 1);
            if intv < 0 {
                if intv > -(1i64 << XM_BITS) {
                    return f64::from_bits(((-intv) | XSIGN) as u64);
                }
            } else if (intv as u64) < 1u64 << XM_BITS {
                return f64::from_bits(intv as u64);
            }
        }
        let fltv = ivalue as f64;
        let mut intv = fltv.to_bits() as i64;
        let mut e = (intv >> XM_BITS) & XE_MASK;
        let mut more = 2 + XM_BITS + XE_BIAS - e;
        ivalue = ivalue.wrapping_mul(1i64.wrapping_shl(more as u32));
        let mut j = i as i64 - 1;
        let mut lower = c[j as usize];
        if more >= XLOW_M_BITS {
            more -= XLOW_M_BITS;
            ivalue = ivalue.wrapping_add(lower.wrapping_shl(more as u32));
            j -= 1;
            lower = if j < 0 { 0 } else { c[j as usize] };
        }
        ivalue = ivalue.wrapping_add(lower >> (XLOW_M_BITS - more));
        lower &= (1i64 << (XLOW_M_BITS - more)) - 1;
        let mut away = false;
        let nonzero_below = |mut j: i64| {
            while j > 0 {
                j -= 1;
                if c[j as usize] != 0 {
                    return true;
                }
            }
            false
        };
        if 0 <= ivalue {
            intv = 0;
            if ivalue & 2 == 0 {
                away = false;
            } else if ivalue & 1 != 0 || ivalue & 4 != 0 {
                away = true;
            } else {
                if lower == 0 && nonzero_below(j) {
                    lower = 1;
                }
                if lower != 0 {
                    away = true;
                }
            }
        } else {
            if (-ivalue) & (1i64 << (XM_BITS + 2)) == 0 {
                let pos = 1i64 << (XLOW_M_BITS - 1 - more);
                ivalue = ivalue.wrapping_mul(2);
                if lower & pos != 0 {
                    ivalue += 1;
                    lower &= !pos;
                }
                e -= 1;
            }
            intv = XSIGN;
            ivalue = -ivalue;
            if ivalue & 3 == 3 {
                away = true;
            }
            // The reference's host predates WebKit's fix of this branch (8ee560d748ea): it also rounds a negative
            // sum away from zero whenever nothing nonzero lies below the kept bits. Kept for identical results.
            if lower == 0 && nonzero_below(j) {
                lower = 1;
            }
            if lower == 0 {
                away = true;
            }
        }
        if away {
            ivalue += 4;
            if ivalue & (1i64 << (XM_BITS + 3)) != 0 {
                ivalue >>= 1;
                e += 1;
            }
        }
        ivalue >>= 2;
        e += ((i as i64) << XLOW_EXP_BITS) - XE_BIAS - XM_BITS;
        if e >= XE_MASK {
            intv |= XE_MASK << XM_BITS;
            return f64::from_bits(intv as u64);
        }
        intv = intv.wrapping_add((e << XM_BITS).wrapping_add(ivalue & XM_MASK));
        f64::from_bits(intv as u64)
    }
}

/// `Math.sumPrecise` over numbers, as the reference's host computes it.
pub fn sum_precise(values: &[f64]) -> f64 {
    let mut x = Xsum::new();
    for v in values {
        x.add(*v);
    }
    x.compute()
}
