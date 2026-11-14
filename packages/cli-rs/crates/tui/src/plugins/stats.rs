//! `/stats` (E.14, row F11, `feature-plugins/system/stats.tsx`, `stats-data.ts`,
//! `@opencode/util/activity-calendar`): `stats.open` opens the `stats` plugin route, which reads this year's
//! usage from `GET /api/experimental/session/stats` each time it mounts, however it was opened, and shows it as a
//! poster: the token total in large digits, a calendar of active days, the best streak, the active days, and the
//! sessions. Escape goes back.

use opencode_api::client::Client;
use opencode_api::generated::{ExperimentalSessionStatsInput, ExperimentalSessionStatsInputTools, SessionStatsInfo};
use opencode_plugin::abi::{
    self, Align, Command, Justify, Layout, Node, Read, Render, RequestId, Rgba, Scope, Span, Width, Wrap,
};
use opencode_ui::activity_calendar::{activity_calendar, time_zone};
use opencode_ui::theme::tint;
use opencode_util::time::{self, Date, Zone};
use opentui::style::Color;

use super::fetch::{data, fetch_of};

use crate::prelude::*;

const ID: &str = "opencode.stats";
const ROUTE: &str = "stats";

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: ID, setup }
}

/// What the route shows: nothing asked yet, the stats, or that they did not load.
#[derive(Default)]
struct State {
    /// The route `stats.open` left, which escape goes back to.
    previous: RefCell<abi::Route>,
    /// The mounts of the route: a remount mounts the next before the last goes.
    mounts: Cell<usize>,
    /// The request whose reply the route waits for.
    request: Cell<Option<RequestId>>,
    stats: RefCell<Option<Result<SessionStatsInfo, String>>>,
}

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let state = Rc::new(State::default());
    let shown = state.clone();
    setup.route(ROUTE, move |read, changed| {
        if !(changed.all || changed.size || changed.woken) {
            return Render::Keep;
        }
        let node = match &*shown.stats.borrow() {
            None => Node::text([Span::new("Gathering your stats…")]).fg("text.muted"),
            Some(Ok(stats)) => poster(read, stats),
            Some(Err(_)) => Node::text([Span::new("Could not load stats. Reopen /stats to try again.")])
                .fg("text.feedback.error.base"),
        };
        Render::Show(node)
    });
    // As TS's `StatsPage` resource: each mount asks afresh, and a reply after the route went is dropped.
    let mounted = state.clone();
    setup.on_route_mount(ROUTE, move |host, mount| {
        if mount {
            mounted.mounts.set(mounted.mounts.get() + 1);
            *mounted.stats.borrow_mut() = None;
            mounted.request.set(Some(host.fetch(request())));
            return;
        }
        mounted.mounts.set(mounted.mounts.get().saturating_sub(1));
        if mounted.mounts.get() == 0 {
            mounted.request.set(None);
        }
    });
    let (open, id) = (state.clone(), setup.id().to_owned());
    let command = Command {
        name: "stats.open".to_owned(),
        title: "Usage statistics".to_owned(),
        group: Some("System".to_owned()),
        slash: Some("stats".to_owned()),
        palette: true,
        ..Command::default()
    };
    setup.command(command, move |host, _| {
        let current = host.route();
        if matches!(&current, abi::Route::Plugin { id: open_id, name } if *open_id == id && name == ROUTE) {
            return;
        }
        *open.previous.borrow_mut() = current;
        host.navigate(abi::Route::Plugin { id: id.clone(), name: ROUTE.to_owned() });
    });
    let back = state.clone();
    let command = Command {
        name: "stats.back".to_owned(),
        title: "back".to_owned(),
        keybind: Some("escape".to_owned()),
        scope: Scope::Route(ROUTE.to_owned()),
        ..Command::default()
    };
    setup.command(command, move |host, _| host.navigate(back.previous.borrow().clone()));
    setup.on_reply(move |_, id, reply| {
        if state.request.get() == Some(id) {
            state.request.set(None);
            *state.stats.borrow_mut() = Some(data(reply));
        }
    });
    Ok(())
}

/// This year's stats in the local time zone, without tool details.
fn request() -> abi::Fetch {
    let year = Zone::Local.at(time::now_ms()).unwrap_or_default().date.year;
    let from = Zone::Local.instant(Date { year, month: 1, day: 1 }, 0);
    let input = ExperimentalSessionStatsInput {
        from: Some(from as f64),
        timezone: Some(time_zone()),
        tools: Some(ExperimentalSessionStatsInputTools::None),
        ..ExperimentalSessionStatsInput::default()
    };
    fetch_of(Client::experimental_session_stats_call(&input).expect("the stats input encodes"))
}

