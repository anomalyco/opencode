//! Prompt drafts (E.2, row P12): one in-progress prompt per session, and one for home, kept across
//! route changes (`component/prompt/draft-stash.ts`). Taking a draft removes it, so a stale copy
//! never shadows newer input.

use crate::prelude::*;

#[derive(Clone, Debug)]
pub struct Draft {
    pub prompt: Value,
    pub cursor: u32,
}

#[derive(Default)]
pub struct Drafts(RefCell<HashMap<Option<SessionID>, Draft>>);

impl Drafts {
    pub fn take(&self, session: Option<&SessionID>) -> Option<Draft> {
        self.0.borrow_mut().remove(&session.cloned())
    }

    pub fn save(&self, session: Option<&SessionID>, draft: Draft) {
        self.0.borrow_mut().insert(session.cloned(), draft);
    }
}
