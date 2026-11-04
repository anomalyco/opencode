//! The edit tool (E.7a): `Edit` (`routes/session/index.tsx:3452-3514`). Once the edit has a patch,
//! its diff in a block (split above 120 columns unless `diffs.view` says otherwise); before that, the
//! path or "Preparing edit…".

use std::cell::RefCell;

use opencode_local::cli_config::{DiffView as ConfigDiffView, DiffWrap};
use opentui::prelude::*;
use opentui::widget::DiffView;
use serde_json::Value;

use super::diagnostics;
use super::dispatch::{Block, BlockTool, Header, Props, Status, content_width, format_path};
use crate::routes::session::messages::list::Context;

pub struct Edit {
    block: BlockTool,
    /// The inputs of the diff and diagnostics on screen.
    shown: RefCell<Option<Shown>>,
}

#[derive(PartialEq)]
struct Shown {
    patch: String,
    path: String,
    view: DiffView,
    wrap: WrapMode,
    diagnostics: Option<Value>,
    input_path: String,
}

impl Edit {
    pub fn new(cx: &Context<'_>) -> Self {
        Self {
            block: BlockTool::new(cx),
            shown: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        self.block.root()
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let input_path = props.input_str("path");
        let file = first_file(props.metadata.get("files"));
        let path = file.as_ref().map(|file| file.path.as_str()).or(input_path);
        let header = if file.is_some() || input_path.is_some_and(|path| !path.is_empty()) {
            Header::Path {
                label: "← Edit".to_owned(),
                value: format_path(cx, path),
            }
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
        let diffs = cx.tui.config.info.diffs.as_ref();
        let view = match diffs.and_then(|diffs| diffs.view) {
            Some(ConfigDiffView::Unified) => DiffView::Unified,
            Some(ConfigDiffView::Split) => DiffView::Split,
            _ if content_width(cx) > 120 => DiffView::Split,
            _ => DiffView::Unified,
        };
        let wrap = match diffs.and_then(|diffs| diffs.wrap) {
            Some(DiffWrap::None) => WrapMode::None,
            _ => WrapMode::Word,
        };
        let shown = Shown {
            patch: file.patch,
            path: file.path,
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
        let diff = opencode_ui::diff::view(
            cx.app,
            cx.theme,
            cx.syntax,
            &shown.patch,
            shown.view,
            opentui::syntax::filetype_for_path(&shown.path),
            shown.wrap,
            0,
        );
        children.add(
            &View::new(cx.app)
                .padding_edge(Edge::Left, 1)
                .padding_edge(Edge::Right, 3)
                .child(&diff),
        );
        if let Some(errors) = diagnostics::view(cx, &props.metadata, &shown.input_path) {
            children.add(&errors);
        }
        self.block.show_children(true);
        *self.shown.borrow_mut() = Some(shown);
    }
}

/// The first file of `parseApplyPatchFiles`: its relative path and patch.
struct File {
    path: String,
    patch: String,
}

fn first_file(files: Option<&Value>) -> Option<File> {
    files?.as_array()?.iter().find_map(|item| {
        let file = item.as_object()?;
        let text = |key: &str| file.get(key).and_then(Value::as_str);
        let number = |key: &str| file.get(key).and_then(opencode_ui::tool_info::finite_number);
        let kind = text("type").or(match text("status") {
            Some("added") => Some("add"),
            Some("deleted") => Some("delete"),
            Some("modified") => Some("update"),
            _ => None,
        });
        let relative = text("file").or(text("relativePath"));
        let absolute = text("filePath").or(relative);
        let complete = kind.is_some_and(|kind| !kind.is_empty())
            && absolute.is_some_and(|path| !path.is_empty())
            && number("additions").is_some()
            && number("deletions").is_some();
        let relative = relative.filter(|path| !path.is_empty() && complete)?;
        Some(File {
            path: relative.to_owned(),
            patch: text("patch")?.to_owned(),
        })
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::first_file;

    #[test]
    fn the_first_complete_file_has_the_patch() {
        let files = json!([
            { "file": "a.rs", "type": "update", "patch": "@@", "additions": 1 },
            { "relativePath": "b.rs", "status": "modified", "patch": "@@ -1 +1 @@", "additions": 1, "deletions": 1 },
        ]);
        let file = first_file(Some(&files)).unwrap();
        assert_eq!((file.path.as_str(), file.patch.as_str()), ("b.rs", "@@ -1 +1 @@"));
        assert!(first_file(Some(&json!([{ "file": "c.rs", "status": "renamed", "patch": "", "additions": 0, "deletions": 0 }]))).is_none());
        assert!(first_file(Some(&json!({}))).is_none());
    }
}
