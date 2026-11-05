//! The footer menu of the panels (`footer.menu.tsx`): grouped rows with category headers, right-aligned footers in
//! a tone, and a shaded background. The autocomplete's flat menu is [`crate::prompt::menu`].

use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use crate::prompt::menu::{COMPACT_WIDTH, Selection, fit};
use crate::theme::FooterTheme;

/// `footerTone`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tone {
    Selection,
    Running,
    Error,
    Success,
}

/// `RunFooterMenuItem`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Item {
    pub display: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub footer: Option<String>,
    pub tone: Option<Tone>,
    pub current: bool,
}

/// `RunFooterMenuRow`.
#[derive(Clone, Debug, PartialEq)]
enum Row {
    Header(String),
    Item(usize),
    Spacer,
}

/// How a panel draws its menu.
pub struct Look<'a> {
    pub empty: &'a str,
    pub pad: u16,
    pub grouped: bool,
    pub compact: bool,
    pub background: bool,
    pub mono: bool,
}

/// The scroll offset of the grouped rows, which follows the selection (`groupOffset`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Groups {
    offset: usize,
    previous: Option<usize>,
}

fn grouped_rows(items: &[Item], compact: bool) -> Vec<Row> {
    let mut rows = Vec::new();
    let mut category = "";
    for (index, item) in items.iter().enumerate() {
        if let Some(next) = item.category.as_deref().filter(|next| !next.is_empty() && *next != category) {
            if !rows.is_empty() && !compact {
                rows.push(Row::Spacer);
            }
            category = next;
            if !compact {
                rows.push(Row::Header(next.to_owned()));
            }
        }
        rows.push(Row::Item(index));
    }
    rows
}

impl Groups {
    /// The effect that moves the grouped window with the selection: by a step after a one-row move, else to
    /// reveal it.
    fn follow(&mut self, rows: &[Row], selected: usize, limit: usize) {
        let row = rows.iter().position(|row| *row == Row::Item(selected));
        let Some(row) = row else {
            self.offset = 0;
            self.previous = Some(selected);
            return;
        };
        let step = match self.previous {
            Some(previous) if selected == previous + 1 => Some(true),
            Some(previous) if previous > 0 && selected == previous - 1 => Some(false),
            _ => None,
        };
        let window = Selection { selected: row, offset: self.offset };
        self.offset = match step {
            Some(down) => {
                let from = Selection { selected: if down { row - 1 } else { row + 1 }, offset: self.offset };
                from.step(rows.len(), limit, down).offset
            }
            None => window.reconcile(rows.len(), limit).offset,
        };
        self.previous = Some(selected);
    }
}

