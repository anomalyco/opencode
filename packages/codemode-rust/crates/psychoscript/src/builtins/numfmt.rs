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

/// The exact sum of finite doubles, rounded once to the nearest double (ties to even).
pub fn sum_precise(values: &[f64]) -> f64 {
    if values.is_empty() {
        return -0.0;
    }
    let mut inf = 0i8;
    let mut all_neg_zero = true;
    for v in values {
        if v.is_nan() {
            return f64::NAN;
        }
        if v.is_infinite() {
            let s = if *v > 0.0 { 1 } else { -1 };
            if inf != 0 && inf != s {
                return f64::NAN;
            }
            inf = s;
        }
        if !(*v == 0.0 && v.is_sign_negative()) {
            all_neg_zero = false;
        }
    }
    if inf != 0 {
        return inf as f64 * f64::INFINITY;
    }
    if all_neg_zero {
        return -0.0;
    }
    // Fixed point with the least significant bit at 2^-1074, in 32-bit limbs held as i64.
    const LIMBS: usize = 72;
    let mut acc = [0i64; LIMBS];
    for v in values {
        let bits = v.to_bits();
        let raw = ((bits >> 52) & 0x7ff) as i64;
        let (m, shift) = if raw == 0 {
            (bits & ((1 << 52) - 1), 0)
        } else {
            ((bits & ((1 << 52) - 1)) | (1 << 52), raw - 1)
        };
        let s = if v.is_sign_negative() { -1 } else { 1 };
        let (word, bit) = (shift as usize / 32, shift as usize % 32);
        let wide = (m as u128) << bit;
        for k in 0..3 {
            acc[word + k] += s * (((wide >> (32 * k)) & 0xffff_ffff) as i64);
        }
        // Keep limbs bounded.
        let mut carry = 0i64;
        for l in acc.iter_mut() {
            let v = *l + carry;
            carry = v >> 32;
            *l = v & 0xffff_ffff;
        }
        acc[LIMBS - 1] += carry << 32;
    }
    let negative = acc[LIMBS - 1] < 0;
    if negative {
        let mut borrow = 0i64;
        for l in acc.iter_mut() {
            let v = -*l - borrow;
            borrow = if v < 0 { 1 } else { 0 };
            *l = v & 0xffff_ffff;
        }
    }
    let Some(top) = acc.iter().rposition(|l| *l != 0) else {
        return 0.0;
    };
    // The magnitude's bits, most significant first, then round to 53 bits.
    let bits_len = top * 32 + (64 - (acc[top] as u64).leading_zeros() as usize);
    let bit = |i: usize| (acc[i / 32] >> (i % 32)) & 1 == 1;
    let keep = if bits_len > 53 { 53 } else { bits_len };
    let low = bits_len - keep;
    let mut mant: u64 = 0;
    for i in (low..bits_len).rev() {
        mant = (mant << 1) | bit(i) as u64;
    }
    // Subnormal results keep fewer bits: the lowest kept bit may not go below 2^-1074.
    let mut value = if low > 0 {
        let half = bit(low - 1);
        let sticky = (0..low - 1).any(bit);
        if half && (sticky || mant & 1 == 1) {
            mant += 1;
        }
        mant as f64 * pow2(low as i64 - 1074)
    } else {
        mant as f64 * pow2(-1074)
    };
    if !value.is_finite() {
        value = f64::INFINITY;
    }
    if negative { -value } else { value }
}

/// 2^k for k in -1074..=1023, exactly.
fn pow2(k: i64) -> f64 {
    if k > 1023 {
        f64::INFINITY
    } else if k >= -1022 {
        f64::from_bits(((k + 1023) as u64) << 52)
    } else {
        f64::from_bits(1u64 << (k + 1074).max(0))
    }
}
