//! Errors and retries (E.6b): `ExecutionError`, the footer's error notices (`FreeLimitNotice`,
//! `UsageLimitNotice` with `useLimitNotice`, or the plain `Error:` line), and `AssistantRetry`
//! (`routes/session/index.tsx:1966-1973,2035-2049,2514-2566`, `component/usage.tsx:255-332`). Also the free-limit
//! stop that restores the prompt and offers OpenCode Go (`index.tsx:646-759`).

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};
use std::time::Duration;

use chrono::{Local as Clock, TimeZone};
use opencode_api::generated::{
    SessionMessageAssistant, SessionMessageAssistantRetry, SessionMessageInfo, SessionStructuredError,
};
use opentui::prelude::*;

use super::list::Context;
use crate::app::Tui;
use crate::dialogs::{go_upsell, usage};

const DAY_MS: f64 = 86_400_000.0;

/// `errorMessage` of a structured error: its message, else the error as JSON.
pub fn message(error: &SessionStructuredError) -> String {
    if !error.message.is_empty() {
        return error.message.clone();
    }
    serde_json::to_string_pretty(error).unwrap_or_else(|_| "unknown error".to_owned())
}

/// The failure an idle marker carries when the execution failed outside a step.
pub struct ExecutionError {
    root: View,
    text: Text,
}

impl ExecutionError {
    pub fn new(cx: &Context<'_>) -> Self {
        let text = Text::new(cx.app, "").fg(cx.theme.text.feedback.error.base);
        let root = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&text);
        Self { root, text }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, message: &SessionMessageInfo) {
        if let SessionMessageInfo::Idle(idle) = message
            && let Some(error) = &idle.error
        {
            self.text.set_text(format!("Error: {}", self::message(error)));
        }
    }
}

/// The footer's error: the free-limit notice, a usage-limit notice, or `Error: …`, then the retry line.
pub struct StepError {
    root: View,
    notice: View,
    retry: Retry,
    rendered: RefCell<Option<Notice>>,
}

#[derive(Clone, Debug, PartialEq)]
enum Notice {
    None,
    Plain(String),
    FreeLimit(Option<String>),
    Limit(LimitNotice),
}

/// `useLimitNotice`'s value.
#[derive(Clone, Debug, PartialEq)]
pub struct LimitNotice {
    pub title: String,
    pub body: String,
    pub key: Option<String>,
    pub link: Option<(String, String)>,
}

impl StepError {
    pub fn new(cx: &Context<'_>) -> Self {
        let notice = View::new(cx.app).column().visible(false);
        let retry = Retry::new(cx);
        let root = View::new(cx.app)
            .column()
            .shrink(0.0)
            .child(&notice)
            .child(retry.root());
        Self {
            root,
            notice,
            retry,
            rendered: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageAssistant) {
        self.retry.update(message.retry.as_ref());
        let interrupted = message
            .error
            .as_ref()
            .is_some_and(|error| error.message == "Step interrupted");
        let notice = match &message.error {
            Some(error) if !interrupted && message.retry.is_none() => {
                if error.r#type == "provider.free-limit" {
                    Notice::FreeLimit(free_limit_reset(
                        error.retry_after_ms.map(|delay| delay as f64),
                        message.time.completed.unwrap_or(message.time.created),
                        now(),
                    ))
                } else if let Some(limit) = limit_notice(cx, message, error) {
                    Notice::Limit(limit)
                } else {
                    Notice::Plain(format!("Error: {}", self::message(error)))
                }
            }
            _ => Notice::None,
        };
        if self.rendered.borrow().as_ref() == Some(&notice) {
            return;
        }
        let theme = cx.theme;
        let app = cx.app;
        let (muted, base) = (theme.text.muted, theme.text.base);
        self.notice.clear();
        self.notice.visible(notice != Notice::None);
        match &notice {
            Notice::None => {}
            Notice::Plain(text) => {
                self.notice.add(
                    &View::new(app)
                        .padding_edge(Edge::Left, 3)
                        .child(&Text::new(app, text.as_str()).fg(theme.text.feedback.error.base)),
                );
            }
            Notice::FreeLimit(reset) => {
                let first = match reset {
                    Some(reset) => {
                        format!("You've used today's free messages. They reset at {reset}.")
                    }
                    None => "You've used today's free messages.".to_owned(),
                };
                let second = vec![
                    Span::styled("Upgrade to OpenCode Go → ", Style::new().fg(muted)),
                    Span::styled("/connect", Style::new().fg(base)),
                    Span::styled(" · Switch model → ", Style::new().fg(muted)),
                    Span::styled("/models", Style::new().fg(base)),
                ];
                self.notice.add(
                    &View::new(app)
                        .column()
                        .padding_edge(Edge::Left, 3)
                        .child(&Text::new(app, first).fg(muted))
                        .child(&Text::new(app, second).fg(muted)),
                );
            }
            Notice::Limit(limit) => {
                let mut body = vec![Span::styled(limit.body.clone(), Style::new().fg(muted))];
                if let Some(key) = &limit.key {
                    body.push(Span::styled(" ", Style::new().fg(muted)));
                    body.push(Span::styled(key.clone(), Style::new().fg(base)));
                    body.push(Span::styled(" to continue.", Style::new().fg(muted)));
                }
                let view = View::new(app)
                    .column()
                    .margin_edge(Edge::Left, 2)
                    .border(BorderStyle::Heavy)
                    .border_sides(Sides::LEFT)
                    .border_color(theme.border.base)
                    .padding_edge(Edge::Left, 1)
                    .padding_edge(Edge::Top, 1)
                    .padding_edge(Edge::Bottom, 1)
                    .child(&Text::new(app, limit.title.as_str()).fg(base))
                    .child(&Text::new(app, body).fg(muted).wrap(WrapMode::Word));
                if let Some((label, href)) = &limit.link {
                    view.add(
                        &View::new(app)
                            .column()
                            .padding_edge(Edge::Top, 1)
                            .child(&Text::new(app, label.as_str()).fg(muted).wrap(WrapMode::Word))
                            .child(&Text::new(app, href.as_str()).fg(base)),
                    );
                }
                self.notice.add(&view);
            }
        }
        *self.rendered.borrow_mut() = Some(notice);
    }
}

