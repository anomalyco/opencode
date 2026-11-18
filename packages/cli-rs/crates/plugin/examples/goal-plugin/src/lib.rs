//! A port of `@prevalentware/opencode-goal-plugin` 0.1.98's TUI (`src/tui.ts`, its V2 part): a sidebar block with the
//! session's goal, read from the newest goal tool result among the session's messages and from the goal server's state
//! file, which it reads again each second on the host's clock while the sidebar shows; and a palette command, `Goal`,
//! whose select shows the goal's summary and sends the prompt that refreshes, lists the history of, pauses, resumes or
//! clears it. The options' `locale` picks English or Chinese, as TS's.
//!
//! Where it differs from TS: TS's `dialog.set({ size: "large" })` comes before its select, which opens medium, so
//! this one opens medium too; and `locale: "auto"` reads `LC_ALL` and `LANG` but not the system's locale (TS's `Intl`).

mod i18n;

use std::cell::RefCell;
use std::collections::HashMap;
use std::ops::ControlFlow;
use std::rc::Rc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use i18n::{Locale, Messages};
use opencode_plugin_abi::types::{SessionID, SessionPromptInput};
use opencode_plugin_abi::{
    Action, Command, Dialog, Host, Node, Placement, Read, Render, Route, Select, SelectOption, Setup, Span, Toast,
    Variant, call, client, plugin,
};
use serde_json::{Value, json};

/// TS `GOAL_TOOL_NAMES`.
const GOAL_TOOLS: [&str; 10] = [
    "get_goal",
    "get_goal_history",
    "create_goal",
    "set_goal",
    "update_goal",
    "update_goal_objective",
    "update_goal_status",
    "stop_goal",
    "replace_goal",
    "clear_goal",
];
const PICKED: &str = "goal.picked";

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options: Value = setup.options().and_then(|text| serde_json::from_str(text).ok()).unwrap_or_default();
    let locale = i18n::resolve(options.get("locale").and_then(Value::as_str));
    let state = Rc::new(RefCell::new(State { locale, ..State::default() }));
    let drawn = state.clone();
    setup.slot(Placement::append("sidebar.content"), move |read, input, changed| {
        let Some(id) = input.session_id.as_deref() else { return Render::Hide };
        let moved = changed.list(id) || changed.messages.iter().any(|(session, _)| session == id);
        if !(moved || changed.woken || changed.local || changed.size) {
            return Render::Keep;
        }
        drawn.borrow_mut().sidebar(read, id)
    });
    let t = i18n::messages(locale);
    let show = Command::new("goal.show").title(t.title).description(t.command_description).group(t.title).palette();
    let shown = state.clone();
    setup.command(show, move |host, _| shown.borrow_mut().show(host));
    let picked = state.clone();
    setup.command(Command::new(PICKED), move |host, input| {
        picked.borrow_mut().picked(host, input.unwrap_or_default());
    });
    setup.on_reply(move |host, _, reply| {
        if let Err(error) = reply {
            toast(host, t, &error, Variant::Error);
        }
    });
    // TS reads the state file each second, and counts an active goal's time each second: a tick on the host's clock,
    // after which the sidebar draws again. It runs only while a block shows: a mount reads the file, the first starts
    // the tick, and the first tick after the last mount went ends it.
    let (mounted, tasks) = (state.clone(), setup.tasks());
    setup.on_mount(Placement::append("sidebar.content"), move |host, _, mount| {
        let start = {
            let mut state = mounted.borrow_mut();
            if !mount {
                state.mounts = state.mounts.saturating_sub(1);
                return;
            }
            state.mounts += 1;
            state.read_state_file();
            !std::mem::replace(&mut state.ticking, true)
        };
        if start {
            let ticked = mounted.clone();
            tasks.every(host, Duration::from_secs(1), move |_| {
                let flow = ticked.borrow_mut().tick();
                async move { flow }
            });
        }
    });
    Ok(())
}

#[derive(Default)]
struct State {
    locale: Locale,
    /// TS `storage.memory("goal-mode.v2.<session>")`: the goal a session's sidebar showed last.
    cache: HashMap<String, Option<Value>>,
    /// TS `usePersistedGoal`: each session's goal in the state file, once the file was read (`None`: not in it).
    persisted: HashMap<String, Option<Value>>,
    /// The state file's size and time as last read, so an unchanged file is not read again.
    seen: Option<(u64, SystemTime)>,
    /// The session the summary was shown for.
    session: String,
    /// The sidebar blocks mounted, and whether the tick runs.
    mounts: usize,
    ticking: bool,
}

