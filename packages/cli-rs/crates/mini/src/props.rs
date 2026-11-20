//! Property tests of the transcript over random histories and event streams: it prints what TypeScript's transport
//! prints, and a resize replay prints what a new client prints.

use std::collections::HashSet;

use opencode_util::rng::SplitMix64;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};

use crate::replay::{Output, Transcript};
use crate::scrollback::Commit;

const PIECES: [&str; 12] = ["a", "bc", " ", "\n", "é", "日本", "👍🏽", "e\u{301}", "👨‍👩‍👧", "\t", "x", "yz"];
const ASSISTANTS: [&str; 3] = ["msg_a0", "msg_a1", "msg_a2"];
const CALLS: [&str; 2] = ["call_0", "call_1"];
const TOOLS: [&str; 4] = ["bash", "read", "websearch", "grep"];

/// The events of a case: before an "@attach", only the server sees them; "@reconnect" lists again.
#[derive(Clone)]
struct Case {
    thinking: bool,
    tools: bool,
    active: bool,
    events: Vec<Value>,
}

impl Case {
    /// The events as the server sends them, each list holding what came before, and the messages it lists after
    /// them. The fold makes any subset of a case consistent, so shrinking keeps it valid.
    fn server(&self) -> (Vec<Value>, Vec<Value>) {
        let mut fold = Fold { messages: Vec::new(), ended: HashSet::new() };
        let events = self.events.iter().map(|event| fold.apply(event.clone())).collect();
        (events, fold.messages)
    }

    /// The first list and the events the client sees after it.
    fn attached(&self) -> (Value, Vec<Value>) {
        let mut events = self.server().0;
        let start = events.iter().rposition(|event| event["type"] == "@attach");
        let first = start.map_or(json!({ "history": [] }), |index| events[index].clone());
        events.drain(..start.map_or(0, |index| index + 1));
        (first, events)
    }

    fn json(&self) -> Value {
        let (first, events) = self.attached();
        json!({ "thinking": self.thinking, "tools": self.tools, "active": self.active, "history": first["history"],
            "inbox": [], "events": events })
    }
}

/// The server's projection of the generated events.
struct Fold {
    messages: Vec<Value>,
    /// The parts that ended: no delta follows.
    ended: HashSet<String>,
}

impl Fold {
    fn index(&mut self, id: &str, make: impl FnOnce() -> Value) -> usize {
        self.messages.iter().position(|message| message["id"] == id).unwrap_or_else(|| {
            self.messages.push(make());
            self.messages.len() - 1
        })
    }

    fn content(&mut self, id: &str) -> &mut Vec<Value> {
        let index = self.index(id, || {
            json!({ "id": id, "type": "assistant", "agent": "build", "model": { "id": "m", "providerID": "p" },
                "time": { "created": 1 }, "content": [] })
        });
        self.messages[index]["content"].as_array_mut().expect("an assistant message")
    }

    fn running(&self) -> Option<String> {
        let running =
            self.messages.iter().find(|message| message["type"] == "compaction" && message["status"] == "running");
        running.map(|message| message["id"].as_str().unwrap_or_default().to_owned())
    }

