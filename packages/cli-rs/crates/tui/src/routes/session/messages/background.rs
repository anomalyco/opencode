//! Offer to background a running shell after three seconds. Subagents already run in the background.

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageAssistantToolState};
use opencode_ui::tool_info::ToolKind;

use crate::prelude::*;

const DELAY: f64 = 3_000.0;

pub struct Hint(Rc<Inner>);

struct Inner {
    app: App,
    theme: RefCell<Theme>,
    root: View,
    text: Text,
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
            theme: RefCell::new(theme.clone()),
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

    pub fn restyle(&self, theme: &Theme) {
        *self.0.theme.borrow_mut() = theme.clone();
        self.0.text.fg(theme.text.muted);
        self.0.paint();
    }

    /// `shortcut` is `session.background`'s key; without one there is no hint.
    pub fn update(&self, messages: &[SessionMessageInfo], shortcut: Option<&str>, now: f64) {
        let running = shortcut.and_then(|_| running(messages));
        if self.0.shortcut.borrow().as_deref() != shortcut {
            *self.0.shortcut.borrow_mut() = shortcut.map(str::to_owned);
        }
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
                let timer = self.0.app.set_timeout(
                    Duration::from_millis(remaining as u64),
                    bind!(self.0.this, |inner, _| {
                        inner.timer.set(None);
                        inner.shown.set(true);
                        inner.paint();
                    }),
                );
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
        let shortcut = self.shortcut.borrow();
        let visible = self.shown.get() && shortcut.is_some();
        self.root.visible(visible);
        if let Some(key) = shortcut.as_deref().filter(|_| visible) {
            let theme = self.theme.borrow();
            let muted = Style::new().fg(theme.text.muted);
            self.text.set_text(vec![
                Span::styled("Press ", muted),
                Span::styled(key.to_owned(), Style::new().fg(theme.text.base)),
                Span::styled(" to move running work to the background", muted),
            ]);
        }
    }
}

fn running(messages: &[SessionMessageInfo]) -> Option<(String, f64)> {
    let current = messages.iter().rev().find_map(|message| match message {
        SessionMessageInfo::Assistant(assistant) if assistant.time.completed.is_none() => Some(assistant),
        _ => None,
    })?;
    current.content.iter().find_map(|item| match item {
        SessionMessageAssistantContentItem::Tool(tool)
            if matches!(tool.state, SessionMessageAssistantToolState::Running(_))
                && ToolKind::of(&tool.name) == ToolKind::Shell =>
        {
            Some((format!("{}:{}", current.id.as_str(), tool.id), tool.time.ran.unwrap_or(tool.time.created)))
        }
        _ => None,
    })
}
