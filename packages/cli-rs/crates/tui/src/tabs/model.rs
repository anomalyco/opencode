//! The pure tab model (`context/session-tabs-model.ts`). Functions that change nothing return `None` where TS
//! returns the same array, so callers can skip a write.

use serde::{Deserialize, Serialize};

pub const NEW_SESSION_TAB_TITLE: &str = "New session";
pub const SESSION_TAB_WIDTH: usize = 22;
pub const SESSION_TAB_MAX_WIDTH: usize = 32;
pub const SESSION_TAB_MIN_WIDTH: usize = 8;
const CLOSED_SESSION_TAB_LIMIT: usize = 25;
const SESSION_TAB_HISTORY_LIMIT: usize = 100;

/// One persisted tab, as `tabs.json` stores it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tab {
    #[serde(rename = "sessionID")]
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl Tab {
    pub fn new(session_id: impl Into<String>, title: Option<String>) -> Self {
        Self { session_id: session_id.into(), title }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unread {
    Activity,
    Error,
}

/// `sessionTabComplete`.
pub fn complete(unread: Option<Unread>, busy: bool) -> bool {
    unread == Some(Unread::Activity) && !busy
}

/// `sessionTabOverflowWidth`: the marker, its digits, and one gap cell.
pub fn overflow_width(count: usize) -> usize {
    count.to_string().len() + 2
}

/// `sessionTabDetail`.
pub fn detail(project: &str, current: Option<&str>, default: Option<&str>, worktree: bool) -> String {
    let branch = current.filter(|current| worktree && Some(*current) != default);
    match branch {
        Some(branch) if !project.is_empty() => format!("{project} ⎇ {branch}"),
        Some(branch) => branch.to_owned(),
        None => project.to_owned(),
    }
}

/// `openSessionTab`.
pub fn open(tabs: &[Tab], tab: Tab) -> Option<Vec<Tab>> {
    let Some(index) = tabs.iter().position(|item| item.session_id == tab.session_id) else {
        let mut next = tabs.to_vec();
        next.push(tab);
        return Some(next);
    };
    if tab.title.is_none() || tab.title.as_deref() == Some("") || tabs[index].title == tab.title {
        return None;
    }
    let mut next = tabs.to_vec();
    next[index].title = tab.title;
    Some(next)
}

/// `closeSessionTab`: the tabs without `session`, and the tab to select next (right, then left).
pub fn close(tabs: &[Tab], session: &str) -> Option<(Vec<Tab>, Option<String>)> {
    let index = tabs.iter().position(|tab| tab.session_id == session)?;
    let next = tabs
        .get(index + 1)
        .or_else(|| index.checked_sub(1).and_then(|before| tabs.get(before)))
        .map(|tab| tab.session_id.clone());
    Some((tabs.iter().filter(|tab| tab.session_id != session).cloned().collect(), next))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Closed {
    pub tab: Tab,
    pub index: usize,
}

/// `recordClosedSessionTab`.
pub fn record_closed(stack: &mut Vec<Closed>, tab: Tab, index: usize) {
    stack.retain(|entry| entry.tab.session_id != tab.session_id);
    stack.push(Closed { tab, index });
    let excess = stack.len().saturating_sub(CLOSED_SESSION_TAB_LIMIT);
    stack.drain(..excess);
}

/// `reopenSessionTab`: pops entries (the newest, or `session`'s) until one is not open, and puts it back at its
/// position. The stack loses every entry it walked past.
pub fn reopen(stack: &mut Vec<Closed>, tabs: &[Tab], session: Option<&str>) -> Option<(Vec<Tab>, String)> {
    while !stack.is_empty() {
        let index = match session {
            Some(session) => stack.iter().position(|entry| entry.tab.session_id == session)?,
            None => stack.len() - 1,
        };
        let entry = stack.remove(index);
        if tabs.iter().any(|tab| tab.session_id == entry.tab.session_id) {
            continue;
        }
        let mut next = tabs.to_vec();
        next.insert(entry.index.min(tabs.len()), entry.tab.clone());
        return Some((next, entry.tab.session_id));
    }
    None
}

/// `moveSessionTab`.
pub fn reorder(tabs: &[Tab], session: &str, index: usize) -> Option<Vec<Tab>> {
    let from = tabs.iter().position(|tab| tab.session_id == session)?;
    let to = index.min(tabs.len().saturating_sub(1));
    if from == to {
        return None;
    }
    let mut next = tabs.to_vec();
    let tab = next.remove(from);
    next.insert(to, tab);
    Some(next)
}

/// `cycleSessionTab`.
pub fn cycle<'a>(
    tabs: &'a [Tab],
    active: Option<&str>,
    forward: bool,
    matches: impl Fn(&Tab) -> bool,
) -> Option<&'a Tab> {
    let count = tabs.len() as isize;
    if count == 0 {
        return None;
    }
    let direction = if forward { 1 } else { -1 };
    let start = match tabs.iter().position(|tab| Some(tab.session_id.as_str()) == active) {
        Some(index) => index as isize,
        None if forward => -1,
        None => 0,
    };
    (0..count)
        .map(|offset| &tabs[(start + direction * (offset + 1) + count * 2).rem_euclid(count) as usize])
        .find(|tab| matches(tab))
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct History {
    pub entries: Vec<String>,
    /// `-1` before the first entry, as in TS.
    pub index: isize,
}

impl History {
    pub fn new() -> Self {
        Self { entries: Vec::new(), index: -1 }
    }

    fn at(&self, index: isize) -> Option<&String> {
        usize::try_from(index).ok().and_then(|index| self.entries.get(index))
    }

    /// `recordSessionTabHistory`.
    pub fn record(&mut self, session: &str) {
        if self.at(self.index).map(String::as_str) == Some(session) {
            return;
        }
        self.entries.truncate((self.index + 1) as usize);
        self.entries.push(session.to_owned());
        let excess = self.entries.len().saturating_sub(SESSION_TAB_HISTORY_LIMIT);
        self.entries.drain(..excess);
        self.index = self.entries.len() as isize - 1;
    }

    /// `moveSessionTabHistory`: the open tab to go to, moving the index when there is one.
    pub fn step(&mut self, tabs: &[Tab], active: Option<&str>, forward: bool) -> Option<String> {
        let open = |session: &str| tabs.iter().any(|tab| tab.session_id == session);
        let Some(active) = active else {
            return self.at(self.index).filter(|session| open(session)).cloned();
        };
        let candidates: Vec<usize> = if forward {
            ((self.index + 1).max(0) as usize..self.entries.len()).collect()
        } else {
            (0..self.index.max(0) as usize).rev().collect()
        };
        let target =
            candidates.into_iter().find(|&index| self.entries[index] != active && open(&self.entries[index]))?;
        self.index = target as isize;
        Some(self.entries[target].clone())
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Layout {
    /// Indexes of the visible tabs into the full list.
    pub start: usize,
    pub widths: Vec<usize>,
    pub before: usize,
    pub after: usize,
    pub total: usize,
}

impl Layout {
    pub fn visible(&self) -> std::ops::Range<usize> {
        self.start..self.start + self.widths.len()
    }
}

/// `adaptiveSessionTabLayout` over the tabs' session IDs.
pub fn layout(tabs: &[&str], active: Option<&str>, available: i64, previous_start: usize) -> Layout {
    if tabs.is_empty() {
        return Layout::default();
    }
    let count = tabs.len();
    let active_index = active.and_then(|active| tabs.iter().position(|tab| *tab == active));
    let fit = |width: i64| -> usize {
        let width = width.max(0);
        let fitted = match active_index {
            None => width / SESSION_TAB_MIN_WIDTH as i64,
            Some(_) => 1 + (width - SESSION_TAB_WIDTH as i64).div_euclid(SESSION_TAB_MIN_WIDTH as i64),
        };
        fitted.clamp(1, count as i64) as usize
    };
    let markers = |start: usize, visible: usize| {
        (if start > 0 { overflow_width(start) } else { 0 })
            + (if start + visible < count { overflow_width(count - start - visible) } else { 0 })
    };
    let mut visible = fit(available);
    let mut start = previous_start;
    for attempt in (0..=3).rev() {
        let bounded = start.min(count - visible);
        start = match active_index {
            Some(index) if index < bounded => index,
            Some(index) if index >= bounded + visible => index + 1 - visible,
            _ => bounded,
        }
        .min(count - visible);
        let next = fit(available - markers(start, visible) as i64);
        if next == visible || attempt == 0 {
            break;
        }
        visible = next;
    }
    let before = start;
    let after = count - start - visible;
    let content = (available - markers(start, visible) as i64).max(1) as usize;
    let roomy = content >= SESSION_TAB_WIDTH * visible;
    let total = if roomy { content.min(SESSION_TAB_MAX_WIDTH * visible) } else { content };
    let active_visible = active_index.filter(|index| (start..start + visible).contains(index));
    if roomy || active_index.is_none() {
        let width = total / visible;
        let remainder = total - width * visible;
        return Layout {
            start,
            widths: (0..visible).map(|index| width + usize::from(index < remainder)).collect(),
            before,
            after,
            total,
        };
    }
    let inactive = if visible == 1 {
        0
    } else {
        ((total - SESSION_TAB_WIDTH.min(total)) / (visible - 1)).clamp(SESSION_TAB_MIN_WIDTH, SESSION_TAB_WIDTH)
    };
    let active_width = if visible == 1 {
        total
    } else {
        // TS subtracts in floats, so an overfull strip can go below zero; widths then clamp to one cell when drawn.
        total.saturating_sub(inactive * (visible - 1))
    };
    Layout {
        start,
        widths: (start..start + visible)
            .map(|index| if Some(index) == active_visible { active_width } else { inactive })
            .collect(),
        before,
        after,
        total,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tabs(ids: &[&str]) -> Vec<Tab> {
        ids.iter().map(|id| Tab::new(*id, None)).collect()
    }

    fn history(ids: &[&str]) -> History {
        let mut history = History::new();
        ids.iter().for_each(|id| history.record(id));
        history
    }

    #[test]
    fn detail_appends_the_branch_of_a_worktree() {
        assert_eq!(detail("app", Some("feat"), Some("dev"), true), "app ⎇ feat");
        assert_eq!(detail("app", Some("dev"), Some("dev"), true), "app");
        assert_eq!(detail("app", Some("feat"), Some("dev"), false), "app");
        assert_eq!(detail("", Some("feat"), Some("dev"), true), "feat");
    }

    #[test]
    fn overflow_markers_reserve_a_gap() {
        assert_eq!(overflow_width(5), 3);
        assert_eq!(overflow_width(12), 4);
    }

    #[test]
    fn opens_each_session_once_and_refreshes_its_title() {
        let tabs = open(&[Tab::new("a", Some("Old".into()))], Tab::new("a", Some("New".into()))).unwrap();
        assert_eq!(tabs, [Tab::new("a", Some("New".into()))]);
        assert_eq!(open(&tabs, Tab::new("b", None)).unwrap(), [Tab::new("a", Some("New".into())), Tab::new("b", None)]);
        assert_eq!(open(&tabs, Tab::new("a", Some("New".into()))), None);
    }

    #[test]
    fn close_selects_right_then_left() {
        assert_eq!(close(&tabs(&["a", "b", "c"]), "b"), Some((tabs(&["a", "c"]), Some("c".into()))));
        assert_eq!(close(&tabs(&["a", "b"]), "b").unwrap().1, Some("a".into()));
        assert_eq!(close(&tabs(&["a"]), "a").unwrap().1, None);
        assert_eq!(close(&tabs(&["a", "b"]), "missing"), None);
    }

    #[test]
    fn reorders_to_a_clamped_index() {
        assert_eq!(reorder(&tabs(&["a", "b", "c"]), "a", 9).unwrap(), tabs(&["b", "c", "a"]));
        assert_eq!(reorder(&tabs(&["a", "b", "c"]), "c", 0).unwrap(), tabs(&["c", "a", "b"]));
        assert_eq!(reorder(&tabs(&["a", "b"]), "a", 0), None);
        assert_eq!(reorder(&tabs(&["a", "b"]), "x", 0), None);
    }

    #[test]
    fn cycles_through_a_filtered_set() {
        let all = tabs(&["a", "c", "e"]);
        let id = |tab: Option<&Tab>| tab.map(|tab| tab.session_id.clone());
        assert_eq!(id(cycle(&all, Some("c"), true, |_| true)), Some("e".into()));
        assert_eq!(id(cycle(&all, Some("c"), false, |_| true)), Some("a".into()));
        assert_eq!(id(cycle(&all, Some("e"), true, |_| true)), Some("a".into()));
        assert_eq!(id(cycle(&all, Some("b"), true, |_| true)), Some("a".into()));
        let all = tabs(&["a", "b", "c", "d", "e"]);
        let unread = |tab: &Tab| ["a", "d"].contains(&tab.session_id.as_str());
        assert_eq!(id(cycle(&all, Some("c"), true, unread)), Some("d".into()));
        assert_eq!(id(cycle(&all, Some("c"), false, unread)), Some("a".into()));
        assert_eq!(id(cycle(&all, Some("e"), true, unread)), Some("a".into()));
        assert_eq!(id(cycle(&all, Some("a"), false, unread)), Some("d".into()));
    }

    #[test]
    fn history_moves_back_and_forward() {
        let all = tabs(&["a", "b", "c", "d"]);
        let mut history = history(&["a", "b", "c", "d"]);
        let steps = [
            history.step(&all, Some("d"), false),
            history.step(&all, Some("c"), false),
            history.step(&all, Some("b"), true),
            history.step(&all, Some("c"), true),
        ];
        assert_eq!(steps.map(Option::unwrap), ["c", "b", "c", "d"]);
    }

    #[test]
    fn history_truncates_forward_entries_after_a_new_selection() {
        let all = tabs(&["a", "b", "c", "d"]);
        let mut history = history(&["a", "b", "c"]);
        history.step(&all, Some("c"), false);
        history.record("d");
        assert_eq!(history, History { entries: vec!["a".into(), "b".into(), "d".into()], index: 2 });
        assert_eq!(history.step(&all, Some("d"), true), None);
    }

    #[test]
    fn history_skips_closed_tabs_and_the_active_tab() {
        let mut history = history(&["a", "b", "c", "b"]);
        let before = history.clone();
        history.record("b");
        assert_eq!(history, before);
        assert_eq!(history.step(&tabs(&["a", "b"]), Some("b"), false), Some("a".into()));
    }

    #[test]
    fn history_keeps_the_newest_hundred() {
        let ids: Vec<String> = (0..150).map(|index| format!("session-{index}")).collect();
        let mut history = History::new();
        ids.iter().for_each(|id| history.record(id));
        assert_eq!(history.entries.len(), 100);
        assert_eq!(history.entries[0], "session-50");
        assert_eq!(history.entries[history.index as usize], "session-149");
    }

    #[test]
    fn history_without_an_active_tab_returns_the_latest_entry() {
        assert_eq!(history(&["a", "b"]).step(&tabs(&["a", "b"]), None, false), Some("b".into()));
    }

    #[test]
    fn history_returns_to_the_previous_tab_after_a_close() {
        let mut history = history(&["a", "c"]);
        let (rest, _) = close(&tabs(&["a", "b", "c"]), "b").unwrap();
        history.record("b");
        assert_eq!(history.step(&rest, Some("b"), false), Some("c".into()));
    }

    #[test]
    fn reopens_the_newest_closed_tab_at_its_position() {
        let mut stack = Vec::new();
        record_closed(&mut stack, Tab::new("b", Some("Middle".into())), 1);
        let (tabs_after, session) = reopen(&mut stack, &tabs(&["a", "c"]), None).unwrap();
        assert_eq!(session, "b");
        assert_eq!(tabs_after, [Tab::new("a", None), Tab::new("b", Some("Middle".into())), Tab::new("c", None)]);
        assert!(stack.is_empty());
        assert_eq!(reopen(&mut Vec::new(), &tabs(&["a"]), None), None);
    }

    #[test]
    fn reopens_a_chosen_tab_and_keeps_newer_entries() {
        let mut stack = Vec::new();
        record_closed(&mut stack, Tab::new("b", None), 1);
        record_closed(&mut stack, Tab::new("c", None), 2);
        let full = stack.clone();
        assert_eq!(reopen(&mut stack, &tabs(&["a"]), Some("b")), Some((tabs(&["a", "b"]), "b".into())));
        assert_eq!(stack, [Closed { tab: Tab::new("c", None), index: 2 }]);
        let mut missing = full.clone();
        assert_eq!(reopen(&mut missing, &[], Some("missing")), None);
        assert_eq!(missing, full);
        let mut open_already = full;
        assert_eq!(reopen(&mut open_already, &tabs(&["b"]), Some("b")), None);
        assert_eq!(open_already, [Closed { tab: Tab::new("c", None), index: 2 }]);
    }

    #[test]
    fn reopen_consumes_entries_that_are_open() {
        let mut stack =
            vec![Closed { tab: Tab::new("a", None), index: 0 }, Closed { tab: Tab::new("b", None), index: 1 }];
        assert_eq!(reopen(&mut stack, &tabs(&["b"]), None), Some((tabs(&["a", "b"]), "a".into())));
        assert!(stack.is_empty());
    }

    #[test]
    fn closed_stack_clamps_positions_and_keeps_twenty_five() {
        let mut stack = Vec::new();
        record_closed(&mut stack, Tab::new("a", None), 5);
        record_closed(&mut stack, Tab::new("a", None), 2);
        assert_eq!(stack, [Closed { tab: Tab::new("a", None), index: 2 }]);
        assert_eq!(reopen(&mut stack.clone(), &tabs(&["b"]), None).unwrap().0, tabs(&["b", "a"]));
        (0..27).for_each(|index| record_closed(&mut stack, Tab::new(index.to_string(), None), index));
        assert_eq!(stack.len(), 25);
        assert_eq!(stack.last().unwrap().tab.session_id, "26");
        assert_eq!(stack[0].tab.session_id, "2");
    }

    #[test]
    fn completion_shows_once_work_is_idle() {
        assert!(!complete(Some(Unread::Activity), true));
        assert!(complete(Some(Unread::Activity), false));
        assert!(!complete(Some(Unread::Error), false));
    }

    fn ids(count: usize) -> Vec<String> {
        (0..count).map(|index| index.to_string()).collect()
    }

    fn refs(ids: &[String]) -> Vec<&str> {
        ids.iter().map(String::as_str).collect()
    }

    #[test]
    fn layout_expands_the_active_tab() {
        let all = ["a", "b", "c", "d", "e", "f", "g"];
        let layout = layout(&all, Some("d"), 76, 0);
        assert_eq!((layout.before, layout.after, layout.start, layout.total), (0, 0, 0, 76));
        assert_eq!(layout.widths, [9, 9, 9, 22, 9, 9, 9]);
    }

    #[test]
    fn layout_reserves_the_new_session_slot() {
        let all = ["a", "b", "c", "d", "new"];
        let layout = layout(&all, Some("new"), 54, 0);
        assert_eq!(layout.visible(), 0..5);
        assert_eq!(layout.widths, [8, 8, 8, 8, 22]);
        assert_eq!(layout.widths.iter().sum::<usize>(), layout.total);
    }

    #[test]
    fn layout_window_is_stable_on_home() {
        let all = ids(10);
        let selected = layout(&refs(&all), Some("7"), 70, 0);
        let home = layout(&refs(&all), None, 70, selected.start);
        assert!(selected.start > 0);
        assert_eq!(home.start, selected.start);
    }

    #[test]
    fn layout_swaps_active_widths_in_a_sticky_window() {
        let all = ["a", "b", "c", "d", "e", "f", "g"];
        let before = layout(&all, Some("c"), 76, 0);
        let after = layout(&all, Some("d"), 76, before.start);
        assert_eq!(before.start, after.start);
        assert_eq!(before.widths, [9, 9, 22, 9, 9, 9, 9]);
        assert_eq!(after.widths, [9, 9, 9, 22, 9, 9, 9]);
    }

    #[test]
    fn layout_shares_roomy_width() {
        let before = layout(&["a", "b", "c"], Some("a"), 100, 0);
        assert_eq!(before.widths, [32, 32, 32]);
        assert_eq!(before.total, 96);
        assert_eq!(layout(&["a", "b", "c"], Some("c"), 100, 0).widths, before.widths);
        assert_eq!(layout(&["a"], Some("a"), 100, 0).widths, [32]);
        assert_eq!(layout(&["a", "b", "c", "d"], Some("b"), 100, 0).widths, [25, 25, 25, 25]);
    }

    #[test]
    fn layout_expands_only_the_active_tab_under_pressure() {
        let all = ["a", "b", "c", "d", "e"];
        let before = layout(&all, Some("c"), 100, 0);
        assert_eq!(before.widths, [19, 19, 24, 19, 19]);
        assert_eq!(layout(&all, Some("d"), 100, before.start).widths, [19, 19, 19, 24, 19]);
    }

    #[test]
    fn layout_moves_the_window_once_selection_crosses_its_edge() {
        let all = ids(10);
        let initial = layout(&refs(&all), Some("3"), 70, 0);
        let inside = layout(&refs(&all), Some("4"), 70, initial.start);
        let crossed = layout(&refs(&all), Some("7"), 70, inside.start);
        assert_eq!((initial.start, inside.start), (0, 0));
        assert!(crossed.start > 0);
        assert!(crossed.visible().contains(&7));
        assert_eq!(crossed.widths.iter().sum::<usize>(), crossed.total);
    }
}
