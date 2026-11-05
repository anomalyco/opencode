//! `stats`: shareable usage statistics (`packages/cli/src/commands/handlers/stats.ts`), with the
//! activity calendar of `packages/util/src/activity-calendar.ts`.

use std::future::Future;
use std::io::IsTerminal;
use std::time::Duration;

use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone};
use opencode_api::client::Client;
use opencode_api::error::Error as ApiError;
use opencode_api::generated::types::{
    ExperimentalSessionStatsInput, ExperimentalSessionStatsInputTools, LocationGetInput, ProjectID, SessionStatsInfo,
    SessionStatsTools,
};
use opencode_ui::activity_calendar::{activity_calendar, time_zone};
use serde_json::Value;

use super::Context;
use super::client::{block_on, connect, here, pretty};
use crate::args::StatsArgs;
use crate::output::{Exit, print};

pub fn run(context: &Context, args: &StatsArgs) -> anyhow::Result<()> {
    // The handler catches every failure and prints its bare message with exit 1.
    let Err(error) = stats(context, args) else {
        return Ok(());
    };
    eprintln!("{}", message(&error));
    Err(Exit(1).into())
}

fn stats(context: &Context, args: &StatsArgs) -> anyhow::Result<()> {
    if [args.days.is_some(), args.year.is_some(), args.all].iter().filter(|set| **set).count() > 1 {
        anyhow::bail!("--days, --year, and --all cannot be combined");
    }
    let range = Range::new(args, Local::now());
    let details = args.models || args.tools || args.cost || args.full;
    let stats = block_on(async {
        let server = connect(context).await?;
        let url = &server.endpoint().url;
        let project = match args.project.as_deref() {
            Some(".") => {
                let location = async {
                    let input = LocationGetInput { location: Some(here()?) };
                    Ok(server.client.json::<Value>(Client::location_get_call(&input)?).await?)
                };
                request(url, location).await?["project"]["id"].as_str().map(ProjectID::from)
            }
            Some(project) => Some(ProjectID::from(project)),
            None => None,
        };
        let tools = if args.json || args.tools || args.full {
            ExperimentalSessionStatsInputTools::Detail
        } else if details {
            ExperimentalSessionStatsInputTools::None
        } else {
            ExperimentalSessionStatsInputTools::Summary
        };
        let input = ExperimentalSessionStatsInput {
            from: range.from.map(|from| from as f64),
            to: Some(range.to as f64),
            project,
            timezone: Some(time_zone()),
            tools: Some(tools),
        };
        request(url, async { Ok(server.client.json::<Value>(Client::experimental_session_stats_call(&input)?).await?) })
            .await
    })??;
    let data = &stats["data"];
    if args.json {
        return print(&pretty(data)?);
    }
    let info: SessionStatsInfo =
        serde_json::from_value(data.clone()).map_err(|error| anyhow::anyhow!("MalformedResponse: {error}"))?;
    let scope = match args.project.as_deref() {
        None => "all projects",
        Some(".") => "current project",
        Some(_) => "selected project",
    };
    let stdout = std::io::stdout();
    let options = RenderOptions {
        label: range.label,
        scope: scope.to_owned(),
        models: args.models || args.full,
        tools: args.tools || args.full,
        cost: args.cost || args.full,
        limit: args.limit as usize,
        color: stdout.is_terminal() && std::env::var_os("NO_COLOR").is_none(),
        width: columns().unwrap_or(80),
    };
    let palette = Palette::from_colorfgbg(std::env::var("COLORFGBG").ok().as_deref());
    print(&(render_stats(&info, &options, &palette, &Local) + "\n"))
}

// `request`: each call gets 30 seconds, and a call that cannot reach the server names it.
async fn request<T>(url: &str, call: impl Future<Output = anyhow::Result<T>>) -> anyhow::Result<T> {
    let unreachable = || anyhow::anyhow!("Could not reach server at {url}");
    match tokio::time::timeout(Duration::from_secs(30), call).await {
        Err(_) => Err(unreachable()),
        Ok(Err(error)) if matches!(error.downcast_ref::<ApiError>(), Some(ApiError::Transport(_))) => {
            Err(unreachable())
        }
        Ok(result) => result,
    }
}

// `errorMessage`: a declared error's message, else the error's own text.
fn message(error: &anyhow::Error) -> String {
    match error.downcast_ref::<ApiError>().and_then(ApiError::declared) {
        Some(declared) => declared.message.clone().unwrap_or_default(),
        None => format!("{error:#}"),
    }
}

