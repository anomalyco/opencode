//! The footer prompt (`footer.prompt.tsx`, `runtime.queue.ts`): M.2.
//!
//! M.1's version is a one-line input with the composer's rail that submits its text. M.2 replaces the body
//! (slash commands, autocomplete, mentions, shell mode, history, the editor, the queue) behind these signatures.

use std::cell::RefCell;
use std::rc::Rc;

use opentui::prelude::*;

use crate::theme::RunTheme;

/// What the prompt submits (`RunPrompt`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RunPrompt {
    pub message_id: Option<String>,
    pub text: String,
    /// File, agent, and skill mentions as the server takes them.
    pub parts: Vec<serde_json::Value>,
    pub delivery: Option<String>,
    pub shell: bool,
}

/// The words that close mini instead of sending (`footer.prompt.tsx`).
pub const EXIT_WORDS: [&str; 4] = ["exit", "quit", "/exit", "/quit"];

/// `TEXTAREA_MIN_ROWS`.
pub const MIN_ROWS: u16 = 1;

type Submit = Rc<RefCell<Option<Box<dyn FnMut(&mut Cx<'_>, RunPrompt)>>>>;

/// The composer in the footer.
#[derive(Clone)]
pub struct Prompt {
    root: View,
    input: Input,
    submit: Submit,
    mono: bool,
}

impl Prompt {
    pub fn new(app: &App, theme: &RunTheme, mono: bool) -> Self {
        let input = Input::new(app)
            .grow(1.0)
            .placeholder_color(theme.footer.muted);
        let root = View::new(app)
            .direction(FlexDirection::Row)
            .height(u32::from(MIN_ROWS))
            .child(&Text::new(app, if mono { "| " } else { "┃ " }).fg(theme.footer.border))
            .child(&input);
        let submit: Submit = Rc::default();
        input.on_submit({
            let (submit, input) = (submit.clone(), input.clone());
            move |cx, value| {
                if value.trim().is_empty() {
                    return;
                }
                let prompt = RunPrompt {
                    message_id: Some(opencode_api::id::message()),
                    text: value.to_owned(),
                    ..RunPrompt::default()
                };
                input.set_value("");
                if let Some(handler) = submit.borrow_mut().as_mut() {
                    handler(cx, prompt);
                }
            }
        });
        let prompt = Self {
            root,
            input,
            submit,
            mono,
        };
        prompt.set_first(true);
        prompt
    }

    /// The widget to place in the footer.
    pub fn root(&self) -> &View {
        &self.root
    }

    /// Calls `handler` with each submitted prompt.
    pub fn on_submit(&self, handler: impl FnMut(&mut Cx<'_>, RunPrompt) + 'static) {
        *self.submit.borrow_mut() = Some(Box::new(handler));
    }

    pub fn focus(&self) {
        self.input.focus();
    }

    pub fn value(&self) -> String {
        self.input.value()
    }

    /// Clears the draft (`handleInputClear`).
    pub fn clear(&self) {
        self.input.set_value("");
    }

    /// Rows the composer needs (`onRows`).
    pub fn rows(&self) -> u16 {
        MIN_ROWS
    }

    /// The session's earlier prompts, for history (`history` event).
    pub fn set_history(&self, _history: Vec<RunPrompt>) {}

    pub fn set_theme(&self, _theme: &RunTheme) {}

    /// A session without prompts shows the composer's hint (`first`).
    pub fn set_first(&self, first: bool) {
        let hint = if first {
            if self.mono {
                "Ask anything, / for commands, @ for context..."
            } else {
                "Ask anything, / for commands, @ for context…"
            }
        } else {
            ""
        };
        self.input.placeholder(hint);
    }
}

/// Whether `text` is one of the exit words.
pub fn is_exit(text: &str) -> bool {
    EXIT_WORDS.contains(&text.trim())
}
