//! Who owns what a plugin asks for (bigboi's freeze pass): one table of request ownership, run on every carrier. A row
//! is a request kind, the call that asks for it, and when the plugin's route mount closes; its expected outcome comes
//! from the one written rule ([`expected`]), not from the row.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::abi::interact::{Bind, Event, Handled, Layer, LayerScope};
use opencode_plugin::abi::v2;
use opencode_tui::plugins::host::{External, external_with};
use opencode_tui::{Deps, Route};

use crate::plugin_pipe::{Pipe, config};
use crate::plugin_surface::held;
use crate::support::{self, Harness};

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Fetch,
    Foreground,
}

/// The call that asks.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Origin {
    Setup,
    Global,
    Route,
    MountBegin,
    MountEnd,
    Input,
}

/// When the route's mount closes. A view, a layout and a draw are no origin: they read only, and the host refuses a
/// request from them.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Close {
    Never,
    /// The call navigates away, then asks: the host acts on the request after the mount closed.
    BeforeDispatch,
    /// The call asks, then navigates away: the fetch is sent and the server holds it; the program waits for the end of
    /// the turn to start.
    InFlight,
    /// Over the pipe, the host navigates away as soon as the call is delivered, before the JS host answers with what
    /// it asked for.
    Racing,
    /// Once the reply came.
    AfterReply,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    InProcess,
    CAbi,
    Pipe,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Outcome {
    /// The fetch is answered, the program runs, and its one reply comes.
    Delivered,
    /// No reply comes; a fetch the mount closed before is not sent, a program does not start, and a TypeScript fetch
    /// rejects with an `AbortError` and is freed, while the server still holds it.
    Cancelled,
}

#[derive(Clone, Copy, Debug)]
struct Row {
    kind: Kind,
    origin: Origin,
    close: Close,
}

/// The rule `Host::try_fetch` states: what a route's command or a handler of the mount's input asks for is the mount's,
/// and ends with it; anything else (setup, a global command, the mount's begin and end) is the activation's.
fn expected(row: Row) -> Outcome {
    let mount_owned = matches!(row.origin, Origin::Route | Origin::Input);
    match mount_owned && matches!(row.close, Close::BeforeDispatch | Close::InFlight | Close::Racing) {
        true => Outcome::Cancelled,
        false => Outcome::Delivered,
    }
}

/// Why a row cannot happen on `carrier`, when it cannot.
fn unreachable(carrier: Carrier, row: Row) -> Option<&'static str> {
    if row.close == Close::Racing && carrier != Carrier::Pipe {
        return Some("in process and over the C ABI, what a call asks for leaves with its turn: no answer to race");
    }
    match (row.origin, row.close) {
        (Origin::Setup, Close::BeforeDispatch | Close::InFlight | Close::Racing) => {
            Some("setup runs before any mount shows")
        }
        (Origin::MountEnd, Close::Never | Close::InFlight | Close::Racing | Close::AfterReply) => {
            Some("the mount's end asks as the mount closes: only before dispatch")
        }
        _ => None,
    }
}

fn rows(carrier: Carrier) -> Vec<Row> {
    let kinds = [Kind::Fetch, Kind::Foreground];
    let origins = [Origin::Setup, Origin::Global, Origin::Route, Origin::MountBegin, Origin::MountEnd, Origin::Input];
    let closes = [Close::Never, Close::BeforeDispatch, Close::InFlight, Close::Racing, Close::AfterReply];
    let all = kinds.into_iter().flat_map(|kind| {
        origins.into_iter().flat_map(move |origin| closes.into_iter().map(move |close| Row { kind, origin, close }))
    });
    all.filter(|row| unreachable(carrier, *row).is_none()).collect()
}

// Expected (bigboi's freeze pass): every row of the table holds in process.
#[test]
fn request_ownership_in_process() {
    table(Carrier::InProcess);
}

// Expected (bigboi's freeze pass): every row of the table holds through the C ABI.
#[test]
fn request_ownership_through_the_c_abi() {
    table(Carrier::CAbi);
}

// Expected (bigboi's freeze pass): every row of the table holds over the pipe, where a cancelled fetch rejects.
#[test]
fn request_ownership_over_the_pipe() {
    table(Carrier::Pipe);
}

/// Runs every row on `carrier`, then fails with each row whose outcome is not the rule's.
fn table(carrier: Carrier) {
    if carrier == Carrier::Pipe && config().is_none() {
        return;
    }
    let failed: Vec<String> = rows(carrier).into_iter().filter_map(|row| run(carrier, row).err()).collect();
    assert!(failed.is_empty(), "{carrier:?}: {} rows broke the rule:\n{}", failed.len(), failed.join("\n"));
}

