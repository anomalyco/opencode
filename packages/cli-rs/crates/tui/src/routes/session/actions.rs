//! Session actions (E.10a, row V21): rename, timeline, fork, compact, undo, redo, copy, export, and the parent
//! session (`routes/session/index.tsx:1053-1433`). The commands sit in TS's layers: every one in the global
//! mode's command list, so the palette and slash completion see them, and their keys in the base mode.

use std::cell::RefCell;
use std::rc::{Rc, Weak};
use std::time::Duration;

use opencode_api::client::{Call, RequestOptions};
use opencode_api::generated::{
    ExperimentalSessionWaitInput, ModelRef, ProviderID, SessionID, SessionInboxCancelInput, SessionInboxInfo,
    SessionInterruptInput, SessionMessageAssistantContentItem, SessionMessageCompaction, SessionMessageInfo,
    SessionMessageUser, SessionRevertClearInput, SessionRevertStageInput, SessionUpdateInput,
};
use opencode_store::{MessageExt, State};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use serde_json::Value;

use super::scroll;
use crate::app::Tui;
use crate::dialogs::{export, fork, rename, timeline};
use crate::prompt::draft::Draft;
use crate::routes::Route;

/// The session view's action commands. Dropping it removes their layers.
pub struct Actions(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    session: SessionID,
    scroll: Weak<scroll::Inner>,
    layers: RefCell<Vec<Disposer>>,
}

type Run = fn(&Inner, &Tui, Option<&str>);

impl Actions {
    pub fn new(tui: &Tui, session: &SessionID, scroll: &scroll::Controls) -> Self {
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            session: session.clone(),
            scroll: Rc::downgrade(&scroll.0),
            layers: RefCell::default(),
        });
        inner.register(tui, &inner);
        Self(inner)
    }
}

impl Drop for Actions {
    fn drop(&mut self) {
        // A command may drop the view while the keymap runs it (fork and parent navigate), so the layers go
        // afterwards.
        let layers = std::mem::take(&mut *self.0.layers.borrow_mut());
        if let Some(tui) = self.0.tui.upgrade() {
            tui.app.defer(move |_| drop(layers));
        }
    }
}

