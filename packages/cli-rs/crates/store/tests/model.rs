//! Model-based test of the store's snapshot-and-event folds (O-91, `round2/models.md`).
//!
//! The reference is a small server. Per session it holds pending permissions and forms in arrival order, and a
//! transcript in server order (a per-session sequence, as `SessionStore` orders by `seq`). Message IDs deliberately
//! do not sort in that order (`msg_watch_*`, `msg_sch_*`, descending numbers), so no fold may rely on ID order.
//! It also holds the running shells of one location, read by the location's `Catalog::Shell` read; their exits
//! settle them as replies settle requests.
//!
//! Commands change the server (each change queues its events), start the store's reads (each answered from the
//! server state when the request arrives, then held), release or fail held responses by identity, deliver queued
//! events late, drop the stream (queued events are lost, then `server.connected`), and delete sessions. A "view"
//! syncs every read it opened again whenever the store reports `changes.all`, as the TUI does.
//!
//! Checked after every command (safety): nothing of a session whose deletion was delivered; no request whose
//! settlement was delivered; transcript rows exist on the server and are in server order; every visible change is
//! reported by `changes_since`. Checked after the drain (convergence): permissions and forms equal the server, in
//! order and content; after a confirmed head read the transcript is a gapless suffix with the server's text and
//! `more` exactly when older rows exist; an older-page load grows the window; every started read finished.
//!
//! Deterministic: one current-thread runtime, no timers, a seeded generator (SplitMix64), and a fixed-point handshake
//! instead of a fixed number of yields. The default run is `KNOWN` (must pass), `OPEN` (must still fail with its
//! class; a fix makes it pass, which fails this test until the entry moves to `KNOWN`), the checker mutants, the
//! generator coverage, and the shrinker test.
//!
//! Environment:
//! - `MODEL_SEED` (default 1), `MODEL_CASES` (default 200) and `MODEL_LEN` (default 30) set the random searches.
//! - `MODEL_NO=Burst,Model` leaves commands out; `MODEL_SKIP=order,missing` turns checks off by class. Both look
//!   behind a known defect.
//! - `MODEL_TRACE=<name>` with `-- trace --nocapture` prints the requests, replies and observations of a `KNOWN` or
//!   `OPEN` entry.
//! - `MODEL_SURVEY=1` groups the failures of a search by signature and shrinks one per group.
//! - `MODEL_REPORT=1` prints the verdict of every `KNOWN` and `OPEN` entry.
//! - `MODEL_DUMP=<path>` (and `MODEL_DUMP_OPEN=1`) write traces for `round2/models-pilot/model-differential.ts`.
//!
//! `permissions_converge_to_the_server` runs by default. The other random searches are `#[ignore]`d until the plan
//! step that fixes their open defects un-ignores them. Before a store change, run the searches at 5,000 cases:
//!
//! ```sh
//! MODEL_CASES=5000 cargo test -p opencode-store --test model -- permissions_converge
//! MODEL_CASES=5000 cargo test -p opencode-store --test model -- --ignored --nocapture
//! MODEL_CASES=5000 cargo test -p opencode-store --test model -- --ignored everything_together
//! ```
//!
//! A failure prints its seed, case and the command line that reproduces it, then the shrunk sequence. The seed,
//! `MODEL_LEN` and `MODEL_NO` fix every case, so `MODEL_CASES=<case + 1>` replays up to the failing one. Paste the
//! shrunk sequence into `OPEN` with its class to pin it; `MODEL_TRACE` then prints it by name.

mod common;

use std::collections::{HashMap, HashSet, VecDeque};
use std::fmt;
use std::sync::{Arc, Mutex};

use common::*;
use futures_util::FutureExt;
use opencode_api::generated::SessionID;
use opencode_store::{Data, LoadMore, Location, MessageExt, Options, Task};
use serde_json::{Value, json};
use tokio::sync::oneshot;

const SESSIONS: u8 = 2;
/// Messages each session has before the client starts, so pages matter.
const HISTORY: u32 = 5;
/// Page size of the first read; older pages use the store's own size (20).
const PAGE: usize = 2;
/// Asks in one [`Op::Burst`]: more than the store's 512-entry live window.
const BURST: u32 = 600;

// The generator --------------------------------------------------------------------------------------------------

/// SplitMix64: small, seedable, and good enough to pick commands.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: u64) -> u64 {
        self.next() % n
    }
}

/// A read the model can hold, by kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Read {
    Permissions,
    Forms,
    Head,
    Older,
    /// The single-message refetch after `session.model.selected`.
    One,
    /// The location's running shells (`Catalog::Shell`); held under session 0, since it has no session.
    Shell,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Op {
    /// Server: a new permission request on a session.
    Ask(u8),
    /// Server: another client answers the k-th pending request of a session.
    Answer(u8, u8),
    /// Server: 600 permission requests on a session at once.
    Burst(u8),
    /// Server: a new form on a session.
    Open(u8),
    /// Server: another client cancels the k-th pending form of a session.
    Cancel(u8, u8),
    /// Server: a new assistant step with an empty text part on a session.
    Step(u8),
    /// Server: the newest assistant's open text grows by a delta (deltas are not durable and carry no sequence).
    Text(u8),
    /// Server: the newest assistant's open text ends; `session.text.ended` carries the whole text.
    End(u8),
    /// Server: another client switches the model; the store inserts a row and refetches it.
    Model(u8),
    /// Server: the session is deleted.
    Delete(u8),
    /// The event stream delivers up to n queued events.
    Deliver(u8),
    /// The stream drops: queued events are lost; a new stream sends `server.connected`.
    Reconnect,
    /// The view opens or syncs a read.
    SyncPermissions(u8),
    SyncForms(u8),
    SyncMessages(u8),
    /// The view loads the next older page.
    LoadOlder(u8),
    /// The oldest held response of this read and session arrives.
    Release(Read, u8),
    /// The oldest held response of this read and session fails (HTTP 500).
    Fail(Read, u8),
    /// Server: a shell starts in the location.
    ShellCreate,
    /// Server: the k-th running shell exits.
    ShellExit(u8),
    /// Server: more shells start at once than a shell read's overlay holds. Not generated (1,100 events).
    ShellBurst,
    /// The view opens or syncs the location's shell list.
    SyncShells,
}

#[derive(Clone, Copy)]
struct Mix {
    permissions: bool,
    forms: bool,
    messages: bool,
    shells: bool,
}

const ALL: Mix = Mix { permissions: true, forms: true, messages: true, shells: true };
/// Where the model's shells run; every reply and event names it.
const PROJECT: &str = "/project";
/// Shells in one [`Op::ShellBurst`]: more than the store's 1,024-change overlay.
const SHELL_BURST: u32 = 1_100;

/// One weighted arm per command, so every command is generated whatever the mix (models-review carbon-2).
fn generate(rng: &mut Rng, mix: Mix, len: usize) -> Vec<Op> {
    let mut ops = Vec::with_capacity(len);
    let reads: Vec<Read> = [
        (mix.permissions, Read::Permissions),
        (mix.forms, Read::Forms),
        (mix.messages, Read::Head),
        (mix.messages, Read::Older),
        (mix.messages, Read::One),
        (mix.shells, Read::Shell),
    ]
    .into_iter()
    .filter_map(|(on, read)| on.then_some(read))
    .collect();
    // `MODEL_NO=Burst,Model` leaves arms out, to look behind a known defect.
    let no = std::env::var("MODEL_NO").unwrap_or_default();
    while ops.len() < len {
        let s = rng.below(SESSIONS as u64) as u8;
        let k = rng.below(4) as u8;
        let read = reads[rng.below(reads.len() as u64) as usize];
        let held = if read == Read::Shell { 0 } else { s };
        let arms: [(bool, u64, Op); 21] = [
            (mix.permissions, 6, Op::Ask(s)),
            (mix.permissions, 4, Op::Answer(s, k)),
            (mix.permissions, 1, Op::Burst(s)),
            (mix.forms, 6, Op::Open(s)),
            (mix.forms, 4, Op::Cancel(s, k)),
            (mix.messages, 6, Op::Step(s)),
            (mix.messages, 4, Op::Text(s)),
            (mix.messages, 3, Op::End(s)),
            (mix.messages, 2, Op::Model(s)),
            (true, 2, Op::Delete(s)),
            (true, 10, Op::Deliver(1 + k)),
            (true, 3, Op::Reconnect),
            (mix.permissions, 5, Op::SyncPermissions(s)),
            (mix.forms, 5, Op::SyncForms(s)),
            (mix.messages, 5, Op::SyncMessages(s)),
            (mix.messages, 4, Op::LoadOlder(s)),
            (true, 12, Op::Release(read, held)),
            (true, 2, Op::Fail(read, held)),
            (mix.shells, 4, Op::ShellCreate),
            (mix.shells, 3, Op::ShellExit(k)),
            (mix.shells, 3, Op::SyncShells),
        ];
        let arms = arms.map(|(on, weight, op)| (on && !no.split(',').any(|name| name == self::name(op)), weight, op));
        let total: u64 = arms.iter().filter(|arm| arm.0).map(|arm| arm.1).sum();
        let mut pick = rng.below(total);
        for (on, weight, op) in arms {
            if !on {
                continue;
            }
            if pick < weight {
                ops.push(op);
                break;
            }
            pick -= weight;
        }
    }
    ops
}

