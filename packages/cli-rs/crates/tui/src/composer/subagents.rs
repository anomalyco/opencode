//! The Subagents tab (`routes/session/composer/subagents-tab.tsx`): the session's family under its root, running or
//! not as the filter says, with the current session marked.

use std::rc::Rc;
use std::sync::LazyLock;

use opencode_api::client::RequestOptions;
use opencode_api::generated::{SessionID, SessionInfo, SessionInterruptInput};
use opencode_store::SessionStatus;
use opencode_ui::keymap::{Bind, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::prelude::Container;
use regex::Regex;

use super::{Inner, Label, RowState, Tab, clamp_offset, empty, row, window};
use crate::app::Tui;
use crate::routes::Route;

static AGENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@([A-Za-z0-9_]+) subagent").expect("valid regex"));

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Entry {
    session: SessionID,
    agent: String,
    title: String,
    running: bool,
    current: bool,
    prefix: String,
}

#[derive(Default)]
pub(super) struct State {
    entries: Vec<Entry>,
    selected: usize,
    /// The session the selection was last centered on (`selectedSessionID`).
    centered: Option<SessionID>,
    was_active: bool,
    offset: usize,
}

impl State {
    fn rows(&self) -> usize {
        self.entries.len().min(super::ROWS)
    }

    /// `moveTo`.
    fn move_to(&mut self, next: usize, center: bool) {
        self.selected = next;
        self.scroll_to_index(next, center);
    }

    /// `scrollToIndex` on a box as tall as its rows, at most five.
    fn scroll_to_index(&mut self, index: usize, center: bool) {
        let len = self.entries.len();
        let height = self.rows();
        if center {
            self.offset = clamp_offset(index as isize - (height / 2) as isize, len);
            return;
        }
        if index >= self.offset + height {
            self.offset = clamp_offset((index + 1) as isize - height as isize, len);
        }
        if index < self.offset {
            self.offset = clamp_offset(index as isize, len);
        }
    }
}

/// The entries the filter keeps, then the tab's effect: center on the current session once per activation, keep the
/// selection in range, and forget it when the tab hides.
pub(super) fn update(inner: &Rc<Inner>, tui: &Tui) {
    let filter = tui.composer.active.get();
    let entries = tui
        .data
        .read(|state| {
            let sessions = state.sessions();
            family(&sessions, &inner.session)
                .into_iter()
                .map(|(session, prefix)| entry(session, prefix, &inner.session, state.status(&session.id)))
                .collect::<Vec<_>>()
        })
        .into_iter()
        .filter(|entry| entry.running == filter)
        .collect();
    let mut state = inner.subagents.borrow_mut();
    state.entries = entries;
    if !inner.is_active(Tab::Subagents) {
        if state.was_active {
            state.centered = None;
            state.selected = 0;
        }
        state.was_active = false;
        return;
    }
    if state.centered.as_ref() != Some(&inner.session) && !state.entries.is_empty() {
        let next = state.entries.iter().position(|entry| entry.current).unwrap_or(0);
        state.centered = Some(inner.session.clone());
        state.selected = next;
        state.scroll_to_index(next, true);
    }
    state.was_active = true;
    if state.selected >= state.entries.len() {
        let last = state.entries.len().saturating_sub(1);
        state.move_to(last, false);
    }
}

pub(super) fn commands(inner: &Rc<Inner>) -> Vec<TuiCommand> {
    let command = |id: &str, title: &str, run: fn(&Rc<Inner>, &Tui)| {
        let weak = Rc::downgrade(inner);
        TuiCommand::new(id, move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(tui) = inner.tui.upgrade() else {
                return;
            };
            run(&inner, &tui);
        })
        .title(title)
        .group("Composer")
    };
    vec![
        command("composer.subagent.up", "Previous subagent", |inner, tui| {
            let selected = inner.subagents.borrow().selected;
            if selected == 0 {
                inner.close(tui);
                return;
            }
            inner.subagents.borrow_mut().move_to(selected - 1, true);
            inner.refresh(tui);
        }),
        command("composer.subagent.down", "Next subagent", |inner, tui| {
            {
                let mut state = inner.subagents.borrow_mut();
                if state.entries.is_empty() {
                    return;
                }
                let next = (state.selected + 1) % state.entries.len();
                state.move_to(next, true);
            }
            inner.refresh(tui);
        }),
        command("composer.subagent.select", "Navigate to subagent", |inner, tui| {
            let session = {
                let state = inner.subagents.borrow();
                state.entries.get(state.selected).map(|entry| entry.session.clone())
            };
            if let Some(id) = session {
                tui.navigate(Route::Session { id });
            }
        }),
        command("composer.subagent.toggle-activity", "Toggle active subagents", |inner, tui| {
            tui.composer.active.set(!tui.composer.active.get());
            {
                let mut state = inner.subagents.borrow_mut();
                state.selected = 0;
                state.offset = 0;
            }
            inner.refresh(tui);
        })
        .bind(Bind::Key("ctrl+a".to_owned())),
        command("composer.subagent.interrupt", "Interrupt subagent", |inner, tui| {
            let session = {
                let state = inner.subagents.borrow();
                state.entries.get(state.selected).filter(|entry| entry.running).map(|entry| entry.session.clone())
            };
            let Some(session) = session else { return };
            let client = tui.data.client().clone();
            tui.app.runtime().spawn(async move {
                let input = SessionInterruptInput { session_id: session, resume: None };
                if let Err(error) = client.session_interrupt(&input, &RequestOptions::default()).await {
                    log::warn!("failed to interrupt the subagent: {error}");
                }
            });
        }),
    ]
}

