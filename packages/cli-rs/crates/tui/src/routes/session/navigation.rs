//! Message navigation (E.8): next and previous message, next and previous user message, the last user
//! message, and jumping to a message (`message-navigation.ts`, `routes/session/index.tsx:845-894,
//! 1224-1271`).

use std::collections::HashSet;

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageInfo};
use opencode_store::{LoadMore, MessageExt};
use opentui::prelude::*;

use super::scroll::{Inner, after_layout};
use crate::app::Tui;

/// A message a jump can land on: its ID, its content y, and the scroll top that aligns it.
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
            Some(Boundary {
                id: id.clone(),
                y: *y,
                top,
            })
        })
        .collect();
    if let Some(index) = current.and_then(|id| visible.iter().position(|item| item.id == id)) {
        let target = if next {
            index.checked_add(1)
        } else {
            index.checked_sub(1)
        };
        return target.and_then(|index| visible.get(index)).cloned();
    }
    if next {
        return visible.into_iter().find(|item| item.y > scroll_top);
    }
    visible.into_iter().rev().find(|item| item.y < scroll_top)
}

/// `messageNavigationSlack`: the space below the rows that lets `top` become the scroll top.
pub fn slack(top: f64, viewport: f64, scroll_height: f64, current: f64) -> f64 {
    (top + viewport - (scroll_height - current)).ceil().max(0.0)
}

impl super::scroll::Controls {
    /// Jumps to a message, as the timeline and fork dialogs do (`onMove`).
    pub fn jump(&self, tui: &Tui, id: String) {
        self.0.jump(tui, id);
    }
}

