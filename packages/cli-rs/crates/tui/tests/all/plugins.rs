//! Run linked plugins in a real TUI and exercise rendering, effects, faults, and storage.

use crate::support::{self, Fake, Harness};

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

fn fake(text: String) -> Fake {
    Fake::new(move |seen| match seen.path.as_str() {
        "/api/session" => (200, json!({ "data": [], "cursor": {} })),
        "/api/session/ses_p" => (200, json!({ "data": session() })),
        "/api/session/ses_p/message" => (200, json!({ "data": messages(&text), "cursor": {} })),
        "/api/session/ses_p/permission" => (200, json!({ "data": [] })),
        _ => support::not_found(),
    })
}

fn session() -> Value {
    support::merge(support::session("ses_p", "Plugins"), json!({ "agent": "build" }))
}

/// Newest first, as the server pages them.
fn messages(text: &str) -> Value {
    json!([
        {
            "id": "msg_2", "type": "assistant", "agent": "build",
            "model": { "providerID": "provider", "id": "model" },
            "time": { "created": 1500, "completed": 4000, "streamed": 3000 },
            "finish": "stop",
            "tokens": { "input": 1, "output": 1, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
            "content": [{ "type": "text", "text": text }],
        },
        { "id": "msg_1", "type": "user", "text": "Show me", "time": { "created": 1000 } },
    ])
}

/// Probe the order of command dispatch, storage updates, and claim renders.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("seen");
    setup.storage_key("step");
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("probe.act"), |host, _| {
        host.dispatch("probe.first", None);
        host.storage_set("seen", json!({ "tick": 1 }));
    });
    setup.command(command("probe.first"), |host, _| host.storage_set("step", json!({ "ran": true })));
    let renders = RefCell::new(Vec::new());
    setup.slot(abi::Placement::append("home.footer"), move |read, _, changed| {
        if changed.local && read.storage_get("seen").is_some() {
            renders.borrow_mut().push(read.storage_get("step").is_some_and(|step| step["ran"] == true));
        }
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("probe renders {:?}", renders.borrow()))]))
    });
    Ok(())
}

/// The TUI's home with `setup` active.
fn home_with(setup: fn(&mut abi::Setup) -> Result<(), String>, deps: Deps) -> Harness {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..deps });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "probe", setup }.into());
    h
}

#[test]
fn a_dispatch_and_a_storage_write_reach_the_claims_in_call_order() {
    let h = home_with(probe, support::deps(Arc::new(fake(String::new()))));
    h.wait_for("probe renders []");
    h.tui.keymap.dispatch("probe.act", None);
    h.wait_for("probe renders [true]");
    h.app.wait_until(Duration::from_millis(100), || false);
    let screen = h.wait_for("probe renders [true]");
    assert!(!screen.contains("false"), "{screen}");
}

thread_local! {
    static CHAINED: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
}

pub(crate) fn chain(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("chain.self"), |host, _| {
        CHAINED.set((CHAINED.get().0 + 1, CHAINED.get().1));
        host.dispatch("chain.self", None);
    });
    setup.command(command("chain.fan"), |host, _| {
        CHAINED.set((CHAINED.get().0, CHAINED.get().1 + 1));
        host.dispatch("chain.fan", None);
        host.dispatch("chain.fan", None);
        host.copy("x", Some(abi::Action::command("chain.fan")));
    });
    setup.slot(abi::Placement::append("home.footer"), |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new("chain ready")]))
    });
    Ok(())
}

#[test]
fn a_chain_of_dispatches_never_holds_the_ui_thread() {
    let h = home_with(chain, support::deps(Arc::new(fake(String::new()))));
    h.wait_for("chain ready");
    CHAINED.set((0, 0));
    h.tui.keymap.dispatch("chain.self", None);
    h.app.advance(Duration::from_millis(16));
    let ran = CHAINED.get().0;
    assert!((2..=100).contains(&ran), "the chain ran {ran} times");
    h.app.advance(Duration::from_millis(16));
    assert_eq!(CHAINED.get().0, ran, "the chain went on");
    h.tui.keymap.dispatch("chain.fan", None);
    h.app.advance(Duration::from_millis(16));
    let first = CHAINED.get().1;
    let budget = opencode_plugin::FRAME_EFFECTS;
    assert!((2..=budget).contains(&first), "{first} ran before the first paint");
    // The rest waits for the next paint, and runs just after it, one budget (frame-effects).
    h.app.advance(Duration::from_millis(16));
    assert_eq!(CHAINED.get().1, first, "more ran with no paint");
    h.app.render();
    assert_eq!(CHAINED.get().1, first, "the paint ran more than its budget");
    h.app.advance(Duration::ZERO);
    let second = CHAINED.get().1;
    assert!(second > first && second - first <= budget, "{first} then {second}");
    // One processed item enqueues two; the queue must stop growing at its bound.
    for _ in 0..80 {
        h.app.render();
        h.app.advance(Duration::ZERO);
    }
    let waiting = opencode_plugin::effects_waiting();
    assert!((60_000..=1 << 16).contains(&waiting), "{waiting} effects wait");
    h.app.type_text("still here");
    h.wait_for("still here");
    h.tui.plugins.deactivate_all();
    h.app.advance(Duration::from_millis(16));
}

