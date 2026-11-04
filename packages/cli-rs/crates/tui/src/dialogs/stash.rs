//! Stash dialog (E.4, row DLG20): `packages/tui/src/component/dialog-stash.tsx`.
//!
//! "Stash": the stashed prompts, newest first, each with its first line, when it was stashed, and
//! `~N lines` for longer ones. Choosing one takes it out of the stash and hands it to the prompt;
//! `stash.delete` (Ctrl+D) deletes on the second press.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use chrono::{Local, TimeZone};
use opencode_ui::dialog::{DialogOptions, DialogSize};
use opencode_ui::select::{self, Select, SelectAction, SelectOption, SelectProps};
use serde_json::Value;

use crate::app::Tui;

/// What choosing an entry does with it (`{prompt, timestamp}`).
pub type OnSelect = Rc<dyn Fn(&Value)>;

/// Opens the dialog (`prompt.stash.list`).
pub fn show(tui: &Tui, on_select: OnSelect) {
    let list = Rc::new(List {
        tui: tui.weak(),
        select: RefCell::new(None),
        to_delete: Cell::new(None),
    });
    let built = list.clone();
    tui.dialogs.replace(
        move |cx| {
            let list = built;
            let weak = Rc::downgrade(&list);
            let mut props = SelectProps::new("Stash", list.options());
            props.on_move = Some(Rc::new({
                let weak = weak.clone();
                move |_: &SelectOption<usize>| {
                    let Some(list) = weak.upgrade() else { return };
                    if list.to_delete.take().is_some() {
                        list.refresh_later();
                    }
                }
            }));
            props.on_select = Some(Rc::new({
                let weak = weak.clone();
                move |option: &SelectOption<usize>| {
                    let Some(tui) = weak.upgrade().and_then(|list| list.tui.upgrade()) else {
                        return;
                    };
                    let (index, on_select, weak) = (option.value, on_select.clone(), tui.weak());
                    tui.app.defer(move |_| {
                        let Some(tui) = weak.upgrade() else { return };
                        if let Some(entry) = tui.prompt.stash.list().get(index) {
                            tui.prompt.stash.remove(&tui.app, index);
                            on_select(entry);
                        }
                        tui.dialogs.clear();
                    });
                }
            }));
            props.actions = vec![SelectAction::new("stash.delete", "delete", {
                let weak = weak.clone();
                move |option: &SelectOption<usize>| {
                    if let Some(list) = weak.upgrade() {
                        list.delete(option.value);
                    }
                }
            })];
            let (view, select) = select::select(cx, props);
            *list.select.borrow_mut() = Some(select);
            cx.on_close(opentui::keymap::Disposer::new(move || {
                list.select.borrow_mut().take();
            }));
            view
        },
        None,
        DialogOptions {
            size: DialogSize::Medium,
            key: None,
        },
    );
}

struct List {
    tui: Weak<Tui>,
    select: RefCell<Option<Select<usize>>>,
    /// The entry the first delete press marked.
    to_delete: Cell<Option<usize>>,
}

impl List {
    fn options(&self) -> Vec<SelectOption<usize>> {
        let Some(tui) = self.tui.upgrade() else {
            return Vec::new();
        };
        let theme = tui.page().surface(opencode_ui::theme::Surface::Dialog);
        let key = tui.keymap.shortcut("stash.delete").unwrap_or_default();
        let now = crate::dialogs::session_list::now_ms();
        let deleting = self.to_delete.get();
        let mut options: Vec<SelectOption<usize>> = tui
            .prompt
            .stash
            .list()
            .iter()
            .enumerate()
            .map(|(index, entry)| {
                let text = entry["prompt"]["text"].as_str().unwrap_or_default();
                let lines = text.matches('\n').count() + 1;
                let title = if deleting == Some(index) {
                    format!("Press {key} again to confirm")
                } else {
                    preview(text)
                };
                let mut option = SelectOption::new(title, index).description(relative_time(
                    entry["timestamp"].as_f64().unwrap_or(0.0),
                    now,
                ));
                if lines > 1 {
                    option.footer = Some(format!("~{lines} lines"));
                }
                if deleting == Some(index) {
                    option.bg = Some(theme.background.action.destructive.focused);
                    option.fg = Some(theme.text.action.destructive.focused);
                }
                option
            })
            .collect();
        options.reverse();
        options
    }

    fn delete(self: &Rc<Self>, index: usize) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if self.to_delete.get() == Some(index) {
            tui.prompt.stash.remove(&tui.app, index);
            self.to_delete.set(None);
        } else {
            self.to_delete.set(Some(index));
        }
        self.refresh_later();
    }

    /// Refreshes after the current select handler returns.
    fn refresh_later(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let weak = Rc::downgrade(self);
        tui.app.defer(move |_| {
            let Some(list) = weak.upgrade() else { return };
            let select = list.select.borrow().clone();
            if let Some(select) = select {
                select.set_options(list.options());
            }
        });
    }
}

/// `getStashPreview`: the first line, trimmed, at most 50 characters.
fn preview(text: &str) -> String {
    select::truncate(text.split('\n').next().unwrap_or_default().trim(), 50)
}

/// `getRelativeTime`.
fn relative_time(timestamp: f64, now: f64) -> String {
    let seconds = ((now - timestamp) / 1000.0).floor();
    let minutes = (seconds / 60.0).floor();
    let hours = (minutes / 60.0).floor();
    let days = (hours / 24.0).floor();
    if seconds < 60.0 {
        return "just now".to_owned();
    }
    if minutes < 60.0 {
        return format!("{minutes}m ago");
    }
    if hours < 24.0 {
        return format!("{hours}h ago");
    }
    if days < 7.0 {
        return format!("{days}d ago");
    }
    datetime(timestamp)
}

/// `Locale.datetime`: the short time, then `toLocaleDateString` in en-US.
fn datetime(timestamp: f64) -> String {
    let date = Local
        .timestamp_millis_opt(timestamp as i64)
        .single()
        .map(|date| date.format("%-m/%-d/%Y").to_string())
        .unwrap_or_default();
    format!("{} · {date}", crate::dialogs::timeline::time(timestamp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn previews_and_times_follow_typescript() {
        assert_eq!(preview("  first line  \nsecond"), "first line");
        assert_eq!(preview(&"x".repeat(60)), format!("{}…", "x".repeat(49)));
        let now = 1_000_000_000_000.0;
        assert_eq!(relative_time(now - 59_000.0, now), "just now");
        assert_eq!(relative_time(now - 5.0 * 60_000.0, now), "5m ago");
        assert_eq!(relative_time(now - 3.0 * 3_600_000.0, now), "3h ago");
        assert_eq!(relative_time(now - 6.0 * 86_400_000.0, now), "6d ago");
        assert!(relative_time(now - 8.0 * 86_400_000.0, now).contains(" · "));
    }
}
