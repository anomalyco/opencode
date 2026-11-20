//! Property tests of the transcript: random histories and event streams, compared with TypeScript's transport.

use std::collections::HashMap;

use opencode_util::rng::SplitMix64;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::prelude::*;
use crate::replay::{Output, Transcript};
use crate::scrollback::Commit;

const PIECES: &[&str] = &["a", "bc", " ", "\n", "é", "日本", "👍🏽", "e\u{301}", "👨‍👩‍👧", "\t", "x", "yz"];
const ASSISTANTS: &[&str] = &["msg_a0", "msg_a1", "msg_a2"];
const USERS: &[&str] = &["msg_u0", "msg_u1", "msg_u2"];
const CALLS: &[&str] = &["call_0", "call_1"];
const SHELLS: &[&str] = &["sh_0", "sh_1"];
const TOOLS: &[&str] = &["bash", "read", "edit", "websearch", "grep"];

/// One random case: the flags, what the list returns, and the live events after it.
pub(crate) struct Case {
    pub thinking: bool,
    pub tools: bool,
    pub active: bool,
    pub history: Vec<Value>,
    pub inbox: Vec<Value>,
    pub events: Vec<Value>,
}

impl Case {
    pub fn json(&self) -> Value {
        json!({ "thinking": self.thinking, "tools": self.tools, "active": self.active, "history": self.history,
            "inbox": self.inbox, "events": self.events() })
    }

    /// The events as the server sends them: each end's text is the text its part streamed, plus its `extra`, and a
    /// relist lists the messages the events so far made (the fold). The server projects an event as it publishes
    /// it, so a list is never behind the stream. A shrunk case stays consistent.
    pub fn events(&self) -> Vec<Value> {
        let mut fold = Fold::new(&self.history, &self.inbox);
        self.events
            .iter()
            .map(|event| {
                let mut event = event.clone();
                if event["type"].as_str().is_some_and(|kind| kind.starts_with('@')) {
                    event["history"] = json!(fold.messages);
                    event["inbox"] = json!(fold.pending);
                    return event;
                }
                fold.apply(&mut event);
                event
            })
            .collect()
    }

    /// The messages the server lists after every event.
    pub fn fold(&self) -> Vec<Value> {
        let mut fold = Fold::new(&self.history, &self.inbox);
        for event in self.events.iter().filter(|event| !event["type"].as_str().unwrap_or_default().starts_with('@')) {
            fold.apply(&mut event.clone());
        }
        fold.messages
    }
}

/// A model of the server's message projection, for the events the generator sends.
struct Fold {
    messages: Vec<Value>,
    /// The inbox items not yet delivered, oldest first.
    pending: Vec<Value>,
    compaction: Option<String>,
}

impl Fold {
    fn new(history: &[Value], inbox: &[Value]) -> Self {
        let compaction = history
            .iter()
            .find(|message| message["type"] == "compaction" && message["status"] == "running")
            .map(|message| message["id"].as_str().unwrap_or_default().to_owned());
        Self { messages: history.to_vec(), pending: inbox.to_vec(), compaction }
    }

    fn message(&mut self, id: &str, make: impl FnOnce() -> Value) -> &mut Value {
        let index = match self.messages.iter().position(|message| message["id"] == id) {
            Some(index) => index,
            None => {
                self.messages.push(make());
                self.messages.len() - 1
            }
        };
        &mut self.messages[index]
    }

    fn assistant(&mut self, id: &str) -> &mut Vec<Value> {
        let message = self.message(id, || {
            json!({ "id": id, "type": "assistant", "agent": "build", "model": { "id": "model", "providerID": "demo" },
                "time": { "created": 1 }, "content": [] })
        });
        message["content"].as_array_mut().expect("an assistant message has content")
    }

    /// The text of the ordinal-th part of a kind, made when missing.
    fn part(&mut self, message: &str, kind: &str, ordinal: u64) -> &mut Value {
        let content = self.assistant(message);
        let count = content.iter().filter(|item| item["type"] == kind).count() as u64;
        for _ in count..=ordinal {
            content.push(json!({ "type": kind, "text": "" }));
        }
        let item = content.iter_mut().filter(|item| item["type"] == kind).nth(ordinal as usize).expect("made above");
        &mut item["text"]
    }

    fn tool(&mut self, message: &str, call: &str) -> &mut Value {
        let content = self.assistant(message);
        let index = match content.iter().position(|item| item["type"] == "tool" && item["id"] == call) {
            Some(index) => index,
            None => {
                content.push(json!({ "type": "tool", "id": call, "name": "tool",
                    "state": { "status": "streaming", "input": "" }, "time": { "created": 1 } }));
                content.len() - 1
            }
        };
        &mut content[index]
    }

