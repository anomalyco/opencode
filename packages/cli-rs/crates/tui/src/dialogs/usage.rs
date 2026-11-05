//! Usage dialog (E.16): `/usage` in `component/usage.tsx`, on the limit math of `util/usage-limits.ts`.
//!
//! The limits come from `GET /api/experimental/usage/limits`, which asks OpenCode Console.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use chrono::{Local as Clock, TimeZone, Timelike};
use opencode_api::generated::{
    ModelInfo, ProviderInfo, UsageLimitsBudget, UsageLimitsBudgetCoverage, UsageLimitsBudgetPer,
    UsageLimitsBudgetScope, UsageLimitsInfo,
};
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogCx, DialogOptions, HeaderProps, header, layout};
use opencode_ui::select::{self, Select, SelectOption, SelectProps};
use opentui::prelude::*;

use crate::dialogs::model::{Local, locale_compare};

/// One limit on a model (`ModelLimit`).
#[derive(Clone, Debug, PartialEq)]
pub struct ModelLimit {
    pub budget: UsageLimitsBudget,
    pub spent: f64,
    pub left: f64,
}

/// What a model has left (`ModelUsage`): the limit closest to running out sets it.
#[derive(Clone, Debug, PartialEq)]
pub struct ModelUsage {
    pub left: f64,
    pub reached: bool,
    pub resets_at: f64,
    /// Every limit on the model, the one that sets `left` first.
    pub limits: Vec<ModelLimit>,
}

/// `UsageLevel`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Plenty,
    Low,
    Out,
    Reached,
}

/// `servedByConsole`: OpenCode Console serves the provider; OpenCode Go bills its own allowance.
pub fn served_by_console(provider: Option<&ProviderInfo>) -> bool {
    provider.is_some_and(|provider| {
        provider.integration_id.as_ref().is_some_and(|id| id.0 == "opencode") && provider.id.0 != "opencode-go"
    })
}

/// `modelUsage`: the limits on a paid model, or `None` when none applies.
pub fn model_usage(info: &UsageLimitsInfo, model: &ModelInfo, provider: Option<&ProviderInfo>) -> Option<ModelUsage> {
    if crate::dialogs::model::is_free(model) {
        return None;
    }
    let limit = |budget: &UsageLimitsBudget, spent: f64| ModelLimit {
        budget: budget.clone(),
        spent,
        left: (budget.limit - spent).max(0.0),
    };
    let mut limits: Vec<ModelLimit> = info
        .budgets
        .iter()
        .filter_map(|budget| {
            if matches!(budget.coverage, UsageLimitsBudgetCoverage::All) {
                return served_by_console(provider).then(|| limit(budget, budget.spent));
            }
            let entry = budget
                .models
                .iter()
                .find(|item| item.provider_id.0 == model.provider_id.0 && item.model_id == model.id)?;
            let spent = if matches!(budget.per, UsageLimitsBudgetPer::Model) {
                entry.spent.unwrap_or(0.0)
            } else {
                budget.spent
            };
            Some(limit(budget, spent))
        })
        .collect();
    limits.sort_by(|a, b| a.left.total_cmp(&b.left));
    let binding = limits.first()?;
    Some(ModelUsage {
        left: binding.left,
        reached: limits.iter().any(|item| item.spent >= item.budget.limit),
        resets_at: limits.iter().map(|item| item.budget.resets_at).fold(f64::INFINITY, f64::min),
        limits,
    })
}

/// `usageLevel`: `low` when what's left won't cover three requests that fill the context, `out` when not one.
pub fn level(usage: &ModelUsage, model: &ModelInfo) -> Level {
    if usage.reached || usage.left <= 0.0 {
        return Level::Reached;
    }
    let request = model.limit.context as f64 / 1_000_000.0 * model.cost.first().map_or(0.0, |cost| cost.input);
    if usage.left < request {
        return Level::Out;
    }
    if usage.left < request * 3.0 {
        return Level::Low;
    }
    Level::Plenty
}

/// `formatDollars`: whole amounts without cents, and a sliver as `<$0.01`.
pub fn format_dollars(value: f64) -> String {
    if value > 0.0 && value < 0.01 {
        return "<$0.01".into();
    }
    let negative = value < 0.0;
    let text = if value.fract() == 0.0 { format!("{:.0}", value.abs()) } else { format!("{:.2}", value.abs()) };
    let (whole, cents) = text.split_once('.').map_or((text.as_str(), None), |(w, c)| (w, Some(c)));
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    let sign = if negative { "-" } else { "" };
    match cents {
        Some(cents) => format!("{sign}${grouped}.{cents}"),
        None => format!("{sign}${grouped}"),
    }
}

/// `formatReset`: the time today, else the day with the time unless it is midnight here.
pub fn format_reset(at: f64) -> String {
    format_reset_at(at, chrono::Local::now())
}