// The reference server -------------------------------------------------------------------------------------------

#[derive(Clone)]
struct Message {
    id: String,
    seq: u64,
    /// `None` for a model-switched row.
    text: Option<String>,
    /// An assistant's step ended (the server completes it when the next step starts).
    completed: bool,
    /// The text part ended: only an ended text must converge, since deltas carry no sequence.
    ended: bool,
}

#[derive(Default)]
struct Server {
    permissions: Vec<Vec<u32>>,
    forms: Vec<Vec<u32>>,
    messages: Vec<Vec<Message>>,
    deleted: Vec<bool>,
    seq: Vec<u64>,
    /// Running shells of [`PROJECT`], in start order.
    shells: Vec<u32>,
    next: u32,
    /// Events not yet delivered, oldest first.
    events: VecDeque<Value>,
    /// Responses computed when their request arrived, waiting for [`Op::Release`] or [`Op::Fail`].
    held: Vec<Held>,
    /// Reconnects so far: a response computed before one belongs to an invalidated read.
    epoch: u64,
    /// Reads whose last response was held across a reconnect; their next response is the replacement's.
    replaced: HashSet<(Read, u8)>,
    requests: usize,
    /// Requests the model has no answer for; each fails the run.
    unexpected: Vec<String>,
}

struct Held {
    read: Read,
    session: u8,
    reply: Reply,
    sender: oneshot::Sender<Reply>,
    /// The reconnects before the response was computed.
    epoch: u64,
    /// The first response after one held across a reconnect: the replacement read's.
    replacement: bool,
    /// The session was already deleted on the server when the response was computed.
    after_delete: bool,
}

/// Message IDs in four shapes whose string order is not the server order (`msg_watch_*`, `msg_sch_*`, and numbers
/// that fall), as production IDs are (models-review bigboi-1, carbon-1).
fn message_id(n: u32) -> String {
    match n % 4 {
        0 => format!("msg_{n:04}"),
        1 => format!("msg_watch_{:08x}", n.wrapping_mul(2_654_435_761)),
        2 => format!("msg_sch_{n}_check_0"),
        _ => format!("msg_0{:04}", 9999 - n),
    }
}

impl Server {
    fn new() -> Self {
        let mut server = Server {
            permissions: vec![Vec::new(); SESSIONS as usize],
            forms: vec![Vec::new(); SESSIONS as usize],
            messages: vec![Vec::new(); SESSIONS as usize],
            deleted: vec![false; SESSIONS as usize],
            seq: vec![0; SESSIONS as usize],
            ..Server::default()
        };
        for s in 0..SESSIONS as usize {
            for _ in 0..HISTORY {
                let n = server.id();
                let seq = server.durable(s);
                server.messages[s].push(Message {
                    id: message_id(n),
                    seq,
                    text: Some(format!("h{n}")),
                    completed: true,
                    ended: true,
                });
            }
        }
        server
    }

    fn id(&mut self) -> u32 {
        self.next += 1;
        self.next
    }

    fn durable(&mut self, s: usize) -> u64 {
        self.seq[s] += 1;
        self.seq[s]
    }

    /// The answer to a read, from the state at the moment it arrives; `None` for reads the model does not hold.
    fn answer(&self, req: &Req) -> Option<(Read, u8, Reply)> {
        if req.path == "/api/shell" {
            let data: Vec<Value> = self.shells.iter().map(|n| shell(*n)).collect();
            return Some((Read::Shell, 0, ok(json!({ "location": { "directory": PROJECT }, "data": data }))));
        }
        let rest = req.path.strip_prefix("/api/session/ses_")?;
        let (s, kind) = rest.split_once('/')?;
        let s: usize = s.parse().ok()?;
        let session = format!("ses_{s}");
        let read = match kind {
            "permission" => Read::Permissions,
            "form" => Read::Forms,
            "message" if req.param("cursor").is_some() => Read::Older,
            "message" => Read::Head,
            _ if kind.starts_with("message/") => Read::One,
            _ => return None,
        };
        if self.deleted[s] {
            return Some((read, s as u8, missing(&session)));
        }
        let reply = match read {
            Read::Permissions => {
                ok(json!({ "data": self.permissions[s].iter().map(|n| permission(&session, *n)).collect::<Vec<_>>() }))
            }
            Read::Forms => ok(json!({ "data": self.forms[s].iter().map(|n| form(&session, *n)).collect::<Vec<_>>() })),
            Read::One => {
                let id = &kind["message/".len()..];
                match self.messages[s].iter().find(|message| message.id == id) {
                    Some(message) => ok(json!({ "data": message_json(message) })),
                    None => Reply::Json(
                        404,
                        json!({ "_tag": "MessageNotFoundError", "messageID": id, "message": "Message not found" }),
                    ),
                }
            }
            Read::Shell => unreachable!("answered above"),
            Read::Head | Read::Older => {
                let limit: usize = req.param("limit").and_then(|v| v.parse().ok()).unwrap_or(20);
                let all = &self.messages[s];
                // `SessionStore`: the cursor names the message to read before, by exact ID; a missing anchor reads
                // nothing (packages/core/src/session/store.ts:101-134).
                let end = match req.param("cursor") {
                    None => all.len(),
                    Some(cursor) => match all.iter().position(|message| message.id == cursor) {
                        Some(at) => at,
                        None => return Some((read, s as u8, ok(json!({ "data": [], "cursor": {} })))),
                    },
                };
                let start = end.saturating_sub(limit);
                let page: Vec<Value> = all[start..end].iter().rev().map(message_json).collect();
                let cursor = if start > 0 { json!({ "next": all[start].id }) } else { json!({}) };
                ok(json!({ "data": page, "cursor": cursor }))
            }
        };
        Some((read, s as u8, reply))
    }
}

fn permission(session: &str, n: u32) -> Value {
    json!({ "id": format!("per_{n}"), "sessionID": session, "action": format!("bash {n}"), "resources": [] })
}

fn form(session: &str, n: u32) -> Value {
    json!({ "id": format!("frm_{n}"), "sessionID": session, "title": format!("Ask {n}"), "fields": [] })
}

fn shell(n: u32) -> Value {
    json!({
        "id": format!("sh_{n}"), "status": "running", "command": format!("run {n}"), "cwd": PROJECT,
        "shell": "/bin/sh", "file": "/shell-output", "metadata": {}, "time": { "started": n },
    })
}

fn shell_created(n: u32) -> Value {
    json!({ "id": format!("evt_{n}"), "created": n, "type": "shell.created", "location": { "directory": PROJECT },
        "data": { "info": shell(n) } })
}

fn message_json(message: &Message) -> Value {
    match &message.text {
        Some(text) => {
            let mut time = json!({ "created": message.seq });
            if message.completed {
                time["completed"] = json!(message.seq);
            }
            json!({
                "id": message.id, "type": "assistant", "agent": "build",
                "model": { "providerID": "p", "id": "m" }, "time": time,
                "content": [{ "type": "text", "text": text }],
            })
        }
        None => json!({
            "id": message.id, "type": "model-switched", "model": { "providerID": "p", "id": "n" },
            "time": { "created": message.seq },
        }),
    }
}

fn missing(session: &str) -> Reply {
    Reply::Json(
        404,
        json!({ "_tag": "SessionNotFoundError", "sessionID": session, "message": format!("Session not found: {session}") }),
    )
}

fn session_json(s: usize) -> Value {
    json!({
        "id": format!("ses_{s}"), "projectID": "project", "cost": 0,
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 0, "updated": 0 }, "location": { "directory": "/project" },
    })
}

/// Answers for reads the model does not hold. Unknown reads fail loudly: an oracle that answers anything hides
/// traffic it should know about (models-review bigboi-5).
fn immediate(req: &Req, deleted: &[bool], unexpected: &mut Vec<String>) -> Reply {
    match req.path.as_str() {
        "/api/session/active" => return ok(json!({ "data": {} })),
        // What a reconnect reads besides the model's reads (`connection.rs` rehydrate, `location_sync_info`).
        "/api/location" => {
            return ok(json!({
                "directory": "/project",
                "project": { "id": "project", "directory": "/project", "canonical": "/project" },
            }));
        }
        "/api/project" => return ok(json!([])),
        "/api/vcs" => {
            return ok(json!({
                "location": { "directory": "/project" }, "data": { "branch": { "current": "main", "default": "main" } },
            }));
        }
        _ => {}
    }
    if let Some(rest) = req.path.strip_prefix("/api/session/ses_")
        && let Ok(s) = rest.parse::<usize>()
    {
        return if deleted[s] { missing(&format!("ses_{s}")) } else { ok(json!({ "data": session_json(s) })) };
    }
    unexpected.push(format!("{} {}", req.method, req.path));
    Reply::Text(599, "unexpected".into())
}