    /// Applies an event, and gives an end its text: what its part holds, plus its extra.
    fn apply(&mut self, event: &mut Value) {
        if event.as_object_mut().and_then(|event| event.remove("covered")).is_some() {
            return;
        }
        let kind = event["type"].as_str().unwrap_or_default().to_owned();
        let id = event["id"].as_str().unwrap_or_default().to_owned();
        let data = &mut event["data"];
        let extra = data.as_object_mut().and_then(|data| data.remove("extra"));
        if data["sessionID"] != "ses_1" {
            return;
        }
        let extra = extra.as_ref().and_then(Value::as_str).unwrap_or_default();
        let message = data["assistantMessageID"].as_str().unwrap_or_default().to_owned();
        let call = data["id"].as_str().unwrap_or_default().to_owned();
        let ordinal = data["ordinal"].as_u64().unwrap_or_default();
        match kind.as_str() {
            "session.text.delta" | "session.reasoning.delta" => {
                let part = if kind.contains("reasoning") { "reasoning" } else { "text" };
                let delta = data["delta"].as_str().unwrap_or_default().to_owned();
                let text = self.part(&message, part, ordinal);
                *text = json!(text.as_str().unwrap_or_default().to_owned() + &delta);
            }
            "session.text.ended" | "session.reasoning.ended" => {
                let part = if kind.contains("reasoning") { "reasoning" } else { "text" };
                let text = self.part(&message, part, ordinal);
                *text = json!(text.as_str().unwrap_or_default().to_owned() + extra);
                data["text"] = text.clone();
            }
            "session.tool.input.started" => {
                let name = data["name"].clone();
                let tool = self.tool(&message, &call);
                tool["name"] = name;
                tool["state"] = json!({ "status": "streaming", "input": "" });
            }
            "session.tool.input.delta" | "session.tool.input.ended" => {
                let (delta, ended) = (data["delta"].as_str().unwrap_or_default().to_owned(), kind.ends_with("ended"));
                let tool = self.tool(&message, &call);
                if tool["state"]["status"] == "streaming" {
                    let input = tool["state"]["input"].as_str().unwrap_or_default().to_owned() + &delta;
                    tool["state"]["input"] = json!(input);
                }
                if ended {
                    data["text"] = json!(tool["state"]["input"].as_str().unwrap_or_default());
                }
            }
            "session.tool.called" => {
                let input = data["input"].clone();
                let tool = self.tool(&message, &call);
                if matches!(tool["state"]["status"].as_str(), Some("streaming" | "running")) {
                    tool["state"] = json!({ "status": "running", "input": input, "metadata": {} });
                }
            }
            "session.tool.progress" => {
                let metadata = data["metadata"].clone();
                let tool = self.tool(&message, &call);
                if tool["state"]["status"] == "running" {
                    tool["state"]["metadata"] = metadata;
                }
            }
            "session.tool.success" | "session.tool.failed" => {
                let state = if kind.ends_with("success") {
                    json!({ "status": "completed", "content": data["content"], "metadata": data["metadata"] })
                } else {
                    json!({ "status": "error", "error": data["error"] })
                };
                let tool = self.tool(&message, &call);
                let input = tool["state"]["input"].as_object().cloned().unwrap_or_default();
                tool["state"] = state;
                tool["state"]["input"] = json!(input);
            }
            "session.shell.started" | "session.shell.ended" => {
                let shell = data["shell"].clone();
                let output = data["output"].clone();
                let shell_id = shell["id"].as_str().unwrap_or_default().to_owned();
                let message = self.message(&format!("msg_{shell_id}"), || {
                    json!({ "id": format!("msg_{shell_id}"), "type": "shell", "shellID": shell_id,
                        "time": { "created": 1 } })
                });
                message["command"] = shell["command"].clone();
                message["status"] = shell["status"].clone();
                if kind.ends_with("ended") {
                    message["time"]["completed"] = json!(2);
                    message["exit"] = shell["exit"].clone();
                    message["output"] = output;
                }
            }
            "session.compaction.started" => {
                let compaction = data["inputID"].as_str().map_or_else(|| replay_id(&id), str::to_owned);
                let message = self.message(
                    &compaction,
                    || json!({ "id": compaction, "type": "compaction", "reason": "auto", "time": { "created": 1 } }),
                );
                message["status"] = json!("running");
                message["summary"] = json!("");
                if let Some(object) = message.as_object_mut() {
                    object.remove("error");
                }
                self.compaction = Some(compaction);
            }
            "session.compaction.delta" | "session.compaction.ended" | "session.compaction.failed" => {
                let Some(compaction) = self.compaction.clone() else {
                    if kind.ends_with("ended") {
                        data["text"] = json!(extra);
                    }
                    return;
                };
                let delta = data["text"].as_str().unwrap_or_default().to_owned();
                let error = data["error"].clone();
                let message = self.message(&compaction, || Value::Null);
                let summary = message["summary"].as_str().unwrap_or_default().to_owned();
                match kind.as_str() {
                    "session.compaction.delta" => message["summary"] = json!(summary + &delta),
                    "session.compaction.ended" => {
                        message["summary"] = json!(summary + extra);
                        message["status"] = json!("completed");
                        data["text"] = message["summary"].clone();
                        self.compaction = None;
                    }
                    _ => {
                        message["status"] = json!("failed");
                        message["error"] = error;
                        self.compaction = None;
                    }
                }
            }
            "session.inbox.enqueued" => {
                let item = &data["item"];
                self.pending.push(json!({ "id": data["inboxID"], "sessionID": "ses_1", "time": { "created": 1 },
                    "type": "user", "payload": item["payload"], "delivery": item["delivery"] }));
            }
            "session.inbox.delivered" | "session.inbox.cancelled" => {
                let Some(index) = self.pending.iter().position(|item| item["id"] == data["inboxID"]) else { return };
                let item = self.pending.remove(index);
                if kind.ends_with("delivered") && self.messages.iter().all(|message| message["id"] != item["id"]) {
                    self.messages.push(json!({ "id": item["id"], "type": "user", "text": item["payload"]["text"],
                        "time": { "created": 1 } }));
                }
            }
            "session.step.started" => {
                self.assistant(&message);
            }
            "session.step.failed" => {
                let error = data["error"].clone();
                self.assistant(&message);
                self.message(&message, || Value::Null)["error"] = error;
            }
            "session.skill.activated" => {
                let skill = replay_id(&id);
                let name = data["name"].clone();
                self.message(&skill, || {
                    json!({ "id": skill, "type": "skill", "skill": "tidy", "name": name, "text": "x",
                        "time": { "created": 1 } })
                });
            }
            _ => {}
        }
    }
}

