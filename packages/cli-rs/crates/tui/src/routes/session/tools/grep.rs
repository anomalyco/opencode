//! The grep tool (E.7a): `Grep` (`routes/session/index.tsx:3243-3254`).

use super::dispatch::{InlineTool, Props, finite};
use super::glob::search;
use crate::routes::session::messages::list::Context;

pub struct Grep(InlineTool);

impl Grep {
    pub fn new(cx: &Context<'_>) -> Self {
        Self(InlineTool::new(cx))
    }

    pub fn root(&self) -> &opentui::prelude::View {
        self.0.root()
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let matches = finite(props.metadata.get("matches"));
        self.0.set(search(cx, props, "Grep", "Searching content…", matches));
    }
}
