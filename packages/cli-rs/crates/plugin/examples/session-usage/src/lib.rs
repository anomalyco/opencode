//! A port of `opencode-session-usage` 0.1.8 (`src/tui.tsx`): a sidebar panel with what the session in view and every
//! subagent session in its tree cost, at the provider's reported cost or at catalog prices, and the OpenCode Go usage
//! meters with their reset countdowns.
//!
//! The total covers every message, not the loaded transcript: the panel walks the tree with `session.list` and pages
//! `message.list` for each session, through the host's `fetch`. It reads the meters with `usage.limits`, at most once per
//! `refreshMs` and at once after a turn. Its own thread ticks every 15 seconds, which moves the countdowns and lets the
//! throttled read run, and notices a change of the config file.
//!
//! TS reads every page again after each turn in the tree, and so does the panel. A page holds a hundred messages with
//! their content, so another thread of the plugin's reads the pages and prices them: the UI thread hands it each page
//! as the fetch's bytes and hears back only the page's cursor and, at the end, the total. Read on the UI thread, a
//! family's pages after a subagent's turn went over the frame budget, and the panel was reported slow (PL-4).

mod config;
mod usage;

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError, mpsc};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use config::{Config, Position};
use opencode_plugin_abi::types::{ModelInfo, SessionMessageInfo, UsageLimitsGo, UsageLimitsMeter, V2Event};
use opencode_plugin_abi::{
    Changed, Fetch, Host, LocationRef, Node, Placement, Read, Render, RequestId, SendError, Sender, Setup, Span, Stop,
    Waker, Wrap, base64, plugin,
};
use serde_json::{Value, json};
use usage::js_round;

const MAX_SESSIONS: usize = 500;
const PAGE_SIZE: usize = 100;
const MAX_PAGES: usize = 100;
const MAX_DEPTH: usize = 10;
const COST_CONCURRENCY: usize = 4;

fn setup(setup: &mut Setup) -> Result<(), String> {
    let options = setup.options().and_then(|options| serde_json::from_str(options).ok()).unwrap_or(Value::Null);
    let config = config::load(&options);
    // TS reads the position once, at setup.
    let at = match config.position {
        Position::Top => Placement::append("sidebar.content"),
        Position::Bottom => Placement::prepend("sidebar.footer"),
    };
    let state = Rc::new(RefCell::new(State::new(options, config)));
    let flags = Flags::default();
    if let Some(waker) = setup.waker() {
        let clock = Clock::start(waker, flags.clone(), config::path());
        setup.on_dispose(move |_| drop(clock));
    }
    let shown = state.clone();
    setup.slot(at.clone(), move |read, input, changed| match input.session_id.as_deref() {
        Some(_) => shown.borrow_mut().render(read, changed),
        None => Render::Hide,
    });
    let mounted = state.clone();
    let phase = flags.mounted.clone();
    setup.on_mount(at, move |host, input, mount| {
        let Some(session) = input.session_id.clone() else { return };
        if mount {
            *phase.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
        }
        mounted.borrow_mut().mount(host, session, mount);
    });
    let woken = state.clone();
    setup.on_wake(move |host| woken.borrow_mut().woken(host, &flags));
    let events = ["session.execution.succeeded", "session.usage.updated", "session.created", "session.deleted"];
    let heard = state.clone();
    setup.on_event(&events, move |host, event| heard.borrow_mut().event(host, event));
    let replied = state.clone();
    setup.on_reply(move |host, id, reply| replied.borrow_mut().reply(host, id, reply));
    let decoded = state.clone();
    let sender = setup.messages(move |host, message: Value| decoded.borrow_mut().decoded(host, message))?;
    let (jobs, queue) = mpsc::channel();
    // Without the thread, the UI thread reads the pages, as before.
    if setup.spawner().spawn("decode", move |stop| decode(&queue, &sender, &stop)).is_ok() {
        state.borrow_mut().decoder = Decoder::Thread(jobs);
    }
    Ok(())
}

