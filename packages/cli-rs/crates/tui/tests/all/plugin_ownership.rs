//! Who owns what a plugin asks for (bigboi's freeze and ownership passes, carbon own-1): one table of request and
//! effect ownership, run on every carrier. A row is a request or an effect, the call that asks for it, and when a mount
//! closes; its expected outcome comes from the one written rule ([`expected`]), not from the row.

use std::cell::{Cell, RefCell};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::abi::interact::{Anchor, Bind, Event, Handled, Interact, Layer, LayerScope, Overlay};
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
    /// A timer of 20 ms (timers, 2.3): owned as a fetch is.
    Timer,
    /// The effects a call asks of the input: an overlay of the plugin's, a mode, the focus of node `n`, the focus of
    /// field `fld` (`focus-input`), a blur, an offset of scroll `s`, and a move of the session transcript, the app's,
    /// which the user's handler may ask for.
    Overlay,
    Mode,
    Focus,
    FocusField,
    Blur,
    Scroll,
    Transcript,
    /// A select of the plugin's, centered (contract 2.x additions): a dialog is the activation's, whichever call asked.
    Dialog,
}

impl Kind {
    /// A request, which gets a reply; else an effect, which applies.
    fn request(self) -> bool {
        matches!(self, Kind::Fetch | Kind::Foreground | Kind::Timer)
    }
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

/// When a mount closes. A view, a layout and a draw are no origin: they read only, and the host refuses a request
/// from them.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Close {
    Never,
    /// The call navigates away, then asks: the host acts on the request after the route's mount closed.
    BeforeDispatch,
    /// The call asks, then navigates away: the fetch is sent and the server holds it; the program waits for the end of
    /// the turn to start. Setup's fetch is in flight while the route opens and closes.
    InFlight,
    /// Over the pipe, the host navigates away as soon as the call is delivered, and only then handles the JS host's
    /// answer ([`opencode_plugin::pipe::Scripts::hold_answers`]).
    Racing,
    /// The call asks, then closes the plugin's overlay, another mount: a control, which ends nothing of the route's.
    Other,
    /// The program ran, and the route's mount closes before its reply goes (`foreground::on_exit`).
    Launched,
    /// Once the reply came.
    AfterReply,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    InProcess,
    CAbi,
    Pipe,
    /// A Luau plugin (spike `luau-spike`), in process on the linked path.
    #[cfg(feature = "luau")]
    Luau,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Outcome {
    /// The fetch is answered, the program runs, and its one reply comes, with the ID the call got.
    Delivered,
    /// No reply comes; a fetch the mount closed before is not sent, a program does not start, and a TypeScript fetch
    /// rejects with an `AbortError` and is freed, while the server still holds it. A Rust or C plugin hears the cancel
    /// once in its reply's place (`Setup::on_cancelled`), and a Luau task's wait returns `nil, "cancelled"`.
    Cancelled,
    /// The program ran once, and no reply comes: the cancel comes in its place, as for [`Outcome::Cancelled`].
    Unanswered,
    /// The effect applies: to the mount that asked, or to the activation.
    Applied,
    /// The effect applies nowhere: neither to the activation nor to a mount opened since.
    Dropped,
}

#[derive(Clone, Copy, Debug)]
struct Row {
    kind: Kind,
    origin: Origin,
    close: Close,
}

/// The rule `Host::try_fetch` states: what a route's command or a handler of the mount's input asks for is the mount's,
/// and ends with it; anything else (setup, a global command, the mount's begin and end) is the activation's. A mount
/// may send or start its request only while it is open, and hear its reply only while it is open.
fn expected(row: Row) -> Outcome {
    let mount_owned = matches!(row.origin, Origin::Route | Origin::Input);
    if !row.kind.request() {
        // A move of the transcript, the app's, outlives the mount once it applied: asked before the close, it applies
        // before it, in order. The mount's own effects close with it.
        let closed = match row.kind {
            Kind::Transcript => matches!(row.close, Close::BeforeDispatch | Close::Racing),
            Kind::Dialog => false,
            _ => matches!(row.close, Close::BeforeDispatch | Close::InFlight | Close::Racing),
        };
        return match mount_owned && closed {
            true => Outcome::Dropped,
            false => Outcome::Applied,
        };
    }
    match row.close {
        Close::BeforeDispatch | Close::InFlight | Close::Racing if mount_owned => Outcome::Cancelled,
        Close::Launched if mount_owned => Outcome::Unanswered,
        _ => Outcome::Delivered,
    }
}

/// Why a row cannot happen on `carrier`, when it cannot.
fn unreachable(carrier: Carrier, row: Row) -> Option<&'static str> {
    if row.kind == Kind::Timer && carrier == Carrier::Pipe {
        return Some("a TS plugin keeps time with the JS host's own setTimeout, which is no request of the host's");
    }
    if row.close == Close::Racing && carrier != Carrier::Pipe {
        return Some("in process and over the C ABI, what a call asks for leaves with its turn: no answer to race");
    }
    if !row.kind.request() {
        return match (row.kind, row.origin, row.close) {
            (_, _, Close::Launched | Close::AfterReply) => Some("an effect has no reply and no launch"),
            (_, _, Close::Other) => Some("the control's overlay is an overlay itself, and takes the focus"),
            (Kind::Dialog, Origin::Setup, Close::Never) => None,
            (Kind::Dialog, Origin::Setup, _) => Some("setup asks before any mount shows"),
            (_, Origin::Setup, _) => Some("setup holds no input: its verbs are refused (P2)"),
            (Kind::Blur, ..) => {
                Some("on a plugin's route the host has no composer to give the focus to: a blur moves nothing to see")
            }
            (Kind::Focus | Kind::FocusField | Kind::Scroll, Origin::MountBegin | Origin::MountEnd, _) => {
                Some("a mount's begin comes before its first view, its end after its tree: no node to name")
            }
            (Kind::Transcript, Origin::MountBegin | Origin::MountEnd, _) => Some(
                "a mount's begin and end are no handler of the user's input: a transcript verb from them is refused",
            ),
            (Kind::Focus | Kind::FocusField | Kind::Scroll, Origin::Global, close) if close != Close::Never => {
                Some("an activation's verb names the newest mount that holds the node: with the route closed, none")
            }
            (_, Origin::MountEnd, close) if close != Close::BeforeDispatch => {
                Some("the mount's end asks as the mount closes: only before dispatch")
            }
            _ => None,
        };
    }
    match (row.kind, row.origin, row.close) {
        (Kind::Fetch | Kind::Timer, _, Close::Launched) => Some("a fetch or a timer has no launch"),
        (_, Origin::Setup, Close::BeforeDispatch | Close::Racing | Close::Other) => {
            Some("setup asks before any mount shows")
        }
        (Kind::Foreground, Origin::Setup, Close::InFlight) => {
            Some("setup's program starts with the activation's turn, before any mount shows")
        }
        (_, Origin::MountEnd, close) if close != Close::BeforeDispatch => {
            Some("the mount's end asks as the mount closes: only before dispatch")
        }
        _ => None,
    }
}

