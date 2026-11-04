//! Submit, queue, and steer (E.2, rows P02 and P07; `component/prompt/index.tsx:1098-1405`).
//!
//! A submit snapshots the prompt and clears it at once; the requests then run on the runtime, and a
//! failure puts the prompt back unless something new was typed. On home, it creates the session
//! first (optimistically, so the session opens at once) and the prompt waits for the creation.

use std::rc::Rc;

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    AbsolutePath, AgentID, LocationPublicRef, ModelRef, SessionCommandInput, SessionID,
    SessionInboxDelivery, SessionInboxInfo, SessionInboxUpdateInput, SessionPromptInput,
    SessionShellInput, SessionSwitchAgentInput, SessionSwitchModelInput,
};
use opencode_store::inbox::Gate;
use opencode_store::{CreateSession, Error, Prompt};
use opencode_ui::toast::{ToastOptions, Variant};
use serde_json::Value;

use super::draft::Draft;
use super::editor::{Inner, Mode};
use crate::app::Tui;
use crate::routes::Route;

/// Submits the prompt with `delivery`. Returns whether it was handled (the caller then closes
/// dialogs).
pub fn submit(prompt: &Rc<Inner>, delivery: SessionInboxDelivery) -> bool {
    let Some(tui) = prompt.tui.upgrade() else {
        return false;
    };
    // A second Enter while one submit runs must not send the cleared prompt.
    if prompt.submitting.replace(true) {
        return false;
    }
    let handled = run(&tui, prompt, delivery);
    prompt.submitting.set(false);
    handled
}