/// What one row did.
struct Seen {
    /// What the call's `try_` asked returned, or the TypeScript fetch's settling.
    asked: Vec<String>,
    /// The replies the plugin got, or how the TypeScript fetch settled with what stayed pending.
    replies: Vec<String>,
    /// The fetches the server was asked for, and the programs that started.
    sent: usize,
    launched: usize,
}

fn run(carrier: Carrier, row: Row) -> Result<(), String> {
    let root = opencode_util::temp::tempdir().unwrap();
    let mark = root.path().join("launched");
    let (fake, gate, served, asked) = held();
    let release = || {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    };
    let launched = || std::fs::read_to_string(&mark).unwrap_or_default().lines().count();
    let probe = Probe::start(carrier, row, root.path(), &mark, support::deps(Arc::new(fake)));
    let h = probe.harness();
    let route = Route::Plugin { id: probe.id().into(), name: "probe".into() };
    // The route opens; a mount that navigates away as it begins closes again at once.
    h.tui.navigate(route.clone());
    let racing = row.close == Close::Racing;
    if racing && row.origin == Origin::MountBegin {
        h.tui.navigate(Route::Home);
    }
    turns(h, 3);
    match row.origin {
        Origin::Global => _ = h.tui.keymap.dispatch("probe.global", None),
        Origin::Route => _ = h.tui.keymap.dispatch("probe.route", None),
        Origin::Input => h.app.press("x"),
        Origin::MountEnd => h.tui.navigate(Route::Home),
        Origin::Setup | Origin::MountBegin => {}
    }
    if racing && matches!(row.origin, Origin::Global | Origin::Route | Origin::Input) {
        h.tui.navigate(Route::Home);
    }
    turns(h, 3);
    if row.kind == Kind::Fetch && row.close == Close::InFlight {
        // Sent and held; a TypeScript fetch of a mount it closed has settled by now.
        let sent = h.app.wait_until(support::WAIT, || asked.load(Ordering::SeqCst) >= 1);
        if !sent {
            return Err(format!("{carrier:?} {row:?}: the fetch was never sent"));
        }
        turns(h, 10);
        if carrier == Carrier::Pipe && expected(row) == Outcome::Cancelled {
            let settled = probe.wait_settled(h);
            if settled != ["AbortError 0"] {
                return Err(format!(
                    "{carrier:?} {row:?}: with the server still holding it, the fetch settled {settled:?}"
                ));
            }
        }
    }
    if row.close == Close::AfterReply {
        release();
        probe.wait_replied(h, row.kind, &launched);
        h.tui.navigate(Route::Home);
        turns(h, 3);
    }
    // The route opens again, which mounts it anew, and what is still held answers.
    if row.close != Close::Never {
        h.tui.navigate(route);
        turns(h, 3);
    }
    release();
    // What the rule expects shows, however slow the carrier (the JS host under load): then a reply that would wrongly
    // arrive has time to.
    let shown = || match (expected(row), row.kind, carrier) {
        (Outcome::Delivered, Kind::Foreground, Carrier::Pipe) => launched() == 1,
        (Outcome::Delivered, Kind::Foreground, _) => launched() == 1 && !probe.replies().is_empty(),
        (Outcome::Delivered, Kind::Fetch, _) | (Outcome::Cancelled, Kind::Fetch, Carrier::Pipe) => {
            !probe.replies().is_empty()
        }
        (Outcome::Cancelled, Kind::Fetch, _) => served.load(Ordering::SeqCst) == asked.load(Ordering::SeqCst),
        (Outcome::Cancelled, Kind::Foreground, _) => !probe.asked().is_empty(),
    };
    h.app.wait_until(support::WAIT, || {
        h.app.advance(Duration::from_millis(1));
        shown()
    });
    h.app.wait_until(Duration::from_millis(300), || {
        h.app.advance(Duration::from_millis(1));
        false
    });
    let seen = Seen {
        asked: probe.asked(),
        replies: probe.replies(),
        sent: asked.load(Ordering::SeqCst),
        launched: launched(),
    };
    drop(probe);
    check(carrier, row, &seen)
}