/// The list; returns the footer hints.
pub(super) fn draw(inner: &Rc<Inner>, tui: &Tui, theme: &Theme) -> Vec<(String, String)> {
    let filter = tui.composer.active.get();
    let (entries, selected, offset) = {
        let state = inner.subagents.borrow();
        (state.entries.clone(), state.selected, state.offset)
    };
    if entries.is_empty() {
        let label = if filter { "active" } else { "inactive" };
        inner.body.add(&empty(tui, theme, format!(" No {label} subagents")));
    }
    for index in window(&entries, offset) {
        let entry = &entries[index];
        let state = if index == selected {
            RowState::Focused
        } else if entry.current {
            RowState::Selected
        } else {
            RowState::Base
        };
        let hover = {
            let weak = Rc::downgrade(inner);
            move || {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                if std::mem::replace(&mut inner.subagents.borrow_mut().selected, index) != index {
                    inner.redraw_later(&tui);
                }
            }
        };
        let click = {
            let weak = Rc::downgrade(inner);
            let id = entry.session.clone();
            move || {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                inner.subagents.borrow_mut().selected = index;
                let id = id.clone();
                let weak = tui.weak();
                tui.app.defer(move |_| {
                    if let Some(tui) = weak.upgrade() {
                        tui.navigate(Route::Session { id });
                    }
                });
            }
        };
        inner.body.add(&row(
            tui,
            theme,
            state,
            Label {
                text: format!("{}{}: {}", entry.prefix, entry.agent, entry.title),
                status: entry.running.then(|| "Running".to_owned()),
                truncate: false,
            },
            hover,
            click,
        ));
    }
    let mut hints = Vec::new();
    if entries.get(selected).is_some_and(|entry| entry.running) {
        hints.push(("interrupt".to_owned(), tui.keymap.shortcut("composer.subagent.interrupt").unwrap_or_default()));
    }
    hints.push((
        format!("show {}", if filter { "inactive" } else { "active" }),
        tui.keymap.shortcut("composer.subagent.toggle-activity").unwrap_or_default(),
    ));
    hints
}

fn entry(session: &SessionInfo, prefix: String, current: &SessionID, status: SessionStatus) -> Entry {
    let title = crate::dialogs::session_list::title(session);
    let found = AGENT.captures(&title);
    let agent = match (&session.agent, &found) {
        (Some(agent), _) => opencode_ui::confirm::titlecase(&agent.0),
        (None, Some(found)) => opencode_ui::confirm::titlecase(&found[1]),
        (None, None) => "Subagent".to_owned(),
    };
    let title = match &found {
        Some(found) => {
            let stripped = title.replacen(&found[0], "", 1).trim().to_owned();
            if stripped.is_empty() { title } else { stripped }
        }
        None => title,
    };
    Entry {
        current: session.id == *current,
        session: session.id.clone(),
        agent,
        title,
        running: status == SessionStatus::Running,
        prefix,
    }
}