fn format_reset_at(at: f64, now: chrono::DateTime<Clock>) -> String {
    let Some(date) = Clock.timestamp_millis_opt(at as i64).single() else {
        return "Invalid Date".into();
    };
    let time = date.format("%-I:%M %p").to_string();
    if date.date_naive() == now.date_naive() {
        return format!("{time} today");
    }
    let day = date.format("%b %-d").to_string();
    if date.hour() == 0 && date.minute() == 0 {
        return day;
    }
    format!("{day}, {time}")
}

/// `limitScope`: who spends from a limit, and which models it pools.
pub fn limit_scope(budget: &UsageLimitsBudget, workspace: Option<&str>) -> String {
    let who = if matches!(budget.scope, UsageLimitsBudgetScope::Each) {
        "Only you".to_owned()
    } else if budget.shared {
        format!("Everyone in {}", workspace.unwrap_or("the workspace"))
    } else {
        "You and others".to_owned()
    };
    if matches!(budget.per, UsageLimitsBudgetPer::Model) {
        return who;
    }
    format!("{who} · {}", limit_models(budget))
}

fn limit_models(budget: &UsageLimitsBudget) -> String {
    if matches!(budget.coverage, UsageLimitsBudgetCoverage::All) {
        return "All models".into();
    }
    let vendors = (!budget.vendors.is_empty()).then(|| list(&budget.vendors));
    let price = budget.input_price_at_least.map(|price| format!("{} per 1M", format_dollars(price)));
    match (vendors, price) {
        (Some(vendors), Some(price)) => format!("{vendors} models over {price}"),
        (Some(vendors), None) => format!("All {vendors} models"),
        (None, Some(price)) => format!("Models over {price}"),
        (None, None) => {
            let names: Vec<&str> = budget.models.iter().map(|model| model.name.as_str()).collect();
            if names.len() > 3 {
                return format!("{} +{} more", names[..3].join(", "), names.len() - 3);
            }
            names.join(", ")
        }
    }
}

// `Intl.ListFormat("en-US", { style: "long", type: "conjunction" })`.
fn list(items: &[String]) -> String {
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => format!("{a} and {b}"),
        [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
    }
}

impl Local {
    /// `useUsageLimits().usage`.
    pub fn model_usage(&self, model: &ModelInfo) -> Option<ModelUsage> {
        let info = self.usage()??;
        model_usage(&info, model, self.provider(&model.provider_id.0).as_ref())
    }
}

/// `DialogUsage`: the models the workspace limits, with what each has left.
pub fn show(local: &Rc<Local>) {
    local.load_usage(true);
    let weak = Rc::downgrade(local);
    local.dialogs.replace(
        move |cx| {
            let Some(local) = weak.upgrade() else {
                return View::new(&cx.app);
            };
            build(cx, &local)
        },
        None,
        DialogOptions::default(),
    );
}

#[derive(Clone)]
struct Row {
    model: ModelInfo,
    usage: ModelUsage,
    level: Level,
}

fn key(model: &ModelInfo) -> String {
    format!("{}/{}", model.provider_id.0, model.id)
}

fn rows(local: &Local) -> Vec<Row> {
    let mut rows: Vec<Row> = local
        .models()
        .into_iter()
        .filter_map(|model| {
            let usage = local.model_usage(&model)?;
            let level = level(&usage, &model);
            Some(Row { model, usage, level })
        })
        .collect();
    rows.sort_by(|a, b| locale_compare(&a.model.name, &b.model.name));
    rows
}