fn replay_id(event: &str) -> String {
    crate::replay::message_from_event(event)
}

pub(crate) struct Gen {
    rng: SplitMix64,
    tool_inputs: HashMap<String, String>,
    /// The tool calls a list or an input start announced: the server never sends a call's other events before.
    tool_calls: std::collections::HashSet<String>,
    /// A compaction runs: the server starts no other until it ends.
    compacting: bool,
    /// The inbox items so far: the server never enqueues an ID twice.
    enqueued: Vec<String>,
    /// Resize replays happen. Rust's restore of local rows deviates from TS (O89-mini-replay-rows.md), so the
    /// comparison with TS leaves them out.
    resizes: bool,
    seq: u64,
}

impl Gen {
    pub fn new(seed: u64) -> Self {
        Self {
            rng: SplitMix64(seed),
            tool_inputs: HashMap::new(),
            tool_calls: Default::default(),
            compacting: false,
            enqueued: Vec::new(),
            resizes: true,
            seq: 0,
        }
    }

    fn below(&mut self, n: u64) -> u64 {
        self.rng.below(n)
    }

    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[self.below(items.len() as u64) as usize]
    }

    fn text(&mut self, max: u64) -> String {
        (0..self.below(max + 1)).map(|_| self.pick(PIECES)).collect()
    }

    /// A delta: never empty, and never part of another, so a list covers only the deltas it holds. A live delta
    /// that occurs by chance in a listed text the stream has not caught up with is taken as covered, in TS too.
    fn delta(&mut self) -> String {
        format!("{}⟨{}⟩", self.pick(PIECES), self.seq)
    }

    /// What an end adds to the text its deltas streamed: usually nothing.
    fn extra(&mut self) -> String {
        if self.chance(30) { self.text(3) } else { String::new() }
    }

    fn event(&mut self, kind: &str, data: Value) -> Value {
        self.event_with(kind, data, None)
    }

    fn event_with(&mut self, kind: &str, mut data: Value, id: Option<String>) -> Value {
        self.seq += 1;
        if data.get("sessionID").is_none() {
            data["sessionID"] = json!("ses_1");
        }
        let id = id.unwrap_or_else(|| format!("evt_{}", self.seq));
        json!({ "id": id, "created": self.seq, "type": kind,
            "durable": { "aggregateID": "ses_1", "seq": self.seq, "version": 1 }, "data": data })
    }

    fn error(&mut self) -> Value {
        let kind = self.pick(&["provider", "aborted", "unknown"]);
        let message = self.pick(&["Boom", "", "rate limited"]);
        json!({ "type": kind, "message": message })
    }

    fn tool_state(&mut self) -> Value {
        let input = json!({ "command": "ls", "filePath": "/tmp/a.txt" });
        match self.below(4) {
            0 => json!({ "status": "streaming", "input": "" }),
            1 => json!({ "status": "running", "input": input, "metadata": { "output": self.text(3) } }),
            2 => json!({ "status": "completed", "input": input,
                "content": [{ "type": "text", "text": self.text(4) }], "metadata": { "output": self.text(3) } }),
            _ => json!({ "status": "error", "input": input, "error": self.error() }),
        }
    }

    fn message(&mut self) -> Value {
        let time = json!({ "created": 1 });
        match self.below(6) {
            0 | 1 => {
                let id = self.pick(USERS);
                let mut user = json!({ "id": id, "type": "user", "text": self.text(3), "time": time });
                if self.chance(20) {
                    user["files"] = json!([{ "data": "cG5n", "mime": "image/png", "source": { "type": "inline" },
                        "name": "a.png" }]);
                }
                user
            }
            2 | 3 => {
                let id = self.pick(ASSISTANTS);
                let mut content = Vec::new();
                for _ in 0..self.below(4) {
                    match self.below(3) {
                        kind @ (0 | 1) => {
                            let (kind, text) = (["text", "reasoning"][kind as usize], self.text(4));
                            content.push(json!({ "type": kind, "text": text }));
                        }
                        _ => {
                            let call = self.pick(CALLS);
                            if content.iter().any(|item| item["id"] == call) {
                                continue;
                            }
                            let name = self.pick(TOOLS);
                            content.push(json!({ "type": "tool", "id": call, "name": name,
                                "state": self.tool_state(), "time": { "created": 1 } }));
                        }
                    }
                }
                let mut message = json!({ "id": id, "type": "assistant", "agent": "build",
                    "model": { "id": "model", "providerID": "demo" }, "time": time, "content": content });
                if self.chance(15) {
                    message["error"] = self.error();
                }
                message
            }
            4 => {
                let shell = self.pick(SHELLS);
                let mut message = json!({ "id": format!("msg_{shell}"), "type": "shell", "shellID": shell,
                    "command": "echo hi", "status": "running", "time": { "created": 1 } });
                if self.chance(60) {
                    message["status"] = json!(self.pick(&["exited", "killed", "timeout"]));
                    message["time"]["completed"] = json!(2);
                    message["exit"] = json!(self.below(2));
                    message["output"] = json!({ "output": self.text(3), "cursor": 0, "size": 0, "truncated": false });
                }
                message
            }
            _ => {
                let id = self.pick(&["msg_c0", "msg_c1"]);
                // Only one compaction runs at a time.
                let status = if id == "msg_c0" { self.pick(&["running", "completed", "failed"]) } else { "completed" };
                let summary = self.text(3);
                let mut message = json!({ "id": id, "type": "compaction", "reason": "auto", "time": time,
                    "status": status, "summary": summary });

                if status == "failed" {
                    message["error"] = self.error();
                }
                self.compacting |= status == "running";
                message
            }
        }
    }

    fn live(&mut self) -> Value {
        let message = self.pick(ASSISTANTS);
        let kind = self.below(30);
        if (10..=15).contains(&kind) {
            let call = self.pick(CALLS);
            if !self.tool_calls.contains(&format!("{message}/{call}")) {
                return self.tool_started(message, call);
            }
            return self.tool(kind, message, call);
        }
        match kind {
            0..=4 => {
                let ordinal = self.below(2);
                let delta = self.delta();
                self.event(
                    "session.text.delta",
                    json!({ "assistantMessageID": message, "ordinal": ordinal,
                    "delta": delta }),
                )
            }
            5 => {
                let ordinal = self.below(2);
                let extra = self.extra();
                self.event(
                    "session.text.ended",
                    json!({ "assistantMessageID": message, "ordinal": ordinal,
                    "extra": extra }),
                )
            }
            6..=7 => {
                let ordinal = self.below(2);
                let delta = self.delta();
                self.event(
                    "session.reasoning.delta",
                    json!({ "assistantMessageID": message, "ordinal": ordinal,
                    "delta": delta }),
                )
            }
            8 => {
                let ordinal = self.below(2);
                let extra = self.extra();
                self.event(
                    "session.reasoning.ended",
                    json!({ "assistantMessageID": message, "ordinal": ordinal,
                    "extra": extra }),
                )
            }
            9 => {
                let call = self.pick(CALLS);
                self.tool_started(message, call)
            }
            16 => {
                let shell = self.shell("running");
                self.event("session.shell.started", json!({ "shell": shell }))
            }
            17 => {
                let status = self.pick(&["exited", "exited", "killed", "timeout"]);
                let shell = self.shell(status);
                let output = json!({ "output": self.text(3), "cursor": self.below(2), "size": self.below(2),
                    "truncated": self.chance(10) });
                self.event("session.shell.ended", json!({ "shell": shell, "output": output }))
            }
            18 if !self.compacting => {
                self.compacting = true;
                let mut data = json!({ "reason": "auto" });
                if self.chance(50) {
                    data["inputID"] = json!(format!("msg_ci{}", self.seq));
                }
                self.event("session.compaction.started", data)
            }
            18 | 19 => {
                let text = self.delta();
                self.event("session.compaction.delta", json!({ "text": text }))
            }
            20 => {
                self.compacting = false;
                let extra = self.extra();
                self.event("session.compaction.ended", json!({ "reason": "auto", "extra": extra }))
            }
            21 => {
                self.compacting = false;
                let error = self.error();
                self.event("session.compaction.failed", json!({ "reason": "auto", "error": error }))
            }
            22 => {
                let id = format!("msg_q{}", self.enqueued.len());
                self.enqueued.push(id.clone());
                let text = self.text(3);
                let delivery = self.pick(&["steer", "queue"]);
                self.event(
                    "session.inbox.enqueued",
                    json!({ "inboxID": id,
                    "item": { "type": "user", "payload": { "text": text }, "delivery": delivery } }),
                )
            }
            23 => {
                let id = match self.below(self.enqueued.len() as u64 + 1) as usize {
                    index if index < self.enqueued.len() => self.enqueued[index].clone(),
                    _ => self.pick(USERS).to_owned(),
                };
                if self.chance(70) {
                    return self.event("session.inbox.delivered", json!({ "inboxID": id }));
                }
                self.event("session.inbox.cancelled", json!({ "inboxID": id }))
            }
            24 => self.event(
                "session.step.started",
                json!({ "assistantMessageID": message, "agent": "build",
                "model": { "id": "model", "providerID": "demo" }, "started": 1 }),
            ),
            25 => {
                let tokens = self.below(3) * 10;
                let cost = self.below(2) as f64 / 4.0;
                self.event(
                    "session.step.ended",
                    json!({ "assistantMessageID": message, "finish": "stop",
                    "cost": cost, "tokens": { "input": tokens, "output": 0, "reasoning": 0,
                    "cache": { "read": 0, "write": 0 } } }),
                )
            }
            26 => {
                let error = self.error();
                self.event("session.step.failed", json!({ "assistantMessageID": message, "error": error }))
            }
            27 => match self.below(4) {
                0 => self.event("session.execution.started", json!({})),
                1 => self.event("session.execution.succeeded", json!({})),
                2 => {
                    let error = self.error();
                    self.event("session.execution.failed", json!({ "error": error }))
                }
                _ => {
                    let reason = self.pick(&["user", "shutdown", "superseded"]);
                    self.event("session.execution.interrupted", json!({ "reason": reason }))
                }
            },
            28 => {
                let id = format!("evt_{}", self.pick(&["s0", "s1"]));
                let data = json!({ "id": "tidy", "name": "tidy", "text": "x" });
                self.event_with("session.skill.activated", data, Some(id))
            }
            _ => {
                let delta = self.delta();
                self.event(
                    "session.text.delta",
                    json!({ "sessionID": "ses_2", "assistantMessageID": "msg_x",
                    "ordinal": 0, "delta": delta }),
                )
            }
        }
    }

    fn tool_started(&mut self, message: &str, call: &str) -> Value {
        self.tool_calls.insert(format!("{message}/{call}"));
        let name = self.pick(TOOLS);
        self.event("session.tool.input.started", json!({ "assistantMessageID": message, "id": call, "name": name }))
    }

    fn tool(&mut self, kind: u64, message: &str, call: &str) -> Value {
        match kind {
            10 => {
                let delta = self.delta();
                self.tool_inputs.entry(format!("{message}/{call}")).or_default().push_str(&delta);
                if self.chance(70) {
                    return self.event(
                        "session.tool.input.delta",
                        json!({ "assistantMessageID": message,
                        "id": call, "delta": delta }),
                    );
                }
                let text = self.tool_inputs.get(&format!("{message}/{call}")).cloned().unwrap_or_default();
                self.event(
                    "session.tool.input.ended",
                    json!({ "assistantMessageID": message, "id": call,
                    "text": text }),
                )
            }
            11 => self.event(
                "session.tool.called",
                json!({ "assistantMessageID": message, "id": call,
                    "input": { "command": "ls", "filePath": "/tmp/a.txt" }, "executed": true }),
            ),
            12..=13 => {
                let output = self.text(3);
                let mut metadata = json!({ "output": output });
                if self.chance(50) {
                    metadata["provider"] = json!("exa");
                }
                self.event(
                    "session.tool.progress",
                    json!({ "assistantMessageID": message, "id": call,
                    "metadata": metadata }),
                )
            }
            14 => {
                let text = self.text(3);
                let output = self.text(3);
                self.event(
                    "session.tool.success",
                    json!({ "assistantMessageID": message, "id": call,
                    "content": [{ "type": "text", "text": text }], "metadata": { "output": output },
                    "executed": true }),
                )
            }
            15 => {
                let error = self.error();
                self.event(
                    "session.tool.failed",
                    json!({ "assistantMessageID": message, "id": call,
                    "error": error, "executed": true }),
                )
            }
            _ => unreachable!(),
        }
    }

    fn shell(&mut self, status: &str) -> Value {
        let id = self.pick(SHELLS);
        let command = self.pick(&["echo hi", ""]);
        let mut shell = json!({ "id": id, "status": status, "command": command, "cwd": "/tmp", "shell": "bash",
            "file": "/tmp/out", "metadata": {}, "time": { "started": 1 } });
        if status != "running" {
            shell["exit"] = json!(self.below(2));
            shell["time"]["completed"] = json!(2);
        }
        shell
    }

    pub fn case(&mut self, events: u64) -> Case {
        self.tool_inputs.clear();
        self.compacting = false;
        let thinking = self.chance(70);
        let tools = self.chance(80);
        let active = self.chance(50);
        let mut ids = std::collections::HashSet::new();
        let history: Vec<Value> = (0..self.below(5))
            .map(|_| self.message())
            .filter(|message| ids.insert(message["id"].as_str().unwrap_or_default().to_owned()))
            .collect();
        self.tool_calls = history
            .iter()
            .flat_map(|message| {
                let id = message["id"].as_str().unwrap_or_default();
                let content = message["content"].as_array().map(Vec::as_slice).unwrap_or_default();
                content
                    .iter()
                    .filter(|item| item["type"] == "tool")
                    .map(move |item| format!("{id}/{}", item["id"].as_str().unwrap_or_default()))
            })
            .collect();
        self.enqueued.clear();
        let inbox = (0..self.below(2))
            .map(|_| {
                let id = format!("msg_q{}", self.enqueued.len());
                self.enqueued.push(id.clone());
                json!({ "id": id, "sessionID": "ses_1", "time": { "created": 1 }, "type": "user",
                    "payload": { "text": self.text(3) }, "delivery": "steer" })
            })
            .collect();
        let mut list = Vec::new();
        for _ in 0..self.below(events + 1) {
            match self.below(40) {
                0 if self.resizes => list.push(self.relist("@resize")),
                1 => {
                    list.push(self.relist("@reconnect"));
                    // The stream sends again the deltas that came while the list was read: the list holds them.
                    let deltas: Vec<Value> = list
                        .iter()
                        .rev()
                        .take_while(|event| !event["type"].as_str().unwrap_or_default().starts_with('@'))
                        .filter(|event| event["type"].as_str().is_some_and(|kind| kind.ends_with(".delta")))
                        .take(self.below(3) as usize)
                        .cloned()
                        .collect();
                    list.extend(deltas.into_iter().rev().map(|mut event| {
                        event["covered"] = json!(true);
                        event
                    }));
                }
                _ => list.push(self.live()),
            }
        }
        let events = list;
        Case { thinking, tools, active, history, inbox, events }
    }

    /// A resize replay or a reconnect, which lists the messages again.
    fn relist(&mut self, kind: &str) -> Value {
        json!({ "type": kind })
    }
}

