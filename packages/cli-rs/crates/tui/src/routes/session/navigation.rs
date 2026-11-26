//! Navigate between transcript messages, loading earlier history as needed.

use std::collections::HashSet;

use opencode_api::generated::SessionMessageAssistantContentItem;
use opencode_store::LoadMore;

use super::scroll::{Inner, after_layout};

use crate::prelude::*;

#[derive(Clone, Debug, PartialEq)]
pub struct Boundary {
    pub id: String,
    pub y: f64,
    pub top: f64,
}

/// `findMessageBoundary`: the next or previous user message with text, or assistant message with
/// text unless `user_only`, from the one navigation aligned last or from the view's top.
/// `anchors` are the mounted rows' messages and content y, top to bottom.
pub fn find_boundary(
    next: bool,
    anchors: &[(String, f64)],
    messages: &[SessionMessageInfo],
    scroll_top: f64,
    current: Option<&str>,
    user_only: bool,
) -> Option<Boundary> {
    let mut seen = HashSet::new();
    let visible: Vec<Boundary> = anchors
        .iter()
        .filter(|(id, _)| seen.insert(id.as_str()))
        .filter_map(|(id, y)| {
            let message = messages.iter().find(|message| message.id() == id)?;
            let top = match message {
                SessionMessageInfo::User(user) if !user.text.trim().is_empty() => *y,
                SessionMessageInfo::Assistant(assistant) if !user_only => {
                    let text = assistant.content.iter().any(|item| {
                        matches!(item, SessionMessageAssistantContentItem::Text(text) if !text.text.trim().is_empty())
                    });
                    if !text {
                        return None;
                    }
                    (y - 1.0).max(0.0)
                }
                _ => return None,
            };
            Some(Boundary { id: id.clone(), y: *y, top })
        })
        .collect();
    if let Some(index) = current.and_then(|id| visible.iter().position(|item| item.id == id)) {
        let target = if next { index.checked_add(1) } else { index.checked_sub(1) };
        return target.and_then(|index| visible.get(index)).cloned();
    }
    if next {
        return visible.into_iter().find(|item| item.y > scroll_top);
    }
    visible.into_iter().rev().find(|item| item.y < scroll_top)
}

/// The slack that lets a view of `viewport` rows scroll to `top` over `rows` rows.
pub fn slack(top: f64, viewport: f64, rows: f64) -> f64 {
    (top + viewport - rows).ceil().max(0.0)
}

impl super::scroll::Controls {
    pub fn jump(&self, tui: &Tui, id: String) {
        self.0.jump(tui, id);
    }
}

impl Inner {
    /// The next or previous message boundary among the mounted rows. When none is there, the window mounts more rows
    /// that way (dropping rows far on the other side) or loads an older page, and looks again once they are laid out
    /// (`ensureAllRows` mounted every row first).
    pub(super) fn to_message(&self, tui: &Tui, next: bool, user_only: bool) {
        let Some(session) = self.transcript.session() else { return };
        let (_, top) = self.transcript.scroll().scroll_position();
        let anchors = self.transcript.anchors(tui);
        let current = self.navigation.borrow().clone();
        let target = tui
            .data
            .read(|state| find_boundary(next, &anchors, state.messages(&session), top, current.as_deref(), user_only));
        if let Some(target) = target {
            self.align(tui, target.id, target.top);
            return;
        }
        if self.transcript.extend(tui, next) {
            after_layout(
                &tui.app,
                bind!(self.this, |inner| {
                    if let Some(tui) = inner.tui.upgrade() {
                        inner.to_message(&tui, next, user_only);
                    }
                }),
            );
            return;
        }
        if next || !tui.data.read(|state| state.has_more_messages(&session)) {
            return;
        }
        tui.app.spawn(
            tui.data.message_load_more(&session, LoadMore::default()),
            bind!(self.this, |inner, _, result| {
                let Some(tui) = inner.tui.upgrade() else { return };
                match result {
                    Ok(()) => after_layout(&tui.app.clone(), move || inner.to_message(&tui, next, user_only)),
                    Err(error) => tui.toasts.error(error.tui_message()),
                }
            }),
        );
    }

    pub(super) fn last_user(&self, tui: &Tui) {
        let Some(session) = self.transcript.session() else { return };
        let id = tui.data.read(|state| {
            state.messages(&session).iter().rev().find_map(|message| match message {
                SessionMessageInfo::User(user) if !user.text.trim().is_empty() => Some(user.id.0.clone()),
                _ => None,
            })
        });
        if let Some(id) = id {
            self.jump(tui, id);
        }
    }

    /// `jumpToMessage`: aligns the message's first row with the top, one row higher for an
    /// assistant message. The rows around the message mount first, unless they are mounted.
    pub fn jump(&self, tui: &Tui, id: String) {
        if !self.transcript.mount_message(tui, &id) {
            return;
        }
        after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                let Some(tui) = inner.tui.upgrade() else { return };
                let Some(session) = inner.transcript.session() else { return };
                let Some(&(_, y)) = inner.transcript.anchors(&tui).iter().find(|(message, _)| *message == id) else {
                    return;
                };
                let assistant = tui.data.read(|state| {
                    state
                        .messages(&session)
                        .iter()
                        .any(|message| message.id() == id && matches!(message, SessionMessageInfo::Assistant(_)))
                });
                let top = (y - if assistant { 1.0 } else { 0.0 }).max(0.0);
                inner.align(&tui, id, top);
            }),
        );
    }

    /// `alignMessage`: stops following the bottom, adds the slack the target needs, and scrolls once
    /// that is laid out. Short of the newest row, newer rows mount instead of the slack.
    fn align(&self, tui: &Tui, id: String, top: f64) {
        let slack = slack(top, self.height(), self.rows_height());
        if slack > 0.0 && self.transcript.mount_newer(tui) {
            after_layout(
                &tui.app,
                bind!(self.this, |inner| {
                    if let Some(tui) = inner.tui.upgrade() {
                        inner.align(&tui, id, top);
                    }
                }),
            );
            return;
        }
        self.transcript.clear_resize_pin();
        self.navigation.replace(Some(id.clone()));
        self.set_slack(slack);
        self.update_away();
        after_layout(
            &tui.app,
            bind!(self.this, |inner| {
                if inner.navigation.borrow().as_deref() != Some(id.as_str()) {
                    return;
                }
                inner.transcript.scroll().scroll_to(0.0, top);
                inner.update_away();
            }),
        );
    }
}
