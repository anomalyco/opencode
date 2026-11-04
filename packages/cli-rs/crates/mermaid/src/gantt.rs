//! Gantt charts (`packages/merman/src/gantt`): parser and drawing with the plugin's default options
//! (track style, thin line, labels on the left, spaced sections, faint track).

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use regex::Regex;

use crate::core::canvas::{Canvas, SizeError};
use crate::core::geometry::js_round;
use crate::core::text::{first_meaningful_line, js_trim, meaningful_lines, strip_quotes, width};
use crate::{Kind, SyntaxError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    Title,
    Axis,
    Section,
    Task,
    Active,
    Critical,
    Done,
    Milestone,
    TrackFaint,
}

pub type Grid = Canvas<Style>;

#[derive(Clone, Debug, PartialEq)]
pub struct Task {
    pub label: String,
    pub start: f64,
    pub end: f64,
    pub state: Style,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Entry {
    Section(String),
    Task(Task),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Diagram {
    pub title: Option<String>,
    pub axis_format: String,
    pub entries: Vec<Entry>,
}

fn pattern(source: &str) -> Regex {
    Regex::new(source).expect("gantt pattern")
}

static HEADER: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^gantt$"));
static DIRECTIVE: LazyLock<Regex> = LazyLock::new(|| {
    pattern(r"(?i)^(title|dateFormat|axisFormat|tickInterval|excludes|todayMarker)\s+(.+)$")
});
static SECTION: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^section(?:\s+(.+))?$"));
static ACCESSIBILITY: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"(?i)^acc(?:Title|Descr)(?::|\s|$)"));
static ACC_BLOCK: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^accDescr\s*\{$"));
static AFTER: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^after\s+"));
static DURATION: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"(?i)^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$"));
static CALENDAR: LazyLock<Regex> =
    LazyLock::new(|| pattern(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$"));

pub fn is_gantt(content: &str) -> bool {
    HEADER.is_match(first_meaningful_line(content).unwrap_or(""))
}

fn error(line: usize, source: &str, reason: &str) -> SyntaxError {
    SyntaxError::new(Kind::Gantt, line, source, reason)
}

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let mut entries = Vec::new();
    let mut by_id: HashMap<String, f64> = HashMap::new();
    let mut title = None;
    let mut date_format = "YYYY-MM-DD".to_string();
    let mut axis_format = "%Y-%m-%d".to_string();
    let mut header = false;
    let mut in_description = false;
    for source in meaningful_lines(content) {
        let line = js_trim(
            source
                .text
                .find("%%")
                .map_or(source.text, |index| &source.text[..index]),
        );
        let n = source.number;
        if in_description {
            if line == "}" {
                in_description = false;
            }
            continue;
        }
        if ACC_BLOCK.is_match(line) {
            in_description = true;
            continue;
        }
        if ACCESSIBILITY.is_match(line) || line.is_empty() {
            continue;
        }
        if HEADER.is_match(line) {
            if header {
                return Err(error(n, line, "Gantt header can only appear once"));
            }
            header = true;
            continue;
        }
        if !header {
            return Err(error(n, line, "Gantt header is required"));
        }
        if let Some(captures) = SECTION.captures(line) {
            let Some(label) = captures.get(1) else {
                return Err(error(n, line, "Gantt section cannot be empty"));
            };
            entries.push(Entry::Section(strip_quotes(label.as_str())));
            continue;
        }
        if let Some(captures) = DIRECTIVE.captures(line) {
            let value = js_trim(&captures[2]);
            match captures[1].to_lowercase().as_str() {
                "title" => title = Some(strip_quotes(value)),
                "dateformat" => date_format = value.to_string(),
                "axisformat" => axis_format = value.to_string(),
                _ => {
                    return Err(error(
                        n,
                        line,
                        &format!("{} is not supported", &captures[1]),
                    ));
                }
            }
            continue;
        }
        let separator = line.find(':').filter(|&index| index >= 1);
        let Some(separator) = separator else {
            return Err(SyntaxError::unsupported(Kind::Gantt, n, line));
        };
        let label = strip_quotes(&line[..separator]);
        let mut fields: Vec<&str> = line[separator + 1..]
            .split(',')
            .map(js_trim)
            .filter(|field| !field.is_empty())
            .collect();
        let mut flags: HashSet<String> = HashSet::new();
        while let Some(first) = fields.first()
            && ["active", "done", "crit", "milestone", "vert"]
                .contains(&first.to_lowercase().as_str())
        {
            flags.insert(fields.remove(0).to_lowercase());
        }
        if fields.len() < 2 || fields.len() > 3 {
            return Err(error(
                n,
                line,
                "Gantt tasks require a start and end or duration",
            ));
        }
        let id = if fields.len() == 3 {
            Some(fields.remove(0).to_string())
        } else {
            None
        };
        if let Some(id) = &id
            && by_id.contains_key(id)
        {
            return Err(error(n, line, &format!("Duplicate task id \"{id}\"")));
        }
        let start = parse_start(fields[0], &date_format, &by_id)
            .map_err(|reason| error(n, line, &reason))?;
        let end =
            parse_end(fields[1], start, &date_format).map_err(|reason| error(n, line, &reason))?;
        if end < start {
            return Err(error(n, line, "Gantt task cannot end before it starts"));
        }
        let state = if flags.contains("milestone") {
            Style::Milestone
        } else if flags.contains("crit") {
            Style::Critical
        } else if flags.contains("done") {
            Style::Done
        } else if flags.contains("active") {
            Style::Active
        } else {
            Style::Task
        };
        if let Some(id) = id {
            by_id.insert(id, end);
        }
        entries.push(Entry::Task(Task {
            label,
            start,
            end,
            state,
        }));
    }
    if !header {
        return Err(error(1, "", "Gantt header is required"));
    }
    Ok(Diagram {
        title,
        axis_format,
        entries,
    })
}

fn parse_start(value: &str, format: &str, by_id: &HashMap<String, f64>) -> Result<f64, String> {
    if !AFTER.is_match(value) {
        return parse_date(value, format);
    }
    let rest = js_trim(&AFTER.replace(value, "")).to_string();
    let mut latest = f64::NEG_INFINITY;
    for id in rest.split_whitespace() {
        let Some(&end) = by_id.get(id) else {
            return Err(format!("Unknown Gantt task id \"{id}\""));
        };
        latest = latest.max(end);
    }
    Ok(latest)
}

fn parse_end(value: &str, start: f64, format: &str) -> Result<f64, String> {
    let Some(captures) = DURATION.captures(value) else {
        return parse_date(value, format);
    };
    let unit = match captures[2].to_lowercase().as_str() {
        "ms" => 1.0,
        "s" => 1_000.0,
        "m" => 60_000.0,
        "h" => 3_600_000.0,
        "d" => 86_400_000.0,
        _ => 604_800_000.0,
    };
    Ok(start + captures[1].parse::<f64>().unwrap_or(0.0) * unit)
}

fn parse_date(value: &str, format: &str) -> Result<f64, String> {
    let numeric = js_number(value);
    match (format, numeric) {
        ("s" | "X", Some(number)) => return Ok(number * 1_000.0),
        ("x", Some(number)) => return Ok(number),
        _ => {}
    }
    if let Some(captures) = CALENDAR.captures(value)
        && ["YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DD HH:mm:ss"].contains(&format)
    {
        let part = |index: usize| {
            captures
                .get(index)
                .map_or(0, |m| m.as_str().parse::<i64>().unwrap_or(0))
        };
        return Ok(date_utc(
            part(1),
            part(2) - 1,
            part(3),
            part(4),
            part(5),
            part(6),
        ));
    }
    Err(format!(
        "Unsupported date \"{value}\" for dateFormat {format}"
    ))
}

/// JavaScript's `Number(value)` for decimal text; `None` for NaN and infinities.
fn js_number(value: &str) -> Option<f64> {
    let trimmed = js_trim(value);
    let number = if trimmed.is_empty() {
        0.0
    } else {
        trimmed.parse::<f64>().ok()?
    };
    number.is_finite().then_some(number)
}

fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let yoe = year - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `Date.UTC` with a 0-based month; out-of-range months carry into the year.
fn date_utc(year: i64, month: i64, day: i64, hour: i64, minute: i64, second: i64) -> f64 {
    let year = year + month.div_euclid(12);
    let month = month.rem_euclid(12) + 1;
    let days = days_from_civil(year, month, 1) + day - 1;
    ((((days * 24 + hour) * 60 + minute) * 60 + second) * 1_000) as f64
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(month <= 2), month, day)
}