/// `⚠ Retrying in 4s · attempt 2 · <error>`, counting down each second, then `Retry due`.
pub struct Retry(Rc<RetryInner>);

struct RetryInner {
    app: App,
    root: View,
    text: Text,
    retry: RefCell<Option<SessionMessageAssistantRetry>>,
    timer: Cell<Option<TimerId>>,
    this: Weak<RetryInner>,
}

impl Retry {
    fn new(cx: &Context<'_>) -> Self {
        let text = Text::new(cx.app, "").fg(cx.theme.text.feedback.warning.base);
        let root = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .visible(false)
            .child(&text);
        Self(Rc::new_cyclic(|this| RetryInner {
            app: cx.app.clone(),
            root,
            text,
            retry: RefCell::default(),
            timer: Cell::new(None),
            this: this.clone(),
        }))
    }

    fn root(&self) -> &View {
        &self.0.root
    }

    fn update(&self, retry: Option<&SessionMessageAssistantRetry>) {
        if self.0.retry.borrow().as_ref() == retry {
            return;
        }
        *self.0.retry.borrow_mut() = retry.cloned();
        if let Some(timer) = self.0.timer.take() {
            self.0.app.cancel_timer(timer);
        }
        self.0.root.visible(retry.is_some());
        if self.0.render() > 0 {
            let weak = self.0.this.clone();
            self.0
                .timer
                .set(Some(self.0.app.set_interval(Duration::from_secs(1), move |_| {
                    let Some(inner) = weak.upgrade() else { return };
                    if inner.render() == 0
                        && let Some(timer) = inner.timer.take()
                    {
                        inner.app.cancel_timer(timer);
                    }
                })));
        }
    }
}

impl Drop for Retry {
    fn drop(&mut self) {
        if let Some(timer) = self.0.timer.take() {
            self.0.app.cancel_timer(timer);
        }
    }
}

impl RetryInner {
    /// Draws the line and returns the seconds left.
    fn render(&self) -> u64 {
        let Some(retry) = self.retry.borrow().clone() else {
            return 0;
        };
        let seconds = ((retry.at - now()) / 1000.0).ceil().max(0.0) as u64;
        let when = if seconds > 0 {
            format!("Retrying in {seconds}s")
        } else {
            "Retry due".to_owned()
        };
        self.text.set_text(format!(
            "⚠ {when} · attempt {} · {}",
            retry.attempt, retry.error.message
        ));
        seconds
    }
}

