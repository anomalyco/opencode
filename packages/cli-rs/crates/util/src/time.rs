//! Civil dates and times on the C library: days to dates and back (Howard Hinnant's algorithms), the few formats the
//! client prints, RFC 3339 and `%Y-%m-%d` parsing as `chrono` parses them, and local offsets from `localtime_r`,
//! which reads `TZ` and `/etc/localtime`. Instants are milliseconds since the Unix epoch.

use std::fmt;
use std::sync::Once;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The years `chrono` represents; an instant outside them is invalid, as it was.
const MIN_YEAR: i32 = (i32::MIN >> 13) + 1;
const MAX_YEAR: i32 = (i32::MAX >> 13) - 1;
const DAY_MS: i64 = 86_400_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Date {
    pub year: i32,
    pub month: u32,
    pub day: u32,
}

impl Default for Date {
    fn default() -> Self {
        Self { year: 1970, month: 1, day: 1 }
    }
}

impl Date {
    pub fn new(year: i32, month: u32, day: u32) -> Option<Self> {
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let last = match month {
            2 if leap => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            1..=12 => 31,
            _ => return None,
        };
        ((MIN_YEAR..=MAX_YEAR).contains(&year) && (1..=last).contains(&day)).then_some(Self { year, month, day })
    }

    /// The date `days` after 1970-01-01.
    pub fn from_days(days: i64) -> Self {
        let days = days + 719_468;
        let era = days.div_euclid(146_097);
        let day_of_era = days - era * 146_097;
        let year_of_era = (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
        let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
        let shifted = (5 * day_of_year + 2) / 153;
        let month = if shifted < 10 { shifted + 3 } else { shifted - 9 };
        Self {
            year: (year_of_era + era * 400 + i64::from(month <= 2)) as i32,
            month: month as u32,
            day: (day_of_year - (153 * shifted + 2) / 5 + 1) as u32,
        }
    }

    /// Days since 1970-01-01.
    pub fn days(self) -> i64 {
        let month = i64::from(self.month);
        let year = i64::from(self.year) - i64::from(month <= 2);
        let era = year.div_euclid(400);
        let year_of_era = year - era * 400;
        let day_of_year = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + i64::from(self.day) - 1;
        era * 146_097 + year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year - 719_468
    }

    /// 0 for Monday through 6 for Sunday.
    pub fn weekday_from_monday(self) -> u32 {
        (self.days() + 3).rem_euclid(7) as u32
    }

    /// `NaiveDate::parse_from_str(text, "%Y-%m-%d")`.
    pub fn parse(text: &str) -> Option<Self> {
        let fields = fields(text, "%Y-%m-%d")?;
        Self::new(fields.year?, fields.month?, fields.day?)
    }
}

/// `%Y-%m-%d`.
impl fmt::Display for Date {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}-{:02}-{:02}", Year(self.year), self.month, self.day)
    }
}

/// A wall clock reading: a date and the time of day. `millis` passes 999 only in a leap second.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DateTime {
    pub date: Date,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub millis: u32,
}

impl DateTime {
    fn from_millis(ms: i64) -> Self {
        let time = ms.rem_euclid(DAY_MS) as u32;
        Self {
            date: Date::from_days(ms.div_euclid(DAY_MS)),
            hour: time / 3_600_000,
            minute: time / 60_000 % 60,
            second: time / 1000 % 60,
            millis: time % 1000,
        }
    }

    /// `%Y-%m-%dT%H:%M:%S%.3fZ` (`Date.prototype.toISOString` of a UTC reading).
    pub fn iso(&self) -> String {
        format!("{}T{:02}:{:02}:{:02}.{:03}Z", self.date, self.hour, self.minute, self.second, self.millis)
    }

    /// `%Y%m%dT%H%M%SZ`.
    pub fn compact(&self) -> String {
        let date = self.date;
        let (hour, minute, second) = (self.hour, self.minute, self.second);
        format!("{}{:02}{:02}T{hour:02}{minute:02}{second:02}Z", Year(date.year), date.month, date.day)
    }

    /// `%-m/%-d/%Y`.
    pub fn numeric_date(&self) -> String {
        format!("{}/{}/{}", self.date.month, self.date.day, Year(self.date.year))
    }

    /// `%-I:%M<space>%p`.
    pub fn short_time(&self, space: &str) -> String {
        format!("{}:{:02}{space}{}", self.hour12(), self.minute, self.meridiem())
    }

