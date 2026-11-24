//! Display the edit diff when a patch is available.

use opentui::widget::DiffView;

use super::diagnostics;
use super::dispatch::{Block, BlockTool, Header, Props, Status, content_width, fingerprint, format_path};
use super::patch::{diff_layout, parse_files};
use crate::prelude::*;
use crate::routes::session::messages::list::Context;

pub struct Edit {
    block: BlockTool,
    shown: RefCell<Option<Shown>>,
    paints: Paints,
}

#[derive(PartialEq)]
struct Shown {
    patch: u64,
    path: String,
    view: DiffView,
    wrap: WrapMode,
    diagnostics: Option<Value>,
    input_path: String,
}

impl Edit {
    pub fn new(cx: &Context<'_>) -> Self {
        Self { block: BlockTool::new(cx), shown: RefCell::default(), paints: Paints::default() }
    }

    pub fn root(&self) -> &View {
        self.block.root()
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        self.block.restyle();
        self.paints.restyle(cx.theme);
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let input_path = props.input.path().str();
        // `parseApplyPatchFiles(...)[0]`: the first complete file.
        let file = parse_files(props.metadata.get("files")).into_iter().next();
        let path = file.as_ref().map(|file| file.relative_path.as_str()).or(input_path);
        let header = if file.is_some() || input_path.is_some_and(|path| !path.is_empty()) {
            Header::Path { label: "← Edit".to_owned(), value: format_path(cx, path) }
        } else {
            Header::Title("# Preparing edit…".to_owned())
        };
        self.block.set(Block {
            header,
            spinner: file.is_none() && props.status() == Status::Streaming,
            permission: props.permission,
            error: props.error().map(str::to_owned),
            clickable: false,
            width: content_width(cx),
        });

        let Some(file) = file else {
            self.block.show_children(false);
            self.shown.take();
            return;
        };
        let (view, wrap) = diff_layout(cx, content_width(cx));
        let shown = Shown {
            patch: fingerprint(&file.patch),
            path: file.relative_path,
            view,
            wrap,
            diagnostics: props.metadata.get("diagnostics").cloned(),
            input_path: input_path.unwrap_or_default().to_owned(),
        };
        if self.shown.borrow().as_ref() == Some(&shown) {
            return;
        }
        let children = self.block.children();
        children.clear();
        self.paints.clear();
        let diff = opencode_ui::diff::view_painted(
            cx.app,
            cx.theme,
            cx.syntax,
            &file.patch,
            shown.view,
            opentui::syntax::filetype_for_path(&shown.path),
            shown.wrap,
            0,
            &self.paints,
        );
        children.add(&View::new(cx.app).padding_edge(Edge::Left, 1).padding_edge(Edge::Right, 1).child(&diff));
        if let Some(errors) = diagnostics::view(cx, &props.metadata, &shown.input_path, &self.paints) {
            children.add(&errors);
        }
        self.block.show_children(true);
        *self.shown.borrow_mut() = Some(shown);
    }
}