fn run(tui: &Tui, prompt: &Rc<Inner>, delivery: SessionInboxDelivery) -> bool {
    let text = prompt.textarea.text();
    let trimmed = text.trim();
    let queue = delivery == SessionInboxDelivery::Queue;
    let mode = prompt.mode.get();
    if trimmed.is_empty() && (prompt.session.is_none() || mode == Mode::Shell || queue) {
        // An empty Enter in a session steers its first queued prompt.
        return match (&prompt.session, queue) {
            (Some(session), false) => steer_first_queued(tui, session),
            _ => false,
        };
    }
    let exit = matches!(trimmed, "exit" | "quit" | ":q");
    let slash = argument_slash(tui, &text);
    if queue && (mode == Mode::Shell || exit || slash.is_some()) {
        warn(tui, "This prompt cannot be queued");
        return false;
    }
    if exit {
        tui.keymap.dispatch("app.exit", None);
        return true;
    }
    if let Some((id, input)) = slash {
        prompt.clear(tui);
        tui.keymap.dispatch(&id, Some(&input));
        return true;
    }

    let Some(catalog) = prompt.catalog.borrow().clone() else {
        return false;
    };
    let session = prompt.session_info(tui);
    let Some(selection) = catalog.selection(session.as_ref()) else {
        return false;
    };
    let Some(model) = selection.model.clone() else {
        tui.toasts.show(
            ToastOptions::new(Variant::Warning, "Connect an integration to send prompts")
                .duration(std::time::Duration::from_secs(3)),
        );
        return false;
    };
    let uses_model = prompt.session.is_none() || mode != Mode::Shell;
    if uses_model && !catalog.available(&model) {
        tui.toasts.show(
            ToastOptions::new(
                Variant::Warning,
                format!(
                    "{}/{} is not available in this session's location",
                    model.provider_id, model.model_id
                ),
            )
            .title("Model unavailable"),
        );
        return false;
    }
    let head = slash_head(&text);
    let command = head
        .as_ref()
        .filter(|(name, _)| catalog.commands.iter().any(|command| command == name))
        .cloned();

    // Snapshot, then clear before any request: text typed meanwhile survives, and history records
    // exactly what was sent.
    let entry = prompt.snapshot();
    if !trimmed.is_empty() {
        prompt.reset();
    }
    let agent = selection.agent.id.clone();
    let model = model.model_ref();
    let (target, creation) = match &prompt.session {
        Some(session) => (session.clone(), None),
        None => {
            let (id, task) = tui.data.session_create(CreateSession {
                agent: Some(agent.clone()),
                model: Some(model.clone()),
                location: Some(LocationPublicRef {
                    directory: AbsolutePath(tui.directory.clone()),
                }),
                ..CreateSession::default()
            });
            (id, Some(task))
        }
    };
    let created = creation.is_some();
    let commit = Commit {
        client: tui.data.client().clone(),
        session: target.clone(),
        switch_agent: session
            .as_ref()
            .is_some_and(|session| session.agent.as_ref() != Some(&agent))
            .then_some(agent),
        model,
    };

    if trimmed.is_empty() {
        // A blank Enter commits the selection, then steers the first queued prompt.
        let weak = prompt.this.clone();
        let entry = entry.clone();
        tui.app
            .spawn(async move { commit.run().await }, move |_, result| {
                if let Err(error) = result {
                    fail(&weak, "Failed to prepare session", &error, &entry);
                } else if let Some(tui) = weak.upgrade().and_then(|prompt| prompt.tui.upgrade())
                    && let Some(session) = weak.upgrade().and_then(|prompt| prompt.session.clone())
                {
                    steer_first_queued(&tui, &session);
                }
            });
        return true;
    }

    tui.prompt.history.append(&tui.app, entry.clone());
    let failure = Failure {
        tui: tui.weak(),
        prompt: prompt.this.clone(),
        session: created.then(|| target.clone()),
        entry,
    };
    match (mode, command) {
        (Mode::Shell, _) => {
            let client = tui.data.client().clone();
            let input = SessionShellInput {
                session_id: target.clone(),
                id: None,
                command: text,
            };
            tui.app.spawn(
                async move {
                    if let Some(creation) = creation {
                        creation.await?;
                    }
                    client
                        .session_shell(&input, &RequestOptions::default())
                        .await
                        .map_err(Error::new)
                },
                move |_, result| failure.check("Failed to run shell command", result),
            );
            prompt.set_mode(Mode::Normal);
        }
        (Mode::Normal, Some((name, arguments))) => {
            let input = SessionCommandInput {
                session_id: target.clone(),
                name,
                text: arguments,
                delivery: Some(Some(delivery)),
                ..SessionCommandInput::default()
            };
            tui.app.spawn(
                async move {
                    if let Some(creation) = creation {
                        creation.await?;
                    }
                    let client = commit.client.clone();
                    commit.run().await?;
                    client
                        .session_command(&input, &RequestOptions::default())
                        .await
                        .map_err(Error::new)
                },
                move |_, result| failure.check("Failed to run command", result),
            );
        }
        (Mode::Normal, None) => {
            // The store admits the prompt at once and rolls it back if the server rejects it; it
            // waits for a session being created.
            let task = tui.data.prompt(Prompt {
                input: SessionPromptInput {
                    session_id: target.clone(),
                    text,
                    delivery: Some(Some(delivery)),
                    ..SessionPromptInput::default()
                },
                gate: None,
                prepare: Some(Box::new(move || -> Gate { Box::pin(commit.run()) })),
            });
            tui.app.spawn(task, move |_, result| {
                failure.check("Failed to send prompt", result.map(drop))
            });
        }
    }

    if created {
        // Navigating replaces this prompt, so it runs after the key that submitted.
        let weak = tui.weak();
        tui.app.defer(move |_| {
            if let Some(tui) = weak.upgrade() {
                tui.navigate(Route::Session { id: target });
            }
        });
    }
    true
}

/// The selection a submit commits before it sends (`prepareAgent` and `commitModel`).
struct Commit {
    client: Client,
    session: SessionID,
    switch_agent: Option<AgentID>,
    model: ModelRef,
}

impl Commit {
    async fn run(self) -> Result<(), Error> {
        let options = RequestOptions::default();
        if let Some(agent) = self.switch_agent {
            let input = SessionSwitchAgentInput {
                session_id: self.session.clone(),
                agent,
            };
            self.client
                .session_switch_agent(&input, &options)
                .await
                .map_err(Error::new)?;
        }
        let input = SessionSwitchModelInput {
            session_id: self.session,
            model: self.model,
        };
        self.client
            .session_switch_model(&input, &options)
            .await
            .map_err(|error| {
                Error::new(opencode_api::error::Error::Transport(format!(
                    "Failed to switch model: {error}"
                )))
            })
    }
}

