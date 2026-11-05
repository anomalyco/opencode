//! The skill tool (E.7b): `Skill` (`routes/session/index.tsx:3698-3705`). One line with the skill's
//! name.

use opentui::prelude::*;

use super::dispatch::{Inline, InlineTool, Props};
use crate::routes::session::messages::list::Context;

pub struct Skill(InlineTool);

impl Skill {
    pub fn new(cx: &Context<'_>) -> Self {
        Self(InlineTool::new(cx))
    }

    pub fn root(&self) -> &View {
        self.0.root()
    }

    pub fn update(&self, _cx: &Context<'_>, props: &Props<'_>) {
        let name = props.metadata.get("name").and_then(serde_json::Value::as_str).or(props.input_str("id"));
        self.0.set(Inline {
            text: format!("Skill \"{}\"", name.unwrap_or_default()),
            ..Inline::new(props, "→", "Loading skill…", name.is_some_and(|name| !name.is_empty()))
        });
    }
}
