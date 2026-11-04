//! Footer views for requests (`footer.permission.tsx`, `footer.form.tsx`, `footer.subagent.tsx`,
//! `footer.menu.tsx`, `footer.command.tsx`): M.3.
//!
//! M.1 forwards the transcript's request and subagent events here; until M.3 the footer stays on the prompt.

use serde_json::Value;

/// Which view the footer shows (`FooterView`).
#[derive(Clone, Debug, Default, PartialEq)]
pub enum FooterView {
    #[default]
    Prompt,
    Permission(Value),
    Form(Value),
}

/// The request and subagent state of the footer.
#[derive(Debug, Default)]
pub struct Footers {
    view: FooterView,
}

impl Footers {
    /// One event the transcript did not draw: permissions, forms, tools of subagents, the queue.
    pub fn event(&mut self, _event: &Value) -> Option<FooterView> {
        None
    }

    pub fn view(&self) -> &FooterView {
        &self.view
    }

    /// Footer rows the view needs beyond the prompt's, as `applyHeight` adds `PERMISSION_ROWS` and the others.
    pub fn rows(&self) -> Option<u16> {
        None
    }
}