/// The footer's phase, status and usage, folded from the patches as TS's footer folds them.
#[derive(Clone, Debug, Default)]
struct Footer {
    running: bool,
    status: String,
    usage: Value,
}

impl Footer {
    fn apply(&mut self, output: &Output) {
        let Some(patch) = &output.patch else { return };
        if let Some(running) = patch.running {
            self.running = running;
        }
        if let Some(status) = &patch.status {
            self.status = status.clone();
        }
        if let Some(usage) = &patch.usage {
            self.usage = match usage {
                Some(usage) => {
                    let mut value = json!({ "tokens": usage.tokens });
                    if let Some(cost) = usage.cost {
                        value["cost"] = json!(cost);
                    }
                    value
                }
                None => Value::Null,
            };
        }
    }

    fn json(&self, commits: usize) -> Value {
        json!({ "commits": commits, "phase": if self.running { "running" } else { "idle" }, "status": self.status,
            "usage": self.usage })
    }
}

fn name<T: std::fmt::Debug>(value: T) -> String {
    format!("{value:?}").to_lowercase()
}

pub(crate) fn commit_json(commit: &Commit) -> Value {
    json!({
        "kind": name(commit.kind),
        "source": name(commit.source),
        "phase": name(commit.phase),
        "text": commit.text,
        "messageID": commit.message_id,
        "partID": commit.part_id,
        "tool": commit.tool,
        "toolState": commit.tool_state.map(name),
        "toolError": commit.tool_error,
        "shell": commit.shell,
        "image": commit.image,
        "compaction": commit.compaction,
    })
}