    /// Applies an event, and makes it one the server sends after the ones before: an end holds its part's text plus
    /// its "extra", a call's first event starts it, a compaction starts only when none runs, and a delivery names a
    /// pending prompt.
    fn apply(&mut self, mut event: Value) -> Value {
        let mut kind = event["type"].as_str().unwrap_or_default().to_owned();
        if kind.starts_with('@') {
            event["history"] = json!(self.messages);
            return event;
        }
        // A delta sent again after a list is in it already, unless shrinking dropped the delta.
        let delta = event["data"]["delta"].to_string();
        if event.as_object_mut().and_then(|event| event.remove("covered")).is_some()
            && json!(self.messages).to_string().contains(delta.trim_matches('"'))
        {
            return event;
        }
        let id = event["id"].as_str().unwrap_or_default().to_owned();
        let data = &mut event["data"];
        let text = |key: &str, data: &Value| data[key].as_str().unwrap_or_default().to_owned();
        let (message, call) = (text("assistantMessageID", data), text("id", data));
        let extra = data.as_object_mut().and_then(|data| data.remove("extra")).unwrap_or_default();
        if kind.starts_with("session.tool.") {
            let call_data = |more: Value| {
                let mut data = json!({ "sessionID": "ses_1", "assistantMessageID": message, "id": call });
                data.as_object_mut()
                    .into_iter()
                    .for_each(|data| data.extend(more.as_object().cloned().unwrap_or_default()));
                data
            };
            let content = self.content(&message);
            let status =
                content.iter().find(|item| item["id"] == call.as_str()).map(|item| item["state"]["status"].clone());
            if status.is_none() {
                content.push(json!({ "type": "tool", "id": call, "time": { "created": 1 } }));
                kind = "session.tool.input.started".into();
                *data = call_data(json!({ "name": data["name"].as_str().unwrap_or("bash") }));
            } else if kind == "session.tool.input.started" {
                kind = "session.tool.input.delta".into();
                *data = call_data(json!({ "delta": format!("⟨{id}⟩") }));
            } else if kind == "session.tool.called" && status != Some(json!("streaming")) {
                data["sessionID"] = json!("ses_2");
                return event;
            } else if kind == "session.tool.progress" && status != Some(json!("running")) {
                kind = "session.tool.called".into();
                *data = call_data(json!({ "input": { "command": "ls" }, "executed": true }));
            }
        }
        if kind == "session.compaction.started" && self.running().is_some() {
            kind = "session.compaction.delta".into();
            *data = json!({ "sessionID": "ses_1", "text": format!("⟨{id}⟩") });
        }
        event["type"] = json!(kind);
        let data = &mut event["data"];
        match kind.as_str() {
            "session.text.delta" | "session.text.ended" | "session.reasoning.delta" | "session.reasoning.ended" => {
                let part = &kind["session.".len()..kind.rfind('.').unwrap_or_default()];
                let ordinal = data["ordinal"].as_u64().unwrap_or_default() as usize;
                let key = format!("{message}/{part}:{ordinal}");
                if self.ended.contains(&key) {
                    data["sessionID"] = json!("ses_2");
                    data["text"] = json!(extra.as_str().unwrap_or_default());
                    return event;
                }
                if kind.ends_with("ended") {
                    self.ended.insert(key);
                }
                let content = self.content(&message);
                while content.iter().filter(|item| item["type"] == part).count() <= ordinal {
                    content.push(json!({ "type": part, "text": "" }));
                }
                let item = content.iter_mut().filter(|item| item["type"] == part).nth(ordinal).expect("made above");
                let added = data["delta"].as_str().or(extra.as_str()).unwrap_or_default();
                item["text"] = json!(item["text"].as_str().unwrap_or_default().to_owned() + added);
                if kind.ends_with("ended") {
                    data["text"] = item["text"].clone();
                }
            }
            tool if tool.starts_with("session.tool.") => {
                let content = self.content(&message);
                let item = content.iter_mut().find(|item| item["id"] == call.as_str()).expect("started above");
                let state = &mut item["state"];
                let input = state["input"].as_object().cloned().unwrap_or_default();
                match &tool["session.tool.".len()..] {
                    "input.started" => {
                        item["name"] = data["name"].clone();
                        item["state"] = json!({ "status": "streaming", "input": "" });
                    }
                    "called" if state["status"] != "completed" && state["status"] != "error" => {
                        *state = json!({ "status": "running", "input": data["input"], "metadata": {} });
                    }
                    "progress" if state["status"] == "running" => state["metadata"] = data["metadata"].clone(),
                    "success" => {
                        *state = json!({ "status": "completed", "input": input, "content": data["content"],
                            "metadata": data["metadata"] });
                    }
                    "failed" => *state = json!({ "status": "error", "input": input, "error": data["error"] }),
                    _ => {}
                }
            }
            "session.shell.started" | "session.shell.ended" => {
                let (shell, ended) = (&data["shell"], kind.ends_with("ended"));
                let id = format!("msg_{}", shell["id"].as_str().unwrap_or_default());
                // A shell starts once and ends once.
                let known = self.messages.iter().find(|message| message["id"] == id.as_str());
                if known.is_some_and(|message| !ended || message["status"] != "running") {
                    data["sessionID"] = json!("ses_2");
                    return event;
                }
                let index = self.index(&id, || Value::Null);
                self.messages[index] = json!({ "id": id, "type": "shell", "shellID": shell["id"], "command": shell["command"],
                    "status": shell["status"], "time": { "created": 1, "completed": if ended { json!(2) } else { Value::Null } },
                    "exit": if ended { shell["exit"].clone() } else { Value::Null }, "output": data["output"] });
            }
            "session.compaction.started" => {
                let id = data["inputID"].as_str().map_or_else(|| crate::replay::message_from_event(&id), str::to_owned);
                self.messages.push(json!({ "id": id, "type": "compaction", "reason": "auto", "status": "running",
                    "summary": "", "time": { "created": 1 } }));
            }
            compaction if compaction.starts_with("session.compaction.") => {
                let added = data["text"].as_str().or(extra.as_str()).unwrap_or_default().to_owned();
                // The server sends these only while a compaction runs: here they belong to another session.
                let Some(id) = self.running() else {
                    data["sessionID"] = json!("ses_2");
                    data["text"] = json!(added);
                    return event;
                };
                let index = self.index(&id, || Value::Null);
                let message = &mut self.messages[index];
                message["summary"] = json!(message["summary"].as_str().unwrap_or_default().to_owned() + &added);
                match &compaction["session.compaction.".len()..] {
                    "ended" => (message["status"], data["text"]) = (json!("completed"), message["summary"].clone()),
                    "failed" => (message["status"], message["error"]) = (json!("failed"), data["error"].clone()),
                    _ => {}
                }
            }
            "session.step.started" => drop(self.content(&message)),
            "session.step.failed" => {
                self.content(&message);
                let index = self.index(&message, || Value::Null);
                self.messages[index]["error"] = data["error"].clone();
            }
            "session.skill.activated" => {
                let id = crate::replay::message_from_event(&id);
                self.index(&id, || {
                    json!({ "id": id, "type": "skill", "skill": "tidy", "name": "tidy", "text": "x", "time": { "created": 1 } })
                });
            }
            _ => {}
        }
        event
    }
}

