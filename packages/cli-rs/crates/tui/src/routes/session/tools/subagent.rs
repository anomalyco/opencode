//! The subagent tool (E.7b): `Subagent` (`routes/session/index.tsx:3289-3348`). One line with the
//! agent, the description, and the model; a click opens the child session.

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use opencode_api::generated::{ModelInfo, SessionID};
use opencode_store::SessionStatus;
use opencode_ui::confirm::titlecase;
use opentui::prelude::*;
use serde_json::{Map, Value};

use super::dispatch::{Inline, InlineTool, Props, Status};
use crate::app::Tui;
use crate::routes::Route;
use crate::routes::session::messages::list::Context;

pub struct Subagent {
    inline: InlineTool,
    /// The child session a click opens.
    session: Rc<RefCell<Option<String>>>,
}

impl Subagent {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let session: Rc<RefCell<Option<String>>> = Rc::default();
        let tui: Weak<Tui> = cx.tui.weak();
        let target = session.clone();
        inline.on_click(move || {
            let Some(id) = target.borrow().clone() else {
                return;
            };
            let Some(tui) = tui.upgrade() else { return };
            // The click runs inside the transcript the navigation replaces.
            let weak = tui.weak();
            tui.app.defer(move |_| {
                if let Some(tui) = weak.upgrade() {
                    tui.navigate(Route::Session { id: SessionID(id) });
                }
            });
        });
        Self { inline, session }
    }

    pub fn root(&self) -> &View {
        self.inline.root()
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let status = props.status();
        let text = |key: &str| props.metadata.get(key).and_then(Value::as_str);
        let continued = props.input_str("sessionID");
        // A failed continuation may name an unrelated session, such as the parent itself.
        let session = text("sessionID")
            .or(text("sessionId"))
            .or(continued.filter(|_| status != Status::Error))
            .map(str::to_owned);
        let continuation = continued.is_some_and(|id| !id.is_empty());
        let running = status == Status::Running
            || session.as_deref().is_some_and(|id| {
                !id.is_empty()
                    && cx.state.status(&SessionID(id.to_owned())) == SessionStatus::Running
            });
        let description = props.input_str("description");
        let agent = props
            .input_str("agent")
            .or(props.input_str("subagent_type"))
            .unwrap_or("General");
        let title = if continuation {
            "Continue subagent".to_owned()
        } else {
            format!("{} Subagent", titlecase(agent))
        };
        let model = model_label(props.input_str("model"), cx.models)
            .map(|model| format!(" · {model}"))
            .unwrap_or_default();
        let icon = match (running, continuation, status) {
            (true, _, _) => "│",
            (_, true, _) => "↳",
            (_, _, Status::Completed) => "✓",
            _ => "│",
        };
        let inline = Inline::new(
            props,
            icon,
            "Delegating…",
            description.is_some_and(|description| !description.is_empty()),
        );
        self.inline.set(Inline {
            spinner: running,
            text: format!("{title} — {}{model}", description.unwrap_or("Subagent")),
            // `running` hides the error while the child still works.
            error: inline.error.clone().filter(|_| !running),
            clickable: true,
            badge: background(&props.metadata, status).then(|| "Background".to_owned()),
            ..inline
        });
        *self.session.borrow_mut() = session.filter(|id| !id.is_empty());
    }
}

/// `subagentModelLabel`: the model's name, or the reference, and the variant.
pub fn model_label(value: Option<&str>, models: &[ModelInfo]) -> Option<String> {
    let value = value.filter(|value| !value.is_empty())?;
    let (reference, variant) = match value.split_once('#') {
        Some((reference, rest)) => (reference, rest.split('#').next()),
        None => (value, None),
    };
    let (provider, model) = reference.split_once('/').unwrap_or(("", reference));
    let name = models
        .iter()
        .find(|item| item.provider_id.0 == provider && item.id == model)
        .map_or(reference, |item| item.name.as_str());
    Some(match variant.filter(|variant| !variant.is_empty()) {
        Some(variant) => format!("{name} ({variant})"),
        None => name.to_owned(),
    })
}

/// `isBackgroundSubagent`: the call returned while the child keeps running.
fn background(metadata: &Map<String, Value>, status: Status) -> bool {
    status == Status::Completed && metadata.get("status").and_then(Value::as_str) == Some("running")
}

#[cfg(test)]
mod tests {
    use super::model_label;

    #[test]
    fn model_labels_match_subagent_model_label() {
        assert_eq!(model_label(None, &[]), None);
        assert_eq!(model_label(Some(""), &[]), None);
        assert_eq!(
            model_label(Some("anthropic/claude#high"), &[]).as_deref(),
            Some("anthropic/claude (high)")
        );
        assert_eq!(model_label(Some("gpt"), &[]).as_deref(), Some("gpt"));
    }
}
