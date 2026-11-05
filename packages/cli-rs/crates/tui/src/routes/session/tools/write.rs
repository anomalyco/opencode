//! The write tool (E.7a): `Write` (`routes/session/index.tsx:3156-3190`). Once written, the file
//! with line numbers in a block; before that, one line.

use std::cell::RefCell;

use opentui::prelude::*;

use super::diagnostics;
use super::dispatch::{Block, BlockTool, Header, Inline, InlineTool, Props, Status, content_width, format_path};
use crate::routes::session::messages::list::Context;

pub struct Write {
    root: View,
    inline: InlineTool,
    block: BlockTool,
    /// The content, path, and diagnostics the block shows.
    shown: RefCell<Option<(String, String, Option<serde_json::Value>)>>,
}

impl Write {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let block = BlockTool::new(cx);
        let root = View::new(cx.app).column().shrink(0.0).child(inline.root()).child(block.root());
        Self { root, inline, block, shown: RefCell::default() }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let path = props.input_str("path");
        let completed = props.status() == Status::Completed;
        self.inline.root().visible(!completed);
        self.block.root().visible(completed);
        if !completed {
            self.inline.set(Inline {
                text: format!("Write {}", format_path(cx, path)),
                ..Inline::new(props, "←", "Preparing write…", path.is_some_and(|path| !path.is_empty()))
            });
            return;
        }
        self.block.set(Block {
            header: Header::Path { label: "# Wrote".to_owned(), value: format_path(cx, path) },
            spinner: false,
            permission: props.permission,
            error: None,
            clickable: false,
            width: content_width(cx),
        });
        let path = path.unwrap_or_default();
        let shown = (
            props.input_str("content").unwrap_or_default().to_owned(),
            path.to_owned(),
            props.metadata.get("diagnostics").cloned(),
        );
        if self.shown.borrow().as_ref() == Some(&shown) {
            return;
        }
        let children = self.block.children();
        children.clear();
        let code =
            opencode_ui::code::view(cx.app, cx.theme, cx.syntax, opentui::syntax::filetype_for_path(path), &shown.0);
        children.add(&opencode_ui::code::numbered(cx.app, cx.theme, &code));
        if let Some(errors) = diagnostics::view(cx, &props.metadata, path) {
            children.add(&errors);
        }
        self.block.show_children(true);
        *self.shown.borrow_mut() = Some(shown);
    }
}
