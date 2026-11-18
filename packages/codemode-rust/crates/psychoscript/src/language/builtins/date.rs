//! Date. Local time follows the host's time zone (`TZ`, else `/etc/localtime`), like the reference; the string forms
//! the reference makes deterministic (`toString`, `Date()`, `toLocale*String`) are ISO or `en-US` in UTC.

use std::sync::OnceLock;

use super::arg;
use super::fuel::Conversions;
use crate::object::*;
use crate::ops::Hint;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

const MS_PER_DAY: f64 = 86_400_000.0;
const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------- time model ----------

fn day(t: f64) -> f64 {
    (t / MS_PER_DAY).floor()
}

fn time_within_day(t: f64) -> f64 {
    t.rem_euclid(MS_PER_DAY)
}

/// Days since the epoch of a proleptic Gregorian date (month 1-12).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// (year, month 0-11, date 1-31) of a day number.
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m - 1, d)
}

/// The calendar fields of a finite time value.
#[derive(Clone, Copy)]
struct Fields {
    year: i64,
    month: i64,
    date: i64,
    hours: i64,
    minutes: i64,
    seconds: i64,
    ms: i64,
    weekday: i64,
}

fn fields(t: f64) -> Fields {
    let d = day(t) as i64;
    let (year, month, date) = civil_from_days(d);
    let w = time_within_day(t) as i64;
    Fields {
        year,
        month,
        date,
        hours: w / 3_600_000,
        minutes: w / 60_000 % 60,
        seconds: w / 1000 % 60,
        ms: w % 1000,
        weekday: (d + 4).rem_euclid(7),
    }
}

fn integer(x: f64) -> f64 {
    x.trunc() + 0.0
}

fn make_time(h: f64, m: f64, s: f64, ms: f64) -> f64 {
    if !(h.is_finite() && m.is_finite() && s.is_finite() && ms.is_finite()) {
        return f64::NAN;
    }
    integer(h) * 3_600_000.0 + integer(m) * 60_000.0 + integer(s) * 1000.0 + integer(ms)
}

fn make_day(year: f64, month: f64, date: f64) -> f64 {
    if !(year.is_finite() && month.is_finite() && date.is_finite()) {
        return f64::NAN;
    }
    let (y, m, dt) = (integer(year), integer(month), integer(date));
    let ym = y + (m / 12.0).floor();
    if ym.abs() > 400_000.0 {
        return f64::NAN;
    }
    let mn = m.rem_euclid(12.0);
    let days = days_from_civil(ym as i64, mn as i64 + 1, 1) as f64;
    days + dt - 1.0
}

fn make_date(day: f64, time: f64) -> f64 {
    if !(day.is_finite() && time.is_finite()) {
        return f64::NAN;
    }
    let tv = day * MS_PER_DAY + time;
    if !tv.is_finite() { f64::NAN } else { tv }
}

pub fn time_clip(t: f64) -> f64 {
    if !t.is_finite() || t.abs() > 8.64e15 {
        return f64::NAN;
    }
    integer(t)
}

// ---------- local time ----------

fn zone() -> Option<&'static tz::TimeZone> {
    static ZONE: OnceLock<Option<tz::TimeZone>> = OnceLock::new();
    ZONE.get_or_init(|| {
        let from_env = std::env::var("TZ")
            .ok()
            .filter(|s| !s.is_empty())
            .and_then(|s| tz::TimeZone::from_posix_tz(&s).ok());
        from_env.or_else(|| tz::TimeZone::local().ok())
    })
    .as_ref()
}

/// The zone's offset from UTC in milliseconds at UTC time `t`, with its designation.
fn offset_at(t: f64) -> (f64, String) {
    let Some(z) = zone() else {
        return (0.0, "UTC".into());
    };
    let secs = (t / 1000.0).floor().clamp(-8.64e12, 8.64e12) as i64;
    match z.find_local_time_type(secs) {
        Ok(lt) => (
            lt.ut_offset() as f64 * 1000.0,
            lt.time_zone_designation().to_owned(),
        ),
        Err(_) => (0.0, "UTC".into()),
    }
}

fn local_time(t: f64) -> f64 {
    t + offset_at(t).0
}

