//! The write tool (E.7a): `Write` (`routes/session/index.tsx:3156-3190`). Once written, the file
//! with line numbers in a block; before that, one line.

use super::diagnostics;
use super::dispatch::{
    Block, BlockTool, Header, Inline, InlineTool, Props, Status, content_width, fingerprint, format_path,
};
use crate::prelude::*;
use crate::routes::session::messages::list::Context;

pub struct Write {
    root: View,
    inline: InlineTool,
    block: BlockTool,
    /// The fingerprint of the content, path, and diagnostics the block shows.
    shown: Cell<Option<u64>>,
    /// Restyles the block's children in place.
    paints: Paints,
}

impl Write {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let block = BlockTool::new(cx);
        let root = View::new(cx.app).column().shrink(0.0).child(inline.root()).child(block.root());
        Self { root, inline, block, shown: Cell::default(), paints: Paints::default() }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// The file keeps its code and highlight.
    pub fn restyle(&self, cx: &Context<'_>) {
        self.inline.restyle();
        self.block.restyle();
        self.paints.restyle(cx.theme);
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
        let content = props.input_str("content").unwrap_or_default();
        let shown = fingerprint(&(content, path, props.metadata.get("diagnostics")));
        if self.shown.get() == Some(shown) {
            return;
        }
        let children = self.block.children();
        children.clear();
        self.paints.clear();
        let filetype = opentui::syntax::filetype_for_path(path);
        let code = opencode_ui::code::view_painted(cx.app, cx.theme, filetype, content, &self.paints);
        let numbered = opencode_ui::code::numbered(cx.app, cx.theme, &code);
        children.add(&numbered);
        self.paints.keep(move |theme| {
            numbered.fg(theme.text.muted);
        });
        if let Some(errors) = diagnostics::view(cx, &props.metadata, path, &self.paints) {
            children.add(&errors);
        }
        self.block.show_children(true);
        self.shown.set(Some(shown));
    }
}