// `process.stdout.columns`: set only when stdout is a terminal.
fn columns() -> Option<usize> {
    let stdout = std::io::stdout();
    if !stdout.is_terminal() {
        return None;
    }
    rustix::termios::tcgetwinsize(&stdout).ok().map(|size| usize::from(size.ws_col)).filter(|columns| *columns > 0)
}

/// `statsRange`: the requested window in epoch milliseconds, end exclusive, and its label.
#[derive(Debug, PartialEq)]
struct Range {
    from: Option<i64>,
    to: i64,
    label: String,
}

impl Range {
    fn new<Tz: TimeZone>(args: &StatsArgs, now: DateTime<Tz>) -> Self {
        let zone = now.timezone();
        let to = now.timestamp_millis() + 1;
        if args.all {
            return Self { from: None, to, label: "all time".to_owned() };
        }
        if let Some(days) = args.days {
            let from = now.date_naive() - chrono::Days::new(u64::from(days.max(1) - 1));
            return Self {
                from: Some(local_midnight(&zone, from)),
                to,
                label: match days {
                    0 | 1 => "today".to_owned(),
                    days => format!("last {days} days"),
                },
            };
        }
        let current = now.year();
        let year = args.year.map_or(current, i32::from);
        let start = |year| local_midnight(&zone, NaiveDate::from_ymd_opt(year, 1, 1).unwrap());
        Self {
            from: Some(start(year)),
            to: if year == current { to } else { start(year + 1) },
            label: if year == current { format!("{year} so far") } else { year.to_string() },
        }
    }
}

// `new Date(y, m, d).getTime()`: local midnight, or the first instant after a gap that skips it.
fn local_midnight<Tz: TimeZone>(zone: &Tz, date: NaiveDate) -> i64 {
    let midnight = date.and_hms_opt(0, 0, 0).unwrap();
    (0..=24)
        .find_map(|hours| zone.from_local_datetime(&(midnight + chrono::Duration::hours(hours))).earliest())
        .map_or(0, |time| time.timestamp_millis())
}