const DIGITS: [(char, [&str; 5]); 15] = [
    ('0', ["111", "101", "101", "101", "111"]),
    ('1', ["010", "110", "010", "010", "111"]),
    ('2', ["111", "001", "111", "100", "111"]),
    ('3', ["111", "001", "111", "001", "111"]),
    ('4', ["101", "101", "111", "001", "001"]),
    ('5', ["111", "100", "111", "001", "111"]),
    ('6', ["111", "100", "111", "101", "111"]),
    ('7', ["111", "001", "010", "010", "010"]),
    ('8', ["111", "101", "111", "101", "111"]),
    ('9', ["111", "101", "111", "001", "111"]),
    ('.', ["0", "0", "0", "0", "1"]),
    ('K', ["101", "110", "100", "110", "101"]),
    ('M', ["10001", "11011", "10101", "10001", "10001"]),
    ('B', ["110", "101", "110", "101", "110"]),
    ('T', ["111", "010", "010", "010", "010"]),
];

fn text(text: impl Into<String>, fg: &'static str) -> Node {
    Node::text([Span::new(text)]).fg(fg)
}

fn bold(text: impl Into<String>, fg: &'static str) -> Node {
    Node::text([Span::new(text).bold()]).fg(fg)
}

fn full() -> Layout {
    Layout { width: Some(Width::Percent(100.0)), ..Layout::default() }
}

/// `StatsPoster`.
fn poster(read: &dyn Read, stats: &SessionStatsInfo) -> Node {
    let (columns, rows) = read.info().size;
    let width = (i64::from(columns) - 8).clamp(12, 110) as u16;
    let compact = rows < 38;
    let tokens = stats.tokens.input
        + stats.tokens.output
        + stats.tokens.reasoning
        + stats.tokens.cache.read
        + stats.tokens.cache.write;
    let total = number(tokens);
    let mut children = Vec::new();
    let title =
        vec![bold("opencode / stats", "text.base"), text(dates(stats.range.from, stats.range.to), "text.muted")];
    let title = if width < 44 { Node::column(title) } else { Node::row(title) };
    children.push(title.justify(Justify::SpaceBetween).layout(full()));
    if !compact {
        children.push(logo(read, columns, rows));
    }
    let letters: Option<Vec<&[&str; 5]>> =
        total.chars().map(|char| DIGITS.iter().find(|(key, _)| *key == char).map(|(_, rows)| rows)).collect();
    let large = letters.as_ref().filter(|letters| {
        letters.iter().map(|letter| letter[0].len() as i64 * 2 + 2).sum::<i64>() - 2 <= i64::from(width)
    });
    let number = match large {
        Some(letters) => Node::column(
            (0..5)
                .map(|row| {
                    let line: Vec<String> =
                        letters.iter().map(|letter| letter[row].replace('1', "██").replace('0', "  ")).collect();
                    text(line.join("  "), "text.base").unselectable()
                })
                .collect(),
        ),
        None => bold(total, "text.base"),
    };
    children.push(Node::column(vec![number, text("TOKENS", "text.muted")]).align(Align::Center).gap(1));
    children.push(calendar(read, stats, width));
    let metrics = [("best streak", stats.streak), ("active days", stats.active_days), ("sessions", stats.sessions)]
        .into_iter()
        .map(|(label, value)| {
            let suffix = if label == "best streak" { " days" } else { "" };
            let value = bold(format!("{}{suffix}", self::number(value as f64)), "text.base");
            Node::column(vec![value, text(label, "text.muted")]).align(Align::Center)
        })
        .collect();
    children.push(Node::row(metrics).justify(Justify::SpaceAround).layout(full()));
    children.push(Node::row(vec![text("opencode.ai", "text.base")]).justify(Justify::End).layout(full()));
    Node::column(children)
        .align(Align::Center)
        .gap(if compact { 1 } else { 2 })
        .layout(Layout { width: Some(Width::Cells(width)), ..Layout::default() }.shrink(false))
}

fn calendar(read: &dyn Read, stats: &SessionStatsInfo, width: u16) -> Node {
    let calendar = activity_calendar(
        Zone::Local,
        &stats.activity,
        stats.range.from as i64,
        stats.range.to as i64,
        f64::from(width.saturating_sub(4) / 2),
    );
    let (base, accent) = (color(read, "background.base"), color(read, "categorical.0.200"));
    let shades: Vec<abi::Color> = std::iter::once("text.muted".into())
        .chain([0.3, 0.5, 0.75, 1.0].into_iter().map(|alpha| rgba(tint(base, accent, alpha)).into()))
        .collect();
    let months: String = calendar
        .months
        .iter()
        .map(|month| {
            let label = if month.label.len() <= month.span * 2 { month.label } else { "" };
            format!("{label:<width$}", width = month.span * 2)
        })
        .collect();
    let mut rows = vec![text(format!("    {months}"), "text.muted")];
    for (index, day) in ["M", "T", "W", "T", "F", "S", "S"].into_iter().enumerate() {
        let mut spans = vec![Span::new(format!("{day}   ")).fg("text.muted")];
        for week in &calendar.weeks {
            let level = week[index].level;
            let cell = match level {
                -1 => "  ",
                0 => "\u{b7} ",
                _ => "\u{25a0} ",
            };
            spans.push(Span::new(cell).fg(shades[level.max(0) as usize].clone()));
        }
        rows.push(Node::row(vec![Node::text(spans).wrap(Wrap::None).unselectable()]));
    }
    if calendar.clipped {
        rows.push(text(format!("Your last {} weeks", calendar.weeks.len()), "text.muted"));
    }
    Node::column(rows).align(Align::Center)
}

