//! Diff wrapper (U.4a): a patch as the Edit and apply-patch tools show it, a port of `PatchDiff`
//! (`packages/tui/src/component/patch-diff.tsx`) on opentui-rust's `Diff`. Each hunk is its own diff, and every
//! hunk after the first gets a header row. An added file over 3,000 lines goes in chunks that mount only near the
//! view ([`Chunked`]), as TS `VirtualAddedPatch` does where it has the scroll box (the diff viewer).

use std::cell::RefCell;

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{Diff, DiffColors, DiffGutter, DiffView};

use crate::theme::{Paints, Theme};

/// One hunk of a patch: its `@@` line, and the file headers followed by the hunk alone.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub header: Option<String>,
    pub patch: String,
}

/// `splitPatchHunks` (`packages/tui/src/util/diff.ts`): a patch with at most one hunk stays whole.
pub fn split_hunks(patch: &str) -> Vec<Hunk> {
    let mut offset = 0;
    let starts: Vec<usize> = patch
        .split_inclusive('\n')
        .filter_map(|line| {
            let start = offset;
            offset += line.len();
            is_hunk_header(line.trim_end_matches('\n')).then_some(start)
        })
        .collect();
    if starts.len() <= 1 {
        return vec![Hunk { header: None, patch: patch.to_owned() }];
    }
    let prefix = &patch[..starts[0]];
    starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = starts.get(index + 1).copied().unwrap_or(patch.len());
            let line_end = patch[start..end].find('\n').map_or(end, |at| start + at);
            Hunk { header: Some(patch[start..line_end].to_owned()), patch: format!("{prefix}{}", &patch[start..end]) }
        })
        .collect()
}

/// `@@ -a[,b] +c[,d] @@` followed by anything.
fn is_hunk_header(line: &str) -> bool {
    let range = |text: &str, sign: char| -> Option<usize> {
        let rest = text.strip_prefix(sign)?;
        let digits = |text: &str| text.bytes().take_while(u8::is_ascii_digit).count();
        let start = digits(rest);
        if start == 0 {
            return None;
        }
        let Some(count) = rest[start..].strip_prefix(',') else { return Some(1 + start) };
        let length = digits(count);
        (length > 0).then_some(1 + start + 1 + length)
    };
    let Some(rest) = line.strip_prefix("@@ ") else { return false };
    let Some(old) = range(rest, '-') else { return false };
    let Some(rest) = rest[old..].strip_prefix(' ') else { return false };
    range(rest, '+').is_some_and(|new| rest[new..].starts_with(" @@"))
}

/// The `diff.*` tokens as the Edit tool passes them to `<diff>`.
pub fn colors(theme: &Theme) -> DiffColors {
    let diff = &theme.diff;
    DiffColors {
        line_number: diff.line_number.text,
        line_number_bg: diff.background.context,
        added_bg: diff.background.added,
        removed_bg: diff.background.removed,
        context_bg: diff.background.context,
        added_content_bg: None,
        removed_content_bg: None,
        context_content_bg: None,
        added_sign: diff.highlight.added,
        removed_sign: diff.highlight.removed,
        added_line_number_bg: diff.line_number.background.added,
        removed_line_number_bg: diff.line_number.background.removed,
    }
}

/// The colors of a patch view: the diff's own, the code's text, and the `@@` rows of later hunks.
#[derive(Clone, Copy, Debug)]
pub struct Look {
    pub colors: DiffColors,
    pub text: Color,
    pub hunk_header: Color,
    pub hunk_header_bg: Color,
}

/// A patch with line numbers, highlighted as `filetype`: a column of one [`Diff`] per hunk, with the `@@` line of
/// each later hunk in a row of its own. The hunks share one gutter width, with `gutter_padding` extra cells before
/// the line numbers (`PatchDiff`'s `gutterPadding`).
#[allow(clippy::too_many_arguments)]
pub fn view(
    app: &App,
    theme: &Theme,
    syntax: &SyntaxTheme,
    patch: &str,
    view: DiffView,
    filetype: Option<&str>,
    wrap: WrapMode,
    gutter_padding: u32,
) -> View {
    view_with(app, &look(theme), syntax, patch, view, filetype, wrap, gutter_padding)
}

/// [`view`], restyled in place by `paints`: the diffs keep their code and its highlight.
#[allow(clippy::too_many_arguments)]
pub fn view_painted(
    app: &App,
    theme: &Theme,
    syntax: &SyntaxTheme,
    patch: &str,
    view: DiffView,
    filetype: Option<&str>,
    wrap: WrapMode,
    gutter_padding: u32,
    paints: &Paints,
) -> View {
    let (column, parts) = build(app, &look(theme), syntax, patch, view, filetype, wrap, gutter_padding);
    for part in parts {
        paints.keep(move |theme| {
            let look = look(theme);
            match &part {
                Part::Header(row, text) => {
                    row.bg(look.hunk_header_bg);
                    text.fg(look.hunk_header).bg(look.hunk_header_bg);
                }
                Part::Diff(diff) => {
                    diff.syntax_theme(crate::code::syntax_theme(theme)).colors(look.colors);
                    let (left, right) = diff.code_views();
                    for code in [left, right] {
                        code.fg(look.text);
                    }
                }
            }
        });
    }
    column
}

