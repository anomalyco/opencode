//! The client capabilities the agent acts on (`packages/cli/src/acp/capabilities.ts`).

use serde_json::Value;

pub const CHILD_SESSION_UPDATES: &str = "opencode/child-session-updates";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub child_session_updates: bool,
    pub form_elicitation: bool,
    pub compaction: bool,
}

pub fn parse(client: Option<&Value>) -> Capabilities {
    let present = |value: Option<&Value>| value.is_some_and(|value| !value.is_null());
    let Some(client) = client else {
        return Capabilities::default();
    };
    Capabilities {
        child_session_updates: client.get("_meta").and_then(|meta| meta.get(CHILD_SESSION_UPDATES))
            == Some(&Value::Bool(true)),
        form_elicitation: present(client.get("elicitation").and_then(|elicitation| elicitation.get("form"))),
        compaction: present(client.get("session").and_then(|session| session.get("compaction"))),
    }
}