    /// `%-m/%-d/%Y, %-I:%M:%S %p`.
    pub fn locale_string(&self) -> String {
        let (hour, minute, second) = (self.hour12(), self.minute, self.second);
        format!("{}, {hour}:{minute:02}:{second:02} {}", self.numeric_date(), self.meridiem())
    }

    /// `%a %b %d %Y`.
    pub fn date_string(&self) -> String {
        let date = self.date;
        let weekday = WEEKDAYS[(date.weekday_from_monday() as usize + 1) % 7];
        format!("{weekday} {} {:02} {}", self.month_name(), date.day, Year(date.year))
    }

    /// `%b %-d`.
    pub fn month_day(&self) -> String {
        format!("{} {}", self.month_name(), self.date.day)
    }

    /// `%b`.
    pub fn month_name(&self) -> &'static str {
        MONTHS[self.date.month as usize - 1]
    }

    fn hour12(&self) -> u32 {
        (self.hour + 11) % 12 + 1
    }

    fn meridiem(&self) -> &'static str {
        if self.hour < 12 { "AM" } else { "PM" }
    }
}

/// `%Y`: four digits, with a sign outside 0 to 9999.
struct Year(i32);

impl fmt::Display for Year {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            year @ 0..=9999 => write!(f, "{year:04}"),
            year => write!(f, "{year:+05}"),
        }
    }
}

/// A time zone: the process's local zone, or a fixed offset in seconds east of UTC.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Zone {
    Local,
    Fixed(i32),
}

pub const UTC: Zone = Zone::Fixed(0);

impl Zone {
    /// Seconds east of UTC at `ms`.
    pub fn offset(self, ms: i64) -> i32 {
        match self {
            Zone::Fixed(offset) => offset,
            Zone::Local => local_offset(ms.div_euclid(1000)),
        }
    }

    /// The wall clock at `ms`, or `None` outside the years `chrono` represents.
    pub fn at(self, ms: i64) -> Option<DateTime> {
        let year = Date::from_days(ms.div_euclid(DAY_MS)).year;
        (MIN_YEAR..=MAX_YEAR).contains(&year).then(|| DateTime::from_millis(ms + i64::from(self.offset(ms)) * 1000))
    }

    /// The instant whose wall clock reads `date` and `seconds` past its midnight, as `chrono`'s
    /// `from_local_datetime(..).earliest()` picks it: in an overlap the reading with the smaller offset, which is the
    /// later instant; at the start of a gap the transition itself; inside a gap `None`.
    pub fn instant(self, date: Date, seconds: i64) -> Option<i64> {
        let wall = date.days() * 86_400 + seconds;
        let offset = match self {
            Zone::Fixed(offset) => return Some((wall - i64::from(offset)) * 1000),
            Zone::Local => |at| i64::from(local_offset(at)),
        };
        // Each offset in use within a day of the reading is a candidate. It fits if the zone has it at the instant it
        // names, or just before, when that instant is a transition.
        (-4..=4)
            .map(|step| offset(wall + step * 21_600))
            .map(|candidate| (candidate, wall - candidate))
            .filter(|(candidate, at)| offset(*at) == *candidate || offset(at - 1) == *candidate)
            .map(|(_, at)| at * 1000)
            .max()
    }
}

/// The ISO time of `ms` in UTC, or `None` outside the years `chrono` represents.
pub fn iso(ms: i64) -> Option<String> {
    UTC.at(ms).map(|time| time.iso())
}

pub fn now_ms() -> i64 {
    millis(SystemTime::now())
}

/// Milliseconds since the epoch, rounded down.
pub fn millis(time: SystemTime) -> i64 {
    match time.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_millis() as i64,
        Err(before) => {
            let before = before.duration();
            -(before.as_millis() as i64) - i64::from(before.subsec_nanos() % 1_000_000 != 0)
        }
    }
}

