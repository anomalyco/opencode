//! A port of `@bybrawe/opencode-queue-manager` 0.3.5 (`src/tui.ts`): `/qm` opens a menu that comes back after each
//! task. It stages drafts per session (repeated, one at a time, or the lines of a file), edits, moves, sorts and clears
//! them, publishes them to the session's queue one by one, and lists and cancels the session's pending inbox items.
//! The drafts are stored as TS stores them, under the original's ID.
//!
//! TS writes it as a chain of awaited dialogs; here each open dialog is an [`Ask`], and its answer or its close
//! (escape) goes on to the next one as TS's code would. Where it differs from TS: sorting compares by code point after
//! lowercasing, where TS collates in Turkish (`localeCompare(b, "tr")`), and the host's list of the session's pending
//! items follows its own reads and events, as the SDK has no `pending.sync`.

mod core;

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use opencode_plugin_abi::{
    Action, Alert, Command, Confirm, Dialog, Fetch, Host, Prompt, RequestId, Route, Select, SelectOption, Setup, Toast,
    Variant, plugin,
};
use serde_json::{Value, json};

const DRAFTS: &str = "queue-manager.drafts.v1";
const ANSWER: &str = "queue.manager.answer";
const CLOSED: &str = "queue.manager.closed";

fn setup(setup: &mut Setup) -> Result<(), String> {
    let state = Rc::new(RefCell::new(State::default()));
    setup.storage_key(DRAFTS);
    let open = Command::new("queue.manager.open").title("Queue Manager").group("Queue Manager").palette().slash("qm");
    let opened = state.clone();
    setup.command(open, move |host, _| opened.borrow_mut().open(host));
    let answered = state.clone();
    setup.command(Command::new(ANSWER), move |host, input| {
        let mut state = answered.borrow_mut();
        if let Some((_, ask)) = state.asking.take() {
            state.answer(host, ask, Some(input.unwrap_or_default().to_owned()));
        }
    });
    // Each dialog's close names its generation: it is an escape only while that dialog still waits for its answer.
    let closed = state.clone();
    setup.command(Command::new(CLOSED), move |host, input| {
        let mut state = closed.borrow_mut();
        let generation = input.and_then(|input| input.parse::<u32>().ok());
        if state.asking.as_ref().is_some_and(|(at, _)| Some(*at) == generation) {
            let (_, ask) = state.asking.take().expect("asked");
            state.answer(host, ask, None);
        }
    });
    let replied = state.clone();
    setup.on_reply(move |host, id, reply| replied.borrow_mut().reply(host, id, reply));
    Ok(())
}

/// What the open dialog asks, which its answer goes on from.
enum Ask {
    Menu {
        drafts: usize,
    },
    AddOne,
    Import,
    ImportConfirm {
        lines: Vec<String>,
    },
    Count,
    CustomCount,
    Preset {
        count: u32,
    },
    CustomMessage {
        count: u32,
    },
    Stage {
        count: u32,
        text: String,
    },
    Drafts,
    Actions {
        index: usize,
    },
    Replace {
        index: usize,
    },
    Sort,
    ClearDrafts,
    Publish,
    Inbox {
        items: Vec<Value>,
    },
    Item {
        item: Value,
    },
    Cancel {
        id: String,
    },
    ClearNative {
        ids: Vec<String>,
    },
    /// An alert, and where its close goes on.
    Alert {
        then: Then,
    },
}

/// Where a task goes on once it ends: the menu again (TS's loop), the inbox's list (its own loop), or nowhere.
#[derive(Clone, Copy)]
enum Then {
    Menu,
    Inbox,
    Close,
}

/// What a request in flight is for.
enum Want {
    /// The pending count of the menu.
    Menu,
    Inbox,
    ClearNative,
    Publish {
        text: String,
        sent: usize,
        count: usize,
    },
    Cancel,
    CancelEach {
        left: Vec<String>,
        done: usize,
    },
}

#[derive(Default)]
struct State {
    /// The session the menu was opened in.
    session: String,
    asking: Option<(u32, Ask)>,
    generation: u32,
    waiting: HashMap<RequestId, Want>,
}