// Observations ---------------------------------------------------------------------------------------------------

/// What a user can see of one session.
#[derive(Clone, Debug, Default, PartialEq)]
struct Seen {
    permissions: Option<Vec<(String, String)>>,
    forms: Option<Vec<(String, String)>>,
    /// Rows as (ID, text of the text parts joined; `None` for a row without text).
    messages: Option<Vec<(String, Option<String>)>>,
    more: bool,
}

/// A deliberately wrong reading of the store, to show the checker notices each kind of wrong client.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Mutant {
    None,
    /// The head read shows nothing.
    HeadEmpty,
    /// "More" is never set.
    NoMore,
    /// Streamed text is lost.
    BlankText,
    /// Permissions show in reverse order.
    Reversed,
    /// Older pages are ignored.
    NoOlder,
    /// A settled request stays.
    Sticky,
    /// Changes are never reported.
    Silent,
}

fn observe(state: &opencode_store::State, s: u8, mutant: Mutant, sticky: &HashMap<u8, Vec<(String, String)>>) -> Seen {
    let session = SessionID(format!("ses_{s}"));
    let mut permissions: Option<Vec<(String, String)>> = state
        .permissions(&session)
        .map(|list| list.iter().map(|request| (request.id.0.clone(), request.action.clone())).collect());
    if mutant == Mutant::Reversed {
        permissions = permissions.map(|mut list| {
            list.reverse();
            list
        });
    }
    if mutant == Mutant::Sticky
        && let Some(extra) = sticky.get(&s)
    {
        permissions.get_or_insert_default().extend(extra.iter().cloned());
    }
    let forms = state
        .forms(&format!("ses_{s}"), None)
        .map(|list| list.iter().map(|form| (form.info.id.0.clone(), form.info.title.clone())).collect());
    let messages = state.transcript(&session).map(|transcript| {
        transcript
            .items()
            .iter()
            .map(|item| {
                let value = serde_json::to_value(item).unwrap();
                let text = value["content"].as_array().map(|parts| {
                    let text: String = parts.iter().filter_map(|part| part["text"].as_str()).collect();
                    if mutant == Mutant::BlankText { String::new() } else { text }
                });
                (item.id().to_owned(), text)
            })
            .collect::<Vec<_>>()
    });
    let messages = if mutant == Mutant::HeadEmpty { messages.map(|_| Vec::new()) } else { messages };
    let more = state.has_more_messages(&session) && mutant != Mutant::NoMore;
    Seen { permissions, forms, messages, more }
}

// Running one case -----------------------------------------------------------------------------------------------

/// A failure: its class (property and session) and the message.
#[derive(Clone, Debug, PartialEq)]
struct Failure {
    class: String,
    message: String,
}