fn rows(carrier: Carrier) -> Vec<Row> {
    let kinds = [
        Kind::Fetch,
        Kind::Foreground,
        Kind::Timer,
        Kind::Overlay,
        Kind::Mode,
        Kind::Focus,
        Kind::FocusField,
        Kind::Blur,
        Kind::Scroll,
        Kind::Transcript,
        Kind::Dialog,
    ];
    let origins = [Origin::Setup, Origin::Global, Origin::Route, Origin::MountBegin, Origin::MountEnd, Origin::Input];
    let closes = [
        Close::Never,
        Close::BeforeDispatch,
        Close::InFlight,
        Close::Racing,
        Close::Other,
        Close::Launched,
        Close::AfterReply,
    ];
    let all = kinds.into_iter().flat_map(|kind| {
        origins.into_iter().flat_map(move |origin| closes.into_iter().map(move |close| Row { kind, origin, close }))
    });
    all.filter(|row| unreachable(carrier, *row).is_none()).collect()
}

// Expected (bigboi's freeze and ownership passes): every row of the table holds in process.
#[test]
fn request_ownership_in_process() {
    table(Carrier::InProcess);
}

// Expected (bigboi's freeze and ownership passes): every row of the table holds through the C ABI.
#[test]
fn request_ownership_through_the_c_abi() {
    table(Carrier::CAbi);
}

// Expected (bigboi's freeze and ownership passes): every row of the table holds over the pipe, where a cancelled fetch
// rejects.
#[test]
fn request_ownership_over_the_pipe() {
    table(Carrier::Pipe);
}

// Expected (luau-spike 1.2): a Luau plugin is on the linked path, so every row holds for it as in process.
#[cfg(feature = "luau")]
#[test]
fn request_ownership_in_luau() {
    table(Carrier::Luau);
}

// Expected (await-cancel, contract-ergonomics 2.1): a task a mount's key started, parked on that mount's fetch, goes
// on once with `cancelled` as the mount closes, while the server still holds the fetch; nothing follows, also not once
// the route opens again and the server answers. In process, through the C ABI and in Luau.
#[test]
fn a_task_parked_on_its_mounts_fetch_goes_on_once_cancelled() {
    #[cfg_attr(not(feature = "luau"), allow(unused_mut))]
    let mut carriers = vec![Carrier::InProcess, Carrier::CAbi];
    #[cfg(feature = "luau")]
    carriers.push(Carrier::Luau);
    for carrier in carriers {
        parked(carrier);
    }
}

fn parked(carrier: Carrier) {
    let (fake, gate, served, asked) = held();
    PARKED.with_borrow_mut(Vec::clear);
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(fake)) });
    let host = opencode_tui::plugins::host::host(&h.tui);
    let definition = match carrier {
        Carrier::CAbi => {
            let entries = abi::export_plugin!(@loopback "test.parked", parked_plugin);
            opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
        }
        #[cfg(feature = "luau")]
        Carrier::Luau => {
            let sources = opencode_plugin::luau::Sources::from_files([
                ("plugin.toml", "id = \"test.parked\""),
                ("init.luau", &parked_script()),
            ]);
            opencode_plugin::luau::define(&sources, None).unwrap().0
        }
        _ => abi::Plugin { id: "test.parked", setup: parked_plugin }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    let route = Route::Plugin { id: "test.parked".into(), name: "probe".into() };
    let resumed = || match carrier {
        #[cfg(feature = "luau")]
        Carrier::Luau => {
            let stored = opencode_plugin::Host::storage_read(&*h.tui, "plugin.test.parked.seen");
            let seen: Vec<String> = stored.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default();
            seen
        }
        _ => PARKED.with_borrow(Vec::clone),
    };
    h.tui.navigate(route.clone());
    turns(&h, 3);
    h.app.press("x");
    assert!(h.app.wait_until(support::WAIT, || asked.load(Ordering::SeqCst) == 1), "{carrier:?}: never sent");
    turns(&h, 3);
    assert!(resumed().is_empty(), "{carrier:?}: the task went on while its fetch was held");
    h.tui.navigate(Route::Home);
    h.app.wait_until(support::WAIT, || {
        h.app.advance(Duration::from_millis(1));
        !resumed().is_empty()
    });
    assert_eq!(resumed(), ["cancelled"], "{carrier:?}: the close did not resume the task once with the cancel");
    h.tui.navigate(route);
    turns(&h, 3);
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    assert!(h.app.wait_until(support::WAIT, || served.load(Ordering::SeqCst) == 1), "{carrier:?}: never served");
    h.app.wait_until(Duration::from_millis(300), || {
        h.app.advance(Duration::from_millis(1));
        false
    });
    assert_eq!(resumed(), ["cancelled"], "{carrier:?}: the held reply reached the task after its cancel");
}

