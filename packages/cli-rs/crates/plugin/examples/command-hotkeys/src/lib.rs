//! A port of `opencode-command-hotkeys` 0.1.1 (`dist/tui.js`): keys and palette entries, from the plugin's options,
//! that run a server command in the session in view, or pause and resume its goal.
//!
//! Options are `{ "bindings": [{ "id", "key", "title", "command", "text"? }, { "id", "key", "title", "action":
//! "goal-toggle" }] }`, checked whole before anything registers: an unknown field, a repeated `id` or key, or a bad
//! value toasts and registers nothing, and no value is echoed. A key holds in the base mode on a session's route; off
//! one it goes on to the host, as TS's disabled command lets it. One run per session and binding goes at a time, a task
//! that awaits each of its requests as TS does.

use std::cell::RefCell;
use std::collections::HashSet;
use std::rc::Rc;

use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin_abi::task::{Cx, Tasks};
use opencode_plugin_abi::types::{LocationQueryInput, RpcCallInput, SessionCommandInput, SessionGetInput, SessionID};
use opencode_plugin_abi::{Command, Host, Route, Setup, Toast, Variant, client, plugin};
use serde_json::{Value, json};

const TITLE: &str = "Command Hotkeys";
const INVALID: &str = "Проверьте bindings: строки id, key, title; для action command нужны command и необязательный \
                       text, для goal-toggle они запрещены. Неизвестные поля и повторяющиеся id/key запрещены.";
const FAILED: &str = "Не удалось выполнить команду. Проверьте её имя и аргументы в настройках плагина, доступность \
                      сессии и повторите попытку.";

struct Binding {
    id: String,
    key: String,
    title: String,
    action: Action,
}

enum Action {
    Command { command: String, text: String },
    GoalToggle,
}

/// What runs a binding: its tasks, and the session and binding of each run in flight.
#[derive(Clone)]
struct Runs {
    tasks: Tasks,
    locks: Rc<RefCell<HashSet<(String, String)>>>,
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options: Value = setup.options().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_else(|| json!({}));
    let Ok(bindings) = parse(&options) else {
        setup.host().toast(Toast::new(Variant::Error, INVALID).title(TITLE));
        return Ok(());
    };
    if bindings.is_empty() {
        return Ok(());
    }
    let bindings: Rc<Vec<Rc<Binding>>> = Rc::new(bindings.into_iter().map(Rc::new).collect());
    let runs = Runs { tasks: setup.tasks(), locks: Rc::default() };
    for binding in bindings.iter() {
        let command = Command::new(format!("command-hotkeys.{}", binding.id)).title(&binding.title).palette();
        let (binding, runs) = (binding.clone(), runs.clone());
        setup.command(command, move |host, _| {
            // The palette closed before the command runs, so the keyboard is in its base mode again.
            if host.mode().is_none() {
                runs.execute(host, &binding);
            }
        });
    }
    // The keys, each alternative of `a,b` a key of its own, named by its binding's place.
    let keys = bindings.iter().enumerate().flat_map(|(index, binding)| {
        let title = binding.title.clone();
        binding.key.split(',').map(move |key| Bind::new(key.trim(), index.to_string()).title(title.clone()))
    });
    setup.layer(Layer::default().scope(LayerScope::Global).keys(keys), move |host, event| {
        let Event::Key(key) = event else { return Handled::Pass };
        let Some(binding) = key.bind.as_deref().and_then(|index| bindings.get(index.parse::<usize>().ok()?)) else {
            return Handled::Pass;
        };
        if !matches!(host.route(), Route::Session { .. }) {
            return Handled::Pass;
        }
        runs.execute(host, binding);
        Handled::Consume
    });
    Ok(())
}