impl State {
    fn t(&self) -> &'static Messages {
        i18n::messages(self.locale)
    }

    /// TS `GoalSidebarV2`.
    fn sidebar(&mut self, read: &dyn Read, id: &str) -> Render {
        let found = goal_from_messages(read, id);
        let goal = match (found, self.persisted.get(id)) {
            (Some(None), _) => None,
            (Some(Some(found)), Some(Some(live)))
                if number(&found, "createdAt") > number(live, "createdAt")
                    || number(&found, "updatedAt") > number(live, "updatedAt") =>
            {
                Some(found)
            }
            (_, Some(live)) => live.clone(),
            (None, None) => self.cache.get(id).cloned().flatten(),
            (Some(found), None) => found,
        };
        self.cache.insert(id.to_owned(), goal.clone());
        let Some(goal) = goal else { return Render::Hide };
        let (t, locale) = (self.t(), self.locale);
        let status = goal["status"].as_str().unwrap_or_default();
        let muted = |text: String| Node::text([Span::new(text)]).fg("text.muted");
        if status == "complete" || status == "unmet" {
            let elapsed = duration(live_seconds(&goal, now()));
            let (label, color) = match status {
                "complete" => (t.achieved, "text.feedback.success.base"),
                _ => (t.unmet, "text.muted"),
            };
            return Render::Show(Node::column(vec![Node::text([Span::new(format!("{label} ({elapsed})"))]).fg(color)]));
        }
        let mut rows = vec![
            Node::text([Span::new(t.title)]).fg("text.base"),
            muted(format!("{}: {}", t.status, i18n::status(status, locale))),
            muted(format!("{}: {}", t.time, duration(live_seconds(&goal, now())))),
            muted(format!("{}: {}", t.tokens, of(&goal, "tokensUsed", "tokenBudget"))),
            muted(format!("{}: {}", t.auto_continues, of(&goal, "autoTurns", "maxAutoTurns"))),
        ];
        if let Some(summary) = goal["lastCheckpoint"]["summary"].as_str() {
            rows.push(muted(format!("{}: {summary}", t.checkpoint)));
        }
        if let Some(reason) = goal["stopReason"].as_str().filter(|reason| !reason.is_empty()) {
            rows.push(muted(format!("{}: {}", t.stop, i18n::stop_reason(reason, locale))));
        }
        if let Some(last) = goal["lastStatus"].as_str().filter(|last| !last.is_empty()) {
            rows.push(muted(i18n::last_status(last, locale)));
        }
        rows.push(muted(goal["objective"].as_str().unwrap_or_default().to_owned()));
        Render::Show(Node::column(vec![Node::column(rows)]))
    }

    /// The command's run: the summary of the route's session's goal in a select.
    fn show(&mut self, host: &dyn Host) {
        let t = self.t();
        let Route::Session { id } = host.route() else { return toast(host, t, t.open_session, Variant::Warning) };
        let goal = goal_from_messages(host, &id).flatten();
        let mut options = vec![SelectOption::new(t.refresh, "refresh").description(t.refresh_description)];
        if let Some(goal) = &goal {
            let status = goal["status"].as_str().unwrap_or_default();
            options.push(SelectOption::new(t.history, "history").description(t.history_description));
            if status == "active" {
                options.push(SelectOption::new(t.pause, "pause").description(t.pause_description));
            }
            let interrupted = status == "cancelled" && goal["stopReason"] == "interrupted";
            if matches!(status, "paused" | "budgetLimited" | "usageLimited") || interrupted {
                options.push(SelectOption::new(t.resume, "resume").description(t.resume_description));
            }
            options.push(SelectOption::new(t.clear, "clear").description(t.clear_description));
        }
        self.session = id;
        let action = Action::command(PICKED);
        let select = Select::new(t.title, options, action).placeholder(summary(goal.as_ref(), t, self.locale));
        host.dialog(Dialog::Select(select));
    }

    /// The summary's pick: its prompt goes to the session.
    fn picked(&mut self, host: &dyn Host, value: &str) {
        let t = self.t();
        let prompt = match value {
            "refresh" => t.refresh_prompt,
            "history" => t.history_prompt,
            "pause" => t.pause_prompt,
            "resume" => t.resume_prompt,
            "clear" => t.clear_prompt,
            _ => return,
        };
        let input = SessionPromptInput {
            session_id: SessionID(self.session.clone()),
            text: prompt.into(),
            ..Default::default()
        };
        if let Err(error) = call::fetch_of(&client::session_prompt(&input)).and_then(|fetch| host.try_fetch(fetch)) {
            toast(host, t, &error, Variant::Error);
        }
    }

    /// The tick, while a block shows: the state file is read again if it changed.
    fn tick(&mut self) -> ControlFlow<()> {
        if self.mounts == 0 {
            self.ticking = false;
            return ControlFlow::Break(());
        }
        self.read_state_file();
        ControlFlow::Continue(())
    }

    /// TS `usePersistedGoal`'s `refresh`, for every session at once: the state file, read again once it changed.
    fn read_state_file(&mut self) {
        let path = state_path();
        let Ok(meta) = std::fs::metadata(&path) else { return };
        let stamp = (meta.len(), meta.modified().unwrap_or(UNIX_EPOCH));
        if self.seen == Some(stamp) {
            return;
        }
        let Some(goals) = std::fs::read_to_string(&path).ok().and_then(|text| persisted_goals(&text, now())) else {
            return;
        };
        self.seen = Some(stamp);
        // A session the file does not hold reads `null` only once it held one, as TS sets its signal.
        for (session, known) in self.persisted.iter_mut() {
            if !goals.contains_key(session) {
                *known = None;
            }
        }
        // One the file holds but TS would not read keeps what was read before.
        for (session, goal) in goals {
            if let Some(goal) = goal {
                self.persisted.insert(session, Some(goal));
            }
        }
    }
}