struct Gen {
    rng: SplitMix64,
    seq: u64,
}

impl Gen {
    fn below(&mut self, n: u64) -> u64 {
        self.rng.below(n)
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len() as u64) as usize]
    }

    fn text(&mut self, max: u64) -> String {
        (0..self.below(max + 1)).map(|_| self.pick(&PIECES)).collect()
    }

    fn error(&mut self) -> Value {
        json!({ "type": self.pick(&["provider", "aborted"]), "message": self.pick(&["Boom", ""]) })
    }

    fn case(&mut self, events: u64) -> Case {
        let attach = self.below(events + 1);
        let mut list: Vec<Value> = Vec::new();
        for index in 0..self.below(events + 1) {
            let marker = if index == attach { "@attach" } else { "@reconnect" };
            if index != attach && self.below(40) > 0 {
                list.push(self.live());
                continue;
            }
            // The stream sends again the deltas that came while a list was read: the list holds them.
            let since = list.iter().rposition(|event| event["type"].as_str().is_some_and(|kind| kind.starts_with('@')));
            let mut covered: Vec<Value> = list[since.map_or(0, |index| index + 1)..]
                .iter()
                .rev()
                .filter(|event| event["data"]["delta"].is_string())
                .cloned()
                .collect();
            covered.truncate(self.below(3) as usize);
            list.push(json!({ "type": marker }));
            list.extend(covered.into_iter().rev().map(|mut event| {
                event["covered"] = json!(true);
                event
            }));
        }
        Case { thinking: self.below(3) > 0, tools: self.below(5) > 0, active: self.below(2) > 0, events: list }
    }

    fn live(&mut self) -> Value {
        self.seq += 1;
        let (seq, message, call) = (self.seq, self.pick(&ASSISTANTS), self.pick(&CALLS));
        // Never part of another delta, so a list covers only the deltas it holds.
        let delta = format!("{}⟨{seq}⟩", self.pick(&PIECES));
        let extra = if self.below(3) == 0 { self.text(3) } else { String::new() };
        let part = self.pick(&["text", "reasoning"]);
        let tool = |kind: &str, mut data: Value| {
            (format!("session.tool.{kind}"), {
                data["assistantMessageID"] = json!(message);
                data["id"] = json!(call);
                data
            })
        };
        let (kind, mut data) = match self.below(17) {
            0..=4 => (
                format!("session.{part}.delta"),
                json!({ "assistantMessageID": message, "ordinal": self.below(2), "delta": delta }),
            ),
            5 => (
                format!("session.{part}.ended"),
                json!({ "assistantMessageID": message, "ordinal": self.below(2), "extra": extra }),
            ),
            6 => tool("input.started", json!({ "name": self.pick(&TOOLS) })),
            7 => tool("called", json!({ "input": { "command": "ls" }, "executed": true })),
            8 => {
                let provider = if call == "call_0" { json!("exa") } else { Value::Null };
                tool("progress", json!({ "metadata": { "output": self.text(3), "provider": provider } }))
            }
            9 => match self.below(2) {
                0 => tool(
                    "success",
                    json!({ "content": [{ "type": "text", "text": self.text(3) }],
                    "metadata": { "output": self.text(3) }, "executed": true }),
                ),
                _ => tool("failed", json!({ "error": self.error(), "executed": true })),
            },
            10 => {
                let (status, exit) = (self.pick(&["running", "exited", "exited", "killed"]), self.below(2));
                let command = if exit == 0 { "echo hi" } else { "" };
                let shell = json!({ "id": "sh_0", "status": status, "command": command,
                    "cwd": "/", "shell": "bash", "file": "/out", "metadata": {}, "time": { "started": 1, "completed": 2 },
                    "exit": exit });
                let output = json!({ "output": self.text(3), "cursor": 0, "size": self.below(2), "truncated": false });
                match status {
                    "running" => ("session.shell.started".into(), json!({ "shell": shell })),
                    _ => ("session.shell.ended".into(), json!({ "shell": shell, "output": output })),
                }
            }
            11 => {
                let input = if self.below(2) == 0 { json!(format!("msg_ci{seq}")) } else { Value::Null };
                ("session.compaction.started".into(), json!({ "reason": "auto", "inputID": input }))
            }
            12 => ("session.compaction.delta".into(), json!({ "text": delta })),
            13 => match self.below(2) {
                0 => ("session.compaction.ended".into(), json!({ "reason": "auto", "extra": extra })),
                _ => ("session.compaction.failed".into(), json!({ "reason": "auto", "error": self.error() })),
            },
            14 => match self.below(3) {
                0 => (
                    "session.step.started".into(),
                    json!({ "assistantMessageID": message, "agent": "build",
                    "model": { "id": "m", "providerID": "p" }, "started": 1 }),
                ),
                1 => (
                    "session.step.ended".into(),
                    json!({ "assistantMessageID": message, "finish": "stop",
                    "cost": self.below(2) as f64 / 4.0, "tokens": { "input": self.below(2) * 10, "output": 0,
                    "reasoning": 0, "cache": { "read": 0, "write": 0 } } }),
                ),
                _ => ("session.step.failed".into(), json!({ "assistantMessageID": message, "error": self.error() })),
            },
            15 => ("session.skill.activated".into(), json!({ "id": "tidy", "name": "tidy", "text": "x" })),
            _ => {
                let kind = self.pick(&["started", "succeeded", "failed", "interrupted"]);
                let data = json!({ "error": self.error(), "reason": self.pick(&["user", "shutdown"]) });
                (format!("session.execution.{kind}"), data)
            }
        };
        data["sessionID"] = json!("ses_1");
        data.as_object_mut().into_iter().for_each(|data| data.retain(|_, value| !value.is_null()));
        let id = if kind.ends_with("skill.activated") { format!("evt_s{}", seq % 2) } else { format!("evt_{seq}") };
        json!({ "id": id, "created": seq, "type": kind, "data": data,
            "durable": { "aggregateID": "ses_1", "seq": seq, "version": 1 } })
    }
}