/// UTC(t): the UTC time of local time `t`.
fn utc(t: f64) -> f64 {
    if !t.is_finite() {
        return f64::NAN;
    }
    let guess = t - offset_at(t).0;
    t - offset_at(guess).0
}

fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

// ---------- formatting ----------

fn year_text(y: i64) -> String {
    if y < 0 {
        format!("-{:04}", -y)
    } else {
        format!("{y:04}")
    }
}

pub fn iso_string(t: f64) -> String {
    let f = fields(t);
    let year = if (0..=9999).contains(&f.year) {
        format!("{:04}", f.year)
    } else if f.year < 0 {
        format!("-{:06}", -f.year)
    } else {
        format!("+{:06}", f.year)
    };
    format!(
        "{year}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        f.month + 1,
        f.date,
        f.hours,
        f.minutes,
        f.seconds,
        f.ms
    )
}

/// The deterministic string form: ISO, or `Invalid Date`.
pub fn display(t: f64) -> String {
    if t.is_finite() {
        iso_string(t)
    } else {
        "Invalid Date".into()
    }
}

fn utc_string(t: f64) -> String {
    let f = fields(t);
    format!(
        "{}, {:02} {} {} {:02}:{:02}:{:02} GMT",
        DAYS[f.weekday as usize],
        f.date,
        MONTHS[f.month as usize],
        year_text(f.year),
        f.hours,
        f.minutes,
        f.seconds
    )
}

fn date_string(t: f64) -> String {
    let f = fields(local_time(t));
    format!(
        "{} {} {:02} {}",
        DAYS[f.weekday as usize],
        MONTHS[f.month as usize],
        f.date,
        year_text(f.year)
    )
}

fn zone_name(designation: &str, offset: f64) -> String {
    match designation {
        "UTC" | "UCT" | "Zulu" | "Z" => "Coordinated Universal Time".into(),
        "GMT" if offset == 0.0 => "Greenwich Mean Time".into(),
        d => d.to_owned(),
    }
}

fn time_string(t: f64) -> String {
    let (offset, designation) = offset_at(t);
    let f = fields(t + offset);
    let mins = (offset / 60_000.0) as i64;
    format!(
        "{:02}:{:02}:{:02} GMT{}{:02}{:02} ({})",
        f.hours,
        f.minutes,
        f.seconds,
        if mins < 0 { '-' } else { '+' },
        mins.abs() / 60,
        mins.abs() % 60,
        zone_name(&designation, offset)
    )
}

fn locale_date(f: &Fields) -> String {
    let year = if f.year <= 0 { 1 - f.year } else { f.year };
    format!("{}/{}/{}", f.month + 1, f.date, year)
}

fn locale_time(f: &Fields) -> String {
    let h = f.hours % 12;
    format!(
        "{}:{:02}:{:02} {}",
        if h == 0 { 12 } else { h },
        f.minutes,
        f.seconds,
        if f.hours < 12 { "AM" } else { "PM" }
    )
}

// ---------- parsing ----------

fn digits(b: &[u8], i: &mut usize, n: usize) -> Option<i64> {
    if *i + n > b.len() || !b[*i..*i + n].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let v = std::str::from_utf8(&b[*i..*i + n]).ok()?.parse().ok()?;
    *i += n;
    Some(v)
}

