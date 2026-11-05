//! Compaction messages (E.6b): `CompactionMessage` and `CompactionQueued`
//! (`routes/session/index.tsx:2171-2251`). A rule with the status in the middle, then the summary or the
//! failure as Markdown.

use std::cell::RefCell;

use opencode_api::generated::{SessionMessageCompaction, SessionMessageInfo, TokenUsageInfo};
use opencode_ui::motion::Spinner;
use opentui::prelude::*;
use opentui::widget::Markdown;

use super::list::Context;

pub struct Compaction {
    root: View,
    left: View,
    label: View,
    right: View,
    body: View,
    markdown: Markdown,
    rendered: RefCell<Option<Rendered>>,
}

#[derive(Clone, PartialEq)]
struct Rendered {
    status: Status,
    title: &'static str,
    usage: Option<String>,
    content: String,
}

#[derive(Clone, Copy, PartialEq)]
enum Status {
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl Compaction {
    pub fn new(cx: &Context<'_>) -> Self {
        let (left, label, right) = rule(cx);
        let markdown = opencode_ui::markdown::view(cx.app, cx.theme, cx.syntax, cx.renderers, cx.conceal, true);
        let body =
            View::new(cx.app).padding_edge(Edge::Top, 1).padding_edge(Edge::Left, 3).visible(false).child(&markdown);
        let line = View::new(cx.app).row().align_items(Align::Center).child(&left).child(&label).child(&right);
        let root = View::new(cx.app).column().shrink(0.0).child(&line).child(&body);
        Self { root, left, label, right, body, markdown, rendered: RefCell::default() }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageCompaction) {
        let (status, text, tokens, native) = match message {
            SessionMessageCompaction::Running(_) => (Status::Running, "", None, false),
            SessionMessageCompaction::Completed(done) => (
                Status::Completed,
                done.summary.as_str(),
                done.tokens.as_ref(),
                done.native.as_ref().is_some_and(|native| native.get("messages").is_some_and(truthy)),
            ),
            SessionMessageCompaction::Failed(failed) if failed.error.r#type == "aborted" => {
                (Status::Cancelled, "", failed.tokens.as_ref(), false)
            }
            SessionMessageCompaction::Failed(failed) => {
                (Status::Failed, failed.error.message.as_str(), failed.tokens.as_ref(), false)
            }
            SessionMessageCompaction::Unknown(_) => return,
        };
        let rendered = Rendered {
            status,
            title: if native { "Provider compaction" } else { "Compaction" },
            // The compaction request's own usage; the context it leaves shows on the next step.
            usage: (status != Status::Running).then(|| tokens.and_then(usage)).flatten(),
            content: text.trim().to_owned(),
        };
        if self.rendered.borrow().as_ref() == Some(&rendered) {
            return;
        }
        let theme = cx.theme;
        let color = if status == Status::Failed { theme.text.feedback.error.base } else { theme.text.muted };
        self.left.border_color(color);
        self.right.border_color(color);
        self.label.clear();
        match status {
            Status::Running => {
                self.label.add(&Spinner::new(cx.app).color(color).animations(cx.animations));
            }
            Status::Failed => {
                self.label.add(&Text::new(cx.app, "✗").fg(color));
            }
            _ => {}
        }
        self.label.add(&Text::new(cx.app, rendered.title).fg(color));
        if status == Status::Cancelled {
            self.label.add(&Text::new(cx.app, "· cancelled").fg(color));
        }
        if let Some(usage) = &rendered.usage {
            self.label.add(&Text::new(cx.app, format!("· {usage}")).fg(color));
        }
        let previous = self.rendered.borrow().as_ref().map(|r| r.content.clone());
        if previous.as_deref() != Some(rendered.content.as_str()) {
            self.markdown.set_markdown(rendered.content.as_str());
        }
        self.body.visible(!rendered.content.is_empty());
        *self.rendered.borrow_mut() = Some(rendered);
    }
}

/// A compaction waiting in the inbox: `◇ Compaction queued` on a rule in the border color.
pub struct Queued {
    root: View,
}

impl Queued {
    pub fn new(cx: &Context<'_>) -> Self {
        let (left, label, right) = rule(cx);
        let border = cx.theme.border.base;
        left.border_color(border);
        right.border_color(border);
        let muted = cx.theme.text.muted;
        label.add(&Text::new(cx.app, "◇").fg(muted));
        label.add(&Text::new(cx.app, "Compaction queued").fg(muted));
        let root =
            View::new(cx.app).row().shrink(0.0).align_items(Align::Center).child(&left).child(&label).child(&right);
        Self { root }
    }

    pub fn root(&self) -> &View {
        &self.root
    }
}

/// The messages in row order: running compactions after the rest, since they wait for the turn
/// (`reduceSessionRows`).
pub fn running_last(messages: &[SessionMessageInfo]) -> impl Iterator<Item = &SessionMessageInfo> {
    let running = |message: &&SessionMessageInfo| {
        matches!(message, SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_)))
    };
    messages.iter().filter(move |message| !running(message)).chain(messages.iter().filter(running))
}

/// Two growing top-border boxes around a padded label row.
fn rule(cx: &Context<'_>) -> (View, View, View) {
    let line = || View::new(cx.app).border(BorderStyle::Single).border_sides(Sides::TOP).grow(1.0);
    let label = View::new(cx.app).row().gap(1).padding_edge(Edge::Left, 1).padding_edge(Edge::Right, 1);
    (line(), label, line())
}

/// `1.2K in · 300 out`, or nothing when the request used no tokens.
fn usage(tokens: &TokenUsageInfo) -> Option<String> {
    let input = tokens.input + tokens.cache.read + tokens.cache.write;
    let output = tokens.output + tokens.reasoning;
    (input + output > 0.0).then(|| format!("{} in · {} out", number(input), number(output)))
}

/// `Locale.number`: `1.2K`, `3.4M`, or the plain number.
pub fn number(value: f64) -> String {
    if value >= 999_950.0 {
        return format!("{}M", fixed1(value / 1_000_000.0));
    }
    if value >= 1000.0 {
        return format!("{}K", fixed1(value / 1000.0));
    }
    if value.fract() == 0.0 {
        return format!("{}", value as i64);
    }
    format!("{value}")
}

/// `toFixed(1)`, which rounds a tie up where `{:.1}` rounds it to even.
fn fixed1(value: f64) -> String {
    format!("{:.1}", (value * 10.0).round() / 10.0)
}

fn truthy(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Null => false,
        serde_json::Value::Bool(value) => *value,
        serde_json::Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        serde_json::Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::number;

    #[test]
    fn number_abbreviates_as_locale_number() {
        assert_eq!(number(999.0), "999");
        assert_eq!(number(1250.0), "1.3K");
        assert_eq!(number(999_950.0), "1.0M");
        assert_eq!(number(0.0), "0");
    }
}