fn decode<T: DeserializeOwned>(value: &Value) -> T {
    T::deserialize(value).expect("generated values decode")
}

fn commits(output: &Output) -> Vec<Value> {
    let name = |value: &dyn std::fmt::Debug| format!("{value:?}").to_lowercase();
    let commit = |commit: &Commit| {
        json!({ "kind": name(&commit.kind), "source": name(&commit.source), "phase": name(&commit.phase),
            "text": commit.text, "messageID": commit.message_id, "partID": commit.part_id, "tool": commit.tool,
            "toolState": commit.tool_state.map(|state| name(&state)), "toolError": commit.tool_error,
            "shell": commit.shell, "image": commit.image, "compaction": commit.compaction })
    };
    output.commits.iter().map(commit).collect()
}

/// The commits and the footer's phase, status and usage after the hydration and each event, as mini's shell feeds
/// the transcript, and the transcript after them.
fn play(case: &Case) -> (Value, Transcript) {
    let mut transcript = Transcript::new("ses_1", case.thinking, case.tools, true, None);
    let (mut printed, mut states) = (Vec::new(), Vec::new());
    let mut footer = json!({ "phase": "idle", "status": "", "usage": null });
    let (first, events) = case.attached();
    let mut output = transcript.hydrate(&decode::<Vec<_>>(&first["history"]), case.active);
    for step in 0..=events.len() {
        if let Some(event) = step.checked_sub(1).map(|index| &events[index]) {
            output = if event["type"] == "@reconnect" {
                transcript.disconnected();
                footer["phase"] = json!("running");
                footer["status"] = json!("reconnecting");
                transcript.hydrate(&decode::<Vec<_>>(&event["history"]), case.active)
            } else {
                transcript.event(&decode(event))
            };
        }
        if let Some(patch) = &output.patch {
            if let Some(running) = patch.running {
                footer["phase"] = json!(if running { "running" } else { "idle" });
            }
            if let Some(status) = &patch.status {
                footer["status"] = json!(status);
            }
            if let Some(usage) = &patch.usage {
                footer["usage"] = usage.as_ref().map_or(Value::Null, |usage| match usage.cost {
                    Some(cost) => json!({ "tokens": usage.tokens, "cost": cost }),
                    None => json!({ "tokens": usage.tokens }),
                });
            }
        }
        printed.extend(commits(&output));
        states.push(json!({ "commits": printed.len(), "phase": footer["phase"], "status": footer["status"],
            "usage": footer["usage"] }));
    }
    (json!({ "commits": printed, "states": states }), transcript)
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// TS's transport over each case, or None without Bun or the workspace's packages.
fn typescript(cases: &[Case]) -> Option<Vec<Value>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let bun = std::process::Command::new("bun").arg("--version").output().is_ok_and(|output| output.status.success());
    if !bun || !root.join("../../../../node_modules").is_dir() {
        assert!(std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(), "bun or node_modules is missing");
        return None;
    }
    let file = std::env::temp_dir().join(format!("mini-transcript-{}.json", std::process::id()));
    std::fs::write(&file, json!(cases.iter().map(Case::json).collect::<Vec<_>>()).to_string()).unwrap();
    let output = std::process::Command::new("bun")
        .arg(root.join("../../parity/oracle/M.6-transcript.ts"))
        .arg(&file)
        .output()
        .unwrap();
    let _ = std::fs::remove_file(&file);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    Some(serde_json::from_slice(&output.stdout).unwrap())
}