/// `Logo`: four rows of the left half in `text.muted` and the right half in bold `text.base`, as wide as fits.
fn logo(read: &dyn Read, width: u16, height: u16) -> Node {
    use crate::routes::home::{GO_RIGHT, LOGO_LEFT, LOGO_RIGHT};
    let (base, muted, background) =
        (color(read, "text.base"), color(read, "text.muted"), color(read, "background.base"));
    let line = |left: Option<&str>, right: Option<&str>| {
        let mut row = Vec::new();
        if let Some(left) = left {
            row.push(Node::text(spans(left, muted, background, false)).unselectable());
        }
        if let Some(right) = right {
            row.push(Node::text(spans(right, base, background, true)).unselectable());
        }
        Node::row(row).gap(1)
    };
    let rows: Vec<Node> = if height < 12 {
        Vec::new()
    } else if width < 22 {
        GO_RIGHT[1..].iter().map(|right| line(None, Some(right))).collect()
    } else if width < 44 {
        LOGO_LEFT[1..]
            .iter()
            .map(|left| line(Some(left), None))
            .chain(LOGO_RIGHT.iter().map(|right| line(None, Some(right))))
            .collect()
    } else {
        LOGO_LEFT.iter().zip(LOGO_RIGHT).map(|(left, right)| line(Some(left), Some(right))).collect()
    };
    Node::column(rows).layout(Layout::default().shrink(false))
}

/// `renderLine`: one span per cell, so each shadow cell gets its own colors.
fn spans(line: &str, fg: Color, background: Color, bold: bool) -> Vec<Span> {
    let shadow = rgba(tint(background, fg, 0.25));
    let fg = rgba(fg);
    line.chars()
        .map(|char| {
            let (text, fg, bg) = match char {
                '_' => (' ', fg, Some(shadow)),
                '^' => ('▀', fg, Some(shadow)),
                '~' => ('▀', shadow, None),
                ',' => ('▄', shadow, None),
                char => (char, fg, None),
            };
            Span { bold, bg: bg.map(Into::into), ..Span::new(text).fg(fg) }
        })
        .collect()
}

fn color(read: &dyn Read, token: &str) -> Color {
    read.color(token).map_or(Color::rgba(255, 255, 255, 255), |rgba| Color::rgba(rgba.r, rgba.g, rgba.b, rgba.a))
}

fn rgba(color: Color) -> Rgba {
    Rgba::new(color.r, color.g, color.b, color.a)
}

/// `statsNumber`: compact notation with at most one fraction digit (`12.3K`, `1M`).
pub fn number(value: f64) -> String {
    const UNITS: [(f64, &str); 5] = [(1.0, ""), (1e3, "K"), (1e6, "M"), (1e9, "B"), (1e12, "T")];
    let round = |value: f64| (value * 10.0).round() / 10.0;
    let mut index = UNITS.iter().rposition(|(scale, _)| value.abs() >= *scale).unwrap_or(0);
    // A value that rounds up to 1000 of a unit reads as one of the next (`999950` is `1M`).
    if round(value / UNITS[index].0).abs() >= 1000.0 && index + 1 < UNITS.len() {
        index += 1;
    }
    let text = format!("{:.1}", round(value / UNITS[index].0));
    format!("{}{}", text.strip_suffix(".0").unwrap_or(&text), UNITS[index].1)
}

/// `formatRange` of `{ month: "short", year: "numeric" }`: `Jan – Nov 2026`, `Nov 2026`, or
/// `Dec 2025 – Jan 2026`.
fn dates(from: f64, to: f64) -> String {
    let date = |time: f64| Zone::Local.at(time as i64).map_or(Date::default(), |date| date.date);
    let (start, end) = (date(from), date(from.max(to - 1.0)));
    let month = |date: Date| time::MONTHS[date.month as usize - 1];
    if start.year != end.year {
        return format!("{} {} – {} {}", month(start), start.year, month(end), end.year);
    }
    if start.month != end.month {
        return format!("{} – {} {}", month(start), month(end), end.year);
    }
    format!("{} {}", month(end), end.year)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn number_like_intl_compact() {
        let cases = [
            (0.0, "0"),
            (5.0, "5"),
            (999.0, "999"),
            (1000.0, "1K"),
            (1234.0, "1.2K"),
            (12345.0, "12.3K"),
            (99999.0, "100K"),
            (999_949.0, "999.9K"),
            (999_950.0, "1M"),
            (1_234_567.0, "1.2M"),
            (1e9, "1B"),
            (2.5e12, "2.5T"),
        ];
        for (value, want) in cases {
            assert_eq!(number(value), want, "{value}");
        }
    }
}
