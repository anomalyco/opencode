//! Assistant text and streaming Markdown.

use opencode_api::generated::{SessionMessageAssistant, SessionMessageAssistantText};
use opentui::widget::{Markdown, MarkdownTableOptions, MarkdownTableStyle};

use super::super::find::FindPartId;
use super::super::find_view::FindMarkdown;
use super::list::Context;
use crate::features::session_links::{self, Links};
use crate::prelude::*;

/// Assistant text: Markdown in a box padded 3 from the left, streaming until the message
/// completes.
pub struct TextPart {
    root: View,
    markdown: Markdown,
    _links: Rc<Links>,
    find: FindMarkdown,
    streaming: Cell<bool>,
}

impl TextPart {
    pub fn new(cx: &Context<'_>) -> Self {
        let markdown = opencode_ui::markdown::view(cx.app, cx.theme, cx.syntax, cx.renderers, cx.conceal, true)
            .table_options(table_options(cx.theme));
        let links = session_links::attach(cx.tui, &markdown, cx.renderers);
        let root = View::new(cx.app).padding_edge(Edge::Left, 3).shrink(0.0).child(&markdown);
        Self { root, markdown, _links: links, find: FindMarkdown::default(), streaming: Cell::new(true) }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        let colors = opencode_ui::markdown::view_colors(cx.theme, cx.syntax);
        let width = self.markdown.rect().width as u16;
        opencode_plugin::claim::with_fence_width(width, || {
            opencode_ui::markdown::restyle(&self.markdown, colors, cx.syntax);
            self.markdown.table_options(table_options(cx.theme));
        });
    }

    pub fn update(
        &self,
        cx: &Context<'_>,
        message: &SessionMessageAssistant,
        ordinal: usize,
        part: &SessionMessageAssistantText,
    ) {
        // A fence a plugin claims gets the Markdown's width before the Markdown is laid out.
        let laid = self.markdown.rect().width as u16;
        let width = if laid > 0 { laid } else { cx.content.saturating_sub(3) };
        opencode_plugin::claim::with_fence_width(width, || self.show(cx, message, ordinal, part));
    }

    pub fn update_find(
        &self,
        cx: &Context<'_>,
        message: &SessionMessageAssistant,
        ordinal: usize,
        part: &SessionMessageAssistantText,
    ) {
        let text = part.text.trim();
        if text.is_empty() {
            return;
        }
        self.find.sync(cx, &self.markdown, &self._links, &message.id.0, FindPartId::Text(ordinal), text);
    }

    fn show(
        &self,
        cx: &Context<'_>,
        message: &SessionMessageAssistant,
        ordinal: usize,
        part: &SessionMessageAssistantText,
    ) {
        let text = part.text.trim();
        self.root.visible(!text.is_empty());
        self.markdown.conceal(cx.conceal);
        // Content goes in before streaming ends, so completion keeps the final tokens.
        self.find.feed(&self.markdown, text, cx.find.is_some());
        let streaming = message.time.completed.is_none();
        if self.streaming.replace(streaming) != streaming {
            self.markdown.streaming(streaming);
        }
        if !text.is_empty() {
            self.find.sync(cx, &self.markdown, &self._links, &message.id.0, FindPartId::Text(ordinal), text);
        }
    }
}

fn table_options(theme: &Theme) -> MarkdownTableOptions {
    MarkdownTableOptions {
        style: MarkdownTableStyle::Grid,
        cell_padding_x: Some(1),
        border_color: Some(theme.border.base),
        ..MarkdownTableOptions::default()
    }
}
