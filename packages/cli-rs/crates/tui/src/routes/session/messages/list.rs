//! The transcript (E.6a). Until E.6a, T.1's plain transcript: one text row per message, updated in
//! place as parts stream, rebuilt when the message list changes shape.

use std::cell::RefCell;

use indexmap::IndexMap;
use opencode_api::generated::{
    SessionID, SessionMessageAssistantContentItem, SessionMessageAssistantToolState,
    SessionMessageID, SessionMessageInfo,
};
use opencode_store::{Changes, MessageExt};
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use opentui::widget::ScrollEdge;

use crate::app::Tui;

pub struct Transcript {
    scroll: ScrollBox,
    rows: RefCell<IndexMap<String, Text>>,
}

impl Transcript {
    pub fn new(tui: &Tui) -> Self {
        let scroll = ScrollBox::new(&tui.app)
            .grow(1.0)
            .basis(Length::Auto)
            .sticky(true)
            .sticky_start(ScrollEdge::Bottom)
            .content_gap(1);
        Self {
            scroll,
            rows: RefCell::default(),
        }
    }

    pub fn root(&self) -> &ScrollBox {
        &self.scroll
    }

    pub fn sync(&self, tui: &Tui, session: &SessionID, changes: &Changes) {
        if !changes.any_message(session) {
            return;
        }
        let theme = tui.page();
        let rebuild = changes.messages(session);
        tui.data.read(|state| {
            let messages = state.messages(session);
            let mut rows = self.rows.borrow_mut();
            if rebuild {
                rows.clear();
                self.scroll.clear();
                for message in messages {
                    let Some(row) = row(&tui.app, &theme, message) else {
                        continue;
                    };
                    self.scroll.add(&row);
                    rows.insert(message.id().to_owned(), row);
                }
                return;
            }
            for message in messages {
                if !changes.message(session, &SessionMessageID(message.id().to_owned())) {
                    continue;
                }
                if let Some(row) = rows.get(message.id()) {
                    row.set_text(text(message));
                }
            }
        });
    }
}

fn row(app: &App, theme: &Theme, message: &SessionMessageInfo) -> Option<Text> {
    let color = match message {
        SessionMessageInfo::User(_) | SessionMessageInfo::Assistant(_) => theme.text.base,
        SessionMessageInfo::Synthetic(_)
        | SessionMessageInfo::System(_)
        | SessionMessageInfo::Shell(_)
        | SessionMessageInfo::Compaction(_) => theme.text.muted,
        _ => return None,
    };
    let row = Text::new(app, text(message)).fg(color).wrap(WrapMode::Word);
    if matches!(message, SessionMessageInfo::User(_)) {
        row.bg(theme.background.raised.base);
    }
    Some(row)
}

/// The plain text of a message.
fn text(message: &SessionMessageInfo) -> String {
    match message {
        SessionMessageInfo::User(user) => user.text.clone(),
        SessionMessageInfo::Synthetic(synthetic) => synthetic.text.clone(),
        SessionMessageInfo::System(system) => system
            .description
            .clone()
            .unwrap_or_else(|| system.text.clone()),
        SessionMessageInfo::Shell(shell) => format!("$ {}", shell.command),
        SessionMessageInfo::Compaction(_) => "Compacted".to_owned(),
        SessionMessageInfo::Assistant(assistant) => assistant
            .content
            .iter()
            .filter_map(|item| match item {
                SessionMessageAssistantContentItem::Text(text) => Some(text.text.trim().to_owned()),
                SessionMessageAssistantContentItem::Reasoning(reasoning)
                    if !reasoning.text.trim().is_empty() =>
                {
                    Some(format!("Thinking: {}", reasoning.text.trim()))
                }
                SessionMessageAssistantContentItem::Tool(tool) => {
                    Some(format!("⚙ {} ({})", tool.name, tool_status(&tool.state)))
                }
                _ => None,
            })
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => String::new(),
    }
}

fn tool_status(state: &SessionMessageAssistantToolState) -> &'static str {
    match state {
        SessionMessageAssistantToolState::Streaming(_) => "pending",
        SessionMessageAssistantToolState::Running(_) => "running",
        SessionMessageAssistantToolState::Completed(_) => "completed",
        SessionMessageAssistantToolState::Error(_) => "error",
        SessionMessageAssistantToolState::Unknown(_) => "unknown",
    }
}
