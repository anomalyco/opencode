//! The apply_patch tool (E.7b): `ApplyPatch` (`routes/session/index.tsx:3516-3634`). One block per
//! patched file with its diff; when the metadata has only the applied resources, one block per
//! resource; before either, one block that names the target while it patches or fails.

use std::cell::RefCell;

use opencode_local::cli_config::{DiffView as ConfigDiffView, DiffWrap};
use opentui::prelude::*;
use opentui::widget::DiffView;
use serde_json::Value;

use super::dispatch::{
    Block, BlockColors, BlockTool, Header, Props, Status, content_width, format_path, number,
};
use crate::dialogs::open::truncate_file_path;
use crate::routes::session::messages::list::Context;

pub struct Patch {
    root: View,
    blocks: RefCell<Vec<BlockTool>>,
    shown: RefCell<Option<Shown>>,
}

#[derive(Clone, Debug, PartialEq)]
enum Shown {
    Files {
        files: Vec<File>,
        view: DiffView,
        wrap: WrapMode,
        common: Common,
    },
    Applied {
        applied: Vec<(String, String)>,
        common: Common,
    },
    Pending {
        targets: Vec<String>,
        status: Status,
        error: Option<String>,
        common: Common,
    },
}

/// What every block of the call shares.
#[derive(Clone, Debug, PartialEq)]
struct Common {
    permission: bool,
    width: i64,
}

/// One entry of `parseApplyPatchFiles`.
#[derive(Clone, Debug, PartialEq)]
pub struct File {
    pub kind: String,
    pub relative_path: String,
    pub patch: String,
    pub deletions: f64,
}

impl Patch {
    pub fn new(cx: &Context<'_>) -> Self {
        Self {
            root: View::new(cx.app).column().shrink(0.0).gap(1),
            blocks: RefCell::default(),
            shown: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let shown = shown(cx, props);
        if self.shown.borrow().as_ref() == Some(&shown) {
            return;
        }
        self.root.clear();
        let blocks = match &shown {
            Shown::Files {
                files,
                view,
                wrap,
                common,
            } => files
                .iter()
                .map(|file| {
                    let block = self.block(cx, common, label(&file.kind), &file.relative_path);
                    let child = if file.kind == "delete" {
                        Text::new(
                            cx.app,
                            format!(
                                "-{} line{}",
                                number(file.deletions),
                                if file.deletions == 1.0 { "" } else { "s" }
                            ),
                        )
                        .fg(cx.theme.diff.text.removed)
                        .as_any()
                    } else {
                        let diff = opencode_ui::diff::view(
                            cx.app,
                            cx.theme,
                            cx.syntax,
                            &file.patch,
                            *view,
                            opentui::syntax::filetype_for_path(&file.relative_path),
                            *wrap,
                            0,
                        );
                        View::new(cx.app)
                            .padding_edge(Edge::Left, 1)
                            .padding_edge(Edge::Right, 3)
                            .child(&diff)
                            .as_any()
                    };
                    block.children().add(&child);
                    block.show_children(true);
                    block
                })
                .collect(),
            Shown::Applied { applied, common } => applied
                .iter()
                .map(|(kind, resource)| {
                    let block = self.block(cx, common, label(kind), resource);
                    let fg = if kind == "delete" {
                        cx.theme.diff.text.removed
                    } else {
                        cx.theme.text.muted
                    };
                    block.children().add(
                        &Text::new(
                            cx.app,
                            truncate_file_path(resource, (common.width - 3).max(2)),
                        )
                        .fg(fg)
                        .wrap(WrapMode::None)
                        .truncate(true),
                    );
                    block.show_children(true);
                    block
                })
                .collect(),
            Shown::Pending {
                targets,
                status,
                error,
                common,
            } => {
                let block = BlockTool::new(cx);
                let failed = *status == Status::Error;
                let title = if failed { "# Patch failed" } else { "Patching" };
                block.colors(BlockColors {
                    header: failed.then_some(cx.theme.text.feedback.error.base),
                    error: failed.then_some(cx.theme.text.muted),
                });
                block.set(Block {
                    header: match targets.as_slice() {
                        [target] => Header::Path {
                            label: title.to_owned(),
                            value: format_path(cx, Some(target)),
                        },
                        _ => Header::Title(title.to_owned()),
                    },
                    spinner: matches!(status, Status::Streaming | Status::Running),
                    permission: common.permission,
                    error: error.clone(),
                    clickable: false,
                    width: common.width,
                });
                vec![block]
            }
        };
        for block in &blocks {
            self.root.add(block.root());
        }
        *self.blocks.borrow_mut() = blocks;
        *self.shown.borrow_mut() = Some(shown);
    }

    /// A block with a label and a path header, for one file.
    fn block(&self, cx: &Context<'_>, common: &Common, label: &str, path: &str) -> BlockTool {
        let block = BlockTool::new(cx);
        block.set(Block {
            header: Header::Path {
                label: label.to_owned(),
                value: format_path(cx, Some(path)),
            },
            spinner: false,
            permission: common.permission,
            error: None,
            clickable: false,
            width: common.width,
        });
        block
    }
}

fn shown(cx: &Context<'_>, props: &Props<'_>) -> Shown {
    let common = Common {
        permission: props.permission,
        width: content_width(cx),
    };
    let files = parse_files(props.metadata.get("files"));
    if !files.is_empty() {
        let diffs = cx.tui.config().info.diffs.clone();
        let diffs = diffs.as_ref();
        let view = match diffs.and_then(|diffs| diffs.view) {
            Some(ConfigDiffView::Unified) => DiffView::Unified,
            Some(ConfigDiffView::Split) => DiffView::Split,
            _ if common.width > 120 => DiffView::Split,
            _ => DiffView::Unified,
        };
        let wrap = match diffs.and_then(|diffs| diffs.wrap) {
            Some(DiffWrap::None) => WrapMode::None,
            _ => WrapMode::Word,
        };
        return Shown::Files {
            files,
            view,
            wrap,
            common,
        };
    }
    let applied = applied(props.metadata.get("applied"));
    if !applied.is_empty() {
        return Shown::Applied { applied, common };
    }
    Shown::Pending {
        targets: targets(props.input_str("patchText").unwrap_or_default()),
        status: props.status(),
        error: props.error().map(str::to_owned),
        common,
    }
}

/// The header label of a file by its change.
fn label(kind: &str) -> &'static str {
    match kind {
        "add" => "# Created",
        "delete" => "# Deleted",
        _ => "← Patched",
    }
}