thread_local! {
    /// Off while recording observations for the differential: the trace continues past a failed check.
    static CHECKS: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

fn fail(class: impl Into<String>, message: String) -> Result<(), Failure> {
    let class = class.into();
    if !CHECKS.get() {
        return Ok(());
    }
    // `MODEL_SKIP=order,missing` turns checks off, to look behind a known defect.
    let kind = class.split(' ').next().unwrap_or_default().to_owned();
    if std::env::var("MODEL_SKIP").unwrap_or_default().split(',').any(|skip| skip == kind) {
        return Ok(());
    }
    Err(Failure { class, message })
}

struct Run {
    data: Data,
    server: Arc<Mutex<Server>>,
    mutant: Mutant,
    /// Reads the view opened; synced again on `changes.all`.
    viewed: HashSet<(Read, u8)>,
    seen_revision: u64,
    seen: Vec<Seen>,
    /// Sync tasks and older-page loads started, to check they finish.
    tasks: Vec<(String, Task<()>)>,
    loads: Vec<(u8, tokio::task::JoinHandle<Result<(), opencode_store::Error>>)>,
    /// Sessions whose `session.deleted` was delivered.
    deleted: HashSet<u8>,
    /// Requests and forms whose settlement event was delivered.
    settled: HashSet<String>,
    /// Sessions with a head read that published since the last deletion.
    confirmed: HashSet<u8>,
    /// Sessions with an older-page load started while "more" held and no head published since.
    grown: HashSet<u8>,
    sticky: HashMap<u8, Vec<(String, String)>>,
    /// Per-command counts, and per-side counts of the responses released, for coverage.
    counts: HashMap<&'static str, usize>,
    /// The running shells of [`PROJECT`] the store shows, by ID; `None` until anything put them there.
    shells: Option<Vec<String>>,
    /// Shells whose `shell.exited` was delivered.
    exited: HashSet<String>,
}

fn project() -> Location {
    Location::new(PROJECT)
}

fn observe_shells(state: &opencode_store::State) -> Option<Vec<String>> {
    let shells = state.location(Some(&project()))?.shell.as_ref()?;
    Some(shells.keys().map(|id| id.0.clone()).collect())
}

impl Run {
    fn new(mutant: Mutant) -> Self {
        let server = Arc::new(Mutex::new(Server::new()));
        let shared = server.clone();
        let data = data(
            handler(move |req: Req| {
                let mut server = shared.lock().unwrap();
                server.requests += 1;
                if std::env::var("MODEL_TRACE").is_ok() {
                    eprintln!("  request {} {:?}", req.path, req.query);
                }
                let receiver = server.answer(&req).map(|(read, session, reply)| {
                    let (sender, receiver) = oneshot::channel();
                    let (epoch, after_delete) = (server.epoch, server.deleted[session as usize]);
                    let replacement = server.replaced.remove(&(read, session));
                    server.held.push(Held { read, session, reply, sender, epoch, replacement, after_delete });
                    receiver
                });
                let immediate = receiver.is_none().then(|| {
                    let server = &mut *server;
                    immediate(&req, &server.deleted, &mut server.unexpected)
                });
                async move {
                    match receiver {
                        Some(receiver) => receiver.await.unwrap_or(Reply::Fail("dropped".into())),
                        None => immediate.unwrap(),
                    }
                }
            }),
            Options { initial_message_limit: Some(PAGE as i64), ..Options::default() },
        );
        data.apply(&[event(json!({ "id": "evt_connected", "type": "server.connected", "data": {} }))]);
        let seen_revision = data.revision();
        Run {
            data,
            server,
            mutant,
            viewed: HashSet::new(),
            seen_revision,
            seen: vec![Seen::default(); SESSIONS as usize],
            tasks: Vec::new(),
            loads: Vec::new(),
            deleted: HashSet::new(),
            settled: HashSet::new(),
            confirmed: HashSet::new(),
            grown: HashSet::new(),
            sticky: HashMap::new(),
            counts: HashMap::new(),
            shells: None,
            exited: HashSet::new(),
        }
    }

    fn id(s: u8) -> SessionID {
        SessionID(format!("ses_{s}"))
    }

    fn sync(&mut self, read: Read, s: u8) {
        // A view closes once its session is gone: deleted by an event, or found missing by a read.
        let gone = || self.deleted.contains(&s) || self.data.read(|state| state.is_missing(&Self::id(s)));
        if read != Read::Shell && gone() {
            return;
        }
        self.viewed.insert((read, s));
        let task = match read {
            Read::Permissions => self.data.permission_sync(&Self::id(s)),
            Read::Forms => self.data.form_sync(&format!("ses_{s}"), None),
            Read::Head => self.data.message_sync(&Self::id(s)),
            Read::Shell => self.data.shell_sync(Some(&project())),
            Read::Older | Read::One => return,
        };
        self.tasks.push((format!("{read:?} ses_{s}"), task));
    }

    async fn step(&mut self, op: Op) -> Result<(), Failure> {
        *self.counts.entry(name(op)).or_default() += 1;
        match op {
            Op::Ask(s) => self.change(s, |server, n| {
                server.permissions[s as usize].push(n);
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "permission.asked",
                    "data": permission(&format!("ses_{s}"), n) })]
            }),
            Op::Burst(s) => self.change(s, |server, _| {
                (0..BURST)
                    .map(|_| {
                        let n = server.id();
                        server.permissions[s as usize].push(n);
                        json!({ "id": format!("evt_{n}"), "created": n, "type": "permission.asked",
                            "data": permission(&format!("ses_{s}"), n) })
                    })
                    .collect()
            }),
            Op::Answer(s, k) => self.change(s, |server, n| {
                let list = &mut server.permissions[s as usize];
                if list.is_empty() {
                    return Vec::new();
                }
                let request = list.remove(k as usize % list.len());
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "permission.replied",
                    "data": { "sessionID": format!("ses_{s}"), "requestID": format!("per_{request}"), "reply": "once" } })]
            }),
            Op::Open(s) => self.change(s, |server, n| {
                server.forms[s as usize].push(n);
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "form.created",
                    "location": { "directory": "/project" }, "data": { "form": form(&format!("ses_{s}"), n) } })]
            }),
            Op::Cancel(s, k) => self.change(s, |server, n| {
                let list = &mut server.forms[s as usize];
                if list.is_empty() {
                    return Vec::new();
                }
                let id = list.remove(k as usize % list.len());
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "form.cancelled",
                    "location": { "directory": "/project" },
                    "data": { "id": format!("frm_{id}"), "sessionID": format!("ses_{s}") } })]
            }),
            Op::Step(s) => self.change(s, |server, n| {
                let seq = server.durable(s as usize);
                let id = message_id(n);
                for message in &mut server.messages[s as usize] {
                    message.completed = true;
                }
                server.messages[s as usize].push(Message { id: id.clone(), seq, text: Some(String::new()), completed: false, ended: false });
                let text = server.durable(s as usize);
                let session = format!("ses_{s}");
                vec![
                    json!({ "id": format!("evt_{n}"), "created": seq, "type": "session.step.started",
                        "durable": { "aggregateID": session, "seq": seq, "version": 1 },
                        "data": { "sessionID": session, "assistantMessageID": id, "agent": "build",
                            "model": { "providerID": "p", "id": "m" }, "started": seq } }),
                    json!({ "id": format!("evt_{n}t"), "created": text, "type": "session.text.started",
                        "durable": { "aggregateID": session, "seq": text, "version": 1 },
                        "data": { "sessionID": session, "assistantMessageID": id, "ordinal": 0 } }),
                ]
            }),
            Op::Text(s) => self.change(s, |server, n| {
                let Some(message) = server.messages[s as usize].iter_mut().rev().find(|m| m.text.is_some() && !m.ended)
                else {
                    return Vec::new();
                };
                let delta = format!("t{n}");
                message.text.as_mut().unwrap().push_str(&delta);
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "session.text.delta",
                    "data": { "sessionID": format!("ses_{s}"), "assistantMessageID": message.id, "ordinal": 0, "delta": delta } })]
            }),
            Op::End(s) => self.change(s, |server, _| {
                let seq = server.durable(s as usize);
                let Some(message) = server.messages[s as usize].iter_mut().rev().find(|m| m.text.is_some() && !m.ended)
                else {
                    return Vec::new();
                };
                message.ended = true;
                let session = format!("ses_{s}");
                vec![json!({ "id": format!("evt_e{seq}_{s}"), "created": seq, "type": "session.text.ended",
                    "durable": { "aggregateID": session, "seq": seq, "version": 1 },
                    "data": { "sessionID": session, "assistantMessageID": message.id, "ordinal": 0, "text": message.text } })]
            }),
            Op::Model(s) => self.change(s, |server, n| {
                let seq = server.durable(s as usize);
                server.messages[s as usize].push(Message { id: format!("msg_m{n}"), seq, text: None, completed: true, ended: true });
                let session = format!("ses_{s}");
                vec![json!({ "id": format!("evt_m{n}"), "created": seq, "type": "session.model.selected",
                    "durable": { "aggregateID": session, "seq": seq, "version": 1 },
                    "data": { "sessionID": session, "model": { "providerID": "p", "id": "n" } } })]
            }),
            Op::Delete(s) => self.change(s, |server, n| {
                server.deleted[s as usize] = true;
                server.permissions[s as usize].clear();
                server.forms[s as usize].clear();
                server.messages[s as usize].clear();
                let seq = server.durable(s as usize);
                vec![json!({ "id": format!("evt_{n}"), "created": n, "type": "session.deleted",
                    "durable": { "aggregateID": format!("ses_{s}"), "seq": seq, "version": 1 },
                    "data": { "sessionID": format!("ses_{s}") } })]
            }),
            Op::Deliver(n) => {
                for _ in 0..n {
                    let Some(next) = self.server.lock().unwrap().events.pop_front() else { break };
                    self.delivered(&next);
                    self.data.apply(&[event(next)]);
                    self.settle().await?;
                }
            }
            Op::Reconnect => {
                let mut server = self.server.lock().unwrap();
                server.events.clear();
                server.epoch += 1;
                drop(server);
                self.data.apply(&[event(json!({ "id": "evt_connected", "type": "server.connected", "data": {} }))]);
            }
            Op::ShellCreate | Op::ShellBurst => {
                let mut server = self.server.lock().unwrap();
                let count = if op == Op::ShellBurst { SHELL_BURST } else { 1 };
                for _ in 0..count {
                    let n = server.id();
                    server.shells.push(n);
                    server.events.push_back(shell_created(n));
                }
            }
            Op::ShellExit(k) => {
                let mut server = self.server.lock().unwrap();
                if !server.shells.is_empty() {
                    let at = k as usize % server.shells.len();
                    let shell = server.shells.remove(at);
                    let n = server.id();
                    server.events.push_back(json!({ "id": format!("evt_{n}"), "created": n, "type": "shell.exited",
                        "location": { "directory": PROJECT },
                        "data": { "id": format!("sh_{shell}"), "exit": 0, "status": "completed" } }));
                }
            }
            Op::SyncShells => self.sync(Read::Shell, 0),
            Op::SyncPermissions(s) => self.sync(Read::Permissions, s),
            Op::SyncForms(s) => self.sync(Read::Forms, s),
            Op::SyncMessages(s) => self.sync(Read::Head, s),
            Op::LoadOlder(s) => {
                if self.seen[s as usize].more {
                    self.grown.insert(s);
                }
                if self.mutant != Mutant::NoOlder {
                    let (data, session) = (self.data.clone(), Self::id(s));
                    let load = tokio::spawn(async move { data.message_load_more(&session, LoadMore::default()).await });
                    self.loads.push((s, load));
                }
            }
            Op::Release(read, s) | Op::Fail(read, s) => {
                let (held, deleted) = {
                    let mut server = self.server.lock().unwrap();
                    let at = server.held.iter().position(|held| held.read == read && held.session == s);
                    let held = at.map(|at| server.held.remove(at));
                    if held.as_ref().is_some_and(|held| held.epoch < server.epoch) {
                        server.replaced.insert((read, s));
                    }
                    (held, server.deleted[s as usize])
                };
                if let Some(held) = held {
                    let epoch = self.server.lock().unwrap().epoch;
                    let replaced = match (held.epoch < epoch, held.replacement) {
                        (true, _) => "response: across a reconnect (replaced)",
                        (false, true) => "response: of the replacement",
                        (false, false) => "response: same connection",
                    };
                    let delete = match (held.after_delete, deleted, self.deleted.contains(&s)) {
                        (true, ..) => "response: after a delete",
                        (false, false, _) => "response: no delete",
                        (false, true, false) => "response: across a delete, before its event",
                        (false, true, true) => "response: across a delete, after its event",
                    };
                    *self.counts.entry(replaced).or_default() += 1;
                    // A shell read belongs to no session.
                    if read != Read::Shell {
                        *self.counts.entry(delete).or_default() += 1;
                    }
                    if std::env::var("MODEL_TRACE").is_ok() {
                        eprintln!("  reply {:?}", held.reply);
                    }
                    let ok = matches!(held.reply, Reply::Json(200, _)) && matches!(op, Op::Release(..));
                    let reply = if ok { held.reply } else if matches!(op, Op::Fail(..)) { Reply::Text(500, "boom".into()) } else { held.reply };
                    if ok && read == Read::Head {
                        self.confirmed.insert(s);
                        self.grown.remove(&s);
                    }
                    let _ = held.sender.send(reply);
                }
            }
        }
        self.settle().await
    }

    /// Records what a delivered event settles, before the store applies it.
    fn delivered(&mut self, event: &Value) {
        let data = &event["data"];
        match event["type"].as_str().unwrap_or_default() {
            "permission.replied" => {
                self.settled.insert(data["requestID"].as_str().unwrap().to_owned());
            }
            "form.cancelled" => {
                self.settled.insert(data["id"].as_str().unwrap().to_owned());
            }
            "shell.exited" => {
                self.exited.insert(data["id"].as_str().unwrap().to_owned());
            }
            "session.deleted" => {
                let s: u8 = data["sessionID"].as_str().unwrap()["ses_".len()..].parse().unwrap();
                self.deleted.insert(s);
                self.confirmed.remove(&s);
                self.grown.remove(&s);
            }
            _ => {}
        }
        if self.mutant == Mutant::Sticky && event["type"] == "permission.replied" {
            let s: u8 = data["sessionID"].as_str().unwrap()["ses_".len()..].parse().unwrap();
            let id = data["requestID"].as_str().unwrap().to_owned();
            let n: u32 = id["per_".len()..].parse().unwrap();
            self.sticky.entry(s).or_default().push((id, format!("bash {n}")));
        }
    }

    fn change(&mut self, s: u8, f: impl FnOnce(&mut Server, u32) -> Vec<Value>) {
        let mut server = self.server.lock().unwrap();
        if server.deleted[s as usize] {
            return;
        }
        let n = server.id();
        let events = f(&mut server, n);
        server.events.extend(events);
    }

    /// Runs tasks to a fixed point: no new request, no response taken, no flush, and no task finishing, for eight
    /// yields in a row. The view then syncs again on `changes.all`, and the safety properties are checked.
    async fn settle(&mut self) -> Result<(), Failure> {
        let mut quiet = 0;
        let mut last = None;
        for _ in 0..10_000 {
            tokio::task::yield_now().await;
            let now = {
                let server = self.server.lock().unwrap();
                (server.requests, server.held.len(), self.data.revision(), self.finished())
            };
            if Some(now) == last {
                quiet += 1;
                if quiet < 8 {
                    continue;
                }
                // A resync on `changes.all` starts reads; settle again so they reach the server in this command.
                if !self.observed()? {
                    return Ok(());
                }
                quiet = 0;
                last = None;
                continue;
            }
            quiet = 0;
            last = Some(now);
        }
        fail("liveness", "the store did not reach a fixed point in 10,000 yields".into())
    }

    fn finished(&self) -> usize {
        self.tasks.iter().filter(|(_, task)| task.clone().now_or_never().is_some()).count()
            + self.loads.iter().filter(|(_, load)| load.is_finished()).count()
    }

    /// The safety properties, the change reports, and the view's resync on `changes.all`; true when it resynced.
    fn observed(&mut self) -> Result<bool, Failure> {
        let (revision, changes) = self.data.changes_since(self.seen_revision);
        let changes = if self.mutant == Mutant::Silent { Default::default() } else { changes };
        let server = self.server.lock().unwrap();
        if let Some(request) = server.unexpected.first() {
            fail("unexpected", format!("the model has no answer for {request}"))?;
        }
        let now: Vec<Seen> =
            (0..SESSIONS).map(|s| self.data.read(|state| observe(state, s, self.mutant, &self.sticky))).collect();
        for s in 0..SESSIONS {
            let (before, after) = (&self.seen[s as usize], &now[s as usize]);
            let session = Self::id(s);
            if before.permissions != after.permissions && !changes.permissions(&session) {
                fail(format!("changes ses_{s}"), format!("permissions of ses_{s} changed unreported: {after:?}"))?;
            }
            if before.forms != after.forms && !changes.forms(&format!("ses_{s}")) {
                fail(format!("changes ses_{s}"), format!("forms of ses_{s} changed unreported"))?;
            }
            let shape = |seen: &Seen| {
                seen.messages.as_ref().map(|rows| rows.iter().map(|row| row.0.clone()).collect::<Vec<_>>())
            };
            if std::env::var("MODEL_TRACE").is_ok() && changes != Default::default() {
                eprintln!("  changes {}..{revision}: {changes:?}", self.seen_revision);
            }
            if (shape(before) != shape(after) || before.more != after.more) && !changes.messages(&session) {
                fail(format!("changes ses_{s}"), format!("transcript of ses_{s} changed shape unreported"))?;
            }
            for row in after.messages.iter().flatten() {
                let old = before.messages.iter().flatten().find(|old| old.0 == row.0);
                if old.is_some_and(|old| old != row) && !changes.message(&session, &row.0) {
                    fail(format!("changes ses_{s}"), format!("message {} of ses_{s} changed unreported", row.0))?;
                }
            }
            if self.deleted.contains(&s)
                && (after.permissions.is_some() || after.forms.is_some() || after.messages.is_some() || after.more)
            {
                fail(format!("deleted ses_{s}"), format!("ses_{s} is deleted, the store keeps {after:?}"))?;
            }
            let missing = self.data.read(|state| state.is_missing(&session));
            if missing && (after.permissions.is_some() || after.forms.is_some() || after.messages.is_some()) {
                fail(format!("missing ses_{s}"), format!("the store found ses_{s} missing and keeps {after:?}"))?;
            }
            let settled = |id: &String| self.settled.contains(id);
            if let Some((id, _)) =
                after.permissions.iter().flatten().chain(after.forms.iter().flatten()).find(|(id, _)| settled(id))
            {
                fail(format!("settled ses_{s}"), format!("{id} of ses_{s} shows after its settlement arrived"))?;
            }
            let positions: HashMap<&str, u64> =
                server.messages[s as usize].iter().map(|m| (m.id.as_str(), m.seq)).collect();
            let mut previous = 0;
            for (id, _) in after.messages.iter().flatten() {
                let Some(seq) = positions.get(id.as_str()) else {
                    if server.deleted[s as usize] {
                        continue;
                    }
                    fail(format!("order ses_{s}"), format!("{id} of ses_{s} is not on the server"))?;
                    continue;
                };
                if *seq < previous {
                    let rows: Vec<&String> = after.messages.iter().flatten().map(|row| &row.0).collect();
                    fail(format!("order ses_{s}"), format!("transcript of ses_{s} is out of server order: {rows:?}"))?;
                }
                previous = *seq;
            }
        }
        drop(server);
        let shells = self.data.read(observe_shells);
        if shells != self.shells && !changes.location(&project()) {
            fail("changes shells", format!("shells changed unreported: {shells:?}"))?;
        }
        if let Some(id) = shells.iter().flatten().find(|id| self.exited.contains(*id)) {
            fail("settled shells", format!("{id} shows after its shell.exited arrived"))?;
        }
        self.shells = shells;
        self.seen_revision = revision;
        if std::env::var("MODEL_TRACE").is_ok() {
            eprintln!("  seen {:?}", now.iter().map(|seen| (&seen.messages, seen.more)).collect::<Vec<_>>());
        }
        self.seen = now;
        if !changes.all {
            return Ok(false);
        }
        let viewed: Vec<(Read, u8)> = self.viewed.iter().copied().collect();
        for (read, s) in viewed {
            self.sync(read, s);
        }
        Ok(true)
    }

    /// Delivers every event, releases every response, and syncs every viewed read again (a view syncs on its own
    /// later; a failed read is not cached), until nothing is left.
    async fn drain(&mut self) -> Result<(), Failure> {
        for _ in 0..64 {
            let (events, held) = {
                let server = self.server.lock().unwrap();
                (server.events.len(), server.held.first().map(|held| (held.read, held.session)))
            };
            if events > 0 {
                self.step(Op::Deliver(u8::MAX)).await?;
                continue;
            }
            if let Some((read, s)) = held {
                self.step(Op::Release(read, s)).await?;
                continue;
            }
            let viewed: Vec<(Read, u8)> = self.viewed.iter().copied().collect();
            let before = self.server.lock().unwrap().requests;
            for (read, s) in viewed {
                self.sync(read, s);
            }
            self.settle().await?;
            if self.server.lock().unwrap().requests == before {
                return Ok(());
            }
        }
        fail("liveness", "the drain did not end".into())
    }

    /// Convergence after the drain.
    fn converged(&self) -> Result<(), Failure> {
        for (name, task) in &self.tasks {
            if task.clone().now_or_never().is_none() {
                fail("liveness", format!("the {name} read never finished"))?;
            }
        }
        for (s, load) in &self.loads {
            if !load.is_finished() {
                fail("liveness", format!("an older-page load of ses_{s} never finished"))?;
            }
        }
        let server = self.server.lock().unwrap();
        let want: Vec<String> = server.shells.iter().map(|n| format!("sh_{n}")).collect();
        let shown = self.shells.clone().unwrap_or_default();
        if self.viewed.contains(&(Read::Shell, 0)) && shown != want {
            let short = |list: &[String]| ids(&list.iter().map(|id| (id.clone(), String::new())).collect::<Vec<_>>());
            fail("shells", format!("shells: store {}, server {}", short(&shown), short(&want)))?;
        }
        for s in 0..SESSIONS {
            let seen = &self.seen[s as usize];
            // A deleted session converges to nothing; the safety checks hold the store to that once it knows.
            if self.deleted.contains(&s) || server.deleted[s as usize] {
                continue;
            }
            let session = format!("ses_{s}");
            let want: Vec<(String, String)> =
                server.permissions[s as usize].iter().map(|n| (format!("per_{n}"), format!("bash {n}"))).collect();
            // Only a read the view opened must converge: events lost in a reconnect are unknowable otherwise.
            let viewed = |read| self.viewed.contains(&(read, s));
            let shown = seen.permissions.clone().unwrap_or_default();
            if viewed(Read::Permissions) && shown != want {
                fail(
                    format!("permissions {session}"),
                    format!("permissions of {session}: store {:?}, server {:?}", ids(&shown), ids(&want)),
                )?;
            }
            let want: Vec<(String, String)> =
                server.forms[s as usize].iter().map(|n| (format!("frm_{n}"), format!("Ask {n}"))).collect();
            let shown = seen.forms.clone().unwrap_or_default();
            if viewed(Read::Forms) && shown != want {
                fail(
                    format!("forms {session}"),
                    format!("forms of {session}: store {:?}, server {:?}", ids(&shown), ids(&want)),
                )?;
            }
            if !self.confirmed.contains(&s) {
                continue;
            }
            // A text still streaming is compared by ID only: deltas carry no sequence, so a delta the snapshot
            // already holds may apply again until `session.text.ended` replaces the text.
            let open: HashSet<&str> =
                server.messages[s as usize].iter().filter(|m| !m.ended).map(|m| m.id.as_str()).collect();
            let blank = |rows: Vec<(String, Option<String>)>| -> Vec<(String, Option<String>)> {
                rows.into_iter()
                    .map(|(id, text)| if open.contains(id.as_str()) { (id, None) } else { (id, text) })
                    .collect()
            };
            let all = blank(server.messages[s as usize].iter().map(|m| (m.id.clone(), m.text.clone())).collect());
            let shown = blank(seen.messages.clone().unwrap_or_default());
            let ok = !shown.is_empty()
                && all.ends_with(&shown)
                && seen.more == (shown.len() < all.len())
                && (!self.grown.contains(&s) || shown.len() > PAGE || all.len() <= PAGE);
            if !ok {
                fail(
                    format!("transcript {session}"),
                    format!("transcript of {session}: store {shown:?} (more: {}), server {all:?}", seen.more),
                )?;
            }
        }
        Ok(())
    }
}