impl Inner {
    /// `scrollToMessage`: with every row mounted, jumps to the next or previous boundary; at the top,
    /// loads an older page and tries again.
    pub(super) fn to_message(&self, tui: &Tui, next: bool, user_only: bool) {
        let weak = self.this.clone();
        self.ensure_all_rows(tui, move |tui| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(session) = inner.transcript.session() else {
                return;
            };
            let (_, top) = inner.transcript.scroll().scroll_position();
            let anchors = inner.transcript.anchors();
            let current = inner.navigation.borrow().clone();
            let target = tui.data.read(|state| {
                find_boundary(
                    next,
                    &anchors,
                    state.messages(&session),
                    top,
                    current.as_deref(),
                    user_only,
                )
            });
            if let Some(target) = target {
                inner.align(tui, target.id, target.top);
                return;
            }
            if next || !tui.data.read(|state| state.has_more_messages(&session)) {
                return;
            }
            let data = tui.data.clone();
            let weak = inner.this.clone();
            tui.app.spawn(
                async move { data.message_load_more(&session, LoadMore::default()).await },
                move |_, result| {
                    let Some(inner) = weak.upgrade() else { return };
                    let Some(tui) = inner.tui.upgrade() else {
                        return;
                    };
                    match result {
                        Ok(()) => after_layout(&tui.app.clone(), move || {
                            inner.to_message(&tui, next, user_only)
                        }),
                        Err(error) => tui.toasts.error(error.to_string()),
                    }
                },
            );
        });
    }

    /// `session.messages_last_user`: the newest user message with text.
    pub(super) fn last_user(&self, tui: &Tui) {
        let Some(session) = self.transcript.session() else {
            return;
        };
        let id = tui.data.read(|state| {
            state
                .messages(&session)
                .iter()
                .rev()
                .find_map(|message| match message {
                    SessionMessageInfo::User(user) if !user.text.trim().is_empty() => {
                        Some(user.id.0.clone())
                    }
                    _ => None,
                })
        });
        if let Some(id) = id {
            self.jump(tui, id);
        }
    }

    /// `jumpToMessage`: aligns the message's first row with the top, one row higher for an
    /// assistant message.
    pub fn jump(&self, tui: &Tui, id: String) {
        let weak = self.this.clone();
        self.ensure_all_rows(tui, move |tui| {
            let Some(inner) = weak.upgrade() else { return };
            let Some(session) = inner.transcript.session() else {
                return;
            };
            let Some(&(_, y)) = inner
                .transcript
                .anchors()
                .iter()
                .find(|(message, _)| *message == id)
            else {
                return;
            };
            let assistant = tui.data.read(|state| {
                state.messages(&session).iter().any(|message| {
                    message.id() == id && matches!(message, SessionMessageInfo::Assistant(_))
                })
            });
            let top = (y - if assistant { 1.0 } else { 0.0 }).max(0.0);
            inner.align(tui, id, top);
        });
    }

    /// `alignMessage`: stops following the bottom, adds the slack the target needs, and scrolls once
    /// that is laid out.
    fn align(&self, tui: &Tui, id: String, top: f64) {
        self.navigation.replace(Some(id.clone()));
        let scroll = self.transcript.scroll();
        let content = f64::from(scroll.content_view().rect().height);
        let viewport = f64::from(scroll.rect().height);
        self.set_slack(slack(top, viewport, content, self.slack_height.get()));
        self.update_away();
        let weak = self.this.clone();
        after_layout(&tui.app, move || {
            let Some(inner) = weak.upgrade() else { return };
            if inner.navigation.borrow().as_deref() != Some(id.as_str()) {
                return;
            }
            inner.transcript.scroll().scroll_to(0.0, top);
            inner.update_away();
        });
    }

    /// `ensureAllRows`: navigation walks every loaded row, so they mount first.
    fn ensure_all_rows(&self, tui: &Tui, continuation: impl FnOnce(&Tui) + 'static) {
        if self.transcript.all_mounted() {
            continuation(tui);
            return;
        }
        self.transcript.mount_all(tui);
        let weak = self.tui.clone();
        after_layout(&tui.app, move || {
            if let Some(tui) = weak.upgrade() {
                continuation(&tui);
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn boundaries_step_from_the_view_or_the_last_jump() {
        let messages: Vec<SessionMessageInfo> = serde_json::from_value(json!([
            { "id": "msg_1", "type": "user", "text": "one", "time": { "created": 1 } },
            {
                "id": "msg_2", "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": { "created": 2 },
                "content": [{ "type": "text", "text": "reply" }],
            },
            {
                "id": "msg_3", "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": { "created": 3 },
                "content": [{ "type": "reasoning", "text": "no text" }],
            },
            { "id": "msg_4", "type": "user", "text": "two", "time": { "created": 4 } },
        ]))
        .unwrap();
        let anchors: Vec<(String, f64)> = [
            ("msg_1", 1.0),
            ("msg_2", 5.0),
            ("msg_2", 7.0),
            ("msg_3", 9.0),
            ("msg_4", 12.0),
        ]
        .iter()
        .map(|(id, y)| ((*id).to_owned(), *y))
        .collect();
        let id = |boundary: Option<Boundary>| boundary.map(|boundary| (boundary.id, boundary.top));
        // From the view's top; an assistant aligns one row above its first row.
        assert_eq!(
            id(find_boundary(true, &anchors, &messages, 2.0, None, false)),
            Some(("msg_2".into(), 4.0))
        );
        assert_eq!(
            id(find_boundary(false, &anchors, &messages, 12.0, None, false)),
            Some(("msg_2".into(), 4.0))
        );
        // User only skips the reply; a message without text never counts.
        assert_eq!(
            id(find_boundary(true, &anchors, &messages, 2.0, None, true)),
            Some(("msg_4".into(), 12.0))
        );
        // From the last jump, whatever the view.
        assert_eq!(
            id(find_boundary(
                true,
                &anchors,
                &messages,
                0.0,
                Some("msg_2"),
                false
            )),
            Some(("msg_4".into(), 12.0))
        );
        assert_eq!(
            find_boundary(true, &anchors, &messages, 0.0, Some("msg_4"), false),
            None
        );
        assert_eq!(
            find_boundary(false, &anchors, &messages, 0.0, Some("msg_1"), false),
            None
        );
        assert_eq!(slack(30.0, 20.0, 40.0, 0.0), 10.0);
        assert_eq!(slack(30.0, 20.0, 50.0, 10.0), 10.0);
        assert_eq!(slack(5.0, 20.0, 40.0, 0.0), 0.0);
    }
}
