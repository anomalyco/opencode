//! Tab model operations return `None` for unchanged lists so callers can skip a write.

use serde::{Deserialize, Serialize};

pub const NEW_SESSION_TAB_TITLE: &str = "New session";
pub const SESSION_TAB_WIDTH: usize = 22;
pub const SESSION_TAB_MAX_WIDTH: usize = 32;
pub const SESSION_TAB_MIN_WIDTH: usize = 8;
const CLOSED_SESSION_TAB_LIMIT: usize = 25;
const SESSION_TAB_HISTORY_LIMIT: usize = 100;

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

pub fn complete(unread: Option<Unread>, busy: bool) -> bool {
    unread == Some(Unread::Activity) && !busy
}

pub fn overflow_width(count: usize) -> usize {
    count.to_string().len() + 2
}

pub fn detail(project: &str, current: Option<&str>, default: Option<&str>, worktree: bool) -> String {
    let branch = current.filter(|current| worktree && Some(*current) != default);
    match branch {
        Some(branch) if !project.is_empty() => format!("{project} ⎇ {branch}"),
        Some(branch) => branch.to_owned(),
        None => project.to_owned(),
    }
}

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

/// `closeSessionTab`: the tabs without `session` (`None` when it is not open), and the tab to select next (right,
/// then left). Another TUI sharing the tab list may already have closed the tab, so its last known index still
/// picks the neighbour that took its place.
pub fn close(tabs: &[Tab], session: &str, last_index: Option<usize>) -> (Option<Vec<Tab>>, Option<String>) {
    let Some(index) = tabs.iter().position(|tab| tab.session_id == session) else {
        let next = last_index.and_then(|index| tabs.get(index.min(tabs.len().saturating_sub(1))));
        return (None, next.map(|tab| tab.session_id.clone()));
    };
    let next = tabs
        .get(index + 1)
        .or_else(|| index.checked_sub(1).and_then(|before| tabs.get(before)))
        .map(|tab| tab.session_id.clone());
    (Some(tabs.iter().filter(|tab| tab.session_id != session).cloned().collect()), next)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Closed {
    pub tab: Tab,
    pub index: usize,
}

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
    /// `-1` before the first history entry.
    pub index: isize,
}

impl History {
    pub fn new() -> Self {
        Self { entries: Vec::new(), index: -1 }
    }

    fn at(&self, index: isize) -> Option<&String> {
        usize::try_from(index).ok().and_then(|index| self.entries.get(index))
    }

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