/// Drops events one at a time while the case still fails.
fn shrink(mut case: Case, fails: impl Fn(&Case) -> bool) -> Case {
    for _ in 0..2 {
        let mut index = 0;
        while index < case.events.len() {
            let removed = case.events.remove(index);
            if !fails(&case) {
                case.events.insert(index, removed);
                index += 1;
            }
        }
    }
    case
}

#[test]
fn the_transcript_prints_what_typescript_prints() {
    let mut generator = Gen { rng: SplitMix64(env("MODEL_SEED", 1)), seq: 0 };
    // With tools hidden, an end after a list that printed its part buffers only the rest, where TS prints all of it
    // again (O89-mini-replay-rows.md): those cases list no assistant text.
    let quiet = |mut case: Case| {
        if !case.tools {
            case.events.retain(|event| !event["type"].as_str().is_some_and(|kind| kind.starts_with('@')));
            case.events.retain(|event| event.get("covered").is_none());
        }
        case
    };
    let cases: Vec<Case> =
        (0..env("MODEL_CASES", 500)).map(|_| quiet(generator.case(env("MODEL_EVENTS", 30)))).collect();
    let Some(ts) = typescript(&cases) else { return };
    let Some(index) = (0..cases.len()).find(|&index| play(&cases[index]).0 != ts[index]) else { return };
    let fails = |case: &Case| play(case).0 != typescript(std::slice::from_ref(case)).unwrap()[0];
    let case = shrink(cases[index].clone(), fails);
    let ts = typescript(std::slice::from_ref(&case)).unwrap().remove(0);
    panic!("case {index} differs, shrunk:\n{}\nrust: {}\nts:   {ts}", case.json(), play(&case).0);
}

