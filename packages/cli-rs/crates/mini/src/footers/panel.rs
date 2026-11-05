//! The searchable panels (`createSearchablePanelController` and `PanelShell` in `footer.command.tsx`): a title row
//! with a count and hints, a search field, and the footer menu, on a shaded block that ends in a half-block row.

use opencode_ui::select::fuzzy;
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::menu::{self, Groups, Item, Look};
use crate::prompt::menu::{COMPACT_WIDTH, Selection, fit};
use crate::theme::FooterTheme;

/// `PANEL_LIST_ROWS`.
pub const LIST_ROWS: usize = 10;
/// `SUBAGENT_LIST_ROWS`, which the pending prompts use too.
pub const SUBAGENT_LIST_ROWS: usize = 12;
/// `PANEL_FRAME_ROWS`.
const FRAME_ROWS: usize = 6;

/// `footerPanelLayout`: whether the frame collapses to its title and search rows, the frame's rows, and the list's.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub compact: bool,
    pub frame: usize,
    pub limit: usize,
}

pub fn layout(height: u16, limit: usize) -> Layout {
    let available = usize::from(height).saturating_sub(1).max(3);
    let compact = available < limit + FRAME_ROWS;
    let frame = if compact { 2 } else { FRAME_ROWS };
    Layout { compact, frame, limit: limit.min(available.saturating_sub(frame)).max(1) }
}

/// One row of a panel (`PanelEntry`): the menu item and the extra words the search matches.
#[derive(Clone, Debug, Default)]
pub struct Entry<A> {
    pub item: Item,
    pub keywords: String,
    pub action: A,
}

/// How a panel looks and behaves, fixed per kind.
#[derive(Clone, Copy, Debug)]
pub struct Spec {
    pub title: &'static str,
    pub count: bool,
    pub empty: &'static str,
    /// The list's rows (`limit`).
    pub rows: usize,
    /// The menu keeps `limit` rows (`rows={menu.limit}`) rather than shrinking to its items (`rows={menu.rows}`).
    pub fixed: bool,
    /// Grouped by category while the query is empty.
    pub grouped: bool,
    pub background: bool,
    pub close_on_first_up: bool,
}

/// What a key did.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Close,
    /// Enter on the entry at this index of the panel's entries.
    Select(usize),
    Handled,
}

pub struct Panel<A> {
    pub spec: Spec,
    pub hint: Option<String>,
    entries: Vec<Entry<A>>,
    /// The entries that match the query, as indexes into `entries`.
    matches: Vec<usize>,
    query: String,
    selection: Selection,
    groups: Groups,
    root: View,
    top: View,
    header: View,
    gap: View,
    field: View,
    input: Input,
    under: View,
    list: View,
    bottom: Text,
}