/// A widget of a patch view that takes the theme's colors.
enum Part {
    /// A later hunk's `@@` row and its text.
    Header(View, Text),
    Diff(Diff),
}

fn look(theme: &Theme) -> Look {
    Look {
        colors: colors(theme),
        text: theme.text.base,
        hunk_header: theme.diff.text.hunk_header,
        hunk_header_bg: theme.diff.background.context,
    }
}

/// Added files longer than this go in chunks (`VIRTUAL_MIN_LINES`).
const CHUNKED_MIN_LINES: usize = 3000;
/// The lines of one chunk (`VIRTUAL_CHUNK_LINES`).
const CHUNK_LINES: usize = 128;

/// One chunk of an added file: a patch of its own, `rows` lines tall.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AddedChunk {
    pub patch: String,
    pub rows: usize,
}

/// `splitAddedPatch`: a patch that only adds one whole file, in chunks of `size` lines, each with the file headers
/// and its own `@@` line. `None` for any other patch.
pub fn split_added(patch: &str, size: usize) -> Option<Vec<AddedChunk>> {
    let header = patch.split_inclusive('\n').scan(0, |offset, line| {
        let start = *offset;
        *offset += line.len();
        Some((start, line))
    });
    let (start, line) = header.into_iter().find(|(_, line)| line.starts_with("@@ -0,0 +1,"))?;
    let count: usize = line["@@ -0,0 +1,".len()..].split_once(" @@")?.0.parse().ok()?;
    let body = &patch[start + line.len()..];
    let mut lines: Vec<&str> = body.strip_suffix('\n').unwrap_or(body).split('\n').collect();
    let marker = lines.last().is_some_and(|line| line.starts_with("\\ No newline at end of file")).then(|| lines.pop());
    if lines.len() != count || lines.iter().any(|line| !line.starts_with('+')) {
        return None;
    }
    let prefix = &patch[..start];
    let chunks = lines.chunks(size).enumerate().map(|(index, slice)| {
        let first = index * size;
        let end = match marker.flatten() {
            Some(marker) if first + size >= count => format!("\n{marker}"),
            _ => String::new(),
        };
        AddedChunk {
            patch: format!("{prefix}@@ -0,0 +{},{} @@\n{}{end}", first + 1, slice.len(), slice.join("\n")),
            rows: slice.len(),
        }
    });
    Some(chunks.collect())
}

/// `VirtualAddedPatch`: an added file over 3,000 lines in chunks of 128 rows, unwrapped so each chunk is exactly its
/// rows tall. Only the chunks [`Chunked::show`] puts in view are mounted; the others are blank rows of their height.
/// Each chunk is highlighted on its own (deviation `H06-chunked-diff-highlights`).
pub struct Chunked {
    root: View,
    /// Each chunk's slot and patch, and its diff while mounted.
    chunks: Vec<(View, String)>,
    mounted: RefCell<Vec<Option<Diff>>>,
    make: Box<dyn Fn(&str) -> Diff>,
}