/// `parseApplyPatchFiles`: the files that have a type, a path, a patch, and counts.
pub fn parse_files(value: Option<&Value>) -> Vec<File> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let file = item.as_object()?;
            let text = |key: &str| file.get(key).and_then(Value::as_str);
            let number = |key: &str| {
                file.get(key)
                    .and_then(opencode_ui::tool_info::finite_number)
            };
            let kind = text("type").or(match text("status") {
                Some("added") => Some("add"),
                Some("deleted") => Some("delete"),
                Some("modified") => Some("update"),
                _ => None,
            })?;
            let relative = text("file").or(text("relativePath"))?;
            let absolute = text("filePath").or(Some(relative))?;
            number("additions")?;
            let deletions = number("deletions")?;
            if kind.is_empty() || relative.is_empty() || absolute.is_empty() {
                return None;
            }
            Some(File {
                kind: kind.to_owned(),
                relative_path: relative.to_owned(),
                patch: text("patch")?.to_owned(),
                deletions,
            })
        })
        .collect()
}

/// The `applied` metadata: each resource with its change type.
fn applied(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let kind = item.get("type")?.as_str().filter(|kind| !kind.is_empty())?;
            let resource = item
                .get("resource")?
                .as_str()
                .filter(|resource| !resource.is_empty())?;
            Some((kind.to_owned(), resource.to_owned()))
        })
        .collect()
}

/// The files a patch names: `/\*\*\* (?:Add|Update|Delete) File: ([^\r\n]+)/g`.
fn targets(patch: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut at = 0;
    while let Some(start) = patch[at..].find("*** ") {
        at += start + 4;
        let line = ["Add", "Update", "Delete"]
            .iter()
            .find_map(|kind| patch[at..].strip_prefix(kind)?.strip_prefix(" File: "));
        let Some(line) = line else { continue };
        let end = line.find(['\r', '\n']).unwrap_or(line.len());
        if end == 0 {
            continue;
        }
        targets.push(line[..end].trim().to_owned());
        at = patch.len() - line.len() + end;
    }
    targets
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{applied, parse_files, targets};

    #[test]
    fn targets_match_the_patch_headers() {
        let patch = "*** Begin Patch\n*** Add File: a.rs\n+x\n*** Update File:  b.rs \r\n*** Delete File: \n*** Move File: c\n*** Delete File: d.rs";
        assert_eq!(targets(patch), ["a.rs", "b.rs", "d.rs"]);
        assert!(targets("").is_empty());
    }

    #[test]
    fn files_and_applied_parse_as_ts_does() {
        let files = json!([
            { "file": "a.rs", "type": "add", "patch": "@@", "additions": 1, "deletions": 0 },
            { "relativePath": "b.rs", "status": "deleted", "patch": "", "additions": 0, "deletions": 3 },
            { "file": "c.rs", "status": "renamed", "patch": "", "additions": 0, "deletions": 0 },
            { "file": "d.rs", "type": "update", "additions": 0, "deletions": 0 },
        ]);
        let files = parse_files(Some(&files));
        assert_eq!(
            files
                .iter()
                .map(|file| (
                    file.kind.as_str(),
                    file.relative_path.as_str(),
                    file.deletions
                ))
                .collect::<Vec<_>>(),
            [("add", "a.rs", 0.0), ("delete", "b.rs", 3.0)]
        );
        assert_eq!(
            applied(Some(
                &json!([{ "type": "add", "resource": "x" }, { "type": "add" }, 1])
            )),
            [("add".to_owned(), "x".to_owned())]
        );
    }
}