thread_local! {
    /// What the Rust task of [`parked_plugin`] got: its fetch's error, or `ok`.
    static PARKED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// A route whose key starts a task that waits on a fetch: the mount's, as its handler asked for it.
fn parked_plugin(setup: &mut abi::Setup) -> Result<(), String> {
    let tasks = setup.tasks();
    let layer = Layer::default().scope(LayerScope::Global).keys(vec![Bind::new("x", "probe")]);
    let surface = v2::Surface::new("probe", v2::Place::Route("probe".into()), |_| page()).layers(vec![layer]).on(
        move |host, event| match event {
            Event::Key(key) if key.bind.as_deref() == Some("probe") => {
                tasks.spawn(host, |cx| async move {
                    let reply = cx.fetch(abi::Fetch::new("GET", "/api/hold")).await;
                    PARKED.with_borrow_mut(|seen| seen.push(reply.err().unwrap_or_else(|| "ok".to_owned())));
                });
                Handled::Consume
            }
            _ => Handled::Pass,
        },
    );
    setup.surface(surface);
    Ok(())
}

/// [`parked_plugin`] in Luau: the surface's handler is the task; it records in its storage what its fetch gave.
#[cfg(feature = "luau")]
fn parked_script() -> String {
    let page = luau_literal(&serde_json::to_value(page()).unwrap());
    format!(
        r#"local plugin = require("@opencode/plugin")
local PAGE = {page}
return plugin.define(function(setup)
    setup:storageKey("seen")
    local layer = {{ scope = "global", keys = {{ {{ key = "x", name = "probe" }} }} }}
    setup:surface({{ name = "probe", place = {{ type = "route", name = "probe" }}, layers = {{ layer }} }},
        function() return PAGE end,
        function(host, event)
            if event.type == "key" and event.bind == "probe" then
                local _, err = host:fetch({{ method = "GET", path = "/api/hold" }})
                local seen = host:storageGet("seen") or {{}}
                table.insert(seen, err or "ok")
                host:storageSet("seen", seen)
                return "consume"
            end
            return "pass"
        end)
end)
"#
    )
}

/// The program that witnesses its launch in `mark`, and its arguments: a tiny program of this crate's, on every
/// platform, with no shell.
fn witness(mark: &Path) -> (String, Vec<String>) {
    (env!("CARGO_BIN_EXE_plugin-launch-witness").to_owned(), vec![mark.display().to_string()])
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
    /// The IDs the call's `try_` gave, or one `None` a TypeScript ask.
    asked: Vec<Option<u64>>,
    /// The replies the plugin got, each with its ID, or how the TypeScript fetch settled with what stayed pending.
    replies: Vec<(Option<u64>, String)>,
    /// The fetches the server was asked for, and the programs that started.
    sent: usize,
    launched: usize,
    /// The begins (`true`) and ends of the second mount, the overlay.
    other: Vec<bool>,
}

fn run(carrier: Carrier, row: Row) -> Result<(), String> {
    if !row.kind.request() {
        return run_effect(carrier, row);
    }
    let root = opencode_util::temp::tempdir().unwrap();
    let mark = root.path().join("launched");
    let (fake, gate, served, asked) = held();
    let release = || {
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
    };
    let launched = || std::fs::read_to_string(&mark).unwrap_or_default().lines().count();
    // The route closes the moment a program exited, before its reply goes.
    let closing = Rc::new(|tui: &opencode_tui::app::Tui| tui.navigate(Route::Home));
    opencode_tui::features::foreground::on_exit((row.close == Close::Launched).then_some(closing as _));
    let probe = Probe::start(carrier, row, root.path(), &mark, support::deps(Arc::new(fake)));
    let h = probe.harness();
    let route = Route::Plugin { id: probe.id().into(), name: "probe".into() };
    if row.close == Close::Other {
        _ = h.tui.keymap.dispatch("probe.overlay", None);
        turns(h, 3);
    }
    // A racing row handles nothing of the JS host's until the route closed.
    let racing = row.close == Close::Racing;
    if racing {
        probe.hold(true);
    }
    // The route opens; a mount that navigates away as it begins closes again at once.
    h.tui.navigate(route.clone());
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
    if racing {
        probe.hold(false);
    }
    turns(h, 3);
    if row.kind == Kind::Fetch && row.close == Close::InFlight {
        // Sent and held; a TypeScript fetch of a mount it closed has settled by now.
        let sent = h.app.wait_until(support::WAIT, || asked.load(Ordering::SeqCst) >= 1);
        if !sent {
            return Err(format!("{carrier:?} {row:?}: the fetch was never sent"));
        }
        if row.origin == Origin::Setup {
            h.tui.navigate(Route::Home);
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
    // The program ran, which closed the route; over the pipe it waits for the JS host's answer.
    if row.close == Close::Launched {
        h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            launched() == 1
        });
    }
    if row.close == Close::AfterReply {
        release();
        probe.wait_replied(h, row.kind, &launched);
        h.tui.navigate(Route::Home);
        turns(h, 3);
    }
    // The route opens again, which mounts it anew, and what is still held answers.
    if !matches!(row.close, Close::Never | Close::Other) {
        h.tui.navigate(route);
        turns(h, 3);
    }
    release();
    // What the rule expects shows, however slow the carrier (the JS host under load): then a reply that would wrongly
    // arrive has time to.
    let shown = || match (expected(row), row.kind, carrier) {
        (Outcome::Delivered, Kind::Foreground, Carrier::Pipe) | (Outcome::Unanswered, ..) => launched() == 1,
        (Outcome::Delivered, Kind::Foreground, _) => launched() == 1 && !probe.replies().is_empty(),
        (Outcome::Delivered, Kind::Fetch, _) | (Outcome::Cancelled, Kind::Fetch, Carrier::Pipe) => {
            !probe.replies().is_empty()
        }
        (Outcome::Cancelled, Kind::Fetch, _) => served.load(Ordering::SeqCst) == asked.load(Ordering::SeqCst),
        (Outcome::Cancelled, Kind::Foreground, _) => !probe.asked().is_empty(),
        (Outcome::Delivered | Outcome::Cancelled, Kind::Timer, _) => !probe.replies().is_empty(),
        (Outcome::Applied | Outcome::Dropped, ..)
        | (
            _,
            Kind::Overlay
            | Kind::Mode
            | Kind::Focus
            | Kind::FocusField
            | Kind::Blur
            | Kind::Scroll
            | Kind::Transcript
            | Kind::Dialog,
            _,
        ) => {
            unreachable!("an effect's row runs in run_effect")
        }
    };
    h.app.wait_until(support::WAIT, || {
        h.app.advance(Duration::from_millis(1));
        shown()
    });
    h.app.wait_until(Duration::from_millis(300), || {
        h.app.advance(Duration::from_millis(1));
        false
    });
    opencode_tui::features::foreground::on_exit(None);
    let seen = Seen {
        asked: probe.asked(),
        replies: probe.replies(),
        sent: asked.load(Ordering::SeqCst),
        launched: launched(),
        other: probe.other(),
    };
    drop(probe);
    check(carrier, row, &seen)
}

/// Compares what a row did with the rule's outcome.
fn check(carrier: Carrier, row: Row, seen: &Seen) -> Result<(), String> {
    let outcome = expected(row);
    let pipe = carrier == Carrier::Pipe;
    let id = seen.asked.first().copied().flatten();
    let accepted = seen.asked.len() == 1 && (pipe || id.is_some_and(|id| id != 0));
    // Each reply names the ID its call got.
    let named = seen.replies.iter().all(|(reply, _)| *reply == id);
    let replied = |text: &str| seen.replies.len() == 1 && seen.replies[0].1.contains(text);
    let delivered = match (row.kind, pipe) {
        (Kind::Timer, _) => replied("Ok(") && seen.sent == 0,
        (Kind::Fetch, false) => replied("held") && seen.sent == 1,
        (Kind::Fetch, true) => replied("Ok 0") && seen.sent == 1,
        (Kind::Foreground, false) => replied("code") && seen.launched == 1,
        // The pipe's carrier has no promise of a program: its reply goes nowhere.
        (Kind::Foreground, true) => seen.launched == 1,
        _ => unreachable!("an effect's row runs in run_effect"),
    };
    // A fetch whose mount closed before its dispatch is not sent.
    let sent = usize::from(!matches!(row.close, Close::BeforeDispatch | Close::Racing));
    // The cancel comes once, in the reply's place, and no reply after it, also not to the mount opened again. The pipe's
    // carrier has no promise of a program: it hears nothing.
    let told = match (row.kind, pipe) {
        (Kind::Fetch, true) => replied("AbortError 0"),
        (Kind::Foreground, true) => seen.replies.is_empty(),
        _ => replied("cancelled"),
    };
    let cancelled = match row.kind {
        Kind::Timer => told && seen.sent == 0,
        Kind::Fetch => told && seen.sent == sent,
        Kind::Foreground => told && seen.launched == 0,
        _ => unreachable!("an effect's row runs in run_effect"),
    };
    let held = match outcome {
        Outcome::Delivered => delivered,
        Outcome::Cancelled => cancelled,
        Outcome::Unanswered => told && seen.launched == 1,
        Outcome::Applied | Outcome::Dropped => unreachable!("an effect's row runs in run_effect"),
    };
    // The control closed another mount, which began and ended, or it would be told from no close at all (bigboi's
    // verification).
    let other = match row.close {
        Close::Other => seen.other == [true, false],
        _ => seen.other.is_empty(),
    };
    match accepted && named && held && other {
        true => Ok(()),
        false => Err(format!(
            "{carrier:?} {row:?}: expected {outcome:?}; asked {:?}, replies {:?}, sent {}, launched {}, other {:?}",
            seen.asked, seen.replies, seen.sent, seen.launched, seen.other
        )),
    }
}

/// Runs an effect's row: the route's mount asks, or the activation does, and the route closes as the row says. A
/// racing row closes the route and opens it again, a mount of its own, before the JS host's answer applies. What the
/// effect did is read from the host: the overlays and modes it holds, and the route's last live mount's focus and
/// scroll.
fn run_effect(carrier: Carrier, row: Row) -> Result<(), String> {
    let root = opencode_util::temp::tempdir().unwrap();
    let mark = root.path().join("launched");
    let probe = Probe::start(carrier, row, root.path(), &mark, support::deps(Arc::new(support::empty())));
    let h = probe.harness();
    let (plugin, route) = (probe.id(), Route::Plugin { id: probe.id().into(), name: "probe".into() });
    let mounts = || opencode_plugin::behave::mounts(h.app.app(), plugin, "probe");
    let shows = |count: usize| {
        h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            mounts().len() == count && mounts().last().is_some_and(|mount| !mount.offsets.is_empty())
        })
    };
    let focus = || opencode_plugin::behave::focus(&*h.tui, plugin, "probe", "n");
    let ledger = || opencode_plugin::interact::ledger(&*h.tui);
    // The session transcript, as the host publishes it: what moved it is recorded.
    let moved = Rc::new(Cell::new(0));
    let recorded = moved.clone();
    let _published = opencode_plugin::behave::publish_transcript(
        h.app.app(),
        opencode_plugin::behave::Published {
            read: Rc::new(|| v2::TranscriptView { offset: 0, viewport: 10, extent: 40, ..Default::default() }),
            scroll: Rc::new(move |_| recorded.set(recorded.get() + 1)),
        },
    );
    let racing = row.close == Close::Racing;
    let before = ledger();
    if racing {
        probe.hold(true);
    }
    h.tui.navigate(route.clone());
    // A mount that closes as it begins leaves no mount to wait for.
    let begins_closed = row.origin == Origin::MountBegin && row.close != Close::Never;
    if racing && row.origin == Origin::MountBegin {
        h.tui.navigate(Route::Home);
    } else if !begins_closed && !shows(1) {
        return Err(format!("{carrier:?} {row:?}: the route never showed"));
    }
    if row.kind == Kind::Blur && row.close == Close::Never {
        focus();
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
    // The route opens again, a mount of its own, which focuses its node, before what the closed one asked applies:
    // held over the pipe, applied already elsewhere.
    if row.close != Close::Never {
        // The close is the call's own effect, which over the pipe applies only when the JS host answers: the route
        // opens again once it closed, or the close would end the new mount instead.
        let closed = h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            mounts().is_empty()
        });
        if !closed {
            return Err(format!("{carrier:?} {row:?}: the route never closed"));
        }
        h.tui.navigate(route);
        if !shows(1) {
            return Err(format!("{carrier:?} {row:?}: the route never showed again"));
        }
        if row.kind == Kind::Blur {
            focus();
        }
    }
    if racing {
        probe.hold(false);
    }
    let applied = || {
        let (now, last) = (ledger(), mounts().pop().unwrap_or_default());
        match row.kind {
            Kind::Overlay => now.overlays > before.overlays,
            Kind::Mode => now.modes > before.modes,
            Kind::Focus => last.focused.as_deref() == Some("n"),
            Kind::FocusField => last.focused.as_deref() == Some("fld"),
            Kind::Dialog => h.tui.dialogs.centered() && h.app.text().contains("probe pick"),
            Kind::Blur => last.focused.is_none(),
            Kind::Scroll => last.offsets.iter().any(|(id, offset)| id == "s" && *offset == 3),
            Kind::Transcript => moved.get() > 0,
            Kind::Fetch | Kind::Foreground | Kind::Timer => unreachable!("a request"),
        }
    };
    let outcome = expected(row);
    h.app.wait_until(support::WAIT, || {
        h.app.advance(Duration::from_millis(1));
        h.app.render();
        probe.asked().len() == 1 && applied() == (outcome == Outcome::Applied)
    });
    h.app.wait_until(Duration::from_millis(300), || {
        h.app.advance(Duration::from_millis(1));
        false
    });
    let (asked, did) = (probe.asked().len(), applied());
    let (now, last) = (ledger(), mounts());
    drop(probe);
    match asked == 1 && did == (outcome == Outcome::Applied) {
        true => Ok(()),
        false => Err(format!(
            "{carrier:?} {row:?}: expected {outcome:?}; asked {asked}, applied {did}, overlays {}, modes {}, mounts {last:?}",
            now.overlays - before.overlays,
            now.modes - before.modes,
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
    static SEEN: RefCell<Probed> = const { RefCell::new((Vec::new(), Vec::new())) };
    /// The overlay's begins and ends.
    static OTHER: RefCell<Vec<bool>> = const { RefCell::new(Vec::new()) };
}

type Probed = (Vec<Result<abi::RequestId, String>>, Vec<(abi::RequestId, String)>);

/// The plugin of a row, on its carrier, in its own harness.
enum Probe {
    Native(Harness),
    Pipe(Pipe, PathBuf),
    /// The Luau probe, which records what it saw in its storage.
    #[cfg(feature = "luau")]
    Luau(Harness),
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
        #[cfg(feature = "luau")]
        if carrier == Carrier::Luau {
            let harness = support::mount(80, 24, Deps { route: Route::Home, ..deps });
            let init = luau_script(row, mark);
            let sources = opencode_plugin::luau::Sources::from_files([
                ("plugin.toml", "id = \"test.probe\""),
                ("init.luau", &init),
            ]);
            let definition = opencode_plugin::luau::define(&sources, None).unwrap().0;
            opencode_tui::plugins::host::add(&harness.tui, definition);
            return Probe::Luau(harness);
        }
        ROW.set(Some(row));
        MARK.replace(mark.to_path_buf());
        SEEN.with_borrow_mut(|seen| *seen = Default::default());
        OTHER.with_borrow_mut(Vec::clear);
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
            #[cfg(feature = "luau")]
            Probe::Luau(harness) => harness,
        }
    }

    fn id(&self) -> &'static str {
        match self {
            Probe::Native(_) => "test.probe",
            Probe::Pipe(..) => "example.probe",
            #[cfg(feature = "luau")]
            Probe::Luau(_) => "test.probe",
        }
    }

    /// Holds what the JS host answers, or handles what it held; in process and over the C ABI nothing waits.
    fn hold(&self, held: bool) {
        if let Probe::Pipe(pipe, _) = self {
            pipe.scripts().hold_answers(held);
        }
    }

    /// The overlay's begins (`true`) and ends.
    fn other(&self) -> Vec<bool> {
        match self {
            Probe::Native(_) => OTHER.with_borrow(Vec::clone),
            Probe::Pipe(_, log) => lines(log)
                .iter()
                .filter_map(|line| line.strip_prefix("other "))
                .map(|mounted| mounted == "true")
                .collect(),
            #[cfg(feature = "luau")]
            Probe::Luau(harness) => luau_seen(harness, "other").iter().filter_map(serde_json::Value::as_bool).collect(),
        }
    }

    fn asked(&self) -> Vec<Option<u64>> {
        match self {
            Probe::Native(_) => {
                SEEN.with_borrow(|seen| seen.0.iter().map(|asked| asked.as_ref().ok().map(|id| id.0)).collect())
            }
            Probe::Pipe(_, log) => {
                lines(log).into_iter().filter(|line| line.starts_with("asked")).map(|_| None).collect()
            }
            // 0 names no request: an effect, or a request the host did not take.
            #[cfg(feature = "luau")]
            Probe::Luau(harness) => {
                luau_seen(harness, "asked").iter().map(|id| id.as_u64().filter(|id| *id != 0)).collect()
            }
        }
    }

    fn replies(&self) -> Vec<(Option<u64>, String)> {
        match self {
            Probe::Native(_) => {
                SEEN.with_borrow(|seen| seen.1.iter().map(|(id, reply)| (Some(id.0), reply.clone())).collect())
            }
            Probe::Pipe(_, log) => lines(log)
                .into_iter()
                .filter_map(|line| line.strip_prefix("settled ").map(|settled| (None, settled.to_owned())))
                .collect(),
            #[cfg(feature = "luau")]
            Probe::Luau(harness) => luau_seen(harness, "replies")
                .iter()
                .map(|reply| (reply["id"].as_u64(), reply["text"].as_str().unwrap_or_default().to_owned()))
                .collect(),
        }
    }

    /// Waits until the TypeScript fetch settled, or long enough to say it did not: how it settled.
    fn wait_settled(&self, h: &Harness) -> Vec<String> {
        h.app.wait_until(support::WAIT, || {
            h.app.advance(Duration::from_millis(1));
            !self.replies().is_empty()
        });
        self.replies().into_iter().map(|(_, settled)| settled).collect()
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
    // A mount's end asks as it closes: the route is going already. Navigating home again would race the driver's
    // reopening over the pipe, where it lands after it (bigboi's review of contract 2.x).
    if row.close == Close::BeforeDispatch && origin != Origin::MountEnd {
        host.navigate(abi::Route::Home);
    }
    let asked = match row.kind {
        Kind::Fetch => host.try_fetch(abi::Fetch::new("GET", "/api/hold")),
        Kind::Foreground => {
            let (command, args) = MARK.with_borrow(|mark| witness(mark));
            host.try_foreground(abi::Foreground::new(command).args(args))
        }
        Kind::Timer => host.try_timer(Duration::from_millis(20)),
        // An effect gets no ID: the call asked.
        Kind::Overlay => {
            let anchor = Anchor::Point { x: 0, y: 0 };
            host.overlay(Overlay { surface: "other".into(), anchor, width: 20, height: 1 });
            Err("asked".to_owned())
        }
        Kind::Mode => {
            host.set_mode(Some("probe"));
            Err("asked".to_owned())
        }
        Kind::Focus => {
            host.focus("n");
            Err("asked".to_owned())
        }
        Kind::FocusField => {
            host.focus("fld");
            Err("asked".to_owned())
        }
        Kind::Dialog => {
            let action = abi::Action::command("probe.global");
            let select = abi::Select::new("probe pick", vec![abi::SelectOption::new("one", "1")], action);
            host.dialog(abi::Dialog::Select(select.centered()));
            Err("asked".to_owned())
        }
        Kind::Blur => {
            host.blur();
            Err("asked".to_owned())
        }
        Kind::Scroll => {
            let target = v2::Target::Node { surface: "probe".into(), id: "s".into() };
            host.scroll(target, v2::Scroll::Offset { offset: 3 });
            Err("asked".to_owned())
        }
        Kind::Transcript => {
            host.scroll(v2::Target::Transcript, v2::Scroll::By { rows: 3 });
            Err("asked".to_owned())
        }
    };
    SEEN.with_borrow_mut(|seen| seen.0.push(asked));
    match row.close {
        Close::InFlight => host.navigate(abi::Route::Home),
        Close::Other => host.close_overlay("other"),
        _ => {}
    }
}

