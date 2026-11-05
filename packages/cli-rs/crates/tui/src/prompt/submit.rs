//! Submit, queue, and steer (E.2, rows P02 and P07; `component/prompt/index.tsx:1098-1405`).
//!
//! A submit snapshots the prompt and clears it at once; the requests then run on the runtime, and a
//! failure puts the prompt back unless something new was typed. On home, it creates the session
//! first (optimistically, so the session opens at once) and the prompt waits for the creation.

use std::rc::Rc;

use indexmap::IndexMap;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    AbsolutePath, AgentID, LocationPublicRef, ModelRef, SessionCommandInput, SessionID,
    SessionInboxDelivery, SessionInboxInfo, SessionPromptInput, SessionRevertCommitInput,
    SessionShellInput, SessionSwitchAgentInput, SessionSwitchModelInput, SessionSyntheticInput,
};
use opencode_store::inbox::Gate;
use opencode_store::{CreateSession, Error, Prompt};
use opencode_ui::toast::{ToastOptions, Variant};
use serde_json::Value;

use super::autocomplete::parts;
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
    // A staged worktree is being created; its submit runs once it exists (E.11b).
    if prompt.staging.creating() {
        return false;
    }
    if prompt
        .autocomplete
        .get()
        .is_some_and(|complete| complete.visible().is_some())
    {
        return false;
    }
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
    // What is sent: compact pastes expanded (`inputText`, E.4).
    let text = super::paste::expanded_text(prompt);
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
    // The editor context goes once, before the prompt it came with (E.5).
    let editor = prompt
        .editor_context(tui)
        .filter(|_| tui.prompt.editor.label_state() == super::editor_context::LabelState::Pending);
    if queue && editor.is_some() {
        warn(tui, "Editor context cannot be queued");
        return false;
    }

    let Some(catalog) = prompt.catalog.borrow().clone() else {
        return false;
    };
    let session = prompt.session_info(tui);
    let Some(selection) = crate::dialogs::model::prompt_selection(tui, &catalog, session.as_ref())
    else {
        return false;
    };
    let Some(model) = selection.model.clone() else {
        tui.toasts.show(
            ToastOptions::new(Variant::Warning, "Connect an integration to send prompts")
                .duration(std::time::Duration::from_secs(3)),
        );
        if !tui.local.connected() {
            crate::dialogs::integration::show(&tui.local, None);
        }
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
    let (files, agents, skills) = (
        serde_json::from_value(super::attach::files_for_server(
            &entry,
            tui.startup.args.local,
        ))
        .ok(),
        parts::agents(&entry),
        parts::skills(&entry),
    );
    if !trimmed.is_empty() {
        prompt.reset();
        let hook = prompt.on_submit.borrow().clone();
        if let Some(hook) = hook {
            hook(tui);
        }
    }
    // A staged new worktree is created first; then the prompt comes back and submits into it.
    if prompt.session.is_none() {
        let (pending, delivery) = (entry.clone(), delivery.clone());
        let staged = super::r#move::create_staged(tui, prompt, move |tui, prompt, directory| {
            let typed = prompt.textarea.text();
            if !typed.is_empty() {
                // Typed while the worktree was created: kept as home's draft.
                let mut draft = prompt.snapshot();
                draft["text"] = Value::String(typed);
                tui.prompt.drafts.save(
                    None,
                    Draft {
                        prompt: draft,
                        cursor: u32::MAX,
                    },
                );
            }
            prompt.restore(pending);
            prompt.textarea.set_cursor_offset(prompt.text_end());
            if directory.is_some() {
                submit(prompt, delivery);
            }
        });
        if staged {
            return true;
        }
    }
    let agent = selection.agent.id.clone();
    let model = model.model_ref();
    // `--session` with an unknown ID names the first session created here (`takeNewSessionID`).
    let startup_id = prompt
        .session
        .is_none()
        .then(|| tui.startup.take_new_session_id())
        .flatten();
    let (target, creation) = match &prompt.session {
        Some(session) => (session.clone(), None),
        None => {
            let (id, task) = tui.data.session_create(CreateSession {
                id: startup_id.clone(),
                agent: Some(agent.clone()),
                model: Some(model.clone()),
                location: Some(LocationPublicRef {
                    directory: AbsolutePath(
                        prompt
                            .staging
                            .directory()
                            .unwrap_or_else(|| prompt.location(tui).directory),
                    ),
                }),
                ..CreateSession::default()
            });
            (id, Some(task))
        }
    };
    let created = creation.is_some();
    // New-session sends wait for creation and the environment upload.
    let environment = created
        .then(|| tui.startup.args.environment.clone())
        .flatten();
    let commit = Commit {
        client: tui.data.client().clone(),
        session: target.clone(),
        environment: environment.clone(),
        switch_agent: session
            .as_ref()
            .is_some_and(|session| session.agent.as_ref() != Some(&agent))
            .then_some(agent),
        model,
    };
    // A shell command commits no selection.
    if trimmed.is_empty() || mode != Mode::Shell {
        tui.local
            .track_commit(&target, &commit.model, &selection.agent.id.0);
    }

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
        startup_id,
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
                    if let Some(variables) = environment {
                        opencode_store::environment::upload(&client, &input.session_id, variables)
                            .await
                            .map_err(Error::new)?;
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
                files,
                agents,
                skills,
                delivery: Some(Some(delivery)),
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
            let input = SessionPromptInput {
                session_id: target.clone(),
                text,
                files,
                agents,
                skills,
                delivery: Some(Some(delivery)),
                ..SessionPromptInput::default()
            };
            let entry = failure.entry.clone();
            // The context is admitted first, hidden (`resume: false`), after the session exists.
            let gate = editor.as_ref().map(|selection| -> Gate {
                let client = tui.data.client().clone();
                let input = SessionSyntheticInput {
                    session_id: target.clone(),
                    text: selection.reminder(),
                    resume: Some(Some(false)),
                    ..SessionSyntheticInput::default()
                };
                Box::pin(async move {
                    if let Some(creation) = creation {
                        creation.await?;
                    }
                    client
                        .session_synthetic(&input, &RequestOptions::default())
                        .await
                        .map(drop)
                        .map_err(Error::new)
                })
            });
            let send = move |tui: &Tui| {
                let task = tui.data.prompt(Prompt {
                    input,
                    gate,
                    prepare: Some(Box::new(move || -> Gate { Box::pin(commit.run()) })),
                });
                tui.app.spawn(task, move |_, result| {
                    failure.check("Failed to send prompt", result.map(drop))
                });
            };
            // A staged revert is committed before the prompt is admitted: the committed event drops every
            // inbox row at or after the boundary, which would include the new prompt.
            if session.as_ref().is_some_and(|info| info.revert.is_some()) {
                let client = tui.data.client().clone();
                let input = SessionRevertCommitInput {
                    session_id: target.clone(),
                };
                let weak = prompt.this.clone();
                tui.app.spawn(
                    async move {
                        client
                            .session_revert_commit(&input, &RequestOptions::default())
                            .await
                            .map_err(Error::new)
                    },
                    move |_, result| {
                        let Some(tui) = weak.upgrade().and_then(|prompt| prompt.tui.upgrade())
                        else {
                            return;
                        };
                        match result {
                            Ok(()) => send(&tui),
                            Err(error) => fail(&weak, "Failed to commit revert", &error, &entry),
                        }
                    },
                );
            } else {
                send(tui);
            }
            if editor.is_some() {
                tui.prompt.editor.mark_sent();
            }
        }
    }
    if created && editor.is_some() {
        tui.prompt.editor.preserve_from_new_session();
    }

    if created {
        prompt.staging.finish(prompt);
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
    /// The terminal's variables for a session this submit created.
    environment: Option<IndexMap<String, String>>,
    switch_agent: Option<AgentID>,
    model: ModelRef,
}

impl Commit {
    async fn run(self) -> Result<(), Error> {
        let options = RequestOptions::default();
        if let Some(variables) = self.environment {
            opencode_store::environment::upload(&self.client, &self.session, variables)
                .await
                .map_err(Error::new)?;
        }
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
    /// The `--session` ID that session took; a failed creation gives it back.
    startup_id: Option<SessionID>,
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
        let exists = tui.data.read(|state| state.session(&session).is_some());
        let title = if exists {
            "Failed to set up session"
        } else {
            "Creating a session failed"
        };
        if let Some(id) = self.startup_id.filter(|_| !exists) {
            tui.startup.restore_new_session_id(id);
        }
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
    crate::routes::session::queued::mutate(
        tui,
        session,
        crate::routes::session::queued::Action::Steer,
        &inbox.0,
        None,
        |_, _| {},
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
