//! The session transcript under random streams, page loads, reverts, moves, resizes and session switches, against a
//! reference transcript. Each paragraph shows one marker, so the markers on screen must be a window of the model's.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_api::generated::{SessionID, V2Event};
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Bounded, Info, Scroll};
use opencode_plugin::abi::v2::TranscriptView;
use opencode_tui::Deps;
use serde_json::{Value, json};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    User,
    Assistant { completed: bool },
    Compaction,
}

/// A message and the markers of its paragraphs, by part.
#[derive(Clone, Debug)]
struct Message {
    id: String,
    kind: Kind,
    parts: Vec<Vec<String>>,
}

impl Message {
    fn created(&self) -> u64 {
        self.id["msg_".len()..].parse::<u64>().unwrap() * 1000
    }

    /// Whether message navigation stops here: a user message, or an assistant one with text.
    fn stop(&self, user_only: bool) -> bool {
        match self.kind {
            Kind::User => true,
            Kind::Assistant { .. } => !user_only,
            Kind::Compaction => false,
        }
    }

    fn json(&self) -> Value {
        let created = self.created();
        let text = |part: &Vec<String>| part.join("\n\n");
        match self.kind {
            Kind::User => {
                json!({ "id": self.id, "type": "user", "text": text(&self.parts[0]), "time": { "created": created } })
            }
            Kind::Compaction => json!({
                "id": self.id, "type": "compaction", "status": "completed", "reason": "manual",
                "summary": text(&self.parts[0]), "time": { "created": created },
            }),
            Kind::Assistant { completed } => {
                let content: Vec<Value> =
                    self.parts.iter().map(|part| json!({ "type": "text", "text": text(part) })).collect();
                let mut message = json!({
                    "id": self.id, "type": "assistant", "agent": "build",
                    "model": { "providerID": "provider", "id": "model" },
                    "time": { "created": created }, "content": content,
                });
                if completed {
                    message["time"]["completed"] = json!(created + 500);
                    message["finish"] = json!("stop");
                }
                message
            }
        }
    }
}

/// A session as the server holds it: its messages and its staged revert.
#[derive(Clone, Default)]
struct Session {
    messages: Vec<Message>,
    revert: Option<String>,
}

impl Session {
    /// The messages before the staged revert.
    fn visible(&self) -> &[Message] {
        let end = self.revert.as_ref().map_or(self.messages.len(), |revert| {
            self.messages.iter().position(|message| message.id >= *revert).unwrap_or(self.messages.len())
        });
        &self.messages[..end]
    }

    fn markers(&self) -> Vec<String> {
        self.visible().iter().flat_map(|message| message.parts.iter().flatten().cloned()).collect()
    }
}

/// The sessions, and the requests in flight and answered, which a settled frame waits for.
#[derive(Clone, Default)]
struct Server(Arc<Mutex<HashMap<String, Session>>>, Arc<(AtomicUsize, AtomicUsize)>);

impl Transport for Server {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        let query: HashMap<String, String> = request.url.query_pairs().into_owned().collect();
        let sessions = self.0.lock().unwrap();
        let parts: Vec<&str> = path.trim_start_matches("/api/session/").split('/').collect();
        let (status, body) = match (request.method, parts.as_slice()) {
            ("GET", _) if path == "/api/session" => (200, json!({ "data": [], "cursor": {} })),
            ("GET", [id]) if sessions.contains_key(*id) => {
                let mut info = support::merge(support::session(id, "Model"), json!({ "agent": "build" }));
                if let Some(revert) = &sessions[*id].revert {
                    info["revert"] = json!({ "messageID": revert });
                }
                (200, json!({ "data": info }))
            }
            ("GET", [id, "message"]) if sessions.contains_key(*id) => {
                let messages = &sessions[*id].messages;
                let limit: usize = query.get("limit").map_or(20, |limit| limit.parse().unwrap());
                let end = query.get("cursor").map_or(messages.len(), |cursor| cursor.parse().unwrap());
                let end = end.min(messages.len());
                let start = end.saturating_sub(limit);
                let page: Vec<_> = messages[start..end].iter().rev().map(Message::json).collect();
                let next = (start > 0).then(|| start.to_string());
                (200, json!({ "data": page, "cursor": { "next": next } }))
            }
            ("GET", [id, "permission" | "form" | "inbox"]) if sessions.contains_key(*id) => {
                (200, json!({ "data": [] }))
            }
            _ => support::not_found(),
        };
        drop(sessions);
        self.1.0.fetch_add(1, Ordering::SeqCst);
        let requests = self.1.clone();
        Box::pin(async move {
            requests.0.fetch_sub(1, Ordering::SeqCst);
            requests.1.fetch_add(1, Ordering::SeqCst);
            Ok(support::respond(status, &body))
        })
    }
}

