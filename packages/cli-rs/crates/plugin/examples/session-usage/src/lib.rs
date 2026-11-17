//! A port of `opencode-session-usage` 0.1.8 (`src/tui.tsx`): a sidebar panel with what the session in view and every
//! subagent session in its tree cost, at the provider's reported cost or at catalog prices, and the OpenCode Go usage
//! meters with their reset countdowns.
//!
//! The total covers every message, not the loaded transcript: the panel walks the tree with `session.list` and pages
//! `message.list` for each session, through the host's `fetch`, in a task that awaits each reply as TS does. It reads
//! the meters with `usage.limits`, at most once per `refreshMs` and at once after a turn. Its own thread ticks every 15
//! seconds, which moves the countdowns and lets the throttled read run, and notices a change of the config file.
//!
//! TS reads every page again after each turn in the tree, and so does the panel. A page holds a hundred messages with
//! their content, so a thread of the plugin's reads each page from the fetch's bytes ([`Cx::blocking`]) and prices
//! them at the end. Read on the UI thread, a family's pages after a subagent's turn went over the frame budget, and
//! the panel was reported slow (PL-4).

mod config;
mod usage;

use std::cell::RefCell;
use std::future::poll_fn;
use std::path::PathBuf;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::task::Poll;
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime};

use config::{Config, Position};
use opencode_plugin_abi::task::{Cx, Tasks, join_all};
use opencode_plugin_abi::types::{ModelInfo, SessionMessageInfo, UsageLimitsGo, UsageLimitsMeter, V2Event};
use opencode_plugin_abi::{
    Changed, Fetch, Host, LocationRef, Node, Placement, Read, Render, Setup, Span, Waker, Wrap, base64, plugin,
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
    let panel = Panel { state: Rc::new(RefCell::new(State::new(options, config))), tasks: setup.tasks() };
    let flags = Flags::default();
    if let Some(waker) = setup.waker() {
        let clock = Clock::start(waker, flags.clone(), config::path());
        setup.on_dispose(move |_| drop(clock));
    }
    let shown = panel.state.clone();
    setup.slot(at.clone(), move |read, input, changed| match input.session_id.as_deref() {
        Some(_) => shown.borrow_mut().render(read, changed),
        None => Render::Hide,
    });
    let mounted = panel.clone();
    let phase = flags.mounted.clone();
    setup.on_mount(at, move |host, input, mount| {
        let Some(session) = input.session_id.clone() else { return };
        if mount {
            *phase.lock().unwrap_or_else(PoisonError::into_inner) = Some(Instant::now());
        }
        mounted.mount(host, session, mount);
    });
    let woken = panel.clone();
    setup.on_wake(move |host| woken.woken(host, &flags));
    let events = ["session.execution.succeeded", "session.usage.updated", "session.created", "session.deleted"];
    setup.on_event(&events, move |host, event| panel.event(host, event));
    Ok(())
}