impl State {
    /// TS `openManager`.
    fn open(&mut self, host: &dyn Host) {
        let Route::Session { id } = host.route() else {
            let message = "Open a session in the OpenCode v2 terminal UI first, then run /qm.";
            return self.alert(host, "Queue Manager", message, Then::Close);
        };
        self.session = id;
        self.menu(host);
    }

    /// One round of TS's menu loop: the pending count, then the menu.
    fn menu(&mut self, host: &dyn Host) {
        self.inbox_list(host, Want::Menu);
    }

    fn show_menu(&mut self, host: &dyn Host, pending: usize) {
        let drafts = self.entries(host).len();
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
        self.choose(
            host,
            &title,
            options.map(|(title, value)| SelectOption::new(title, value)).to_vec(),
            Ask::Menu { drafts },
        );
    }

    /// The answer to `ask`: what it chose or typed, or `None` when it closed without one.
    fn answer(&mut self, host: &dyn Host, ask: Ask, value: Option<String>) {
        let Some(value) = value else { return self.escaped(host, ask) };
        match ask {
            Ask::Menu { drafts } => self.chosen(host, &value, drafts),
            Ask::AddOne => match text(&value) {
                Some(text) => {
                    self.store(host, [self.entries(host), vec![text]].concat());
                    self.toast(host, "Added", "Message appended to the draft list.");
                    self.menu(host);
                }
                None => self.menu(host),
            },
            Ask::Import => match text(&value) {
                Some(path) => self.import(host, &path),
                None => self.menu(host),
            },
            Ask::ImportConfirm { lines } => {
                if value == "true" {
                    let count = lines.len();
                    self.store(host, [self.entries(host), lines].concat());
                    let message = format!("{count} messages staged. Nothing has been submitted to OpenCode yet.");
                    self.toast(host, "Imported", &message);
                }
                self.menu(host);
            }
            Ask::Count if value == "custom" => self.prompt(host, "How many?", "e.g. 150", Ask::CustomCount),
            Ask::Count | Ask::CustomCount => match text(&value).map(|raw| core::normalize_count(&raw)) {
                Some(Ok(count)) => self.presets(host, count),
                Some(Err(error)) => self.error(host, &error, Then::Menu),
                None => self.menu(host),
            },
            Ask::Preset { count } if value == "custom" => {
                self.prompt(host, "Message to repeat", "your prompt", Ask::CustomMessage { count });
            }
            Ask::Preset { count } | Ask::CustomMessage { count } => match text(&value) {
                Some(text) => {
                    let message = format!(
                        "Stage {count} copies of '{}'? No prompts will be sent yet.",
                        core::summarize(&text, 55)
                    );
                    let ask = Ask::Stage { count, text };
                    self.confirm(host, "Create repeated draft items?", &message, ("Stage", "Cancel"), ask);
                }
                None => self.menu(host),
            },
            Ask::Stage { count, text } => {
                if value == "true" {
                    match core::repeat_message(&text, count) {
                        Ok(copies) => {
                            self.store(host, [self.entries(host), copies].concat());
                            let message =
                                format!("{count} items added. Use 'Publish drafts' to send them to the native queue.");
                            self.toast(host, "Draft ready", &message);
                        }
                        Err(error) => return self.error(host, &error, Then::Menu),
                    }
                }
                self.menu(host);
            }
            Ask::Drafts if value == "back" => self.menu(host),
            Ask::Drafts => match value.parse::<usize>() {
                Ok(index) => self.actions(host, index),
                Err(_) => self.drafts(host),
            },
            Ask::Actions { index } => self.act(host, index, &value),
            Ask::Replace { index } => {
                if let Some(text) = text(&value) {
                    match core::edit_at(&self.entries(host), index, &text) {
                        Ok(list) => self.store(host, list),
                        Err(error) => return self.error(host, &error, Then::Menu),
                    }
                }
                self.drafts(host);
            }
            Ask::Sort => {
                let mut list = self.entries(host);
                match value.as_str() {
                    "reverse" => list.reverse(),
                    _ => list.sort_by_key(|text| text.to_lowercase()),
                }
                if value == "desc" {
                    list.reverse();
                }
                self.store(host, list);
                self.toast(host, "Sorted", "Only the local draft order was changed.");
                self.menu(host);
            }
            Ask::ClearDrafts => {
                if value == "true" {
                    self.store(host, Vec::new());
                }
                self.menu(host);
            }
            Ask::Publish if value == "true" => self.publish(host, 0, self.entries(host).len()),
            Ask::Publish => self.menu(host),
            Ask::Inbox { .. } if value == "back" => self.menu(host),
            Ask::Inbox { items } => match items.into_iter().find(|item| item["id"].as_str() == Some(value.as_str())) {
                Some(item) => {
                    let title = format!("Pending item ({})", item["type"].as_str().unwrap_or_default());
                    let options = vec![
                        SelectOption::new("Cancel this pending item", "cancel"),
                        SelectOption::new("Back", "back"),
                    ];
                    self.choose(host, &title, options, Ask::Item { item });
                }
                None => self.inbox(host),
            },
            Ask::Item { item } if value == "cancel" => {
                let message =
                    "This cannot stop a message already being executed; only still-pending items can be cancelled.";
                let id = item["id"].as_str().unwrap_or_default().to_owned();
                self.confirm(host, "Cancel pending item?", message, ("Cancel item", "Keep"), Ask::Cancel { id });
            }
            Ask::Item { .. } => self.inbox(host),
            Ask::Cancel { id } if value == "true" => {
                let fetch = Fetch::new("DELETE", format!("/api/session/{}/inbox/{id}", self.session));
                self.ask(host, fetch, Want::Cancel, Then::Inbox);
            }
            Ask::Cancel { .. } => self.inbox(host),
            Ask::ClearNative { ids } if value == "true" => self.cancel_each(host, ids, 0),
            Ask::ClearNative { .. } => self.menu(host),
            Ask::Alert { then } => self.then(host, then),
        }
    }

