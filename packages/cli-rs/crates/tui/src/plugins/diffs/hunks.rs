//! Diff hunks (E.15a): where hunks and files sit in the patch list, and the jumps between them
//! (`jumpRelativeHunk`, `currentPatchFileIndex`, `scrollPatchNodeToTop` in `diff-viewer.tsx`). Positions are rows
//! from the top of the scrolled content.

/// The rows the sticky file header covers above a hunk it jumps to.
pub const FILE_HEADER_HEIGHT: i64 = 2;

/// One hunk: its file, its index in the file, and the row of its first line. A later hunk starts at its `@@` row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Hunk {
    pub file: usize,
    pub hunk: usize,
    pub y: i64,
}

/// The hunk the last jump selected, and the scroll position it left. A scroll since then forgets it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Selected {
    pub file: usize,
    pub hunk: usize,
    pub scroll_top: i64,
}

/// The hunk `offset` away: from the selected hunk while the view has not moved, else the first hunk below (or last
/// above) the row under the sticky header.
pub fn jump(
    hunks: &[Hunk],
    selected: Option<Selected>,
    scroll_top: i64,
    offset: i64,
) -> Option<Hunk> {
    let mut hunks = hunks.to_vec();
    hunks.sort_by_key(|hunk| hunk.y);
    let index = selected
        .filter(|selected| selected.scroll_top == scroll_top)
        .and_then(|selected| {
            hunks
                .iter()
                .position(|hunk| hunk.file == selected.file && hunk.hunk == selected.hunk)
        });
    let top = scroll_top + FILE_HEADER_HEIGHT;
    match index {
        Some(index) => usize::try_from(index as i64 + offset)
            .ok()
            .and_then(|index| hunks.get(index).copied()),
        None if offset > 0 => hunks.iter().find(|hunk| hunk.y > top).copied(),
        None => hunks.iter().rev().find(|hunk| hunk.y < top).copied(),
    }
}

/// Where a jump to `hunk` scrolls: its sticky header right above it.
pub fn hunk_top(hunk: &Hunk) -> i64 {
    (hunk.y - FILE_HEADER_HEIGHT).max(0)
}

/// `currentPatchFileIndex`: the last file that starts at or above the first row under the view's top, else the
/// first file. `files` are `(file, y)` of each card.
pub fn current_file(files: &[(usize, i64)], scroll_top: i64) -> Option<usize> {
    let mut files = files.to_vec();
    files.sort_by_key(|(_, y)| *y);
    files
        .iter()
        .rev()
        .find(|(_, y)| *y <= scroll_top + 1)
        .or(files.first())
        .map(|(file, _)| *file)
}

/// `scrollPatchNodeToTop`: the card's row, or the row after a later card's gap, since the pane's fixed top edge
/// stands in for it; `offset` keeps a reading position instead.
pub fn card_top(y: i64, offset: Option<i64>) -> i64 {
    y + offset.unwrap_or(i64::from(y > 0))
}

/// A scroll position as the scroll box clamps it.
pub fn clamp_scroll(top: i64, content: i64, viewport: i64) -> i64 {
    top.clamp(0, (content - viewport).max(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    const HUNKS: [Hunk; 4] = [
        Hunk {
            file: 0,
            hunk: 0,
            y: 2,
        },
        Hunk {
            file: 2,
            hunk: 0,
            y: 30,
        },
        Hunk {
            file: 1,
            hunk: 0,
            y: 9,
        },
        Hunk {
            file: 2,
            hunk: 1,
            y: 46,
        },
    ];

    #[test]
    fn jumps_start_below_the_sticky_header() {
        // The first card's hunk sits under its header at the top: the next one is the second file's.
        assert_eq!(jump(&HUNKS, None, 0, 1).map(|hunk| hunk.y), Some(9));
        assert_eq!(jump(&HUNKS, None, 0, -1), None);
        assert_eq!(jump(&HUNKS, None, 28, 1).map(|hunk| hunk.y), Some(46));
        assert_eq!(jump(&HUNKS, None, 28, -1).map(|hunk| hunk.y), Some(9));
    }

    #[test]
    fn jumps_continue_from_the_selected_hunk_until_the_view_moves() {
        let selected = Selected {
            file: 2,
            hunk: 0,
            scroll_top: 20,
        };
        // Clamped at the end, the view sits above the hunk; the selection still steps from it.
        assert_eq!(
            jump(&HUNKS, Some(selected), 20, 1).map(|hunk| hunk.y),
            Some(46)
        );
        assert_eq!(
            jump(&HUNKS, Some(selected), 20, -1).map(|hunk| hunk.y),
            Some(9)
        );
        assert_eq!(
            jump(
                &HUNKS,
                Some(Selected {
                    file: 0,
                    hunk: 0,
                    scroll_top: 0
                }),
                0,
                -1
            ),
            None
        );
        // Scrolled since: the position decides again.
        assert_eq!(
            jump(&HUNKS, Some(selected), 0, 1).map(|hunk| hunk.y),
            Some(9)
        );
    }

    #[test]
    fn the_current_file_is_the_last_card_at_the_top() {
        let files = [(3, 0), (2, 5), (4, 12)];
        assert_eq!(current_file(&files, 0), Some(3));
        assert_eq!(current_file(&files, 4), Some(2));
        assert_eq!(current_file(&files, 11), Some(4));
        assert_eq!(current_file(&[(1, 3)], 0), Some(1));
        assert_eq!(current_file(&[], 0), None);
    }

    #[test]
    fn card_tops_skip_the_gap_of_later_cards() {
        assert_eq!(card_top(0, None), 0);
        assert_eq!(card_top(7, None), 8);
        assert_eq!(card_top(7, Some(-3)), 4);
        assert_eq!(
            hunk_top(&Hunk {
                file: 0,
                hunk: 0,
                y: 1
            }),
            0
        );
        assert_eq!(clamp_scroll(30, 40, 34), 6);
        assert_eq!(clamp_scroll(-1, 10, 34), 0);
    }
}
