//! The footer menu (`footer.menu.tsx`) the autocomplete shows below the prompt, and its selection window
//! (`createFooterMenuState` on `ui/select-controller.ts`). Only the flat form is here; the grouped form belongs to
//! M.3's command and selection views.

use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use crate::theme::FooterTheme;

/// `FOOTER_MENU_ROWS`.
pub const MENU_ROWS: u16 = 8;
/// `FOOTER_COMPACT_WIDTH`.
pub const COMPACT_WIDTH: u16 = 40;

/// One row (`RunFooterMenuItem` without icons and footers).
#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub display: String,
    pub description: Option<String>,
}

/// The highlighted row and the first row shown.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Selection {
    pub selected: usize,
    pub offset: usize,
}

impl Selection {
    /// The rows the menu takes: at least one, at most `limit`.
    pub fn rows(count: usize, limit: usize) -> usize {
        count.clamp(1, limit.max(1))
    }

    /// The effect that keeps the selection inside `count` items (`reconcileSelection`, `revealSelectionOffset`).
    pub fn reconcile(self, count: usize, limit: usize) -> Self {
        let selected = self.selected.min(count.saturating_sub(1));
        Self {
            selected,
            offset: reveal(self.offset, count, limit.max(1), selected),
        }
    }

    /// `move`: clamped, with a margin of up to two rows (`moveSelectionOffset`).
    pub fn step(self, count: usize, limit: usize, down: bool) -> Self {
        let limit = limit.max(1);
        if count == 0 {
            return Self::default();
        }
        let selected = if down {
            (self.selected + 1).min(count - 1)
        } else {
            self.selected.saturating_sub(1)
        };
        let max = count.saturating_sub(limit);
        let margin = ((limit - 1) / 2).min(2);
        let offset = if !down && selected < self.offset + margin {
            selected.saturating_sub(margin).min(max)
        } else if down && selected + margin + 1 > self.offset + limit {
            (selected + margin + 1 - limit).min(max)
        } else {
            self.offset.min(max)
        };
        Self { selected, offset }
    }
}

fn reveal(offset: usize, count: usize, limit: usize, selected: usize) -> usize {
    let max = count.saturating_sub(limit);
    if selected < offset {
        return selected.min(max);
    }
    if selected >= offset + limit {
        return (selected + 1 - limit).min(max);
    }
    offset.min(max)
}

/// `Locale.truncateWidth`, or three dots in mono (`footerMenuText`).
pub fn fit(text: &str, width: usize, mono: bool) -> String {
    if text.width() <= width {
        return text.to_owned();
    }
    if width == 0 {
        return String::new();
    }
    let suffix = if mono {
        ".".repeat(width.min(3))
    } else {
        "…".to_owned()
    };
    take_width(text, width - suffix.width()) + &suffix
}

/// `Locale.takeWidth`.
pub fn take_width(text: &str, width: usize) -> String {
    let mut out = String::new();
    for character in text.chars() {
        if out.width() + unicode_width::UnicodeWidthChar::width(character).unwrap_or(0) > width {
            break;
        }
        out.push(character);
    }
    out
}

/// The menu: a column of one-row items, without the left border (`border={false}`), padded two cells on each
/// side (one below 40 columns).
pub struct Menu {
    app: App,
    root: View,
}

impl Menu {
    pub fn new(app: &App) -> Self {
        Self {
            app: app.clone(),
            root: View::new(app)
                .column()
                .shrink(0.0)
                .width(Length::percent(100.0))
                .visible(false),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn hide(&self) {
        self.root.visible(false);
    }

    /// Shows `rows` items from the selection's offset.
    pub fn show(
        &self,
        items: &[Item],
        selection: Selection,
        rows: usize,
        width: u16,
        theme: &FooterTheme,
        mono: bool,
    ) {
        let app = &self.app;
        let pad = if width < COMPACT_WIDTH { 1 } else { 2 };
        let available = usize::from(width.saturating_sub(pad * 2));
        let column = items
            .iter()
            .filter(|item| item.description.is_some())
            .map(|item| item.display.width())
            .max()
            .map_or(0, |widest| widest + 2);
        self.root.clear();
        self.root.height(rows as u32).visible(true);
        if items.is_empty() {
            self.root.add(
                &View::new(app).height(1).padding_x(u32::from(pad)).child(
                    &Text::new(app, "No matching items")
                        .fg(theme.muted)
                        .wrap(WrapMode::None)
                        .truncate(true),
                ),
            );
            return;
        }
        for (index, item) in items.iter().enumerate().skip(selection.offset).take(rows) {
            let active = index == selection.selected;
            let fg = if active {
                theme.action_focused_text
            } else {
                theme.formfield_text
            };
            let mut display = fit(&item.display, available, mono).fg(fg);
            if active {
                display = display.bold();
                if mono {
                    display = display.inverse();
                }
            }
            let mut spans = vec![display];
            let description = item.description.as_deref().and_then(|description| {
                let remaining = available.saturating_sub(column);
                (remaining >= description.width().min(12))
                    .then(|| fit(description, remaining, mono))
            });
            if let Some(description) = description {
                let muted = if active {
                    theme.action_focused_text
                } else {
                    theme.muted
                };
                spans.push(
                    " ".repeat(column.saturating_sub(item.display.width()).max(1))
                        .fg(muted),
                );
                spans.push(description.fg(muted));
            }
            let row = View::new(app)
                .row()
                .height(1)
                .shrink(0.0)
                .padding_x(u32::from(pad))
                .child(&Text::new(app, spans).wrap(WrapMode::None).truncate(true));
            if active {
                row.bg(theme.action_focused_bg);
            }
            self.root.add(&row);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_moves_with_a_margin_and_clamps() {
        let mut selection = Selection::default();
        for _ in 0..5 {
            selection = selection.step(10, 8, true);
        }
        assert_eq!(
            selection,
            Selection {
                selected: 5,
                offset: 0
            }
        );
        selection = selection.step(10, 8, true);
        assert_eq!(
            selection,
            Selection {
                selected: 6,
                offset: 1
            }
        );
        for _ in 0..10 {
            selection = selection.step(10, 8, true);
        }
        assert_eq!(
            selection,
            Selection {
                selected: 9,
                offset: 2
            }
        );
        selection = selection
            .step(10, 8, false)
            .step(10, 8, false)
            .step(10, 8, false)
            .step(10, 8, false)
            .step(10, 8, false);
        assert_eq!(
            selection,
            Selection {
                selected: 4,
                offset: 2
            }
        );
        selection = selection.step(10, 8, false);
        assert_eq!(
            selection,
            Selection {
                selected: 3,
                offset: 1
            }
        );
        assert_eq!(
            Selection {
                selected: 9,
                offset: 2
            }
            .reconcile(3, 8),
            Selection {
                selected: 2,
                offset: 0
            }
        );
        assert_eq!(Selection::rows(0, 8), 1);
        assert_eq!(Selection::rows(20, 8), 8);
    }

    #[test]
    fn text_fits_its_width() {
        assert_eq!(
            fit("compose in your external editor", 10, false),
            "compose i…"
        );
        assert_eq!(
            fit("compose in your external editor", 10, true),
            "compose..."
        );
        assert_eq!(fit("short", 10, false), "short");
    }
}
