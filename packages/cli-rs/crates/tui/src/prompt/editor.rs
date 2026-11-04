//! The prompt editor and `input.*` editing (E.2). T.1's stand-in is a read-only line; E.2 replaces
//! [`Prompt`] and puts its textarea in `Tui::textarea` while it has focus.

use opencode_api::generated::SessionID;
use opencode_store::Changes;
use opentui::prelude::*;

use crate::app::Tui;

pub struct Prompt {
    root: View,
}

impl Prompt {
    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn sync(&self, _tui: &Tui, _changes: &Changes) {}

    pub fn focus(&self, _tui: &Tui) {}
}

pub fn mount(tui: &Tui, _session: &SessionID) -> Prompt {
    let theme = tui.page();
    let hint = Text::new(&tui.app, "Read only: the prompt is not built yet").fg(theme.text.muted);
    let root = View::new(&tui.app)
        .column()
        .shrink(0.0)
        .padding_edge(Edge::Bottom, 1)
        .child(&hint);
    Prompt { root }
}