/// The ECMAScript date-time string format, as JavaScriptCore accepts it.
fn parse_iso(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let mut i = 0;
    let year = match b.first()? {
        b'+' | b'-' => {
            let neg = b[0] == b'-';
            i = 1;
            let y = digits(b, &mut i, 6)?;
            if neg && y == 0 {
                return None;
            }
            if neg { -y } else { y }
        }
        _ => digits(b, &mut i, 4)?,
    };
    let (mut month, mut dt) = (1, 1);
    if i < b.len() && b[i] == b'-' {
        i += 1;
        month = digits(b, &mut i, 2)?;
        if i < b.len() && b[i] == b'-' {
            i += 1;
            dt = digits(b, &mut i, 2)?;
        }
    }
    if !(1..=12).contains(&month) || !(1..=31).contains(&dt) {
        return None;
    }
    let (mut h, mut m, mut sec, mut ms) = (0, 0, 0, 0.0);
    let mut offset: Option<f64> = None;
    let mut has_time = false;
    if i < b.len() && (b[i] == b'T' || b[i] == b't') {
        has_time = true;
        i += 1;
        h = digits(b, &mut i, 2)?;
        if b.get(i) != Some(&b':') {
            return None;
        }
        i += 1;
        m = digits(b, &mut i, 2)?;
        if b.get(i) == Some(&b':') {
            i += 1;
            sec = digits(b, &mut i, 2)?;
            if b.get(i) == Some(&b'.') {
                i += 1;
                let start = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i == start {
                    return None;
                }
                let frac = &s[start..(start + 3).min(i)];
                ms = format!("{frac:0<3}").parse::<f64>().ok()?;
            }
        }
        if h > 24 || m > 59 || sec > 59 || (h == 24 && (m > 0 || sec > 0 || ms > 0.0)) {
            return None;
        }
        match b.get(i) {
            Some(b'Z') | Some(b'z') => {
                offset = Some(0.0);
                i += 1;
            }
            Some(b'+') | Some(b'-') => {
                let sign = if b[i] == b'-' { -1.0 } else { 1.0 };
                i += 1;
                let oh = digits(b, &mut i, 2)?;
                if b.get(i) == Some(&b':') {
                    i += 1;
                }
                let om = digits(b, &mut i, 2)?;
                if oh > 23 || om > 59 {
                    return None;
                }
                offset = Some(sign * (oh * 60 + om) as f64 * 60_000.0);
            }
            _ => {}
        }
    } else if i < b.len() && (b[i] == b'Z' || b[i] == b'z') {
        offset = Some(0.0);
        i += 1;
    }
    if i != b.len() {
        return None;
    }
    let dayn = make_day(year as f64, (month - 1) as f64, dt as f64);
    let t = make_date(dayn, make_time(h as f64, m as f64, sec as f64, ms));
    Some(match offset {
        Some(o) => t - o,
        None if has_time => utc(t),
        None => t,
    })
}

#[derive(Debug)]
enum Tok {
    Num(i64, usize),
    Word(String),
    Sign(char),
    Punct(char),
}

fn tokens(s: &str) -> Option<Vec<Tok>> {
    let mut out = Vec::new();
    let mut chars = s.chars().peekable();
    let mut depth = 0;
    while let Some(&c) = chars.peek() {
        if depth > 0 {
            chars.next();
            match c {
                '(' => depth += 1,
                ')' => depth -= 1,
                _ => {}
            }
            continue;
        }
        if c == '(' {
            depth = 1;
            chars.next();
        } else if c.is_ascii_digit() {
            let mut n = String::new();
            while let Some(&d) = chars.peek() {
                if !d.is_ascii_digit() {
                    break;
                }
                n.push(d);
                chars.next();
            }
            out.push(Tok::Num(n.parse().unwrap_or(i64::MAX), n.len()));
        } else if c.is_alphabetic() {
            let mut w = String::new();
            while let Some(&d) = chars.peek() {
                if !d.is_alphabetic() && d != '.' {
                    break;
                }
                if d != '.' {
                    w.push(d.to_ascii_lowercase());
                }
                chars.next();
            }
            out.push(Tok::Word(w));
        } else if c == '+' || c == '-' {
            out.push(Tok::Sign(c));
            chars.next();
        } else if c.is_whitespace() || c == ',' {
            chars.next();
            if c == ',' {
                out.push(Tok::Punct(','));
            }
        } else if c == ':' || c == '/' || c == '.' {
            out.push(Tok::Punct(c));
            chars.next();
        } else {
            return None;
        }
    }
    Some(out)
}

fn month_of(w: &str) -> Option<i64> {
    if w.len() < 3 {
        return None;
    }
    const NAMES: [&str; 12] = [
        "january",
        "february",
        "march",
        "april",
        "may",
        "june",
        "july",
        "august",
        "september",
        "october",
        "november",
        "december",
    ];
    NAMES
        .iter()
        .position(|n| n.starts_with(w))
        .map(|i| i as i64)
}

fn weekday_word(w: &str) -> bool {
    const NAMES: [&str; 7] = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    ];
    w.len() >= 3 && NAMES.iter().any(|n| n.starts_with(w))
}

fn zone_word(w: &str) -> Option<i64> {
    Some(match w {
        "gmt" | "utc" | "ut" | "z" => 0,
        "est" => -300,
        "edt" => -240,
        "cst" => -360,
        "cdt" => -300,
        "mst" => -420,
        "mdt" => -360,
        "pst" => -480,
        "pdt" => -420,
        _ => return None,
    })
}

