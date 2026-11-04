//! The background hint (E.6b): `BackgroundToolHint` (`routes/session/index.tsx:1897-1929`). Once a shell or
//! subagent call of the running step has run for three seconds, the transcript ends with how to move it to the
//! background.

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::generated::{
    SessionMessageAssistantContentItem, SessionMessageAssistantToolState, SessionMessageInfo,
};
use opencode_ui::theme::Theme;
use opencode_ui::tool_info::canonical_tool_name;
use opentui::prelude::*;

/// `BACKGROUND_TOOL_HINT_DELAY`, in milliseconds.
const DELAY: f64 = 3_000.0;

pub struct Hint(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    root: View,
    text: Text,
    /// The call the hint is for: `<message>:<call>` and when it started running.
    running: RefCell<Option<(String, f64)>>,
    shortcut: RefCell<Option<String>>,
    shown: Cell<bool>,
    timer: Cell<Option<TimerId>>,
    this: Weak<Inner>,
}

impl Hint {
    pub fn new(app: &App, theme: &Theme) -> Self {
        let text = Text::new(app, "").fg(theme.text.muted);
        let root = View::new(app)
            .margin_edge(Edge::Top, 1)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .visible(false)
            .child(&text);
        Self(Rc::new_cyclic(|this| Inner {
            app: app.clone(),
            theme: theme.clone(),
            root,
            text,
            running: RefCell::default(),
            shortcut: RefCell::default(),
            shown: Cell::new(false),
            timer: Cell::new(None),
            this: this.clone(),
        }))
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// `shortcut` is `session.background`'s key; without one there is no hint.
    pub fn update(&self, messages: &[SessionMessageInfo], shortcut: Option<String>, now: f64) {
        let running = shortcut.as_ref().and_then(|_| running(messages));
        *self.0.shortcut.borrow_mut() = shortcut;
        if *self.0.running.borrow() == running {
            self.0.paint();
            return;
        }
        *self.0.running.borrow_mut() = running.clone();
        if let Some(timer) = self.0.timer.take() {
            self.0.app.cancel_timer(timer);
        }
        self.0.shown.set(false);
        if let Some((_, started)) = running {
            let remaining = (DELAY - (now - started)).max(0.0);
            if remaining <= 0.0 {
                self.0.shown.set(true);
            } else {
                let weak = self.0.this.clone();
                let timer = self
                    .0
                    .app
                    .set_timeout(Duration::from_millis(remaining as u64), move |_| {
                        let Some(inner) = weak.upgrade() else { return };
                        inner.timer.set(None);
                        inner.shown.set(true);
                        inner.paint();
                    });
                self.0.timer.set(Some(timer));
            }
        }
        self.0.paint();
    }
}

impl Drop for Hint {
    fn drop(&mut self) {
        if let Some(timer) = self.0.timer.take() {
            self.0.app.cancel_timer(timer);
        }
    }
}

impl Inner {
    fn paint(&self) {
        let shortcut = self.shortcut.borrow().clone();
        let visible = self.shown.get() && shortcut.is_some();
        self.root.visible(visible);
        if let Some(key) = shortcut.filter(|_| visible) {
            let muted = Style::new().fg(self.theme.text.muted);
            self.text.set_text(vec![
                Span::styled("Press ", muted),
                Span::styled(key, Style::new().fg(self.theme.text.base)),
                Span::styled(" to move running work to the background", muted),
            ]);
        }
    }
}

/// The running shell or subagent call of the newest unfinished step, and when it started running.
fn running(messages: &[SessionMessageInfo]) -> Option<(String, f64)> {
    let current = messages.iter().rev().find_map(|message| match message {
        SessionMessageInfo::Assistant(assistant) if assistant.time.completed.is_none() => {
            Some(assistant)
        }
        _ => None,
    })?;
    current.content.iter().find_map(|item| match item {
        SessionMessageAssistantContentItem::Tool(tool)
            if matches!(tool.state, SessionMessageAssistantToolState::Running(_))
                && matches!(canonical_tool_name(&tool.name), "shell" | "subagent") =>
        {
            Some((
                format!("{}:{}", current.id.as_str(), tool.id),
                tool.time.ran.unwrap_or(tool.time.created),
            ))
        }
        _ => None,
    })
}