/// What the panel knows: TS `SidebarUsage`'s signals and variables, for the session of the latest mount.
struct State {
    options: Value,
    config: Config,
    /// The sessions of the mounted claims, latest last.
    mounts: Vec<String>,
    /// TS `props.sessionID`.
    session: Option<String>,
    /// TS `treeIDs`: the sessions the total covers, in the order they were found.
    tree: Vec<String>,
    go: Option<UsageLimitsGo>,
    /// TS `inFlight`: the usage limits read.
    limits: Option<RequestId>,
    last_loaded: f64,
    last_forced: f64,
    /// TS `now`, which the tick moves.
    now: f64,
    /// TS `costInFlight`, with what it waits for.
    run: Option<Run>,
    /// TS `costQueued` and `costReload`.
    queued: Option<bool>,
    /// The last finished run, for TS `setTotal`: the decoder prices its messages with the location's models once they
    /// are loaded, and drops them then, as TS drops its `messageSets`.
    priced: Option<Priced>,
    total: Option<f64>,
    /// Messages the Rust types rejected; they are left out of the total.
    skipped: usize,
    decoder: Decoder,
    /// The number of the next run.
    runs: u64,
}

struct Priced {
    location: LocationRef,
    run: u64,
    /// The decoder was asked for its total.
    asked: bool,
}

/// TS `refreshCost` while it runs: its number, the session it started for, where it is, and the requests it waits
/// for.
struct Run {
    id: u64,
    session: String,
    location: LocationRef,
    stage: Stage,
    waiting: Vec<(RequestId, Want)>,
}

enum Stage {
    /// TS `discoverSessions`: the parents of this depth, the one being listed with its children so far, and the
    /// sessions of the next depth.
    Discover {
        ids: Vec<String>,
        frontier: Vec<String>,
        at: usize,
        children: Vec<String>,
        next: Vec<String>,
        depth: usize,
    },
    /// TS `costOfSessions`: the sessions, the first of the batch being read, and how many of the batch are still read;
    /// the decoder keeps their messages.
    Price { ids: Vec<String>, batch: usize, open: usize },
}

/// What a run does after a step.
enum Next {
    Wait,
    Price(Vec<String>),
    Finish,
    /// The host did not take a request: the run ends as a failed one does.
    Fail,
}

#[derive(Clone, Copy)]
enum Want {
    Children { page: usize },
    Messages { index: usize, page: usize },
}

impl State {
    fn new(options: Value, config: Config) -> Self {
        Self {
            options,
            config,
            mounts: Vec::new(),
            session: None,
            tree: Vec::new(),
            go: None,
            limits: None,
            last_loaded: 0.0,
            last_forced: 0.0,
            now: now(),
            run: None,
            queued: None,
            priced: None,
            total: None,
            skipped: 0,
            decoder: Decoder::Here(Book::default()),
            runs: 0,
        }
    }

    /// A claim mounted or went. A mount for another session starts over for it, as TS does when `sessionID` changes;
    /// a mount for the same one reads the limits again, as a new TS component does.
    fn mount(&mut self, host: &dyn Host, session: String, mounted: bool) {
        if !mounted {
            if let Some(index) = self.mounts.iter().rposition(|known| *known == session) {
                self.mounts.remove(index);
            }
            return;
        }
        self.mounts.push(session.clone());
        self.now = now();
        if self.session.as_ref() == Some(&session) {
            self.load(host, true);
            return;
        }
        self.session = Some(session);
        self.tree.clear();
        self.forget_priced();
        self.total = None;
        self.refresh_cost(host, true);
        self.load(host, true);
    }

    /// The tick or the config file woke the plugin.
    fn woken(&mut self, host: &dyn Host, flags: &Flags) {
        if flags.config.swap(false, Ordering::AcqRel) {
            self.config = Config { position: self.config.position, ..config::load(&self.options) };
        }
        if flags.tick.swap(false, Ordering::AcqRel) && !self.mounts.is_empty() {
            self.now = now();
            if self.config.refresh_ms > 0 {
                self.load(host, false);
            }
        }
    }

    fn event(&mut self, host: &dyn Host, event: &V2Event) {
        if self.mounts.is_empty() {
            return;
        }
        match event {
            V2Event::SessionExecutionSucceeded(event) if self.touches(&event.data.session_id.0) => {
                self.refresh_cost(host, false);
                self.load(host, true);
            }
            V2Event::SessionUsageUpdated(event) if self.touches(&event.data.session_id.0) => {
                self.refresh_cost(host, false);
                self.load(host, true);
            }
            V2Event::SessionCreated(event) => {
                let Some(parent) = event.data.parent_id.as_ref().map(|parent| parent.0.as_str()) else { return };
                if self.session.as_deref() != Some(parent) && !self.tree.iter().any(|id| id == parent) {
                    return;
                }
                let id = event.data.session_id.0.clone();
                if !self.tree.contains(&id) {
                    self.tree.push(id);
                }
                self.refresh_cost(host, false);
                self.load(host, true);
            }
            V2Event::SessionDeleted(event) => {
                let before = self.tree.len();
                self.tree.retain(|id| *id != event.data.session_id.0);
                if self.tree.len() != before {
                    self.refresh_cost(host, false);
                }
            }
            _ => {}
        }
    }