/// The fallback formats JavaScriptCore accepts: RFC 2822, `toString` output, `Month D, YYYY`, `M/D/YYYY` and
/// the like, in local time unless a zone is given.
fn parse_legacy(s: &str) -> Option<f64> {
    let toks = tokens(s)?;
    let (mut year, mut month, mut dt): (Option<i64>, Option<i64>, Option<i64>) = (None, None, None);
    let (mut h, mut mi, mut sec, mut ms) = (None::<i64>, 0i64, 0i64, 0i64);
    let mut pm: Option<bool> = None;
    let mut offset: Option<i64> = None;
    let mut nums: Vec<(i64, usize)> = Vec::new();
    let mut i = 0;
    let num_at = |i: usize| match toks.get(i) {
        Some(Tok::Num(n, l)) => Some((*n, *l)),
        _ => None,
    };
    let punct_at = |i: usize, c: char| matches!(toks.get(i), Some(Tok::Punct(p)) if *p == c);
    while i < toks.len() {
        match &toks[i] {
            Tok::Word(w) => {
                if let Some(m) = month_of(w) {
                    if month.is_some() {
                        return None;
                    }
                    month = Some(m);
                } else if w == "am" || w == "pm" {
                    pm = Some(w == "pm");
                } else if let Some(z) = zone_word(w) {
                    offset = Some(z);
                    if let Some(Tok::Sign(sg)) = toks.get(i + 1)
                        && let Some((n, l)) = num_at(i + 2)
                    {
                        let mins = if l <= 2 {
                            n * 60
                        } else {
                            n / 100 * 60 + n % 100
                        };
                        offset = Some(if *sg == '-' { -mins } else { mins });
                        i += 2;
                    }
                } else if !weekday_word(w) {
                    return None;
                }
                i += 1;
            }
            Tok::Num(n, l) => {
                let (n, l) = (*n, *l);
                if punct_at(i + 1, ':') && h.is_none() {
                    h = Some(n);
                    mi = num_at(i + 2)?.0;
                    i += 3;
                    if punct_at(i, ':') {
                        sec = num_at(i + 1)?.0;
                        i += 2;
                        if punct_at(i, '.')
                            && let Some((f, fl)) = num_at(i + 1)
                        {
                            ms = (f as f64 / 10f64.powi(fl as i32 - 3)).floor() as i64;
                            i += 2;
                        }
                    }
                    continue;
                }
                if punct_at(i + 1, '/') {
                    let (b2, _) = num_at(i + 2)?;
                    let c = if punct_at(i + 3, '/') {
                        let c = num_at(i + 4)?;
                        i += 5;
                        Some(c)
                    } else {
                        i += 3;
                        None
                    };
                    if l >= 3 {
                        year = Some(n);
                        month = Some(b2 - 1);
                        dt = Some(c?.0);
                    } else {
                        month = Some(n - 1);
                        dt = Some(b2);
                        if let Some((c, cl)) = c {
                            year = Some(if cl <= 2 {
                                c + if c < 50 { 2000 } else { 1900 }
                            } else {
                                c
                            });
                        }
                    }
                    continue;
                }
                if matches!(toks.get(i + 1), Some(Tok::Sign('-')))
                    && let Some((b2, _)) = num_at(i + 2)
                {
                    if matches!(toks.get(i + 3), Some(Tok::Sign('-')))
                        && let Some((c, _)) = num_at(i + 4)
                    {
                        year = Some(n);
                        month = Some(b2 - 1);
                        dt = Some(c);
                        i += 5;
                        continue;
                    }
                    return None;
                }
                nums.push((n, l));
                i += 1;
            }
            Tok::Sign(sg) => {
                let (n, l) = num_at(i + 1)?;
                if h.is_some() && offset.is_none() || offset == Some(0) && l == 4 {
                    let mins = if l <= 2 {
                        n * 60
                    } else {
                        n / 100 * 60 + n % 100
                    };
                    offset = Some(if *sg == '-' { -mins } else { mins });
                    i += 2;
                } else {
                    return None;
                }
            }
            Tok::Punct(_) => i += 1,
        }
    }
    if month.is_none()
        && let Some((n, _)) = nums.first()
        && (1..=12).contains(n)
    {
        month = Some(n - 1);
        nums.remove(0);
    }
    for (n, l) in nums {
        if month.is_some() && dt.is_none() && l <= 2 && n <= 31 {
            dt = Some(n);
        } else if year.is_none() {
            year = Some(if l <= 2 {
                n + if n < 50 { 2000 } else { 1900 }
            } else {
                n
            });
        } else if dt.is_none() && n <= 31 {
            dt = Some(n);
        } else {
            return None;
        }
    }
    let month = month?;
    let year = year.unwrap_or(2001);
    let dt = dt.unwrap_or(1);
    let mut hour = h.unwrap_or(0);
    if let Some(pm) = pm {
        if hour > 12 {
            return None;
        }
        if hour == 12 {
            hour = 0;
        }
        if pm {
            hour += 12;
        }
    }
    if !(0..=11).contains(&month) || !(1..=31).contains(&dt) || hour > 24 || mi > 59 || sec > 59 {
        return None;
    }
    let dayn = make_day(year as f64, month as f64, dt as f64);
    let t = make_date(
        dayn,
        make_time(hour as f64, mi as f64, sec as f64, ms as f64),
    );
    Some(match offset {
        Some(o) => t - o as f64 * 60_000.0,
        None => utc(t),
    })
}

