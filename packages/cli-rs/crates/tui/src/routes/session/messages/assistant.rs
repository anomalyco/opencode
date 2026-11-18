//! TypeScript: `message-parts.tsx:173-200`.

use opencode_api::generated::{SessionMessageAssistant, SessionMessageAssistantText};
use opentui::widget::Markdown;

use super::list::Context;
use crate::features::session_links::{self, Links};
use crate::prelude::*;

/// Assistant text: Markdown in a box padded 3 from the left, streaming until the message
/// completes.
pub struct TextPart {
    root: View,
    markdown: Markdown,
    _links: Rc<Links>,
    streaming: Cell<bool>,
}

impl TextPart {
    pub fn new(cx: &Context<'_>) -> Self {
        let markdown = opencode_ui::markdown::view(cx.app, cx.theme, cx.syntax, cx.renderers, cx.conceal, true);
        let links = session_links::attach(cx.tui, &markdown, cx.renderers);
        let root = View::new(cx.app).padding_edge(Edge::Left, 3).shrink(0.0).child(&markdown);
        Self { root, markdown, _links: links, streaming: Cell::new(true) }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        let colors = opencode_ui::markdown::view_colors(cx.theme, cx.syntax);
        let width = self.markdown.rect().width as u16;
        opencode_plugin::claim::with_fence_width(width, || {
            opencode_ui::markdown::restyle(&self.markdown, colors, cx.syntax)
        });
    }

    pub fn update(
        &self,
        message: &SessionMessageAssistant,
        part: &SessionMessageAssistantText,
        conceal: bool,
        width: u16,
    ) {
        // A fence a plugin claims gets the Markdown's width before the Markdown is laid out.
        let laid = self.markdown.rect().width as u16;
        let width = if laid > 0 { laid } else { width.saturating_sub(3) };
        opencode_plugin::claim::with_fence_width(width, || self.show(message, part, conceal));
    }

    fn show(&self, message: &SessionMessageAssistant, part: &SessionMessageAssistantText, conceal: bool) {
        let text = part.text.trim();
        self.root.visible(!text.is_empty());
        self.markdown.conceal(conceal);
        // Content goes in before streaming ends, so completion keeps the final tokens. The widget's source is the
        // text shown so far. Read it in place for the bytes `text` keeps (0 replaces them all), and change it only
        // after the read ends.
        let kept = self
            .markdown
            .with_markdown(|shown| (shown != text).then(|| if text.starts_with(shown) { shown.len() } else { 0 }));
        match kept {
            Some(0) => {
                self.markdown.set_markdown(text);
            }
            Some(len) => {
                self.markdown.append(&text[len..]);
            }
            None => {}
        }
        let streaming = message.time.completed.is_none();
        if self.streaming.replace(streaming) != streaming {
            self.markdown.streaming(streaming);
        }
    }
}