/// The probe: a route with its own command, a global command, a key of the mount, and the mount's begin and end, each
/// of which may ask, as the row says; and an overlay, another mount, which a global command opens.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    ask(setup.host(), Origin::Setup);
    let command = |name: &str, scope| abi::Command::new(name).scope(scope);
    setup.command(command("probe.global", abi::Scope::Global), |host, _| ask(host, Origin::Global));
    setup.command(command("probe.route", abi::Scope::Route("probe".into())), |host, _| ask(host, Origin::Route));
    setup.command(command("probe.overlay", abi::Scope::Global), |host, _| {
        host.overlay(Overlay { surface: "other".into(), anchor: Anchor::Point { x: 0, y: 0 }, width: 20, height: 1 });
    });
    setup.on_reply(|_, id, result| SEEN.with_borrow_mut(|seen| seen.1.push((id, format!("{result:?}")))));
    setup.on_cancelled(|_, id| SEEN.with_borrow_mut(|seen| seen.1.push((id, "cancelled".to_owned()))));
    let layer = Layer::default().scope(LayerScope::Global).keys(vec![Bind::new("x", "probe")]);
    let surface = v2::Surface::new("probe", v2::Place::Route("probe".into()), |_| page())
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
    let other = v2::Surface::new("other", v2::Place::Overlay("other".into()), |_| {
        v2::Node::text(vec![abi::Span::new("other overlay")])
    })
    .mounts()
    .on(|_, event| {
        if let Event::Mount { mounted, .. } = event {
            OTHER.with_borrow_mut(|other| other.push(*mounted));
        }
        Handled::Pass
    });
    setup.surface(other);
    Ok(())
}