/// Runs a case through the Rust transcript, as mini's shell feeds it: the inbox, the hydration, then each event.
pub(crate) fn run(case: &Case) -> Value {
    play(case).0
}

fn decode(value: &Value) -> SessionMessageInfo {
    SessionMessageInfo::deserialize(value).expect("generated message decodes")
}

/// The commits and footer states of a case, and the transcript after it.
fn play(case: &Case) -> (Value, Transcript) {
    let history: Vec<SessionMessageInfo> = case.history.iter().map(decode).collect();
    let inbox: Vec<opencode_api::generated::SessionInboxUser> =
        case.inbox.iter().map(|item| Deserialize::deserialize(item).expect("generated inbox item decodes")).collect();
    let mut transcript = Transcript::new("ses_1", case.thinking, case.tools, true, None);
    let mut commits = Vec::new();
    let mut footer = Footer::default();
    let mut states = Vec::new();
    transcript.inbox(&inbox);
    let output = transcript.hydrate(&history, case.active);
    footer.apply(&output);
    commits.extend(output.commits.iter().map(commit_json));
    states.push(footer.json(commits.len()));
    for event in &case.events() {
        if let Some(kind @ ("@resize" | "@reconnect")) = event["type"].as_str() {
            let list: Vec<SessionMessageInfo> = event["history"].as_array().unwrap().iter().map(decode).collect();
            let inbox: Vec<opencode_api::generated::SessionInboxUser> =
                event["inbox"].as_array().unwrap().iter().map(|item| Deserialize::deserialize(item).unwrap()).collect();
            let output = if kind == "@resize" {
                transcript.inbox(&inbox);
                transcript.begin_replay();
                transcript.replayed(&list, case.active)
            } else {
                transcript.disconnected();
                footer.running = true;
                footer.status = "reconnecting".into();
                transcript.inbox(&inbox);
                transcript.hydrate(&list, case.active)
            };
            footer.apply(&output);
            commits.extend(output.commits.iter().map(commit_json));
            states.push(footer.json(commits.len()));
            continue;
        }
        let event = V2Event::deserialize(event).expect("generated event decodes");
        assert!(!matches!(event, V2Event::Unknown(_)), "generated event is unknown: {event:?}");
        let output = transcript.event(&event);
        footer.apply(&output);
        commits.extend(output.commits.iter().map(commit_json));
        states.push(footer.json(commits.len()));
    }
    (json!({ "commits": commits, "states": states }), transcript)
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// The TypeScript transport's output for each case, or None without Bun or the workspace's packages.
fn typescript(cases: &[Case]) -> Option<Vec<Value>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let present = root.join("node_modules").is_dir()
        && std::process::Command::new("bun").arg("--version").output().is_ok_and(|output| output.status.success());
    if !present {
        assert!(std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(), "bun or node_modules is missing");
        eprintln!("skipped: needs bun and the workspace's node_modules");
        return None;
    }
    let file = std::env::temp_dir().join(format!("mini-transport-{}.json", std::process::id()));
    let input: Vec<Value> = cases.iter().map(Case::json).collect();
    std::fs::write(&file, serde_json::to_vec(&input).unwrap()).unwrap();
    if let Some(dump) = std::env::var_os("MODEL_DUMP") {
        std::fs::copy(&file, dump).unwrap();
    }
    let script = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/M.6-transcript.ts");
    let output = std::process::Command::new("bun").arg(script).arg(&file).output().unwrap();
    let _ = std::fs::remove_file(&file);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    Some(serde_json::from_slice(&output.stdout).unwrap())
}