pub fn parse(s: &str) -> f64 {
    let t = parse_iso(s).or_else(|| parse_legacy(s.trim()));
    time_clip(t.unwrap_or(f64::NAN))
}

// ---------- built-ins ----------

pub fn setup(vm: &mut Vm) {
    let op = vm.realm.object_proto;
    let proto = vm.plain(op);
    vm.realm.std.date = proto;
    let ctor = vm.ctor("Date", 7, date_ctor, proto, Value::Undef);
    vm.methods(
        ctor,
        &[
            ("now", 0, date_now),
            ("parse", 1, date_parse),
            ("UTC", 7, date_utc),
        ],
    );
    vm.methods(
        proto,
        &[
            ("getTime", 0, get_time),
            ("valueOf", 0, get_time),
            ("toISOString", 0, to_iso_string),
            ("toJSON", 1, to_json),
            ("toString", 0, to_string),
            ("toDateString", 0, to_date_string),
            ("toTimeString", 0, to_time_string),
            ("toUTCString", 0, to_utc_string),
            ("toGMTString", 0, to_utc_string),
            ("toLocaleString", 0, to_locale_string),
            ("toLocaleDateString", 0, to_locale_date_string),
            ("toLocaleTimeString", 0, to_locale_time_string),
            ("getTimezoneOffset", 0, get_timezone_offset),
        ],
    );
    for (i, name) in GETTERS.iter().enumerate() {
        let f = vm.native_fn(name, 0, getter, Value::Num(i as f64));
        let k = vm.atoms.intern_static(name);
        vm.define_hidden(proto, k, f);
    }
    for (i, (name, len)) in SETTERS.iter().enumerate() {
        let f = vm.native_fn(name, *len, setter, Value::Num(i as f64));
        let k = vm.atoms.intern_static(name);
        vm.define_hidden(proto, k, f);
    }
}

pub fn new_date(vm: &mut Vm, t: f64) -> Value {
    super::ensure(vm, super::LAZY_DATE);
    let proto = vm.realm.std.date;
    Value::Obj(vm.alloc(Obj::new(Some(proto), Kind::Date(t))))
}

pub fn time_of(vm: &Vm, v: &Value) -> Option<f64> {
    match v {
        Value::Obj(id) => match vm.heap[*id as usize].kind {
            Kind::Date(t) => Some(t),
            _ => None,
        },
        _ => None,
    }
}

fn this_date(vm: &mut Vm, this: &Value, name: &str) -> Result<(Id, f64), Value> {
    if let Value::Obj(id) = this
        && let Kind::Date(t) = vm.heap[*id as usize].kind
    {
        return Ok((*id, t));
    }
    Err(super::incompatible(
        vm,
        &format!("Date.prototype.{name}"),
        this,
    ))
}