/// The route's page: its text, a focusable node `n`, and a scroll `s` taller than its five rows.
fn page() -> v2::Node {
    let rows = (0..40).map(|row| v2::Node::text(vec![abi::Span::new(format!("row {row}"))])).collect();
    v2::Node::column(vec![
        v2::Node::text(vec![abi::Span::new("probe route")]),
        v2::Node::row(vec![v2::Node::text(vec![abi::Span::new("focusable")])])
            .with_id("n")
            .interact(Interact { focusable: true, ..Interact::default() }),
        v2::Node::scroll(rows).with_id("s").layout(abi::Layout::default().height(abi::Width::Cells(5))),
        v2::Node::input("").with_id("fld"),
    ])
}

/// The probe in TypeScript, on the raw carrier: the same calls, which log what the fetch settled with and what stayed
/// pending; its program is the Rust one's.
fn script(row: Row, log: &Path, mark: &Path) -> String {
    let (command, args) = witness(mark);
    let params = serde_json::json!([
        format!("{:?}", row.kind),
        format!("{:?}", row.origin),
        format!("{:?}", row.close),
        log.display().to_string(),
        command,
        args,
    ]);
    let page = serde_json::to_string(&page()).unwrap();
    format!(
        r#"import {{ appendFileSync }} from "node:fs"
const [KIND, ORIGIN, CLOSE, LOG, COMMAND, ARGS] = {params}
const PAGE = {page}
const log = (line) => appendFileSync(LOG, line + "\n")
export default {{ id: "example.probe", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  let asked = false
  const home = () => carrier.effect({{ type: "navigate", route: {{ type: "home" }} }})
  const ask = (origin) => {{
    if (origin !== ORIGIN || asked) return
    asked = true
    if (CLOSE === "BeforeDispatch" && origin !== "MountEnd") home()
    log("asked")
    if (KIND === "Fetch") {{
      carrier.fetch({{ method: "GET", path: "/api/hold" }}).then(
        (result) => log("settled " + Object.keys(result ?? {{}}).join(",") + " " + carrier.pendingFetches()),
        (error) => log("settled " + error.name + " " + carrier.pendingFetches()),
      )
    }} else if (KIND === "Foreground") carrier.effect({{ type: "foreground", command: COMMAND, args: ARGS }})
    else if (KIND === "Overlay") carrier.effect({{ type: "overlay", surface: "other", anchor: {{ point: {{ x: 0, y: 0 }} }}, width: 20, height: 1 }})
    else if (KIND === "Mode") carrier.effect({{ type: "set-mode", mode: "probe" }})
    else if (KIND === "Focus") carrier.effect({{ type: "focus", node: "n" }})
    else if (KIND === "FocusField") carrier.effect({{ type: "focus", node: "fld" }})
    else if (KIND === "Dialog") carrier.effect({{ type: "dialog", dialog: {{ type: "select", title: "probe pick", options: [{{ title: "one", value: "1" }}], action: {{ type: "command", name: "probe.global" }}, centered: true }} }})
    else if (KIND === "Blur") carrier.effect({{ type: "blur" }})
    else if (KIND === "Transcript") carrier.effect({{ type: "scroll", target: {{ type: "transcript" }}, verb: {{ type: "by", rows: 3 }} }})
    else carrier.effect({{ type: "scroll", target: {{ type: "node", surface: "probe", id: "s" }}, verb: {{ type: "offset", offset: 3 }} }})
    if (CLOSE === "InFlight") home()
    if (CLOSE === "Other") carrier.effect({{ type: "close-overlay", surface: "other" }})
  }}
  ask("Setup")
  carrier.surface("probe", {{ type: "route", name: "probe" }}, () => PAGE, {{
    mounts: true,
    layers: [{{ scope: "global", keys: [{{ key: "x", name: "probe" }}] }}],
    on: (event) => {{
      if (event.type === "mount") ask(event.mounted ? "MountBegin" : "MountEnd")
      if (event.type === "key" && event.bind === "probe") ask("Input")
    }},
  }})
  carrier.surface("other", {{ type: "overlay", name: "other" }}, () => ({{ type: "text", spans: [{{ text: "other overlay" }}] }}), {{
    mounts: true,
    on: (event) => {{
      if (event.type === "mount") log("other " + event.mounted)
    }},
  }})
  carrier.command({{ name: "probe.route", title: "probe.route", scope: {{ route: "probe" }} }}, () => ask("Route"))
  carrier.command({{ name: "probe.global", title: "probe.global" }}, () => ask("Global"))
  carrier.command({{ name: "probe.overlay", title: "probe.overlay" }}, () =>
    carrier.effect({{ type: "overlay", surface: "other", anchor: {{ point: {{ x: 0, y: 0 }} }}, width: 20, height: 1 }}),
  )
}} }}
"#
    )
}