    /// TS `touchesTree`.
    fn touches(&self, session: &str) -> bool {
        self.session.as_deref() == Some(session) || self.tree.iter().any(|id| id == session)
    }

    /// TS `load`: the usage limits, at most once per `refreshMs`, and a forced read at most once a second.
    fn load(&mut self, host: &dyn Host, force: bool) {
        let now = now();
        let refresh = self.config.refresh_ms as f64;
        if self.limits.is_some()
            || (!force && (refresh == 0.0 || now - self.last_loaded < refresh))
            || (force && now - self.last_forced < 1_000.0)
        {
            return;
        }
        self.last_loaded = now;
        if force {
            self.last_forced = now;
        }
        let location = self.location(host);
        let query = vec![("location[directory]".to_owned(), location.directory)];
        let fetch = Fetch::default()
            .with_method("GET".to_owned())
            .with_path("/api/experimental/usage/limits".to_owned())
            .with_query(query);
        match host.try_fetch(fetch) {
            Ok(id) => self.limits = Some(id),
            // As a failed read: it hides the meters.
            Err(_) => self.go = None,
        }
    }

    /// TS `refreshCost`: one run at a time; a request during a run runs once it ends.
    fn refresh_cost(&mut self, host: &dyn Host, reload: bool) {
        if self.run.is_some() {
            self.queued = Some(self.queued.unwrap_or(false) || reload);
            return;
        }
        let Some(session) = self.session.clone() else { return };
        let location = self.location(host);
        let stage = match reload || self.tree.is_empty() {
            true => {
                let ids = family(host, &session);
                Stage::Discover { frontier: ids.clone(), ids, at: 0, children: Vec::new(), next: Vec::new(), depth: 0 }
            }
            false => price(self.tree.clone()),
        };
        self.runs += 1;
        self.run = Some(Run { id: self.runs, session, location, stage, waiting: Vec::new() });
        self.step(host);
    }

    /// Sends what the run needs next, or finishes it.
    fn step(&mut self, host: &dyn Host) {
        loop {
            let Some(run) = &mut self.run else { return };
            let next = match &mut run.stage {
                // TS `childIDs` reads a parent's pages one after another before it lists the next parent.
                Stage::Discover { .. } if !run.waiting.is_empty() => Next::Wait,
                Stage::Discover { ids, frontier, at, next, depth, .. } => {
                    if *at > 0 && *at == frontier.len() {
                        *frontier = std::mem::take(next);
                        *at = 0;
                        *depth += 1;
                    }
                    if *at == 0 && (*depth >= MAX_DEPTH || frontier.is_empty() || ids.len() >= MAX_SESSIONS) {
                        Next::Price(std::mem::take(ids))
                    } else {
                        let fetch = children(&frontier[*at], None);
                        match ask(host, &mut run.waiting, fetch, Want::Children { page: 0 }) {
                            true => Next::Wait,
                            false => Next::Fail,
                        }
                    }
                }
                Stage::Price { open, .. } if *open > 0 => Next::Wait,
                Stage::Price { ids, batch, .. } if *batch >= ids.len() => Next::Finish,
                Stage::Price { ids, batch, open } => {
                    let end = (*batch + COST_CONCURRENCY).min(ids.len());
                    let asked = ids.iter().enumerate().take(end).skip(*batch).all(|(index, id)| {
                        ask(host, &mut run.waiting, messages(id, None), Want::Messages { index, page: 0 })
                    });
                    (*open, *batch) = (end - *batch, end);
                    match asked {
                        true => Next::Wait,
                        false => Next::Fail,
                    }
                }
            };
            match next {
                Next::Wait => return,
                Next::Finish => return self.finish(host, true),
                Next::Fail => return self.finish(host, false),
                // TS drops a tree found for a session no longer in view.
                Next::Price(_) if self.session.as_ref() != Some(&run.session) => return self.finish(host, false),
                Next::Price(ids) => {
                    self.tree = ids.clone();
                    run.stage = price(ids);
                }
            }
        }
    }