    pub fn step(&mut self, tabs: &[Tab], active: Option<&str>, forward: bool) -> Option<String> {
        let open = |session: &str| tabs.iter().any(|tab| tab.session_id == session);
        let Some(active) = active else { return self.at(self.index).filter(|session| open(session)).cloned() };
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
        // An overfull strip can exhaust the active width; drawing still reserves one cell.
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
    fn closing_and_reopening_any_tab_restores_its_position_and_title() {
        let tabs: Vec<_> = (0..8).map(|i| Tab::new(i.to_string(), Some(format!("Session {i}")))).collect();
        for count in 1..=tabs.len() {
            let tabs = &tabs[..count];
            for (i, tab) in tabs.iter().enumerate() {
                let (rest, next) = close(tabs, &tab.session_id, None);
                let rest = rest.unwrap();
                let neighbour = tabs.get(i + 1).or_else(|| tabs.get(i.wrapping_sub(1))).map(|t| t.session_id.clone());
                assert_eq!(next, neighbour);
                assert_eq!(close(&rest, &tab.session_id, Some(i)), (None, neighbour));
                assert_eq!(close(&rest, &tab.session_id, None), (None, None));
                let mut stack = Vec::new();
                record_closed(&mut stack, tab.clone(), i);
                assert_eq!(reopen(&mut stack, &rest, None), Some((tabs.to_vec(), tab.session_id.clone())));
                assert_eq!(reopen(&mut stack, &rest, None), None);
            }
        }
    }

    #[test]
    fn completion_shows_once_work_is_idle() {
        assert!(!complete(Some(Unread::Activity), true));
        assert!(complete(Some(Unread::Activity), false));
        assert!(!complete(Some(Unread::Error), false));
    }

    #[test]
    fn the_tab_window_fits_the_strip_and_tracks_selection() {
        let names: Vec<_> = (0..12).map(|i| i.to_string()).collect();
        let names: Vec<_> = names.iter().map(String::as_str).collect();
        for n in 1..=names.len() {
            let tabs = &names[..n];
            for width in 8..=128 {
                let mut previous = 0;
                for i in (0..n).chain((0..n).rev()) {
                    let view = layout(tabs, Some(tabs[i]), width, previous);
                    assert!(view.visible().contains(&i));
                    assert_eq!((view.before, view.after), (view.start, n - view.visible().end));
                    let markers: usize =
                        [view.before, view.after].into_iter().filter(|&n| n > 0).map(overflow_width).sum();
                    let room = (width as usize).saturating_sub(markers).max(1);
                    let count = view.widths.len();
                    assert_eq!(view.total, room.min(count * SESSION_TAB_MAX_WIDTH));
                    assert_eq!(view.widths.iter().sum::<usize>(), view.total);
                    if room >= count * SESSION_TAB_WIDTH {
                        assert!(view.widths.windows(2).all(|w| w[0] >= w[1]));
                        assert!(view.widths[0] - view.widths[count - 1] <= 1);
                    } else if count > 1 {
                        let active = view.widths[i - view.start];
                        assert!(active >= SESSION_TAB_WIDTH);
                        let mut others = view.widths.iter().enumerate().filter(|(j, _)| *j != i - view.start);
                        let (_, w) = others.next().unwrap();
                        assert!(others.all(|(_, other)| other == w));
                        assert!(active - SESSION_TAB_WIDTH < count - 1);
                    }
                    previous = view.start;
                }
            }
        }
    }

    #[test]
    fn moving_inside_the_window_or_returning_home_keeps_its_start() {
        let tabs = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "new"];
        let selected = layout(&tabs, Some("h"), 70, 0);
        assert!(selected.start > 0);
        for i in selected.visible() {
            let inside = layout(&tabs, Some(tabs[i]), 70, selected.start);
            assert_eq!(inside.start, selected.start);
        }
        assert_eq!(layout(&tabs, None, 70, selected.start).start, selected.start);
    }