fn format_time(value: f64, format: &str) -> String {
    let ms = value.floor() as i64;
    let days = ms.div_euclid(86_400_000);
    let rest = ms.rem_euclid(86_400_000) / 1_000;
    let (year, month, day) = civil_from_days(days);
    let parts = [
        ("%Y", year.to_string()),
        ("%m", format!("{month:02}")),
        ("%d", format!("{day:02}")),
        ("%H", format!("{:02}", rest / 3600)),
        ("%M", format!("{:02}", rest / 60 % 60)),
        ("%S", format!("{:02}", rest % 60)),
    ];
    parts
        .iter()
        .fold(format.to_string(), |result, (token, replacement)| {
            result.replace(token, replacement)
        })
}

const LABEL_GAP: i32 = 2;
const MIN_CHART_WIDTH: i32 = 24;
const MAX_CHART_WIDTH: i32 = 64;

pub fn draw(diagram: &Diagram, max_width: i32) -> Result<Grid, SizeError> {
    if diagram.entries.is_empty() {
        return Grid::new(0, 0, None);
    }
    let labels: Vec<&str> = diagram
        .entries
        .iter()
        .map(|entry| match entry {
            Entry::Section(label) => label.as_str(),
            Entry::Task(task) => task.label.as_str(),
        })
        .collect();
    let label_width = labels.iter().map(|label| width(label)).max().unwrap_or(0);
    let mut rows = Vec::new();
    let mut body = 0;
    for (index, entry) in diagram.entries.iter().enumerate() {
        if matches!(entry, Entry::Section(_)) && index > 0 {
            body += 1;
        }
        rows.push(body);
        body += 1;
    }
    let tasks: Vec<&Task> = diagram
        .entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::Task(task) => Some(task),
            Entry::Section(_) => None,
        })
        .collect();
    if tasks.is_empty() {
        let mut grid = Grid::new(label_width, body, None)?;
        for (index, label) in labels.iter().enumerate() {
            grid.text(0, rows[index], label, Some(Style::Section));
        }
        return Ok(grid);
    }
    let chart_width = MIN_CHART_WIDTH.max(MAX_CHART_WIDTH.min(max_width - label_width - LABEL_GAP));
    let minimum = tasks
        .iter()
        .map(|task| task.start)
        .fold(f64::INFINITY, f64::min);
    let maximum = tasks
        .iter()
        .map(|task| task.end)
        .fold(f64::NEG_INFINITY, f64::max);
    let span = (maximum - minimum).max(1.0);
    let title_height = if diagram.title.is_some() { 2 } else { 0 };
    let mut grid = Grid::new(
        label_width + LABEL_GAP + chart_width,
        title_height + 2 + body,
        None,
    )?;
    let chart_x = label_width + LABEL_GAP;
    if let Some(title) = &diagram.title {
        grid.text(
            0.max(chart_x + (chart_width - width(title)).div_euclid(2)),
            0,
            title,
            Some(Style::Title),
        );
    }
    draw_axis(
        &mut grid,
        chart_x,
        title_height,
        chart_width,
        minimum,
        span,
        &diagram.axis_format,
    );
    let offset = |value: f64| js_round((value - minimum) / span * f64::from(chart_width - 1));
    for (index, entry) in diagram.entries.iter().enumerate() {
        let y = title_height + 2 + rows[index];
        let Entry::Task(task) = entry else {
            grid.text(0, y, labels[index], Some(Style::Section));
            continue;
        };
        grid.text(0, y, labels[index], Some(task.state));
        let (start, end) = (offset(task.start), offset(task.end));
        if task.state == Style::Milestone || start == end {
            grid.set(chart_x + start, y, "◆", Some(task.state));
            continue;
        }
        for x in 0..chart_width {
            grid.set(chart_x + x, y, "─", Some(Style::TrackFaint));
        }
        for x in start..=end {
            grid.set(chart_x + x, y, "─", Some(task.state));
        }
    }
    Ok(grid)
}