    /// The run ended: `priced` when it read every page of the session still in view, which the decoder prices next;
    /// else the decoder drops what it read. Then a queued run starts.
    fn finish(&mut self, host: &dyn Host, priced: bool) {
        if let Some(run) = self.run.take() {
            match priced && self.session.as_ref() == Some(&run.session) {
                true => {
                    self.forget_priced();
                    self.priced = Some(Priced { location: run.location, run: run.id, asked: false });
                }
                false => drop(self.send(Job::Forget { run: run.id })),
            }
        }
        if let Some(reload) = self.queued.take() {
            self.refresh_cost(host, reload);
        }
    }

    /// No total is wanted of the last finished run any more: the decoder drops its messages, unless it was asked.
    fn forget_priced(&mut self) {
        if let Some(priced) = self.priced.take().filter(|priced| !priced.asked) {
            drop(self.send(Job::Forget { run: priced.run }));
        }
    }

    /// Hands `job` to the decoder; what it answers at once, when the UI thread is the decoder.
    fn send(&mut self, job: Job) -> Option<Value> {
        match &mut self.decoder {
            Decoder::Thread(jobs) => {
                let _ = jobs.send(job);
                None
            }
            Decoder::Here(book) => book.handle(job),
        }
    }

    fn reply(&mut self, host: &dyn Host, id: RequestId, reply: Result<Value, String>) {
        if self.limits == Some(id) {
            self.limits = None;
            // A failed read hides the meters.
            self.go = reply.ok().and_then(|body| serde_json::from_value(body.get("data")?.get("go")?.clone()).ok());
            return;
        }
        let Some(run) = &mut self.run else { return };
        let Some(index) = run.waiting.iter().position(|(known, _)| *known == id) else { return };
        let (_, want) = run.waiting.remove(index);
        if let Want::Messages { index, page } = want {
            // A failed request ends the run and keeps the last total, as TS's `catch` does.
            let Ok(Value::String(body)) = reply else { return self.finish(host, false) };
            let job = Job::Page { run: run.id, index, page, body };
            if let Some(answer) = self.send(job) {
                self.decoded(host, answer);
            }
            return;
        }
        if !self.page(host, want, reply) {
            return self.finish(host, false);
        }
        self.step(host);
    }

    /// What the decoder answered: a page of the run that reads, after which the run reads the session's next page or
    /// goes on; or the total of the last finished run.
    fn decoded(&mut self, host: &dyn Host, answer: Value) {
        if let Some(total) = answer.get("total") {
            if self.priced.as_ref().is_some_and(|priced| total["run"].as_u64() == Some(priced.run)) {
                self.total = total["total"].as_f64();
                self.priced = None;
            }
            return;
        }
        let page = &answer["page"];
        // A page of a run that ended.
        if self.run.as_ref().is_none_or(|run| page["run"].as_u64() != Some(run.id)) {
            return;
        }
        if page["ok"] != true {
            return self.finish(host, false);
        }
        self.skipped += page["skipped"].as_u64().unwrap_or(0) as usize;
        let (index, number) =
            (page["index"].as_u64().unwrap_or(0) as usize, page["page"].as_u64().unwrap_or(0) as usize);
        let Some(Run { stage: Stage::Price { ids, open, .. }, waiting, .. }) = &mut self.run else { return };
        if let Some(cursor) = page["cursor"].as_str().filter(|_| number + 1 < MAX_PAGES) {
            let fetch = messages(&ids[index], Some(cursor));
            if !ask(host, waiting, fetch, Want::Messages { index, page: number + 1 }) {
                self.finish(host, false);
            }
            return;
        }
        *open -= 1;
        self.step(host);
    }

    /// Takes in one page of the run's children; false when it failed.
    fn page(&mut self, host: &dyn Host, want: Want, reply: Result<Value, String>) -> bool {
        let (Some(run), Ok(body)) = (&mut self.run, reply) else { return false };
        let cursor = page_cursor(&body);
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        match (want, &mut run.stage) {
            (Want::Children { page }, Stage::Discover { ids, frontier, at, children: listed, next, .. }) => {
                let page_ids = data.as_array().into_iter().flatten().filter_map(|session| session.get("id")?.as_str());
                listed.extend(page_ids.map(str::to_owned));
                if let Some(cursor) = cursor.filter(|_| page + 1 < MAX_PAGES && listed.len() < MAX_SESSIONS) {
                    let fetch = children(&frontier[*at], Some(cursor));
                    return ask(host, &mut run.waiting, fetch, Want::Children { page: page + 1 });
                }
                for child in std::mem::take(listed) {
                    if !ids.contains(&child) && ids.len() < MAX_SESSIONS {
                        ids.push(child.clone());
                        next.push(child);
                    }
                }
                *at += 1;
            }
            _ => return false,
        }
        true
    }