/// A resize replay that lists while the last third of the events arrives, after any other list, prints what a new
/// client prints.
#[test]
fn a_resize_replay_prints_what_a_new_client_prints() {
    let differs = |case: &Case| -> Option<String> {
        let (events, listed) = case.server();
        let listed_at =
            events.iter().rposition(|event| event["type"].as_str().is_some_and(|kind| kind.starts_with('@')));
        let split = (events.len() - events.len() / 3).max(listed_at.map_or(0, |index| index + 1));
        let (_, mut transcript) = play(&Case { events: case.events[..split].to_vec(), ..case.clone() });
        transcript.begin_replay();
        // A buffered compaction event names no compaction: after a list that shows a newer one it lands there, in TS
        // too. The list holds it, so it is left out.
        let buffered =
            |event: &&Value| event["type"].as_str().is_some_and(|kind| !kind.starts_with("session.compaction"));
        for event in events[split..].iter().filter(buffered) {
            assert!(transcript.event(&decode(event)).commits.is_empty(), "the relist holds back {event}");
        }
        let listed: Vec<_> = decode(&json!(listed));
        let replayed = commits(&transcript.replayed(&listed, case.active));
        let fresh =
            commits(&Transcript::new("ses_1", case.thinking, case.tools, true, None).hydrate(&listed, case.active));
        (replayed != fresh).then(|| format!("replayed {}\nfresh    {}", json!(replayed), json!(fresh)))
    };
    let mut generator = Gen { rng: SplitMix64(env("MODEL_SEED", 1)), seq: 0 };
    for index in 0..env("MODEL_CASES", 200) {
        let case = generator.case(env("MODEL_EVENTS", 30));
        if differs(&case).is_some() {
            let case = shrink(case, |case| differs(case).is_some());
            panic!("case {index}, shrunk:\n{}\n{}", case.json(), differs(&case).unwrap_or_default());
        }
    }
}
