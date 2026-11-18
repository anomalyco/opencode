//! A port of `@bybrawe/opencode-queue-manager` 0.3.5 (`src/tui.ts`): `/qm` opens a menu that comes back after each
//! task. It stages drafts per session (repeated, one at a time, or the lines of a file), edits, moves, sorts and clears
//! them, publishes them to the session's queue one by one, and lists and cancels the session's pending inbox items.
//! The drafts are stored as TS stores them, under the original's ID.
//!
//! Each task awaits its dialogs and requests in a straight line, as TS does. Where it differs from TS: sorting compares
//! by code point after lowercasing, where TS collates in Turkish (`localeCompare(b, "tr")`), and the host's list of the
//! session's pending items follows its own reads and events, as the SDK has no `pending.sync`.

mod core;

use opencode_plugin_abi::task::Cx;
use opencode_plugin_abi::types::{
    SessionID, SessionInboxCancelInput, SessionInboxDelivery, SessionInboxInfo, SessionInboxListInput,
    SessionMessageID, SessionPromptInput,
};
use opencode_plugin_abi::{
    Alert, Command, Confirm, Prompt, Route, Select, SelectOption, Setup, Toast, Variant, client, plugin,
};
use serde_json::{Value, json};

const DRAFTS: &str = "queue-manager.drafts.v1";

fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.storage_key(DRAFTS);
    let tasks = setup.tasks();
    let open = Command::new("queue.manager.open").title("Queue Manager").group("Queue Manager").palette().slash("qm");
    setup.command(open, move |host, _| tasks.spawn(host, open_manager));
    Ok(())
}

/// TS `openManager`.
async fn open_manager(cx: Cx) {
    let Route::Session { id } = cx.with(|host| host.route()) else {
        let message = "Open a session in the OpenCode v2 terminal UI first, then run /qm.";
        return cx.alert(Alert::new("Queue Manager", message)).await;
    };
    let manager = Manager { cx, session: SessionID(id) };
    // A list that fails ends the manager, as TS's outer `try` does.
    if let Err(error) = manager.menu().await {
        manager.report(&error).await;
    }
}

/// The manager of the session it was opened in.
struct Manager {
    cx: Cx,
    session: SessionID,
}

impl Manager {
    /// TS's menu loop.
    async fn menu(&self) -> Result<(), String> {
        loop {
            let drafts = self.entries().len();
            let pending = self.inbox().await?.len();
            let options = [
                ("Repeat 10 / 25 / 50 / 100 / 200 / custom".to_owned(), "repeat"),
                ("Add one draft message".to_owned(), "one"),
                ("Import lines from .txt".to_owned(), "import"),
                (format!("Manage draft list ({drafts}) - edit, reorder, delete"), "drafts"),
                ("Reverse / sort draft list".to_owned(), "sort"),
                (format!("Publish all drafts to OpenCode native queue ({drafts})"), "publish"),
                (format!("View / cancel native pending messages ({pending})"), "native"),
                ("Clear draft list".to_owned(), "clear-drafts"),
                ("Clear native queued user prompts".to_owned(), "clear-native"),
                ("Close".to_owned(), "exit"),
            ];
            let title = format!("Queue Manager | {drafts} drafts | {pending} native pending");
            let options = options.map(|(title, value)| SelectOption::new(title, value)).to_vec();
            let Some(item) = self.choose(&title, options).await else { return Ok(()) };
            match item.as_str() {
                "repeat" => self.create_repeated().await,
                "one" => self.add_one().await,
                "import" => self.import_file().await,
                "drafts" => self.manage_drafts().await,
                "sort" => self.draft_sort().await,
                "publish" => self.publish_drafts().await,
                "native" => self.native_inbox().await?,
                "clear-drafts" => self.clear_drafts().await,
                "clear-native" => self.clear_native().await?,
                "exit" => return Ok(()),
                _ => {}
            }
        }
    }