    /// TS `location()`: the session's location, else where the TUI works.
    fn location(&self, read: &dyn Read) -> LocationRef {
        let session = self.session.as_deref().and_then(|id| read.session(id));
        match session {
            Some(session) => LocationRef::new(session.info.location.directory.0, None),
            None => read.info().location,
        }
    }

    fn render(&mut self, read: &dyn Read, changed: &Changed) -> Render {
        let pricing = self.priced.as_ref().is_some_and(|priced| !priced.asked && changed.location(&priced.location));
        if !(changed.all || changed.woken || changed.local || pricing) {
            return Render::Keep;
        }
        if let Some(priced) = self.priced.as_mut().filter(|priced| !priced.asked)
            && let Some(models) = read.models(Some(&priced.location))
        {
            priced.asked = true;
            let job = Job::Price { run: priced.run, models };
            // The UI thread as the decoder prices it now.
            if let Some(total) = self.send(job).and_then(|answer| answer["total"]["total"].as_f64()) {
                self.total = Some(total);
                self.priced = None;
            }
        }
        Render::Show(self.panel())
    }

    /// The panel, as TS `SidebarUsage` draws it.
    fn panel(&self) -> Node {
        let config = &self.config;
        let estimate = self.total.map_or("…".to_owned(), usage::money);
        if config.compact {
            let line = match &self.go {
                Some(go) if config.show_meters => [&go.rolling, &go.weekly, &go.monthly]
                    .iter()
                    .zip(["R", "W", "M"])
                    .map(|(meter, letter)| format!("{letter}{}%", js_round(meter.percent)))
                    .collect::<Vec<_>>()
                    .join(" · "),
                _ if config.show_estimate => format!("≈ {estimate}"),
                _ => String::new(),
            };
            return Node::column(vec![Node::text([Span::new(format!("{} · {line}", config.title))]).fg("text.base")]);
        }
        let mut rows = vec![Node::text([Span::new(config.title.clone())]).fg("text.base")];
        if config.show_estimate {
            rows.push(Node::text([Span::new(format!("≈ {estimate} session total"))]).fg("text.muted"));
        }
        if let Some(go) = self.go.as_ref().filter(|_| config.show_meters) {
            // A leading empty box and the gap stand for TS `paddingTop={1}`.
            let mut meters = Vec::new();
            if config.show_estimate {
                meters.push(Node::column(Vec::new()));
            }
            meters.push(self.meter("Rolling", &go.rolling));
            meters.push(self.meter("Weekly", &go.weekly));
            meters.push(self.meter("Monthly", &go.monthly));
            rows.push(Node::column(meters).gap(1));
        }
        Node::column(rows)
    }

    /// TS `meterRow`: the label, the percentage and the countdown, and the bar under them.
    fn meter(&self, label: &str, meter: &UsageLimitsMeter) -> Node {
        let config = &self.config;
        let color = usage::severity(meter.percent, meter.limited, config.warn_at, config.critical_at).color();
        let percent = format!("{:>4} used", format!("{}%", js_round(meter.percent)));
        let reset = match config.show_reset {
            true => format!(" · resets {}", usage::reset_in(meter.resets_at, self.now)),
            false => String::new(),
        };
        let line = vec![
            Span::new(format!("{label:<8}")).fg("text.base"),
            Span::new(percent).fg(color),
            Span::new(reset).fg("text.muted"),
        ];
        let mut rows = vec![Node::text(line).wrap(Wrap::None)];
        if config.show_bars {
            let filled = usage::filled(meter.percent, config.bar_width);
            let bar = vec![
                Span::new("━".repeat(filled)).fg(color),
                Span::new("─".repeat(config.bar_width - filled)).fg("text.muted"),
            ];
            rows.push(Node::text(bar).wrap(Wrap::None));
        }
        Node::column(rows)
    }
}

/// A run that prices `ids`.
fn price(ids: Vec<String>) -> Stage {
    Stage::Price { ids, batch: 0, open: 0 }
}

/// What reads and prices the pages of messages: the plugin's thread, or the UI thread when it did not start.
enum Decoder {
    Thread(mpsc::Sender<Job>),
    Here(Book),
}

/// What the decoder is asked.
enum Job {
    /// Page `page` of the messages of session `index` of run `run`: the reply's bytes, in base64.
    Page { run: u64, index: usize, page: usize, body: String },
    /// The total of run `run` at `models`' prices; its messages go.
    Price { run: u64, models: Vec<ModelInfo> },
    /// Run `run` ended with no total: its messages go.
    Forget { run: u64 },
}

