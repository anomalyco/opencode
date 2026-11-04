//! The assistant footer and per-turn token usage (E.6a): `AssistantFooter` and `TurnTokenUsage`
//! (`routes/session/index.tsx:1737-1895,2013-2071`), with `SessionTurn`'s measurements
//! (`packages/util/src/session-turn.ts`).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{
    ModelRef, SessionMessageAssistant, SessionMessageAssistantContentItem,
    SessionMessageAssistantFinish, SessionMessageInfo,
};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use super::assistant::titlecase;
use super::list::Context;

/// The line under a finished step: agent, model, turn duration, tokens per second.
pub struct Footer {
    root: View,
    error: View,
    error_text: Text,
    line_box: View,
    line: Text,
    rendered: RefCell<String>,
}

impl Footer {
    pub fn new(cx: &Context<'_>) -> Self {
        let error_text = Text::new(cx.app, "")
            .fg(cx.theme.text.feedback.error.base)
            .wrap(WrapMode::Word);
        let error = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .child(&error_text);
        let line = Text::new(cx.app, "").wrap(WrapMode::Word);
        let line_box = View::new(cx.app).padding_edge(Edge::Left, 3).child(&line);
        let root = View::new(cx.app)
            .column()
            .shrink(0.0)
            .child(&error)
            .child(&line_box);
        Self {
            root,
            error,
            error_text,
            line_box,
            line,
            rendered: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageAssistant) {
        let theme = cx.theme;
        let muted = Style::new().fg(theme.text.muted);
        let interrupted = message
            .error
            .as_ref()
            .is_some_and(|error| error.message == "Step interrupted");
        // E.6b adds the free-limit and usage-limit notices and the retry row.
        let error = message
            .error
            .as_ref()
            .filter(|_| !interrupted && message.retry.is_none());
        self.error.visible(error.is_some());
        if let Some(error) = error {
            self.error_text
                .set_text(format!("Error: {}", error.message));
        }
        let index = cx.index.get(message.id.as_str()).copied();
        let duration = turn_duration(cx.messages, message, index, cx.legacy);
        let width = cx.width;
        let agent = if message.error.is_some() {
            theme.text.muted
        } else {
            cx.agent_color(message.agent.as_str())
        };
        let mut spans = vec![Span::styled(
            titlecase(message.agent.as_str()),
            Style::new().fg(agent),
        )];
        if width >= 28 {
            spans.push(Span::styled(
                format!(" · {}", cx.model_name(&message.model)),
                muted,
            ));
        }
        if duration > 0.0 && !(28..36).contains(&width) {
            spans.push(Span::styled(
                format!(" · {}", self::duration(duration)),
                muted,
            ));
        }
        if cx.tps
            && let Some(value) = tokens_per_second(cx.messages, index, cx.legacy)
        {
            spans.push(Span::styled(format!(" · {value:.1} tok/s"), muted));
        }
        if interrupted {
            spans.push(Span::styled(" · interrupted", muted));
        }
        let rendered = format!("{agent:?}{spans:?}");
        if self.rendered.replace(rendered.clone()) != rendered {
            self.line.set_text(spans);
        }
        let spaced = message.retry.is_some() || (message.error.is_some() && !interrupted);
        self.line_box
            .margin_edge(Edge::Top, if spaced { 1 } else { 0 });
    }
}

/// A turn's token usage: one collapsed summary line that a click opens into the per-step table.
pub struct TurnUsage(Rc<UsageInner>);

struct UsageInner {
    app: App,
    theme: Theme,
    root: View,
    summary: Text,
    table: View,
    steps: RefCell<Vec<Step>>,
    expanded: Cell<bool>,
    hover: Cell<bool>,
    verbose: Cell<bool>,
}

#[derive(Clone, Debug, PartialEq)]
struct Step {
    finish: String,
    tools: Vec<(String, String)>,
    new_tokens: f64,
    cached: f64,
    total: f64,
    reuse_drop: Option<f64>,
}

/// The cache reads of a turn's last step and its model, to spot a cache bust in the next turn.
#[derive(Clone, Debug, PartialEq)]
pub struct CacheUsage {
    pub read: f64,
    pub model: ModelRef,
}

impl CacheUsage {
    pub fn of(message: &SessionMessageAssistant) -> Self {
        Self {
            read: message
                .tokens
                .as_ref()
                .map_or(0.0, |tokens| tokens.cache.read),
            model: message.model.clone(),
        }
    }
}

impl TurnUsage {
    pub fn new(cx: &Context<'_>) -> Self {
        let summary = Text::new(cx.app, "")
            .fg(cx.theme.text.muted)
            .wrap(WrapMode::None);
        let header = View::new(cx.app).row().child(&summary);
        let table = View::new(cx.app).column().visible(false);
        let root = View::new(cx.app)
            .column()
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&header)
            .child(&table);
        let inner = Rc::new(UsageInner {
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            root,
            summary,
            table,
            steps: RefCell::default(),
            expanded: Cell::new(false),
            hover: Cell::new(false),
            verbose: Cell::new(false),
        });
        let weak = Rc::downgrade(&inner);
        header.on_click(move |_, _| {
            if let Some(inner) = weak.upgrade() {
                inner.expanded.set(!inner.expanded.get());
                inner.render();
            }
        });
        let weak = Rc::downgrade(&inner);
        header.on_hover(move |_, hovered| {
            if let Some(inner) = weak.upgrade() {
                inner.hover.set(hovered);
                inner.render();
            }
        });
        inner.render();
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(&self, cx: &Context<'_>, messages: &[String], previous: Option<&CacheUsage>) {
        let mut previous = previous.cloned();
        let steps = messages
            .iter()
            .filter_map(|id| cx.assistant(id))
            .filter_map(|message| {
                let tokens = message.tokens.as_ref()?;
                let total = total(message);
                if total == 0.0 {
                    return None;
                }
                let current = CacheUsage::of(message);
                let reuse_drop = cache_reuse_drop(previous.as_ref(), &current);
                previous = Some(current);
                Some(Step {
                    finish: match &message.finish {
                        Some(SessionMessageAssistantFinish::ToolCalls) => "tool-call".to_owned(),
                        Some(finish) => finish.as_str().to_owned(),
                        None => "unknown".to_owned(),
                    },
                    tools: if cx.verbose_tokens {
                        message
                            .content
                            .iter()
                            .filter_map(|item| match item {
                                SessionMessageAssistantContentItem::Tool(tool) => {
                                    Some((tool.name.clone(), tool_summary(tool)))
                                }
                                _ => None,
                            })
                            .collect()
                    } else {
                        Vec::new()
                    },
                    new_tokens: total - tokens.cache.read,
                    cached: tokens.cache.read,
                    total,
                    reuse_drop,
                })
            })
            .collect();
        if *self.0.steps.borrow() == steps && self.0.verbose.get() == cx.verbose_tokens {
            return;
        }
        self.0.verbose.set(cx.verbose_tokens);
        *self.0.steps.borrow_mut() = steps;
        self.0.render();
    }
}

impl UsageInner {
    fn render(&self) {
        let steps = self.steps.borrow();
        self.root.visible(!steps.is_empty());
        let theme = &self.theme;
        let latest = steps.last();
        let drops = steps
            .iter()
            .filter(|step| step.reuse_drop.is_some())
            .count();
        // TS asks for a bold "Tokens" and bold new-token counts through a span `attributes` style, which
        // its spans ignore; the cells are plain, so these are too.
        let mut spans = vec![
            Span::raw(if self.expanded.get() { "- " } else { "+ " }),
            Span::raw("Tokens"),
            Span::raw(format!(
                ": {} {} · latest: {} new · {} cached · {} total",
                steps.len(),
                if steps.len() == 1 { "step" } else { "steps" },
                locale(latest.map_or(0.0, |step| step.new_tokens)),
                locale(latest.map_or(0.0, |step| step.cached)),
                locale(latest.map_or(0.0, |step| step.total)),
            )),
        ];
        if drops > 0 {
            spans.push(Span::styled(
                format!(
                    " · ! {drops} likely cache {}",
                    if drops == 1 { "bust" } else { "busts" }
                ),
                Style::new().fg(theme.text.feedback.warning.base),
            ));
        }
        self.summary
            .fg(if self.hover.get() {
                theme.text.base
            } else {
                theme.text.muted
            })
            .set_text(spans);

        self.table.clear();
        self.table.visible(self.expanded.get());
        if !self.expanded.get() {
            return;
        }
        let width = |name: &str, value: &dyn Fn(&Step) -> String| {
            steps
                .iter()
                .map(|step| value(step).chars().count())
                .max()
                .unwrap_or(0)
                .max(name.len())
        };
        let columns = (
            width("Step", &|step| step.finish.clone()),
            width("New", &|step| locale(step.new_tokens)),
            width("Cached", &|step| locale(step.cached)),
            width("Total", &|step| locale(step.total)),
        );
        let row = |app: &App| View::new(app).column().padding_edge(Edge::Left, 2);
        let header = format!(
            "{:<step$}{:>new$}  {:>cached$}  {:>total$}",
            "Step",
            "New",
            "Cached",
            "Total",
            step = columns.0 + 2,
            new = columns.1,
            cached = columns.2,
            total = columns.3,
        );
        self.table.add(
            &row(&self.app).child(&Text::new(&self.app, header).fg(theme.text.muted).italic()),
        );
        for step in steps.iter() {
            let line = row(&self.app);
            let fg = if self.verbose.get() && step.finish == "tool-call" {
                theme.text.base
            } else {
                theme.text.muted
            };
            line.add(&Text::new(
                &self.app,
                vec![
                    Span::styled(
                        format!("{:<width$}", step.finish, width = columns.0 + 2),
                        Style::new().fg(fg),
                    ),
                    Span::styled(
                        format!("{:>width$}", locale(step.new_tokens), width = columns.1),
                        Style::new().fg(fg),
                    ),
                    Span::styled(
                        format!(
                            "  {:>cached$}  {:>total$}",
                            locale(step.cached),
                            locale(step.total),
                            cached = columns.2,
                            total = columns.3,
                        ),
                        Style::new().fg(fg),
                    ),
                ],
            ));
            if !step.tools.is_empty() {
                let name_width = step
                    .tools
                    .iter()
                    .map(|(name, _)| name.chars().count())
                    .max()
                    .unwrap_or(0)
                    + 2;
                let tools = View::new(&self.app).column().padding_edge(Edge::Left, 2);
                for (name, summary) in &step.tools {
                    tools.add(
                        &View::new(&self.app)
                            .row()
                            .child(
                                &Text::new(&self.app, name.as_str())
                                    .width(name_width as u16)
                                    .shrink(0.0)
                                    .fg(theme.text.muted)
                                    .bold(),
                            )
                            .child(
                                &Text::new(&self.app, summary.as_str())
                                    .fg(theme.text.muted)
                                    .dim()
                                    .wrap(WrapMode::Word)
                                    .grow(1.0)
                                    .basis(Length::Auto)
                                    .min_width(0),
                            ),
                    );
                }
                line.add(&tools);
            }
            if let Some(drop) = step.reuse_drop {
                line.add(
                    &Text::new(
                        &self.app,
                        format!(
                            "! Likely cache bust: {} fewer cached tokens than the previous step",
                            locale(drop)
                        ),
                    )
                    .fg(theme.text.feedback.warning.base),
                );
            }
            self.table.add(&line);
        }
    }
}

/// Every token the step used.
pub fn total(message: &SessionMessageAssistant) -> f64 {
    message.tokens.as_ref().map_or(0.0, |tokens| {
        tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    })
}

/// `cacheReuseDrop`: how many fewer tokens the cache served than the previous step of the same
/// model, when that looks like a bust.
pub fn cache_reuse_drop(previous: Option<&CacheUsage>, current: &CacheUsage) -> Option<f64> {
    let previous = previous?;
    if previous.model != current.model {
        return None;
    }
    let drop = previous.read - current.read;
    // OpenAI cache reads can move between one and two 1,024-token buckets without a material loss.
    if current.model.provider_id.as_str() == "openai" && (1024.0..=2048.0).contains(&drop) {
        return None;
    }
    (drop > 0.0).then_some(drop)
}

/// `turnTokenToolSummary`: the call's primary input, then its other scalar inputs.
fn tool_summary(tool: &opencode_api::generated::SessionMessageAssistantTool) -> String {
    use opencode_api::generated::SessionMessageAssistantToolState as State;
    let input = match &tool.state {
        State::Streaming(state) => return state.input.clone(),
        State::Running(state) => &state.input,
        State::Completed(state) => &state.input,
        State::Error(state) => &state.input,
        State::Unknown(value) => match value.get("input") {
            Some(serde_json::Value::String(text)) => return text.clone(),
            Some(serde_json::Value::Object(map)) => {
                return summarize(&map.iter().map(|(k, v)| (k.as_str(), v)).collect::<Vec<_>>());
            }
            _ => return String::new(),
        },
    };
    summarize(
        &input
            .iter()
            .map(|(k, v)| (k.as_str(), v))
            .collect::<Vec<_>>(),
    )
}

fn summarize(input: &[(&str, &serde_json::Value)]) -> String {
    let primary = [
        "command",
        "id",
        "pattern",
        "url",
        "query",
        "path",
        "description",
        "code",
    ]
    .into_iter()
    .find(|key| input.iter().any(|(name, _)| name == key));
    let scalar = |value: &serde_json::Value| match value {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        serde_json::Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    };
    let mut parts = Vec::new();
    if let Some((_, value)) = input.iter().find(|(name, _)| Some(*name) == primary)
        && let Some(value) = scalar(value)
    {
        parts.push(value);
    }
    parts.extend(
        input
            .iter()
            .filter(|(name, _)| Some(*name) != primary)
            .filter_map(|(name, value)| scalar(value).map(|value| format!("{name}: {value}"))),
    );
    parts.retain(|part| !part.is_empty());
    parts.join("  ")
}

/// `SessionTurn.duration`: milliseconds from the prompt that started the turn until `message`
/// completed, or 0 while it runs.
pub fn turn_duration(
    messages: &[SessionMessageInfo],
    message: &SessionMessageAssistant,
    index: Option<usize>,
    legacy: bool,
) -> f64 {
    let Some(completed) = message.time.completed else {
        return 0.0;
    };
    let input = input_index(messages, index.unwrap_or(messages.len()), legacy);
    let start = input
        .and_then(|input| messages.get(input))
        .map_or(message.time.created, created);
    (completed - start).max(0.0)
}

/// `SessionTurn.tokensPerSecond`: output and reasoning tokens per second across the turn's steps
/// up to `message`, or none until every step has streamed.
pub fn tokens_per_second(
    messages: &[SessionMessageInfo],
    index: Option<usize>,
    legacy: bool,
) -> Option<f64> {
    let end = index.map_or(messages.len(), |index| index + 1);
    let start = input_index(messages, end, legacy).map_or(0, |input| input + 1);
    let steps: Vec<_> = messages[start.min(end)..end]
        .iter()
        .filter_map(|item| match item {
            SessionMessageInfo::Assistant(step) => Some(step),
            _ => None,
        })
        .collect();
    let durations: Vec<f64> = steps
        .iter()
        .filter_map(|step| {
            step.time
                .streamed
                .map(|streamed| (streamed - step.time.created).max(0.0))
        })
        .collect();
    if steps.is_empty() || durations.len() != steps.len() {
        return None;
    }
    let output: f64 = steps
        .iter()
        .map(|step| {
            step.tokens
                .as_ref()
                .map_or(0.0, |tokens| tokens.output + tokens.reasoning)
        })
        .sum();
    let total: f64 = durations.iter().sum();
    if output <= 0.0 || total <= 0.0 {
        return None;
    }
    Some(output / (total / 1000.0))
}

/// The turn's prompt before `end`: the nearest input in legacy sessions, else the first input
/// after the previous idle marker.
fn input_index(messages: &[SessionMessageInfo], end: usize, legacy: bool) -> Option<usize> {
    let mut input = None;
    for index in (0..end.min(messages.len())).rev() {
        match &messages[index] {
            SessionMessageInfo::Idle(_) => return input,
            SessionMessageInfo::User(_) | SessionMessageInfo::Synthetic(_) => {
                if legacy {
                    return Some(index);
                }
                input = Some(index);
            }
            _ => {}
        }
    }
    input
}

fn created(message: &SessionMessageInfo) -> f64 {
    opencode_store::MessageExt::created(message)
}

/// `Locale.duration`: `850ms`, `12.4s`, `3m 5s`, `2h 10m`, `1d 4h`.
pub fn duration(input: f64) -> String {
    if input < 1000.0 {
        return format!("{}ms", js_number(input));
    }
    if input < 60_000.0 {
        return format!("{:.1}s", input / 1000.0);
    }
    let input = input.floor() as u64;
    if input < 3_600_000 {
        return format!("{}m {}s", input / 60_000, input % 60_000 / 1000);
    }
    if input < 86_400_000 {
        return format!("{}h {}m", input / 3_600_000, input % 3_600_000 / 60_000);
    }
    format!(
        "{}d {}h",
        input / 86_400_000,
        input % 86_400_000 / 3_600_000
    )
}

/// A number as JavaScript prints it: integers without a fraction.
fn js_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        format!("{value}")
    }
}

/// `Number.toLocaleString()` in `en-US` for token counts: digits grouped by commas.
pub fn locale(value: f64) -> String {
    let rounded = value.round() as i64;
    let digits = rounded.unsigned_abs().to_string();
    let mut grouped = String::new();
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    if rounded < 0 {
        format!("-{grouped}")
    } else {
        grouped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_matches_locale_duration() {
        assert_eq!(duration(850.0), "850ms");
        assert_eq!(duration(12_400.0), "12.4s");
        assert_eq!(duration(185_000.0), "3m 5s");
        assert_eq!(duration(7_800_000.0), "2h 10m");
        assert_eq!(duration(100_800_000.0), "1d 4h");
    }

    #[test]
    fn locale_groups_thousands() {
        assert_eq!(locale(0.0), "0");
        assert_eq!(locale(999.0), "999");
        assert_eq!(locale(1234.0), "1,234");
        assert_eq!(locale(1_234_567.0), "1,234,567");
    }
}
