//! Subagent tree and session selection.

use opencode_api::generated::{SessionInfo, SessionInterruptInput};
use opencode_store::SessionStatus;
use opentui::prelude::Container;
use regex::Regex;
use std::sync::LazyLock;

use super::{Inner, Label, RowState, Tab, clamp_offset, empty, row, window};

use crate::prelude::*;

static AGENT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"@([A-Za-z0-9_]+) subagent").expect("valid regex"));

#[derive(Clone, Debug, PartialEq)]
pub(super) struct Entry {
    session: SessionID,
    agent: String,
    title: String,
    running: bool,
    /// Running jobs in its tree. A subagent stays active while any of them runs.
    jobs: Vec<String>,
    current: bool,
    prefix: String,
}

impl Entry {
    fn active(&self) -> bool {
        self.running || !self.jobs.is_empty()
    }
}

#[derive(Default)]
pub(super) struct State {
    entries: Vec<Entry>,
    selected: usize,
    /// Session at the center of the selection.
    centered: Option<SessionID>,
    was_active: bool,
    offset: usize,
}

impl State {
    fn move_to(&mut self, next: usize, center: bool) {
        self.selected = next;
        self.scroll_to_index(next, center);
    }

    fn scroll_to_index(&mut self, index: usize, center: bool) {
        let len = self.entries.len();
        let height = len.min(super::ROWS);
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
    if !inner.is_active(Tab::Subagents) {
        let mut state = inner.subagents.borrow_mut();
        state.entries.clear();
        if state.was_active {
            state.centered = None;
            state.selected = 0;
        }
        state.was_active = false;
        return;
    }
    let filter = tui.composer.active.get();
    let entries = tui
        .data
        .read(|state| {
            let sessions = state.sessions();
            let jobs = state.jobs(&SessionID::from(state.root(&inner.session)));
            family(&sessions, &inner.session)
                .into_iter()
                .map(|(session, prefix)| Entry {
                    jobs: state.owned_jobs(&jobs, &session.id).iter().map(|job| job.id().to_owned()).collect(),
                    ..entry(session, prefix, &inner.session, state.status(&session.id))
                })
                .collect::<Vec<_>>()
        })
        .into_iter()
        .filter(|entry| entry.active() == filter)
        .collect();
    let mut state = inner.subagents.borrow_mut();
    state.entries = entries;
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
    vec![
        inner.command("composer.subagent.up", "Previous subagent", |inner, tui| {
            let selected = inner.subagents.borrow().selected;
            if selected == 0 {
                inner.close(tui);
                return;
            }
            inner.subagents.borrow_mut().move_to(selected - 1, true);
            inner.refresh(tui);
        }),
        inner.command("composer.subagent.down", "Next subagent", |inner, tui| {
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
        inner.command("composer.subagent.select", "Navigate to subagent", |inner, tui| {
            let session = {
                let state = inner.subagents.borrow();
                state.entries.get(state.selected).map(|entry| entry.session.clone())
            };
            if let Some(id) = session {
                tui.navigate(Route::Session { id });
            }
        }),
        inner
            .command("composer.subagent.toggle-activity", "Toggle active subagents", |inner, tui| {
                tui.composer.active.set(!tui.composer.active.get());
                {
                    let mut state = inner.subagents.borrow_mut();
                    state.selected = 0;
                    state.offset = 0;
                }
                inner.refresh(tui);
            })
            .bind(Bind::Key("ctrl+a".to_owned())),
        inner.command("composer.subagent.interrupt", "Interrupt subagent", |inner, tui| {
            let entry = {
                let state = inner.subagents.borrow();
                state.entries.get(state.selected).cloned()
            };
            let Some(entry) = entry else { return };
            let client = tui.data.client().clone();
            let cancels: Vec<_> = entry.jobs.iter().map(|job| tui.data.job_cancel(job)).collect();
            tui.app.runtime().spawn(async move {
                if entry.running {
                    let input = SessionInterruptInput { session_id: entry.session, resume: None };
                    if let Err(error) = client.session_interrupt(&input).await {
                        log::warn!("failed to interrupt the subagent: {error}");
                    }
                }
                for cancel in cancels {
                    if let Err(error) = cancel.await {
                        log::warn!("failed to cancel the subagent's job: {error}");
                    }
                }
            });
        }),
    ]
}

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
            bind!(inner, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                if std::mem::replace(&mut inner.subagents.borrow_mut().selected, index) != index {
                    inner.redraw_later(&tui);
                }
            })
        };
        let click = {
            let id = entry.session.clone();
            bind!(inner, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                inner.subagents.borrow_mut().selected = index;
                let id = id.clone();
                tui.app.defer(bind!(tui, |tui, _| tui.navigate(Route::Session { id })));
            })
        };
        inner.body.add(&row(
            tui,
            theme,
            state,
            Label {
                text: format!("{}{}: {}", entry.prefix, entry.agent, entry.title),
                status: entry.running.then(|| "Running".to_owned()),
                truncate: false,
                gap: 0,
            },
            hover,
            click,
        ));
    }
    let mut hints = Vec::new();
    if entries.get(selected).is_some_and(Entry::active) {
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
        (Some(agent), _) => opencode_ui::tool_info::titlecase(&agent.0),
        (None, Some(found)) => opencode_ui::tool_info::titlecase(&found[1]),
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
        jobs: Vec::new(),
        prefix,
    }
}

/// `sessionFamily`: every descendant of the root of `id`, depth first, each with its tree prefix.
fn family<'a>(sessions: &[&'a SessionInfo], id: &SessionID) -> Vec<(&'a SessionInfo, String)> {
    let Some(current) = sessions.iter().find(|session| session.id == *id) else { return Vec::new() };
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
    // Each session's children in list order, so the walk does not scan every session per descendant.
    let mut children: HashMap<&SessionID, Vec<&'a SessionInfo>> = HashMap::new();
    for session in sessions {
        if let Some(parent) = &session.parent_id {
            children.entry(parent).or_default().push(*session);
        }
    }
    let mut out = Vec::new();
    walk(&children, &root.id, &[], &mut out);
    out
}

fn walk<'a>(
    children: &HashMap<&SessionID, Vec<&'a SessionInfo>>,
    parent: &SessionID,
    ancestors: &[bool],
    out: &mut Vec<(&'a SessionInfo, String)>,
) {
    let group = children.get(parent).map_or(&[][..], Vec::as_slice);
    for (index, session) in group.iter().enumerate() {
        let last = index == group.len() - 1;
        let prefix = if ancestors.is_empty() {
            String::new()
        } else {
            let lines: String = ancestors[1..].iter().map(|ancestor| if *ancestor { "   " } else { "│  " }).collect();
            format!("{lines}{}", if last { "└─ " } else { "├─ " })
        };
        out.push((session, prefix));
        // A repeated parent ID ends the walk.
        if out[..out.len() - 1].iter().any(|(seen, _)| seen.id == session.id) {
            continue;
        }
        let mut next = ancestors.to_vec();
        next.push(last);
        walk(children, &session.id, &next, out);
    }
}