/// The stats palette, which `terminalPalette` picks from `COLORFGBG`'s background.
#[derive(Debug, Clone, PartialEq)]
pub struct Palette {
    primary: &'static str,
    activity: [&'static str; 4],
}

impl Palette {
    pub fn from_colorfgbg(value: Option<&str>) -> Self {
        let background =
            value.and_then(|value| opencode_api::js::parse_number(value.rsplit(';').next().unwrap_or(value)));
        match background.filter(|background| background.is_finite()) {
            Some(background) if background >= 7.0 => Self {
                primary: "38;2;59;125;216",
                activity: ["38;2;153;169;192", "38;2;122;155;200", "38;2;90;140;208", "38;2;59;125;216"],
            },
            Some(_) => Self {
                primary: "38;2;250;178;131",
                activity: ["38;2;117;99;87", "38;2;161;125;102", "38;2;206;152;116", "38;2;250;178;131"],
            },
            None => Self { primary: "36", activity: ["2;36", "36", "1;36", "1;96"] },
        }
    }
}

#[derive(Debug, Clone)]
pub struct RenderOptions {
    pub label: String,
    pub scope: String,
    pub models: bool,
    pub tools: bool,
    pub cost: bool,
    pub limit: usize,
    pub color: bool,
    pub width: usize,
}

/// `renderStats`: the summary card, or the detail sections that `--models`, `--tools`, and
/// `--cost` ask for. Lines are joined with `\n`, without a final one.
pub fn render_stats<Tz: TimeZone>(
    stats: &SessionStatsInfo,
    options: &RenderOptions,
    palette: &Palette,
    zone: &Tz,
) -> String {
    let color = options.color;
    let style = |value: &str, code: &str| style(value, code, color);
    let primary = format!("1;{}", palette.primary);
    let count = |value: f64, noun: &str| metric_count(value, noun, &primary, color);
    let total_tokens = total(&stats.tokens);
    let totals = match &stats.tools {
        SessionStatsTools::Summary(tools) => Some(&tools.totals),
        SessionStatsTools::Detail(tools) => Some(&tools.totals),
        SessionStatsTools::None(_) | SessionStatsTools::Unknown(_) => None,
    };
    let session_line = [
        Some(count(stats.sessions as f64, "session")),
        (stats.subagents > 0).then(|| count(stats.subagents as f64, "subagent")),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let tool_summary = match totals {
        None => "tool stats unavailable".to_owned(),
        Some(totals) if totals.succeeded + totals.failed == 0 => "no tool calls".to_owned(),
        Some(totals) => {
            let rate = totals.succeeded as f64 / (totals.succeeded + totals.failed) as f64 * 100.0;
            format!("{} tool success", style(&format_percent(rate), &primary))
        }
    };
    let details = options.models || options.tools || options.cost;
    let empty = stats.sessions == 0 && stats.prompts == 0 && stats.steps == 0;
    let heading = format!(
        "{} {}",
        style("opencode stats", &primary),
        style(&format!("· {} · {}", options.label, options.scope), "2")
    );
    let mut lines: Vec<String> = if details {
        vec![style(&format!("{} · {}", options.label, options.scope), "2")]
    } else if empty {
        vec![heading, String::new(), style("no activity in this range", "2"), String::new(), style("opencode.ai", "2")]
    } else {
        let mut lines = vec![heading, String::new()];
        lines.extend(render_activity(stats, options, palette, zone));
        lines.extend([
            String::new(),
            session_line,
            format!(
                "{} · {} · {}",
                count(stats.prompts as f64, "prompt"),
                count(stats.steps as f64, "step"),
                count(total_tokens, "token")
            ),
            format!(
                "{tool_summary} · {} · best streak {} day{}",
                count(stats.active_days as f64, "active day"),
                style(&stats.streak.to_string(), &primary),
                if stats.streak == 1 { "" } else { "s" }
            ),
            String::new(),
            style("opencode.ai", "2"),
        ]);
        lines
    };
    let sections = [
        (options.cost, render_cost(stats)),
        (options.models, render_models(stats, options.limit, options.width)),
        (options.tools, render_tools(stats, options.limit, options.width)),
    ];
    for (_, section) in sections.into_iter().filter(|(show, _)| *show) {
        if !lines.is_empty() {
            lines.push(String::new());
        }
        lines.extend(section);
    }
    lines.join("\n")
}

fn render_activity<Tz: TimeZone>(
    stats: &SessionStatsInfo,
    options: &RenderOptions,
    palette: &Palette,
    zone: &Tz,
) -> Vec<String> {
    let color = options.color;
    let calendar = activity_calendar(
        zone,
        &stats.activity,
        stats.range.from as i64,
        stats.range.to as i64,
        options.width as f64 - 4.0,
    );
    let last = calendar.months.len().saturating_sub(1);
    let months = calendar
        .months
        .iter()
        .enumerate()
        .map(|(index, month)| {
            let label = if index == last || month.label.len() <= month.span { month.label } else { "" };
            format!("{label:<width$}", width = month.span)
        })
        .collect::<String>()
        .trim_end()
        .to_owned();
    let title = if calendar.clipped {
        format!("activity · last {} weeks", calendar.weeks.len())
    } else {
        "activity".to_owned()
    };
    let mut lines =
        vec![style(&title, &format!("1;{}", palette.primary), color), format!("   {}", style(&months, "2", color))];
    let weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
    for (day, label) in weekdays.iter().enumerate() {
        let cells = calendar
            .weeks
            .iter()
            .map(|week| match week[day].level {
                level if level < 0 => " ".to_owned(),
                level => paint_activity(level as usize, palette, color),
            })
            .collect::<String>();
        lines.push(format!("{} {cells}", style(label, "2", color)));
        if day < weekdays.len() - 1 {
            lines.push(String::new());
        }
    }
    let legend = (0..5).map(|level| paint_activity(level, palette, color)).collect::<String>();
    lines.push(String::new());
    lines.push(format!("   {} {legend} {}", style("less", "2", color), style("more", "2", color)));
    lines
}

fn render_cost(stats: &SessionStatsInfo) -> Vec<String> {
    let tokens = &stats.tokens;
    let input = tokens.input + tokens.cache.read + tokens.cache.write;
    let cached = if input == 0.0 { 0.0 } else { tokens.cache.read / input * 100.0 };
    vec![
        "COST & TOKENS".to_owned(),
        row("cost", &format!("${}", to_fixed(stats.cost, 2))),
        row("input", &format_number(tokens.input)),
        row("output", &format_number(tokens.output)),
        row("reasoning", &format_number(tokens.reasoning)),
        row("cache read", &format_number(tokens.cache.read)),
        row("cache write", &format_number(tokens.cache.write)),
        row("cached input", &format_percent(cached)),
    ]
}

fn render_models(stats: &SessionStatsInfo, limit: usize, width: usize) -> Vec<String> {
    let title = "MODELS".to_owned();
    if stats.models.is_empty() {
        return vec![title, "  no model usage".to_owned()];
    }
    let models = &stats.models[..limit.min(stats.models.len())];
    let more = stats.models.len() - models.len();
    let name = |item: &opencode_api::generated::types::SessionStatsModelUsage| {
        let variant = item
            .model
            .variant
            .as_deref()
            .filter(|variant| !variant.is_empty())
            .map(|variant| format!("#{variant}"))
            .unwrap_or_default();
        format!("{}/{}{variant}", item.model.provider_id, item.model.id)
    };
    let mut lines = vec![title];
    if width < 68 {
        lines.extend(models.iter().flat_map(|item| {
            [
                truncate(&name(item), width),
                format!(
                    "  {} tokens · {} steps · ${}",
                    format_number(total(&item.tokens)),
                    format_number(item.steps as f64),
                    to_fixed(item.cost, 2)
                ),
            ]
        }));
    } else {
        lines.push(table_row("model", "tokens", "steps", "cost"));
        lines.extend(models.iter().map(|item| {
            table_row(
                &name(item),
                &format_number(total(&item.tokens)),
                &format_number(item.steps as f64),
                &format!("${}", to_fixed(item.cost, 2)),
            )
        }));
    }
    if more > 0 {
        lines.push(String::new());
        lines.push(format!("+{} more model{}", group(more as i64), if more == 1 { "" } else { "s" }));
    }
    lines
}

fn render_tools(stats: &SessionStatsInfo, limit: usize, width: usize) -> Vec<String> {
    let title = "TOOL RELIABILITY".to_owned();
    let SessionStatsTools::Detail(detail) = &stats.tools else {
        return vec![title, "  tool details unavailable".to_owned()];
    };
    if detail.usage.is_empty() {
        return vec![title, "  no tool calls".to_owned()];
    }
    let tools = &detail.usage[..limit.min(detail.usage.len())];
    let more = detail.usage.len() - tools.len();
    let error = |tool: &opencode_api::generated::types::SessionStatsToolUsage| {
        let terminal = tool.succeeded + tool.failed;
        if terminal == 0 {
            return "-".to_owned();
        }
        format_percent(tool.failed as f64 / terminal as f64 * 100.0)
    };
    let p50 = |tool: &opencode_api::generated::types::SessionStatsToolUsage| {
        tool.duration_p50.map_or_else(|| "-".to_owned(), format_duration)
    };
    let mut lines = vec![title];
    if width < 68 {
        lines.extend(tools.iter().flat_map(|tool| {
            [
                truncate(&tool.name, width),
                format!("  {} calls · {} error · {} p50", format_number(tool.calls as f64), error(tool), p50(tool)),
            ]
        }));
    } else {
        lines.push(table_row("tool", "calls", "error", "p50"));
        lines.extend(
            tools.iter().map(|tool| table_row(&tool.name, &format_number(tool.calls as f64), &error(tool), &p50(tool))),
        );
    }
    lines.push(String::new());
    lines.push(format!(
        "{} finished calls · {} unfinished",
        format_number((detail.totals.succeeded + detail.totals.failed) as f64),
        format_number(detail.totals.unfinished as f64)
    ));
    if more > 0 {
        lines.push(format!("+{} more tool{}", group(more as i64), if more == 1 { "" } else { "s" }));
    }
    lines
}

// `TokenUsage.total`.
fn total(tokens: &opencode_api::generated::types::TokenUsageInfo) -> f64 {
    tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

fn row(label: &str, value: &str) -> String {
    format!("  {}{value}", pad_end(label, 20))
}

fn table_row(label: &str, second: &str, third: &str, fourth: &str) -> String {
    format!(
        "{}{}{}{}",
        pad_end(&truncate(label, 34), 34),
        pad_start(second, 10),
        pad_start(third, 12),
        pad_start(fourth, 12)
    )
}

// `length`, `slice`, `padEnd`, and `padStart` count UTF-16 code units.
fn units(value: &str) -> usize {
    value.encode_utf16().count()
}

fn truncate(value: &str, width: usize) -> String {
    if units(value) <= width {
        return value.to_owned();
    }
    let kept: Vec<u16> = value.encode_utf16().take(width.saturating_sub(1)).collect();
    String::from_utf16_lossy(&kept) + "…"
}

fn pad_end(value: &str, width: usize) -> String {
    format!("{value}{}", " ".repeat(width.saturating_sub(units(value))))
}

fn pad_start(value: &str, width: usize) -> String {
    format!("{}{value}", " ".repeat(width.saturating_sub(units(value))))
}

fn format_number(value: f64) -> String {
    if value >= 1_000_000_000.0 {
        return format!("{}b", trim_decimal(value / 1_000_000_000.0));
    }
    if value >= 1_000_000.0 {
        return format!("{}m", trim_decimal(value / 1_000_000.0));
    }
    if value >= 1_000.0 {
        return format!("{}k", trim_decimal(value / 1_000.0));
    }
    group(js_round(value) as i64)
}

fn trim_decimal(value: f64) -> String {
    let text = to_fixed(value, 1);
    text.strip_suffix(".0").map_or(text.clone(), str::to_owned)
}

fn format_percent(value: f64) -> String {
    format!("{}%", to_fixed(value, if value >= 10.0 { 1 } else { 2 }))
}

fn format_duration(value: f64) -> String {
    if value < 1_000.0 {
        return format!("{}ms", js_round(value) as i64);
    }
    format!("{}s", trim_decimal(value / 1_000.0))
}

// `Math.round`: halves round up.
fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

// `toLocaleString("en-US")` of an integer.
fn group(value: i64) -> String {
    let digits = value.unsigned_abs().to_string();
    let grouped = digits
        .as_bytes()
        .rchunks(3)
        .rev()
        .map(|chunk| std::str::from_utf8(chunk).unwrap_or_default())
        .collect::<Vec<_>>()
        .join(",");
    if value < 0 {
        return format!("-{grouped}");
    }
    grouped
}

/// `Number.prototype.toFixed`: halves round away from zero on the exact binary value, where Rust's
/// formatting rounds them to even.
fn to_fixed(value: f64, digits: usize) -> String {
    // 25 more digits than asked are exact enough to tell a half from its neighbours for any
    // value this command prints.
    const EXTRA: usize = 25;
    let exact = format!("{:.*}", digits + EXTRA, value.abs());
    let (head, tail) = exact.split_at(exact.len() - EXTRA);
    let head = head.trim_end_matches('.');
    let mut bytes = head.as_bytes().to_vec();
    if tail.as_bytes()[0] >= b'5' {
        let mut index = bytes.len();
        loop {
            if index == 0 {
                bytes.insert(0, b'1');
                break;
            }
            index -= 1;
            match bytes[index] {
                b'.' => continue,
                b'9' => bytes[index] = b'0',
                digit => {
                    bytes[index] = digit + 1;
                    break;
                }
            }
        }
    }
    let text = String::from_utf8(bytes).unwrap_or_default();
    if value < 0.0 {
        return format!("-{text}");
    }
    text
}

fn metric_count(value: f64, noun: &str, primary: &str, color: bool) -> String {
    format!("{} {noun}{}", style(&format_number(value), primary, color), if value == 1.0 { "" } else { "s" })
}

fn style(value: &str, code: &str, color: bool) -> String {
    if color {
        return format!("\x1b[{code}m{value}\x1b[0m");
    }
    value.to_owned()
}

fn paint_activity(level: usize, palette: &Palette, color: bool) -> String {
    let glyph = ["·", "░", "▒", "▓", "█"][level];
    if !color {
        return glyph.to_owned();
    }
    if level == 0 {
        return format!("\x1b[2m{glyph}\x1b[22m");
    }
    format!("\x1b[{}m{glyph}\x1b[39m", palette.activity[level - 1])
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../../../parity/fixtures/C.3/stats.json")).unwrap()
    }

    #[test]
    fn render_stats_matches_the_typescript_oracle() {
        let fixture = fixture();
        let mut checked = 0;
        for group in fixture["render"].as_array().unwrap() {
            let palette = Palette::from_colorfgbg(group["colorfgbg"].as_str());
            for case in group["cases"].as_array().unwrap() {
                let stats: SessionStatsInfo =
                    serde_json::from_value(fixture["stats"][case["stats"].as_str().unwrap()].clone()).unwrap();
                let options = &case["options"];
                let options = RenderOptions {
                    label: options["label"].as_str().unwrap().to_owned(),
                    scope: options["scope"].as_str().unwrap().to_owned(),
                    models: options["models"].as_bool().unwrap(),
                    tools: options["tools"].as_bool().unwrap(),
                    cost: options["cost"].as_bool().unwrap(),
                    limit: options["limit"].as_u64().unwrap() as usize,
                    color: options["color"].as_bool().unwrap(),
                    width: options["width"].as_u64().unwrap() as usize,
                };
                assert_eq!(
                    render_stats(&stats, &options, &palette, &Utc),
                    case["output"].as_str().unwrap(),
                    "{} / {} / color {} / COLORFGBG {}",
                    case["stats"],
                    case["name"],
                    options.color,
                    group["colorfgbg"]
                );
                checked += 1;
            }
        }
        assert!(checked > 150);
    }

    #[tokio::test]
    async fn requests_name_an_unreachable_server_and_keep_other_errors() {
        // The cases of "stats requests" in `packages/cli/test/stats.test.ts`.
        let url = "http://localhost:4096";
        let failed = |error: ApiError| request::<()>(url, async { Err(error.into()) });
        let transport = failed(ApiError::Transport("refused".to_owned())).await;
        assert_eq!(transport.unwrap_err().to_string(), "Could not reach server at http://localhost:4096");
        let status = failed(ApiError::UnexpectedStatus { status: 500 }).await;
        assert_eq!(message(&status.unwrap_err()), "UnexpectedStatus: 500");
    }

    #[test]
    fn to_fixed_rounds_halves_away_from_zero() {
        // From `bun -e`, `(x).toFixed(n)`.
        let cases = [
            (0.25, 1, "0.3"),
            (2.5, 0, "3"),
            (1.005, 2, "1.00"),
            (1234.565, 2, "1234.57"),
            (9.995, 2, "9.99"),
            (99.95, 1, "100.0"),
            (-0.04, 1, "-0.0"),
            (-0.0, 1, "0.0"),
            (-2.5, 0, "-3"),
            (0.0, 2, "0.00"),
        ];
        for (value, digits, want) in cases {
            assert_eq!(to_fixed(value, digits), want, "{value}.toFixed({digits})");
        }
    }

    #[test]
    fn colorfgbg_reads_like_number() {
        let dark = Palette::from_colorfgbg(Some("15;0"));
        let light = Palette::from_colorfgbg(Some("0;15"));
        let plain = Palette::from_colorfgbg(None);
        assert_eq!(Palette::from_colorfgbg(Some("0;")), dark);
        assert_eq!(Palette::from_colorfgbg(Some(" 7 ")), light);
        assert_eq!(Palette::from_colorfgbg(Some("0;0x10")), light);
        assert_eq!(Palette::from_colorfgbg(Some("15;default")), plain);
        assert_eq!(Palette::from_colorfgbg(Some("15;inf")), plain);
        assert_eq!(Palette::from_colorfgbg(Some("15;1e1")), light);
    }

    #[test]
    fn ranges_follow_stats_range() {
        let zone = FixedOffset::east_opt(3600).unwrap();
        let now = zone.with_ymd_and_hms(2026, 11, 4, 15, 30, 0).unwrap();
        let ms = |y, m, d| zone.with_ymd_and_hms(y, m, d, 0, 0, 0).unwrap().timestamp_millis();
        let to = now.timestamp_millis() + 1;
        let args = |days: Option<u32>, year: Option<u16>, all: bool| StatsArgs {
            days,
            year,
            all,
            project: None,
            models: false,
            tools: false,
            cost: false,
            full: false,
            limit: 5,
            json: false,
            server: Default::default(),
        };
        let range = |args: StatsArgs| Range::new(&args, now);
        let want = |from: Option<i64>, to: i64, label: &str| Range { from, to, label: label.to_owned() };
        assert_eq!(range(args(None, None, true)), want(None, to, "all time"));
        assert_eq!(range(args(Some(0), None, false)), want(Some(ms(2026, 11, 4)), to, "today"));
        assert_eq!(range(args(Some(1), None, false)), want(Some(ms(2026, 11, 4)), to, "today"));
        assert_eq!(range(args(Some(7), None, false)), want(Some(ms(2026, 10, 29)), to, "last 7 days"));
        assert_eq!(range(args(None, None, false)), want(Some(ms(2026, 1, 1)), to, "2026 so far"));
        assert_eq!(range(args(None, Some(2020), false)), want(Some(ms(2020, 1, 1)), ms(2021, 1, 1), "2020"));
    }
}