thread_local! {
    static FETCHES: RefCell<Fetches> = const { RefCell::new((Vec::new(), Vec::new())) };
}

type Fetches = (Vec<Result<abi::RequestId, String>>, Vec<abi::RequestId>);

fn fetcher(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("fetcher.go"), |host, _| {
        let fetch = abi::Fetch::new("GET", "/api/session");
        let id = host.try_fetch(fetch);
        FETCHES.with_borrow_mut(|fetches| fetches.0.push(id));
    });
    setup.on_reply(|_, id, _| FETCHES.with_borrow_mut(|fetches| fetches.1.push(id)));
    Ok(())
}

#[test]
fn a_fetch_given_an_id_gets_its_reply_under_queue_pressure() {
    let h = home_with(chain, support::deps(Arc::new(fake(String::new()))));
    let host = opencode_tui::plugins::host::host(&h.tui);
    let definition = abi::Plugin { id: "fetcher", setup: fetcher }.into();
    opencode_tui::plugins::host::add(&h.tui, definition);
    h.wait_for("chain ready");
    FETCHES.with_borrow_mut(|fetches| *fetches = Default::default());
    h.tui.keymap.dispatch("chain.fan", None);
    for _ in 0..80 {
        h.app.render();
        h.app.advance(Duration::ZERO);
    }
    assert!(opencode_plugin::effects_waiting() >= 60_000, "the queue is not under pressure");
    h.tui.keymap.dispatch("fetcher.go", None);
    let under = FETCHES.with_borrow(|fetches| fetches.0.clone());
    let refused = matches!(&under[..], [Err(error)] if error.contains("the effects that wait fill its queue"));
    assert!(refused, "a fetch with no room returned {under:?}");
    // The fan-out ends, the queue drains, and a fetch with room is given an ID and its reply.
    h.tui.plugins.set_active(&host, "probe", false);
    // A frame runs its budget of what waits: the drain is so many frames, however long each takes under load
    // (pipe-flakes: it outlasted the 30 s of a wait under load).
    let waiting = opencode_plugin::effects_waiting();
    // Each paint runs nothing past its budget; the rest comes due just after it.
    for _ in 0..waiting.div_ceil(opencode_plugin::FRAME_EFFECTS) {
        h.app.render();
        h.app.advance(Duration::ZERO);
    }
    let left = opencode_plugin::effects_waiting();
    assert_eq!(left, 0, "the queue did not drain within a frame for each budget of {waiting}");
    h.tui.keymap.dispatch("fetcher.go", None);
    let replied = h.app.wait_until(support::WAIT, || {
        let (given, replies) = FETCHES.with_borrow(|fetches| fetches.clone());
        given.iter().flatten().all(|id| replies.contains(id))
    });
    let (given, replies) = FETCHES.with_borrow(|fetches| fetches.clone());
    assert!(replied && given.len() == 2 && given[1].is_ok(), "{given:?} {replies:?}");
    h.tui.plugins.deactivate_all();
    h.app.advance(Duration::from_millis(16));
}

thread_local! {
    static BURST: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
}