/// Where Rust and TS first differ: the step, its event, the footer states and the commits from the first that
/// differs.
fn difference(case: &Case, rust: &Value, ts: &Value) -> String {
    let list = |value: &Value, key: &str| value[key].as_array().cloned().unwrap_or_default();
    let (rust_states, ts_states) = (list(rust, "states"), list(ts, "states"));
    let step = (0..rust_states.len().max(ts_states.len()))
        .find(|&index| rust_states.get(index) != ts_states.get(index))
        .unwrap_or(rust_states.len());
    let upto = |value: &Value, states: &[Value]| {
        let end = states.get(step).and_then(|state| state["commits"].as_u64()).unwrap_or(u64::MAX) as usize;
        list(value, "commits").into_iter().take(end).collect::<Vec<_>>()
    };
    let (rust_commits, ts_commits) = (upto(rust, &rust_states), upto(ts, &ts_states));
    let first = (0..rust_commits.len().max(ts_commits.len()))
        .find(|&index| rust_commits.get(index) != ts_commits.get(index))
        .unwrap_or(0);
    let from = |commits: &[Value]| serde_json::to_string(commits.get(first..).unwrap_or_default()).unwrap();
    let event = step.checked_sub(1).and_then(|index| case.events().get(index).cloned());
    format!(
        "case {}\ndiffers at step {step} (0 is the hydration), event {}\nrust state: {}\nts state:   {}\nrust commits from {first}: {}\nts commits from {first}:   {}",
        case.json(),
        event.as_ref().map(Value::to_string).unwrap_or_default(),
        rust_states.get(step).map(Value::to_string).unwrap_or_default(),
        ts_states.get(step).map(Value::to_string).unwrap_or_default(),
        from(&rust_commits),
        from(&ts_commits),
    )
}