/// The messages the decoder read, of each run and each of its sessions.
#[derive(Default)]
struct Book {
    runs: HashMap<u64, Vec<Vec<SessionMessageInfo>>>,
}

impl Book {
    /// Does `job`, and returns what the UI thread hears of it: a page's cursor and the messages it skipped, or that it
    /// could not be read; or a total.
    fn handle(&mut self, job: Job) -> Option<Value> {
        match job {
            Job::Page { run, index, page, body } => {
                let read = base64::decode(&body).and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
                let page_of = |mut body: Value| {
                    let cursor = page_cursor(&body).map(str::to_owned);
                    Some((cursor, body.get_mut("data")?.take()))
                };
                let Some((cursor, Value::Array(messages))) = read.and_then(page_of) else {
                    return Some(json!({ "page": { "run": run, "index": index, "page": page, "ok": false } }));
                };
                let sessions = self.runs.entry(run).or_default();
                if sessions.len() <= index {
                    sessions.resize_with(index + 1, Vec::new);
                }
                // TS prices whatever a page holds; the API has no log for a plugin, so the panel counts what it skips.
                let mut skipped = 0;
                for message in messages {
                    match serde_json::from_value(message) {
                        Ok(message) => sessions[index].push(message),
                        Err(_) => skipped += 1,
                    }
                }
                let page = json!({ "run": run, "index": index, "page": page, "ok": true, "cursor": cursor, "skipped": skipped });
                Some(json!({ "page": page }))
            }
            Job::Price { run, models } => {
                let sessions = self.runs.remove(&run).unwrap_or_default();
                let total: f64 = sessions.iter().map(|messages| usage::session_cost(messages, &models)).sum();
                Some(json!({ "total": { "run": run, "total": total } }))
            }
            Job::Forget { run } => {
                self.runs.remove(&run);
                None
            }
        }
    }
}

