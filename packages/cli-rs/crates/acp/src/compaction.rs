//! Compaction progress as ACP updates (`packages/cli/src/acp/compaction.ts`).
//!
//! C.12 (`rs-acp-rest`) owns this file. C.11 left the signatures the turn translation calls; the
//! bodies report nothing yet, so a compaction shows only as its turn's text.

use std::collections::HashMap;

use serde_json::Value;

/// A compaction that started and has not ended.
#[derive(Debug, Clone, PartialEq)]
pub struct Started {
    pub message_id: String,
    pub reason: String,
}

/// Open compactions by session ID.
pub type Tracked = HashMap<String, Started>;

// Without child updates, a child's standard update would read as the parent's own.
pub fn uses_standard_updates(compaction: bool, child_updates: bool, child: bool) -> bool {
    compaction && (!child || child_updates)
}

/// Applies a `session.compaction.started`, `ended`, or `failed` event.
pub fn apply(_event: &Value, tracked: &Tracked, _standard_updates: bool) -> (Tracked, Vec<Value>) {
    (tracked.clone(), Vec::new())
}

/// The update for a `session.compaction.delta`.
pub fn chunk(_started: Option<&Started>, _text: &str, _standard_updates: bool) -> Option<Value> {
    None
}

/// The update that ends a compaction a cancelled turn left open.
pub fn abandon(_started: &Started, _standard_updates: bool) -> Option<Value> {
    None
}