    /// What a close without an answer goes on to, as TS's `undefined` does where it awaited.
    fn escaped(&mut self, host: &dyn Host, ask: Ask) {
        match ask {
            Ask::Menu { .. } => {}
            Ask::Actions { .. } | Ask::Replace { .. } => self.drafts(host),
            Ask::Item { .. } | Ask::Cancel { .. } => self.inbox(host),
            Ask::Alert { then } => self.then(host, then),
            _ => self.menu(host),
        }
    }

    fn then(&mut self, host: &dyn Host, then: Then) {
        match then {
            Then::Menu => self.menu(host),
            Then::Inbox => self.inbox(host),
            Then::Close => {}
        }
    }

    /// An item of the menu.
    fn chosen(&mut self, host: &dyn Host, value: &str, drafts: usize) {
        match value {
            "repeat" => {
                let mut options: Vec<SelectOption> =
                    [10, 25, 50, 100, 200].iter().map(|n| SelectOption::new(n.to_string(), n.to_string())).collect();
                options.push(SelectOption::new("Custom (1-500)", "custom"));
                self.choose(host, "Repeat count", options, Ask::Count);
            }
            "one" => self.prompt(host, "Add one draft message", "Your prompt", Ask::AddOne),
            "import" => {
                let title = "Import UTF-8 .txt file (one message per line)";
                self.prompt(host, title, "C:\\path\\messages.txt", Ask::Import);
            }
            "drafts" => self.drafts(host),
            "sort" => {
                let options = vec![
                    SelectOption::new("Reverse order", "reverse"),
                    SelectOption::new("Sort A-Z", "asc"),
                    SelectOption::new("Sort Z-A", "desc"),
                ];
                self.choose(host, "Reorder draft list", options, Ask::Sort);
            }
            "publish" if drafts > 0 => {
                let message = format!(
                    "Send {drafts} messages with delivery=queue to THIS session? They may begin executing immediately as the session becomes idle. This can incur provider costs."
                );
                self.confirm(host, "Publish to OpenCode native queue?", &message, ("Publish", "Cancel"), Ask::Publish);
            }
            "native" => self.inbox(host),
            "clear-drafts" if drafts > 0 => {
                let message =
                    format!("Delete {drafts} draft entries? Native OpenCode pending prompts are NOT affected.");
                self.confirm(host, "Clear draft list?", &message, ("Clear drafts", "Cancel"), Ask::ClearDrafts);
            }
            "clear-native" => self.inbox_list(host, Want::ClearNative),
            "exit" => {}
            _ => self.menu(host),
        }
    }