/// The reference's `toNumbers` over at most seven components: one list of conversions, each made a number in turn.
fn numbers(vm: &mut Vm, c: &mut Conversions, args: &[Value]) -> Result<Vec<f64>, Value> {
    let args = c.converted(vm, &[Hint::Number], &args[..args.len().min(7)], true)?;
    let mut out = Vec::with_capacity(args.len());
    for a in args.iter() {
        out.push(vm.number_of(a)?);
    }
    Ok(out)
}

/// Year, month and the rest as `new Date(...)` and `Date.UTC` read them; two-digit years are 19xx.
fn from_components(n: &[f64]) -> f64 {
    let get = |i: usize, d: f64| n.get(i).copied().unwrap_or(d);
    let mut y = get(0, f64::NAN);
    if !y.is_nan() {
        let yi = integer(y);
        if (0.0..=99.0).contains(&yi) {
            y = 1900.0 + yi;
        }
    }
    let dayn = make_day(y, get(1, 0.0), get(2, 1.0));
    make_date(
        dayn,
        make_time(get(3, 0.0), get(4, 0.0), get(5, 0.0), get(6, 0.0)),
    )
}

fn date_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if !matches!(this, Value::Uninit) {
        let s = iso_string(now());
        return Ok(vm.string_val(s));
    }
    let mut c = Conversions::default();
    let t = match args.len() {
        0 => now(),
        1 => {
            if let Some(t) = time_of(vm, &args[0]) {
                t
            } else {
                let mut p = [args[0]];
                c.convert(vm, &[Hint::Default], &mut p, false)?;
                match p[0] {
                    Value::Str(s) => parse(vm.text(s)),
                    v => time_clip(vm.number_of(&v)?),
                }
            }
        }
        _ => {
            let n = numbers(vm, &mut c, args)?;
            time_clip(utc(from_components(&n)))
        }
    };
    let r = Ok(new_date(vm, t));
    c.finish(vm, r)
}

fn date_now(_vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    Ok(Value::Num(now()))
}

fn date_parse(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let s = vm.string_of(&arg(args, 0))?;
    Ok(Value::Num(parse(vm.text(s))))
}

fn date_utc(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let mut c = Conversions::default();
    let n = numbers(vm, &mut c, args)?;
    c.finish(vm, Ok(Value::Num(time_clip(from_components(&n)))))
}

fn get_time(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(Value::Num(this_date(vm, &this, "getTime")?.1))
}

fn to_iso_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let t = this_date(vm, &this, "toISOString")?.1;
    if !t.is_finite() {
        return Err(vm.range_error("Invalid time value."));
    }
    let s = iso_string(t);
    Ok(vm.string_val(s))
}

fn to_json(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let t = this_date(vm, &this, "toJSON")?.1;
    if !t.is_finite() {
        return Ok(Value::Null);
    }
    let s = iso_string(t);
    Ok(vm.string_val(s))
}

fn format_with(vm: &mut Vm, this: &Value, name: &str, f: fn(f64) -> String) -> Res {
    let t = this_date(vm, this, name)?.1;
    let s = if t.is_finite() {
        f(t)
    } else {
        "Invalid Date".into()
    };
    Ok(vm.string_val(s))
}

fn to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toString", iso_string)
}

fn to_date_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toDateString", date_string)
}

fn to_time_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toTimeString", time_string)
}

fn to_utc_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toUTCString", utc_string)
}

fn to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toLocaleString", |t| {
        let f = fields(t);
        format!("{}, {}", locale_date(&f), locale_time(&f))
    })
}

fn to_locale_date_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toLocaleDateString", |t| locale_date(&fields(t)))
}

fn to_locale_time_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    format_with(vm, &this, "toLocaleTimeString", |t| locale_time(&fields(t)))
}

fn get_timezone_offset(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let t = this_date(vm, &this, "getTimezoneOffset")?.1;
    if !t.is_finite() {
        return Ok(Value::Num(f64::NAN));
    }
    Ok(Value::Num((t - local_time(t)) / 60_000.0 + 0.0))
}

const GETTERS: [&str; 16] = [
    "getFullYear",
    "getMonth",
    "getDate",
    "getDay",
    "getHours",
    "getMinutes",
    "getSeconds",
    "getMilliseconds",
    "getUTCFullYear",
    "getUTCMonth",
    "getUTCDate",
    "getUTCDay",
    "getUTCHours",
    "getUTCMinutes",
    "getUTCSeconds",
    "getUTCMilliseconds",
];