fn build(cx: &Rc<DialogCx>, local: &Rc<Local>) -> View {
    let error = cx.theme.text.feedback.error.base;
    let state = local.usage();
    // Reopen once the limits arrive or sign-in changes, since the three states lay out differently.
    let shown = state.as_ref().map(Option::is_some);
    let weak = Rc::downgrade(local);
    let reopened = Rc::new(Cell::new(false));
    let handle: Rc<RefCell<Option<Select<String>>>> = Rc::default();
    let refresh = handle.clone();
    let active: Rc<RefCell<Option<String>>> = Rc::default();
    let selected = active.clone();
    cx.on_close(local.subscribe(move || {
        let Some(local) = weak.upgrade() else { return };
        if reopened.get() {
            return;
        }
        if local.usage().as_ref().map(Option::is_some) != shown {
            reopened.set(true);
            let again = local.clone();
            local.app.defer(move |_| show(&again));
            return;
        }
        if let Some(handle) = refresh.borrow().as_ref() {
            handle.set_options(options(&local, &selected.borrow(), error));
        }
    }));
    let Some(info) = state else {
        return message(cx, "Usage", "Loading…", false);
    };
    let Some(info) = info else {
        return message(
            cx,
            "Usage",
            "Sign in to OpenCode Console with /connect to see your workspace's usage limits.",
            true,
        );
    };
    let current = rows(local);
    let resets = current.iter().map(|row| row.usage.resets_at).fold(f64::INFINITY, f64::min);
    let description = [
        info.workspace.name.as_ref().map(|name| format!("Workspace: {name}")),
        (!current.is_empty()).then(|| format!("Resets {}", format_reset(resets))),
    ]
    .into_iter()
    .flatten()
    .collect::<Vec<_>>()
    .join(" · ");
    let mut props = SelectProps::new("Usage", options(local, &None, error));
    props.description = Some(description);
    props.placeholder = Some("Search models".into());
    let (app, muted) = (cx.app.clone(), cx.theme.text.muted);
    props.empty_view = Some(Rc::new(move || {
        View::new(&app)
            .padding_x(DIALOG_LIST_INSET)
            .child(
                &Text::new(
                    &app,
                    "No limits apply to your models. Paid models stop only if the workspace runs out of credits.",
                )
                .fg(muted)
                .wrap(WrapMode::Word),
            )
            .as_any()
    }));
    let weak = Rc::downgrade(local);
    props.on_select = Some(Rc::new(move |option: &SelectOption<String>| {
        let Some(local) = weak.upgrade() else { return };
        if let Some(row) = rows(&local).into_iter().find(|row| key(&row.model) == option.value) {
            crate::dialogs::usage_model::show(&local, row.model);
        }
    }));
    let weak = Rc::downgrade(local);
    let refresh = handle.clone();
    props.on_move = Some(Rc::new(move |option: &SelectOption<String>| {
        if active.borrow().as_ref() == Some(&option.value) {
            return;
        }
        *active.borrow_mut() = Some(option.value.clone());
        let (Some(local), Some(handle)) = (weak.upgrade(), refresh.borrow().clone()) else {
            return;
        };
        let active = active.clone();
        let app = local.app.clone();
        // The footer follows the selection; set the rows after the move finishes.
        app.defer(move |_| handle.set_options(options(&local, &active.borrow(), error)));
    }));
    let (view, select) = select::select(cx, props);
    *handle.borrow_mut() = Some(select);
    view
}

// Spend shared between models would look counted twice on every row, so only the selected one shows it.
fn options(local: &Local, active: &Option<String>, error: Color) -> Vec<SelectOption<String>> {
    let rows = rows(local);
    let selected = active.clone().or_else(|| rows.first().map(|row| key(&row.model)));
    rows.into_iter()
        .map(|row| {
            let value = key(&row.model);
            let mut option = SelectOption::new(row.model.name.clone(), value.clone());
            if selected.as_ref() == Some(&value) {
                option.footer = Some(format!("{} left", format_dollars(row.usage.left)));
            }
            if matches!(row.level, Level::Out | Level::Reached) {
                option.footer_color = Some(error);
            }
            option
        })
        .collect()
}

/// A dialog with a header and one muted line, as the loading and signed-out states of `DialogUsage`.
pub(crate) fn message(cx: &DialogCx, title: &str, text: &str, wrap: bool) -> View {
    let head = header(cx, HeaderProps { title: title.to_owned(), ..HeaderProps::default() });
    let body = Text::new(&cx.app, text).fg(cx.theme.text.muted);
    if wrap {
        body.wrap(WrapMode::Word);
    }
    layout(cx, &head, &body, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dollars_format_as_intl_does() {
        let cases = [
            (0.0, "$0"),
            (3.0, "$3"),
            (12.5, "$12.50"),
            (0.004, "<$0.01"),
            (1234.5, "$1,234.50"),
            (1_000_000.0, "$1,000,000"),
            (2.999, "$3.00"),
            (0.01, "$0.01"),
        ];
        for (value, expected) in cases {
            assert_eq!(format_dollars(value), expected, "{value}");
        }
    }

    #[test]
    fn lists_join_as_intl_does() {
        let names = |items: &[&str]| items.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(list(&names(&["Anthropic"])), "Anthropic");
        assert_eq!(list(&names(&["Anthropic", "OpenAI"])), "Anthropic and OpenAI");
        assert_eq!(list(&names(&["A", "B", "C"])), "A, B, and C");
    }

    #[test]
    fn resets_name_today_or_the_day() {
        let now = Clock.with_ymd_and_hms(2026, 11, 4, 9, 0, 0).unwrap();
        let at = |h, m, d| Clock.with_ymd_and_hms(2026, 11, d, h, m, 0).unwrap().timestamp_millis() as f64;
        assert_eq!(format_reset_at(at(15, 5, 4), now), "3:05 PM today");
        assert_eq!(format_reset_at(at(0, 0, 6), now), "Nov 6");
        assert_eq!(format_reset_at(at(0, 30, 6), now), "Nov 6, 12:30 AM");
    }
}
