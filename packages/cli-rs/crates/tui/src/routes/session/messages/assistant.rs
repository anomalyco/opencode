//! Assistant parts (E.6a): text as Markdown (`TextPart`, `message-parts.tsx:173-200`). Tool rows
//! are `tools::dispatch::Tool` (E.7a).

use std::cell::{Cell, RefCell};

use opencode_api::generated::{SessionMessageAssistant, SessionMessageAssistantText};
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
