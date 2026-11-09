//! A port of `opencode-session-usage` 0.1.8 (`src/tui.tsx`): a sidebar panel with what the session in view and every
//! subagent session in its tree cost, at the provider's reported cost or at catalog prices, and the OpenCode Go usage
//! meters with their reset countdowns.
//!
//! The total covers every message, not the loaded transcript: the panel walks the tree with `session.list` and pages
//! `message.list` for each session, through the host's `fetch`. It reads the meters with `usage.limits`, at most once per
//! `refreshMs` and at once after a turn. Its own thread ticks every 15 seconds, which moves the countdowns and lets the
//! throttled read run, and notices a change of the config file.

mod config;
mod usage;

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use config::{Config, Position};
use opencode_plugin_abi::types::{SessionMessageInfo, UsageLimitsGo, UsageLimitsMeter, V2Event};
use opencode_plugin_abi::{
    Changed, Fetch, Host, LocationRef, Node, Placement, Read, Render, RequestId, Setup, Span, Waker, Wrap,
    export_plugin,
};
use serde_json::Value;
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
    setup.on_reply(move |host, id, reply| state.borrow_mut().reply(host, id, reply));
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
    /// The messages of the last finished run, for TS `setTotal`: the total is priced with the location's models once
    /// they are loaded, and the messages are dropped then, as TS drops its `messageSets`.
    priced: Option<Priced>,
    total: Option<f64>,
    /// Messages the Rust types rejected; they are left out of the total.
    skipped: usize,
}

struct Priced {
    location: LocationRef,
    sessions: Vec<Vec<SessionMessageInfo>>,
}

/// TS `refreshCost` while it runs: the session it started for, where it is, and the requests it waits for.
struct Run {
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
    /// TS `costOfSessions`: the sessions, the first of the batch being read, and every session's messages so far.
    Price { ids: Vec<String>, batch: usize, open: usize, sessions: Vec<Vec<SessionMessageInfo>> },
}