#[derive(Clone, Debug)]
enum Command {
    /// The session opens with this many turns of history; only as the first command.
    Open(usize),
    /// A prompt is delivered as a user message.
    User,
    /// A new assistant step starts with one paragraph.
    Assistant,
    /// A paragraph streams onto the open part of the last message, an assistant's.
    Delta,
    /// The last message, an assistant's, starts a new part.
    Part,
    /// The last message's step ends, which shows its footer.
    End,
    /// A compaction summary.
    Compact,
    /// A revert is staged at the n-th message from the end.
    Stage(usize),
    Clear,
    Commit,
    Wheel {
        up: bool,
        steps: u16,
    },
    /// A command of the keymap.
    Do(&'static str),
    Resize(u16, u16),
    /// Another session shows, then this one again.
    Away,
}

const MOVES: &[&str] = &[
    "session.page.up",
    "session.page.down",
    "session.line.up",
    "session.line.down",
    "session.half.page.up",
    "session.half.page.down",
    "session.first",
    "session.last",
    "session.message.next",
    "session.message.previous",
    "session.message.user.next",
    "session.message.user.previous",
    "session.messages_last_user",
];

const SIZES: &[(u16, u16)] = &[(40, 12), (60, 16), (80, 24), (100, 30), (120, 20), (160, 40)];

struct Transcripts;

impl Model for Transcripts {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let turns = [0, 1, 3, 12, 30, 60][rng.below(6)];
        std::iter::once(Command::Open(turns))
            .chain((0..steps).map(|_| match rng.below(100) {
                0..6 => Command::User,
                6..12 => Command::Assistant,
                12..24 => Command::Delta,
                24..28 => Command::Part,
                28..32 => Command::End,
                32..34 => Command::Compact,
                34..36 => Command::Stage(rng.below(6)),
                36..37 => Command::Clear,
                37..38 => Command::Commit,
                38..60 => Command::Wheel { up: rng.below(3) > 0, steps: 1 + rng.below(12) as u16 },
                60..86 => Command::Do(rng.pick(MOVES)),
                86..94 => {
                    let (width, height) = *rng.pick(SIZES);
                    Command::Resize(width, height)
                }
                _ => Command::Away,
            }))
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let turns = match commands.first() {
            Some(Command::Open(turns)) => *turns,
            _ => 0,
        };
        let mut walk = Walk::open(turns);
        for (step, command) in commands.iter().enumerate() {
            if let Err((site, detail)) = walk.step(command) {
                return Some(Failure { property: "transcript", site, step, detail });
            }
        }
        None
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Open(turns) if *turns > 0 => vec![Command::Open(turns / 2)],
            Command::Wheel { up, steps } if *steps > 1 => vec![Command::Wheel { up: *up, steps: steps / 2 }],
            Command::Stage(n) if *n > 0 => vec![Command::Stage(n - 1)],
            _ => Vec::new(),
        }
    }
}