/// Compares what a row did with the rule's outcome.
fn check(carrier: Carrier, row: Row, seen: &Seen) -> Result<(), String> {
    let outcome = expected(row);
    let pipe = carrier == Carrier::Pipe;
    let accepted = seen.asked.len() == 1 && (pipe || seen.asked[0].starts_with("Ok("));
    let delivered = match (row.kind, pipe) {
        (Kind::Fetch, false) => seen.replies.len() == 1 && seen.replies[0].contains("held") && seen.sent == 1,
        (Kind::Fetch, true) => seen.replies == ["Ok 0"] && seen.sent == 1,
        (Kind::Foreground, false) => seen.replies.len() == 1 && seen.replies[0].contains("code") && seen.launched == 1,
        // The pipe's carrier has no promise of a program: its reply goes nowhere.
        (Kind::Foreground, true) => seen.launched == 1,
    };
    // A fetch whose mount closed before its dispatch is not sent.
    let sent = usize::from(!matches!(row.close, Close::BeforeDispatch | Close::Racing));
    let cancelled = match (row.kind, pipe) {
        (Kind::Fetch, false) => seen.replies.is_empty() && seen.sent == sent,
        (Kind::Fetch, true) => seen.replies == ["AbortError 0"] && seen.sent == sent,
        (Kind::Foreground, _) => seen.replies.is_empty() && seen.launched == 0,
    };
    let held = match outcome {
        Outcome::Delivered => delivered,
        Outcome::Cancelled => cancelled,
    };
    match accepted && held {
        true => Ok(()),
        false => Err(format!(
            "{carrier:?} {row:?}: expected {outcome:?}; asked {:?}, replies {:?}, sent {}, launched {}",
            seen.asked, seen.replies, seen.sent, seen.launched
        )),
    }
}

fn turns(h: &Harness, count: usize) {
    for _ in 0..count {
        h.app.advance(Duration::from_millis(1));
        h.app.render();
    }
}

thread_local! {
    /// The row the in-process and C ABI probe runs.
    static ROW: Cell<Option<Row>> = const { Cell::new(None) };
    /// Where its program writes.
    static MARK: RefCell<PathBuf> = RefCell::default();
    /// What its `try_` call returned, and the replies it got.
    static SEEN: RefCell<(Vec<String>, Vec<String>)> = const { RefCell::new((Vec::new(), Vec::new())) };
}

/// The plugin of a row, on its carrier, in its own harness.
enum Probe {
    Native(Harness),
    Pipe(Pipe, PathBuf),
}

impl Probe {
    fn start(carrier: Carrier, row: Row, root: &Path, mark: &Path, deps: Deps) -> Self {
        if carrier == Carrier::Pipe {
            let log = root.join("settled");
            let plugin = root.join("config").join("plugins").join("probe");
            std::fs::create_dir_all(&plugin).unwrap();
            std::fs::write(plugin.join("tui.ts"), script(row, &log, mark)).unwrap();
            let harness = support::mount(80, 24, Deps { route: Route::Home, ..deps });
            let external = External { config_dir: root.join("config"), cwd: root.to_path_buf(), dev: Vec::new() };
            external_with(&harness.tui, external, config());
            let pipe = Pipe { harness, root: opencode_util::temp::tempdir().unwrap() };
            pipe.active("example.probe");
            return Probe::Pipe(pipe, log);
        }
        ROW.set(Some(row));
        MARK.replace(mark.to_path_buf());
        SEEN.with_borrow_mut(|seen| *seen = Default::default());
        let harness = support::mount(80, 24, Deps { route: Route::Home, ..deps });
        let host = opencode_tui::plugins::host::host(&harness.tui);
        let definition = match carrier {
            Carrier::CAbi => {
                let entries = abi::export_plugin!(@loopback "test.probe", probe);
                opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
            }
            _ => abi::Plugin { id: "test.probe", setup: probe }.into(),
        };
        opencode_tui::plugins::host::add(&harness.tui, definition);
        Probe::Native(harness)
    }

    fn harness(&self) -> &Harness {
        match self {
            Probe::Native(harness) => harness,
            Probe::Pipe(pipe, _) => &pipe.harness,
        }
    }

    fn id(&self) -> &'static str {
        match self {
            Probe::Native(_) => "test.probe",
            Probe::Pipe(..) => "example.probe",
        }
    }

    fn asked(&self) -> Vec<String> {
        match self {
            Probe::Native(_) => SEEN.with_borrow(|seen| seen.0.clone()),
            Probe::Pipe(_, log) => lines(log).into_iter().filter(|line| line.starts_with("asked")).collect(),
        }
    }

    fn replies(&self) -> Vec<String> {
        match self {
            Probe::Native(_) => SEEN.with_borrow(|seen| seen.1.clone()),
            Probe::Pipe(_, log) => {
                lines(log).into_iter().filter_map(|line| line.strip_prefix("settled ").map(str::to_owned)).collect()
            }
        }
    }

    /// Waits until the TypeScript fetch settled, or long enough to say it did not: how it settled.
    fn wait_settled(&self, h: &Harness) -> Vec<String> {
        h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            !self.replies().is_empty()
        });
        self.replies()
    }

    /// Waits until the request was answered: the reply came, or the program ran.
    fn wait_replied(&self, h: &Harness, kind: Kind, launched: &dyn Fn() -> usize) {
        h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            match (kind, self) {
                (Kind::Foreground, Probe::Pipe(..)) => launched() == 1,
                _ => !self.replies().is_empty(),
            }
        });
    }
}

fn lines(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path).unwrap_or_default().lines().map(str::to_owned).collect()
}