/// Shrinks a failing case: drops events, history and inbox items one at a time while it still fails.
fn shrink(mut case: Case, fails: impl Fn(&Case) -> bool) -> Case {
    let lists: [fn(&mut Case) -> &mut Vec<Value>; 3] =
        [|case| &mut case.events, |case| &mut case.history, |case| &mut case.inbox];
    loop {
        let mut smaller = false;
        for list in lists {
            let mut index = 0;
            while index < list(&mut case).len() {
                let removed = list(&mut case).remove(index);
                if fails(&case) {
                    smaller = true;
                    continue;
                }
                list(&mut case).insert(index, removed);
                index += 1;
            }
        }
        if !smaller {
            return case;
        }
    }
}

#[test]
fn the_transcript_prints_what_typescript_prints() {
    let seed = env("MODEL_SEED", 1);
    let count = env("MODEL_CASES", 40);
    let mut generator = Gen { resizes: false, ..Gen::new(seed) };
    let cases: Vec<Case> = (0..count).map(|_| generator.case(env("MODEL_EVENTS", 30))).collect();
    let rust: Vec<Value> = cases.iter().map(run).collect();
    let Some(ts) = typescript(&cases) else { return };
    let failing: Vec<usize> = (0..cases.len()).filter(|&index| rust[index] != ts[index]).collect();
    let Some(&index) = failing.first() else { return };
    let fails = |case: &Case| run(case) != typescript(std::slice::from_ref(case)).unwrap()[0];
    let case = cases.into_iter().nth(index).unwrap();
    let case = if std::env::var_os("MODEL_NO_SHRINK").is_some() { case } else { shrink(case, fails) };
    let ts = typescript(std::slice::from_ref(&case)).unwrap();
    panic!("{} of {count} cases differ; shrunk:\n{}", failing.len(), difference(&case, &run(&case), &ts[0]));
}