fn draw_axis(
    grid: &mut Grid,
    x: i32,
    y: i32,
    chart_width: i32,
    minimum: f64,
    span: f64,
    format: &str,
) {
    for offset in 0..chart_width {
        grid.set(x + offset, y + 1, "─", Some(Style::Axis));
    }
    const STEPS: [f64; 15] = [
        1_000.0,
        5_000.0,
        10_000.0,
        30_000.0,
        60_000.0,
        300_000.0,
        900_000.0,
        3_600_000.0,
        21_600_000.0,
        43_200_000.0,
        86_400_000.0,
        172_800_000.0,
        604_800_000.0,
        2_592_000_000.0,
        31_536_000_000.0,
    ];
    let step = STEPS
        .iter()
        .copied()
        .find(|&step| step >= span / 4.0)
        .unwrap_or(STEPS[14]);
    let mut ticks = Vec::new();
    let mut value = (minimum / step).ceil() * step;
    while value <= minimum + span {
        ticks.push(value);
        value += step;
    }
    if ticks.is_empty() {
        ticks.extend([minimum, minimum + span]);
    }
    for value in ticks {
        let offset = js_round((value - minimum) / span * f64::from(chart_width - 1));
        let label = format_time(value, format);
        let label_width = width(&label);
        let label_x =
            x.max((x + chart_width - label_width).min(x + offset - label_width.div_euclid(2)));
        grid.text(label_x, y, &label, Some(Style::Axis));
        grid.set(x + offset, y + 1, "┬", Some(Style::Axis));
    }
}