/// `DateTime::parse_from_rfc3339(text)` as milliseconds: `YYYY-MM-DD`, `T`, `t` or a space, `HH:MM:SS`, any number of
/// fraction digits, then `Z`, `z` or `±HH:MM`. A leap second (`:60`) counts into the next second.
pub fn parse_rfc3339(text: &str) -> Option<i64> {
    let bytes = text.as_bytes();
    if bytes.len() < 19 || !matches!(bytes[10], b'T' | b't' | b' ') {
        return None;
    }
    let separated = [(4, b'-'), (7, b'-'), (13, b':'), (16, b':')].iter().all(|(at, byte)| bytes[*at] == *byte);
    let number = |at: usize, len: usize| {
        bytes[at..at + len].iter().try_fold(0, |n, c| c.is_ascii_digit().then(|| n * 10 + u32::from(c - b'0')))
    };
    let date = Date::new(number(0, 4)? as i32, number(5, 2)?, number(8, 2)?)?;
    let (hour, minute, second) = (number(11, 2)?, number(14, 2)?, number(17, 2)?);
    if !separated || hour > 23 || minute > 59 || second > 60 {
        return None;
    }
    let (rest, nanos) = match text[19..].strip_prefix('.') {
        Some(fraction) => nanosecond(fraction)?,
        None => (&text[19..], 0),
    };
    let leap = u32::from(second == 60);
    let seconds = date.days() * 86_400 + i64::from(hour * 3600 + minute * 60 + second - leap) - offset(rest)?;
    Some(seconds * 1000 + i64::from(leap * 1000 + nanos / 1_000_000))
}

/// `NaiveDateTime::parse_from_str(text, format)` for formats of `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%.f`, spaces
/// and other literal characters. A number may follow spaces, and `%Y` may take a sign and more digits.
pub fn parse(text: &str, format: &str) -> Option<DateTime> {
    let fields = fields(text, format)?;
    let date = Date::new(fields.year?, fields.month?, fields.day?)?;
    if fields.nanos.is_some() && fields.second.is_none() {
        return None;
    }
    let second = fields.second.unwrap_or(0);
    let leap = u32::from(second == 60);
    let millis = leap * 1000 + fields.nanos.unwrap_or(0) / 1_000_000;
    Some(DateTime { date, hour: fields.hour?, minute: fields.minute?, second: second - leap, millis })
}

#[derive(Default)]
struct Fields {
    year: Option<i32>,
    month: Option<u32>,
    day: Option<u32>,
    hour: Option<u32>,
    minute: Option<u32>,
    second: Option<u32>,
    nanos: Option<u32>,
}

fn fields(mut s: &str, format: &str) -> Option<Fields> {
    let mut fields = Fields::default();
    let mut spec = format.chars();
    while let Some(c) = spec.next() {
        match c {
            '%' => match spec.next()? {
                '.' => {
                    spec.next().filter(|c| *c == 'f')?;
                    if let Some(fraction) = s.strip_prefix('.') {
                        let (rest, nanos) = nanosecond(fraction)?;
                        fields.nanos = Some(nanos);
                        s = rest;
                    }
                }
                letter => {
                    s = s.trim_start();
                    let (rest, value) = match (letter, s.strip_prefix('-'), s.strip_prefix('+')) {
                        ('Y', Some(digits), _) => number(digits, 1, usize::MAX).map(|(rest, value)| (rest, -value))?,
                        ('Y', None, Some(digits)) => number(digits, 1, usize::MAX)?,
                        ('Y', None, None) => number(s, 1, 4)?,
                        _ => number(s, 1, 2)?,
                    };
                    s = rest;
                    let bounded = |max: i64, min: i64| (min..=max).contains(&value).then_some(value as u32);
                    match letter {
                        'Y' => fields.year = Some(i32::try_from(value).ok()?),
                        'm' => fields.month = Some(bounded(12, 1)?),
                        'd' => fields.day = Some(bounded(31, 1)?),
                        'H' => fields.hour = Some(bounded(23, 0)?),
                        'M' => fields.minute = Some(bounded(59, 0)?),
                        'S' => fields.second = Some(bounded(60, 0)?),
                        _ => return None,
                    }
                }
            },
            c if c.is_whitespace() => s = s.trim_start(),
            c => s = s.strip_prefix(c)?,
        }
    }
    s.is_empty().then_some(fields)
}

/// At least `min` and at most `max` ASCII digits.
fn number(s: &str, min: usize, max: usize) -> Option<(&str, i64)> {
    let count = s.bytes().take(max).take_while(u8::is_ascii_digit).count();
    let value = s.as_bytes()[..count].iter().try_fold(0i64, |n, c| n.checked_mul(10)?.checked_add(i64::from(c - b'0')));
    (count >= min).then_some((&s[count..], value?))
}

/// Fraction digits after the point: the first nine count, the rest are skipped.
fn nanosecond(s: &str) -> Option<(&str, u32)> {
    let (rest, value) = number(s, 1, 9)?;
    let scale = 10u32.pow(9 - (s.len() - rest.len()) as u32);
    Some((rest.trim_start_matches(|c: char| c.is_ascii_digit()), value as u32 * scale))
}