/// Where a failed submit puts its prompt back.
struct Failure {
    tui: std::rc::Weak<Tui>,
    prompt: std::rc::Weak<Inner>,
    /// The session this submit created, if any.
    session: Option<SessionID>,
    entry: Value,
}

impl Failure {
    fn check<T>(self, title: &str, result: Result<T, Error>) {
        let Err(error) = result else { return };
        let Some(session) = self.session else {
            fail(&self.prompt, title, &error, &self.entry);
            return;
        };
        // A failed new session goes back home with the prompt as home's draft (`recover`).
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let title = if tui.data.read(|state| state.session(&session).is_some()) {
            "Failed to set up session"
        } else {
            "Creating a session failed"
        };
        tui.toasts
            .show(ToastOptions::new(Variant::Error, error.to_string()).title(title));
        tui.prompt.drafts.save(
            None,
            Draft {
                prompt: self.entry,
                cursor: u32::MAX,
            },
        );
        if tui.route() == (Route::Session { id: session }) {
            tui.navigate(Route::Home);
        }
    }
}

/// Shows the error and restores the prompt unless something new was typed.
fn fail(prompt: &std::rc::Weak<Inner>, title: &str, error: &Error, entry: &Value) {
    let Some(prompt) = prompt.upgrade() else {
        return;
    };
    let Some(tui) = prompt.tui.upgrade() else {
        return;
    };
    tui.toasts
        .show(ToastOptions::new(Variant::Error, error.to_string()).title(title));
    if prompt.textarea.text().is_empty() {
        prompt.restore(entry.clone());
        prompt.textarea.set_cursor_offset(prompt.text_end());
    }
}

/// `onEmptySubmit` in a session: steers the first queued prompt, if any.
fn steer_first_queued(tui: &Tui, session: &SessionID) -> bool {
    let queued = tui.data.read(|state| {
        state.pending(session).iter().find_map(|item| match item {
            SessionInboxInfo::User(user) if user.delivery == SessionInboxDelivery::Queue => {
                Some(user.id.clone())
            }
            _ => None,
        })
    });
    let Some(inbox) = queued else {
        return false;
    };
    let client = tui.data.client().clone();
    let input = SessionInboxUpdateInput {
        session_id: session.clone(),
        inbox_id: inbox,
        delivery: SessionInboxDelivery::Steer,
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move {
            client
                .session_inbox_update(&input, &RequestOptions::default())
                .await
        },
        move |_, result| {
            if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                tui.toasts.show(
                    ToastOptions::new(Variant::Error, error.to_string())
                        .title("Failed to steer pending prompt"),
                );
            }
        },
    );
    true
}

/// A keymap command with slash arguments that `text` names: its id and its input (`argumentSlash`).
fn argument_slash(tui: &Tui, text: &str) -> Option<(String, String)> {
    let (name, arguments) = slash_head(text)?;
    tui.keymap.commands().into_iter().find_map(|command| {
        let slash = command.slash.as_ref().filter(|slash| slash.arguments)?;
        (slash.name == name || slash.aliases.contains(&name))
            .then(|| (command.id.clone(), arguments.clone()))
    })
}

/// `parseSlashHead(text, /\s/)`: the name after `/` and the text after the first whitespace.
fn slash_head(text: &str) -> Option<(String, String)> {
    let rest = text.strip_prefix('/')?;
    match rest.find(char::is_whitespace) {
        None => Some((rest.to_owned(), String::new())),
        Some(end) => {
            let separator = rest[end..].chars().next().map_or(1, char::len_utf8);
            Some((rest[..end].to_owned(), rest[end + separator..].to_owned()))
        }
    }
}

fn warn(tui: &Tui, message: &str) {
    tui.toasts
        .show(ToastOptions::new(Variant::Warning, message));
}

#[cfg(test)]
mod tests {
    use super::slash_head;

    #[test]
    fn slash_head_splits_at_the_first_whitespace() {
        assert_eq!(
            slash_head("/cd ../x y"),
            Some(("cd".into(), "../x y".into()))
        );
        assert_eq!(slash_head("/init"), Some(("init".into(), String::new())));
        assert_eq!(
            slash_head("/review\nmore"),
            Some(("review".into(), "more".into()))
        );
        assert_eq!(slash_head("hello"), None);
    }
}