impl Chunked {
    /// The chunks of `patch` when it adds one file of more than 3,000 lines, drawn as [`view`] draws a patch.
    pub fn new(
        app: &App,
        theme: &Theme,
        syntax: &SyntaxTheme,
        patch: &str,
        filetype: Option<&str>,
        gutter_padding: u32,
    ) -> Option<Self> {
        let chunks = split_added(patch, CHUNK_LINES)?;
        let lines: usize = chunks.iter().map(|chunk| chunk.rows).sum();
        if lines <= CHUNKED_MIN_LINES {
            return None;
        }
        crate::grammars::register();
        let gutter = DiffGutter { padding_left: 1 + gutter_padding, min_digits: Some(lines.to_string().len() as u32) };
        let root = View::new(app).width(Length::Percent(100.0));
        let chunks: Vec<(View, String)> = chunks
            .into_iter()
            .map(|chunk| {
                let slot = View::new(app).height(chunk.rows as u32).shrink(0.0);
                root.add(&slot);
                (slot, chunk.patch)
            })
            .collect();
        let (app, look, syntax, filetype) = (app.clone(), look(theme), syntax.clone(), filetype.map(str::to_owned));
        let make = Box::new(move |patch: &str| {
            let diff = Diff::new(&app)
                .view(DiffView::Unified)
                .filetype(filetype.as_deref())
                .syntax_theme(syntax.clone())
                .wrap(WrapMode::None)
                .colors(look.colors)
                .gutter(gutter)
                .set_diff(patch);
            let (left, right) = diff.code_views();
            for code in [left, right] {
                code.fg(look.text).focusable(false);
            }
            diff
        });
        let chunked = Self { root, mounted: RefCell::new(vec![None; chunks.len()]), chunks, make };
        // Until the first `show`, the first chunks, as TS's first frame has them.
        chunked.show(0, 0);
        Some(chunked)
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    /// Mounts the chunks that rows `top..top + height` of the file overlap, and one on each side, and unmounts the
    /// others.
    pub fn show(&self, top: i64, height: i64) {
        let size = CHUNK_LINES as i64;
        let (first, last) = (top.div_euclid(size) - 1, (top + height).div_euclid(size) + 1);
        let mut mounted = self.mounted.borrow_mut();
        for (index, ((slot, patch), diff)) in self.chunks.iter().zip(mounted.iter_mut()).enumerate() {
            let near = (first..=last).contains(&(index as i64));
            match (near, diff.is_some()) {
                (true, false) => {
                    let made = (self.make)(patch);
                    slot.add(&made);
                    *diff = Some(made);
                }
                (false, true) => {
                    slot.clear();
                    *diff = None;
                }
                _ => {}
            }
        }
    }

    /// The patch lines of the mounted chunks.
    pub fn mounted_lines(&self) -> usize {
        let mounted = self.mounted.borrow();
        mounted.iter().flatten().map(|diff| diff.diff().lines().count()).sum()
    }
}

/// [`view`] in the colors of `look`, for clients with their own theme roles (mini).
#[allow(clippy::too_many_arguments)]
pub fn view_with(
    app: &App,
    look: &Look,
    syntax: &SyntaxTheme,
    patch: &str,
    view: DiffView,
    filetype: Option<&str>,
    wrap: WrapMode,
    gutter_padding: u32,
) -> View {
    build(app, look, syntax, patch, view, filetype, wrap, gutter_padding).0
}

#[allow(clippy::too_many_arguments)]
fn build(
    app: &App,
    look: &Look,
    syntax: &SyntaxTheme,
    patch: &str,
    view: DiffView,
    filetype: Option<&str>,
    wrap: WrapMode,
    gutter_padding: u32,
) -> (View, Vec<Part>) {
    crate::grammars::register();
    let mut parts = Vec::new();
    let gutter =
        DiffGutter { padding_left: 1 + gutter_padding, min_digits: Some(last_line(patch).to_string().len() as u32) };
    let column = View::new(app).width(Length::Percent(100.0));
    for (index, hunk) in split_hunks(patch).into_iter().enumerate() {
        if index > 0 {
            let header = format!(" {}", hunk.header.unwrap_or_default());
            let header = Text::new(app, header).fg(look.hunk_header).bg(look.hunk_header_bg);
            let row = View::new(app).width(Length::Percent(100.0)).height(1).bg(look.hunk_header_bg).child(&header);
            column.add(&row);
            parts.push(Part::Header(row, header));
        }
        let diff = Diff::new(app)
            .view(view)
            .filetype(filetype)
            .syntax_theme(syntax.clone())
            .wrap(wrap)
            .colors(look.colors)
            .gutter(gutter)
            .set_diff(hunk.patch);
        let (left, right) = diff.code_views();
        for code in [left, right] {
            code.fg(look.text).focusable(false);
        }
        column.add(&diff);
        parts.push(Part::Diff(diff));
    }
    (column, parts)
}

/// The largest line number the patch's `@@` lines reach on either side, at least 1.
fn last_line(patch: &str) -> i64 {
    let end = |range: &str| {
        let (start, count) = range.split_once(',').unwrap_or((range, "1"));
        Some(start.parse::<i64>().ok()? + count.parse::<i64>().ok()? - 1)
    };
    patch
        .lines()
        .filter_map(|line| {
            let (old, rest) = line.strip_prefix("@@ -")?.split_once(" +")?;
            let (new, _) = rest.split_once(" @@")?;
            Some([end(old)?, end(new)?])
        })
        .flatten()
        .fold(1, i64::max)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hunks_split_with_the_file_headers() {
        let patch = "--- a\n+++ a\n@@ -1 +1 @@ fn\n-a\n+b\n@@ -9,2 +9,3 @@\n x\n+y\n";
        assert_eq!(
            split_hunks(patch),
            [
                Hunk { header: Some("@@ -1 +1 @@ fn".into()), patch: "--- a\n+++ a\n@@ -1 +1 @@ fn\n-a\n+b\n".into() },
                Hunk {
                    header: Some("@@ -9,2 +9,3 @@".into()),
                    patch: "--- a\n+++ a\n@@ -9,2 +9,3 @@\n x\n+y\n".into(),
                },
            ]
        );
        let single = "@@ -1 +1 @@\n-a\n+b";
        assert_eq!(split_hunks(single), [Hunk { header: None, patch: single.into() }]);
        for line in ["@@ -1, +1 @@", "@@ -a +1 @@", "@@ -1 +1@@", " @@ -1 +1 @@"] {
            assert!(!is_hunk_header(line), "{line}");
        }
    }

    #[test]
    fn last_line_is_the_largest_hunk_end() {
        assert_eq!(last_line("@@ -1,4 +1,4 @@\n a\n@@ -10,3 +98,4 @@ fn\n b\n"), 101);
        assert_eq!(last_line("@@ -7 +7 @@\n-a\n+b\n"), 7);
        assert_eq!(last_line("@@ -0,0 +0,0 @@\n"), 1);
        assert_eq!(last_line("no hunks"), 1);
    }
}
