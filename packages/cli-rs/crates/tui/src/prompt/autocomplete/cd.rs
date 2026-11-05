//! `/cd` (`session.cd`, row P11; `component/prompt/index.tsx:265-315`): a session moves to the
//! directory; on home, the next session's directory changes. Either way the directory joins the
//! project's recents, which the `/cd` argument completion lists first.

use opencode_api::generated::{AbsolutePath, LocationGetInput, LocationQueryInput, SessionMoveInput};
use opencode_ui::bind;
use opencode_ui::keymap::{Slash, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;
use std::rc::{Rc, Weak};

use super::parse;
use crate::app::Tui;
use crate::prompt::editor::Inner;

pub const COMMAND: &str = "session.cd";

/// The `session.cd` command of a prompt.
pub fn command(prompt: Weak<Inner>) -> TuiCommand {
    TuiCommand::new(COMMAND, move |input: Option<&str>, _: Option<&KeyEvent>| {
        if let Some(prompt) = prompt.upgrade()
            && let Some(tui) = prompt.tui.upgrade()
        {
            run(&tui, &prompt, input.unwrap_or_default());
        }
        true
    })
    .title("Change working directory")
    .slash(Slash::new("cd").arguments())
}

/// The project whose recents `/cd` keeps: the session's, else the default location's
/// (`data.location.info()?.project.id`).
pub fn project(tui: &Tui, prompt: &Inner) -> Option<String> {
    if let Some(session) = prompt.session_info(tui) {
        return Some(session.project_id.0);
    }
    tui.data
        .read(|state| state.location(None).and_then(|data| data.info.as_ref()).map(|info| info.project.id.0.clone()))
}

fn run(tui: &Tui, prompt: &Rc<Inner>, input: &str) {
    if input.trim().is_empty() {
        tui.toasts.show(ToastOptions::new(Variant::Error, "Directory is required"));
        return;
    }
    let project = project(tui, prompt);
    let value = input.trim();
    let home = std::env::var("HOME").unwrap_or_default();
    let expanded = match value {
        "~" => home.clone(),
        _ => match value.strip_prefix("~/") {
            Some(rest) => format!("{home}/{rest}"),
            None => value.to_owned(),
        },
    };
    let directory = parse::resolve(&prompt.location(tui).directory, &expanded);
    let client = tui.data.client().clone();
    let weak = prompt.this.clone();
    let failed = |tui: &Tui, error: String| {
        tui.toasts.show(ToastOptions::new(Variant::Error, error).title("Failed to change directory"));
    };
    let Some(session) = prompt.session.clone() else {
        let input = LocationGetInput { location: Some(LocationQueryInput { directory: Some(directory) }) };
        tui.app.spawn(
            async move { client.location_get(&input).await },
            bind!(weak, |prompt, _, result| {
                let Some(tui) = prompt.tui.upgrade() else {
                    return;
                };
                match result {
                    Err(error) => failed(&tui, error.to_string()),
                    Ok(info) => {
                        if let Some(project) = &project {
                            tui.prompt.complete.touch(&tui, project, &info.directory.0);
                        }
                        crate::features::location::set(&tui, opencode_store::Location::new(info.directory.0));
                        prompt.relocate(&tui);
                    }
                }
            }),
        );
        return;
    };
    // TS sends the argument as typed; the server resolves it against the session.
    let request = SessionMoveInput { session_id: session, directory: AbsolutePath(input.to_owned()), delivery: None };
    tui.app.spawn(
        async move { client.session_move(&request).await },
        bind!(weak, |prompt, _, result| {
            let Some(tui) = prompt.tui.upgrade() else {
                return;
            };
            match result {
                Err(error) => failed(&tui, error.to_string()),
                Ok(()) => {
                    if let Some(project) = &project {
                        tui.prompt.complete.touch(&tui, project, &directory);
                    }
                }
            }
        }),
    );
}