thread_local! {
    static SEEN: std::cell::RefCell<Option<TranscriptView>> = const { std::cell::RefCell::new(None) };
    static CASE: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

fn reader(setup: &mut opencode_plugin::abi::Setup) -> Result<(), String> {
    setup.command(opencode_plugin::abi::Command::new("model.read"), |host, _| {
        SEEN.with(|seen| *seen.borrow_mut() = host.transcript());
    });
    Ok(())
}

/// What a frame shows of the transcript.
#[derive(Clone, Debug)]
struct Shown {
    /// The markers on screen with their rows, top to bottom.
    markers: Vec<(String, usize)>,
    latest: bool,
    view: TranscriptView,
    screen: String,
}

impl Shown {
    fn at_tail(&self) -> bool {
        self.view.offset + self.view.viewport >= self.view.extent
    }

    fn row(&self, marker: &str) -> Option<usize> {
        self.markers.iter().find(|(shown, _)| shown == marker).map(|(_, row)| *row)
    }

    fn names(&self) -> Vec<&str> {
        self.markers.iter().map(|(marker, _)| marker.as_str()).collect()
    }

    fn top(&self) -> Option<&str> {
        self.markers.first().map(|(marker, _)| marker.as_str())
    }
}

/// The markers in \`screen\`, an \`M\` and four digits, with their rows.
fn markers(screen: &str) -> Vec<(String, usize)> {
    let mut found = Vec::new();
    for (row, line) in screen.lines().enumerate() {
        let bytes = line.as_bytes();
        for (at, _) in line.match_indices('M') {
            let digits = bytes.get(at + 1..at + 5).is_some_and(|digits| digits.iter().all(u8::is_ascii_digit));
            let bounded = at == 0 || !bytes[at - 1].is_ascii_alphanumeric();
            let ends = bytes.get(at + 5).is_none_or(|next| !next.is_ascii_alphanumeric());
            if digits && bounded && ends {
                found.push((line[at..at + 5].to_owned(), row));
            }
        }
    }
    found
}

/// The message the last jump aligned, as far as the model knows it.
#[derive(Clone, Debug, PartialEq)]
enum Navigation {
    None,
    At(String),
    /// A move the model does not follow may have kept or cleared it.
    Unknown,
}

struct Walk {
    harness: Harness,
    server: Server,
    id: String,
    other: String,
    /// The next number, for a message or a marker.
    next: u64,
    seq: u64,
    navigation: Navigation,
    /// Whether the last explicit scroll left the view at the bottom, which OpenTUI's scroll box then follows. A
    /// resize that brings the bottom into view does not.
    stuck: bool,
    /// A commit removed rows: the window's start then follows the tail until the tail passes it again, and rows
    /// that leave above move the view (TS too), so new rows no longer hold it.
    unpinned: bool,
}

type Check = Result<(), (&'static str, String)>;

fn fail(site: &'static str, detail: String) -> Check {
    Err((site, detail))
}

impl Walk {
    fn open(turns: usize) -> Self {
        let case = CASE.with(|case| case.replace(case.get() + 1));
        let (id, other) = (format!("ses_m{case}"), format!("ses_o{case}"));
        let server = Server::default();
        let mut next = 1;
        let mut take = || {
            next += 1;
            next - 1
        };
        let mut messages = Vec::new();
        for turn in 0..turns {
            let user = take();
            messages.push(Message {
                id: format!("msg_{user:04}"),
                kind: Kind::User,
                parts: vec![vec![format!("M{:04}", take())]],
            });
            let reply = take();
            let parts =
                (0..1 + turn % 3).map(|_| (0..1 + turn / 3 % 3).map(|_| format!("M{:04}", take())).collect()).collect();
            messages.push(Message { id: format!("msg_{reply:04}"), kind: Kind::Assistant { completed: true }, parts });
            if turn % 17 == 16 {
                let compaction = take();
                let summary = vec![vec![format!("M{:04}", take())]];
                messages.push(Message { id: format!("msg_{compaction:04}"), kind: Kind::Compaction, parts: summary });
            }
        }
        let elsewhere =
            vec![Message { id: "msg_0000".into(), kind: Kind::User, parts: vec![vec!["Elsewhere".into()]] }];
        {
            let mut sessions = server.0.lock().unwrap();
            sessions.insert(id.clone(), Session { messages, revert: None });
            sessions.insert(other.clone(), Session { messages: elsewhere, revert: None });
        }
        let info = Info { scroll: Some(Scroll { speed: Some(Bounded(1.0)), ..Scroll::default() }), ..support::still() };
        let mut deps = Deps {
            config: support::config(info),
            route: support::session_route(&id),
            ..support::deps(Arc::new(server.clone()))
        };
        deps.builtins.push(opencode_plugin::abi::Plugin { id: "test.reader", setup: reader }.into());
        // A still plugin clock: on a loaded machine a slow built-in's toast would cover the rows.
        let harness = support::mount_still(80, 24, deps);
        Self { harness, server, id, other, next, seq: 1, navigation: Navigation::None, stuck: true, unpinned: false }
    }

    fn session(&self) -> Session {
        self.server.0.lock().unwrap()[&self.id].clone()
    }

    fn edit<T>(&self, change: impl FnOnce(&mut Session) -> T) -> T {
        change(self.server.0.lock().unwrap().get_mut(&self.id).unwrap())
    }

    fn take(&mut self) -> u64 {
        self.next += 1;
        self.next - 1
    }

    fn apply(&mut self, id: String, kind: &str, created: u64, data: Value) {
        let seq = self.seq;
        self.seq += 1;
        let event: V2Event = serde_json::from_value(json!({
            "id": id, "created": created, "type": kind,
            "durable": { "aggregateID": self.id, "seq": seq, "version": 1 },
            "data": data,
        }))
        .unwrap();
        self.harness.tui.data.apply(&[event]);
    }

    fn event(&mut self, kind: &str, created: u64, data: Value) {
        let id = format!("evt_s{}", self.seq);
        self.apply(id, kind, created, data);
    }

    /// Runs the app until its frame stops changing and no page loads.
    fn settle(&self) -> Result<String, (&'static str, String)> {
        let app = &self.harness.app;
        let session = SessionID(self.id.clone());
        let mut last = String::new();
        let mut stable = 0;
        let mut answered = usize::MAX;
        for _ in 0..3000 {
            app.advance(Duration::from_millis(1));
            let text = app.render().text();
            // Store flushes reach the views through a task on the runtime, and an answer reaches the store through
            // another.
            let requests = &self.server.1;
            let fresh = requests.1.load(Ordering::SeqCst);
            let loading = self.harness.tui.data.read(|state| state.messages_loading(&session))
                || text.contains("Loading session history")
                || !self.harness.tui.synced()
                || requests.0.load(Ordering::SeqCst) > 0
                || std::mem::replace(&mut answered, fresh) != fresh;
            let busy = loading || app.needs_frame();
            stable = if !busy && text == last { stable + 1 } else { 0 };
            if stable == 3 {
                return Ok(text);
            }
            if loading {
                std::thread::sleep(Duration::from_millis(1));
            }
            last = text;
        }
        Err(("settle", format!("the frame never settled:\n{last}")))
    }

    fn shown(&self) -> Result<Shown, (&'static str, String)> {
        let screen = self.settle()?;
        self.harness.tui.keymap.dispatch("model.read", None);
        let view = SEEN.with(|seen| seen.borrow_mut().take()).expect("the transcript is published");
        Ok(Shown { markers: markers(&screen), latest: screen.contains("Jump to latest"), view, screen })
    }

    /// The last message when it is an assistant's open step, and no revert is staged.
    fn open_step(&self) -> Option<Message> {
        let session = self.session();
        let last = session.messages.last().filter(|_| session.revert.is_none())?;
        (last.kind == Kind::Assistant { completed: false }).then(|| last.clone())
    }

    fn step(&mut self, command: &Command) -> Check {
        let before = self.shown()?;
        let following = self.stuck && self.navigation == Navigation::None && before.at_tail() && !before.latest;
        // OpenTUI's scroll box also follows from one row short of the bottom, a program scroll that lands at the bottom
        // (a row pinned through a re-render) follows it again, and one that does not follow can still sit there, so
        // such a view may follow or hold.
        let resting = before.at_tail() && !before.latest && self.navigation == Navigation::None;
        let either = !following && (resting || self.stuck && !matches!(self.navigation, Navigation::At(_)));
        let staged = self.session().revert.is_some();
        let sid = self.id.clone();
        // Whether the command added content at the end.
        let mut added = false;
        match command {
            Command::Open(_) => {}
            Command::User if !staged => {
                let (number, marker) = (self.take(), self.take());
                let id = format!("msg_{number:04}");
                let created = number * 1000;
                self.edit(|session| {
                    session.messages.push(Message {
                        id: id.clone(),
                        kind: Kind::User,
                        parts: vec![vec![format!("M{marker:04}")]],
                    })
                });
                let item =
                    json!({ "type": "user", "delivery": "steer", "payload": { "text": format!("M{marker:04}") } });
                self.event("session.inbox.enqueued", created, json!({ "sessionID": sid, "inboxID": id, "item": item }));
                self.event("session.inbox.delivered", created, json!({ "sessionID": sid, "inboxID": id }));
                added = true;
            }
            Command::Assistant if !staged => {
                let (number, marker) = (self.take(), self.take());
                let id = format!("msg_{number:04}");
                let created = number * 1000;
                self.edit(|session| {
                    for message in &mut session.messages {
                        if message.kind == (Kind::Assistant { completed: false }) {
                            message.kind = Kind::Assistant { completed: true };
                        }
                    }
                    let parts = vec![vec![format!("M{marker:04}")]];
                    session.messages.push(Message {
                        id: id.clone(),
                        kind: Kind::Assistant { completed: false },
                        parts,
                    });
                });
                let model = json!({ "providerID": "provider", "id": "model" });
                let started = json!({ "sessionID": sid, "assistantMessageID": id, "agent": "build", "model": model, "started": created });
                self.event("session.step.started", created, started);
                self.event(
                    "session.text.started",
                    created,
                    json!({ "sessionID": sid, "assistantMessageID": id, "ordinal": 0 }),
                );
                let delta = json!({ "sessionID": sid, "assistantMessageID": id, "ordinal": 0, "delta": format!("M{marker:04}") });
                self.event("session.text.delta", created, delta);
                added = true;
            }
            Command::Delta | Command::Part => {
                if let Some(step) = self.open_step() {
                    let marker = format!("M{:04}", self.take());
                    let part = command_part(command, &step);
                    let id = step.id.clone();
                    self.edit(|session| {
                        let last = session.messages.last_mut().unwrap();
                        match last.parts.get_mut(part) {
                            Some(paragraphs) => paragraphs.push(marker.clone()),
                            None => last.parts.push(vec![marker.clone()]),
                        }
                    });
                    let created = step.created();
                    if part == step.parts.len() {
                        let data = json!({ "sessionID": sid, "assistantMessageID": id, "ordinal": part });
                        self.event("session.text.started", created, data);
                    }
                    let text = if part < step.parts.len() { format!("\n\n{marker}") } else { marker };
                    let data = json!({ "sessionID": sid, "assistantMessageID": id, "ordinal": part, "delta": text });
                    self.event("session.text.delta", created, data);
                    added = true;
                }
            }
            Command::End => {
                if let Some(step) = self.open_step() {
                    self.edit(|session| {
                        session.messages.last_mut().unwrap().kind = Kind::Assistant { completed: true }
                    });
                    let tokens =
                        json!({ "input": 10, "output": 20, "reasoning": 0, "cache": { "read": 0, "write": 0 } });
                    let data = json!({ "sessionID": sid, "assistantMessageID": step.id, "finish": "stop", "cost": 0, "tokens": tokens });
                    self.event("session.step.ended", step.created() + 500, data);
                    added = true;
                }
            }
            Command::Compact if !staged => {
                let (number, marker) = (self.take(), self.take());
                let created = number * 1000;
                self.edit(|session| {
                    let parts = vec![vec![format!("M{marker:04}")]];
                    session.messages.push(Message { id: format!("msg_{number:04}"), kind: Kind::Compaction, parts })
                });
                let data = json!({ "sessionID": sid, "reason": "manual", "text": format!("M{marker:04}") });
                self.apply(format!("evt_{number:04}"), "session.compaction.ended", created, data);
                added = true;
            }
            Command::Stage(back) => {
                let visible = self.session().visible().to_vec();
                if let Some(message) = visible.len().checked_sub(back + 1).map(|index| visible[index].clone()) {
                    self.edit(|session| session.revert = Some(message.id.clone()));
                    let created = self.next * 1000;
                    self.event(
                        "session.revert.staged",
                        created,
                        json!({ "sessionID": sid, "revert": { "messageID": message.id } }),
                    );
                }
            }
            Command::Clear if staged => {
                self.edit(|session| session.revert = None);
                self.event("session.revert.cleared", self.next * 1000, json!({ "sessionID": sid }));
            }
            Command::Commit if staged => {
                self.unpinned = true;
                let to = self.edit(|session| {
                    let to = session.revert.take().unwrap();
                    session.messages.retain(|message| message.id < to);
                    to
                });
                self.event("session.revert.committed", self.next * 1000, json!({ "sessionID": sid, "to": to }));
            }
            Command::User | Command::Assistant | Command::Compact | Command::Clear | Command::Commit => {}
            Command::Wheel { up, steps } => {
                for _ in 0..*steps {
                    self.harness.app.scroll(10, 3, !up);
                }
            }
            Command::Do(command) => {
                self.harness.tui.keymap.dispatch(command, None);
            }
            Command::Resize(width, height) => self.harness.app.resize(*width, *height),
            Command::Away => {
                self.harness.tui.show_session(SessionID(self.other.clone()));
                self.settle()?;
                self.harness.tui.show_session(SessionID(self.id.clone()));
            }
        }
        let after = self.shown()?;
        let session = self.session();
        let all = session.markers();
        let context = || format!("before:\n{}\nafter:\n{}", before.screen, after.screen);
        // A jump's slack can leave blank rows past the end of a transcript that shrank.
        // So can a staged revert's banner, which takes the last rows.
        let slack = self.navigation != Navigation::None;
        let rows = if session.revert.is_some() { 9 } else { 6 };
        window(&all, &after, slack, rows).or_else(|(site, detail)| fail(site, format!("{detail}\n{}", context())))?;
        let tail = |site| {
            let last = all.last().map(String::as_str);
            // A staged revert's banner ends the transcript.
            let shown = session.revert.is_some() || after.names().last().copied() == last;
            if after.at_tail() && shown && !after.latest {
                return Ok(());
            }
            fail(site, format!("not at the tail ({:?}, last {last:?}):\n{}", after.view.offset, context()))
        };
        let navigable = |user_only: bool| -> Vec<Message> {
            session.visible().iter().filter(|message| message.stop(user_only)).cloned().collect()
        };
        match command {
            Command::Open(_) => tail("open")?,
            Command::User | Command::Assistant | Command::Delta | Command::Part | Command::End | Command::Compact
                if added =>
            {
                if following {
                    tail("follow")?;
                } else if !either
                    && !self.unpinned
                    && let Some((marker, row)) =
                        before.markers.iter().find(|(marker, row)| after.row(marker) != Some(*row))
                {
                    return fail("held", format!("{marker} left row {row}:\n{}", context()));
                }
            }
            Command::Stage(_) | Command::Clear | Command::Commit if following => tail("revert")?,
            Command::Wheel { up, .. } => {
                rigid(&before, &after, *up).or_else(|(site, detail)| fail(site, format!("{detail}\n{}", context())))?;
                if following && !up {
                    tail("wheel-tail")?;
                }
            }
            Command::Do(name) => match *name {
                "session.first" => {
                    self.navigation = Navigation::None;
                    let shown = after.view.viewport < 6 || after.top() == all.first().map(String::as_str);
                    if !shown || after.view.offset != 0 {
                        return fail("first", context());
                    }
                }
                "session.last" => {
                    self.navigation = Navigation::None;
                    tail("last")?;
                }
                "session.message.next"
                | "session.message.previous"
                | "session.message.user.next"
                | "session.message.user.previous" => {
                    let next = name.ends_with("next");
                    let stops = navigable(name.contains(".user."));
                    let was_none = self.navigation == Navigation::None;
                    let current = match &self.navigation {
                        Navigation::At(id) => stops.iter().position(|message| message.id == *id),
                        _ => None,
                    };
                    if let Some(index) = current {
                        let target = if next {
                            stops.get(index + 1)
                        } else {
                            index.checked_sub(1).and_then(|index| stops.get(index))
                        };
                        if let Some(target) = target {
                            let first = target.markers_first();
                            if after.top() != Some(first) {
                                return fail("jump", format!("{first} is not at the top:\n{}", context()));
                            }
                            self.navigation = Navigation::At(target.id.clone());
                        }
                    } else {
                        let owner = |shown: &Shown| {
                            shown.top().and_then(|marker| {
                                session
                                    .visible()
                                    .iter()
                                    .position(|message| message.parts.iter().flatten().any(|m| m == marker))
                            })
                        };
                        let landed =
                            after.top().and_then(|top| stops.iter().find(|message| message.markers_first() == top));
                        // Without a target nothing moves, and the navigation stays; a target already at the top does
                        // not move either.
                        if before.screen != after.screen {
                            self.navigation =
                                landed.map_or(Navigation::Unknown, |message| Navigation::At(message.id.clone()));
                        } else if landed.is_some() {
                            self.navigation = Navigation::Unknown;
                        }
                        // A jump the wheel moved away from still steps from it, so only a view no jump aligned has
                        // a direction. Rows that mount above first leave the target to the old offset, as TS's
                        // unpinned mount does.
                        if let (Some(from), Some(to)) = (owner(&before), owner(&after))
                            && was_none
                            && before.view.above == 0
                            && (next && to < from || !next && to > from)
                        {
                            return fail("jump-direction", context());
                        }
                    }
                }
                "session.messages_last_user" => {
                    // It looks behind a staged revert too, as TS does, and then finds no row to align.
                    let last = session.messages.iter().rfind(|message| message.kind == Kind::User);
                    if let Some(last) = last.filter(|last| session.visible().iter().any(|shown| shown.id == last.id)) {
                        let first = last.markers_first();
                        if after.top() != Some(first) {
                            return fail("last-user", format!("{first} is not at the top:\n{}", context()));
                        }
                        self.navigation = Navigation::At(last.id.clone());
                    }
                }
                _ => {
                    let up = name.ends_with(".up");
                    // A move drops a jump's slack first, so a move down from past the end settles at the end, and any
                    // move from past it goes further.
                    let held = self.navigation != Navigation::None;
                    if up || !held {
                        rigid(&before, &after, up)
                            .or_else(|(site, detail)| fail(site, format!("{detail}\n{}", context())))?;
                    }
                    if !held {
                        distance(&before, &after, name)
                            .or_else(|(site, detail)| fail(site, format!("{detail}\n{}", context())))?;
                    }
                    self.navigation = Navigation::None;
                }
            },
            Command::Resize(..) => {
                // A resize ends message navigation and drops its slack.
                self.navigation = Navigation::None;
                if following {
                    tail("resize-tail")?;
                } else if let Some(top) = before.top()
                    && after.view.viewport >= before.view.viewport
                    && all.iter().any(|marker| marker == top)
                    && after.row(top).is_none()
                {
                    return fail("resize-held", format!("{top} left the screen:\n{}", context()));
                }
            }
            Command::Away => {
                // Restoring the reader's row adds slack below the rows when it was near the end, as a jump does; the
                // hint shows while it does.
                self.navigation = if following || !after.latest { Navigation::None } else { Navigation::Unknown };
                if following {
                    tail("away-tail")?;
                } else if before.names() != after.names() {
                    return fail("restore", context());
                }
            }
            _ => {}
        }
        // An explicit scroll leaves the view following the bottom when it reached it, or while the range is at most
        // one row.
        let reached = after.at_tail() || after.view.extent - after.view.viewport <= 1;
        let jump = matches!(command, Command::Do(name) if name.contains("message"));
        match command {
            // A jump with no target does not scroll.
            Command::Do(_) if jump && before.view.offset == after.view.offset => {}
            Command::Wheel { .. } | Command::Do(_) => self.stuck = reached,
            Command::Away if !following => self.stuck = reached,
            _ => {}
        }
        if let Navigation::At(id) = &self.navigation
            && !session.visible().iter().any(|message| message.id == *id)
        {
            self.navigation = Navigation::Unknown;
        }
        if matches!(command, Command::Wheel { .. }) && self.navigation != Navigation::None {
            self.navigation = Navigation::Unknown;
        }
        // "Jump to latest" shows only away from the latest rows, or while a jump or its slack holds the view.
        let last = all.last().map(String::as_str);
        if self.navigation == Navigation::None
            && after.at_tail()
            && after.names().last().copied() == last
            && after.latest
        {
            return fail("hint", format!("the hint shows at the latest rows:\n{}", context()));
        }
        if !after.at_tail() && !after.latest {
            return fail("hint-away", format!("no hint away from the bottom:\n{}", context()));
        }
        if !after.latest {
            self.navigation = Navigation::None;
        }
        Ok(())
    }
}

impl Message {
    fn markers_first(&self) -> &str {
        &self.parts[0][0]
    }
}

/// The part a delta goes to: the open one, or a new one.
fn command_part(command: &Command, step: &Message) -> usize {
    match command {
        Command::Part => step.parts.len(),
        _ => step.parts.len() - 1,
    }
}

/// The markers on screen are a gapless run of the model's, in order.
fn window(all: &[String], shown: &Shown, slack: bool, rows: i32) -> Check {
    let names = shown.names();
    let Some(first) = names.first() else {
        // Between two markers are at most a blank row, a footer, a blank row and a user message's top: `rows` rows
        // show one.
        if all.is_empty() || shown.view.viewport < rows || slack {
            return Ok(());
        }
        return fail("empty", format!("no marker shows of {}", all.len()));
    };
    let Some(start) = all.iter().position(|marker| marker == first) else {
        return fail("unknown", format!("{first} is not in the model {all:?}"));
    };
    let expected: Vec<&str> = all[start..].iter().take(names.len()).map(String::as_str).collect();
    if expected != names {
        return fail("window", format!("shown {names:?}, the model {expected:?}"));
    }
    Ok(())
}

/// A line, half a page and a page are one row, a quarter and half of the view, unless an end stops them first.
fn distance(before: &Shown, after: &Shown, name: &str) -> Check {
    let viewport = f64::from(before.view.viewport);
    let rows = match name.trim_end_matches(".up").trim_end_matches(".down") {
        "session.line" => 1.0,
        "session.half.page" => viewport / 4.0,
        _ => viewport / 2.0,
    };
    let up = name.ends_with(".up");
    let offset = f64::from(before.view.offset);
    let target = if up { offset - rows } else { offset + rows }.round();
    let room = if up { target >= 0.0 } else { target <= f64::from(before.view.extent - before.view.viewport) };
    let shift = before.markers.iter().find_map(|(marker, row)| Some(after.row(marker)? as f64 - *row as f64));
    match shift {
        Some(shift) if room && shift != offset - target => {
            fail("distance", format!("moved {shift} rows for {name} from {offset}, not {}", offset - target))
        }
        _ => Ok(()),
    }
}

/// A move shifts every row on screen alike, the way it goes.
fn rigid(before: &Shown, after: &Shown, up: bool) -> Check {
    let shifts: Vec<i64> = before
        .markers
        .iter()
        .filter_map(|(marker, row)| after.row(marker).map(|moved| moved as i64 - *row as i64))
        .collect();
    if let Some(first) = shifts.first()
        && shifts.iter().any(|shift| shift != first)
    {
        return fail("rigid", format!("the rows moved apart: {shifts:?}"));
    }
    if shifts.first().is_some_and(|shift| if up { *shift < 0 } else { *shift > 0 }) {
        return fail("direction", format!("moved {shifts:?} for up {up}"));
    }
    Ok(())
}

#[test]
fn any_walk_shows_a_window_of_the_transcript() {
    let steps = std::env::var("MODEL_STEPS").map_or(24, |steps| steps.parse().expect("MODEL_STEPS is a number"));
    model::check(&Transcripts, 4, steps);
}

/// A jump, then a resize: the resize ends the jump, so the wheel at the bottom follows again, and a view the smaller
/// terminal leaves above the bottom shows the way back.
#[test]
fn a_resize_ends_a_jump() {
    let wheel = [
        Command::User,
        Command::Do("session.message.user.next"),
        Command::Resize(160, 40),
        Command::Wheel { up: false, steps: 1 },
    ];
    assert_eq!(Transcripts.run(&wheel), None);
    let smaller = [
        Command::Open(6),
        Command::Resize(160, 40),
        Command::Do("session.messages_last_user"),
        Command::Wheel { up: true, steps: 1 },
        Command::Resize(60, 16),
    ];
    assert_eq!(Transcripts.run(&smaller), None);
}

/// Rows that fit the view: each jump still puts its message at the top.
#[test]
fn a_jump_in_rows_that_fit_lands_at_the_top() {
    let walk =
        [Command::Open(1), Command::Do("session.message.next"), Command::User, Command::Do("session.message.next")];
    assert_eq!(Transcripts.run(&walk), None);
}

/// A jump near the end, then the wheel to the bottom of its slack, or a jump in a window that starts at the first
/// row: a new message leaves the view where it is.
#[test]
fn a_new_message_keeps_a_view_a_jump_holds() {
    let wheel = [
        Command::Open(30),
        Command::Do("session.message.user.next"),
        Command::Wheel { up: false, steps: 1 },
        Command::User,
    ];
    assert_eq!(Transcripts.run(&wheel), None);
    let full = [
        Command::Open(15),
        Command::Stage(0),
        Command::Commit,
        Command::Assistant,
        Command::End,
        Command::Assistant,
        Command::Do("session.message.user.next"),
        Command::Compact,
    ];
    assert_eq!(Transcripts.run(&full), None);
}