/// After any stream, a resize replay of the server's list prints what a new client prints for that list.
#[test]
fn a_resize_replay_prints_what_a_new_client_prints() {
    let seed = env("MODEL_SEED", 1);
    let count = env("MODEL_CASES", 200);
    let mut generator = Gen::new(seed);
    let fails = |case: &Case| -> Option<String> {
        let (_, mut transcript) = play(case);
        let fold: Vec<SessionMessageInfo> = case.fold().iter().map(decode).collect();
        transcript.begin_replay();
        let replayed: Vec<Value> = transcript.replayed(&fold, case.active).commits.iter().map(commit_json).collect();
        let mut fresh = Transcript::new("ses_1", case.thinking, case.tools, true, None);
        let expected: Vec<Value> = fresh.hydrate(&fold, case.active).commits.iter().map(commit_json).collect();
        (replayed != expected).then(|| {
            format!(
                "replayed {}
expected {}",
                Value::from(replayed),
                Value::from(expected)
            )
        })
    };
    for index in 0..count {
        let case = generator.case(env("MODEL_EVENTS", 30));
        if fails(&case).is_none() {
            continue;
        }
        let case = shrink(case, |case| fails(case).is_some());
        panic!("case {index} of seed {seed}, shrunk:\n{}\n{}", case.json(), fails(&case).unwrap());
    }
}