/// The decoder's thread: does each job and sends the answer to the UI thread, until the plugin stops.
fn decode(queue: &mpsc::Receiver<Job>, sender: &Sender<Value>, stop: &Stop) {
    let mut book = Book::default();
    while !stop.stopped() {
        let job = match queue.recv_timeout(Duration::from_millis(500)) {
            Ok(job) => job,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        };
        let Some(mut answer) = book.handle(job) else { continue };
        // A full mailbox has room again once the UI thread takes the next message.
        loop {
            match sender.send(answer) {
                Ok(()) => break,
                Err(SendError::Full(back)) if !stop.stopped() => {
                    answer = back;
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => return,
            }
        }
    }
}

/// The cursor of the page after `body`, if any.
fn page_cursor(body: &Value) -> Option<&str> {
    let cursor = body.get("cursor").and_then(|cursor| cursor.get("next")).and_then(Value::as_str);
    cursor.filter(|cursor| !cursor.is_empty())
}

/// TS `familyIDs`: every session the host knows in the tree of `session`, the root first.
fn family(read: &dyn Read, session: &str) -> Vec<String> {
    let mut members = read.family(session).members;
    members.sort_by_key(|member| member.parent.is_some());
    let ids: Vec<String> = members.into_iter().map(|member| member.id).collect();
    if ids.is_empty() { vec![session.to_owned()] } else { ids }
}

/// A page of `parent`'s children (TS `client.session.list`).
/// Fetches `fetch` for `want` of the run that waits on `waiting`; false when the host did not take it, which ends the
/// run, as a failed request does: no reply comes.
fn ask(host: &dyn Host, waiting: &mut Vec<(RequestId, Want)>, fetch: Fetch, want: Want) -> bool {
    host.try_fetch(fetch).map(|id| waiting.push((id, want))).is_ok()
}

fn children(parent: &str, cursor: Option<&str>) -> Fetch {
    let mut query = vec![("limit".to_owned(), PAGE_SIZE.to_string()), ("parentID".to_owned(), parent.to_owned())];
    query.extend(cursor.map(|cursor| ("cursor".to_owned(), cursor.to_owned())));
    Fetch::default().with_method("GET".to_owned()).with_path("/api/session".to_owned()).with_query(query)
}

/// A page of `session`'s messages (TS `client.message.list`), as its bytes, which the decoder reads.
fn messages(session: &str, cursor: Option<&str>) -> Fetch {
    let mut query = vec![("limit".to_owned(), PAGE_SIZE.to_string())];
    query.extend(cursor.map(|cursor| ("cursor".to_owned(), cursor.to_owned())));
    Fetch::default()
        .with_method("GET".to_owned())
        .with_path(format!("/api/session/{session}/message"))
        .with_query(query)
        .with_bytes(true)
}

/// `Date.now()`.
fn now() -> f64 {
    SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map_or(0.0, |since| since.as_millis() as f64)
}

/// When the clock ticks: a period after the latest mount, then every period, as TS's `setInterval` in a component.
struct Phase {
    due: Instant,
    period: Duration,
}

impl Phase {
    fn new(now: Instant, period: Duration) -> Self {
        Self { due: now + period, period }
    }

    /// Whether the clock ticks at `now`, after a mount at `mounted` if one came since the last call.
    fn tick(&mut self, now: Instant, mounted: Option<Instant>) -> bool {
        if let Some(mounted) = mounted {
            self.due = mounted + self.period;
        }
        if now < self.due {
            return false;
        }
        while self.due <= now {
            self.due += self.period;
        }
        true
    }
}

/// What the clock's thread tells the UI thread.
#[derive(Clone, Default)]
struct Flags {
    tick: Arc<AtomicBool>,
    config: Arc<AtomicBool>,
    /// When a claim mounted last, until the clock's thread starts its period there.
    mounted: Arc<Mutex<Option<Instant>>>,
}

/// Ticks every [`usage::TICK_MS`] from the latest mount and watches the config file, on its own thread, and wakes the host for either. It
/// stops and joins the thread when dropped, at dispose.
struct Clock {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Clock {
    fn start(waker: Waker, flags: Flags, path: PathBuf) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let stamp = |path: &PathBuf| std::fs::metadata(path).ok().map(|meta| (meta.modified().ok(), meta.len()));
        let thread = std::thread::spawn(move || {
            let mut phase = Phase::new(Instant::now(), Duration::from_millis(usage::TICK_MS));
            let mut seen = stamp(&path);
            loop {
                // A mount only moves the tick later, so the thread may sleep until the tick it knows.
                let poll = Duration::from_millis(500).min(phase.due.saturating_duration_since(Instant::now()));
                std::thread::park_timeout(poll);
                if stopped.load(Ordering::Acquire) {
                    return;
                }
                let mut wake = false;
                let mounted = flags.mounted.lock().unwrap_or_else(PoisonError::into_inner).take();
                if phase.tick(Instant::now(), mounted) {
                    flags.tick.store(true, Ordering::Release);
                    wake = true;
                }
                let now = stamp(&path);
                if now != seen {
                    seen = now;
                    flags.config.store(true, Ordering::Release);
                    wake = true;
                }
                if wake {
                    waker.wake();
                }
            }
        });
        Self { stop, thread: Some(thread) }
    }
}

impl Drop for Clock {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.thread().unpark();
            let _ = thread.join();
        }
    }
}

plugin!(id = "opencode.sidebar.limit", setup);

#[cfg(test)]
mod tests {
    use super::*;
    use opencode_plugin_abi::{Action, Attention, Dialog, Rgba, ThemeMode, Toast};
    use serde_json::json;

    /// A host that records the fetches and has the models loaded.
    #[derive(Default)]
    struct Fake {
        fetches: RefCell<Vec<Fetch>>,
    }

    impl Read for Fake {
        fn theme_mode(&self) -> ThemeMode {
            ThemeMode::Dark
        }
        fn color(&self, _token: &str) -> Option<Rgba> {
            None
        }
        fn models(&self, _location: Option<&LocationRef>) -> Option<Vec<opencode_plugin_abi::types::ModelInfo>> {
            Some(Vec::new())
        }
    }

    impl Host for Fake {
        fn storage_set(&self, _key: &str, _value: Value) {}
        fn dispatch(&self, _name: &str, _input: Option<&str>) {}
        fn toast(&self, _toast: Toast) {}
        fn attention(&self, _attention: Attention) {}
        fn open_route(&self, _name: &str) {}
        fn navigate(&self, _route: opencode_plugin_abi::Route) {}
        fn try_fetch(&self, fetch: Fetch) -> Result<RequestId, String> {
            let mut fetches = self.fetches.borrow_mut();
            fetches.push(fetch);
            Ok(RequestId(fetches.len() as u64))
        }
        fn dialog(&self, _dialog: Dialog) {}
        fn copy(&self, _text: &str, _then: Option<Action>) {}
    }

    /// The panel on `ses_p`, which has no children and one page of `messages`, after the replies.
    fn after_one_page(host: &Fake, messages: Vec<Value>) -> State {
        let mut state = mounted(host);
        state.reply(host, last(host), Ok(bytes(json!({ "data": messages, "cursor": {} }))));
        state
    }