/// IDs of a list, shortened past eight: `[a, b, c, … (600) …, x, y, z]`.
fn ids(list: &[(String, String)]) -> String {
    let all: Vec<&str> = list.iter().map(|(id, _)| id.as_str()).collect();
    if all.len() <= 8 {
        return format!("{all:?}");
    }
    format!("{:?} … ({}) … {:?}", &all[..3], all.len(), &all[all.len() - 3..])
}

fn name(op: Op) -> &'static str {
    match op {
        Op::Ask(_) => "Ask",
        Op::Answer(..) => "Answer",
        Op::Burst(_) => "Burst",
        Op::Open(_) => "Open",
        Op::Cancel(..) => "Cancel",
        Op::Step(_) => "Step",
        Op::Text(_) => "Text",
        Op::End(_) => "End",
        Op::Model(_) => "Model",
        Op::Delete(_) => "Delete",
        Op::Deliver(_) => "Deliver",
        Op::Reconnect => "Reconnect",
        Op::SyncPermissions(_) => "SyncPermissions",
        Op::SyncForms(_) => "SyncForms",
        Op::SyncMessages(_) => "SyncMessages",
        Op::LoadOlder(_) => "LoadOlder",
        Op::Release(..) => "Release",
        Op::Fail(..) => "Fail",
        Op::ShellCreate => "ShellCreate",
        Op::ShellExit(_) => "ShellExit",
        Op::ShellBurst => "ShellBurst",
        Op::SyncShells => "SyncShells",
    }
}

