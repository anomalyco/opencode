//! `/stats` (E.14, row F11, `feature-plugins/system/stats.tsx`, `stats-data.ts`,
//! `@opencode/util/activity-calendar`): `stats.open` opens the `stats` plugin route, which reads this year's
//! usage from `GET /api/experimental/session/stats` and shows it as a poster: the token total in large digits,
//! a calendar of active days, the best streak, the active days, and the sessions. Escape goes back.

use std::cell::RefCell;
use std::rc::Rc;

use chrono::{Datelike, Local, NaiveDate, TimeZone};
use opencode_api::client::RequestOptions;
use opencode_api::generated::{ExperimentalSessionStatsInput, ExperimentalSessionStatsInputTools, SessionStatsInfo};
use opencode_plugin::{Definition, Slotted};
use opencode_store::Changes;
use opencode_ui::activity_calendar::{activity_calendar, time_zone};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

const ID: &str = "opencode.stats";
const ROUTE: &str = "stats";

pub fn plugin() -> Definition<Tui> {
    Definition::new(ID, |cx| {
        let previous = Rc::new(RefCell::new(Route::Home));
        let back = previous.clone();
        cx.route(ROUTE, move |tui| Box::new(Page::new(tui, back.clone())));
        let weak = Rc::downgrade(cx.host());
        cx.layer(KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![
                TuiCommand::new("stats.open", move |_, _| {
                    let Some(tui) = weak.upgrade() else { return };
                    let current = tui.route();
                    if matches!(&current, Route::Plugin { name, .. } if name == ROUTE) {
                        return;
                    }
                    *previous.borrow_mut() = current;
                    tui.dialogs.clear();
                    tui.navigate(Route::Plugin { id: ID.to_owned(), name: ROUTE.to_owned() });
                })
                .title("Usage statistics")
                .group("System")
                .slash(opencode_ui::keymap::Slash { name: "stats".to_owned(), aliases: Vec::new(), arguments: false })
                .palette()
                .bind(Bind::Default),
            ],
            ..KeymapLayer::default()
        });
    })
}

/// `StatsPage`: loading, the error, or the poster, centered on the page background.
struct Page {
    root: View,
    layer: RefCell<Option<Disposer>>,
    app: App,
}

impl Page {
    fn new(tui: &Tui, previous: Rc<RefCell<Route>>) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let scroll = ScrollBox::new(app).scrollbars(false).grow(1.0);
        scroll.content_view().align_items(Align::Center).justify(Justify::Center).padding_y(1);
        let content = View::new(app).shrink(0.0).child(&Text::new(app, "Gathering your stats…").fg(theme.text.muted));
        scroll.add(&content);
        let root = View::new(app)
            .width(Length::percent(100.0))
            .height(Length::percent(100.0))
            .bg(theme.background.base)
            .child(&scroll);
        let weak = tui.weak();
        let layer = tui
            .keymap
            .layer(KeymapLayer {
                commands: vec![
                    TuiCommand::inline("escape", move |_, _| {
                        if let Some(tui) = weak.upgrade() {
                            let route = previous.borrow().clone();
                            tui.navigate(route);
                        }
                    })
                    .title("back"),
                ],
                ..KeymapLayer::default()
            })
            .map_err(|error| log::error!("stats keymap layer: {error}"))
            .ok();
        load(tui, &content);
        Self { root, layer: RefCell::new(layer), app: app.clone() }
    }
}

impl Slotted<Tui> for Page {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, _: &Tui, _: &Changes) {}
}

impl Drop for Page {
    fn drop(&mut self) {
        // Escape navigates, which drops the page while the keymap runs its layer.
        if let Some(layer) = self.layer.borrow_mut().take() {
            self.app.defer(move |_| drop(layer));
        }
    }
}