/// `burst.go` dispatches `burst.hit` 3,000 times in one call. A press on `PAD` opens the overlay `ring` twice, and the
/// pad opens it again each time it hears one closed: each open replaces the one before, which tells the pad it closed.
fn burst(setup: &mut abi::Setup) -> Result<(), String> {
    use abi::interact::{Anchor, Event, Handled, Interact, Overlay, PointerKind};
    let command = |name: &str| abi::Command::new(name);
    let ring = || Overlay { surface: "ring".into(), anchor: Anchor::Point { x: 2, y: 2 }, width: 10, height: 1 };
    setup.command(command("burst.go"), |host, _| (0..3000).for_each(|_| host.dispatch("burst.hit", None)));
    setup.command(command("burst.hit"), |_, _| BURST.set((BURST.get().0 + 1, BURST.get().1)));
    setup.surface(abi::v2::Surface::new("ring", abi::v2::Place::Overlay("ring".into()), |_| {
        abi::v2::Node::text(vec![abi::Span::new("RING")])
    }));
    let pad = |_: &mut abi::v2::View<'_>| {
        let interact = Interact { pointer: true, ..Interact::default() };
        abi::v2::Node::row(vec![abi::v2::Node::text(vec![abi::Span::new("burst ready PAD")])])
            .with_id("pad")
            .interact(interact)
    };
    setup.surface(abi::v2::Surface::new("pad", abi::v2::Place::Slot(abi::Placement::append("home.footer")), pad).on(
        move |host, event| {
            match event {
                // The second replaces the first, which tells the pad it closed.
                Event::Pointer(pointer) if pointer.kind == PointerKind::Down => {
                    host.overlay(ring());
                    host.overlay(ring());
                }
                Event::Closed { .. } => {
                    BURST.set((BURST.get().0, BURST.get().1 + 1));
                    host.overlay(ring());
                }
                _ => {}
            }
            Handled::Consume
        },
    ));
    Ok(())
}

#[test]
fn one_call_of_many_effects_and_a_chain_of_closes_are_bounded() {
    let h = home_with(burst, support::deps(Arc::new(fake(String::new()))));
    h.wait_for("burst ready");
    BURST.set((0, 0));
    h.tui.keymap.dispatch("burst.go", None);
    h.app.advance(Duration::from_millis(16));
    let first = BURST.get().0;
    assert!((1..=1024).contains(&first), "{first} ran before the first paint");
    while BURST.get().0 < 3000 {
        let before = BURST.get().0;
        h.app.render();
        h.app.advance(Duration::ZERO);
        let ran = BURST.get().0 - before;
        assert!(ran > 0, "stuck at {before}");
        assert!(ran <= opencode_plugin::FRAME_EFFECTS, "{ran} ran in one frame");
    }
    assert_eq!(BURST.get().0, 3000);
    let (x, y) = h.find("PAD");
    h.app.click(x, y);
    for _ in 0..4 {
        h.app.advance(Duration::from_millis(16));
        h.app.render();
    }
    let closes = BURST.get().1;
    assert!((2..=100).contains(&closes), "the overlay closed {closes} times");
    h.app.render();
    assert_eq!(BURST.get().1, closes, "the chain went on");
    h.tui.plugins.deactivate_all();
    h.app.advance(Duration::from_millis(16));
}

fn updates(setup: &mut abi::Setup) -> Result<(), String> {
    let seen = Rc::new(Cell::new(0));
    let counted = seen.clone();
    setup.on_event(&["rpc.example.updated"], move |_, _| counted.set(counted.get() + 1));
    setup.slot(abi::Placement::append("home.footer"), move |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("updates {}", seen.get()))]))
    });
    Ok(())
}

#[test]
fn an_event_handler_renders_its_plugins_claims_again() {
    let memory = opencode_api::memory::Memory::new(vec![opencode_api::memory::Route::json(
        "GET",
        "/api/session",
        200,
        &json!({ "data": [], "cursor": {} }),
    )]);
    let deps = Deps { events: true, ..support::deps(Arc::new(memory.clone())) };
    let h = home_with(updates, deps);
    h.wait_for("updates 0");
    memory.emit(&json!({
        "id": "evt_rpc", "created": 1, "type": "rpc.example.updated",
        "location": { "directory": support::DIRECTORY }, "data": {},
    }));
    h.wait_for("updates 1");
}

thread_local! {
    /// The version the `exiting` plugin's dispose callback read from the host.
    static DISPOSED_WITH: RefCell<Option<String>> = const { RefCell::new(None) };
}

/// Records, as it is disposed, the version the host reports.
fn exiting(setup: &mut abi::Setup) -> Result<(), String> {
    setup.on_dispose(|host| DISPOSED_WITH.set(Some(host.info().version)));
    Ok(())
}

#[test]
fn the_tui_disposes_its_plugins_as_it_exits() {
    let options = opentui::AppOptions { exit_on_ctrl_c: false, ..opentui::AppOptions::default() };
    let app = opentui::App::headless(opentui::app::HeadlessOptions { width: 80, height: 24, app: options }).unwrap();
    let launch = opencode_tui::app::Launch {
        deps: Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) },
        args: opencode_tui::Args { version: "9.9.9".to_owned(), ..opencode_tui::Args::default() },
        keep: Box::new(()),
        plugins: None,
    };
    opencode_tui::app::run_on(app, launch, |tui| {
        opencode_tui::plugins::host::add(tui, abi::Plugin { id: "exiting", setup: exiting }.into());
        tui.app.quit();
        Ok(())
    })
    .unwrap();
    assert_eq!(DISPOSED_WITH.take().as_deref(), Some("9.9.9"));
}

