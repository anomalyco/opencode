//! `@opencode/util/activity-calendar` for `stats` (C.3) and the TUI's `/stats` poster (E.14): Monday-first weeks
//! of activity levels with month labels, and the time zone both send with the stats request.

use chrono::{DateTime, Datelike, NaiveDate, TimeZone};
use opencode_api::generated::types::SessionStatsActivity;

/// `Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"` as Bun resolves it: `TZ` (an empty
/// value is UTC), else the zone `/etc/localtime` links to. ICU's names for UTC become `UTC`, and a
/// zone without tz data falls back to `UTC`.
pub fn time_zone() -> String {
    let name = match std::env::var("TZ") {
        Ok(value) => value.trim_start_matches(':').to_owned(),
        Err(_) => std::fs::read_link("/etc/localtime")
            .ok()
            .and_then(|link| {
                let link = link.to_string_lossy().into_owned();
                link.split_once("zoneinfo/").map(|(_, name)| name.to_owned())
            })
            .unwrap_or_default(),
    };
    const UTC: [&str; 14] = [
        "",
        "UTC",
        "UCT",
        "GMT",
        "GMT0",
        "GMT+0",
        "GMT-0",
        "Greenwich",
        "Universal",
        "Zulu",
        "Etc/UTC",
        "Etc/UCT",
        "Etc/GMT",
        "Etc/Universal",
    ];
    if UTC.contains(&name.as_str())
        || ["Etc/GMT0", "Etc/GMT+0", "Etc/GMT-0", "Etc/Greenwich", "Etc/Zulu"].contains(&name.as_str())
        || name.starts_with('/')
        || !std::path::Path::new("/usr/share/zoneinfo").join(&name).is_file()
    {
        return "UTC".to_owned();
    }
    name
}

/// One cell of the calendar: `level` is -1 outside the range, 0 without steps, else 1 to 4.
#[derive(Debug, Clone, PartialEq)]
pub struct Day {
    pub date: String,
    pub steps: i64,
    pub level: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Month {
    pub week: usize,
    pub label: &'static str,
    pub span: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Calendar {
    pub weeks: Vec<[Day; 7]>,
    pub months: Vec<Month>,
    pub clipped: bool,
}

const MONTHS: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/// `activityCalendar`: Monday-first weeks covering `[from, to)` in `zone`'s local dates, the latest
/// `max_weeks` of them (at most 53), with month labels.
pub fn activity_calendar<Tz: TimeZone>(
    zone: &Tz,
    activity: &[SessionStatsActivity],
    from: i64,
    to: i64,
    max_weeks: f64,
) -> Calendar {
    // Local dates first, then day ordinals, so DST cannot add or drop cells.
    let ordinal = |time: i64| {
        DateTime::from_timestamp_millis(time)
            .map_or(0, |time| i64::from(time.with_timezone(zone).date_naive().num_days_from_ce()) - EPOCH_DAYS)
    };
    let first = ordinal(from);
    let last = ordinal(to - 1);
    let monday = first - i64::from(date(first).weekday().num_days_from_monday());
    let total = if to <= from { 0 } else { (last - monday).div_euclid(7) + 1 };
    let count = total.min(53).min((max_weeks.floor() as i64).max(1));
    let start = monday + (total - count).max(0) * 7;
    let mut values: Vec<(&str, i64)> = Vec::new();
    for day in activity {
        match values.iter_mut().find(|(date, _)| *date == day.date) {
            Some(entry) => entry.1 = day.steps,
            None => values.push((&day.date, day.steps)),
        }
    }
    let mut levels: Vec<i64> = values.iter().map(|(_, steps)| *steps).filter(|steps| *steps > 0).collect();
    levels.sort_unstable();
    levels.dedup();
    let weeks = (0..count)
        .map(|week| {
            std::array::from_fn(|day| {
                let ordinal = start + week * 7 + day as i64;
                let key = date(ordinal).format("%Y-%m-%d").to_string();
                let steps = values.iter().find(|(date, _)| *date == key).map_or(0, |(_, steps)| *steps);
                let level = if ordinal < first || ordinal > last {
                    -1
                } else if steps == 0 {
                    0
                } else {
                    let rank = levels.iter().position(|level| *level == steps);
                    let rank = rank.map_or(0, |rank| rank as i64 + 1) as f64;
                    ((rank / levels.len() as f64 * 4.0).ceil() as i64).max(1)
                };
                Day { date: key, steps, level }
            })
        })
        .collect::<Vec<[Day; 7]>>();
    // Thursday names the month that owns most of a week; edge weeks stay inside the range.
    let mut months: Vec<Month> = Vec::new();
    for week in 0..count {
        let label = MONTHS[date((start + week * 7 + 3).clamp(first, last.max(first))).month0() as usize];
        if months.last().is_none_or(|month| month.label != label) {
            months.push(Month { week: week as usize, label, span: 0 });
        }
    }
    let ends: Vec<usize> = months.iter().skip(1).map(|month| month.week).chain([count as usize]).collect();
    for (month, end) in months.iter_mut().zip(ends) {
        month.span = end - month.week;
    }
    Calendar { weeks, months, clipped: count < total }
}

// Days from 0001-01-01 to 1970-01-01, as `num_days_from_ce` counts them.
const EPOCH_DAYS: i64 = 719_163;

fn date(ordinal: i64) -> NaiveDate {
    NaiveDate::from_num_days_from_ce_opt((ordinal + EPOCH_DAYS) as i32).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    use serde_json::{Value, json};

    fn calendar_json(calendar: &Calendar) -> Value {
        json!({
            "weeks": calendar.weeks.iter().map(|week| week.iter().map(|day| json!({
                "date": day.date, "steps": day.steps, "level": day.level,
            })).collect::<Vec<_>>()).collect::<Vec<_>>(),
            "months": calendar.months.iter().map(|month| json!({
                "week": month.week, "label": month.label, "span": month.span,
            })).collect::<Vec<_>>(),
            "clipped": calendar.clipped,
        })
    }

    #[test]
    fn activity_calendar_matches_the_typescript_oracle() {
        let fixture: Value = serde_json::from_str(include_str!("../../../parity/fixtures/C.3/stats.json")).unwrap();
        let cases = fixture["calendar"].as_array().unwrap();
        assert!(cases.len() > 40);
        for case in cases {
            let zone = FixedOffset::east_opt(case["offset"].as_i64().unwrap() as i32).unwrap();
            let input = &case["input"];
            let activity: Vec<SessionStatsActivity> = serde_json::from_value(input["activity"].clone()).unwrap();
            let calendar = activity_calendar(
                &zone,
                &activity,
                input["from"].as_i64().unwrap(),
                input["to"].as_i64().unwrap(),
                input["maxWeeks"].as_f64().unwrap(),
            );
            assert_eq!(calendar_json(&calendar), case["output"], "{} in {}", input["name"], case["tz"]);
        }
    }
}