/// TS `goalFromV2Messages`: the newest completed goal tool result in session `id`'s messages: a goal, `Some(None)`
/// after a clear, `None` when there is none.
fn goal_from_messages(read: &dyn Read, id: &str) -> Option<Option<Value>> {
    let mut found = None;
    read.messages(id, &mut |messages| {
        let messages: Vec<Value> = messages.iter().filter_map(|message| serde_json::to_value(message).ok()).collect();
        found = messages.iter().rev().filter(|message| message["type"] == "assistant").find_map(|message| {
            let parts = message["content"].as_array()?;
            parts.iter().rev().find_map(|part| {
                let name = part["name"].as_str().unwrap_or_default();
                if part["type"] != "tool" || !GOAL_TOOLS.contains(&name) || part["state"]["status"] != "completed" {
                    return None;
                }
                if name == "clear_goal" {
                    return Some(None);
                }
                let content = part["state"]["content"].as_array()?;
                let text = content.iter().find(|entry| entry["type"] == "text")?["text"].as_str()?;
                let parsed: Value = serde_json::from_str(text).ok().filter(Value::is_object)?;
                match &parsed["goal"] {
                    Value::Null if parsed.get("goal").is_some() => Some(None),
                    goal if is_goal(goal) => Some(Some(goal.clone())),
                    _ => None,
                }
            })
        });
    });
    found
}

/// TS `readPersistedGoal` for every session the state file holds: each with its time counted to `now` while active,
/// `None` for one TS would not read. `None` for a file TS would not read.
fn persisted_goals(text: &str, now: f64) -> Option<HashMap<String, Option<Value>>> {
    let state: Value = serde_json::from_str(text).ok()?;
    if !matches!(state["version"].as_f64(), Some(1.0 | 2.0 | 3.0)) || !state["goals"].is_object() {
        return None;
    }
    let goals = state["goals"].as_object()?;
    let read = goals.iter().map(|(session, stored)| {
        let mut goal = stored.clone();
        if !goal.is_object() || goal["sessionID"].as_str() != Some(session) {
            return (session.clone(), None);
        }
        let base = goal["timeUsedSeconds"].as_f64().unwrap_or(0.0);
        let active = match (goal["status"].as_str(), goal["lastAccountedAt"].as_f64()) {
            (Some("active"), Some(at)) => (now - at).max(0.0),
            _ => 0.0,
        };
        goal["timeUsedSeconds"] = json!(base + active);
        goal["sampledAt"] = json!(now);
        goal["remainingTokens"] = match (goal["tokenBudget"].as_f64(), goal["tokensUsed"].as_f64()) {
            (Some(budget), Some(used)) => json!((budget - used).max(0.0)),
            _ => Value::Null,
        };
        (session.clone(), Some(goal).filter(is_goal))
    });
    Some(read.collect())
}