impl<A: Clone> Panel<A> {
    pub fn new(app: &App, spec: Spec) -> Self {
        let input = Input::new(app).placeholder("Search").width(Length::percent(100.0));
        let row = || View::new(app).width(Length::percent(100.0)).shrink(0.0);
        let top = row().height(1);
        let header = row().row().height(1);
        let gap = row().height(1);
        let field = row().height(1).child(&input);
        let under = row().height(1);
        let list = row().column();
        let bottom = Text::new(app, "").wrap(WrapMode::None).height(1).shrink(0.0);
        let root = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .shrink(0.0)
            .child(&top)
            .child(&header)
            .child(&gap)
            .child(&field)
            .child(&under)
            .child(&list)
            .child(&bottom);
        Self {
            spec,
            hint: None,
            entries: Vec::new(),
            matches: Vec::new(),
            query: String::new(),
            selection: Selection::default(),
            groups: Groups::default(),
            root,
            top,
            header,
            gap,
            field,
            input,
            under,
            list,
            bottom,
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn input(&self) -> &Input {
        &self.input
    }

    pub fn entries(&self) -> &[Entry<A>] {
        &self.entries
    }

    /// The highlighted entry.
    pub fn selected(&self) -> Option<&Entry<A>> {
        self.matches.get(self.selection.selected).map(|index| &self.entries[*index])
    }

    /// The footer rows the panel takes beside the blank row above it (`menu.rows() + layout().frame`).
    pub fn rows(&self, height: u16) -> usize {
        let layout = layout(height, self.spec.rows);
        Selection::rows(self.matches.len(), layout.limit) + layout.frame
    }

    /// New entries; the selection stays inside them (the menu state's effect).
    pub fn set_entries(&mut self, entries: Vec<Entry<A>>, height: u16) {
        self.entries = entries;
        self.matches = self.find();
        self.selection = self.selection.reconcile(self.matches.len(), layout(height, self.spec.rows).limit);
    }

    /// Moves to the current entry while the query is empty (`isCurrent`).
    pub fn reveal_current(&mut self, height: u16) {
        if !self.query.trim().is_empty() {
            return;
        }
        if let Some(index) = self.matches.iter().position(|index| self.entries[*index].item.current) {
            self.reveal(index, height);
        }
    }

    /// The query changed: match again and start from the top.
    pub fn set_query(&mut self, query: String, height: u16) {
        self.query = query;
        self.matches = self.find();
        self.selection = Selection::default();
        self.reveal_current(height);
    }

    fn find(&self) -> Vec<usize> {
        let text = self.query.trim();
        if text.is_empty() {
            return (0..self.entries.len()).collect();
        }
        fuzzy::go_scored(
            text,
            &self.entries,
            |entry| {
                [
                    Some(entry.item.display.as_str()),
                    entry.item.category.as_deref(),
                    entry.item.description.as_deref(),
                    Some(entry.keywords.as_str()),
                ]
            },
            |_, score, _| score,
            0.0,
            usize::MAX,
        )
    }

    fn reveal(&mut self, index: usize, height: u16) {
        self.selection = Selection { selected: index, offset: self.selection.offset }
            .reconcile(self.matches.len(), layout(height, self.spec.rows).limit);
    }

    /// The panel's keys (`useKeyboard` in the controller). `None` lets the search field have the key.
    pub fn key(&mut self, name: &str, height: u16) -> Option<Outcome> {
        let count = self.matches.len();
        let limit = layout(height, self.spec.rows).limit;
        match name {
            "up" if self.spec.close_on_first_up && self.selection.selected == 0 => Some(Outcome::Close),
            "escape" | "ctrl+c" => Some(Outcome::Close),
            "up" | "ctrl+p" => {
                self.selection = self.selection.step(count, limit, false);
                Some(Outcome::Handled)
            }
            "down" | "ctrl+n" => {
                self.selection = self.selection.step(count, limit, true);
                Some(Outcome::Handled)
            }
            "pageup" => {
                let index = self.selection.selected.saturating_sub(limit.saturating_sub(1).max(1));
                self.reveal(index, height);
                Some(Outcome::Handled)
            }
            "pagedown" => {
                self.reveal(self.selection.selected + limit.saturating_sub(1).max(1), height);
                Some(Outcome::Handled)
            }
            "home" => {
                self.reveal(0, height);
                Some(Outcome::Handled)
            }
            "end" => {
                self.reveal(usize::MAX, height);
                Some(Outcome::Handled)
            }
            "return" => Some(
                self.matches.get(self.selection.selected).map_or(Outcome::Handled, |index| Outcome::Select(*index)),
            ),
            "ctrl+u" => {
                self.input.set_value("");
                self.set_query(String::new(), height);
                Some(Outcome::Handled)
            }
            _ => None,
        }
    }

    /// Draws the panel at the terminal's `width` and `height`.
    pub fn paint(&mut self, app: &App, width: u16, height: u16, theme: &FooterTheme, mono: bool) {
        let layout = layout(height, self.spec.rows);
        let pad = if width < COMPACT_WIDTH || mono { 1 } else { 2 };
        let shade = if self.spec.background { theme.shade } else { Color::TRANSPARENT };
        let blank = u32::from(!layout.compact);
        for view in [&self.top, &self.gap, &self.under] {
            view.height(blank).bg(shade);
        }
        self.header.bg(shade).padding_x(u32::from(pad));
        self.field.bg(shade).padding_x(u32::from(pad));
        self.list.bg(shade);
        if self.spec.background {
            self.input
                .focused_colors(theme.formfield_focused_text, theme.formfield_focused_bg)
                .cursor_color(theme.formfield_focused_text);
        } else {
            self.input.focused_colors(theme.formfield_text, Color::TRANSPARENT).cursor_color(theme.formfield_text);
        }
        self.input.colors(theme.formfield_text, Color::TRANSPARENT).placeholder_color(theme.muted);

        let room = usize::from(width).saturating_sub(usize::from(pad) * 2 + 4);
        let title = fit(self.spec.title, room, mono);
        let count = if self.query.trim().is_empty() {
            self.entries.len().to_string()
        } else {
            format!("{}/{}", self.matches.len(), self.entries.len())
        };
        let show_count = self.spec.count && self.spec.title.width() + count.width() < room;
        let hint = self.hint.as_deref().filter(|hint| {
            self.spec.title.width() + if show_count { count.width() + 1 } else { 0 } + hint.width() + 3 <= room
        });
        self.header.clear();
        self.header.add(&Text::new(app, title).fg(theme.text).bold().wrap(WrapMode::None).shrink(0.0));
        if show_count {
            self.header.add(&Text::new(app, format!(" {count}")).fg(theme.muted).wrap(WrapMode::None).shrink(0.0));
        }
        self.header.add(&View::new(app).min_width(1).grow(1.0).shrink(1.0).basis(Length::Auto));
        let separator = if mono { "-" } else { "·" };
        self.header.add(
            &Text::new(
                app,
                match hint {
                    Some(hint) => format!("{hint} {separator} esc"),
                    None => "esc".to_owned(),
                },
            )
            .fg(theme.muted)
            .wrap(WrapMode::None)
            .shrink(0.0),
        );

        let items: Vec<Item> = self.matches.iter().map(|index| self.entries[*index].item.clone()).collect();
        let rows = if self.spec.fixed { layout.limit } else { Selection::rows(items.len(), layout.limit) };
        menu::paint(
            app,
            &self.list,
            &items,
            self.selection,
            &mut self.groups,
            rows,
            layout.limit,
            width,
            theme,
            &Look {
                empty: self.spec.empty,
                pad,
                grouped: self.spec.grouped && self.query.trim().is_empty(),
                compact: layout.compact,
                background: self.spec.background,
                mono,
            },
        );
        let half = !layout.compact && !mono && self.spec.background;
        self.bottom.height(u32::from(!layout.compact)).set_text(if half {
            vec!["▀".repeat(usize::from(width)).fg(theme.shade)]
        } else {
            Vec::new()
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layout_collapses_in_short_terminals() {
        assert_eq!(layout(30, LIST_ROWS), Layout { compact: false, frame: 6, limit: 10 });
        assert_eq!(layout(16, LIST_ROWS), Layout { compact: true, frame: 2, limit: 10 });
        assert_eq!(layout(8, LIST_ROWS), Layout { compact: true, frame: 2, limit: 5 });
        assert_eq!(layout(2, LIST_ROWS).limit, 1);
    }
}