    /// TS `createRepeated`.
    async fn create_repeated(&self) {
        let mut options: Vec<SelectOption> =
            [10, 25, 50, 100, 200].iter().map(|n| SelectOption::new(n.to_string(), n.to_string())).collect();
        options.push(SelectOption::new("Custom (1-500)", "custom"));
        let Some(choice) = self.choose("Repeat count", options).await else { return };
        let raw = match choice.as_str() {
            "custom" => self.text("How many?", "e.g. 150").await,
            _ => text(&choice),
        };
        let Some(raw) = raw else { return };
        let count = match core::normalize_count(&raw) {
            Ok(count) => count,
            Err(error) => return self.report(&error).await,
        };
        let options = ["devam et", "continue", "testleri çalıştır ve hataları düzelt"]
            .iter()
            .map(|text| SelectOption::new(*text, *text))
            .chain([SelectOption::new("Custom message", "custom")])
            .collect();
        let Some(preset) = self.choose("Choose message", options).await else { return };
        let text = match preset.as_str() {
            "custom" => self.text("Message to repeat", "your prompt").await,
            _ => text(&preset),
        };
        let Some(text) = text else { return };
        let message = format!("Stage {count} copies of '{}'? No prompts will be sent yet.", core::summarize(&text, 55));
        if !self.confirm("Create repeated draft items?", &message, ("Stage", "Cancel")).await {
            return;
        }
        match core::repeat_message(&text, count) {
            Ok(copies) => {
                self.store([self.entries(), copies].concat());
                let message = format!("{count} items added. Use 'Publish drafts' to send them to the native queue.");
                self.toast("Draft ready", &message);
            }
            Err(error) => self.report(&error).await,
        }
    }