/// What the Luau probe recorded under `field` of its storage.
#[cfg(feature = "luau")]
fn luau_seen(harness: &Harness, field: &str) -> Vec<serde_json::Value> {
    let stored = opencode_plugin::Host::storage_read(&*harness.tui, "plugin.test.probe.seen");
    let seen: serde_json::Value = stored.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default();
    seen[field].as_array().cloned().unwrap_or_default()
}

/// A JSON value as a Luau literal.
#[cfg(feature = "luau")]
fn luau_literal(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "nil".to_owned(),
        serde_json::Value::Bool(value) => value.to_string(),
        serde_json::Value::Number(value) => value.to_string(),
        serde_json::Value::String(value) => format!("{value:?}"),
        serde_json::Value::Array(items) => {
            format!("{{ {} }}", items.iter().map(luau_literal).collect::<Vec<_>>().join(", "))
        }
        serde_json::Value::Object(fields) => format!(
            "{{ {} }}",
            fields
                .iter()
                .map(|(key, value)| format!("[{key:?}] = {}", luau_literal(value)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
    }
}

/// The probe in Luau: the same calls as the Rust one, which record in its storage what the calls got and what the
/// replies said; its program is the Rust one's.
#[cfg(feature = "luau")]
fn luau_script(row: Row, mark: &Path) -> String {
    let (command, args) = witness(mark);
    let (kind, origin, close) = (format!("{:?}", row.kind), format!("{:?}", row.origin), format!("{:?}", row.close));
    let page = luau_literal(&serde_json::to_value(page()).unwrap());
    let args = luau_literal(&serde_json::json!(args));
    format!(
        r#"local plugin = require("@opencode/plugin")
local KIND, ORIGIN, CLOSE = {kind:?}, {origin:?}, {close:?}
local COMMAND, ARGS = {command:?}, {args}
local PAGE = {page}
local OTHER = {{ surface = "other", anchor = {{ point = {{ x = 0, y = 0 }} }}, width = 20, height = 1 }}
local function record(host, field, value)
    local seen = host:storageGet("seen") or {{}}
    seen[field] = seen[field] or {{}}
    table.insert(seen[field], value)
    host:storageSet("seen", seen)
end
local function describe(value, error)
    if error then return "Err(" .. error .. ")" end
    local parts = {{}}
    if type(value) == "table" then
        for key, item in value do table.insert(parts, tostring(key) .. "=" .. tostring(item)) end
    end
    table.sort(parts)
    return "Ok(" .. table.concat(parts, ",") .. ")"
end
local asked = false
local function ask(host, origin)
    if origin ~= ORIGIN or asked then return end
    asked = true
    if CLOSE == "BeforeDispatch" and origin ~= "MountEnd" then host:navigate({{ type = "home" }}) end
    -- A request waits in a task of its own, started in this call, so the request is this call's. A task gets no
    -- request ID: 1 names the one it waits on, 0 a request the host did not take.
    local id
    if KIND == "Fetch" or KIND == "Foreground" or KIND == "Timer" then
        local returned = false
        plugin.spawn(function()
            local value, error
            if KIND == "Fetch" then value, error = host:fetch({{ method = "GET", path = "/api/hold" }})
            elseif KIND == "Timer" then value, error = plugin.sleep(20)
            else value, error = host:foreground({{ command = COMMAND, args = ARGS }}) end
            returned = true
            if id == 1 then record(host, "replies", {{ id = 1, text = describe(value, error) }}) end
        end)
        id = if returned then 0 else 1
    elseif KIND == "Overlay" then host:overlay(OTHER)
    elseif KIND == "Mode" then host:setMode("probe")
    elseif KIND == "Focus" then host:focus("n")
    elseif KIND == "FocusField" then host:focus("fld")
    elseif KIND == "Dialog" then
        host:dialog({{ type = "select", title = "probe pick", options = {{ {{ title = "one", value = "1" }} }},
            action = {{ type = "command", name = "probe.global" }}, centered = true }})
    elseif KIND == "Blur" then host:blur()
    elseif KIND == "Scroll" then host:scroll({{ type = "node", surface = "probe", id = "s" }}, {{ type = "offset", offset = 3 }})
    else host:scroll({{ type = "transcript" }}, {{ type = "by", rows = 3 }}) end
    record(host, "asked", id or 0)
    if CLOSE == "InFlight" then host:navigate({{ type = "home" }})
    elseif CLOSE == "Other" then host:closeOverlay("other") end
end
return plugin.define(function(setup)
    setup:storageKey("seen")
    setup.host:storageSet("seen", {{ asked = {{}}, replies = {{}}, other = {{}} }})
    ask(setup.host, "Setup")
    setup:command({{ name = "probe.global" }}, function(host) ask(host, "Global") end)
    setup:command({{ name = "probe.route", scope = {{ route = "probe" }} }}, function(host) ask(host, "Route") end)
    setup:command({{ name = "probe.overlay" }}, function(host) host:overlay(OTHER) end)
    local layer = {{ scope = "global", keys = {{ {{ key = "x", name = "probe" }} }} }}
    setup:surface({{ name = "probe", place = {{ type = "route", name = "probe" }}, mounts = true, layers = {{ layer }} }},
        function() return PAGE end,
        function(host, event)
            if event.type == "mount" then
                ask(host, if event.mounted then "MountBegin" else "MountEnd")
                return "pass"
            end
            if event.type == "key" and event.bind == "probe" then
                ask(host, "Input")
                return "consume"
            end
            return "pass"
        end)
    setup:surface({{ name = "other", place = {{ type = "overlay", name = "other" }}, mounts = true }},
        function() return {{ type = "text", spans = {{ {{ text = "other overlay" }} }} }} end,
        function(host, event)
            if event.type == "mount" then record(host, "other", event.mounted) end
            return "pass"
        end)
end)
"#
    )
}
