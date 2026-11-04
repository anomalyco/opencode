//! Assistant parts (E.6a): text as Markdown (`TextPart`, `message-parts.tsx:173-200`), the hook
//! tool rows hang on, and a plain stand-in for the message kinds E.6b renders.

use std::cell::{Cell, RefCell};

use opencode_api::generated::{
    SessionMessageAssistant, SessionMessageAssistantText, SessionMessageAssistantTool,
    SessionMessageAssistantToolState, SessionMessageCompaction, SessionMessageInfo,
};
use opentui::prelude::*;
use opentui::widget::Markdown;

use super::list::Context;

/// Assistant text: Markdown in a box padded 3 from the left, streaming until the message
/// completes.
pub struct TextPart {
    root: View,
    markdown: Markdown,
    text: RefCell<String>,
    streaming: Cell<bool>,
}

impl TextPart {
    pub fn new(cx: &Context<'_>) -> Self {
        let markdown = opencode_ui::markdown::view(
            cx.app,
            cx.theme,
            cx.syntax,
            cx.renderers,
            cx.conceal,
            true,
        );
        let root = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&markdown);
        Self {
            root,
            markdown,
            text: RefCell::default(),
            streaming: Cell::new(true),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, message: &SessionMessageAssistant, part: &SessionMessageAssistantText) {
        let text = part.text.trim();
        self.root.visible(!text.is_empty());
        // Content goes in before streaming ends, so completion keeps the final tokens.
        let mut current = self.text.borrow_mut();
        if *current != text {
            match text.strip_prefix(current.as_str()) {
                Some(rest) if !current.is_empty() => {
                    self.markdown.append(rest);
                }
                _ => {
                    self.markdown.set_markdown(text);
                }
            }
            text.clone_into(&mut current);
        }
        let streaming = message.time.completed.is_none();
        if self.streaming.replace(streaming) != streaming {
            self.markdown.streaming(streaming);
        }
    }
}

/// A tool call. E.7a replaces this stand-in with `tools::dispatch`: a row is created once per
/// call, and `update` runs whenever its message changes, with the call's current state.
pub struct Tool {
    root: View,
    line: Text,
}

impl Tool {
    pub fn new(cx: &Context<'_>) -> Self {
        let line = Text::new(cx.app, "").fg(cx.theme.text.muted);
        let root = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&line);
        Self { root, line }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(
        &self,
        _cx: &Context<'_>,
        _message: &SessionMessageAssistant,
        tool: &SessionMessageAssistantTool,
    ) {
        let status = match &tool.state {
            SessionMessageAssistantToolState::Streaming(_) => "pending",
            SessionMessageAssistantToolState::Running(_) => "running",
            SessionMessageAssistantToolState::Completed(_) => "completed",
            SessionMessageAssistantToolState::Error(_) => "error",
            SessionMessageAssistantToolState::Unknown(_) => "unknown",
        };
        self.line.set_text(format!("⚙ {} ({status})", tool.name));
    }
}

/// Shell, compaction, notice, switch, skill, and error messages as one muted line, until E.6b
/// gives each its row (`SessionMessageView`).
pub struct Notice {
    root: View,
    line: Text,
}

impl Notice {
    pub fn new(cx: &Context<'_>) -> Self {
        let line = Text::new(cx.app, "")
            .fg(cx.theme.text.muted)
            .wrap(WrapMode::Word);
        let root = View::new(cx.app)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&line);
        Self { root, line }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageInfo) {
        let text = match message {
            SessionMessageInfo::Synthetic(synthetic) => {
                synthetic.description.clone().unwrap_or_default()
            }
            SessionMessageInfo::System(system) => system
                .description
                .clone()
                .unwrap_or_else(|| "Instructions updated".to_owned()),
            SessionMessageInfo::Shell(shell) => format!("$ {}", shell.command),
            SessionMessageInfo::Skill(skill) => format!("→ Skill {}", skill.name),
            SessionMessageInfo::AgentSwitched(switched) => {
                format!("Switched agent to {}", titlecase(switched.agent.as_str()))
            }
            SessionMessageInfo::ModelSwitched(switched) => {
                format!("Switched model to {}", switched.model.id)
            }
            SessionMessageInfo::LocationSwitched(switched) => {
                format!("↳ Moved to {}", switched.location.directory)
            }
            SessionMessageInfo::Compaction(SessionMessageCompaction::Running(_)) => {
                "Compacting…".to_owned()
            }
            SessionMessageInfo::Compaction(_) => "Compacted".to_owned(),
            SessionMessageInfo::Idle(idle) => {
                self.line.fg(cx.theme.text.feedback.error.base);
                idle.error
                    .as_ref()
                    .map(|error| format!("Error: {}", error.message))
                    .unwrap_or_default()
            }
            _ => String::new(),
        };
        self.line.set_text(text);
    }
}

/// `Locale.titlecase`: upper-cases the first character of each word.
pub fn titlecase(text: &str) -> String {
    let mut previous_word = false;
    text.chars()
        .map(|character| {
            let word = character.is_alphanumeric() || character == '_';
            let next = if word && !previous_word {
                character.to_ascii_uppercase()
            } else {
                character
            };
            previous_word = word;
            next
        })
        .collect()
}