thread_local! {
    static RAN: RefCell<Option<Result<Value, String>>> = const { RefCell::new(None) };
}

fn running(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("x.run"), |host, _| {
        let _ = host.try_foreground(abi::Foreground { command: "true".into(), ..abi::Foreground::default() });
    });
    setup.on_reply(|_, _, result| RAN.set(Some(result)));
    Ok(())
}

#[test]
fn a_headless_tui_refuses_a_program_in_the_foreground() {
    let options = opentui::AppOptions { exit_on_ctrl_c: false, ..opentui::AppOptions::default() };
    let app = opentui::App::headless(opentui::app::HeadlessOptions { width: 80, height: 24, app: options }).unwrap();
    let launch = opencode_tui::app::Launch {
        deps: Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) },
        args: opencode_tui::Args::default(),
        keep: Box::new(()),
        plugins: None,
    };
    opencode_tui::app::run_on(app, launch, |tui| {
        opencode_tui::plugins::host::add(tui, abi::Plugin { id: "running", setup: running }.into());
        tui.keymap.dispatch("x.run", None);
        let app = tui.app.clone();
        tui.app.set_timeout(Duration::from_millis(200), move |_| app.quit());
        Ok(())
    })
    .unwrap();
    let ran = RAN.take().expect("the plugin got no reply");
    assert!(ran.as_ref().is_err_and(|error| error.contains("headless")), "{ran:?}");
}

/// Stores `{"saved":true}` as it is disposed, then creates the file `OPENCODE_TEST_DISPOSED` names.
fn saving(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("state");
    setup.on_dispose(|host| {
        host.storage_set("state", json!({ "saved": true }));
        std::fs::write(std::env::var_os("OPENCODE_TEST_DISPOSED").unwrap(), "").unwrap();
    });
    Ok(())
}

/// The child of [`a_storage_write_made_on_exit_reaches_the_disk`]: runs the TUI with storage under
/// `OPENCODE_TEST_HOME` until it quits.
#[test]
#[ignore = "run by a_storage_write_made_on_exit_reaches_the_disk"]
fn exit_with_a_saving_plugin() {
    let home = std::path::PathBuf::from(std::env::var_os("OPENCODE_TEST_HOME").unwrap());
    let options = opentui::AppOptions { exit_on_ctrl_c: false, ..opentui::AppOptions::default() };
    let app = opentui::App::headless(opentui::app::HeadlessOptions { width: 80, height: 24, app: options }).unwrap();
    let launch = opencode_tui::app::Launch {
        deps: Deps {
            route: Route::Home,
            roots: support::roots(support::home_paths(&home), "test"),
            ..support::deps(Arc::new(support::empty()))
        },
        args: opencode_tui::Args::default(),
        keep: Box::new(()),
        plugins: None,
    };
    opencode_tui::app::run_on(app, launch, |tui| {
        opencode_tui::plugins::host::add(tui, abi::Plugin { id: "saving", setup: saving }.into());
        tui.app.quit();
        Ok(())
    })
    .unwrap();
}

#[test]
fn a_storage_write_made_on_exit_reaches_the_disk() {
    let root = opencode_util::temp::tempdir().unwrap();
    let home = root.path().join("home");
    let disposed = root.path().join("disposed");
    let storage = opencode_local::storage::Storage::new(&support::home_paths(&home).state, "test").unwrap();
    let mut child = None;
    storage
        .update("plugin.saving.state", &json!({}), |_| {
            let spawned = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "plugins::exit_with_a_saving_plugin", "--ignored", "--test-threads=1"])
                .env("OPENCODE_TEST_HOME", &home)
                .env("OPENCODE_TEST_DISPOSED", &disposed)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            child = Some(spawned);
            let start = std::time::Instant::now();
            while !disposed.exists() && start.elapsed() < Duration::from_secs(30) {
                std::thread::sleep(Duration::from_millis(10));
            }
            // Holding the lock a while longer lets a child that does not wait exit first.
            std::thread::sleep(Duration::from_millis(300));
        })
        .unwrap();
    let output = child.unwrap().wait_with_output().unwrap();
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success() && stdout.contains("1 passed"),
        "{stdout}{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(storage.load("plugin.saving.state", &Value::Null).unwrap(), json!({ "saved": true }));
}

thread_local! {
    static TRAPPED: Cell<usize> = const { Cell::new(0) };
}