/// TS `formatGoal`: the summary, a line a field.
fn summary(goal: Option<&Value>, t: &Messages, locale: Locale) -> String {
    let Some(goal) = goal else { return t.no_goal.to_owned() };
    let status = goal["status"].as_str().unwrap_or_default();
    let mut lines = vec![
        format!("{}: {}", t.objective, goal["objective"].as_str().unwrap_or_default()),
        format!("{}: {}", t.status, i18n::status(status, locale)),
        format!("{}: {}", t.time_used, duration(goal["timeUsedSeconds"].as_f64().unwrap_or(0.0))),
        format!("{}: {}", t.tokens, of(goal, "tokensUsed", "tokenBudget")),
        format!("{}: {}", t.auto_continues, of(goal, "autoTurns", "maxAutoTurns")),
    ];
    if let Some(remaining) = goal["remainingTokens"].as_f64() {
        lines.push(format!("{}: {}", t.tokens_remaining, js(remaining)));
    }
    if let Some(limit) = goal["maxDurationSeconds"].as_f64() {
        lines.push(format!("{}: {}", t.duration_limit, duration(limit)));
    }
    if goal["noProgressTurns"].as_f64().unwrap_or(0.0) > 0.0 {
        lines.push(format!("{}: {}", t.no_progress_turns, js(goal["noProgressTurns"].as_f64().unwrap_or(0.0))));
    }
    if let Some(summary) = goal["lastCheckpoint"]["summary"].as_str() {
        lines.push(format!("{}: {summary}", t.latest_checkpoint));
    }
    let present = [
        ("stopReason", t.stop_reason, i18n::stop_reason as fn(&str, Locale) -> String),
        ("lastStatus", t.last_status, i18n::last_status),
        ("completionEvidence", t.completion_evidence, |text, _| text.to_owned()),
        ("blocker", t.blocker, i18n::last_status),
    ];
    for (field, label, present) in present {
        if let Some(text) = goal[field].as_str().filter(|text| !text.is_empty()) {
            lines.push(format!("{label}: {}", present(text, locale)));
        }
    }
    lines.join("\n")
}

/// `used` and, with a limit, `/limit`, as TS writes them.
fn of(goal: &Value, used: &str, limit: &str) -> String {
    let used = js(goal[used].as_f64().unwrap_or(0.0));
    match goal[limit].as_f64() {
        Some(limit) => format!("{used}/{}", js(limit)),
        None => used,
    }
}

/// A number as JavaScript writes a whole one.
fn js(value: f64) -> String {
    match value.fract() == 0.0 && value.abs() < 1e21 {
        true => format!("{value:.0}"),
        false => value.to_string(),
    }
}

/// TS `formatDuration`: `m:ss`, or `h:mm:ss` from an hour.
fn duration(seconds: f64) -> String {
    let total = seconds.floor().max(0.0) as u64;
    let (hours, minutes, secs) = (total / 3600, total % 3600 / 60, total % 60);
    match hours {
        0 => format!("{minutes}:{secs:02}"),
        _ => format!("{hours}:{minutes:02}:{secs:02}"),
    }
}

/// TS `liveTimeUsedSeconds`.
fn live_seconds(goal: &Value, now: f64) -> f64 {
    let base = goal["timeUsedSeconds"].as_f64().unwrap_or(0.0).floor().max(0.0);
    match (goal["status"].as_str(), goal["sampledAt"].as_f64()) {
        (Some("active"), Some(sampled)) => base + (now - sampled).floor().max(0.0),
        _ => base,
    }
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0.0, |since| since.as_secs() as f64)
}

fn number(goal: &Value, field: &str) -> f64 {
    goal[field].as_f64().unwrap_or(0.0)
}

/// TS `statePath`.
fn state_path() -> std::path::PathBuf {
    if let Some(path) = std::env::var_os("OPENCODE_GOAL_STATE_PATH").filter(|path| !path.is_empty()) {
        return path.into();
    }
    let data = std::env::var_os("XDG_DATA_HOME")
        .filter(|path| !path.is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| cfg!(windows).then(|| std::env::var_os("APPDATA")).flatten().map(Into::into))
        .or_else(|| std::env::home_dir().map(|home| home.join(".local").join("share")))
        .unwrap_or_default();
    data.join("opencode-goal-plugin").join("goals.json")
}

fn toast(host: &dyn Host, t: &Messages, message: &str, variant: Variant) {
    host.toast(Toast::new(variant, message).title(t.title));
}