/// Runs `ops` against a fresh store; the first failure, if any, and the command counts.
fn run_counted(ops: &[Op], mutant: Mutant) -> (Option<Failure>, HashMap<&'static str, usize>) {
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    runtime.block_on(async {
        let mut run = Run::new(mutant);
        let mut result = Ok(());
        for op in ops {
            if std::env::var("MODEL_TRACE").is_ok() {
                eprintln!("{op:?}");
            }
            result = run.step(*op).await;
            if result.is_err() {
                break;
            }
        }
        if result.is_ok() {
            result = run.drain().await;
        }
        if result.is_ok() {
            result = run.converged();
        }
        (result.err(), run.counts)
    })
}

fn run(ops: &[Op], mutant: Mutant) -> Option<Failure> {
    run_counted(ops, mutant).0
}

/// Deletes chunks, then single commands, while the run fails with the same class (models-review bigboi-5: a shrink
/// may not trade a transcript failure for a shorter permission failure). The result is minimal for deleting one
/// command, not globally shortest.
fn shrink(mut ops: Vec<Op>, failing: &dyn Fn(&[Op]) -> Option<Failure>) -> (Vec<Op>, Failure) {
    let mut failure = failing(&ops).expect("shrink starts from a failure");
    let class = failure.class.clone();
    let mut chunk = ops.len().div_ceil(2);
    while chunk > 0 {
        let mut start = 0;
        let mut progressed = false;
        while start < ops.len() {
            let mut candidate = ops.clone();
            candidate.drain(start..(start + chunk).min(ops.len()));
            match failing(&candidate).filter(|found| found.class == class) {
                Some(found) => {
                    ops = candidate;
                    failure = found;
                    progressed = true;
                }
                None => start += chunk,
            }
        }
        if !progressed {
            chunk /= 2;
        }
    }
    (ops, failure)
}

struct Found {
    seed: u64,
    case: usize,
    len: usize,
    ops: Vec<Op>,
    failure: Failure,
}

impl fmt::Display for Found {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "seed {} case {}: [{}] {}", self.seed, self.case, self.failure.class, self.failure.message)?;
        writeln!(
            f,
            "reproduce: MODEL_SEED={} MODEL_LEN={} MODEL_CASES={} cargo test -p opencode-store --test model -- --ignored",
            self.seed,
            self.len,
            self.case + 1
        )?;
        write!(f, "shrunk to {} commands: {:?}", self.ops.len(), self.ops)
    }
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// Runs `MODEL_CASES` random cases from `MODEL_SEED`; the first failure `failing` reports, shrunk.
fn search(mix: Mix, failing: &dyn Fn(&[Op]) -> Option<Failure>) -> Option<Found> {
    let seed = env("MODEL_SEED", 1);
    let cases = env("MODEL_CASES", 200) as usize;
    let len = env("MODEL_LEN", 30) as usize;
    let mut rng = Rng(seed);
    for case in 0..cases {
        let ops = generate(&mut rng, mix, len);
        if failing(&ops).is_some() {
            let (ops, failure) = shrink(ops, failing);
            assert_eq!(failing(&ops).as_ref(), Some(&failure), "a replay of the shrunk case fails the same way");
            return Some(Found { seed, case, len, ops, failure });
        }
    }
    None
}

/// The failure with IDs and numbers taken out, so failures of one defect group together.
fn signature(failure: &Failure) -> String {
    let words: Vec<String> = failure
        .message
        .split_whitespace()
        .map(|word| if word.chars().any(|c| c.is_ascii_digit()) { "#".into() } else { word.to_owned() })
        .take(8)
        .collect();
    format!("[{}] {}", failure.class.split(' ').next().unwrap_or_default(), words.join(" "))
}

/// Groups the failures of `MODEL_CASES` cases by signature and shrinks one per group (`MODEL_SURVEY=1`).
#[test]
fn survey() {
    if std::env::var("MODEL_SURVEY").is_err() {
        return;
    }
    let mut rng = Rng(env("MODEL_SEED", 1));
    let cases = env("MODEL_CASES", 200) as usize;
    let len = env("MODEL_LEN", 30) as usize;
    let mut groups: Vec<(String, usize, usize, Vec<Op>)> = Vec::new();
    for case in 0..cases {
        let ops = generate(&mut rng, ALL, len);
        let Some(failure) = run(&ops, Mutant::None) else { continue };
        let key = signature(&failure);
        match groups.iter_mut().find(|group| group.0 == key) {
            Some(group) => group.1 += 1,
            None => groups.push((key, 1, case, ops)),
        }
    }
    for (key, count, case, ops) in groups {
        let class = run(&ops, Mutant::None).unwrap().class;
        let (ops, failure) = shrink(ops, &|ops| run(ops, Mutant::None).filter(|found| signature(found) == key));
        eprintln!(
            "{key}\n  {count} cases, first case {case}; shrunk ({class}) to {} commands: {ops:?}\n  {}",
            ops.len(),
            failure.message
        );
    }
}

fn assert_converges(mix: Mix) {
    if let Some(found) = search(mix, &|ops| run(ops, Mutant::None)) {
        panic!("{found}");
    }
}

#[test]
fn permissions_converge_to_the_server() {
    assert_converges(Mix { permissions: true, forms: false, messages: false, shells: false });
}

#[test]
#[ignore = "red until plan step 3 (O9); run with --ignored"]
fn forms_converge_to_the_server() {
    assert_converges(Mix { permissions: false, forms: true, messages: false, shells: false });
}

#[test]
#[ignore = "red until plan step 4 to 6 (O1 to O6); run with --ignored"]
fn transcripts_are_a_gapless_suffix_of_the_server() {
    assert_converges(Mix { permissions: false, forms: false, messages: true, shells: false });
}

#[test]
fn shells_converge_to_the_server() {
    assert_converges(Mix { permissions: false, forms: false, messages: false, shells: true });
}