impl Inner {
    fn register(&self, tui: &Tui, this: &Rc<Inner>) {
        let command = |id: &str, title: &str, run: Run| {
            let weak = Rc::downgrade(this);
            TuiCommand::new(id, move |input, _| {
                let Some(inner) = weak.upgrade() else { return };
                let Some(tui) = inner.tui.upgrade() else {
                    return;
                };
                run(&inner, &tui, input);
            })
            .title(title)
            .group("Session")
            .bind(Bind::Off)
        };
        let slash = |name: &str, arguments: bool| Slash { name: name.to_owned(), aliases: Vec::new(), arguments };
        // Keymap conditions read the routed session as the last sync left it: they must not lock the store.
        let reverted = {
            let (weak, session) = (tui.weak(), self.session.clone());
            Condition::when(move || {
                weak.upgrade()
                    .is_some_and(|tui| tui.routed().is_some_and(|info| info.id == session && info.revert.is_some()))
            })
        };
        let child = {
            let (weak, session) = (tui.weak(), self.session.clone());
            Condition::when(move || {
                weak.upgrade()
                    .is_some_and(|tui| tui.routed().is_some_and(|info| info.id == session && info.parent_id.is_some()))
            })
        };
        let commands = vec![
            command("session.rename", "Rename session", Inner::rename).palette().slash(slash("rename", true)),
            command("session.timeline", "Jump to message", Inner::timeline).palette().slash(slash("timeline", false)),
            command("session.fork", "Fork session", Inner::fork).palette().slash(slash("fork", false)),
            command("session.compact", "Compact session", Inner::compact).palette().slash(slash("compact", false)),
            command("session.undo", "Undo previous message", Inner::undo).palette().slash(slash("undo", false)),
            command("session.redo", "Redo", Inner::redo).palette().enabled(reverted).slash(slash("redo", false)),
            command("messages.copy", "Copy last assistant message", Inner::copy_last)
                .palette()
                .slash(slash("copy", false)),
            command("session.copy.id", "Copy session ID", Inner::copy_id).palette(),
            command("session.copy", "Copy session transcript", Inner::copy_transcript).palette(),
            command("session.export", "Export session transcript", Inner::export)
                .palette()
                .slash(slash("export", false)),
            command("session.parent", "Go to parent session", Inner::parent).enabled(child),
        ];
        let bindings = commands.iter().filter_map(|command| command.id.clone()).collect();
        for layer in [
            KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands, ..KeymapLayer::default() },
            KeymapLayer { bindings, ..KeymapLayer::default() },
        ] {
            match tui.keymap.layer(layer) {
                Ok(disposer) => self.layers.borrow_mut().push(disposer),
                Err(error) => log::error!("session actions keymap layer: {error}"),
            }
        }
    }

    /// `session.rename`: the dialog from the palette or a key; `/rename <title>` renames at once, and a bare
    /// `/rename` asks the server for a new title.
    fn rename(&self, tui: &Tui, input: Option<&str>) {
        let Some(input) = input else {
            let title = tui.data.read(|state| state.session(&self.session).and_then(|info| info.title.clone()));
            rename::show(tui, self.session.clone(), title);
            return;
        };
        let title = input.trim().to_owned();
        let data = tui.data.clone();
        let session = self.session.clone();
        let generate = title.is_empty();
        let weak = tui.weak();
        tui.app.spawn(
            async move {
                let input = SessionUpdateInput {
                    session_id: session.clone(),
                    title: Some(title),
                    ..SessionUpdateInput::default()
                };
                data.client()
                    .session_update(&input, &RequestOptions::default())
                    .await
                    .map_err(|error| error.to_string())?;
                // The response can beat the renamed event; read the generated title back.
                if generate {
                    data.session_invalidate(&session);
                    data.session_sync(&session, false).await.map_err(|error| error.to_string())?;
                }
                Ok::<_, String>(())
            },
            move |_, result| {
                if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                    tui.toasts.error(error);
                }
            },
        );
    }

    /// `session.timeline`: moving through it jumps the transcript.
    fn timeline(&self, tui: &Tui, _: Option<&str>) {
        let scroll = self.scroll.clone();
        timeline::show(
            tui,
            self.session.clone(),
            Rc::new(move |tui, id| {
                if let Some(scroll) = scroll.upgrade() {
                    scroll.jump(tui, id);
                }
            }),
        );
    }

    fn fork(&self, tui: &Tui, _: Option<&str>) {
        let scroll = self.scroll.clone();
        fork::show(
            tui,
            self.session.clone(),
            None,
            Rc::new(move |tui, id| {
                if let (Some(scroll), Some(id)) = (scroll.upgrade(), id) {
                    scroll.jump(tui, id);
                }
            }),
        );
    }

    /// `session.compact` with the prompt's model and variant.
    fn compact(&self, tui: &Tui, _: Option<&str>) {
        let model = tui.local.selection().map(|selection| ModelRef {
            id: selection.model.model_id,
            provider_id: ProviderID(selection.model.provider_id),
            variant: selection.variant,
        });
        let task = tui.data.compact(&self.session, model);
        let weak = tui.weak();
        tui.app.spawn(task, move |_, result| {
            if let (Err(error), Some(tui)) = (result, weak.upgrade()) {
                tui.toasts.show(ToastOptions::new(Variant::Error, error.to_string()));
            }
        });
        tui.dialogs.clear();
    }

    /// `session.undo`: takes back the last prompt. A prompt still in the inbox is cancelled; a delivered one is
    /// interrupted, waited for, and reverted to. Either way its text goes back into the composer.
    fn undo(&self, tui: &Tui, _: Option<&str>) {
        let found = tui.data.read(|state| {
            let message = before_revert(state, &self.session).iter().rev().find_map(|message| match message {
                SessionMessageInfo::User(user) if !user.text.trim().is_empty() => Some(user.clone()),
                _ => None,
            })?;
            let pending = state
                .pending(&self.session)
                .iter()
                .any(|item| matches!(item, SessionInboxInfo::User(user) if user.id == message.id));
            Some((message, pending))
        });
        tui.dialogs.clear();
        let Some((message, pending)) = found else {
            tui.toasts.show(ToastOptions::new(Variant::Error, "Nothing to undo").duration(Duration::from_millis(3000)));
            return;
        };
        let client = tui.data.client().clone();
        let session = self.session.clone();
        let target = self.session.clone();
        let weak = tui.weak();
        let SessionMessageUser { id, text, .. } = message;
        if pending {
            tui.app.spawn(
                async move {
                    let input = SessionInboxCancelInput { session_id: session, inbox_id: id };
                    client.session_inbox_cancel(&input, &RequestOptions::default()).await
                },
                move |_, result| {
                    let Some(tui) = weak.upgrade() else { return };
                    match result {
                        Ok(()) => append_prompt(&tui, &target, &text),
                        Err(error) => tui.toasts.show(
                            ToastOptions::new(Variant::Error, error.to_string())
                                .title("Failed to delete pending prompt"),
                        ),
                    }
                },
            );
            return;
        }
        tui.app.spawn(
            async move {
                let options = RequestOptions::default();
                client
                    .session_interrupt(&SessionInterruptInput { session_id: session.clone(), resume: None }, &options)
                    .await?;
                client
                    .experimental_session_wait(&ExperimentalSessionWaitInput { session_id: session.clone() }, &options)
                    .await?;
                client
                    .session_revert_stage(
                        &SessionRevertStageInput { session_id: session, message_id: id, files: None },
                        &options,
                    )
                    .await
            },
            move |_, result| {
                let Some(tui) = weak.upgrade() else { return };
                match result {
                    Ok(_) => append_prompt(&tui, &target, &text),
                    Err(error) => tui.toasts.show(
                        ToastOptions::new(Variant::Error, error.to_string()).duration(Duration::from_millis(5000)),
                    ),
                }
            },
        );
    }

    /// `session.redo`: clears the staged revert.
    fn redo(&self, tui: &Tui, _: Option<&str>) {
        let client = tui.data.client().clone();
        let input = SessionRevertClearInput { session_id: self.session.clone() };
        let weak = tui.weak();
        tui.app.spawn(
            async move { client.session_revert_clear(&input, &RequestOptions::default()).await },
            move |_, result| {
                let Some(tui) = weak.upgrade() else { return };
                if let Err(error) = result {
                    tui.toasts.show(
                        ToastOptions::new(Variant::Error, error.to_string()).duration(Duration::from_millis(5000)),
                    );
                }
                tui.dialogs.clear();
            },
        );
    }

    /// `messages.copy`: the last reply's text, or the last completed compaction's summary.
    fn copy_last(&self, tui: &Tui, _: Option<&str>) {
        let text = tui.data.read(|state| last_reply(before_revert(state, &self.session)));
        tui.dialogs.clear();
        let message = match text {
            None => Err("No assistant messages found"),
            Some(text) if text.is_empty() => Err("No text content found in last assistant message"),
            Some(text) if tui.app.copy_to_clipboard(&text) => Ok("Message copied to clipboard!"),
            Some(_) => Err("Failed to copy to clipboard"),
        };
        toast(tui, message);
    }

    fn copy_id(&self, tui: &Tui, _: Option<&str>) {
        let message = if tui.app.copy_to_clipboard(self.session.as_str()) {
            Ok("Session ID copied to clipboard!")
        } else {
            Err("Failed to copy session ID")
        };
        toast(tui, message);
        tui.dialogs.clear();
    }

    /// `session.copy`: the Markdown transcript with thinking and tools.
    fn copy_transcript(&self, tui: &Tui, _: Option<&str>) {
        if !self.known(tui) {
            return;
        }
        let weak = tui.weak();
        tui.app.spawn(
            transcript(tui, &self.session, None),
            move |_, result: Result<Value, opencode_api::error::Error>| {
                let Some(tui) = weak.upgrade() else { return };
                let copied =
                    result.ok().is_some_and(|transcript| tui.app.copy_to_clipboard(&markdown(&transcript, true, true)));
                toast(
                    &tui,
                    if copied {
                        Ok("Session transcript copied to clipboard!")
                    } else {
                        Err("Failed to copy session transcript")
                    },
                );
                tui.dialogs.clear();
            },
        );
    }

    /// `session.export`: the options, then the transcript to the clipboard or to a file in the temporary
    /// directory, whose path the result dialog shows.
    fn export(&self, tui: &Tui, _: Option<&str>) {
        if !self.known(tui) {
            return;
        }
        let session = self.session.clone();
        export::options(
            tui,
            true,
            Rc::new(move |tui, choice| {
                let json = choice.format == export::Format::Json;
                let weak = tui.weak();
                tui.app.spawn(transcript(tui, &session, json.then_some(choice.sanitize)), move |_, result| {
                    let Some(tui) = weak.upgrade() else { return };
                    let content = result.ok().and_then(|transcript| match choice.format {
                        export::Format::Markdown => Some(markdown(&transcript, choice.thinking, choice.tools)),
                        export::Format::Json => serde_json::to_string_pretty(&transcript).ok().map(|text| text + "\n"),
                    });
                    let outcome = content.ok_or(()).and_then(|content| match choice.action {
                        export::Action::Copy => tui.app.copy_to_clipboard(&content).then_some(None).ok_or(()),
                        export::Action::Export => {
                            let extension = if json { "json" } else { "md" };
                            let path =
                                std::env::temp_dir().join(format!("session-{}.{extension}", uuid::Uuid::new_v4()));
                            std::fs::write(&path, content).map(|_| Some(path.display().to_string())).map_err(drop)
                        }
                    });
                    match outcome {
                        Ok(Some(path)) => export::result(&tui, path),
                        Ok(None) => {
                            tui.dialogs.clear();
                            toast(&tui, Ok("Copied to clipboard"));
                        }
                        Err(()) => {
                            toast(&tui, Err("Failed to export session"));
                            tui.dialogs.clear();
                        }
                    }
                });
            }),
        );
    }

    fn parent(&self, tui: &Tui, _: Option<&str>) {
        let parent = tui.data.read(|state| state.session(&self.session).and_then(|info| info.parent_id.clone()));
        tui.dialogs.clear();
        if let Some(parent) = parent {
            tui.navigate(Route::Session { id: parent });
        }
    }

    /// TS returns before anything when the session is not loaded (`if (!sessionData) return`).
    fn known(&self, tui: &Tui) -> bool {
        tui.data.read(|state| state.session(&self.session).is_some())
    }
}