fn trap(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name);
    setup.command(command("trap.hit"), |_, _| TRAPPED.set(TRAPPED.get() + 1));
    setup.command(command("trap.panel"), |host, _| {
        let hit = || abi::Action::command("trap.hit");
        let binds =
            ["escape", "Ctrl+C", "ESC", "", "g esc", "x, ctrl+c", "esc<", "esc<leader>", "<leader>esc", "ctrl+e"]
                .map(|key| abi::PanelBind { key: key.to_owned(), title: format!("bind {key}"), action: hit() });
        host.dialog(abi::Dialog::Panel(
            abi::Panel::new(
                "trap".to_owned(),
                vec![abi::Span::new("trap panel")],
                abi::Node::text([abi::Span::new("")]),
            )
            .binds(binds),
        ));
    });
    Ok(())
}

#[test]
fn a_panel_cannot_take_the_keys_that_close_it() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "trap", setup: trap }.into());
    for close in ["escape", "ctrl+c"] {
        h.tui.keymap.dispatch("trap.panel", None);
        h.wait_for("trap panel");
        h.app.press("ctrl+e");
        h.app.render();
        assert_eq!(TRAPPED.replace(0), 1, "ctrl+e is bound");
        h.app.press(close);
        h.app.advance(Duration::from_millis(100));
        h.app.render();
        assert_eq!(TRAPPED.get(), 0, "{close} ran a bind");
        assert!(!h.tui.dialogs.is_open(), "{close} closes the panel");
    }
}

thread_local! {
    static ASKED: RefCell<Option<String>> = const { RefCell::new(None) };
}

fn asks(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("asks.named"), |_, input| ASKED.set(input.map(str::to_owned)));
    setup.command(abi::Command::new("asks.prompt"), |host, _| {
        let lines: Vec<String> = (0..20).map(|line| format!("line {line}")).collect();
        let prompt = abi::Prompt::new("Asks prompt", abi::Action::command("asks.named"))
            .value("Old title\r\nmore\n")
            .description(lines.join("\n"));
        host.dialog(abi::Dialog::Prompt(prompt));
    });
    Ok(())
}

#[test]
fn a_plugin_prompt_shows_its_value_on_one_line_under_a_bounded_description() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "asks", setup: asks }.into());
    h.tui.keymap.dispatch("asks.prompt", None);
    h.wait_for("Asks prompt");
    let text = h.app.text();
    assert!(text.contains("Old title more") && text.contains("line 7"), "{text}");
    assert!(!text.contains("line 8"), "the description is over eight rows:\n{text}");
    h.app.press("return");
    h.app.render();
    assert_eq!(ASKED.take().as_deref(), Some("Old title more"));
}

fn chatty(setup: &mut abi::Setup) -> Result<(), String> {
    setup.on_plugins(|host| host.toast(abi::Toast::new(abi::Variant::Info, "plugins changed")));
    setup.command(abi::Command::new("chatty.burst"), |host, _| {
        (0..6).for_each(|index| host.toast(abi::Toast::new(abi::Variant::Info, format!("chat {index}"))));
    });
    Ok(())
}

/// `boomer.panic` panics.
fn boomer(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("boomer.panic"), |_, _| -> () { panic!("boom") });
    Ok(())
}

/// `second.panic` panics.
fn second(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("second.panic"), |_, _| -> () { panic!("boom") });
    Ok(())
}

#[test]
fn a_second_failure_goes_ahead_of_the_plugin_toasts_that_wait() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    for (id, setup) in [("chatty", chatty as fn(&mut abi::Setup) -> _), ("boomer", boomer), ("second", second)] {
        opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id, setup }.into());
    }
    h.app.render();
    let title = |h: &Harness| h.tui.toasts.current().map(|toast| toast.title.unwrap_or(toast.message));
    h.tui.keymap.dispatch("boomer.panic", None);
    h.wait_for("Plugin failed: boomer");
    h.tui.keymap.dispatch("chatty.burst", None);
    h.app.advance(Duration::from_millis(100));
    assert_eq!(title(&h).as_deref(), Some("Plugin failed: boomer"));
    h.tui.keymap.dispatch("second.panic", None);
    h.wait_for("Plugin failed: second");
    let mut shown = Vec::new();
    while let Some(next) = title(&h) {
        shown.push(next);
        h.tui.toasts.dismiss();
    }
    // `plugins changed` is chatty's toast of each failure, which waits as the burst does: of the seven that waited, the
    // first failure's and `chat 0` to `chat 2` went.
    assert_eq!(shown, ["Plugin failed: second", "chat 3", "chat 4", "chat 5", "plugins changed"]);
    assert_eq!(opencode_ui::toast::PLUGIN_WAITING, 4);
    // A plugin's toast that comes while another's shows and more wait takes its turn behind them.
    h.tui.toasts.show(opencode_ui::toast::ToastOptions::new(opencode_ui::toast::Variant::Info, "host").keep());
    h.tui.keymap.dispatch("chatty.burst", None);
    h.app.advance(Duration::from_millis(1));
    h.tui.toasts.dismiss();
    h.tui.toasts.show_behind_kept(opencode_ui::toast::ToastOptions::new(opencode_ui::toast::Variant::Info, "late"));
    assert_eq!(title(&h).as_deref(), Some("chat 2"));
}