    /// The panel on `ses_p`, which has no children, as it asks for the first page of messages.
    fn mounted(host: &Fake) -> State {
        let mut state = State::new(Value::Null, config::load(&Value::Null));
        state.mount(host, "ses_p".to_owned(), true);
        assert_eq!(host.fetches.borrow()[0].path, "/api/session");
        state.reply(host, RequestId(1), Ok(json!({ "data": [], "cursor": {} })));
        let fetches = host.fetches.borrow();
        let fetch = fetches.last().unwrap();
        assert!(fetch.path == "/api/session/ses_p/message" && fetch.bytes, "{fetch:?}");
        state
    }

    fn last(host: &Fake) -> RequestId {
        RequestId(host.fetches.borrow().len() as u64)
    }

    /// A reply of `body` as its bytes.
    fn bytes(body: Value) -> Value {
        Value::String(base64::encode(body.to_string().as_bytes()))
    }

    // Expected (PL-4): a page of messages crosses to the decoder's thread as it came, and the UI thread reads none of
    // it; the decoder's answer moves the run on, and its total shows.
    #[test]
    fn the_ui_thread_hands_each_page_to_the_decoder() {
        let host = Fake::default();
        let mut state = mounted(&host);
        let (jobs, queue) = mpsc::channel();
        state.decoder = Decoder::Thread(jobs);
        let body = bytes(json!({ "data": [assistant("msg_1", 0.25)], "cursor": {} }));
        state.reply(&host, last(&host), Ok(body.clone()));
        let Ok(Job::Page { run, index: 0, page: 0, body: sent }) = queue.try_recv() else { panic!("no page job") };
        assert_eq!(Value::String(sent.clone()), body);
        assert!(state.run.is_some(), "the run waits for the decoder");
        let mut book = Book::default();
        let answer = book.handle(Job::Page { run, index: 0, page: 0, body: sent }).unwrap();
        state.decoded(&host, answer);
        assert!(state.run.is_none() && state.priced.is_some());
        state.render(&host, &Changed::everything());
        let Ok(Job::Price { run: priced, models }) = queue.try_recv() else { panic!("no price job") };
        state.decoded(&host, book.handle(Job::Price { run: priced, models }).unwrap());
        assert_eq!(state.total, Some(0.25));
        assert!(book.runs.is_empty());
    }

    fn assistant(id: &str, cost: f64) -> Value {
        json!({
            "id": id, "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
            "time": { "created": 1 }, "content": [], "cost": cost,
        })
    }

    // Expected: once the panel has its total, it keeps no message, as TS's `costOfSessions` returns a number and lets
    // its `messageSets` go.
    #[test]
    fn a_priced_run_keeps_no_messages() {
        let host = Fake::default();
        let mut state = after_one_page(&host, vec![assistant("msg_1", 0.25)]);
        assert!(state.run.is_none() && state.priced.is_some());

        state.render(&host, &Changed::everything());
        assert_eq!(state.total, Some(0.25));
        assert!(state.priced.is_none() && state.run.is_none());
        assert!(matches!(&state.decoder, Decoder::Here(book) if book.runs.is_empty()));
    }

    // Expected: a message the Rust types reject is skipped and counted, and the others are priced, as TS prices
    // whatever the page holds.
    #[test]
    fn a_malformed_message_is_skipped_and_the_rest_priced() {
        let host = Fake::default();
        let broken = json!({ "id": "msg_2", "type": "assistant", "model": 5, "cost": 9 });
        let mut state = after_one_page(&host, vec![assistant("msg_1", 0.25), broken, assistant("msg_3", 0.5)]);
        state.render(&host, &Changed::everything());
        assert_eq!((state.total, state.skipped), (Some(0.75), 1));
    }

    // Expected: as TS's `setInterval` in a component, the first tick comes a period after the mount, then every
    // period; a mount during the period starts it again.
    #[test]
    fn the_tick_starts_again_at_a_mount() {
        let (start, second) = (Instant::now(), Duration::from_secs(1));
        let mut phase = Phase::new(start, 15 * second);
        let ticks: Vec<bool> = [(9, None), (15, Some(10)), (24, None), (25, None), (39, None), (40, None)]
            .into_iter()
            .map(|(at, mounted)| phase.tick(start + at * second, mounted.map(|at| start + at * second)))
            .collect();
        assert_eq!(ticks, [false, false, false, true, false, true]);
    }
}