/// An overflowed shell overlay reads again by itself. The search cannot show it, as its view syncs every read again
/// in the drain; the TUI reads shells only with the whole location.
#[test]
fn an_overflowed_shell_read_reads_again() {
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    runtime.block_on(async {
        let mut run = Run::new(Mutant::None);
        run.step(Op::SyncShells).await.unwrap();
        run.step(Op::ShellBurst).await.unwrap();
        while !run.server.lock().unwrap().events.is_empty() {
            run.step(Op::Deliver(u8::MAX)).await.unwrap();
        }
        run.step(Op::Release(Read::Shell, 0)).await.unwrap();
        assert!(run.server.lock().unwrap().held.iter().any(|held| held.read == Read::Shell), "no second read");
        run.step(Op::Release(Read::Shell, 0)).await.unwrap();
        assert_eq!(run.shells.map(|shells| shells.len()), Some(SHELL_BURST as usize));
    });
}

#[test]
#[ignore = "red until plan step 6 (every OPEN defect); run with --ignored"]
fn everything_together() {
    assert_converges(ALL);
}

/// Every command is generated in a combined run, and reconnects and deletions land on both sides of held reads.
#[test]
fn the_generator_covers_every_command() {
    let mut rng = Rng(env("MODEL_SEED", 1));
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    for _ in 0..200 {
        for op in generate(&mut rng, ALL, 30) {
            *counts.entry(name(op)).or_default() += 1;
        }
    }
    let mut names: Vec<_> = counts.iter().collect();
    names.sort();
    eprintln!("commands in 200 cases of 30: {names:?}");
    for op in [
        "Reconnect",
        "Delete",
        "Fail",
        "Burst",
        "Model",
        "Text",
        "End",
        "LoadOlder",
        "ShellCreate",
        "ShellExit",
        "SyncShells",
    ] {
        assert!(counts.get(op).copied().unwrap_or(0) >= 20, "{op} is generated too rarely: {counts:?}");
    }
}

/// Responses land on each side of a deletion (computed before it and released before or after its event, or
/// computed after it) and of a replacement (computed before a reconnect and released after it, so the read was
/// invalidated, and the response of the read that replaces it) (models-review bigboi-5). `Syncs` starts a replacement
/// only once the invalidated read settles, so two responses of one read are never outstanding together. The checks
/// are off, so a run continues past an open defect.
#[test]
fn responses_land_on_each_side_of_deletes_and_replacements() {
    let mut rng = Rng(env("MODEL_SEED", 1));
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    CHECKS.set(false);
    for _ in 0..RESPONSE_CASES {
        // A burst's 600 events cost most of a run's time and hold no response.
        let ops: Vec<Op> = generate(&mut rng, ALL, 30).into_iter().filter(|op| !matches!(op, Op::Burst(_))).collect();
        for (name, count) in run_counted(&ops, Mutant::None).1 {
            *counts.entry(name).or_default() += count;
        }
    }
    CHECKS.set(true);
    let mut sides: Vec<_> = counts.iter().filter(|(name, _)| name.starts_with("response:")).collect();
    sides.sort();
    eprintln!("responses in {RESPONSE_CASES} cases of 30: {sides:?}");
    for side in [
        "response: same connection",
        "response: across a reconnect (replaced)",
        "response: of the replacement",
        "response: no delete",
        "response: across a delete, before its event",
        "response: across a delete, after its event",
        "response: after a delete",
    ] {
        assert!(counts.contains_key(side), "{side} is never generated: {sides:?}");
    }
}

const RESPONSE_CASES: usize = 50;

/// The checker notices each kind of wrong client: for every mutant, the search finds a sequence that fails with the
/// mutant and passes without it.
#[test]
fn the_checker_catches_wrong_clients() {
    let mutants = [
        (Mutant::HeadEmpty, Mix { permissions: false, forms: false, messages: true, shells: false }),
        (Mutant::NoMore, Mix { permissions: false, forms: false, messages: true, shells: false }),
        (Mutant::BlankText, Mix { permissions: false, forms: false, messages: true, shells: false }),
        (Mutant::NoOlder, Mix { permissions: false, forms: false, messages: true, shells: false }),
        (Mutant::Reversed, Mix { permissions: true, forms: false, messages: false, shells: false }),
        (Mutant::Sticky, Mix { permissions: true, forms: false, messages: false, shells: false }),
        (Mutant::Silent, ALL),
    ];
    let mut missed = Vec::new();
    for (mutant, mix) in mutants {
        let found = search(mix, &|ops| run(ops, mutant).filter(|_| run(ops, Mutant::None).is_none()));
        match found {
            Some(found) => eprintln!("{mutant:?}: {} commands, [{}]", found.ops.len(), found.failure.class),
            None => missed.push(mutant),
        }
    }
    assert!(missed.is_empty(), "the checker misses {missed:?}");
}

/// The shrinker keeps the class of the failure it started from: a sequence that first fails on transcript order and
/// also on permissions must not shrink to the shorter permission failure (models-review bigboi-5).
#[test]
fn the_shrinker_keeps_the_failure_class() {
    let ops = [Op::Step(0), Op::Model(0), Op::Step(0), Op::SyncMessages(0), Op::SyncPermissions(1), Op::Burst(1)];
    let first = run(&ops, Mutant::None).expect("fails");
    assert_eq!(first.class, "order ses_0");
    // The first pilot's shrinker accepted any failure.
    let (any, found) = shrink_any(ops.to_vec());
    eprintln!("any failure: {} commands, [{}] {any:?}", any.len(), found.class);
    let (kept, found) = shrink(ops.to_vec(), &|ops| run(ops, Mutant::None));
    eprintln!("same class: {} commands, [{}] {kept:?}", kept.len(), found.class);
    assert_eq!(found.class, "order ses_0");
}

/// The first pilot's shrinker, which accepted any failure; kept only to show the difference.
fn shrink_any(mut ops: Vec<Op>) -> (Vec<Op>, Failure) {
    let mut failure = run(&ops, Mutant::None).expect("fails");
    let mut chunk = ops.len().div_ceil(2);
    while chunk > 0 {
        let mut start = 0;
        let mut progressed = false;
        while start < ops.len() {
            let mut candidate = ops.clone();
            candidate.drain(start..(start + chunk).min(ops.len()));
            match run(&candidate, Mutant::None) {
                Some(found) => {
                    ops = candidate;
                    failure = found;
                    progressed = true;
                }
                None => start += chunk,
            }
        }
        if !progressed {
            chunk /= 2;
        }
    }
    (ops, failure)
}

/// Shrunk sequences of defects, each with the class it fails with. `KNOWN` must pass; `OPEN` lists defects of the
/// current tip, each asserted to still fail the same way so a fix moves it to `KNOWN`.
const KNOWN: &[(&str, &str, &[Op])] = &[
    // bigboi-data-2 and its forms half (shared-data, O89-list-snapshots).
    ("permission ask overtakes the list", "permissions ses_0", &[Op::SyncPermissions(0), Op::Ask(0)]),
    (
        "permission answer overtakes the list",
        "permissions ses_0",
        &[Op::Ask(0), Op::SyncPermissions(0), Op::Answer(0, 0)],
    ),
    ("form cancel overtakes the list", "forms ses_1", &[Op::Open(1), Op::SyncForms(1), Op::Cancel(1, 0)]),
    // bigboi-data-3 (O89-transcript-refresh).
    ("step overtakes the newest page", "transcript ses_0", &[Op::SyncMessages(0), Op::Step(0)]),
    // bigboi-data-6 (O89-older-page).
    (
        "older page after a head refresh",
        "transcript ses_0",
        &[
            Op::SyncMessages(0),
            Op::Release(Read::Head, 0),
            Op::LoadOlder(0),
            Op::Step(0),
            Op::Deliver(2),
            Op::Reconnect,
            Op::Release(Read::Head, 0),
            Op::Release(Read::Older, 0),
        ],
    ),
    // The first-pilot finding: an older page landing after `session.deleted` (fixed by shared-data's cursor check).
    (
        "older page after a delete",
        "deleted ses_0",
        &[Op::SyncMessages(0), Op::Release(Read::Head, 0), Op::LoadOlder(0), Op::Delete(0), Op::Deliver(1)],
    ),
    // carbon-data-2.
    ("delete keeps forms", "deleted ses_0", &[Op::Open(0), Op::Deliver(1), Op::Delete(0), Op::Deliver(1)]),
    // O7, O8 (bigboi-4, models review): the global 512-ID `state::Live` window evicted what overtook a read, in the
    // same session or another (fixed by the per-read overlay, models step 2).
    ("burst in the same session", "permissions ses_1", &[Op::SyncPermissions(1), Op::Burst(1)]),
    ("burst in another session", "permissions ses_0", &[Op::SyncPermissions(0), Op::Ask(0), Op::Burst(1)]),
    // O9, permission half: a late ask for a session the store found missing recreated its permissions.
    (
        "late ask for a missing session",
        "missing ses_1",
        &[Op::Ask(1), Op::Delete(1), Op::SyncPermissions(1), Op::Release(Read::Permissions, 1)],
    ),
    // S1 (carbon-4, O92-shell-list): a `Catalog::Shell` read replaced the location's shells, losing a
    // `shell.created` and bringing back a shell whose `shell.exited` arrived while it was in flight.
    ("shell created during the shell read", "shells", &[Op::SyncShells, Op::ShellCreate]),
    ("shell exited during the shell read", "settled shells", &[Op::ShellCreate, Op::SyncShells, Op::ShellExit(0)]),
    // More shells start during the read than its overlay holds: it publishes its list and reads again.
    ("shell overlay overflows", "shells", &[Op::SyncShells, Op::ShellBurst]),
    // O5: a durable `session.text.started` that the snapshot already holds added a second text part, so the reply
    // showed twice, also after `session.text.ended` (O5-text-started-replay).
    (
        "text.started replayed over a snapshot",
        "transcript ses_1",
        &[Op::Step(1), Op::Text(1), Op::SyncMessages(1), Op::Release(Read::Head, 1), Op::End(1)],
    ),
];