/// TS `isGoalSnapshot`.
fn is_goal(goal: &Value) -> bool {
    let Some(fields) = goal.as_object() else { return false };
    let is = |name: &str, test: fn(&Value) -> bool| fields.get(name).is_some_and(test);
    // `null` or the type; `nullish` also allows the field to be missing.
    let nullable =
        |name: &str, test: fn(&Value) -> bool| fields.get(name).is_some_and(|value| value.is_null() || test(value));
    let nullish =
        |name: &str, test: fn(&Value) -> bool| fields.get(name).is_none_or(|value| value.is_null() || test(value));
    let checkpoint = |value: &Value| value["summary"].is_string() && value["timestamp"].is_number();
    let history =
        |value: &Value| value["type"].is_string() && value["detail"].is_string() && value["timestamp"].is_number();
    let statuses = ["active", "paused", "budgetLimited", "usageLimited", "complete", "unmet", "cancelled"];
    is("sessionID", Value::is_string)
        && is("objective", Value::is_string)
        && fields.get("status").and_then(Value::as_str).is_some_and(|status| statuses.contains(&status))
        && nullable("tokenBudget", Value::is_number)
        && ["tokensUsed", "timeUsedSeconds", "createdAt", "updatedAt", "continuationFailures"]
            .iter()
            .all(|name| is(name, Value::is_number))
        && ["completionEvidence", "blocker", "lastStatus"].iter().all(|name| nullish(name, Value::is_string))
        && nullish("closedAt", Value::is_number)
        && ["maxAutoTurns", "maxDurationSeconds", "noProgressTokenThreshold", "maxNoProgressTurns"]
            .iter()
            .all(|name| nullable(name, Value::is_number))
        && is("noProgressTurns", Value::is_number)
        && is("budgetWrapupSent", Value::is_boolean)
        && nullable("stopReason", Value::is_string)
        && fields.get("history").and_then(Value::as_array).is_some_and(|list| list.iter().all(history))
        && fields.get("checkpoints").and_then(Value::as_array).is_some_and(|list| list.iter().all(checkpoint))
        && nullable("lastCheckpoint", checkpoint)
        && is("lastAssistantText", Value::is_string)
        && is("lastAssistantMessageID", Value::is_string)
        && is("autoTurns", Value::is_number)
        && nullish("lastContinuationAt", Value::is_number)
        && nullable("remainingTokens", Value::is_number)
        && nullish("sampledAt", Value::is_number)
}

plugin!(id = "local.goal-mode.tui", setup);

#[cfg(test)]
mod tests {
    use super::*;

    fn goal() -> Value {
        json!({
            "sessionID": "ses_g", "objective": "Ship it", "status": "active", "tokenBudget": 100, "tokensUsed": 40,
            "timeUsedSeconds": 3725, "createdAt": 1, "updatedAt": 2, "continuationFailures": 0, "lastStatus": null,
            "maxAutoTurns": null, "maxDurationSeconds": null, "noProgressTokenThreshold": null, "maxNoProgressTurns": null,
            "noProgressTurns": 0, "budgetWrapupSent": false, "stopReason": null, "history": [], "checkpoints": [],
            "lastCheckpoint": null, "lastAssistantText": "", "lastAssistantMessageID": "", "autoTurns": 2,
            "remainingTokens": 60,
        })
    }

    #[test]
    fn durations_and_live_time_read_as_ts() {
        assert_eq!([0.0, 59.9, 725.0, 3725.0].map(duration), ["0:00", "0:59", "12:05", "1:02:05"]);
        let mut sampled = goal();
        sampled["sampledAt"] = json!(1000);
        assert_eq!(live_seconds(&sampled, 1010.0), 3735.0);
        assert_eq!(live_seconds(&goal(), 1010.0), 3725.0);
    }

    #[test]
    fn a_goal_is_checked_field_by_field() {
        assert!(is_goal(&goal()));
        let mut bad = goal();
        bad["status"] = json!("done");
        assert!(!is_goal(&bad));
        let mut missing = goal();
        missing.as_object_mut().unwrap().remove("tokenBudget");
        assert!(!is_goal(&missing));
    }

    #[test]
    fn the_state_file_counts_an_active_goal_to_now() {
        let mut stored = goal();
        stored["lastAccountedAt"] = json!(990);
        let file = json!({ "version": 3, "goals": { "ses_g": stored, "ses_x": { "sessionID": "ses_y" } } });
        let goals = persisted_goals(&file.to_string(), 1000.0).unwrap();
        let read = goals["ses_g"].as_ref().unwrap();
        assert_eq!((read["timeUsedSeconds"].as_f64(), read["remainingTokens"].as_f64()), (Some(3735.0), Some(60.0)));
        assert_eq!(goals["ses_x"], None);
        assert!(persisted_goals(r#"{"version":9,"goals":{}}"#, 0.0).is_none());
    }

    #[test]
    fn the_summary_lists_each_field_it_has() {
        let t = i18n::messages(Locale::En);
        let text = summary(Some(&goal()), t, Locale::En);
        assert_eq!(
            text,
            "Objective: Ship it\nStatus: active\nTime used: 1:02:05\nTokens: 40/100\nAuto-continues: 2\nTokens remaining: 60"
        );
        assert_eq!(summary(None, t, Locale::En), "No recent goal state found in this session.");
    }
}
