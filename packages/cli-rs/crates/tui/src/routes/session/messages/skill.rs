//! Skill, notice, and switch messages (E.6b): `SessionSkillMessage`, `SessionNoticeMessageV2`, and
//! `SessionSwitchMessageV2` (`routes/session/index.tsx:2073-2169`). Each is one line padded 3 from the left; skills
//! and plain notices take `InlineToolRow`'s two-cell icon.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use opencode_api::generated::{ModelInfo, ModelRef, SessionID, SessionMessageInfo};
use opencode_ui::bind;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::assistant::titlecase;
use super::list::Context;
use crate::app::Tui;
use crate::routes::Route;

pub struct Notice(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    tui: Weak<Tui>,
    root: View,
    rendered: RefCell<Option<Line>>,
    /// The completion heading, recolored on hover.
    heading: RefCell<Option<Text>>,
    hover: Cell<bool>,
}

/// What a notice row shows.
#[derive(Clone, Debug, PartialEq)]
enum Line {
    /// `InlineToolRow`: an icon in two cells, then the text.
    Inline { icon: &'static str, text: String },
    /// One muted line.
    Plain(String),
    /// `↳ Moved to ` then the directory in the info color.
    Moved(String),
    /// A subagent's or shell's completion: the heading in its state's color, then a muted suffix.
    Completion { heading: String, suffix: String, state: Option<String>, child: Option<String> },
}

impl Notice {
    pub fn new(cx: &Context<'_>) -> Self {
        let root = View::new(cx.app).column().shrink(0.0).padding_edge(Edge::Left, 3);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            tui: cx.tui.weak(),
            root,
            rendered: RefCell::default(),
            heading: RefCell::default(),
            hover: Cell::new(false),
        });
        inner.root.on_hover(bind!(inner, |inner, _, hovered| {
            let child = matches!(&*inner.rendered.borrow(), Some(Line::Completion { child: Some(_), .. }));
            inner.root.mouse_pointer(opencode_ui::click_pointer(child));
            inner.hover.set(hovered);
            inner.paint();
        }));
        inner.root.on_click(bind!(inner, |inner, _, _| {
            let child = match &*inner.rendered.borrow() {
                Some(Line::Completion { child: Some(child), .. }) => child.clone(),
                _ => return,
            };
            if let Some(tui) = inner.tui.upgrade() {
                tui.navigate(Route::Session { id: SessionID(child) });
            }
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageInfo) {
        let line = line(message, cx.models, cx.content_width());
        if self.0.rendered.borrow().as_ref() == Some(&line) {
            return;
        }
        let theme = &self.0.theme;
        let app = &self.0.app;
        let muted = theme.text.muted;
        self.0.root.clear();
        *self.0.heading.borrow_mut() = None;
        match &line {
            Line::Inline { icon, text } => {
                let row = View::new(app)
                    .row()
                    .child(&Text::new(app, *icon).width(2).shrink(0.0).fg(muted))
                    .child(&Text::new(app, text.as_str()).grow(1.0).fg(muted));
                self.0.root.add(&row);
            }
            Line::Plain(text) => {
                self.0.root.add(&Text::new(app, text.as_str()).fg(muted));
            }
            Line::Moved(directory) => {
                self.0.root.add(&Text::new(
                    app,
                    vec![
                        Span::styled("↳ Moved to ", Style::new().fg(muted)),
                        Span::styled(directory.clone(), Style::new().fg(theme.text.feedback.info.base)),
                    ],
                ));
            }
            Line::Completion { .. } => {
                // One text, as TS has it: a line break in the suffix starts under the heading.
                let text = Text::new(app, "").wrap(WrapMode::None);
                self.0.root.add(&text);
                *self.0.heading.borrow_mut() = Some(text);
            }
        }
        *self.0.rendered.borrow_mut() = Some(line);
        self.0.paint();
    }
}

impl Inner {
    fn paint(&self) {
        let Some(Line::Completion { heading, suffix, state, child }) = &*self.rendered.borrow() else {
            return;
        };
        let theme = &self.theme;
        let color = match state.as_deref() {
            Some("error") => theme.text.feedback.error.base,
            Some("cancelled") => theme.text.feedback.warning.base,
            _ if self.hover.get() && child.is_some() => theme.text.base,
            _ => theme.text.feedback.info.base,
        };
        if let Some(text) = &*self.heading.borrow() {
            text.set_text(vec![
                Span::styled(heading.clone(), Style::new().fg(color)),
                Span::styled(suffix.clone(), Style::new().fg(theme.text.muted)),
            ]);
        }
    }
}

fn line(message: &SessionMessageInfo, models: &[ModelInfo], width: usize) -> Line {
    match message {
        SessionMessageInfo::Skill(skill) => {
            Line::Inline { icon: "→", text: format!("Skill {}", skill.name.as_str()) }
        }
        SessionMessageInfo::AgentSwitched(switched) => {
            let agent = titlecase(switched.agent.as_str());
            Line::Plain(match &switched.previous {
                Some(previous) if *previous != switched.agent => {
                    format!("Switched agent from {} to {agent}", titlecase(previous.as_str()))
                }
                _ => format!("Switched agent to {agent}"),
            })
        }
        SessionMessageInfo::ModelSwitched(switched) => {
            Line::Plain(switch_label(&switched.model, models, switched.previous.as_ref()))
        }
        SessionMessageInfo::LocationSwitched(switched) => Line::Moved(switched.location.directory.to_string()),
        SessionMessageInfo::System(system) => Line::Inline {
            icon: "◈",
            text: system.description.clone().unwrap_or_else(|| "Instructions updated".to_owned()),
        },
        SessionMessageInfo::Synthetic(synthetic) => {
            let text = synthetic.description.clone().unwrap_or_default();
            let meta = |key: &str| {
                synthetic
                    .metadata
                    .as_ref()
                    .and_then(|metadata| metadata.get(key))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            };
            let source = meta("source");
            if !matches!(source.as_deref(), Some("subagent" | "shell")) {
                return Line::Inline { icon: if source.as_deref() == Some("goal") { "◎" } else { "◈" }, text };
            }
            let shell = source.as_deref() == Some("shell");
            let state = meta("state");
            let actor =
                if shell { "Shell".to_owned() } else { titlecase(meta("agent").as_deref().unwrap_or("Subagent")) };
            let status = match state.as_deref() {
                Some("completed") | None => "finished",
                Some("error") => "failed",
                Some(other) => other,
            };
            let mark = if state.as_deref() == Some("completed") { "↳" } else { "!" };
            let heading = format!("{mark} {actor} {status}");
            let description = if shell { text.split_whitespace().collect::<Vec<_>>().join(" ") } else { text };
            let suffix = truncate_width(&format!(" · {description}"), width.saturating_sub(3 + heading.width()));
            Line::Completion { heading, suffix, state, child: if shell { None } else { meta("childID") } }
        }
        _ => Line::Plain(String::new()),
    }
}

/// `switchLabel`: a variant change, or the model's name with its variant.
fn switch_label(model: &ModelRef, models: &[ModelInfo], previous: Option<&ModelRef>) -> String {
    if let Some(previous) = previous
        && previous.provider_id == model.provider_id
        && previous.id == model.id
    {
        return format!("Switched variant to {}", model.variant.as_deref().unwrap_or("default"));
    }
    let display = models.iter().find(|item| item.provider_id == model.provider_id && item.id == model.id);
    let Some(display) = display else {
        let mut parts = vec![model.provider_id.as_str(), model.id.as_str()];
        parts.extend(model.variant.as_deref());
        return format!("Switched model to {}", parts.join("/"));
    };
    let variant = match model.variant.as_deref() {
        Some(variant) if variant != "default" => format!(" ({variant})"),
        _ => String::new(),
    };
    format!("Switched model to {}{variant}", display.name)
}

/// `Locale.truncateWidth`: at most `width` cells, ending in `…` when cut.
pub fn truncate_width(text: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    if text.width() <= width {
        return text.to_owned();
    }
    if width == 1 {
        return "…".to_owned();
    }
    let mut used = 0;
    let mut out = String::new();
    for character in text.chars() {
        let next = character.width().unwrap_or(0);
        if used + next > width - 1 {
            break;
        }
        used += next;
        out.push(character);
    }
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn message(value: serde_json::Value) -> SessionMessageInfo {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn lines_follow_the_typescript_notices() {
        let time = json!({ "created": 1 });
        let skill =
            message(json!({ "id": "m", "type": "skill", "skill": "s", "name": "rust", "text": "", "time": time }));
        assert_eq!(line(&skill, &[], 80), Line::Inline { icon: "→", text: "Skill rust".into() });
        let agent =
            message(json!({ "id": "m", "type": "agent-switched", "agent": "plan", "previous": "build", "time": time }));
        assert_eq!(line(&agent, &[], 80), Line::Plain("Switched agent from Build to Plan".into()));
        let model = message(json!({
            "id": "m", "type": "model-switched", "time": time,
            "model": { "providerID": "p", "id": "m", "variant": "high" },
            "previous": { "providerID": "p", "id": "m" },
        }));
        assert_eq!(line(&model, &[], 80), Line::Plain("Switched variant to high".into()));
        let done = message(json!({
            "id": "m", "type": "synthetic", "text": "", "time": time,
            "description": "ran   the\ntests",
            "metadata": { "source": "shell", "state": "completed" },
        }));
        assert_eq!(
            line(&done, &[], 40),
            Line::Completion {
                heading: "↳ Shell finished".into(),
                suffix: " · ran the tests".into(),
                state: Some("completed".into()),
                child: None,
            }
        );
        assert_eq!(truncate_width(" · a long description", 8), " · a lo…");
    }
}