/// `sessionFamily`: every descendant of the root of `id`, depth first, each with its tree prefix.
fn family<'a>(sessions: &[&'a SessionInfo], id: &SessionID) -> Vec<(&'a SessionInfo, String)> {
    let Some(current) = sessions.iter().find(|session| session.id == *id) else {
        return Vec::new();
    };
    let mut root = *current;
    let mut seen = vec![root.id.clone()];
    while let Some(parent) =
        root.parent_id.as_ref().and_then(|parent| sessions.iter().find(|session| session.id == *parent))
    {
        if seen.contains(&parent.id) {
            break;
        }
        seen.push(parent.id.clone());
        root = parent;
    }
    let mut out = Vec::new();
    walk(sessions, &root.id, &[], &mut out);
    out
}

fn walk<'a>(
    sessions: &[&'a SessionInfo],
    parent: &SessionID,
    ancestors: &[bool],
    out: &mut Vec<(&'a SessionInfo, String)>,
) {
    let group: Vec<_> = sessions.iter().filter(|session| session.parent_id.as_ref() == Some(parent)).collect();
    for (index, session) in group.iter().enumerate() {
        let last = index == group.len() - 1;
        let prefix = if ancestors.is_empty() {
            String::new()
        } else {
            let lines: String = ancestors[1..].iter().map(|ancestor| if *ancestor { "   " } else { "│  " }).collect();
            format!("{lines}{}", if last { "└─ " } else { "├─ " })
        };
        out.push((session, prefix));
        // A cycle in `parentID` would recurse forever; TS has the same walk, so stop at a session already listed.
        if out[..out.len() - 1].iter().any(|(seen, _)| seen.id == session.id) {
            continue;
        }
        let mut next = ancestors.to_vec();
        next.push(last);
        walk(sessions, &session.id, &next, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn session(id: &str, parent: Option<&str>, title: &str, updated: f64) -> SessionInfo {
        serde_json::from_value(json!({
            "id": id,
            "parentID": parent,
            "title": title,
            "projectID": "proj",
            "cost": 0,
            "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "time": { "created": updated, "updated": updated },
            "location": { "directory": "/repo" },
        }))
        .unwrap()
    }

    #[test]
    fn the_family_walks_depth_first_with_tree_prefixes() {
        let sessions = [
            session("root", None, "Root", 9.0),
            session("a", Some("root"), "A", 8.0),
            session("a1", Some("a"), "A1", 7.0),
            session("a1x", Some("a1"), "A1x", 6.5),
            session("a2", Some("a"), "A2", 6.0),
            session("b", Some("root"), "B", 5.0),
            session("b1", Some("b"), "B1", 4.0),
        ];
        let refs: Vec<&SessionInfo> = sessions.iter().collect();
        let walked: Vec<(String, String)> = family(&refs, &SessionID("a1".into()))
            .into_iter()
            .map(|(session, prefix)| (session.id.0.clone(), prefix))
            .collect();
        let expected = [("a", ""), ("a1", "├─ "), ("a1x", "│  └─ "), ("a2", "└─ "), ("b", ""), ("b1", "└─ ")];
        assert_eq!(walked, expected.map(|(id, prefix)| (id.to_owned(), prefix.to_owned())));
    }

    #[test]
    fn entries_take_the_agent_from_the_session_or_the_title() {
        let current = SessionID("x".into());
        let titled = session("a", Some("root"), "Find the parser (@explore subagent)", 1.0);
        let found = entry(&titled, String::new(), &current, SessionStatus::Running);
        assert_eq!(
            (found.agent.as_str(), found.title.as_str(), found.running),
            ("Explore", "Find the parser ()", true)
        );
        let mut named = session("b", Some("root"), "Review", 1.0);
        named.agent = Some(opencode_api::generated::AgentID("code-review".into()));
        let found = entry(&named, String::new(), &current, SessionStatus::Idle);
        assert_eq!((found.agent.as_str(), found.title.as_str()), ("Code-Review", "Review"));
        let bare = session("x", Some("root"), "@general subagent", 1.0);
        let found = entry(&bare, String::new(), &current, SessionStatus::Idle);
        assert_eq!((found.agent.as_str(), found.title.as_str(), found.current), ("General", "@general subagent", true));
        let plain = session("c", Some("root"), "Plain", 1.0);
        assert_eq!(entry(&plain, String::new(), &current, SessionStatus::Idle).agent, "Subagent");
    }
}