    /// A seeded walk of opens, closes, reopens, moves, cycles and history steps, against what each must leave: every tab
    /// shows once with its newest title, a closed tab reopens where it was, a move lands at its clamped index, a cycle
    /// takes the next tab around the strip that its filter takes, the closed stack and the history stay bounded, a new
    /// selection drops the forward history, and a step lands on the nearest open entry in its direction other than the
    /// active tab.
    #[test]
    fn any_walk_of_tab_operations_keeps_the_strip_the_stack_and_the_history_consistent() {
        let mut rng = opencode_util::rng::SplitMix64(7);
        for case in 0..400 {
            let (mut tabs, mut stack, mut history, mut active) = (Vec::<Tab>::new(), Vec::new(), History::new(), None);
            let steps = if case % 10 == 0 { 400 } else { 60 };
            for step in 0..steps {
                let at = format!("case {case} step {step}: {tabs:?} {history:?}");
                let id = format!("s{}", rng.below(40));
                match rng.below(7) {
                    0 | 1 => {
                        let title = Some(format!("T{}", rng.below(3)));
                        let count = tabs.len() + usize::from(!tabs.iter().any(|tab| tab.session_id == id));
                        if let Some(next) = open(&tabs, Tab::new(id.clone(), title.clone())) {
                            tabs = next;
                        }
                        assert_eq!(tabs.len(), count, "{at}");
                        assert!(tabs.iter().any(|tab| tab.session_id == id && tab.title == title), "{at}");
                        select(&mut history, &mut active, &tabs, &id);
                    }
                    2 if !tabs.is_empty() => {
                        let index = rng.below(tabs.len() as u64) as usize;
                        let tab = tabs[index].clone();
                        let (rest, next) = close(&tabs, &tab.session_id, None);
                        let rest = rest.unwrap();
                        assert!(rest.iter().all(|open| open.session_id != tab.session_id), "{at}");
                        record_closed(&mut stack, tab.clone(), index);
                        if rng.below(2) == 0 {
                            assert_eq!(reopen(&mut stack, &rest, None), Some((tabs.clone(), tab.session_id)), "{at}");
                            continue;
                        }
                        tabs = rest;
                        if active.as_deref() == Some(tab.session_id.as_str()) {
                            active = None;
                            if let Some(next) = next {
                                select(&mut history, &mut active, &tabs, &next);
                            }
                        }
                    }
                    3 if !stack.is_empty() && rng.below(2) == 0 => {
                        // A chosen closed tab comes back at its index, clamped to the strip, unless it is open again.
                        let entry = stack[rng.below(stack.len() as u64) as usize].clone();
                        let id = entry.tab.session_id.clone();
                        let shown = tabs.iter().any(|tab| tab.session_id == id);
                        let reopened = reopen(&mut stack, &tabs, Some(&id));
                        assert!(stack.iter().all(|left| left.tab.session_id != id), "{at}");
                        match reopened {
                            Some((next, back)) => {
                                assert!(!shown && back == id, "{at}");
                                assert_eq!(next[entry.index.min(tabs.len())], entry.tab, "{at}");
                                tabs = next;
                                select(&mut history, &mut active, &tabs, &id);
                            }
                            None => assert!(shown, "{at}"),
                        }
                    }
                    3 => {
                        if let Some((next, id)) = reopen(&mut stack, &tabs, None) {
                            assert!(
                                tabs.iter().all(|tab| tab.session_id != id) && next.len() == tabs.len() + 1,
                                "{at}"
                            );
                            tabs = next;
                            select(&mut history, &mut active, &tabs, &id);
                        }
                    }
                    4 if !tabs.is_empty() => {
                        let session = tabs[rng.below(tabs.len() as u64) as usize].session_id.clone();
                        let to = rng.below(tabs.len() as u64 + 2) as usize;
                        if let Some(next) = reorder(&tabs, &session, to) {
                            tabs = next;
                        }
                        assert_eq!(tabs[to.min(tabs.len() - 1)].session_id, session, "{at}");
                    }
                    5 if !tabs.is_empty() => {
                        // The next tab, around the strip, that the filter takes: the active one last.
                        let (forward, count) = (rng.below(2) == 0, tabs.len());
                        let wanted = |tab: &Tab| tab.title.as_deref() != Some("T0");
                        let position =
                            active.as_deref().and_then(|id| tabs.iter().position(|tab| tab.session_id == id));
                        let start = position.unwrap_or(if forward { count - 1 } else { 0 });
                        let expected =
                            (1..=count)
                                .map(|step| {
                                    if forward {
                                        (start + step) % count
                                    } else {
                                        (start + count - step % count) % count
                                    }
                                })
                                .map(|index| &tabs[index])
                                .find(|tab| wanted(tab));
                        assert_eq!(cycle(&tabs, active.as_deref(), forward, wanted), expected, "{at}");
                    }
                    _ => {
                        let forward = rng.below(2) == 0;
                        let open = |id: &&String| tabs.iter().any(|tab| tab.session_id == **id);
                        let index = history.index;
                        let expected = match &active {
                            None => usize::try_from(index).ok().and_then(|at| history.entries.get(at)).filter(open),
                            Some(active) => {
                                let other = |id: &&String| *id != active && open(id);
                                match forward {
                                    true => history.entries.iter().skip((index + 1).max(0) as usize).find(other),
                                    false => history.entries[..index.max(0) as usize].iter().rev().find(other),
                                }
                            }
                        }
                        .cloned();
                        let landed = history.step(&tabs, active.as_deref(), forward);
                        assert_eq!(landed, expected, "{at}");
                        if landed.is_some() {
                            active = landed;
                        }
                    }
                }
                let ids: std::collections::HashSet<_> = tabs.iter().map(|tab| &tab.session_id).collect();
                assert_eq!(ids.len(), tabs.len(), "{at}");
                let closed: std::collections::HashSet<_> = stack.iter().map(|entry| &entry.tab.session_id).collect();
                assert!(closed.len() == stack.len() && stack.len() <= 25, "{at}");
                assert!(history.entries.len() <= 100 && history.index < history.entries.len() as isize, "{at}");
            }
        }

        /// Selecting `id` records it last, unless it is the current entry, and leaves nothing to step forward to.
        fn select(history: &mut History, active: &mut Option<String>, tabs: &[Tab], id: &str) {
            let current = usize::try_from(history.index).ok().and_then(|at| history.entries.get(at));
            let fresh = current.map(String::as_str) != Some(id);
            history.record(id);
            *active = Some(id.to_owned());
            if fresh {
                assert_eq!(history.entries.last().map(String::as_str), Some(id));
                assert_eq!(history.step(tabs, Some(id), true), None);
            }
        }
    }
}
