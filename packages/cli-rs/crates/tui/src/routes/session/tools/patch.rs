//! Render patch metadata by file, falling back to the applied resource list.

use opencode_local::cli_config::{DiffView as ConfigDiffView, DiffWrap};
use opentui::widget::DiffView;

use super::dispatch::{Block, BlockColors, BlockTool, Header, Props, Status, content_width, format_path, number};
use crate::dialogs::open::truncate_file_path;
use crate::prelude::*;
use crate::routes::session::messages::list::Context;

pub struct Patch {
    root: View,
    blocks: RefCell<Vec<BlockTool>>,
    shown: RefCell<Option<Shown>>,
    paints: Paints,
}

#[derive(Clone, Debug, PartialEq)]
enum Shown {
    Files { files: Vec<File>, view: DiffView, wrap: WrapMode, common: Common },
    Applied { applied: Vec<(String, String)>, common: Common },
    Pending { targets: Vec<String>, status: Status, error: Option<String>, common: Common },
}

#[derive(Clone, Debug, PartialEq)]
struct Common {
    permission: bool,
    width: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct File {
    pub kind: String,
    pub relative_path: String,
    pub patch: String,
    pub additions: Option<f64>,
    pub deletions: Option<f64>,
}

impl Patch {
    pub fn new(cx: &Context<'_>) -> Self {
        Self {
            root: View::new(cx.app).column().shrink(0.0).gap(1),
            blocks: RefCell::default(),
            shown: RefCell::default(),
            paints: Paints::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        if let Some(Shown::Pending { status, .. }) = &*self.shown.borrow() {
            for block in self.blocks.borrow().iter() {
                block.recolor(pending_colors(cx.theme, *status == Status::Error));
            }
        }
        for block in self.blocks.borrow().iter() {
            block.restyle();
        }
        self.paints.restyle(cx.theme);
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let shown = shown(cx, props);
        if self.shown.borrow().as_ref() == Some(&shown) {
            return;
        }
        self.root.clear();
        self.paints.clear();
        let blocks = match &shown {
            Shown::Files { files, view, wrap, common } => {
                file_blocks(cx, files, *view, *wrap, common.permission, common.width, &self.paints)
            }
            Shown::Applied { applied, common } => applied
                .iter()
                .map(|(kind, resource)| {
                    let block = path_block(cx, common.permission, common.width, label(kind), resource);
                    let text = Text::new(cx.app, truncate_file_path(resource, (common.width - 5).max(2)))
                        .wrap(WrapMode::None)
                        .truncate(true);
                    block.children().add(&text);
                    let deleted = kind == "delete";
                    self.paints.add(cx.theme, move |theme| {
                        text.fg(if deleted { theme.diff.text.removed } else { theme.text.muted });
                    });
                    block.show_children(true);
                    block
                })
                .collect(),
            Shown::Pending { targets, status, error, common } => {
                let block = BlockTool::new(cx);
                let failed = *status == Status::Error;
                let title = if failed { "# Patch failed" } else { "Patching" };
                block.colors(pending_colors(cx.theme, failed));
                block.set(Block {
                    header: match targets.as_slice() {
                        [target] => Header::Path { label: title.to_owned(), value: format_path(cx, Some(target)) },
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
}

/// `PatchedFiles`: one block per file a patch, or a Code Mode script, changed, with its diff, or its counts when the
/// diff is missing (a deleted file, or a script's change past the size cap). A change without counts shows only its
/// path.
pub fn file_blocks(
    cx: &Context<'_>,
    files: &[File],
    view: DiffView,
    wrap: WrapMode,
    permission: bool,
    width: i64,
    paints: &Paints,
) -> Vec<BlockTool> {
    files
        .iter()
        .map(|file| {
            let block = path_block(cx, permission, width, label(&file.kind), &file.relative_path);
            let child = if file.kind != "delete" && file.patch.contains("@@") {
                let diff = opencode_ui::diff::view_painted(
                    cx.app,
                    cx.theme,
                    cx.syntax,
                    &file.patch,
                    view,
                    opentui::syntax::filetype_for_path(&file.relative_path),
                    wrap,
                    0,
                    paints,
                );
                Some(View::new(cx.app).padding_edge(Edge::Left, 1).padding_edge(Edge::Right, 1).child(&diff).as_any())
            } else {
                change_counts(file.additions, file.deletions).map(|counts| {
                    let text = Text::new(cx.app, "");
                    let painted = text.clone();
                    paints.add(cx.theme, move |theme| {
                        // The `<text>` has no fg: OpenTUI's default, white, in every theme.
                        let plain =
                            |text: &str| Span::styled(text.to_owned(), Style::new().fg(Color::rgb(255, 255, 255)));
                        let mut spans = Vec::new();
                        if !counts.additions.is_empty() {
                            spans.push(Span::styled(counts.additions.clone(), Style::new().fg(theme.diff.text.added)));
                        }
                        if !counts.additions.is_empty() && !counts.deletions.is_empty() {
                            spans.push(plain(" "));
                        }
                        if !counts.deletions.is_empty() {
                            spans
                                .push(Span::styled(counts.deletions.clone(), Style::new().fg(theme.diff.text.removed)));
                        }
                        spans.push(plain(counts.unit));
                        painted.set_text(spans);
                    });
                    text.as_any()
                })
            };
            if let Some(child) = child {
                block.children().add(&child);
                block.show_children(true);
            }
            block
        })
        .collect()
}

/// The line counts a change shows without its diff (`changeCounts`): "+2 lines", "-40 lines", "+5 -1 lines". None
/// where they are unknown or zero.
#[derive(Debug, PartialEq)]
pub struct Counts {
    pub additions: String,
    pub deletions: String,
    pub unit: &'static str,
}

pub fn change_counts(additions: Option<f64>, deletions: Option<f64>) -> Option<Counts> {
    let (additions, deletions) = (additions.unwrap_or(0.0), deletions.unwrap_or(0.0));
    if additions == 0.0 && deletions == 0.0 {
        return None;
    }
    let signed = |sign: &str, count: f64| if count > 0.0 { format!("{sign}{}", number(count)) } else { String::new() };
    Some(Counts {
        additions: signed("+", additions),
        deletions: signed("-", deletions),
        unit: if additions + deletions == 1.0 { " line" } else { " lines" },
    })
}

/// The diff view and wrap `ctx.config.diffs` asks for, or the one `width` suits.
pub fn diff_layout(cx: &Context<'_>, width: i64) -> (DiffView, WrapMode) {
    let diffs = cx.tui.config().info.diffs.clone();
    let diffs = diffs.as_ref();
    let view = match diffs.and_then(|diffs| diffs.view) {
        Some(ConfigDiffView::Unified) => DiffView::Unified,
        Some(ConfigDiffView::Split) => DiffView::Split,
        _ if width > 120 => DiffView::Split,
        _ => DiffView::Unified,
    };
    let wrap = match diffs.and_then(|diffs| diffs.wrap) {
        Some(DiffWrap::None) => WrapMode::None,
        _ => WrapMode::Word,
    };
    (view, wrap)
}

fn path_block(cx: &Context<'_>, permission: bool, width: i64, label: &str, path: &str) -> BlockTool {
    let block = BlockTool::new(cx);
    block.set(Block {
        header: Header::Path { label: label.to_owned(), value: format_path(cx, Some(path)) },
        spinner: false,
        permission,
        error: None,
        clickable: false,
        width,
    });
    block
}

fn pending_colors(theme: &Theme, failed: bool) -> BlockColors {
    BlockColors { header: failed.then_some(theme.text.feedback.error.base), error: failed.then_some(theme.text.muted) }
}

fn shown(cx: &Context<'_>, props: &Props<'_>) -> Shown {
    let common = Common { permission: props.permission, width: content_width(cx) };
    let files = parse_files(props.metadata.get("files"));
    if !files.is_empty() {
        let (view, wrap) = diff_layout(cx, common.width);
        return Shown::Files { files, view, wrap, common };
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

fn label(kind: &str) -> &'static str {
    match kind {
        "add" => "# Created",
        "delete" => "# Deleted",
        _ => "← Patched",
    }
}

pub fn parse_files(value: Option<&Value>) -> Vec<File> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let file = item.as_object()?;
            let text = |key: &str| file.get(key).and_then(Value::as_str);
            let number = |key: &str| file.get(key).and_then(opencode_ui::tool_info::finite_number);
            let kind = text("type").or(match text("status") {
                Some("added") => Some("add"),
                Some("deleted") => Some("delete"),
                Some("modified") => Some("update"),
                _ => None,
            })?;
            let relative = text("file").or(text("relativePath"))?;
            let absolute = text("filePath").or(Some(relative))?;
            let additions = number("additions")?;
            let deletions = number("deletions")?;
            if kind.is_empty() || relative.is_empty() || absolute.is_empty() {
                return None;
            }
            Some(File {
                kind: kind.to_owned(),
                relative_path: relative.to_owned(),
                patch: text("patch")?.to_owned(),
                additions: Some(additions),
                deletions: Some(deletions),
            })
        })
        .collect()
}

/// `parseScriptChanges`: a script's changes, like a patch's files, but a change may have no patch and, where nothing
/// could be derived without reading the file, no counts.
pub fn parse_script_changes(value: Option<&Value>) -> Vec<File> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let file = item.as_object()?;
            let text = |key: &str| file.get(key).and_then(Value::as_str);
            let number = |key: &str| file.get(key).and_then(opencode_ui::tool_info::finite_number);
            let kind = match text("status")? {
                "added" => "add",
                "deleted" => "delete",
                "modified" => "update",
                _ => return None,
            };
            let relative = text("file").filter(|file| !file.is_empty())?;
            Some(File {
                kind: kind.to_owned(),
                relative_path: relative.to_owned(),
                patch: text("patch").unwrap_or_default().to_owned(),
                additions: number("additions"),
                deletions: number("deletions"),
            })
        })
        .collect()
}

fn applied(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            let kind = item.get("type")?.as_str().filter(|kind| !kind.is_empty())?;
            let resource = item.get("resource")?.as_str().filter(|resource| !resource.is_empty())?;
            Some((kind.to_owned(), resource.to_owned()))
        })
        .collect()
}

fn targets(patch: &str) -> Vec<String> {
    let mut targets = Vec::new();
    let mut at = 0;
    while let Some(start) = patch[at..].find("*** ") {
        at += start + 4;
        let line =
            ["Add", "Update", "Delete"].iter().find_map(|kind| patch[at..].strip_prefix(kind)?.strip_prefix(" File: "));
        let Some(line) = line else { continue };
        let end = line.find(['\r', '\n']).unwrap_or(line.len());
        if end == 0 {
            continue;
        }
        // JavaScript's `trim`: a byte order mark goes, U+0085 stays.
        targets.push(line[..end].trim_matches(opencode_api::js::is_whitespace).to_owned());
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
        assert_eq!(targets("*** Add File: \u{feff}a.rs\u{85}\n"), ["a.rs\u{85}"]);
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
                .map(|file| (file.kind.as_str(), file.relative_path.as_str(), file.deletions))
                .collect::<Vec<_>>(),
            [("add", "a.rs", Some(0.0)), ("delete", "b.rs", Some(3.0))]
        );
        assert_eq!(
            applied(Some(&json!([{ "type": "add", "resource": "x" }, { "type": "add" }, 1]))),
            [("add".to_owned(), "x".to_owned())]
        );
    }
}