    /// TS `importFile`: the file's lines, after a confirm. `~` is the home directory, as TS reads it.
    async fn import_file(&self) {
        let title = "Import UTF-8 .txt file (one message per line)";
        let Some(filename) = self.text(title, "C:\\path\\messages.txt").await else { return };
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| "~".to_owned());
        let expanded = match filename.strip_prefix('~') {
            Some(rest) if rest.starts_with(['/', '\\']) => format!("{home}{rest}"),
            _ => filename.clone(),
        };
        let path = std::path::absolute(&expanded).unwrap_or_else(|_| expanded.clone().into());
        let read = std::fs::read_to_string(&path).map_err(|error| error.to_string());
        let lines = match read.and_then(|content| core::parse_message_lines(&content)) {
            Ok(lines) => lines,
            Err(error) => return self.report(&error).await,
        };
        let message = format!("Stage {} messages from {}?", lines.len(), path.display());
        if self.confirm("Import message list", &message, ("Import", "Cancel")).await {
            let count = lines.len();
            self.store([self.entries(), lines].concat());
            self.toast("Imported", &format!("{count} messages staged. Nothing has been submitted to OpenCode yet."));
        }
    }

    /// TS `addOne`.
    async fn add_one(&self) {
        let Some(text) = self.text("Add one draft message", "Your prompt").await else { return };
        self.store([self.entries(), vec![text]].concat());
        self.toast("Added", "Message appended to the draft list.");
    }

    /// TS `manageDrafts`.
    async fn manage_drafts(&self) {
        loop {
            let list = self.entries();
            if list.is_empty() {
                return self.alert("Drafts", "Draft list is empty.").await;
            }
            let mut options: Vec<SelectOption> = list
                .iter()
                .enumerate()
                .map(|(index, text)| {
                    SelectOption::new(format!("{:03}. {}", index + 1, core::summarize(text, 90)), index.to_string())
                })
                .collect();
            options.push(SelectOption::new("Back", "back"));
            let selected = self.choose(&format!("Drafts ({}) - choose one", list.len()), options).await;
            let Some(selected) = selected.filter(|selected| selected != "back") else { return };
            let Ok(index) = selected.parse::<usize>() else { continue };
            let actions = [
                ("Replace text", "edit"),
                ("Move up", "up"),
                ("Move down", "down"),
                ("Move to top", "top"),
                ("Move to bottom", "bottom"),
                ("Duplicate", "duplicate"),
                ("Delete", "delete"),
                ("Back", "back"),
            ];
            let actions = actions.map(|(title, value)| SelectOption::new(title, value)).to_vec();
            let Some(action) = self.choose(&format!("Draft #{}", index + 1), actions).await else { continue };
            let last = list.len().saturating_sub(1);
            let next = match action.as_str() {
                "edit" => {
                    let placeholder = core::summarize(list.get(index).map_or("", String::as_str), 65);
                    let title = format!("Replace draft #{}", index + 1);
                    let Some(text) = self.text(&title, &placeholder).await else { continue };
                    core::edit_at(&list, index, &text)
                }
                "delete" => core::delete_at(&list, index),
                "duplicate" if index < list.len() => {
                    let mut next = list.clone();
                    next.insert(index + 1, list[index].clone());
                    Ok(next)
                }
                "up" => core::move_at(&list, index, index.saturating_sub(1)),
                "down" => core::move_at(&list, index, (index + 1).min(last)),
                "top" => core::move_at(&list, index, 0),
                "bottom" => core::move_at(&list, index, last),
                _ => continue,
            };
            match next {
                Ok(list) => self.store(list),
                Err(error) => self.report(&error).await,
            }
        }
    }

    /// TS `draftSort`.
    async fn draft_sort(&self) {
        let options = vec![
            SelectOption::new("Reverse order", "reverse"),
            SelectOption::new("Sort A-Z", "asc"),
            SelectOption::new("Sort Z-A", "desc"),
        ];
        let Some(action) = self.choose("Reorder draft list", options).await else { return };
        let mut list = self.entries();
        match action.as_str() {
            "reverse" => list.reverse(),
            _ => list.sort_by_key(|text| text.to_lowercase()),
        }
        if action == "desc" {
            list.reverse();
        }
        self.store(list);
        self.toast("Sorted", "Only the local draft order was changed.");
    }

    /// TS `clearDrafts`.
    async fn clear_drafts(&self) {
        let count = self.entries().len();
        if count == 0 {
            return;
        }
        let message = format!("Delete {count} draft entries? Native OpenCode pending prompts are NOT affected.");
        if self.confirm("Clear draft list?", &message, ("Clear drafts", "Cancel")).await {
            self.store(Vec::new());
        }
    }

    /// TS `publishDrafts` with `flushDrafts`: the first draft goes to the queue, and leaves the drafts once it is
    /// admitted.
    async fn publish_drafts(&self) {
        let count = self.entries().len();
        if count == 0 {
            return;
        }
        let message = format!(
            "Send {count} messages with delivery=queue to THIS session? They may begin executing immediately as the session becomes idle. This can incur provider costs."
        );
        if !self.confirm("Publish to OpenCode native queue?", &message, ("Publish", "Cancel")).await {
            return;
        }
        let mut sent = 0;
        while let Some(text) = self.entries().first().cloned() {
            let input = SessionPromptInput {
                session_id: self.session.clone(),
                text: text.clone(),
                delivery: Some(Some(SessionInboxDelivery::Queue)),
                ..Default::default()
            };
            if let Err(error) = self.cx.send(client::session_prompt(&input)).await.and_then(|()| self.drop_first(&text))
            {
                let left = self.entries().len();
                self.toast(
                    "Partial publish",
                    &format!("{} admitted, {left} still in drafts.", count - left.min(count)),
                );
                return self.report(&error).await;
            }
            sent += 1;
        }
        self.toast("Published", &format!("{sent} messages admitted to the native queue."));
    }

    /// TS `nativeInbox`.
    async fn native_inbox(&self) -> Result<(), String> {
        loop {
            let items = self.inbox().await?;
            if items.is_empty() {
                self.alert("Native inbox", "No pending items.").await;
                return Ok(());
            }
            let mut options: Vec<SelectOption> = items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let label = match item {
                        SessionInboxInfo::User(user) => core::summarize(&user.payload.text, 90),
                        SessionInboxInfo::Synthetic(synthetic) => core::summarize(&synthetic.payload.text, 90),
                        _ => format!("[{}]", item.tag()),
                    };
                    SelectOption::new(format!("{:03}. {label}", index + 1), item.id())
                        .maybe(item.delivery().map(SessionInboxDelivery::as_str), SelectOption::description)
                })
                .collect();
            options.push(SelectOption::new("Back", "back"));
            let selected = self.choose(&format!("OpenCode native inbox ({})", items.len()), options).await;
            let Some(selected) = selected.filter(|selected| selected != "back") else { return Ok(()) };
            let Some(item) = items.iter().find(|item| item.id() == selected) else { continue };
            let title = format!("Pending item ({})", item.tag());
            let options =
                vec![SelectOption::new("Cancel this pending item", "cancel"), SelectOption::new("Back", "back")];
            if self.choose(&title, options).await.as_deref() != Some("cancel") {
                continue;
            }
            let message =
                "This cannot stop a message already being executed; only still-pending items can be cancelled.";
            if !self.confirm("Cancel pending item?", message, ("Cancel item", "Keep")).await {
                continue;
            }
            if let Err(error) = self.cancel(item.id()).await {
                self.report(&error).await;
            }
        }
    }

    /// TS `clearNativeUserPrompts`.
    async fn clear_native(&self) -> Result<(), String> {
        let ids: Vec<String> = self
            .inbox()
            .await?
            .iter()
            .filter(|item| matches!(item, SessionInboxInfo::User(user) if user.delivery == SessionInboxDelivery::Queue))
            .map(|item| item.id().to_owned())
            .collect();
        if ids.is_empty() {
            self.alert("Native inbox", "No queued user prompts to cancel.").await;
            return Ok(());
        }
        let message = format!(
            "Cancel {} queued USER prompts? Synthetic, move and compaction entries will be kept. This does not stop active execution.",
            ids.len()
        );
        let title = "Cancel ALL native queued user prompts?";
        if !self.confirm(title, &message, ("Cancel queued prompts", "Keep all")).await {
            return Ok(());
        }
        for (done, id) in ids.iter().enumerate() {
            if let Err(error) = self.cancel(id).await {
                self.toast("Partial clear", &format!("{done} cancellations completed before the error."));
                self.report(&error).await;
                return Ok(());
            }
        }
        self.toast("Cleared", &format!("{} pending prompts cancellation requested.", ids.len()));
        Ok(())
    }

    /// The session's pending inbox items.
    async fn inbox(&self) -> Result<Vec<SessionInboxInfo>, String> {
        self.cx.call(client::session_inbox_list(&SessionInboxListInput { session_id: self.session.clone() })).await
    }

    /// Cancels the pending item `id`.
    async fn cancel(&self, id: &str) -> Result<(), String> {
        let input = SessionInboxCancelInput { session_id: self.session.clone(), inbox_id: SessionMessageID(id.into()) };
        self.cx.send(client::session_inbox_cancel(&input)).await
    }

    fn entries(&self) -> Vec<String> {
        let stored = self.cx.with(|host| host.storage_get(DRAFTS)).unwrap_or(Value::Null);
        let list = stored["sessions"][self.session.as_str()].as_array().cloned().unwrap_or_default();
        list.iter().filter_map(|text| text.as_str().map(str::to_owned)).collect()
    }

    /// TS `storeEntries`: the session's list in the stored drafts.
    fn store(&self, list: Vec<String>) {
        let mut stored =
            self.cx.with(|host| host.storage_get(DRAFTS)).filter(Value::is_object).unwrap_or_else(|| json!({}));
        if !stored["sessions"].is_object() {
            stored["sessions"] = json!({});
        }
        stored["sessions"][self.session.as_str()] = json!(list);
        self.cx.with(|host| host.storage_set(DRAFTS, stored));
    }

    /// TS `dropAccepted`: the admitted draft leaves the list, unless the list changed meanwhile.
    fn drop_first(&self, text: &str) -> Result<(), String> {
        let mut list = self.entries();
        if list.first().map(String::as_str) != Some(text) {
            return Err("Concurrent draft change detected; inspect drafts before retrying.".to_owned());
        }
        list.remove(0);
        self.store(list);
        Ok(())
    }

    fn toast(&self, title: &str, message: &str) {
        self.cx.with(|host| host.toast(Toast::new(Variant::Info, message).title(title)));
    }

    /// TS `reportError`.
    async fn report(&self, error: &str) {
        self.alert("Queue Manager - Error", error).await;
    }

    async fn alert(&self, title: &str, message: &str) {
        self.cx.alert(Alert::new(title, message)).await;
    }

    async fn choose(&self, title: &str, options: Vec<SelectOption>) -> Option<String> {
        self.cx.select(Select::ask(title, options)).await
    }

    /// TS `getText`.
    async fn text(&self, title: &str, placeholder: &str) -> Option<String> {
        self.cx.prompt(Prompt::ask(title).placeholder(placeholder)).await.and_then(|value| text(&value))
    }

    /// A confirm with its own labels; whether it was confirmed.
    async fn confirm(&self, title: &str, message: &str, (yes, no): (&str, &str)) -> bool {
        self.cx.confirm(Confirm::ask(title, message).labels(yes, no)).await == Some(true)
    }
}

/// The trimmed text, unless it is blank.
fn text(value: &str) -> Option<String> {
    Some(value.trim().to_owned()).filter(|text| !text.is_empty())
}

plugin!(id = "queue.manager.tui", setup);