#[test]
fn a_plugin_toast_never_hides_the_report_of_a_failure() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "chatty", setup: chatty }.into());
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "boomer", setup: boomer }.into());
    h.app.render();
    while h.tui.toasts.current().is_some() {
        h.tui.toasts.dismiss();
    }
    h.tui.keymap.dispatch("boomer.panic", None);
    h.wait_for("Plugin failed: boomer");
    h.app.advance(Duration::from_millis(500));
    let screen = h.wait_for("Plugin failed: boomer");
    assert!(!screen.contains("plugins changed"), "{screen}");
    assert!(h.tui.toasts.pending() > 0, "the plugin's toast waits behind it");
    h.app.advance(opencode_ui::toast::DEFAULT_DURATION);
    h.wait_for("plugins changed");
}

fn paneled<const SUB: bool>(setup: &mut abi::Setup) -> Result<(), String> {
    let id = if SUB { "owner/sub" } else { "owner" };
    let command = |name: String| abi::Command::new(name);
    setup.command(command(format!("{id}.panel")), move |host, _| {
        host.dialog(abi::Dialog::Panel(
            abi::Panel::new(
                "panel".to_owned(),
                vec![abi::Span::new(format!("{id} panel"))],
                abi::Node::text([abi::Span::new("body")]),
            )
            .size(abi::PanelSize::Medium),
        ));
    });
    setup
        .command(command(format!("{id}.close")), |host, _| host.dialog(abi::Dialog::Close { key: "panel".to_owned() }));
    Ok(())
}

#[test]
fn a_plugin_ends_only_its_own_dialog() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "owner", setup: paneled::<false> }.into());
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "owner/sub", setup: paneled::<true> }.into());
    h.tui.keymap.dispatch("owner/sub.panel", None);
    h.wait_for("owner/sub panel");
    opencode_plugin::Host::revoked(&*h.tui, "owner/sub");
    h.app.render();
    assert_eq!(h.tui.dialogs.key().as_deref(), Some("owner/sub/panel"));
    h.tui.keymap.dispatch("owner.close", None);
    h.app.render();
    assert_eq!(h.tui.dialogs.key().as_deref(), Some("owner/sub/panel"));
    h.tui.plugins.toggle(&opencode_tui::plugins::host::host(&h.tui), "owner", false);
    h.app.render();
    assert_eq!(h.tui.dialogs.key().as_deref(), Some("owner/sub/panel"));
    h.tui.keymap.dispatch("owner/sub.close", None);
    h.app.render();
    assert_eq!(h.tui.dialogs.key(), None);
}

thread_local! {
    static SHIFT: Cell<u8> = const { Cell::new(0) };
}

fn shifting(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(abi::Command::new("shifting.panel"), |host, _| {
        let stage = SHIFT.get();
        let action = abi::PanelAction {
            title: "Apply".to_owned(),
            key: Some("a".to_owned()),
            color: None,
            close: false,
            action: abi::Action::command("shifting.panel"),
        };
        let panel = abi::Panel::new(
            "panel".to_owned(),
            vec![abi::Span::new("Shifting title")],
            abi::Node::text([abi::Span::new("shifting body")]),
        )
        .size(abi::PanelSize::Medium)
        .height(4)
        .actions(if stage >= 1 { vec![action] } else { Vec::new() })
        .when(stage >= 2, abi::Panel::bare);
        host.dialog(abi::Dialog::Panel(panel));
    });
    Ok(())
}

#[test]
fn a_panel_shown_again_under_its_key_takes_its_footer_and_bareness() {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: "shifting", setup: shifting }.into());
    SHIFT.set(0);
    h.tui.keymap.dispatch("shifting.panel", None);
    let screen = h.wait_for("shifting body");
    assert!(screen.contains("Shifting title") && !screen.contains("Apply"), "{screen}");
    SHIFT.set(1);
    h.tui.keymap.dispatch("shifting.panel", None);
    let screen = h.wait_for("Apply");
    assert!(screen.contains("Shifting title"), "{screen}");
    SHIFT.set(2);
    h.tui.keymap.dispatch("shifting.panel", None);
    h.wait_gone("Shifting title");
    let screen = h.wait_for("shifting body");
    assert!(!screen.contains("Apply"), "{screen}");
}