/// `messagesBeforeRevert`: the messages before the staged revert, if any.
fn before_revert<'a>(state: &'a State, session: &SessionID) -> &'a [SessionMessageInfo] {
    let messages = state.messages(session);
    let Some(revert) = state.session(session).and_then(|info| info.revert.as_ref()) else {
        return messages;
    };
    match messages.iter().position(|message| message.id() == revert.message_id.as_str()) {
        Some(index) => &messages[..index],
        None => messages,
    }
}

/// The text `messages.copy` copies: `None` without a reply, empty for a reply with no text.
fn last_reply(messages: &[SessionMessageInfo]) -> Option<String> {
    messages.iter().rev().find_map(|message| match message {
        SessionMessageInfo::Assistant(assistant) => Some(
            assistant
                .content
                .iter()
                .filter_map(|item| match item {
                    SessionMessageAssistantContentItem::Text(text) => Some(text.text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_owned(),
        ),
        SessionMessageInfo::Compaction(SessionMessageCompaction::Completed(compaction))
            if !compaction.summary.trim().is_empty() =>
        {
            Some(compaction.summary.trim().to_owned())
        }
        _ => None,
    })
}

/// `appendToSessionPrompt`: the restored text after the composer's own, with a blank line between, or into the
/// session's draft when its composer is not mounted. Only the text comes back (see `fork::restored`).
pub(crate) fn append_prompt(tui: &Tui, session: &SessionID, text: &str) {
    let join = |current: &str| {
        if current.is_empty() { text.to_owned() } else { format!("{current}\n\n{text}") }
    };
    let mounted = tui.textarea.borrow().clone();
    if let Some(textarea) = mounted.filter(|_| tui.route() == (Route::Session { id: session.clone() })) {
        textarea.set_text(join(&textarea.text()));
        textarea.set_cursor_offset(u32::MAX);
        return;
    }
    let mut prompt =
        tui.prompt.drafts.take(Some(session)).map_or_else(opencode_local::jsonl::empty_prompt, |draft| draft.prompt);
    let current = prompt["text"].as_str().unwrap_or_default().to_owned();
    prompt["text"] = Value::String(join(&current));
    tui.prompt.drafts.save(Some(session), Draft { prompt, cursor: u32::MAX });
}

/// `experimental.session.export`, read as the JSON the server sent, so a JSON export keeps its fields and order.
fn transcript(
    tui: &Tui,
    session: &SessionID,
    sanitize: Option<bool>,
) -> impl std::future::Future<Output = Result<Value, opencode_api::error::Error>> + Send + 'static {
    let client = tui.data.client().clone();
    let session = session.clone();
    async move {
        let mut call = Call::new(
            "GET",
            format!("/api/experimental/session/{}/export", opencode_api::client::path_param(&session)?),
            200,
            &[400, 401, 404, 500],
        );
        if let Some(sanitize) = sanitize {
            call.query("sanitize", &sanitize)?;
        }
        let mut body: Value = client.json(call, &RequestOptions::default()).await?;
        Ok(body["data"].take())
    }
}

/// `formatSessionTranscript` over the wire JSON of a transcript (`{info, messages}`).
fn markdown(transcript: &Value, thinking: bool, tools: bool) -> String {
    let body: Vec<String> = transcript["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|message| message_markdown(message, thinking, tools))
        .collect();
    let info = &transcript["info"];
    let title =
        serde_json::from_value(info.clone()).map(|info| crate::dialogs::session_list::title(&info)).unwrap_or_default();
    let time = |key: &str| locale_string(info["time"][key].as_f64().unwrap_or(f64::NAN));
    format!(
        "# {title}\n\n**Session ID:** {}\n**Created:** {}\n**Updated:** {}\n\n---\n\n{}\n",
        info["id"].as_str().unwrap_or_default(),
        time("created"),
        time("updated"),
        body.join("\n\n---\n\n"),
    )
}

fn message_markdown(message: &Value, thinking: bool, tools: bool) -> Option<String> {
    let text = |value: &Value| value.as_str().unwrap_or_default().to_owned();
    match message["type"].as_str()? {
        "user" => Some(format!("## User\n\n{}", text(&message["text"]))),
        "shell" => Some(format!(
            "## Shell\n\n```\n$ {}\n{}\n```",
            text(&message["command"]),
            text(&message["output"]["output"]),
        )),
        "assistant" => {
            let content: Vec<String> = message["content"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|item| match item["type"].as_str() {
                    Some("text") => Some(text(&item["text"])),
                    Some("reasoning") => thinking.then(|| format!("_Thinking:_\n\n{}", text(&item["text"]))),
                    _ if !tools => None,
                    _ => Some(tool_markdown(item)),
                })
                .collect();
            (!content.is_empty()).then(|| format!("## Assistant\n\n{}", content.join("\n\n")))
        }
        _ => None,
    }
}

fn tool_markdown(item: &Value) -> String {
    let state = &item["state"];
    let input = match &state["input"] {
        Value::String(input) => input.clone(),
        // `JSON.stringify(undefined)` is `undefined`, which the template prints.
        Value::Null if state.get("input").is_none() => "undefined".to_owned(),
        input => serde_json::to_string_pretty(input).unwrap_or_default(),
    };
    let output = match state["status"].as_str() {
        Some("error") => state["error"]["message"].as_str().unwrap_or_default().to_owned(),
        Some("streaming" | "running") => String::new(),
        _ => state["content"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|entry| match entry["type"].as_str() {
                Some("text") => entry["text"].as_str().unwrap_or_default().to_owned(),
                _ => entry["name"].as_str().or_else(|| entry["uri"].as_str()).unwrap_or_default().to_owned(),
            })
            .collect::<Vec<_>>()
            .join("\n"),
    };
    format!("**Tool: {}**\n\n**Input:**\n```json\n{input}\n```\n\n{output}", item["name"].as_str().unwrap_or_default())
}

/// `new Date(ms).toLocaleString()` in en-US as Bun prints it: `3/3/2026, 12:00:00 PM`.
fn locale_string(ms: f64) -> String {
    use chrono::TimeZone;
    if !ms.is_finite() {
        return "Invalid Date".to_owned();
    }
    chrono::Local
        .timestamp_millis_opt(ms as i64)
        .single()
        .map(|date| date.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string())
        .unwrap_or_else(|| "Invalid Date".to_owned())
}

fn toast(tui: &Tui, message: Result<&str, &str>) {
    let (variant, message) = match message {
        Ok(message) => (Variant::Success, message),
        Err(message) => (Variant::Error, message),
    };
    tui.toasts.show(ToastOptions::new(variant, message));
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn messages(values: Value) -> Vec<SessionMessageInfo> {
        serde_json::from_value(values).unwrap()
    }

    #[test]
    fn last_reply_takes_the_text_parts_or_a_completed_summary() {
        let reply = |content: Value| {
            json!({
                "id": "msg_2", "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
                "time": { "created": 2 }, "content": content,
            })
        };
        let user = json!({ "id": "msg_1", "type": "user", "text": "Hi", "time": { "created": 1 } });
        assert_eq!(last_reply(&messages(json!([user]))), None);
        let texts = reply(json!([
            { "type": "text", "id": "a", "text": "  One" },
            { "type": "reasoning", "id": "b", "text": "hidden" },
            { "type": "text", "id": "c", "text": "Two  " },
        ]));
        assert_eq!(last_reply(&messages(json!([user, texts]))).as_deref(), Some("One\nTwo"));
        let empty = reply(json!([{ "type": "reasoning", "id": "b", "text": "only thoughts" }]));
        assert_eq!(last_reply(&messages(json!([empty]))).as_deref(), Some(""));
        // A completed compaction with a summary counts; a blank one is skipped.
        let compaction = |id: &str, summary: &str| {
            json!({
                "id": id, "type": "compaction", "status": "completed", "reason": "manual", "summary": summary,
                "time": { "created": 3 },
            })
        };
        let list = json!([texts, compaction("msg_3", " Summary "), compaction("msg_4", "  ")]);
        assert_eq!(last_reply(&messages(list)).as_deref(), Some("Summary"));
    }

    #[test]
    fn tool_markdown_follows_the_state() {
        let tool = |state: Value| json!({ "type": "tool", "name": "bash", "state": state });
        assert_eq!(
            tool_markdown(&tool(json!({ "status": "error", "input": "ls", "error": { "message": "denied" } }))),
            "**Tool: bash**\n\n**Input:**\n```json\nls\n```\n\ndenied"
        );
        assert_eq!(
            tool_markdown(&tool(json!({ "status": "running", "input": { "a": 1 } }))),
            "**Tool: bash**\n\n**Input:**\n```json\n{\n  \"a\": 1\n}\n```\n\n"
        );
        let files = json!({
            "status": "completed",
            "content": [
                { "type": "text", "text": "out" },
                { "type": "file", "uri": "file:///a.png", "name": "a.png" },
                { "type": "file", "uri": "file:///b.png" },
            ],
        });
        assert_eq!(
            tool_markdown(&tool(files)),
            "**Tool: bash**\n\n**Input:**\n```json\nundefined\n```\n\nout\na.png\nfile:///b.png"
        );
    }

    #[test]
    fn markdown_without_thinking_or_tools_drops_empty_replies() {
        let transcript = json!({
            "info": {
                "id": "ses_a", "title": "Chat", "projectID": "project", "cost": 0,
                "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
                "time": { "created": 0, "updated": 0 }, "location": { "directory": "/project" },
            },
            "messages": [
                { "type": "user", "text": "Hi" },
                { "type": "assistant", "content": [{ "type": "reasoning", "text": "hm" }, { "type": "tool", "name": "x", "state": {} }] },
                { "type": "shell", "command": "ls", "output": { "output": "a\nb" } },
                { "type": "compaction", "summary": "skipped" },
            ],
        });
        let text = markdown(&transcript, false, false);
        let body = text.split_once("---\n\n").unwrap().1;
        assert_eq!(body, "## User\n\nHi\n\n---\n\n## Shell\n\n```\n$ ls\na\nb\n```\n");
        assert!(text.starts_with("# Chat\n\n**Session ID:** ses_a\n**Created:** "), "{text}");
    }
}
