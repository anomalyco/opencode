//! Diff wrapper (U.4a): a patch as the Edit and apply-patch tools show it, a port of `PatchDiff`
//! (`packages/tui/src/component/patch-diff.tsx`) on opentui-rust's `Diff`. Each hunk is its own diff, and every
//! hunk after the first gets a header row. The virtual chunks TS uses for patches over 3,000 lines are not ported.

use opentui::prelude::*;
use opentui::syntax::SyntaxTheme;
use opentui::widget::{Diff, DiffColors, DiffView};

use crate::theme::Theme;

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
        return vec![Hunk {
            header: None,
            patch: patch.to_owned(),
        }];
    }
    let prefix = &patch[..starts[0]];
    starts
        .iter()
        .enumerate()
        .map(|(index, &start)| {
            let end = starts.get(index + 1).copied().unwrap_or(patch.len());
            let line_end = patch[start..end].find('\n').map_or(end, |at| start + at);
            Hunk {
                header: Some(patch[start..line_end].to_owned()),
                patch: format!("{prefix}{}", &patch[start..end]),
            }
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
        let Some(count) = rest[start..].strip_prefix(',') else {
            return Some(1 + start);
        };
        let length = digits(count);
        (length > 0).then_some(1 + start + 1 + length)
    };
    let Some(rest) = line.strip_prefix("@@ ") else {
        return false;
    };
    let Some(old) = range(rest, '-') else {
        return false;
    };
    let Some(rest) = rest[old..].strip_prefix(' ') else {
        return false;
    };
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

/// A patch with line numbers, highlighted as `filetype`: a column of one [`Diff`] per hunk, with the `@@` line of
/// each later hunk in a row of its own.
pub fn view(
    app: &App,
    theme: &Theme,
    syntax: &SyntaxTheme,
    patch: &str,
    view: DiffView,
    filetype: Option<&str>,
    wrap: WrapMode,
) -> View {
    let column = View::new(app).width(Length::Percent(100.0));
    for (index, hunk) in split_hunks(patch).into_iter().enumerate() {
        if index > 0 {
            let header = format!(" {}", hunk.header.unwrap_or_default());
            let header = Text::new(app, header)
                .fg(theme.diff.text.hunk_header)
                .bg(theme.diff.background.context);
            column.add(
                &View::new(app)
                    .width(Length::Percent(100.0))
                    .height(1)
                    .bg(theme.diff.background.context)
                    .child(&header),
            );
        }
        let diff = Diff::new(app)
            .view(view)
            .filetype(filetype)
            .syntax_theme(syntax.clone())
            .wrap(wrap)
            .colors(colors(theme))
            .set_diff(hunk.patch);
        let (left, right) = diff.code_views();
        // The unified column grows from a zero basis, so a diff without a height shows no rows. Core's diff sizes to
        // its lines, wrapped ones included; an automatic basis on the column does the same.
        if view == DiffView::Unified
            && let Some(numbers) = left.parent()
        {
            numbers.basis(Length::Auto);
        }
        for code in [left, right] {
            code.fg(theme.text.base).focusable(false);
        }
        column.add(&diff);
    }
    column
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
                Hunk {
                    header: Some("@@ -1 +1 @@ fn".into()),
                    patch: "--- a\n+++ a\n@@ -1 +1 @@ fn\n-a\n+b\n".into(),
                },
                Hunk {
                    header: Some("@@ -9,2 +9,3 @@".into()),
                    patch: "--- a\n+++ a\n@@ -9,2 +9,3 @@\n x\n+y\n".into(),
                },
            ]
        );
        let single = "@@ -1 +1 @@\n-a\n+b";
        assert_eq!(
            split_hunks(single),
            [Hunk {
                header: None,
                patch: single.into()
            }]
        );
        for line in ["@@ -1, +1 @@", "@@ -a +1 @@", "@@ -1 +1@@", " @@ -1 +1 @@"] {
            assert!(!is_hunk_header(line), "{line}");
        }
    }
}