    fn presets(&mut self, host: &dyn Host, count: u32) {
        let options = ["devam et", "continue", "testleri çalıştır ve hataları düzelt"]
            .iter()
            .map(|text| SelectOption::new(*text, *text))
            .chain([SelectOption::new("Custom message", "custom")])
            .collect();
        self.choose(host, "Choose message", options, Ask::Preset { count });
    }

    /// TS `importFile`: the file's lines, after a confirm. `~` is the home directory, as TS reads it.
    fn import(&mut self, host: &dyn Host, filename: &str) {
        let home = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).unwrap_or_else(|_| "~".to_owned());
        let expanded = match filename.strip_prefix('~') {
            Some(rest) if rest.starts_with(['/', '\\']) => format!("{home}{rest}"),
            _ => filename.to_owned(),
        };
        let path = std::path::absolute(&expanded).unwrap_or_else(|_| expanded.clone().into());
        let read = std::fs::read_to_string(&path).map_err(|error| error.to_string());
        match read.and_then(|content| core::parse_message_lines(&content)) {
            Ok(lines) => {
                let message = format!("Stage {} messages from {}?", lines.len(), path.display());
                let ask = Ask::ImportConfirm { lines };
                self.confirm(host, "Import message list", &message, ("Import", "Cancel"), ask);
            }
            Err(error) => self.error(host, &error, Then::Menu),
        }
    }

    /// TS `manageDrafts`' list.
    fn drafts(&mut self, host: &dyn Host) {
        let list = self.entries(host);
        if list.is_empty() {
            return self.alert(host, "Drafts", "Draft list is empty.", Then::Menu);
        }
        let mut options: Vec<SelectOption> = list
            .iter()
            .enumerate()
            .map(|(index, text)| {
                SelectOption::new(format!("{:03}. {}", index + 1, core::summarize(text, 90)), index.to_string())
            })
            .collect();
        options.push(SelectOption::new("Back", "back"));
        self.choose(host, &format!("Drafts ({}) - choose one", list.len()), options, Ask::Drafts);
    }

    fn actions(&mut self, host: &dyn Host, index: usize) {
        let options = [
            ("Replace text", "edit"),
            ("Move up", "up"),
            ("Move down", "down"),
            ("Move to top", "top"),
            ("Move to bottom", "bottom"),
            ("Duplicate", "duplicate"),
            ("Delete", "delete"),
            ("Back", "back"),
        ];
        let options = options.map(|(title, value)| SelectOption::new(title, value)).to_vec();
        self.choose(host, &format!("Draft #{}", index + 1), options, Ask::Actions { index });
    }

    /// An action on draft `index`; the list comes back after it.
    fn act(&mut self, host: &dyn Host, index: usize, action: &str) {
        let list = self.entries(host);
        let last = list.len().saturating_sub(1);
        let next = match action {
            "edit" => {
                let placeholder = core::summarize(list.get(index).map_or("", String::as_str), 65);
                let title = format!("Replace draft #{}", index + 1);
                return self.prompt(host, &title, &placeholder, Ask::Replace { index });
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
            _ => return self.drafts(host),
        };
        match next {
            Ok(list) => {
                self.store(host, list);
                self.drafts(host);
            }
            Err(error) => self.error(host, &error, Then::Menu),
        }
    }

    /// TS `flushDrafts`: the first draft goes to the queue, and leaves the drafts once it is admitted.
    fn publish(&mut self, host: &dyn Host, sent: usize, count: usize) {
        let Some(text) = self.entries(host).first().cloned() else {
            self.toast(host, "Published", &format!("{sent} messages admitted to the native queue."));
            return self.menu(host);
        };
        let fetch = Fetch::new("POST", format!("/api/session/{}/prompt", self.session))
            .body(json!({ "text": text, "delivery": "queue" }));
        self.ask(host, fetch, Want::Publish { text, sent, count }, Then::Menu);
    }

    /// TS `nativeInbox`: one round of its loop.
    fn inbox(&mut self, host: &dyn Host) {
        self.inbox_list(host, Want::Inbox);
    }

    fn inbox_list(&mut self, host: &dyn Host, want: Want) {
        let fetch = Fetch::new("GET", format!("/api/session/{}/inbox", self.session));
        // A list that fails ends the manager, as TS's outer `try` does.
        self.ask(host, fetch, want, Then::Close);
    }

    fn cancel_each(&mut self, host: &dyn Host, mut left: Vec<String>, done: usize) {
        if left.is_empty() {
            self.toast(host, "Cleared", &format!("{done} pending prompts cancellation requested."));
            return self.menu(host);
        }
        let id = left.remove(0);
        let fetch = Fetch::new("DELETE", format!("/api/session/{}/inbox/{id}", self.session));
        self.ask(host, fetch, Want::CancelEach { left, done }, Then::Menu);
    }

    fn reply(&mut self, host: &dyn Host, id: RequestId, reply: Result<Value, String>) {
        let Some(want) = self.waiting.remove(&id) else { return };
        let body = match reply {
            Ok(body) => body,
            Err(error) => return self.failed(host, want, &error),
        };
        let items = || body.get("data").unwrap_or(&body).as_array().cloned().unwrap_or_default();
        match want {
            Want::Menu => self.show_menu(host, items().len()),
            Want::Inbox => {
                let items = items();
                if items.is_empty() {
                    return self.alert(host, "Native inbox", "No pending items.", Then::Menu);
                }
                let mut options: Vec<SelectOption> = items
                    .iter()
                    .enumerate()
                    .map(|(index, item)| {
                        let kind = item["type"].as_str().unwrap_or_default();
                        let label = match kind {
                            "user" | "synthetic" => core::summarize(item["payload"]["text"].as_str().unwrap_or(""), 90),
                            _ => format!("[{kind}]"),
                        };
                        let option =
                            SelectOption::new(format!("{:03}. {label}", index + 1), item["id"].as_str().unwrap_or(""));
                        match item["delivery"].as_str() {
                            Some(delivery) => option.description(delivery),
                            None => option,
                        }
                    })
                    .collect();
                options.push(SelectOption::new("Back", "back"));
                self.choose(host, &format!("OpenCode native inbox ({})", items.len()), options, Ask::Inbox { items });
            }
            Want::ClearNative => {
                let ids: Vec<String> = items()
                    .iter()
                    .filter(|item| item["type"] == "user" && item["delivery"] == "queue")
                    .filter_map(|item| item["id"].as_str().map(str::to_owned))
                    .collect();
                if ids.is_empty() {
                    return self.alert(host, "Native inbox", "No queued user prompts to cancel.", Then::Menu);
                }
                let message = format!(
                    "Cancel {} queued USER prompts? Synthetic, move and compaction entries will be kept. This does not stop active execution.",
                    ids.len()
                );
                let title = "Cancel ALL native queued user prompts?";
                self.confirm(host, title, &message, ("Cancel queued prompts", "Keep all"), Ask::ClearNative { ids });
            }
            Want::Publish { text, sent, count } => {
                let mut list = self.entries(host);
                if list.first() != Some(&text) {
                    let error = "Concurrent draft change detected; inspect drafts before retrying.";
                    return self.failed(host, Want::Publish { text, sent, count }, error);
                }
                list.remove(0);
                self.store(host, list);
                self.publish(host, sent + 1, count);
            }
            Want::Cancel => self.inbox(host),
            Want::CancelEach { left, done } => self.cancel_each(host, left, done + 1),
        }
    }

    /// A request of `want` that failed: what TS's `catch` there does.
    fn failed(&mut self, host: &dyn Host, want: Want, error: &str) {
        match want {
            Want::Publish { count, .. } => {
                let left = self.entries(host).len();
                let message = format!("{} admitted, {left} still in drafts.", count - left.min(count));
                self.toast(host, "Partial publish", &message);
                self.error(host, error, Then::Menu);
            }
            Want::CancelEach { done, .. } => {
                self.toast(host, "Partial clear", &format!("{done} cancellations completed before the error."));
                self.error(host, error, Then::Menu);
            }
            Want::Cancel => self.error(host, error, Then::Inbox),
            Want::Menu | Want::Inbox | Want::ClearNative => self.error(host, error, Then::Close),
        }
    }

    /// Sends `fetch` for `want`; one the host refuses fails as TS's request would, and goes on to `then`.
    fn ask(&mut self, host: &dyn Host, fetch: Fetch, want: Want, then: Then) {
        match host.try_fetch(fetch) {
            Ok(id) => {
                self.waiting.insert(id, want);
            }
            Err(error) => self.error(host, &error, then),
        }
    }

    fn entries(&self, host: &dyn Host) -> Vec<String> {
        let stored = host.storage_get(DRAFTS).unwrap_or(Value::Null);
        let list = stored["sessions"][self.session.as_str()].as_array().cloned().unwrap_or_default();
        list.iter().filter_map(|text| text.as_str().map(str::to_owned)).collect()
    }

    /// TS `storeEntries`: the session's list in the stored drafts.
    fn store(&self, host: &dyn Host, list: Vec<String>) {
        let mut stored = host.storage_get(DRAFTS).filter(Value::is_object).unwrap_or_else(|| json!({}));
        if !stored["sessions"].is_object() {
            stored["sessions"] = json!({});
        }
        stored["sessions"][self.session.as_str()] = json!(list);
        host.storage_set(DRAFTS, stored);
    }

    fn toast(&self, host: &dyn Host, title: &str, message: &str) {
        host.toast(Toast::new(Variant::Info, message).title(title));
    }

    /// TS `reportError`.
    fn error(&mut self, host: &dyn Host, error: &str, then: Then) {
        self.alert(host, "Queue Manager - Error", error, then);
    }

    fn alert(&mut self, host: &dyn Host, title: &str, message: &str, then: Then) {
        self.show(host, Dialog::Alert(Alert::new(title, message)), Ask::Alert { then });
    }

    fn choose(&mut self, host: &dyn Host, title: &str, options: Vec<SelectOption>, ask: Ask) {
        self.show(host, Dialog::Select(Select::new(title, options, answer())), ask);
    }

    fn prompt(&mut self, host: &dyn Host, title: &str, placeholder: &str, ask: Ask) {
        self.show(host, Dialog::Prompt(Prompt::new(title, answer()).placeholder(placeholder)), ask);
    }

    /// A confirm with its own labels; its answer is `true` or `false`.
    fn confirm(&mut self, host: &dyn Host, title: &str, message: &str, (yes, no): (&str, &str), ask: Ask) {
        self.show(host, Dialog::Confirm(Confirm::new(title, message, answer()).labels(yes, no)), ask);
    }

    /// Opens `dialog` for `ask`, with a close that names its generation.
    fn show(&mut self, host: &dyn Host, dialog: Dialog, ask: Ask) {
        self.generation += 1;
        self.asking = Some((self.generation, ask));
        let dismissed = Action::command(CLOSED).input(self.generation.to_string());
        host.dialog(Dialog::Dismissable { dialog: Box::new(dialog), dismissed });
    }
}

fn answer() -> Action {
    Action::command(ANSWER)
}

/// TS `getText`: the trimmed text, unless it is blank.
fn text(value: &str) -> Option<String> {
    Some(value.trim().to_owned()).filter(|text| !text.is_empty())
}

plugin!(id = "queue.manager.tui", setup);
