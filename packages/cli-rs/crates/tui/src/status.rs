//! The footer (T.1): the directory and the event connection status.
//!
//! The TS TUI shows connection trouble with the reconnecting overlay (E.1, row T04); this line is the
//! shell's own status until then.

use opencode_api::events::{State, Status as Phase};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

pub struct Status {
    root: View,
    state: Text,
}

impl Status {
    pub fn new(app: &App, theme: &Theme, directory: &str) -> Self {
        let home = std::env::var("HOME").unwrap_or_default();
        let directory = Text::new(app, opencode_ui::path::abbreviate_home(directory, &home))
            .fg(theme.text.muted)
            .truncate(true);
        let state = Text::new(app, "").fg(theme.text.muted);
        let root = View::new(app)
            .row()
            .shrink(0.0)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 2)
            .justify(Justify::SpaceBetween)
            .gap(2)
            .child(&directory)
            .child(&state);
        Self { root, state }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn set(&self, theme: &Theme, state: &State) {
        let (text, color) = match state.status {
            Phase::Connected => ("● connected".to_owned(), theme.text.feedback.success.base),
            Phase::Connecting => ("○ connecting".to_owned(), theme.text.muted),
            Phase::Reconnecting => (
                format!("○ reconnecting (attempt {})", state.attempt),
                theme.text.feedback.warning.base,
            ),
        };
        self.state.set_text(text).fg(color);
    }
}
