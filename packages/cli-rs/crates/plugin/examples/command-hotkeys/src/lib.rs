//! A port of `opencode-command-hotkeys` 0.1.1 (`dist/tui.js`): keys and palette entries, from the plugin's options,
//! that run a server command in the session in view, or pause and resume its goal.
//!
//! Options are `{ "bindings": [{ "id", "key", "title", "command", "text"? }, { "id", "key", "title", "action":
//! "goal-toggle" }] }`, checked whole before anything registers: an unknown field, a repeated `id` or key, or a bad
//! value toasts and registers nothing, and no value is echoed. A key holds in the base mode on a session's route; off
//! one it goes on to the host, as TS's disabled command lets it. One request per session and binding runs at a time.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;

use opencode_plugin_abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin_abi::{Command, Fetch, Host, RequestId, Route, Setup, Toast, Variant, plugin};
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

/// A request in flight, by what its reply moves on to.
enum Step {
    /// A command ran; its reply ends the run.
    Command,
    /// The goal toggle read the session, for its location.
    Session,
    /// It read the goal.
    Goal,
    /// It asked the goal to pause or resume; a reply that it already had is no failure.
    Toggle { race: &'static str },
}

/// The runs in flight: the request each waits on, with its session and binding.
#[derive(Default)]
struct Runs {
    locks: HashSet<(String, String)>,
    waiting: HashMap<RequestId, (Step, String, String)>,
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
    let bindings = Rc::new(bindings);
    let runs = Rc::new(RefCell::new(Runs::default()));
    for (index, binding) in bindings.iter().enumerate() {
        let command = Command::new(format!("command-hotkeys.{}", binding.id)).title(&binding.title).palette();
        let (bindings, runs) = (bindings.clone(), runs.clone());
        setup.command(command, move |host, _| {
            // The palette closed before the command runs, so the keyboard is in its base mode again.
            if host.mode().is_none() {
                execute(host, &bindings[index], &runs);
            }
        });
    }
    // The keys, each alternative of `a,b` a key of its own, named by its binding's place.
    let keys = bindings.iter().enumerate().flat_map(|(index, binding)| {
        let title = binding.title.clone();
        binding.key.split(',').map(move |key| Bind::new(key.trim(), index.to_string()).title(title.clone()))
    });
    let (pressed, ran) = (bindings.clone(), runs.clone());
    setup.layer(Layer::default().scope(LayerScope::Global).keys(keys), move |host, event| {
        let Event::Key(key) = event else { return Handled::Pass };
        let Some(binding) = key.bind.as_deref().and_then(|index| pressed.get(index.parse::<usize>().ok()?)) else {
            return Handled::Pass;
        };
        if !matches!(host.route(), Route::Session { .. }) {
            return Handled::Pass;
        }
        execute(host, binding, &ran);
        Handled::Consume
    });
    setup.on_reply(move |host, id, reply| answered(host, &runs, id, reply));
    Ok(())
}

/// TS `execute`: one run per session and binding at a time.
fn execute(host: &dyn Host, binding: &Binding, runs: &RefCell<Runs>) {
    let Route::Session { id: session } = host.route() else { return };
    let lock = (session.clone(), binding.id.clone());
    if !runs.borrow_mut().locks.insert(lock) {
        return;
    }
    let (fetch, step) = match &binding.action {
        Action::Command { command, text } => (command_fetch(&session, command, text), Step::Command),
        Action::GoalToggle => {
            let fetch = Fetch::new("GET", format!("/api/session/{session}"));
            (fetch, Step::Session)
        }
    };
    send(host, runs, fetch, step, session, binding.id.clone());
}

/// The reply to a request of a run: the run's next request, its end, or its failure.
fn answered(host: &dyn Host, runs: &RefCell<Runs>, id: RequestId, reply: Result<Value, String>) {
    let Some((step, session, binding)) = runs.borrow_mut().waiting.remove(&id) else { return };
    let current = || host.mode().is_none() && host.route() == Route::Session { id: session.clone() };
    let next = match (step, reply) {
        (Step::Command, Ok(_)) => Ok(None),
        (Step::Toggle { .. }, Ok(_)) => Ok(None),
        (Step::Toggle { race }, Err(error)) if error.contains(race) => Ok(None),
        (_, Err(_)) => Err(()),
        (_, Ok(_)) if !current() => Ok(None),
        (Step::Session, Ok(body)) => {
            let directory =
                body.pointer("/data/location/directory").and_then(Value::as_str).filter(|path| !path.trim().is_empty());
            match directory {
                Some(directory) => {
                    let fetch = Fetch::new("POST", "/api/rpc/opencode.goal/get")
                        .query([("location[directory]", directory)])
                        .body(json!({ "input": { "sessionID": session } }));
                    Ok(Some((fetch, Step::Goal)))
                }
                None => Err(()),
            }
        }
        (Step::Goal, Ok(body)) => match body.get("output") {
            None | Some(Value::Null) => Ok(None),
            Some(goal) => match (goal.get("id").and_then(Value::as_str), goal.get("status").and_then(Value::as_str)) {
                (Some(id), Some(status)) if !id.trim().is_empty() => match status {
                    "complete" => Ok(None),
                    "active" => Ok(Some((
                        command_fetch(&session, "goal", "pause"),
                        Step::Toggle { race: "No active goal to pause." },
                    ))),
                    "paused" => Ok(Some((
                        command_fetch(&session, "goal", "resume"),
                        Step::Toggle { race: "No paused goal to resume." },
                    ))),
                    _ => Err(()),
                },
                _ => Err(()),
            },
        },
    };
    match next {
        Ok(Some((fetch, step))) => send(host, runs, fetch, step, session, binding),
        Ok(None) => drop(runs.borrow_mut().locks.remove(&(session, binding))),
        Err(()) => {
            runs.borrow_mut().locks.remove(&(session.clone(), binding));
            host.toast(Toast::new(Variant::Error, FAILED).title(TITLE).session(session));
        }
    }
}

/// Sends `fetch` for a run, or ends the run as failed when the host does not take it.
fn send(host: &dyn Host, runs: &RefCell<Runs>, fetch: Fetch, step: Step, session: String, binding: String) {
    match host.try_fetch(fetch) {
        Ok(id) => drop(runs.borrow_mut().waiting.insert(id, (step, session, binding))),
        Err(_) => {
            runs.borrow_mut().locks.remove(&(session.clone(), binding));
            host.toast(Toast::new(Variant::Error, FAILED).title(TITLE).session(session));
        }
    }
}

/// TS `ctx.client.session.command`.
fn command_fetch(session: &str, name: &str, text: &str) -> Fetch {
    Fetch::new("POST", format!("/api/session/{session}/command")).body(json!({ "name": name, "text": text }))
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