const OPEN: &[(&str, &str, &[Op])] = &[
    // Both reviews: a `step.started` emitted before the head read but delivered after its rows is appended after
    // newer rows (`message_live` treats "added during the read" as "newer than the page").
    ("late step below the newest page", "order ses_0", &[Op::Step(0), Op::Model(0), Op::Step(0), Op::SyncMessages(0)]),
    // New: the first head read of a transcript drops rows and edits that arrive while it is in flight
    // (`on_model_selected` needs a loaded transcript; `edit_*` drop edits to unloaded messages; `message_live`
    // records neither).
    ("model row during the first head read", "transcript ses_0", &[Op::SyncMessages(0), Op::Model(0)]),
    (
        "text.ended during the first head read",
        "transcript ses_1",
        &[Op::Model(1), Op::Step(1), Op::Reconnect, Op::SyncMessages(1), Op::Text(1), Op::End(1)],
    ),
    // bigboi-2 (models review): the held single-message refetch after `session.model.selected` upserts through
    // `transcript_mut` after `session.deleted` (`sessions.rs` `fetch_message`).
    (
        "held single-message read after a delete",
        "deleted ses_0",
        &[Op::Step(0), Op::Model(0), Op::Deliver(4), Op::Delete(0)],
    ),
    // New: a row loaded before the head read and edited during it (the next step completes it) is kept as
    // "changed" but appended after the page.
    (
        "edited row outside the page",
        "order ses_1",
        &[
            Op::SyncMessages(1),
            Op::Release(Read::Head, 1),
            Op::Step(1),
            Op::Deliver(2),
            Op::Step(1),
            Op::Step(1),
            Op::Reconnect,
            Op::Step(1),
        ],
    ),
    // New: events for a session the store already found missing (a read answered `SessionNotFoundError`) recreate
    // its forms.
    (
        "late form for a missing session",
        "missing ses_0",
        &[Op::Open(0), Op::Delete(0), Op::SyncForms(0), Op::Release(Read::Forms, 0)],
    ),
];

#[test]
fn known_sequences_pass() {
    let failing: Vec<String> = KNOWN
        .iter()
        .filter_map(|(name, _, ops)| {
            run(ops, Mutant::None).map(|failure| format!("{name}: [{}] {}", failure.class, failure.message))
        })
        .collect();
    assert!(failing.is_empty(), "{} of {} fail:\n{}", failing.len(), KNOWN.len(), failing.join("\n"));
}

#[test]
fn open_sequences_still_fail() {
    for (name, class, ops) in OPEN {
        let failure = run(ops, Mutant::None);
        assert_eq!(failure.as_ref().map(|f| f.class.as_str()), Some(*class), "{name}: {failure:?}");
    }
}

/// Prints the requests, replies and observations of the `KNOWN` or `OPEN` entry `MODEL_TRACE` names.
#[test]
fn trace() {
    let Ok(name) = std::env::var("MODEL_TRACE") else { return };
    let Some((_, _, ops)) = KNOWN.iter().chain(OPEN).find(|entry| entry.0 == name) else {
        panic!("no KNOWN or OPEN entry is named {name:?}");
    };
    eprintln!("{:?}", run(ops, Mutant::None));
}

/// Prints the verdict of every `KNOWN` and `OPEN` entry, for replays on older commits (`MODEL_REPORT=1`).
#[test]
fn report_known() {
    if std::env::var("MODEL_REPORT").is_err() {
        return;
    }
    for (name, class, ops) in KNOWN.iter().chain(OPEN) {
        let failure = run(ops, Mutant::None);
        eprintln!("{name} (expects {class}): {failure:?}");
    }
}

// The differential with TS -----------------------------------------------------------------------------------------

fn op_json(op: Op) -> Value {
    let read = |read: Read| format!("{read:?}");
    match op {
        Op::Ask(s)
        | Op::Burst(s)
        | Op::Open(s)
        | Op::Step(s)
        | Op::Text(s)
        | Op::End(s)
        | Op::Model(s)
        | Op::Delete(s) => {
            json!({ "op": name(op), "s": s })
        }
        Op::Answer(s, k) | Op::Cancel(s, k) => json!({ "op": name(op), "s": s, "k": k }),
        Op::Deliver(n) => json!({ "op": "Deliver", "n": n }),
        Op::Reconnect => json!({ "op": "Reconnect" }),
        Op::SyncPermissions(s) | Op::SyncForms(s) | Op::SyncMessages(s) | Op::LoadOlder(s) => {
            json!({ "op": name(op), "s": s })
        }
        Op::Release(r, s) | Op::Fail(r, s) => json!({ "op": name(op), "read": read(r), "s": s }),
        Op::ShellCreate | Op::ShellBurst | Op::SyncShells => json!({ "op": name(op) }),
        Op::ShellExit(k) => json!({ "op": name(op), "k": k }),
    }
}

/// What a user sees after a command, as the TS side writes it: per session the permission and form IDs, the rows
/// as `[id, text]`, and "more". An absent list and an empty one look the same.
fn seen_json(seen: &[Seen]) -> Value {
    Value::Array(
        seen.iter()
            .map(|seen| {
                let ids = |list: &Option<Vec<(String, String)>>| {
                    list.iter().flatten().map(|(id, _)| id.clone()).collect::<Vec<_>>()
                };
                json!({
                    "permissions": ids(&seen.permissions),
                    "forms": ids(&seen.forms),
                    "messages": seen.messages.iter().flatten().map(|(id, text)| json!([id, text])).collect::<Vec<_>>(),
                    "more": seen.more,
                })
            })
            .collect(),
    )
}

/// Runs `ops` with the checks off and returns the observation after each command and after the drain.
fn observations(ops: &[Op]) -> Vec<Value> {
    CHECKS.set(false);
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let trace = runtime.block_on(async {
        let mut run = Run::new(Mutant::None);
        let mut trace = Vec::new();
        for op in ops {
            let _ = run.step(*op).await;
            trace.push(seen_json(&run.seen));
        }
        let _ = run.drain().await;
        trace.push(seen_json(&run.seen));
        trace
    });
    CHECKS.set(true);
    trace
}

/// Writes `MODEL_CASES` random sequences with the Rust verdicts and observations to `MODEL_DUMP`, for
/// `model-differential.ts`. Skipped without `MODEL_DUMP`.
#[test]
fn dump_for_the_differential() {
    let Ok(path) = std::env::var("MODEL_DUMP") else { return };
    let mut rng = Rng(env("MODEL_SEED", 1));
    let cases = env("MODEL_CASES", 200) as usize;
    let len = env("MODEL_LEN", 30) as usize;
    // `MODEL_DUMP_OPEN=1` dumps the `OPEN` sequences instead, to see which defects TS shares.
    let named: Vec<(String, Vec<Op>)> = match std::env::var("MODEL_DUMP_OPEN") {
        Ok(_) => OPEN.iter().map(|(name, _, ops)| ((*name).to_owned(), ops.to_vec())).collect(),
        Err(_) => (0..cases).map(|case| (format!("case {case}"), generate(&mut rng, ALL, len))).collect(),
    };
    let dump: Vec<Value> = named
        .into_iter()
        .map(|(name, ops)| {
            let failure = run(&ops, Mutant::None);
            json!({
                "name": name,
                "ops": ops.iter().map(|op| op_json(*op)).collect::<Vec<_>>(),
                "rust": failure.map_or_else(|| "ok".to_owned(), |failure| format!("[{}] {}", failure.class, failure.message)),
                "observations": observations(&ops),
            })
        })
        .collect();
    std::fs::write(path, serde_json::to_string(&dump).unwrap()).unwrap();
}