/// The panel's state and what starts its tasks.
#[derive(Clone)]
struct Panel {
    state: Rc<RefCell<State>>,
    tasks: Tasks,
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
    loading: bool,
    last_loaded: f64,
    last_forced: f64,
    /// TS `now`, which the tick moves.
    now: f64,
    /// TS `costInFlight`.
    costing: bool,
    /// TS `costQueued` and `costReload`.
    queued: Option<bool>,
    /// The run that waits for the models of a location to price what it read, and what wakes it.
    pricing: Option<(LocationRef, std::task::Waker)>,
    total: Option<f64>,
    /// Messages the Rust types rejected; they are left out of the total.
    skipped: usize,
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
            loading: false,
            last_loaded: 0.0,
            last_forced: 0.0,
            now: now(),
            costing: false,
            queued: None,
            pricing: None,
            total: None,
            skipped: 0,
        }
    }

    /// TS `touchesTree`.
    fn touches(&self, session: &str) -> bool {
        self.session.as_deref() == Some(session) || self.tree.iter().any(|id| id == session)
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
        // The models a run waits for are loaded: it prices what it read.
        let priced = self
            .pricing
            .as_ref()
            .is_some_and(|(location, _)| changed.location(location) && read.models(Some(location)).is_some());
        if priced && let Some((_, waker)) = self.pricing.take() {
            waker.wake();
        }
        if !(changed.all || changed.woken || changed.local) {
            return Render::Keep;
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

impl Panel {
    /// A claim mounted or went. A mount for another session starts over for it, as TS does when `sessionID` changes;
    /// a mount for the same one reads the limits again, as a new TS component does.
    fn mount(&self, host: &dyn Host, session: String, mounted: bool) {
        {
            let mut state = self.state.borrow_mut();
            if !mounted {
                if let Some(index) = state.mounts.iter().rposition(|known| *known == session) {
                    state.mounts.remove(index);
                }
                return;
            }
            state.mounts.push(session.clone());
            state.now = now();
            if state.session.as_ref() != Some(&session) {
                state.session = Some(session);
                state.tree.clear();
                state.total = None;
                // A run that waits for the models of the last session ends.
                if let Some((_, waker)) = state.pricing.take() {
                    waker.wake();
                }
                drop(state);
                self.refresh_cost(host, true);
            }
        }
        self.load(host, true);
    }

    /// The tick or the config file woke the plugin.
    fn woken(&self, host: &dyn Host, flags: &Flags) {
        let mut state = self.state.borrow_mut();
        if flags.config.swap(false, Ordering::AcqRel) {
            state.config = Config { position: state.config.position, ..config::load(&state.options) };
        }
        if flags.tick.swap(false, Ordering::AcqRel) && !state.mounts.is_empty() {
            state.now = now();
            if state.config.refresh_ms > 0 {
                drop(state);
                self.load(host, false);
            }
        }
    }

    fn event(&self, host: &dyn Host, event: &V2Event) {
        let mut state = self.state.borrow_mut();
        if state.mounts.is_empty() {
            return;
        }
        let refresh = match event {
            V2Event::SessionExecutionSucceeded(event) => state.touches(&event.data.session_id.0).then_some(true),
            V2Event::SessionUsageUpdated(event) => state.touches(&event.data.session_id.0).then_some(true),
            V2Event::SessionCreated(event) => {
                let Some(parent) = event.data.parent_id.as_ref().map(|parent| parent.0.as_str()) else { return };
                if state.session.as_deref() != Some(parent) && !state.tree.iter().any(|id| id == parent) {
                    return;
                }
                let id = event.data.session_id.0.clone();
                if !state.tree.contains(&id) {
                    state.tree.push(id);
                }
                Some(true)
            }
            V2Event::SessionDeleted(event) => {
                let before = state.tree.len();
                state.tree.retain(|id| *id != event.data.session_id.0);
                (state.tree.len() != before).then_some(false)
            }
            _ => None,
        };
        drop(state);
        if let Some(load) = refresh {
            self.refresh_cost(host, false);
            if load {
                self.load(host, true);
            }
        }
    }

    /// TS `load`: the usage limits, at most once per `refreshMs`, and a forced read at most once a second.
    fn load(&self, host: &dyn Host, force: bool) {
        let location = {
            let mut state = self.state.borrow_mut();
            let now = now();
            let refresh = state.config.refresh_ms as f64;
            if state.loading
                || (!force && (refresh == 0.0 || now - state.last_loaded < refresh))
                || (force && now - state.last_forced < 1_000.0)
            {
                return;
            }
            state.last_loaded = now;
            if force {
                state.last_forced = now;
            }
            state.loading = true;
            state.location(host)
        };
        let state = self.state.clone();
        self.tasks.spawn(host, move |cx| async move {
            let fetch = Fetch::new("GET", "/api/experimental/usage/limits")
                .query([("location[directory]", location.directory)]);
            let reply = cx.fetch(fetch).await;
            let mut state = state.borrow_mut();
            state.loading = false;
            // A failed read hides the meters.
            state.go = reply.ok().and_then(|body| serde_json::from_value(body.get("data")?.get("go")?.clone()).ok());
        });
    }

    /// TS `refreshCost`: one run at a time; a request during a run runs once it ends.
    fn refresh_cost(&self, host: &dyn Host, reload: bool) {
        {
            let mut state = self.state.borrow_mut();
            if state.costing {
                state.queued = Some(state.queued.unwrap_or(false) || reload);
                return;
            }
            if state.session.is_none() {
                return;
            }
            state.costing = true;
        }
        let state = self.state.clone();
        self.tasks.spawn(host, move |cx| refresh_cost(cx, state, reload));
    }
}

/// TS `refreshCost`'s runs, the queued ones after the first.
async fn refresh_cost(cx: Cx, state: Rc<RefCell<State>>, mut reload: bool) {
    loop {
        let run = {
            let state = state.borrow();
            let tree = (!reload && !state.tree.is_empty()).then(|| state.tree.clone());
            state.session.clone().map(|session| (session, cx.with(|host| state.location(host)), tree))
        };
        // A failed run keeps the last total, as TS's `catch` does.
        if let Some((session, location, tree)) = run
            && let Some(total) = cost(&cx, &state, &session, location, tree).await
            && state.borrow().session.as_ref() == Some(&session)
        {
            state.borrow_mut().total = Some(total);
        }
        let mut state = state.borrow_mut();
        match state.queued.take() {
            Some(queued) => reload = queued,
            None => {
                state.costing = false;
                return;
            }
        }
    }
}

/// TS `fetchSessionCost` (with `tree` unknown) or `costOfSessions`: what the tree of `session` cost at the prices
/// of `location`; `None` when a request failed or the session left the view.
async fn cost(
    cx: &Cx,
    state: &Rc<RefCell<State>>,
    session: &str,
    location: LocationRef,
    tree: Option<Vec<String>>,
) -> Option<f64> {
    let ids = match tree {
        Some(tree) => tree,
        None => {
            let ids = discover(cx, session).await.ok()?;
            // TS drops a tree found for a session no longer in view.
            if state.borrow().session.as_deref() != Some(session) {
                return None;
            }
            state.borrow_mut().tree = ids.clone();
            ids
        }
    };
    let mut sets = Vec::new();
    for batch in ids.chunks(COST_CONCURRENCY) {
        for messages in join_all(batch.iter().map(|id| fetch_messages(cx, state, id))).await {
            sets.push(messages.ok()?);
        }
    }
    let models = models(cx, state, session, location).await?;
    Some(cx.blocking(move || sets.iter().map(|messages| usage::session_cost(messages, &models)).sum()).await)
}

/// The models of `location` once the host has them, which the render that sees them load wakes this for; `None` once
/// `session` left the view.
async fn models(cx: &Cx, state: &Rc<RefCell<State>>, session: &str, location: LocationRef) -> Option<Vec<ModelInfo>> {
    poll_fn(|context| {
        let mut state = state.borrow_mut();
        if state.session.as_deref() != Some(session) {
            return Poll::Ready(None);
        }
        match cx.with(|host| host.models(Some(&location))) {
            Some(models) => Poll::Ready(Some(models)),
            None => {
                state.pricing = Some((location.clone(), context.waker().clone()));
                Poll::Pending
            }
        }
    })
    .await
}

/// TS `discoverSessions`: every session in the tree, the family the host knows first, then their children's
/// children by `session.list`, depth by depth.
async fn discover(cx: &Cx, session: &str) -> Result<Vec<String>, String> {
    let mut ids = cx.with(|host| family(host, session));
    let mut frontier = ids.clone();
    for _ in 0..MAX_DEPTH {
        if frontier.is_empty() || ids.len() >= MAX_SESSIONS {
            break;
        }
        let mut next = Vec::new();
        for parent in &frontier {
            for child in child_ids(cx, parent).await? {
                if !ids.contains(&child) && ids.len() < MAX_SESSIONS {
                    ids.push(child.clone());
                    next.push(child);
                }
            }
        }
        frontier = next;
    }
    Ok(ids)
}

/// TS `childIDs`: `parent`'s children, page by page.
async fn child_ids(cx: &Cx, parent: &str) -> Result<Vec<String>, String> {
    let (mut ids, mut cursor) = (Vec::new(), None);
    for _ in 0..MAX_PAGES {
        if ids.len() >= MAX_SESSIONS {
            break;
        }
        let query = [("limit", PAGE_SIZE.to_string()), ("parentID", parent.to_owned())];
        let query = query.into_iter().chain(cursor.take().map(|cursor| ("cursor", cursor)));
        let body = cx.fetch(Fetch::new("GET", "/api/session").query(query)).await?;
        let page = body.get("data").and_then(Value::as_array).into_iter().flatten();
        ids.extend(page.filter_map(|session| Some(session.get("id")?.as_str()?.to_owned())));
        let Some(next) = page_cursor(&body) else { break };
        cursor = Some(next.to_owned());
    }
    Ok(ids)
}

/// TS `fetchMessages`: `session`'s messages, page by page, each read on a thread of the plugin's from its bytes.
async fn fetch_messages(cx: &Cx, state: &Rc<RefCell<State>>, session: &str) -> Result<Vec<SessionMessageInfo>, String> {
    let (mut messages, mut cursor) = (Vec::new(), None);
    for _ in 0..MAX_PAGES {
        let query =
            [("limit", PAGE_SIZE.to_string())].into_iter().chain(cursor.take().map(|cursor| ("cursor", cursor)));
        let fetch = Fetch::new("GET", format!("/api/session/{session}/message")).query(query).bytes();
        let Value::String(body) = cx.fetch(fetch).await? else { return Err("the page is not bytes".to_owned()) };
        let page = cx.blocking(move || Page::read(&body)).await.ok_or("the page does not read")?;
        state.borrow_mut().skipped += page.skipped;
        messages.extend(page.messages);
        let Some(next) = page.cursor else { break };
        cursor = Some(next);
    }
    Ok(messages)
}

/// A page of messages, read from its bytes.
struct Page {
    messages: Vec<SessionMessageInfo>,
    /// The messages the Rust types rejected.
    skipped: usize,
    cursor: Option<String>,
}

impl Page {
    /// The page in `body`, the reply's bytes in base64; `None` when it does not read as a page.
    fn read(body: &str) -> Option<Self> {
        let mut body = serde_json::from_slice::<Value>(&base64::decode(body)?).ok()?;
        let cursor = page_cursor(&body).map(str::to_owned);
        let Value::Array(data) = body.get_mut("data")?.take() else { return None };
        // TS prices whatever a page holds; the API has no log for a plugin, so the panel counts what it skips.
        let count = data.len();
        let messages: Vec<SessionMessageInfo> =
            data.into_iter().filter_map(|message| serde_json::from_value(message).ok()).collect();
        Some(Self { skipped: count - messages.len(), messages, cursor })
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
    use serde_json::json;

    fn assistant(id: &str, cost: f64) -> Value {
        json!({
            "id": id, "type": "assistant", "agent": "build", "model": { "providerID": "p", "id": "m" },
            "time": { "created": 1 }, "content": [], "cost": cost,
        })
    }

    fn bytes(body: Value) -> String {
        base64::encode(body.to_string().as_bytes())
    }

    // Expected: a message the Rust types reject is skipped and counted, and the others are priced, as TS prices
    // whatever the page holds.
    #[test]
    fn a_malformed_message_is_skipped_and_the_rest_priced() {
        let broken = json!({ "id": "msg_2", "type": "assistant", "model": 5, "cost": 9 });
        let messages = [assistant("msg_1", 0.25), broken, assistant("msg_3", 0.5)];
        let page = Page::read(&bytes(json!({ "data": messages, "cursor": { "next": "c2" } }))).unwrap();
        assert_eq!((page.skipped, page.cursor.as_deref()), (1, Some("c2")));
        assert_eq!(usage::session_cost(&page.messages, &[]), 0.75);
        let last = Page::read(&bytes(json!({ "data": [], "cursor": { "next": "" } }))).unwrap();
        assert_eq!(last.cursor, None);
        assert!(Page::read(&bytes(json!({ "cursor": {} }))).is_none(), "a page without data does not read");
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