thread_local! {
    /// What `acme` and `acme.cloud` read of their keys, in order.
    static STORED: RefCell<Vec<(&'static str, Option<Value>)>> = const { RefCell::new(Vec::new()) };
}

fn named(name: &str) -> abi::Command {
    abi::Command::new(name)
}

fn acme(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("cloud.token");
    setup.command(named("acme.read"), |host, _| {
        STORED.with_borrow_mut(|read| read.push(("acme", host.storage_get("cloud.token"))))
    });
    setup.command(named("acme.merge"), |host, _| {
        host.storage_merge("cloud.token", serde_json::Map::from_iter([("m".to_owned(), json!(1))]));
    });
    Ok(())
}

fn cloud(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("token");
    setup.command(named("cloud.read"), |host, _| {
        STORED.with_borrow_mut(|read| read.push(("cloud", host.storage_get("token"))))
    });
    setup.command(named("cloud.set"), |host, _| host.storage_set("token", json!({ "other": 2 })));
    Ok(())
}

#[test]
fn storage_keys_of_dotted_ids_and_keys_keep_apart() {
    let root = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(&root.path().join("home"));
    let storage = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
    storage.update("plugin.acme.cloud.token", &json!({}), |value| *value = json!({ "legacy": true })).unwrap();
    STORED.with_borrow_mut(Vec::clear);
    let deps = Deps {
        route: Route::Home,
        roots: support::roots(paths, "test"),
        builtins: vec![
            opencode_plugin::abi::Plugin { id: "acme", setup: acme }.into(),
            opencode_plugin::abi::Plugin { id: "acme.cloud", setup: cloud }.into(),
        ],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
    let run = |command: &str| {
        harness.tui.keymap.dispatch(command, None);
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    };
    // `acme`'s `cloud.token` never reads `acme.cloud`'s `token`: not what TS kept under that name, nor what it
    // writes, before or after `acme` writes its own.
    let order = ["acme.read", "cloud.read", "cloud.set", "acme.read", "acme.merge", "acme.read", "cloud.read"];
    for command in order {
        run(command);
    }
    opencode_tui::plugins::host::flush_storage(&harness.tui);
    let own = json!({ "m": 1 });
    let other = json!({ "other": 2 });
    assert_eq!(
        STORED.take(),
        [
            ("acme", None),
            ("cloud", Some(json!({ "legacy": true }))),
            ("acme", None),
            ("acme", Some(own.clone())),
            ("cloud", Some(other.clone())),
        ]
    );
    let file = |key: &str| storage.load(key, &Value::Null).unwrap();
    assert_eq!(file("plugin.acme..cloud.token"), own);
    assert_eq!(file("plugin.acme.cloud.token"), other, "TS's name is the dot-free key's");
}

const FIELD: usize = opencode_plugin::storage::VALUE_BYTES / 64 * 35;

thread_local! {
    /// The field names and the first letter of each field's value `big` read back, in order.
    static BIG: RefCell<Vec<Vec<(String, char)>>> = const { RefCell::new(Vec::new()) };
}

/// The plugin `big`, whose key `state` holds fields of [`FIELD`] bytes.
fn big(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("state");
    let field = |letter: char| json!(letter.to_string().repeat(FIELD));
    setup.command(named("big.set"), move |host, _| host.storage_set("state", json!({ "a": field('x') })));
    setup.command(named("big.replace"), move |host, _| {
        host.storage_merge("state", serde_json::Map::from_iter([("a".to_owned(), field('y'))]));
    });
    setup.command(named("big.add"), move |host, _| {
        host.storage_merge("state", serde_json::Map::from_iter([("b".to_owned(), field('z'))]));
    });
    setup.command(named("big.read"), |host, _| {
        let fields = host.storage_get("state").and_then(|value| value.as_object().cloned()).unwrap_or_default();
        let read = fields
            .iter()
            .map(|(key, value)| (key.clone(), value.as_str().and_then(|text| text.chars().next()).unwrap_or('-')))
            .collect();
        BIG.with_borrow_mut(|big| big.push(read));
    });
    Ok(())
}

#[test]
fn a_merge_is_bounded_by_the_value_it_makes() {
    BIG.with_borrow_mut(Vec::clear);
    let deps = Deps {
        route: Route::Home,
        builtins: vec![opencode_plugin::abi::Plugin { id: "big", setup: big }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
    for command in ["big.set", "big.read", "big.replace", "big.read", "big.add", "big.read"] {
        harness.tui.keymap.dispatch(command, None);
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
    let field = |name: &str, letter: char| (name.to_owned(), letter);
    assert_eq!(
        BIG.take(),
        [vec![field("a", 'x')], vec![field("a", 'y')], vec![field("a", 'y')]],
        "the replace was refused, or the addition kept"
    );
}

thread_local! {
    static TWO: RefCell<Vec<Vec<String>>> = const { RefCell::new(Vec::new()) };
}

/// The plugin `two`, which adds a field `a` of [`FIELD`] bytes to its key `state`.
fn two(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("state");
    setup.command(named("two.add"), |host, _| {
        host.storage_merge("state", serde_json::Map::from_iter([("a".to_owned(), json!("a".repeat(FIELD)))]));
    });
    setup.command(named("two.read"), |host, _| {
        let fields = host.storage_get("state").and_then(|value| value.as_object().cloned()).unwrap_or_default();
        TWO.with_borrow_mut(|two| two.push(fields.keys().cloned().collect()));
    });
    // A second key, whose write goes to the writer after the merge.
    setup.storage_key("note");
    setup.command(named("two.note"), |host, _| host.storage_set("note", json!({ "n": 1 })));
    Ok(())
}

#[test]
fn two_clients_merging_a_key_stay_within_its_bound_together() {
    let root = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(&root.path().join("home"));
    let other = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
    TWO.with_borrow_mut(Vec::clear);
    let deps = Deps {
        route: Route::Home,
        roots: support::roots(paths, "test"),
        builtins: vec![opencode_plugin::abi::Plugin { id: "two", setup: two }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
    let run = |command: &str| {
        harness.tui.keymap.dispatch(command, None);
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    };
    // This client reads the key empty; the other client then adds its field, through the same lock.
    run("two.read");
    let theirs = json!({ "b": "b".repeat(FIELD) });
    other
        .update_within("plugin.two.state", &json!({}), opencode_plugin::storage::VALUE_BYTES, |value| {
            *value = theirs.clone();
        })
        .unwrap();
    run("two.add");
    opencode_tui::plugins::host::flush_storage(&harness.tui);
    let fields = |value: Value| value.as_object().map(|object| object.keys().cloned().collect::<Vec<_>>());
    let stored = other.load("plugin.two.state", &Value::Null).unwrap();
    assert_eq!(fields(stored), Some(vec!["b".to_owned()]), "both fields were kept");
    // The refusal reaches the UI thread at once, which reads the key again: before the storage watcher's debounce.
    harness.app.advance(Duration::ZERO);
    run("two.read");
    assert_eq!(
        TWO.with_borrow(|two| two.last().cloned()),
        Some(vec!["b".to_owned()]),
        "this client still shows its own merge"
    );
    assert_eq!(TWO.with_borrow(|two| two.first().cloned()), Some(Vec::new()));
}

#[test]
fn a_refused_write_leaves_the_cache_equal_to_the_file_when_its_notice_is_lost() {
    let root = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(&root.path().join("home"));
    let other = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
    TWO.with_borrow_mut(Vec::clear);
    let deps = Deps {
        route: Route::Home,
        roots: support::roots(paths, "test"),
        builtins: vec![opencode_plugin::abi::Plugin { id: "two", setup: two }.into()],
        ..support::deps(Arc::new(support::empty()))
    };
    let harness = support::mount(80, 24, deps);
    harness.tui.keymap.dispatch("two.read", None);
    let theirs = json!({ "b": "b".repeat(FIELD) });
    other
        .update_within("plugin.two.state", &json!({}), opencode_plugin::storage::VALUE_BYTES, |value| {
            *value = theirs.clone();
        })
        .unwrap();
    // The UI queue is full: the refusal's notice cannot be posted.
    let proxy = harness.app.proxy();
    while proxy.send(()).is_ok() {}
    harness.tui.keymap.dispatch("two.add", None);
    harness.tui.keymap.dispatch("two.note", None);
    opencode_tui::plugins::host::flush_storage(&harness.tui);
    harness.app.advance(Duration::ZERO);
    harness.tui.keymap.dispatch("two.read", None);
    assert_eq!(TWO.take().last().cloned(), Some(vec!["b".to_owned()]), "the refused merge shows");
    for key in ["plugin.two.state", "plugin.two.note"] {
        let file = other.load(key, &Value::Null).ok().filter(|value| !value.is_null()).map(|value| value.to_string());
        assert_eq!(opencode_plugin::Host::storage_read(&*harness.tui, key), file, "{key}");
    }
}