fn getter(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    let which = match vm.native_data(callee) {
        Value::Num(n) => n as usize,
        _ => 0,
    };
    let (_, t) = this_date(vm, &this, GETTERS[which])?;
    if !t.is_finite() {
        return Ok(Value::Num(f64::NAN));
    }
    let local = which < 8;
    let f = fields(if local { local_time(t) } else { t });
    Ok(Value::Num(match which % 8 {
        0 => f.year,
        1 => f.month,
        2 => f.date,
        3 => f.weekday,
        4 => f.hours,
        5 => f.minutes,
        6 => f.seconds,
        _ => f.ms,
    } as f64))
}

const SETTERS: [(&str, u8); 15] = [
    ("setTime", 1),
    ("setMilliseconds", 1),
    ("setUTCMilliseconds", 1),
    ("setSeconds", 2),
    ("setUTCSeconds", 2),
    ("setMinutes", 3),
    ("setUTCMinutes", 3),
    ("setHours", 4),
    ("setUTCHours", 4),
    ("setDate", 1),
    ("setUTCDate", 1),
    ("setMonth", 2),
    ("setUTCMonth", 2),
    ("setFullYear", 3),
    ("setUTCFullYear", 3),
];

fn setter(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let mut c = Conversions::default();
    let r = set(vm, &mut c, this, args, callee);
    c.finish(vm, r)
}

/// A setter after the receiver's check: its time, then the arguments it reads, are one list of conversions, each
/// made a number in turn.
fn set(vm: &mut Vm, c: &mut Conversions, this: Value, args: &[Value], callee: Id) -> Res {
    let which = match vm.native_data(callee) {
        Value::Num(n) => n as usize,
        _ => 0,
    };
    let (name, len) = SETTERS[which];
    let (id, time) = this_date(vm, &this, name)?;
    let given = &args[..args.len().min(len as usize)];
    let mut listed = Vec::with_capacity(given.len() + 1);
    listed.push(Value::Num(time));
    listed.extend_from_slice(given);
    c.convert(vm, &[Hint::Number], &mut listed, true)?;
    // The time as the list kept it: read before the conversions, which a rerun after them must not read again.
    let time = listed[0].as_num();
    let mut v = Vec::with_capacity(given.len());
    for a in &listed[1..] {
        v.push(vm.number_of(a)?);
    }
    let full_year = which >= 13;
    if which != 0 && !full_year && time.is_nan() {
        return Ok(Value::Num(f64::NAN));
    }
    let local = which != 0 && (which % 2 == 1);
    let arg = |i: usize| v.get(i).copied();
    let new = if which == 0 {
        time_clip(arg(0).unwrap_or(f64::NAN))
    } else {
        let t = if time.is_nan() {
            0.0
        } else if local {
            local_time(time)
        } else {
            time
        };
        let f = fields(t);
        let (h, m, s, ms) = (
            f.hours as f64,
            f.minutes as f64,
            f.seconds as f64,
            f.ms as f64,
        );
        let d = day(t);
        let (y, mo, dt) = (f.year as f64, f.month as f64, f.date as f64);
        let first = arg(0).unwrap_or(f64::NAN);
        let date = match which {
            1 | 2 => make_date(d, make_time(h, m, s, first)),
            3 | 4 => make_date(d, make_time(h, m, first, arg(1).unwrap_or(ms))),
            5 | 6 => make_date(
                d,
                make_time(h, first, arg(1).unwrap_or(s), arg(2).unwrap_or(ms)),
            ),
            7 | 8 => make_date(
                d,
                make_time(
                    first,
                    arg(1).unwrap_or(m),
                    arg(2).unwrap_or(s),
                    arg(3).unwrap_or(ms),
                ),
            ),
            9 | 10 => make_date(make_day(y, mo, first), time_within_day(t)),
            11 | 12 => make_date(make_day(y, first, arg(1).unwrap_or(dt)), time_within_day(t)),
            _ => make_date(
                make_day(first, arg(1).unwrap_or(mo), arg(2).unwrap_or(dt)),
                time_within_day(t),
            ),
        };
        time_clip(if local { utc(date) } else { date })
    };
    vm.heap[id as usize].kind = Kind::Date(new);
    Ok(Value::Num(new))
}