impl Runs {
    /// TS `execute`: one run per session and binding at a time; a failure toasts.
    fn execute(&self, host: &dyn Host, binding: &Rc<Binding>) {
        let Route::Session { id: session } = host.route() else { return };
        let lock = (session.clone(), binding.id.clone());
        if !self.locks.borrow_mut().insert(lock.clone()) {
            return;
        }
        let (binding, locks) = (binding.clone(), self.locks.clone());
        self.tasks.spawn(host, move |cx| async move {
            let ran = match &binding.action {
                Action::Command { command, text } => run_command(&cx, &session, command, text).await,
                Action::GoalToggle => toggle(&cx, &session).await,
            };
            locks.borrow_mut().remove(&lock);
            if ran.is_err() {
                cx.with(|host| host.toast(Toast::new(Variant::Error, FAILED).title(TITLE).session(session)));
            }
        });
    }
}

/// TS's goal toggle: the session's location, its goal, then a pause or a resume. A step whose session is no longer
/// in view, in the base mode, ends the run; an answer that the goal already was so is no failure.
async fn toggle(cx: &Cx, session: &str) -> Result<(), String> {
    let current = || cx.with(|host| host.mode().is_none() && host.route() == Route::Session { id: session.to_owned() });
    let info = cx.call(client::session_get(&SessionGetInput { session_id: SessionID(session.to_owned()) })).await?;
    if !current() {
        return Ok(());
    }
    let directory = Some(info.location.directory.0).filter(|path| !path.trim().is_empty());
    let input = RpcCallInput {
        rpc_id: "opencode.goal".to_owned(),
        method: "get".to_owned(),
        location: Some(LocationQueryInput { directory: Some(directory.ok_or("no directory")?) }),
        input: Some(json!({ "sessionID": session })),
    };
    let reply = cx.call(client::rpc_call(&input)).await?;
    if !current() {
        return Ok(());
    }
    let Some(goal) = reply.output.filter(|goal| !goal.is_null()) else { return Ok(()) };
    let id = goal.get("id").and_then(Value::as_str).filter(|id| !id.trim().is_empty());
    let (text, race) = match (id, goal.get("status").and_then(Value::as_str)) {
        (Some(_), Some("complete")) => return Ok(()),
        (Some(_), Some("active")) => ("pause", "No active goal to pause."),
        (Some(_), Some("paused")) => ("resume", "No paused goal to resume."),
        _ => return Err("no goal".to_owned()),
    };
    match run_command(cx, session, "goal", text).await {
        Err(error) if !error.contains(race) => Err(error),
        _ => Ok(()),
    }
}

/// TS `ctx.client.session.command`.
async fn run_command(cx: &Cx, session: &str, name: &str, text: &str) -> Result<(), String> {
    let input = SessionCommandInput {
        session_id: SessionID(session.to_owned()),
        name: name.to_owned(),
        text: text.to_owned(),
        ..Default::default()
    };
    cx.send(client::session_command(&input)).await
}

/// TS `parseBindings`: the whole configuration, or `Err` for any fault in it.
fn parse(options: &Value) -> Result<Vec<Binding>, ()> {
    let options = options.as_object().ok_or(())?;
    if options.keys().any(|key| key != "bindings") {
        return Err(());
    }
    let Some(list) = options.get("bindings") else { return Ok(Vec::new()) };
    let (mut ids, mut keys) = (HashSet::new(), HashSet::new());
    list.as_array()
        .ok_or(())?
        .iter()
        .map(|value| {
            let value = value.as_object().ok_or(())?;
            const FIELDS: [&str; 6] = ["id", "key", "title", "action", "command", "text"];
            if value.keys().any(|key| !FIELDS.contains(&key.as_str())) {
                return Err(());
            }
            let field =
                |name: &str| value.get(name).and_then(Value::as_str).map(str::trim).filter(|text| !text.is_empty());
            let (Some(id), Some(key), Some(title)) = (field("id"), field("key"), field("title")) else {
                return Err(());
            };
            let action = match value.get("action") {
                Some(Value::String(action)) if action == "goal-toggle" => {
                    if value.contains_key("command") || value.contains_key("text") {
                        return Err(());
                    }
                    Action::GoalToggle
                }
                None => command(value)?,
                Some(Value::String(action)) if action == "command" => command(value)?,
                Some(_) => return Err(()),
            };
            if !ids.insert(id.to_owned()) {
                return Err(());
            }
            for alternative in key.split(',') {
                if alternative.trim().is_empty() || !keys.insert(identity(alternative)) {
                    return Err(());
                }
            }
            Ok(Binding { id: id.to_owned(), key: key.to_owned(), title: title.to_owned(), action })
        })
        .collect()
}