/// What a run does after a step.
enum Next {
    Wait,
    Price(Vec<String>),
    Finish(Vec<Vec<SessionMessageInfo>>),
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
        self.priced = None;
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
        let fetch =
            Fetch { method: "GET".to_owned(), path: "/api/experimental/usage/limits".to_owned(), query, body: None };
        self.limits = Some(host.fetch(fetch));
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
        self.run = Some(Run { session, location, stage, waiting: Vec::new() });
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
                        run.waiting.push((host.fetch(fetch), Want::Children { page: 0 }));
                        Next::Wait
                    }
                }
                Stage::Price { open, .. } if *open > 0 => Next::Wait,
                Stage::Price { ids, batch, sessions, .. } if *batch >= ids.len() => {
                    Next::Finish(std::mem::take(sessions))
                }
                Stage::Price { ids, batch, open, .. } => {
                    let end = (*batch + COST_CONCURRENCY).min(ids.len());
                    for (index, id) in ids.iter().enumerate().take(end).skip(*batch) {
                        run.waiting.push((host.fetch(messages(id, None)), Want::Messages { index, page: 0 }));
                    }
                    (*open, *batch) = (end - *batch, end);
                    Next::Wait
                }
            };
            match next {
                Next::Wait => return,
                Next::Finish(sessions) => return self.finish(host, Some(sessions)),
                // TS drops a tree found for a session no longer in view.
                Next::Price(_) if self.session.as_ref() != Some(&run.session) => return self.finish(host, None),
                Next::Price(ids) => {
                    self.tree = ids.clone();
                    run.stage = price(ids);
                }
            }
        }
    }

    /// The run ended: with its messages when it priced the session still in view; then a queued run starts.
    fn finish(&mut self, host: &dyn Host, sessions: Option<Vec<Vec<SessionMessageInfo>>>) {
        let run = self.run.take();
        if let (Some(run), Some(sessions)) = (run, sessions)
            && self.session.as_ref() == Some(&run.session)
        {
            self.priced = Some(Priced { location: run.location, sessions });
        }
        if let Some(reload) = self.queued.take() {
            self.refresh_cost(host, reload);
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
        if !self.page(host, want, reply) {
            // A failed request ends the run and keeps the last total, as TS's `catch` does.
            return self.finish(host, None);
        }
        self.step(host);
    }

    /// Takes in one page of the run's; false when it failed.
    fn page(&mut self, host: &dyn Host, want: Want, reply: Result<Value, String>) -> bool {
        let (Some(run), Ok(body)) = (&mut self.run, reply) else { return false };
        let cursor = body.get("cursor").and_then(|cursor| cursor.get("next")).and_then(Value::as_str);
        let cursor = cursor.filter(|cursor| !cursor.is_empty());
        let data = body.get("data").cloned().unwrap_or(Value::Null);
        match (want, &mut run.stage) {
            (Want::Children { page }, Stage::Discover { ids, frontier, at, children: listed, next, .. }) => {
                let page_ids = data.as_array().into_iter().flatten().filter_map(|session| session.get("id")?.as_str());
                listed.extend(page_ids.map(str::to_owned));
                if let Some(cursor) = cursor.filter(|_| page + 1 < MAX_PAGES && listed.len() < MAX_SESSIONS) {
                    let fetch = children(&frontier[*at], Some(cursor));
                    run.waiting.push((host.fetch(fetch), Want::Children { page: page + 1 }));
                    return true;
                }
                for child in std::mem::take(listed) {
                    if !ids.contains(&child) && ids.len() < MAX_SESSIONS {
                        ids.push(child.clone());
                        next.push(child);
                    }
                }
                *at += 1;
            }
            (Want::Messages { index, page }, Stage::Price { ids, open, sessions, .. }) => {
                let Value::Array(page_messages) = data else { return false };
                // TS prices whatever a page holds; the API has no log for a plugin, so the panel counts what it skips.
                for message in page_messages {
                    match serde_json::from_value(message) {
                        Ok(message) => sessions[index].push(message),
                        Err(_) => self.skipped += 1,
                    }
                }
                if let Some(cursor) = cursor.filter(|_| page + 1 < MAX_PAGES) {
                    let fetch = messages(&ids[index], Some(cursor));
                    run.waiting.push((host.fetch(fetch), Want::Messages { index, page: page + 1 }));
                    return true;
                }
                *open -= 1;
            }
            _ => return false,
        }
        true
    }

    /// TS `location()`: the session's location, else where the TUI works.
    fn location(&self, read: &dyn Read) -> LocationRef {
        let session = self.session.as_deref().and_then(|id| read.session(id));
        match session {
            Some(session) => LocationRef { directory: session.info.location.directory.0, workspace: None },
            None => read.info().location,
        }
    }

    fn render(&mut self, read: &dyn Read, changed: &Changed) -> Render {
        let pricing = self.priced.as_ref().is_some_and(|priced| changed.location(&priced.location));
        if !(changed.all || changed.woken || changed.local || pricing) {
            return Render::Keep;
        }
        if let Some(priced) = &self.priced
            && let Some(models) = read.models(Some(&priced.location))
        {
            self.total = Some(priced.sessions.iter().map(|messages| usage::session_cost(messages, &models)).sum());
            self.priced = None;
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
    let sessions = vec![Vec::new(); ids.len()];
    Stage::Price { ids, batch: 0, open: 0, sessions }
}

/// TS `familyIDs`: every session the host knows in the tree of `session`, the root first.
fn family(read: &dyn Read, session: &str) -> Vec<String> {
    let mut members = read.family(session).members;
    members.sort_by_key(|member| member.parent.is_some());
    let ids: Vec<String> = members.into_iter().map(|member| member.id).collect();
    if ids.is_empty() { vec![session.to_owned()] } else { ids }
}

/// A page of `parent`'s children (TS `client.session.list`).
fn children(parent: &str, cursor: Option<&str>) -> Fetch {
    let mut query = vec![("limit".to_owned(), PAGE_SIZE.to_string()), ("parentID".to_owned(), parent.to_owned())];
    query.extend(cursor.map(|cursor| ("cursor".to_owned(), cursor.to_owned())));
    Fetch { method: "GET".to_owned(), path: "/api/session".to_owned(), query, body: None }
}

/// A page of `session`'s messages (TS `client.message.list`).
fn messages(session: &str, cursor: Option<&str>) -> Fetch {
    let mut query = vec![("limit".to_owned(), PAGE_SIZE.to_string())];
    query.extend(cursor.map(|cursor| ("cursor".to_owned(), cursor.to_owned())));
    Fetch { method: "GET".to_owned(), path: format!("/api/session/{session}/message"), query, body: None }
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

export_plugin!("opencode.sidebar.limit", setup);

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
        fn fetch(&self, fetch: Fetch) -> RequestId {
            let mut fetches = self.fetches.borrow_mut();
            fetches.push(fetch);
            RequestId(fetches.len() as u64)
        }
        fn dialog(&self, _dialog: Dialog) {}
        fn copy(&self, _text: &str, _then: Option<Action>) {}
    }

    /// The panel on `ses_p`, which has no children and one page of `messages`, after the replies.
    fn after_one_page(host: &Fake, messages: Vec<Value>) -> State {
        let mut state = State::new(Value::Null, config::load(&Value::Null));
        state.mount(host, "ses_p".to_owned(), true);
        assert_eq!(host.fetches.borrow()[0].path, "/api/session");
        state.reply(host, RequestId(1), Ok(json!({ "data": [], "cursor": {} })));
        let page = RequestId(host.fetches.borrow().len() as u64);
        assert_eq!(host.fetches.borrow().last().unwrap().path, "/api/session/ses_p/message");
        state.reply(host, page, Ok(json!({ "data": messages, "cursor": {} })));
        state
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

        state.render(&host, &Changed { all: true, ..Changed::default() });
        assert_eq!(state.total, Some(0.25));
        assert!(state.priced.is_none() && state.run.is_none());
    }

    // Expected: a message the Rust types reject is skipped and counted, and the others are priced, as TS prices
    // whatever the page holds.
    #[test]
    fn a_malformed_message_is_skipped_and_the_rest_priced() {
        let host = Fake::default();
        let broken = json!({ "id": "msg_2", "type": "assistant", "model": 5, "cost": 9 });
        let mut state = after_one_page(&host, vec![assistant("msg_1", 0.25), broken, assistant("msg_3", 0.5)]);
        state.render(&host, &Changed { all: true, ..Changed::default() });
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