/// Reads this year's stats in the local time zone, without tool details.
fn load(tui: &Tui, content: &View) {
    let now = Local::now();
    let from = Local.with_ymd_and_hms(now.year(), 1, 1, 0, 0, 0).earliest().map_or(0, |start| start.timestamp_millis());
    let input = ExperimentalSessionStatsInput {
        from: Some(from as f64),
        timezone: Some(time_zone()),
        tools: Some(ExperimentalSessionStatsInputTools::None),
        ..ExperimentalSessionStatsInput::default()
    };
    let client = tui.data.client().clone();
    let weak = tui.weak();
    let content = content.clone();
    tui.app.spawn(
        async move { client.experimental_session_stats(&input, &RequestOptions::default()).await },
        move |_, result| {
            let Some(tui) = weak.upgrade() else { return };
            let theme = tui.page();
            content.clear();
            match result {
                Ok(stats) => {
                    content.add(&poster(&tui, &theme, &stats));
                }
                Err(_) => {
                    content.add(
                        &Text::new(&tui.app, "Could not load stats. Reopen /stats to try again.").fg(theme
                            .text
                            .feedback
                            .error
                            .base),
                    );
                }
            }
            tui.app.request_redraw();
        },
    );
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

/// `StatsPoster`.
fn poster(tui: &Tui, theme: &Theme, stats: &SessionStatsInfo) -> View {
    let app = &tui.app;
    let (columns, rows) = app.size();
    let width = (i64::from(columns) - 8).clamp(12, 110) as u32;
    let compact = rows < 38;
    let tokens = stats.tokens.input
        + stats.tokens.output
        + stats.tokens.reasoning
        + stats.tokens.cache.read
        + stats.tokens.cache.write;
    let total = number(tokens);
    let root =
        View::new(app).column().width(width).align_items(Align::Center).shrink(0.0).gap(if compact { 1 } else { 2 });
    let title = View::new(app)
        .width(Length::percent(100.0))
        .justify(Justify::SpaceBetween)
        .child(&Text::new(app, "opencode / stats").fg(theme.text.base).bold())
        .child(&Text::new(app, dates(stats.range.from, stats.range.to)).fg(theme.text.muted));
    if width < 44 {
        title.column();
    } else {
        title.row();
    }
    root.add(&title);
    if !compact {
        let logo = View::new(app).column().shrink(0.0);
        crate::routes::home::paint_logo(app, &logo, theme, columns, rows);
        root.add(&logo);
    }
    let letters: Option<Vec<&[&str; 5]>> =
        total.chars().map(|char| DIGITS.iter().find(|(key, _)| *key == char).map(|(_, rows)| rows)).collect();
    let large = letters.as_ref().filter(|letters| {
        letters.iter().map(|letter| letter[0].len() as i64 * 2 + 2).sum::<i64>() - 2 <= i64::from(width)
    });
    let big = View::new(app).align_items(Align::Center).gap(1);
    match large {
        Some(letters) => {
            let lines = View::new(app);
            for row in 0..5 {
                let line: Vec<String> =
                    letters.iter().map(|letter| letter[row].replace('1', "██").replace('0', "  ")).collect();
                lines.add(&Text::new(app, line.join("  ")).fg(theme.text.base).selectable(false));
            }
            big.add(&lines);
        }
        None => {
            big.add(&Text::new(app, total).fg(theme.text.base).bold());
        }
    }
    big.add(&Text::new(app, "TOKENS").fg(theme.text.muted));
    root.add(&big);
    root.add(&calendar_view(app, theme, stats, width));
    let metrics = View::new(app).row().width(Length::percent(100.0)).justify(Justify::SpaceAround);
    for (label, value) in
        [("best streak", stats.streak), ("active days", stats.active_days), ("sessions", stats.sessions)]
    {
        let suffix = if label == "best streak" { " days" } else { "" };
        metrics.add(
            &View::new(app)
                .align_items(Align::Center)
                .child(&Text::new(app, format!("{}{suffix}", number(value as f64))).fg(theme.text.base).bold())
                .child(&Text::new(app, label).fg(theme.text.muted)),
        );
    }
    root.add(&metrics);
    root.add(
        &View::new(app)
            .row()
            .width(Length::percent(100.0))
            .justify(Justify::End)
            .child(&Text::new(app, "opencode.ai").fg(theme.text.base)),
    );
    root
}

fn calendar_view(app: &App, theme: &Theme, stats: &SessionStatsInfo, width: u32) -> View {
    let calendar = activity_calendar(
        &Local,
        &stats.activity,
        stats.range.from as i64,
        stats.range.to as i64,
        f64::from(width.saturating_sub(4) / 2),
    );
    let accent = theme.categorical().first().map_or(theme.text.base, |scale| scale.step(200));
    let shades: Vec<Color> = std::iter::once(theme.text.muted)
        .chain(
            [0.3, 0.5, 0.75, 1.0]
                .into_iter()
                .map(|alpha| opencode_ui::theme::tint(theme.background.base, accent, alpha)),
        )
        .collect();
    let months: String = calendar
        .months
        .iter()
        .map(|month| {
            let label = if month.label.len() <= month.span * 2 { month.label } else { "" };
            format!("{label:<width$}", width = month.span * 2)
        })
        .collect();
    let root =
        View::new(app).align_items(Align::Center).child(&Text::new(app, format!("    {months}")).fg(theme.text.muted));
    for (index, day) in ["M", "T", "W", "T", "F", "S", "S"].into_iter().enumerate() {
        let mut spans = vec![format!("{day}   ").fg(theme.text.muted)];
        for week in &calendar.weeks {
            let level = week[index].level;
            let cell = match level {
                -1 => "  ",
                0 => "\u{b7} ",
                _ => "\u{25a0} ",
            };
            spans.push(cell.fg(shades[level.max(0) as usize]));
        }
        root.add(&View::new(app).row().height(1).child(&Text::new(app, spans).selectable(false)));
    }
    if calendar.clipped {
        root.add(&Text::new(app, format!("Your last {} weeks", calendar.weeks.len())).fg(theme.text.muted));
    }
    root
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
    format!("{}{}", trim(round(value / UNITS[index].0)), UNITS[index].1)
}

fn trim(value: f64) -> String {
    let text = format!("{value:.1}");
    text.strip_suffix(".0").map_or(text.clone(), str::to_owned)
}

/// `formatRange` of `{ month: "short", year: "numeric" }`: `Jan – Nov 2026`, `Nov 2026`, or
/// `Dec 2025 – Jan 2026`.
fn dates(from: f64, to: f64) -> String {
    let date = |time: f64| {
        Local.timestamp_millis_opt(time as i64).single().map_or(NaiveDate::default(), |date| date.date_naive())
    };
    let (start, end) = (date(from), date(from.max(to - 1.0)));
    let month = |date: NaiveDate| date.format("%b").to_string();
    if start.year() != end.year() {
        return format!("{} {} – {} {}", month(start), start.year(), month(end), end.year());
    }
    if start.month() != end.month() {
        return format!("{} – {} {}", month(start), month(end), end.year());
    }
    format!("{} {}", month(end), end.year())
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
