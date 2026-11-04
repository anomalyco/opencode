//! Prompt drafts (E.2, row P12): one in-progress prompt per session, and one for home, kept across
//! route changes (`component/prompt/draft-stash.ts`). Taking a draft removes it, so a stale copy
//! never shadows newer input.

use std::cell::RefCell;
use std::collections::HashMap;

use opencode_api::generated::SessionID;
use serde_json::Value;

/// A saved prompt and its cursor.
#[derive(Clone, Debug)]
pub struct Draft {
    /// The `PromptInfo` shape history uses.
    pub prompt: Value,
    pub cursor: u32,
}

/// Drafts by session; `None` is home.
#[derive(Default)]
pub struct Drafts(RefCell<HashMap<Option<SessionID>, Draft>>);

impl Drafts {
    /// `takeDraft`.
    pub fn take(&self, session: Option<&SessionID>) -> Option<Draft> {
        self.0.borrow_mut().remove(&session.cloned())
    }

    /// `saveDraft`.
    pub fn save(&self, session: Option<&SessionID>, draft: Draft) {
        self.0.borrow_mut().insert(session.cloned(), draft);
    }
}
