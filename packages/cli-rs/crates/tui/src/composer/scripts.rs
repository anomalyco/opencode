//! Scripts tab: the Code Mode scripts the session runs in the background (`scripts-tab.tsx`).

use opencode_api::generated::{
    JobInfo, SessionMessageAssistantContentItem, SessionMessageAssistantToolState, SessionMessageInfo,
};
use opentui::prelude::Container;

use super::{Inner, Label, RowState, Tab, row, window};

use crate::prelude::*;

#[derive(Clone, Debug, PartialEq)]
struct Entry {
    id: String,
    label: String,
    started: f64,
}

#[derive(Default)]
pub(super) struct State {
    /// The running scripts, read at every refresh: the tab shows while there are any.
    running: Vec<JobInfo>,
    /// Their rows, labelled from the transcript only while the tab shows.
    entries: Vec<Entry>,
    selected: usize,
    offset: usize,
    /// Ticks the elapsed times while the tab shows.
    timer: Option<TimerId>,
}

impl State {
    fn settle(&mut self) {
        let height = self.running.len().min(super::ROWS) as isize;
        let y = self.selected as isize - self.offset as isize;
        if y >= height || y < 0 {
            self.offset = super::clamp_offset(self.offset as isize + y - height / 2, self.running.len());
        }
    }
}

/// The scripts the session runs. They show for the main session only, like desktop.
fn running(inner: &Inner, tui: &Tui) -> Vec<JobInfo> {
    tui.data.read(|state| {
        if state.session(&inner.session).is_some_and(|info| info.parent_id.is_some()) {
            return Vec::new();
        }
        let jobs = state.jobs(&inner.session);
        jobs.into_iter().filter(|job| crate::plugins::host::is_script(job, &inner.session)).cloned().collect()
    })
}

/// Reads the running scripts; true when the tab shows.
pub(super) fn shown(inner: &Rc<Inner>, tui: &Tui) -> bool {
    let running = running(inner, tui);
    let mut state = inner.scripts.borrow_mut();
    if state.selected >= running.len() {
        state.selected = running.len().saturating_sub(1);
    }
    state.running = running;
    !state.running.is_empty()
}

/// Labels the rows while the tab shows, and ticks the elapsed times each second.
pub(super) fn update(inner: &Rc<Inner>, tui: &Tui) {
    let active = inner.is_active(Tab::Scripts);
    let mut state = inner.scripts.borrow_mut();
    if !active {
        state.entries.clear();
        if let Some(timer) = state.timer.take() {
            tui.app.cancel_timer(timer);
        }
        return;
    }
    let running = state.running.clone();
    state.entries = tui.data.read(|data| {
        let messages = data.messages(&inner.session);
        running
            .iter()
            .map(|job| Entry { id: job.id().to_owned(), label: label(messages, job), started: job.time_started() })
            .collect()
    });
    state.settle();
    if state.timer.is_none() {
        state.timer = Some(tui.app.set_interval(
            std::time::Duration::from_secs(1),
            bind!(inner, |inner, _| {
                if let Some(tui) = inner.tui.upgrade() {
                    inner.refresh(&tui);
                }
            }),
        ));
    }
}

pub(super) fn commands(inner: &Rc<Inner>) -> Vec<TuiCommand> {
    vec![
        inner.command("composer.script.up", "Previous script", |inner, tui| {
            {
                let mut state = inner.scripts.borrow_mut();
                if state.selected == 0 {
                    drop(state);
                    inner.close(tui);
                    return;
                }
                state.selected -= 1;
                state.settle();
            }
            inner.refresh(tui);
        }),
        inner.command("composer.script.down", "Next script", |inner, tui| {
            {
                let mut state = inner.scripts.borrow_mut();
                if state.running.is_empty() {
                    return;
                }
                state.selected = (state.selected + 1) % state.running.len();
                state.settle();
            }
            inner.refresh(tui);
        }),
        inner.command("composer.script.cancel", "Cancel script", |inner, tui| {
            let job = {
                let state = inner.scripts.borrow();
                state.running.get(state.selected).map(|job| job.id().to_owned())
            };
            let Some(job) = job else { return };
            let cancel = tui.data.job_cancel(&job);
            tui.app.runtime().spawn(async move {
                if let Err(error) = cancel.await {
                    log::warn!("failed to cancel the script: {error}");
                }
            });
        }),
    ]
}

pub(super) fn draw(inner: &Rc<Inner>, tui: &Tui, theme: &Theme) -> Vec<(String, String)> {
    let (entries, selected, offset) = {
        let state = inner.scripts.borrow();
        (state.entries.clone(), state.selected, state.offset)
    };
    let now = crate::dialogs::session_list::now_ms();
    for index in window(&entries, offset) {
        let entry = &entries[index];
        let hover = bind!(inner, |inner| {
            let Some(tui) = inner.tui.upgrade() else { return };
            if std::mem::replace(&mut inner.scripts.borrow_mut().selected, index) != index {
                inner.redraw_later(&tui);
            }
        });
        inner.body.add(&row(
            tui,
            theme,
            if index == selected { RowState::Focused } else { RowState::Base },
            Label { text: entry.label.clone(), status: Some(elapsed(now - entry.started)), truncate: true, gap: 1 },
            hover,
            || {},
        ));
    }
    if entries.get(selected).is_none() {
        return Vec::new();
    }
    vec![("cancel".to_owned(), tui.keymap.shortcut("composer.script.cancel").unwrap_or_default())]
}

/// Seconds under a minute, else `Locale.duration`.
fn elapsed(ms: f64) -> String {
    let ms = ms.max(0.0);
    if ms < 60_000.0 { format!("{}s", (ms / 1000.0).floor()) } else { opencode_ui::locale::duration(ms) }
}

/// `scriptLabel`: a script moved to the background ends its `execute` call with the job's ID, and its first line
/// of code names it; else the job's title, else "Script".
fn label(messages: &[SessionMessageInfo], job: &JobInfo) -> String {
    let code = messages
        .iter()
        .flat_map(|message| match message {
            SessionMessageInfo::Assistant(message) => message.content.as_slice(),
            _ => &[],
        })
        .filter_map(|part| {
            let SessionMessageAssistantContentItem::Tool(tool) = part else { return None };
            let SessionMessageAssistantToolState::Completed(state) = &tool.state else { return None };
            let owns = state.metadata.as_ref().and_then(|metadata| metadata.get("jobID")).and_then(|id| id.as_str());
            (tool.name == "execute" && owns == Some(job.id())).then(|| state.input.get("code")?.as_str()).flatten()
        })
        .next_back();
    let line = code.and_then(|code| code.split('\n').map(str::trim).find(|line| !line.is_empty()));
    line.or(job.title()).unwrap_or("Script").to_owned()
}