/// `useLimitNotice`: why a turn stopped at a usage limit or for lack of credits, and how to go on.
fn limit_notice(
    cx: &Context<'_>,
    message: &SessionMessageAssistant,
    error: &SessionStructuredError,
) -> Option<LimitNotice> {
    let local = &cx.tui.local;
    let body = error.response.as_ref().map(|response| response.body.as_str());
    let reset = body.and_then(refusal_reset).or_else(|| {
        retry_reset(
            error.retry_after_ms.map(|delay| delay as f64),
            message.time.completed.unwrap_or(message.time.created),
        )
    });
    let resets = reset.map_or_else(String::new, |at| format!("Resets {}. ", usage::format_reset(at)));
    let key = Some(
        cx.keys
            .model_list
            .clone()
            .unwrap_or_else(|| "/models".to_owned()),
    );
    let models = local.models();
    let name = models
        .iter()
        .find(|model| model.provider_id == message.model.provider_id && model.id == message.model.id)
        .map_or_else(|| message.model.id.clone(), |model| model.name.clone());
    match error.r#type.as_str() {
        "provider.go-limit" => {
            let title = match body.and_then(|body| json_string(body, "limitName")) {
                Some(limit) => format!("OpenCode Go {limit} usage limit reached"),
                None => "OpenCode Go usage limit reached".to_owned(),
            };
            let link = match body
                .and_then(|body| json_string(body, "workspace"))
                .filter(|id| {
                    (id.starts_with("org_") || id.starts_with("wrk_"))
                        && id[4..]
                            .chars()
                            .all(|c| c.is_alphanumeric() || c == '_' || c == '-')
                        && id.len() > 4
                }) {
                Some(workspace) => format!("https://opencode.ai/console/{workspace}/go"),
                None => "https://opencode.ai/console".to_owned(),
            };
            Some(LimitNotice {
                title,
                body: format!("{resets}Switch to a free model with"),
                key,
                link: Some((
                    "Or turn on Extra Usage on your Go page to keep going now:".to_owned(),
                    link,
                )),
            })
        }
        "provider.model-budget-limit" => Some(LimitNotice {
            title: format!("{name} usage limit reached"),
            body: format!("{resets}Switch model with"),
            key,
            link: None,
        }),
        "provider.budget-limit" => Some(LimitNotice {
            title: "Usage limit reached".to_owned(),
            body: format!("{resets}Paid models are paused. Switch to a free model with"),
            key,
            link: None,
        }),
        _ if error.status == Some(402)
            && usage::served_by_console(local.provider(message.model.provider_id.as_str()).as_ref()) =>
        {
            let workspace = local
                .usage()
                .flatten()
                .and_then(|info| info.workspace.name.clone());
            Some(LimitNotice {
                title: format!(
                    "{} is out of credits",
                    workspace.as_deref().unwrap_or("Your workspace")
                ),
                body: "Paid models are paused until an admin adds credits in OpenCode Console."
                    .to_owned(),
                key: None,
                link: None,
            })
        }
        _ => None,
    }
}

/// `freeLimitReset`: the time when that is today and within a day, else the time and date.
pub fn free_limit_reset(delay: Option<f64>, base: f64, now: f64) -> Option<String> {
    let delay = delay.filter(|delay| delay.is_finite() && *delay >= 0.0 && *delay <= 7.0 * DAY_MS)?;
    let at = base + delay;
    let date = Clock.timestamp_millis_opt(at as i64).single()?;
    let today = Clock.timestamp_millis_opt(now as i64).single()?;
    // `toLocaleTimeString(undefined, { timeStyle: "short" })` in en-US puts a narrow no-break space before AM/PM.
    let time = date.format("%-I:%M\u{202f}%p").to_string();
    if date.date_naive() == today.date_naive() && at - now < DAY_MS {
        return Some(time);
    }
    Some(format!("{time} · {}", date.format("%-m/%-d/%Y")))
}

/// `refusalReset`: OpenCode Console names the reset `resetsAt` in the error body.
fn refusal_reset(body: &str) -> Option<f64> {
    let at = json_string(body, "resetsAt")?;
    chrono::DateTime::parse_from_rfc3339(at)
        .ok()
        .map(|at| at.timestamp_millis() as f64)
}

/// `retryReset`: `retry-after` from `base`; nothing past 45 days, as a bad header.
fn retry_reset(delay: Option<f64>, base: f64) -> Option<f64> {
    let delay = delay.filter(|delay| delay.is_finite() && *delay >= 0.0 && *delay <= 45.0 * DAY_MS)?;
    Some(base + delay)
}

/// The first `"key": "value"` string in `body`, as the TS regexes find it.
fn json_string<'a>(body: &'a str, key: &str) -> Option<&'a str> {
    let needle = format!("\"{key}\"");
    let mut rest = body;
    while let Some(at) = rest.find(&needle) {
        rest = &rest[at + needle.len()..];
        let value = rest.trim_start();
        let Some(value) = value.strip_prefix(':') else { continue };
        let Some(value) = value.trim_start().strip_prefix('"') else {
            continue;
        };
        let end = value.find('"')?;
        if end > 0 {
            return Some(&value[..end]);
        }
    }
    None
}

