//! Inline transcript notices for skills and session changes.

use opencode_api::generated::{ModelInfo, ModelRef};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::list::Context;
use opencode_ui::locale::titlecase;

use crate::prelude::*;

pub struct Notice(Rc<Inner>);

struct Inner {
    app: App,
    theme: Live,
    tui: Weak<Tui>,
    root: View,
    rendered: RefCell<Option<Line>>,
    heading: RefCell<Option<Text>>,
    hover: Cell<bool>,
}

#[derive(Clone, Debug, PartialEq)]
enum Line {
    Inline { icon: &'static str, text: String },
    Plain(String),
    Moved(String),
    Completion { heading: String, suffix: String, state: Option<String>, child: Option<String> },
}

impl Notice {
    pub fn new(cx: &Context<'_>) -> Self {
        let root = View::new(cx.app).column().shrink(0.0).padding_edge(Edge::Left, 3);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: cx.tui.live_theme(),
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

    pub fn restyle(&self) {
        self.0.rendered.take();
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageInfo) {
        let line = line(message, cx.models, cx.content_width());
        if self.0.rendered.borrow().as_ref() == Some(&line) {
            return;
        }
        let theme = &self.0.theme.get();
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
        let Some(Line::Completion { heading, suffix, state, child }) = &*self.rendered.borrow() else { return };
        let theme = &self.theme.get();
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
            if !matches!(source.as_deref(), Some("subagent" | "shell" | "codemode")) {
                return Line::Inline { icon: if source.as_deref() == Some("goal") { "◎" } else { "◈" }, text };
            }
            let shell = source.as_deref() == Some("shell");
            let script = source.as_deref() == Some("codemode");
            let state = meta("state");
            let actor = match source.as_deref() {
                Some("shell") => "Shell".to_owned(),
                Some("codemode") => "Script".to_owned(),
                _ => titlecase(meta("agent").as_deref().unwrap_or("Subagent")),
            };
            let status = match state.as_deref() {
                Some("completed") | None => "finished",
                Some("error") => "failed",
                Some(other) => other,
            };
            let mark = if state.as_deref() == Some("completed") { "↳" } else { "!" };
            let heading = format!("{mark} {actor} {status}");
            let description = if script {
                meta("jobID").unwrap_or_default()
            } else if shell {
                text.split_whitespace().collect::<Vec<_>>().join(" ")
            } else {
                text
            };
            let suffix = truncate_width(&format!(" · {description}"), width.saturating_sub(3 + heading.width()));
            let child = if source.as_deref() == Some("subagent") { meta("childID") } else { None };
            Line::Completion { heading, suffix, state, child }
        }
        _ => Line::Plain(String::new()),
    }
}

fn switch_label(model: &ModelRef, models: &[ModelInfo], previous: Option<&ModelRef>) -> String {
    if let Some(previous) = previous
        && previous.provider_id == model.provider_id
        && previous.id == model.id
    {
        return format!("Switched variant to {}", model.variant.as_deref().unwrap_or("default"));
    }
    let find = |at: &ModelRef| models.iter().find(|item| item.provider_id == at.provider_id && item.id == at.id);
    let Some(display) = find(model) else {
        let mut parts = vec![model.provider_id.as_str(), model.id.as_str()];
        parts.extend(model.variant.as_deref());
        return format!("Switched model to {}", parts.join("/"));
    };
    // A model's faster and slower speeds are models of their own ("gpt-5.5-fast"), so moving between them is a
    // change of speed.
    let speed = |info: &ModelInfo| info.experimental.as_ref().and_then(|experimental| experimental.speed.clone());
    let base = |info: &ModelInfo| speed(info).map_or_else(|| info.id.clone(), |speed| speed.base);
    let before = previous.filter(|previous| previous.provider_id == model.provider_id);
    if let Some(before) = before.and_then(find)
        && base(before) == base(display)
    {
        let id = speed(display).map_or_else(|| "standard".to_owned(), |speed| speed.id);
        return format!("Switched speed to {id}");
    }
    let variant = match model.variant.as_deref() {
        Some(variant) if variant != "default" => format!(" ({variant})"),
        _ => String::new(),
    };
    format!("Switched model to {}{variant}", display.name)
}

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
    use super::*;
    use opencode_api::generated::ProviderID;

    fn model(id: &str, name: &str, speed: Option<(&str, &str)>) -> ModelInfo {
        let mut value = serde_json::json!({
            "id": id, "modelID": id, "providerID": "openai", "name": name,
            "capabilities": { "input": ["text"], "output": ["text"], "tools": true }, "variants": [],
            "time": { "released": 0 }, "cost": [], "status": "active", "enabled": true,
            "limit": { "context": 1, "output": 1 },
        });
        if let Some((base, speed)) = speed {
            value["experimental"] = serde_json::json!({ "speed": { "base": base, "id": speed, "faster": true } });
        }
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn a_switch_between_a_models_speeds_reads_as_a_change_of_speed() {
        let models = [
            model("gpt-5.5", "GPT-5.5", None),
            model("gpt-5.5-fast", "GPT-5.5 Fast", Some(("gpt-5.5", "fast"))),
            model("gpt-5.5-flex", "GPT-5.5 Flex", Some(("gpt-5.5", "flex"))),
            model("gpt-6", "GPT-6", None),
        ];
        let at = |id: &str| ModelRef { id: id.to_owned(), provider_id: ProviderID("openai".to_owned()), variant: None };
        let label = |model: &str, previous: &str| switch_label(&at(model), &models, Some(&at(previous)));
        assert_eq!(label("gpt-5.5-fast", "gpt-5.5"), "Switched speed to fast");
        assert_eq!(label("gpt-5.5-flex", "gpt-5.5-fast"), "Switched speed to flex");
        assert_eq!(label("gpt-5.5", "gpt-5.5-fast"), "Switched speed to standard");
        assert_eq!(label("gpt-5.5-fast", "gpt-6"), "Switched model to GPT-5.5 Fast");
    }
}