fn ask(host: &dyn abi::Host, origin: Origin) {
    let Some(row) = ROW.get().filter(|row| row.origin == origin) else { return };
    // Once a row: a mount that begins again asks nothing more.
    if SEEN.with_borrow(|seen| !seen.0.is_empty()) {
        return;
    }
    if row.close == Close::BeforeDispatch {
        host.navigate(abi::Route::Home);
    }
    let asked = match row.kind {
        Kind::Fetch => host.try_fetch(abi::Fetch::default().with_method("GET".into()).with_path("/api/hold".into())),
        Kind::Foreground => {
            let mark = MARK.with_borrow(|mark| mark.display().to_string());
            let args = vec!["-c".to_owned(), format!("echo launched >> '{mark}'")];
            host.try_foreground(abi::Foreground::new("sh").with_args(args))
        }
    };
    SEEN.with_borrow_mut(|seen| seen.0.push(format!("{asked:?}")));
    if row.close == Close::InFlight {
        host.navigate(abi::Route::Home);
    }
}

/// The probe: a route with its own command, a global command, a key of the mount, and the mount's begin and end,
/// each of which may ask, as the row says.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    ask(setup.host(), Origin::Setup);
    let command = |name: &str, scope| abi::Command::default().with_name(name.into()).with_scope(scope);
    setup.command(command("probe.global", abi::Scope::Global), |host, _| ask(host, Origin::Global));
    setup.command(command("probe.route", abi::Scope::Route("probe".into())), |host, _| ask(host, Origin::Route));
    setup.on_reply(|_, _, result| SEEN.with_borrow_mut(|seen| seen.1.push(format!("{result:?}"))));
    let layer = Layer::default().with_scope(LayerScope::Global).with_keys(vec![Bind::new("x", "probe")]);
    let surface = v2::Surface::new("probe", v2::Place::Route("probe".into()), |_| {
        v2::Node::text(vec![abi::Span::new("probe route")])
    })
    .mounts()
    .layers(vec![layer])
    .on(|host, event| match event {
        Event::Mount { mounted: true, .. } => {
            ask(host, Origin::MountBegin);
            Handled::Pass
        }
        Event::Mount { mounted: false, .. } => {
            ask(host, Origin::MountEnd);
            Handled::Pass
        }
        Event::Key(key) if key.bind.as_deref() == Some("probe") => {
            ask(host, Origin::Input);
            Handled::Consume
        }
        _ => Handled::Pass,
    });
    setup.surface(surface);
    Ok(())
}

/// The probe in TypeScript, on the raw carrier: the same calls, which log what the fetch settled with and what stayed
/// pending; its program writes as the Rust one's does.
fn script(row: Row, log: &Path, mark: &Path) -> String {
    let origin = format!("{:?}", row.origin);
    let close = format!("{:?}", row.close);
    let kind = format!("{:?}", row.kind);
    let program = format!("echo launched >> '{}'", mark.display());
    format!(
        r#"import {{ appendFileSync }} from "node:fs"
const [KIND, ORIGIN, CLOSE, LOG, PROGRAM] = {params}
const log = (line) => appendFileSync(LOG, line + "\n")
export default {{ id: "example.probe", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  let asked = false
  const home = () => carrier.effect({{ type: "navigate", route: {{ type: "home" }} }})
  const ask = (origin) => {{
    if (origin !== ORIGIN || asked) return
    asked = true
    if (CLOSE === "BeforeDispatch") home()
    log("asked")
    if (KIND === "Fetch") {{
      carrier.fetch({{ method: "GET", path: "/api/hold" }}).then(
        (result) => log("settled " + Object.keys(result ?? {{}}).join(",") + " " + carrier.pendingFetches()),
        (error) => log("settled " + error.name + " " + carrier.pendingFetches()),
      )
    }} else carrier.effect({{ type: "foreground", command: "sh", args: ["-c", PROGRAM] }})
    if (CLOSE === "InFlight") home()
  }}
  ask("Setup")
  carrier.surface("probe", {{ type: "route", name: "probe" }}, () => ({{ type: "text", spans: [{{ text: "probe route" }}] }}), {{
    mounts: true,
    layers: [{{ scope: "global", keys: [{{ key: "x", name: "probe" }}] }}],
    on: (event) => {{
      if (event.type === "mount") ask(event.mounted ? "MountBegin" : "MountEnd")
      if (event.type === "key" && event.bind === "probe") ask("Input")
    }},
  }})
  carrier.command({{ name: "probe.route", title: "probe.route", scope: {{ route: "probe" }} }}, () => ask("Route"))
  carrier.command({{ name: "probe.global", title: "probe.global" }}, () => ask("Global"))
}} }}
"#,
        params = serde_json::json!([kind, origin, close, log.display().to_string(), program]),
    )
}