/// `Date.now()`.
pub fn now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_millis() as f64)
}

/// The free-limit and Go-limit stops (`session.step.failed`): restore the stopped prompt when the prompt is empty, and
/// offer OpenCode Go on the first free-limit stop of a day. Only stops seen live count: an error that is already
/// there when a message first shows is history.
#[derive(Default)]
pub struct LimitWatch {
    /// Assistant messages seen while they had no error.
    live: RefCell<HashSet<String>>,
    handled: RefCell<HashSet<String>>,
}

/// A limit stop to act on once the store is unlocked.
pub struct Stop {
    recalled: Option<String>,
    /// The free limit's reset time, for the Go offer; `None` for a Go limit, which only restores the prompt.
    offer: Option<Option<String>>,
}

impl Stop {
    pub fn run(self, tui: &Tui) {
        stopped(tui, self.recalled, self.offer);
    }
}

impl LimitWatch {
    /// The new limit stops among the visible messages, after a store flush.
    pub fn check(&self, messages: &[SessionMessageInfo], pending: &dyn Fn(&str) -> bool) -> Vec<Stop> {
        let mut stops = Vec::new();
        for (index, message) in messages.iter().enumerate() {
            let SessionMessageInfo::Assistant(assistant) = message else {
                continue;
            };
            let Some(error) = &assistant.error else {
                self.live.borrow_mut().insert(assistant.id.0.clone());
                continue;
            };
            let free = error.r#type == "provider.free-limit";
            if !(free || error.r#type == "provider.go-limit")
                || !self.live.borrow().contains(assistant.id.as_str())
                || !self.handled.borrow_mut().insert(assistant.id.0.clone())
            {
                continue;
            }
            // The prompt that stopped: the last user message of the turn not still waiting in the inbox.
            let recalled = messages[..index]
                .iter()
                .rev()
                .take_while(|item| !matches!(item, SessionMessageInfo::Shell(_) | SessionMessageInfo::Idle(_)))
                .find_map(|item| match item {
                    SessionMessageInfo::User(user) if !pending(user.id.as_str()) => Some(user.text.clone()),
                    _ => None,
                });
            let reset = free_limit_reset(
                error.retry_after_ms.map(|delay| delay as f64),
                assistant.time.completed.unwrap_or(assistant.time.created),
                now(),
            );
            stops.push(Stop {
                recalled,
                offer: free.then_some(reset),
            });
        }
        stops
    }
}

/// Puts `recalled` back into an empty prompt, then offers OpenCode Go when `offer` is set.
fn stopped(tui: &Tui, recalled: Option<String>, offer: Option<Option<String>>) {
    let Some(textarea) = tui.textarea.borrow().clone() else {
        return;
    };
    if !textarea.text().trim().is_empty() {
        return;
    }
    if let Some(text) = &recalled {
        textarea.set_text(text);
    }
    let Some(reset) = offer else { return };
    if tui.dialogs.is_open() {
        return;
    }
    let expected = textarea.text();
    let weak = tui.weak();
    let check = textarea.clone();
    let submit = tui.weak();
    go_upsell::offer(
        &tui.local,
        go_upsell::Offer {
            reset,
            can_continue: Rc::new(move || weak.upgrade().is_some() && check.text() == expected),
            on_subscribe: Rc::new(move || {
                if let Some(tui) = submit.upgrade() {
                    tui.keymap.dispatch("prompt.submit", None);
                }
            }),
        },
        now(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_string_finds_console_fields() {
        let body = r#"{"error":{"resetsAt" : "2026-01-15T12:00:00Z","limitName":"weekly","workspace":"wrk_1"}}"#;
        assert_eq!(json_string(body, "resetsAt"), Some("2026-01-15T12:00:00Z"));
        assert_eq!(json_string(body, "limitName"), Some("weekly"));
        assert_eq!(json_string(body, "missing"), None);
        assert_eq!(refusal_reset(body), Some(1_768_478_400_000.0));
    }

    #[test]
    fn free_limit_reset_drops_bad_delays() {
        assert_eq!(free_limit_reset(None, 0.0, 0.0), None);
        assert_eq!(free_limit_reset(Some(-1.0), 0.0, 0.0), None);
        assert_eq!(free_limit_reset(Some(8.0 * DAY_MS), 0.0, 0.0), None);
        // Over a day away is always the time and the date.
        let far = free_limit_reset(Some(2.0 * DAY_MS), 1_768_478_400_000.0, 1_768_478_400_000.0).unwrap();
        assert!(far.contains(" · "), "{far}");
    }
}