/// A binding's `command` and `text`: a command name without a leading `/` or spaces.
fn command(value: &serde_json::Map<String, Value>) -> Result<Action, ()> {
    let command = value.get("command").and_then(Value::as_str).map(str::trim).filter(|command| !command.is_empty());
    let command =
        command.filter(|command| !command.starts_with('/') && !command.contains(char::is_whitespace)).ok_or(())?;
    let text = match value.get("text") {
        None => String::new(),
        Some(Value::String(text)) => text.clone(),
        Some(_) => return Err(()),
    };
    Ok(Action::Command { command: command.to_owned(), text })
}

/// TS `keyIdentity`: a key with its aliases named one way and the modifiers before its last part sorted, so
/// `Shift+Control+X` and `ctrl+shift+x` are one key.
fn identity(key: &str) -> String {
    fn alias(part: &str) -> &str {
        match part {
            "enter" => "return",
            "esc" => "escape",
            "pgdown" => "pagedown",
            "pgup" => "pageup",
            "control" => "ctrl",
            "option" | "alt" => "meta",
            other => other,
        }
    }
    let key = key.trim().to_lowercase();
    let mut joined = String::new();
    for (index, part) in key.split('+').enumerate() {
        if index > 0 {
            joined.push('+');
        }
        joined.push_str(part.trim());
    }
    joined
        .split_whitespace()
        .map(|step| {
            let mut parts: Vec<&str> = step.split('+').map(alias).collect();
            let last = parts.pop().unwrap_or_default();
            parts.sort_unstable();
            parts.push(last);
            parts.join("+")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

plugin!(id = "command-hotkeys", setup);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_names_aliases_one_way_and_sorts_modifiers() {
        assert_eq!(identity("Ctrl + Enter"), "ctrl+return");
        assert_eq!(identity("shift+control+x"), "ctrl+shift+x");
        assert_eq!(identity("alt+esc ctrl+g"), "meta+escape ctrl+g");
    }

    #[test]
    fn parse_takes_a_whole_configuration_or_none() {
        let good = json!({ "bindings": [
            { "id": "review", "key": "alt+r", "title": "Review", "command": "review", "text": "--all" },
            { "id": "goal", "key": "alt+g,alt+h", "title": "Goal", "action": "goal-toggle" },
        ] });
        assert_eq!(parse(&good).map(|list| list.len()), Ok(2));
        assert_eq!(parse(&json!({})).map(|list| list.len()), Ok(0));
        for bad in [
            json!({ "bindings": {} }),
            json!({ "other": [] }),
            json!({ "bindings": [{ "id": "a", "key": "x", "title": "A", "command": "/slash" }] }),
            json!({ "bindings": [{ "id": "a", "key": "x", "title": "A", "command": "two words" }] }),
            json!({ "bindings": [{ "id": "a", "key": "x", "title": "A", "action": "goal-toggle", "text": "t" }] }),
            json!({ "bindings": [{ "id": "a", "key": "x", "title": "A", "command": "c", "extra": 1 }] }),
            json!({ "bindings": [{ "id": "a", "key": "ctrl+x", "title": "A", "command": "c" }, { "id": "b", "key": "control+X", "title": "B", "command": "c" }] }),
            json!({ "bindings": [{ "id": "a", "key": "x", "title": "A", "command": "c" }, { "id": "a", "key": "y", "title": "B", "command": "c" }] }),
        ] {
            assert!(parse(&bad).is_err(), "{bad}");
        }
    }
}