/// Fills `root` with the menu: `height` rows tall, showing at most `limit` rows from the selection's window.
#[allow(clippy::too_many_arguments)]
pub fn paint(
    app: &App,
    root: &View,
    items: &[Item],
    selection: Selection,
    groups: &mut Groups,
    height: usize,
    limit: usize,
    width: u16,
    theme: &FooterTheme,
    look: &Look<'_>,
) {
    let limit = limit.min(height).max(1);
    let pad = if width < COMPACT_WIDTH { 1 } else { look.pad };
    let available = usize::from(width.saturating_sub(pad * 2));
    let shade = if look.background { theme.shade } else { Color::TRANSPARENT };
    root.clear();
    root.height(height as u32).bg(shade);
    let rows: Vec<Row> = if look.grouped {
        let all = grouped_rows(items, look.compact);
        groups.follow(&all, selection.selected, limit);
        let start = groups.offset.min(all.len().saturating_sub(limit));
        all.into_iter().skip(start).take(limit).collect()
    } else {
        (selection.offset..items.len()).take(limit).map(Row::Item).collect()
    };
    if rows.is_empty() {
        root.add(
            &View::new(app)
                .height(1)
                .padding_x(u32::from(pad))
                .bg(shade)
                .child(&Text::new(app, look.empty.to_owned()).fg(theme.muted).wrap(WrapMode::None).truncate(true)),
        );
        return;
    }
    let column = items
        .iter()
        .filter(|item| item.description.is_some())
        .map(|item| item.display.width())
        .max()
        .map_or(0, |widest| widest + 2);
    for row in rows {
        let index = match row {
            Row::Spacer => {
                root.add(&View::new(app).height(1).shrink(0.0));
                continue;
            }
            Row::Header(label) => {
                root.add(
                    &View::new(app)
                        .height(1)
                        .shrink(0.0)
                        .padding_x(u32::from(pad))
                        .child(&Text::new(app, label).fg(theme.muted).bold().wrap(WrapMode::None).truncate(true)),
                );
                continue;
            }
            Row::Item(index) => index,
        };
        let item = &items[index];
        let active = index == selection.selected;
        let background = if active { theme.action_focused_bg } else { shade };
        let footer = item.footer.as_deref().filter(|footer| {
            let title = item.display.width();
            let primary = item.tone.is_some() && !(item.current && item.tone == Some(Tone::Selection));
            (if primary { title.min(8) } else { title }) + 1 + footer.width() <= available
        });
        let reserved = footer.map_or(0, |footer| footer.width() + 1);
        let description = item.description.as_deref().and_then(|description| {
            let remaining = available.saturating_sub(column + reserved);
            (remaining >= description.width().min(12)).then(|| fit(description, remaining, look.mono))
        });
        let fg = if active { theme.action_focused_text } else { theme.formfield_text };
        let emphasis = |span: Span<'static>| {
            if !active {
                return span;
            }
            if look.mono {
                return span.bold().inverse();
            }
            span.bold()
        };
        let mut spans = vec![emphasis(fit(&item.display, available.saturating_sub(reserved), look.mono).fg(fg))];
        if let Some(description) = description {
            let muted = if active { theme.action_focused_text } else { theme.muted };
            spans.push(" ".repeat(column.saturating_sub(item.display.width()).max(1)).fg(muted));
            spans.push(description.fg(muted));
        }
        let line = View::new(app).row().height(1).shrink(0.0).padding_x(u32::from(pad)).gap(1).bg(background).child(
            &Text::new(app, spans).wrap(WrapMode::None).truncate(true).grow(1.0).shrink(1.0).basis(Length::Auto),
        );
        if let Some(footer) = footer {
            let color = if active {
                theme.action_focused_text
            } else {
                match item.tone {
                    Some(Tone::Selection) => theme.selection,
                    Some(Tone::Running) => theme.running,
                    Some(Tone::Error) => theme.error,
                    Some(Tone::Success) => theme.success,
                    None => theme.muted,
                }
            };
            line.add(&Text::new(app, vec![emphasis(footer.to_owned().fg(color))]).wrap(WrapMode::None).shrink(0.0));
        }
        root.add(&line);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(display: &str, category: &str) -> Item {
        Item { display: display.into(), category: Some(category.into()), ..Item::default() }
    }

    #[test]
    fn grouped_rows_put_a_spacer_and_header_before_each_category() {
        let items = [item("a", "One"), item("b", "One"), item("c", "Two")];
        assert_eq!(
            grouped_rows(&items, false),
            vec![
                Row::Header("One".into()),
                Row::Item(0),
                Row::Item(1),
                Row::Spacer,
                Row::Header("Two".into()),
                Row::Item(2),
            ]
        );
        assert_eq!(grouped_rows(&items, true), vec![Row::Item(0), Row::Item(1), Row::Item(2)]);
    }

    #[test]
    fn the_grouped_window_follows_the_selection() {
        let items: Vec<Item> =
            (0..12).map(|index| item(&index.to_string(), if index < 6 { "One" } else { "Two" })).collect();
        let rows = grouped_rows(&items, false);
        let mut groups = Groups::default();
        groups.follow(&rows, 0, 10);
        assert_eq!(groups.offset, 0);
        for selected in 1..=11 {
            groups.follow(&rows, selected, 10);
        }
        // Item 11 is the last of 15 rows.
        assert_eq!(groups.offset, 5);
        // A jump reveals the item's row only, as TS does, so the header above it stays hidden.
        groups.follow(&rows, 0, 10);
        assert_eq!(groups.offset, 1);
    }
}