/// `Z`, `z`, or `+HH:MM`, `-HH:MM` or `−HH:MM` (U+2212) below 24 hours, as seconds east of UTC, and nothing after it.
fn offset(s: &str) -> Option<i64> {
    if let Some(rest) = s.strip_prefix(['Z', 'z']) {
        return rest.is_empty().then_some(0);
    }
    let (sign, s) = match (s.strip_prefix('+'), s.strip_prefix(['-', '\u{2212}'])) {
        (Some(rest), _) => (1, rest),
        (None, Some(rest)) => (-1, rest),
        (None, None) => return None,
    };
    let bytes = s.as_bytes();
    let digits = bytes.len() == 5 && bytes[2] == b':' && [0, 1, 3, 4].iter().all(|at| bytes[*at].is_ascii_digit());
    let digit = |at: usize| i64::from(bytes[at] - b'0');
    if !digits || bytes[3] > b'5' {
        return None;
    }
    let (hours, minutes) = (digit(0) * 10 + digit(1), digit(3) * 10 + digit(4));
    (hours < 24).then_some(sign * (hours * 3600 + minutes * 60))
}

#[allow(unsafe_code)]
fn local_offset(seconds: i64) -> i32 {
    // `localtime_r`, unlike `localtime`, need not read `TZ` and `/etc/localtime`; read them once.
    static TZSET: Once = Once::new();
    unsafe extern "C" {
        fn tzset();
    }
    // SAFETY: `tzset` takes no arguments; `Once` keeps it from racing itself.
    TZSET.call_once(|| unsafe { tzset() });
    let time = seconds as libc::time_t;
    // SAFETY: `tm` is plain data, valid zeroed, and `localtime_r` writes only into it.
    let mut tm = unsafe { std::mem::zeroed::<libc::tm>() };
    if unsafe { libc::localtime_r(&time, &mut tm) }.is_null() {
        return 0;
    }
    tm.tm_gmtoff as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, FixedOffset, Local, NaiveDate, NaiveDateTime, Offset, TimeZone, Timelike, Utc};

    // Each format, with the hour, the minute, the weekday and the offset.
    fn ours(time: DateTime, offset: i32) -> Vec<String> {
        vec![
            time.date.to_string(),
            time.compact(),
            time.numeric_date(),
            time.short_time(" "),
            time.short_time("\u{202f}"),
            time.locale_string(),
            time.date_string(),
            time.month_day(),
            time.month_name().to_owned(),
            format!("{} {} {} {offset}", time.hour, time.minute, time.date.weekday_from_monday()),
        ]
    }

    fn theirs<Tz: TimeZone>(time: chrono::DateTime<Tz>) -> Vec<String>
    where
        Tz::Offset: fmt::Display,
    {
        let offset = time.offset().fix().local_minus_utc();
        let weekday = time.weekday().num_days_from_monday();
        vec![
            time.format("%Y-%m-%d").to_string(),
            time.format("%Y%m%dT%H%M%SZ").to_string(),
            time.format("%-m/%-d/%Y").to_string(),
            time.format("%-I:%M %p").to_string(),
            time.format("%-I:%M\u{202f}%p").to_string(),
            time.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string(),
            time.format("%a %b %d %Y").to_string(),
            time.format("%b %-d").to_string(),
            time.format("%b").to_string(),
            format!("{} {} {weekday} {offset}", time.hour(), time.minute()),
        ]
    }

    fn instants() -> impl Iterator<Item = i64> {
        // 1900 to 2100 every 17 hours and a bit, every 15 minutes and a bit through 2025, and the edges.
        let wide = (-2_208_988_800_000..4_102_444_800_000).step_by(61_200_123);
        let dense = (1_735_689_600_000..1_767_225_600_000).step_by(900_007);
        let edges = [
            0,
            -1,
            1,
            999,
            -999,
            -1000,
            -1001,
            253_402_300_799_999,
            253_402_300_800_000,
            -62_167_219_200_000,
            -62_167_219_200_001,
            -62_198_755_200_000,
            i64::MIN,
            i64::MAX,
        ];
        wide.chain(dense).chain(edges)
    }

    // Runs in the zone `TZ` names; `differs_nowhere_in_four_zones` runs it under each.
    #[test]
    fn matches_chrono_in_this_zone() {
        if std::env::var("TZ").as_deref() == Ok("America/New_York") {
            assert_eq!(Zone::Local.offset(0), -18_000, "TZ is read");
        }
        let mut count = 0;
        for (index, ms) in instants().enumerate() {
            let utc = chrono::DateTime::from_timestamp_millis(ms);
            assert_eq!(iso(ms), utc.map(|time| time.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()), "{ms}");
            if let Some(time) = utc.filter(|time| (0..=9999).contains(&time.year())) {
                assert_eq!(iso(ms).unwrap(), time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
            }
            assert_eq!(UTC.at(ms).map(|time| ours(time, 0)), utc.map(theirs), "UTC {ms}");
            let local = Local.timestamp_millis_opt(ms).single();
            let mine = Zone::Local.at(ms).map(|time| ours(time, Zone::Local.offset(ms)));
            assert_eq!(mine, local.map(theirs), "local {ms}");
            for offset in [3600, -12_600, 20_700, 50_400].into_iter().filter(|_| index % 16 == 0) {
                let fixed = FixedOffset::east_opt(offset).unwrap().timestamp_millis_opt(ms).single();
                assert_eq!(
                    Zone::Fixed(offset).at(ms).map(|time| ours(time, offset)),
                    fixed.map(theirs),
                    "{offset} {ms}"
                );
            }
            count += 1;
        }
        assert!(count > 130_000);
        // Every local midnight from 1950 to 2050, and every quarter hour of 2025, through gaps and overlaps.
        let walls = (-7305..29_220)
            .map(|days| (days, 0))
            .chain((20_089..20_454).flat_map(|days| (0..96).map(move |quarter| (days, quarter * 900))));
        for (days, seconds) in walls {
            let date = Date::from_days(days);
            let naive = NaiveDate::from_ymd_opt(date.year, date.month, date.day).unwrap().and_hms_opt(0, 0, 0).unwrap()
                + chrono::Duration::seconds(seconds);
            let want = Local.from_local_datetime(&naive).earliest().map(|time| time.timestamp_millis());
            assert_eq!(Zone::Local.instant(date, seconds), want, "{date} +{seconds}s");
            let want = FixedOffset::east_opt(20_700).unwrap().from_local_datetime(&naive).single();
            assert_eq!(Zone::Fixed(20_700).instant(date, seconds), want.map(|time| time.timestamp_millis()));
        }
    }

    #[test]
    fn differs_nowhere_in_four_zones() {
        let zones = ["UTC", "America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu"];
        let children = zones.map(|zone| {
            let child = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "time::tests::matches_chrono_in_this_zone", "--test-threads=1"])
                .env("TZ", zone)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            (zone, child)
        });
        for (zone, child) in children {
            let output = child.wait_with_output().unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(output.status.success() && stdout.contains("1 passed"), "{zone}:\n{stdout}\n{stderr}");
        }
    }

    #[test]
    fn days_match_chrono() {
        let days = (-95_000_000..95_000_000).step_by(9973).chain(-800_000..800_000);
        for days in days {
            let date = Date::from_days(days);
            let want = NaiveDate::from_num_days_from_ce_opt((days + 719_163) as i32).unwrap();
            assert_eq!((date.year, date.month, date.day), (want.year(), want.month(), want.day()), "{days}");
            assert_eq!(date.days(), days);
            assert_eq!(date.weekday_from_monday(), want.weekday().num_days_from_monday());
            assert_eq!(Date::new(date.year, date.month, date.day), Some(date));
        }
        for (year, month, day) in
            [(2023, 2, 29), (2024, 2, 30), (1900, 2, 29), (2026, 4, 31), (2026, 13, 1), (2026, 0, 1)]
        {
            assert_eq!(Date::new(year, month, day), None, "{year}-{month}-{day}");
            assert!(NaiveDate::from_ymd_opt(year, month, day).is_none());
        }
        assert_eq!(Date::new(2000, 2, 29).map(|date| date.to_string()).as_deref(), Some("2000-02-29"));
        assert_eq!(Date::default().days(), 0);
    }

    #[test]
    fn system_times_round_down() {
        let at = |ms: i64, nanos: u32| {
            let offset =
                std::time::Duration::new(ms.unsigned_abs() / 1000, (ms.unsigned_abs() % 1000) as u32 * 1_000_000);
            let time = if ms < 0 { UNIX_EPOCH - offset } else { UNIX_EPOCH + offset };
            time + std::time::Duration::from_nanos(u64::from(nanos))
        };
        for (ms, nanos) in [(0, 0), (1, 500), (-1, 0), (-1, 999_999), (-2_000, 1), (1_772_539_200_123, 999_999)] {
            let time = at(ms, nanos);
            let want = chrono::DateTime::<Utc>::from(time).to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            assert_eq!(iso(millis(time)).unwrap(), want, "{ms} {nanos}");
        }
    }

    #[test]
    fn parses_as_chrono() {
        let mut texts: Vec<String> = [
            "2026-11-04T15:30:00Z",
            "2026-11-04t15:30:00z",
            "2026-11-04 15:30:00+05:45",
            "2026-11-04T15:30:00\u{2212}03:30",
            "2026-11-04T15:30:00-23:59",
            "2026-11-04T15:30:00+24:00",
            "2026-11-04T15:30:00+05:60",
            "2026-11-04T15:30:00+0545",
            "2026-11-04T15:30:00+05",
            "2026-11-04T15:30:00+05:45 ",
            "2026-11-04T15:30:00",
            "2026-11-04T15:30:00.Z",
            "2026-11-04T15:30:00.5Z",
            "2026-11-04T15:30:00.123456789123Z",
            "2026-11-04T15:30:00.999999999+01:00",
            "2016-12-31T23:59:60Z",
            "2016-12-31T23:59:60.5Z",
            "2016-12-31T23:59:61Z",
            "2026-02-29T00:00:00Z",
            "2024-02-29T00:00:00Z",
            "0000-01-01T00:00:00Z",
            "9999-12-31T23:59:59.999Z",
            "2026-11-04T24:00:00Z",
            "2026-11-04T23:60:00Z",
            "2026-11-04X15:30:00Z",
            "2026/11/04T15:30:00Z",
            "+2026-11-04T15:30:00Z",
            " 2026-11-04T15:30:00Z",
            "2026-1-04T15:30:00Z",
            "2026-11-04T15:30Z",
            "2026-11-04",
            "2026-11-04T15:30",
            "2026-11-04T15:30:00.123",
            "2026-11-04T15:30:00.1234567890",
            "2026-11-04T15:30:00.",
            "2026-11-04 15:30:00",
            "2026-11-04  15:30:00",
            "2026-11-04\t15:30:00",
            "2026-11-04\u{3000}15:30:00",
            "2026-11-04T1:2",
            "2026-11-04T 1: 2",
            "2026-11-04T15:30:60",
            "2026-11-04T15:30:60.25",
            "2026-11-04t15:30",
            "2026-2-3",
            " 2026-02-03",
            "2026-02-03 ",
            "2026- 2- 3",
            "+2026-02-03",
            "-0001-02-03",
            "12026-01-01",
            "+12026-01-01",
            "-262144-01-01",
            "+99999999999999999999-01-01",
            "2023-02-29",
            "2024-02-29",
            "0000-01-01",
            "",
            "2026",
            "2026-11-04T15:30:00Zjunk",
            "2026-11-04T15:30:00.12Z\u{e9}",
            "2026-11-04T15:30:0\u{e9}Z",
        ]
        .map(str::to_owned)
        .to_vec();
        for ms in instants().step_by(997) {
            let Some(iso) = iso(ms) else { continue };
            texts.push(iso.clone());
            texts.push(iso.replace('T', " ").replace('Z', "+05:45"));
            texts.push(iso.replace(".", ".5").replace('Z', "-03:30"));
            texts.push(iso.trim_end_matches('Z').to_owned());
            texts.push(iso[..16].to_owned());
            texts.push(iso[..19].replace('T', " "));
            texts.push(iso[..10].to_owned());
        }
        for text in &texts {
            let want = chrono::DateTime::parse_from_rfc3339(text).ok().map(|time| time.timestamp_millis());
            assert_eq!(parse_rfc3339(text), want, "rfc3339 {text:?}");
            let want = NaiveDate::parse_from_str(text, "%Y-%m-%d").ok().map(|date| date.to_string());
            assert_eq!(Date::parse(text).map(|date| date.to_string()), want, "date {text:?}");
            for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S"] {
                let want =
                    NaiveDateTime::parse_from_str(text, format).ok().map(|time| time.and_utc().timestamp_millis());
                let mine = parse(text, format).map(|time| {
                    let seconds = i64::from(time.hour * 3600 + time.minute * 60 + time.second);
                    (time.date.days() * 86_400 + seconds) * 1000 + i64::from(time.millis)
                });
                assert_eq!(mine, want, "{format} {text:?}");
            }
        }
    }
}
