//! Exercise plugin-manager actions, subscriptions, and resources held while disabled.

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, Command};
use opencode_tui::plugins::host::host;
use opencode_tui::plugins::manager::ID;
use opencode_tui::{Deps, Route};

use crate::support::{self, Fake, Harness, Log};

fn open(plugins: &[&str]) -> (Harness, Log) {
    open_with(serde_json::json!({ "plugins": plugins }), Vec::new())
}

/// Home with `config` beside `animations: false` and the built-ins with `extra`.
fn open_with(config: serde_json::Value, extra: Vec<opencode_plugin::Builtin>) -> (Harness, Log) {
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/plugin" => (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": [] })),
        _ => support::base(seen, "/tmp/app"),
    });
    let log = fake.log();
    let config = support::merge(serde_json::json!({ "animations": false }), config);
    let mut builtins = support::deps(Arc::new(support::empty())).builtins;
    builtins.extend(extra);
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&config.to_string())),
        builtins,
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(100, 30, deps);
    // The budget is not what these rows check. On the wall clock a loaded machine's stall in a call (memory reclaim,
    // swap), which is no wait on a run queue, is charged: enough of them make a plugin slow, a change of the plugin list
    // a reader hears beside the step's own. A call here takes no time; the slow row sets its own clock.
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    settle(&harness);
    // The host's own read of the server plugins as it starts, which a loaded machine may send late: rows that count
    // the manager's reads count from after it.
    harness.wait("the host's own read", || reads(&log) >= 1);
    (harness, log)
}

fn settle(harness: &Harness) {
    for _ in 0..3 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
}

fn reads(log: &Log) -> usize {
    log.lock().unwrap().iter().filter(|seen| seen.path == "/api/plugin" && seen.method == "GET").count()
}

fn commands(harness: &Harness) -> BTreeSet<String> {
    harness.tui.keymap.commands().into_iter().map(|command| command.id).collect()
}

/// The screen, without Home's random placeholder.
fn screen(harness: &Harness) -> String {
    let text = harness.app.render().text();
    text.lines().filter(|line| !line.contains("Ask anything")).collect::<Vec<_>>().join("\n")
}

fn toggle(harness: &Harness, id: &str, active: bool) {
    let host = host(&harness.tui);
    assert_eq!(harness.tui.plugins.toggle(&host, id, active), Some(Ok(())), "{id}");
    host.remount();
    settle(harness);
}

#[test]
fn a_disabled_manager_holds_nothing_and_matches_one_never_enabled() {
    let (harness, log) = open(&[]);
    let before = reads(&log);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
    // The list's read goes out as it opens, and a loaded machine logs it late: the count after the toggle is taken
    // from once it is in (preview 44324450162, Windows).
    harness.wait("the list's read", || reads(&log) > before);
    let (with, read) = (commands(&harness), reads(&log));
    assert!(with.contains("plugins.list") && with.contains("opencode.plugins.check"), "{with:?}");
    toggle(&harness, ID, false);
    assert!(!harness.tui.dialogs.is_open(), "the manager's list stayed:\n{}", screen(&harness));
    let (twin, _) = open(&["-opencode.plugins"]);
    assert_eq!(commands(&harness), commands(&twin));
    assert_eq!(screen(&harness), screen(&twin));
    harness.tui.plugins.tell_plugins();
    harness.dispatch("plugins.list");
    settle(&harness);
    assert!(!harness.tui.dialogs.is_open());
    assert_eq!(reads(&log), read, "a disabled manager read the list");
    toggle(&harness, ID, true);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
}

/// A configured native plugin library is listed as skipped, says why in `/plugins`, and nothing of it is
/// opened.
#[test]
fn a_native_library_is_listed_as_skipped() {
    let root = opencode_util::temp::tempdir().unwrap();
    let library = root.path().join(format!("probe.{}", std::env::consts::DLL_EXTENSION));
    std::fs::write(&library, b"never opened").unwrap();
    let target = library.to_string_lossy().into_owned();
    let (harness, _) = open(&[&target]);
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
    };
    opencode_tui::plugins::host::external(&harness.tui, external);
    settle(&harness);
    let entry = harness.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&*target));
    let skipped = opencode_plugin::Status::Skipped(opencode_plugin::SKIPPED_NATIVE.to_owned());
    assert_eq!(entry.map(|entry| entry.status), Some(skipped));
    let toast = harness.wait_for("1 plugin not loaded");
    assert!(!toast.contains("TypeScript"), "{toast}");
    harness.dispatch("plugins.list");
    harness.wait_for("probe");
    harness.app.press("enter");
    harness.wait_for("does not load native plugin libraries");
}

#[test]
fn the_manager_shows_the_plugins_only_while_its_list_shows() {
    let (harness, log) = open(&["./broken.ts"]);
    harness.tui.plugins.tell_plugins();
    settle(&harness);
    assert!(!harness.tui.dialogs.is_open(), "a change opened the manager");
    let read = reads(&log);
    harness.dispatch("plugins.list");
    harness.wait_for("skipped, local");
    harness.wait("the manager's read", || reads(&log) == read + 1);
    assert!(!harness.app.text().contains("check for updates"), "{}", harness.app.text());
    opencode_tui::plugins::host::add(&harness.tui, watcher().into());
    harness.wait_for("test.watch");
    harness.app.press("enter");
    harness.wait_for("TUI plugin error");
    toggle(&harness, "test.watch", false);
    assert!(harness.app.text().contains("TUI plugin error"), "{}", harness.app.text());
    harness.app.press("escape");
    let shown = harness.wait_for("inactive");
    assert!(shown.contains("view error enter"), "Back is not on the skipped row:\n{shown}");
    assert_eq!(reads(&log), read + 1, "a change read the server list");
    harness.app.press("escape");
    settle(&harness);
    toggle(&harness, "test.watch", true);
    assert!(!harness.tui.dialogs.is_open(), "a change opened the closed manager:\n{}", harness.app.text());
}

thread_local! {
    static HEARD: RefCell<Vec<Vec<String>>> = const { RefCell::new(Vec::new()) };
}

/// A plugin that logs the plugin list at each change it hears of, and one command that panics.
fn watcher() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.on_plugins(|host| HEARD.with_borrow_mut(|heard| heard.push(listed(&host.plugins()))));
        let command = Command::new("watch.boom");
        setup.command(command, |_, _| -> () { panic!("the watcher's command panics") });
        Ok(())
    }
    abi::Plugin { id: "test.watch", setup }
}

/// A plugin that panics on its command, which the delivery steps fail.
fn boom() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command::new("boom.boom"), |_, _| -> () { panic!("boom") });
        Ok(())
    }
    abi::Plugin { id: "test.boom", setup }
}

fn listed(plugins: &[abi::PluginEntry]) -> Vec<String> {
    plugins
        .iter()
        .map(|entry| format!("{} {:?} {}{}", entry.id, entry.status, entry.active, slow(entry.slow.is_some())))
        .collect()
}

fn slow(slow: bool) -> &'static str {
    if slow { " slow" } else { "" }
}

/// The registry as the watcher would read it.
fn registry(harness: &Harness) -> Vec<String> {
    let entries = harness.tui.plugins.entries();
    entries
        .iter()
        .map(|entry| {
            let status = match entry.status {
                opencode_plugin::Status::Active => abi::PluginStatus::Active,
                opencode_plugin::Status::Inactive => abi::PluginStatus::Inactive,
                opencode_plugin::Status::Skipped(_) => abi::PluginStatus::Skipped,
                opencode_plugin::Status::Failed(_) => abi::PluginStatus::Failed,
                opencode_plugin::Status::Pending => abi::PluginStatus::Pending,
                opencode_plugin::Status::Declined => abi::PluginStatus::Declined,
            };
            format!("{} {status:?} {}{}", entry.id, entry.active, slow(entry.slow.is_some()))
        })
        .collect()
}

#[test]
fn a_plugin_hears_each_change_of_the_plugin_list_once() {
    for seed in 0..6u32 {
        let (harness, _) = open(&[]);
        opencode_tui::plugins::host::add(&harness.tui, watcher().into());
        settle(&harness);
        HEARD.take();
        let (mut n, mut added, mut expected) = (seed, false, Vec::new());
        let mut before = registry(&harness);
        for _ in 0..10 {
            n = n.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            let step = (n >> 16) % 6;
            match step {
                0 => {
                    harness.dispatch("plugins.list");
                    harness.wait_for("show internal");
                    harness.app.type_text("opencode.home.footer");
                    harness.app.press("ctrl+a");
                    harness.wait_for("hide internal");
                    harness.app.press("enter");
                    settle(&harness);
                    harness.app.press("escape");
                }
                1 => {
                    let active = harness.tui.plugins.entries().iter().any(|e| e.id == "opencode.stats" && e.active);
                    toggle(&harness, "opencode.stats", !active);
                }
                2 if !added => {
                    added = true;
                    opencode_tui::plugins::host::add(&harness.tui, boom().into());
                }
                2 | 3 => harness.dispatch("boom.boom"),
                4 => {
                    harness.dispatch("plugins.list");
                    harness.wait_for("show internal");
                    harness.app.press("escape");
                }
                _ => {
                    opencode_tui::plugins::host::tell_plugins(&harness.tui);
                    settle(&harness);
                    opencode_tui::plugins::host::tell_plugins(&harness.tui);
                }
            }
            settle(&harness);
            let after = registry(&harness);
            if after != before {
                expected.push(after.clone());
            }
            before = after;
            let heard = HEARD.with_borrow(Clone::clone);
            assert_eq!(heard, expected, "seed {seed}, step {step}");
        }
    }
}

thread_local! {
    static SHADOW_FAILS: Cell<bool> = const { Cell::new(false) };
}

fn status_of(harness: &Harness, key: &str) -> Option<(opencode_plugin::Status, bool)> {
    let entries = harness.tui.plugins.entries();
    entries.into_iter().find(|entry| entry.key == key).map(|entry| (entry.status, entry.active))
}

thread_local! {
    static READ: RefCell<String> = const { RefCell::new(String::new()) };
}

/// A transport that holds each read of the server plugins at `/tmp/other`, where the manager opens, until the test answers
/// it, and sends the rest to `inner`, the host's own reads of its default location included.
struct Gated {
    inner: opencode_api::memory::Memory,
    held: std::sync::Mutex<Vec<tokio::sync::oneshot::Sender<opencode_api::transport::Response>>>,
}

impl opencode_api::transport::Transport for Gated {
    fn send(
        &self,
        request: opencode_api::transport::Request,
    ) -> opencode_api::transport::BoxFuture<'_, Result<opencode_api::transport::Response, String>> {
        let other = request.url.query().is_some_and(|query| query.contains("%2Ftmp%2Fother"));
        if request.method != "GET" || request.url.path() != "/api/plugin" || !other {
            return self.inner.send(request);
        }
        let (send, answer) = tokio::sync::oneshot::channel();
        self.held.lock().unwrap().push(send);
        Box::pin(async move { answer.await.map_err(|error| error.to_string()) })
    }
}

impl Gated {
    /// Answers the held reads, the newest first: the newest with a package `newest`, the others with `older`.
    fn answer(&self, harness: &Harness, newest: &str, older: &str) {
        let held: Vec<_> = self.held.lock().unwrap().drain(..).collect();
        for (index, send) in held.into_iter().enumerate().rev() {
            let id = if index == 0 { older } else { newest };
            let plugins = serde_json::json!([{
                "id": id, "source": { "type": "package", "target": id, "version": "1.0.0" },
                "features": { "server": true }, "state": { "status": "active" },
            }]);
            let body = serde_json::json!({ "location": support::location("/tmp/app"), "data": plugins });
            let _ = send.send(support::respond(200, &body));
            settle(harness);
        }
    }
}

#[test]
fn the_newest_server_list_shows_whatever_order_the_replies_come_in() {
    use opencode_api::memory::{Memory, Route as MemoryRoute};
    let memory = Memory::new(vec![
        MemoryRoute::json("GET", "/api/location", 200, &support::location("/tmp/app")),
        MemoryRoute::json("GET", "/api/session", 200, &serde_json::json!({ "data": [], "cursor": {} })),
    ]);
    let gated = Arc::new(Gated { inner: memory.clone(), held: Default::default() });
    let deps = Deps { route: Route::Home, events: true, ..support::deps(gated.clone()) };
    let harness = support::mount(100, 30, deps);
    opencode_tui::features::location::navigate_home(&harness.tui, Some(opencode_store::Location::new("/tmp/other")));
    settle(&harness);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
    assert!(harness.app.wait_until(support::WAIT, || gated.held.lock().unwrap().len() == 1));
    memory.emit(&serde_json::json!({ "id": "evt_1", "created": 1, "type": "plugin.updated", "data": {} }));
    assert!(harness.app.wait_until(support::WAIT, || gated.held.lock().unwrap().len() == 2));
    settle(&harness);
    gated.answer(&harness, "newest.pkg", "older.pkg");
    let shown = harness.wait_for("newest.pkg");
    assert!(!shown.contains("older.pkg"), "{shown}");
    // Across opens: the first open's read answers after the second's.
    harness.app.press("escape");
    settle(&harness);
    harness.dispatch("plugins.list");
    settle(&harness);
    harness.app.press("escape");
    settle(&harness);
    harness.dispatch("plugins.list");
    assert!(harness.app.wait_until(support::WAIT, || gated.held.lock().unwrap().len() == 2));
    gated.answer(&harness, "second.pkg", "first.pkg");
    let shown = harness.wait_for("second.pkg");
    assert!(!shown.contains("first.pkg"), "{shown}");
}

fn quiet(id: &'static str) -> abi::Plugin {
    fn setup(_: &mut abi::Setup) -> Result<(), String> {
        Ok(())
    }
    abi::Plugin { id, setup }
}

#[test]
fn toggles_in_one_filtered_open_reach_the_selected_plugin_alone() {
    let deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
    let harness = support::mount(100, 30, deps);
    for id in ["test.a", "test.b"] {
        opencode_tui::plugins::host::add(&harness.tui, quiet(id).into());
    }
    opencode_tui::plugins::host::add(&harness.tui, boom().into());
    settle(&harness);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
    harness.app.type_text("test.");
    harness.wait_for("test.boom");
    let state = |harness: &Harness| -> Vec<(String, bool)> {
        ["test.a", "test.b", "test.boom"]
            .iter()
            .map(|id| {
                let (status, active) = status_of(harness, &opencode_plugin::Entry::plugin_key(id)).unwrap();
                (format!("{id} {status:?}"), active)
            })
            .collect()
    };
    let selected = |harness: &Harness| -> String {
        let text = harness.app.text();
        let row = text.lines().find(|line| line.contains('┃') && line.contains("test.")).unwrap_or_default();
        row.split_whitespace().find(|word| word.starts_with("test.")).unwrap_or_default().to_owned()
    };
    let row = |harness: &Harness, id: &str| -> String {
        let text = harness.app.text();
        text.lines().find(|line| line.split_whitespace().any(|word| word == id)).unwrap_or_default().to_owned()
    };
    harness.app.press("enter");
    settle(&harness);
    assert!(row(&harness, "test.a").contains("inactive"), "{}", harness.app.text());
    assert_eq!(selected(&harness), "test.a");
    assert_eq!(state(&harness).iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, true, true]);
    harness.app.press("down");
    harness.app.press("enter");
    settle(&harness);
    assert_eq!(selected(&harness), "test.b");
    assert_eq!(state(&harness).iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, false, true]);
    harness.app.press("down");
    settle(&harness);
    harness.dispatch("boom.boom");
    settle(&harness);
    assert!(row(&harness, "test.boom").contains("failed"), "{}", harness.app.text());
    assert_eq!(selected(&harness), "test.boom");
    assert!(state(&harness)[2].0.contains("Failed") && state(&harness)[2].1);
    assert_eq!(state(&harness)[..2].iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, false]);
    harness.app.press("enter");
    settle(&harness);
    assert!(!state(&harness)[2].1, "the failed plugin stayed active");
    assert_eq!(selected(&harness), "test.boom");
}

thread_local! {
    static PICKED: Cell<u32> = const { Cell::new(0) };
}

#[test]
fn the_managers_own_commands_open_nothing() {
    let (harness, log) = open(&[]);
    let read = reads(&log);
    for name in ["internal", "check", "update", "error", "back", "asked"] {
        harness.tui.keymap.dispatch(&format!("opencode.plugins.{name}"), Some("tui:plugin:opencode.stats"));
        settle(&harness);
        assert!(!harness.tui.dialogs.is_open(), "{name}: {}", harness.app.text());
    }
    assert_eq!(reads(&log), read);
}

#[test]
fn the_slow_manager_cannot_be_disabled_from_its_toast() {
    let (harness, _) = open(&[]);
    while harness.tui.toasts.current().is_some() {
        harness.tui.toasts.dismiss();
    }
    opencode_plugin::Host::slow(&*harness.tui, ID, "2.0 ms a frame");
    assert!(harness.tui.toasts.current().is_some_and(|toast| toast.action.is_none()));
    harness.tui.toasts.dismiss();
    opencode_plugin::Host::slow(&*harness.tui, "opencode.stats", "2.0 ms a frame");
    assert!(harness.tui.toasts.current().is_some_and(|toast| toast.action.is_some()));
}

#[test]
fn a_skipped_entry_added_to_the_config_is_heard() {
    let (harness, _) = open(&[]);
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
    };
    opencode_tui::plugins::host::external(&harness.tui, external);
    opencode_tui::plugins::host::add(&harness.tui, watcher().into());
    settle(&harness);
    HEARD.take();
    opencode_tui::dialogs::settings::update(&harness.tui, |draft| {
        opencode_tui::dialogs::settings::set_path(draft, &["plugins"], serde_json::json!(["./added.ts"]));
    });
    settle(&harness);
    let heard = HEARD.take();
    assert!(heard.last().is_some_and(|list| list.iter().any(|row| row.starts_with("./added.ts Skipped"))), "{heard:?}");
}

#[test]
fn typescript_plugins_not_loaded_are_told_once_and_listed() {
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/plugin" => {
            let energy = serde_json::json!({
                "id": "energy", "source": { "type": "package", "target": "opencode-energy@1.0.0" },
                "features": { "server": true, "tui": true }, "state": { "status": "active" },
            });
            (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": [energy] }))
        }
        _ => support::base(seen, "/tmp/app"),
    });
    let config = serde_json::json!({ "animations": false, "plugins": ["opencode-tokens@0.1.3"] });
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&config.to_string())),
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(120, 30, deps);
    settle(&harness);
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let pulse = root.path().join("config").join("plugins").join("pulse");
    std::fs::create_dir_all(&pulse).unwrap();
    std::fs::write(pulse.join("package.json"), r#"{ "name": "opencode-pulse-ticker" }"#).unwrap();
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
    };
    opencode_tui::plugins::host::external_with(&harness.tui, external, None);
    harness.wait("the notice", || {
        settle(&harness);
        harness.tui.toasts.current().is_some()
    });
    let toast = harness.tui.toasts.current().expect("the notice");
    assert_eq!(toast.title.as_deref(), Some("3 TypeScript plugins not loaded"));
    // A package named by npm, a directory and a server plugin's TUI part all wait for the JS host (js-npm): one reason.
    let reason = format!(": {}.", opencode_plugin::SKIPPED_OFF);
    let line = toast.message.lines().find(|line| line.ends_with(&reason)).unwrap_or_default();
    for name in ["opencode-tokens@0.1.3", "opencode-pulse-ticker", "opencode-energy@1.0.0"] {
        assert!(line.contains(name), "{name} in {:?}", toast.message);
    }
    assert!(toast.message.lines().any(|known| known == "Run /plugins to view details."), "{:?}", toast.message);
    harness.tui.toasts.dismiss();
    opencode_tui::plugins::host::reconcile(&harness.tui);
    settle(&harness);
    assert!(harness.tui.toasts.current().is_none(), "told again");
    harness.tui.keymap.dispatch("plugins.list", None);
    harness.wait("the list", || {
        settle(&harness);
        screen(&harness).contains("opencode-energy@1.0.0")
    });
    let screen = screen(&harness);
    for row in ["opencode-pulse-ticker", "opencode-tokens@0.1.3", "opencode-energy@1.0.0", "energy"] {
        assert!(screen.contains(row), "{row}: {screen}");
    }
    assert!(!screen.contains(&*pulse.to_string_lossy()), "{screen}");
}

/// A gate the test opens, which a server's check waits on.
type Gate = Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>;

fn open_gate(gate: &Gate) {
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
}

/// A server that lists one package `pkg`, as `state` says, and answers check and update with `status`; a check waits
/// until `gate` opens.
fn package_server(state: serde_json::Value, status: u16, gate: Gate) -> Fake {
    Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/plugin") => {
            let plugin = support::merge(
                serde_json::json!({
                    "id": "pkg", "source": { "type": "package", "target": "pkg", "version": "1.0.0", "outdated": true },
                    "features": { "server": true },
                }),
                state.clone(),
            );
            (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": [plugin] }))
        }
        ("POST", "/api/plugin/check" | "/api/plugin/update") => {
            if seen.path == "/api/plugin/check" {
                let open = gate.0.lock().unwrap();
                drop(gate.1.wait_timeout_while(open, Duration::from_secs(10), |open| !*open).unwrap());
            }
            (status, serde_json::json!({ "_tag": "Broken", "message": "the registry is down" }))
        }
        _ => support::base(seen, "/tmp/app"),
    })
}

fn open_on(fake: Fake) -> (Harness, Log) {
    let log = fake.log();
    let deps = Deps { route: Route::Home, ..support::deps(Arc::new(fake)) };
    let harness = support::mount(100, 30, deps);
    settle(&harness);
    (harness, log)
}

#[test]
fn the_server_rows_follow_typescript() {
    let hash = "0123456789abcdef".repeat(4);
    let failed = serde_json::json!({
        "source": { "type": "package", "target": "pkg", "version": hash, "outdated": true },
        "state": { "status": "failed", "error": "boom" },
    });
    let opened: Gate = Arc::new((std::sync::Mutex::new(true), std::sync::Condvar::new()));
    let (harness, _) = open_on(package_server(failed, 500, opened.clone()));
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("update ctrl+u");
    assert!(shown.contains("0123456") && !shown.contains("01234567"), "{shown}");
    let footer = shown.lines().find(|line| line.contains("update ctrl+u")).unwrap();
    assert!(footer.find("update ctrl+u") < footer.find("view error enter"), "{footer}");
    let updating = serde_json::json!({
        "source": { "type": "package", "target": "pkg", "version": "1.0.0", "updating": true },
        "state": { "status": "active" },
    });
    let (harness, _) = open_on(package_server(updating, 500, opened));
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("updating");
    let row = shown.lines().find(|line| line.contains("pkg") && line.contains("updating")).unwrap();
    let gutter = row.split("pkg").next().unwrap();
    assert!(gutter.chars().any(|c| !c.is_whitespace() && c != '┃'), "no spinner: {row:?}");
    let gate: Gate = Arc::default();
    let (harness, log) =
        open_on(package_server(serde_json::json!({ "state": { "status": "active" } }), 500, gate.clone()));
    harness.dispatch("plugins.list");
    harness.wait_for("check for updates");
    let shown = harness.wait_for("update available");
    assert!(shown.contains("1.0.0"), "{shown}");
    let checks = || log.lock().unwrap().iter().filter(|seen| seen.path == "/api/plugin/check").count();
    harness.app.press("ctrl+r");
    harness.wait_for("checking for updates");
    harness.app.press("ctrl+r");
    settle(&harness);
    open_gate(&gate);
    harness.wait("the check's toast", || {
        harness.tui.toasts.current().is_some_and(|toast| toast.message.contains("the registry is down"))
    });
    assert_eq!(checks(), 1);
    harness.wait_for("check for updates");
    harness.tui.toasts.dismiss();
    harness.app.press("ctrl+u");
    harness.wait("the update's toast", || {
        harness.tui.toasts.current().is_some_and(|toast| toast.message.contains("the registry is down"))
    });
}

/// A plugin whose handler of the plugin list panics.
fn panicky() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.on_plugins(|_| panic!("panicky hears the list"));
        Ok(())
    }
    abi::Plugin { id: "test.panicky", setup }
}

#[test]
fn a_panicking_plugin_list_handler_fails_its_plugin() {
    let (harness, _) = open(&[]);
    let plugin = opencode_plugin::Builtin::Plugin(panicky());
    opencode_tui::plugins::host::add(&harness.tui, plugin.into());
    opencode_tui::plugins::host::add(&harness.tui, quiet("test.a").into());
    settle(&harness);
    let status = status_of(&harness, "plugin:test.panicky").unwrap().0;
    let opencode_plugin::Status::Failed(error) = status else { panic!("{status:?}") };
    assert!(error.contains("on-plugins"), "{error}");
}

thread_local! {
    static CLOCK: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static COST: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

fn slowly() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command::new("slowly.work"), |_, _| {
            CLOCK.set(CLOCK.get() + COST.get());
        });
        Ok(())
    }
    abi::Plugin { id: "test.slowly", setup }
}

#[test]
fn a_plugin_hears_when_a_plugin_becomes_slow_and_stops() {
    let (harness, _) = open(&[]);
    opencode_tui::plugins::host::add(&harness.tui, watcher().into());
    opencode_tui::plugins::host::add(&harness.tui, slowly().into());
    let monitor = harness.tui.plugins.monitor();
    let base = std::time::Instant::now();
    monitor.set_clock(move || base + CLOCK.get());
    let limits = monitor.limits();
    monitor.set_limits(opencode_plugin::contain::Limits {
        frame: Duration::from_millis(1),
        window: 4,
        slow: 1,
        ..limits
    });
    settle(&harness);
    HEARD.take();
    let slowly = || {
        let heard = HEARD.with_borrow(|heard| heard.last().cloned()).unwrap_or_default();
        heard.iter().find(|row| row.starts_with("test.slowly")).is_some_and(|row| row.ends_with(" slow"))
    };
    let frames = |cost: u64, count: usize| {
        COST.set(Duration::from_micros(cost));
        for _ in 0..count {
            harness.dispatch("slowly.work");
            settle(&harness);
        }
    };
    frames(2000, 4);
    assert!(slowly(), "{:?}", HEARD.with_borrow(Clone::clone));
    let heard = HEARD.with_borrow(Vec::len);
    frames(3000, 2);
    opencode_tui::plugins::host::tell_plugins(&harness.tui);
    settle(&harness);
    assert_eq!(HEARD.with_borrow(Vec::len), heard, "the cost alone was told");
    frames(0, 6);
    assert!(!slowly(), "{:?}", HEARD.with_borrow(Clone::clone));
    frames(2000, 4);
    assert!(slowly(), "the second slow went untold");
    monitor.set_limits(limits);
}

fn titled() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command::new("titled.show"), |host, input| {
            let action = abi::Action::command("titled.show");
            let mut select =
                abi::Select::new(input.unwrap_or_default(), vec![abi::SelectOption::new("row", "r")], action);
            select.key = Some("t".to_owned());
            host.dialog(abi::Dialog::Select(select));
        });
        Ok(())
    }
    abi::Plugin { id: "test.titled", setup }
}

#[test]
fn a_keyed_select_shown_again_takes_its_new_title() {
    let (harness, _) = open(&[]);
    opencode_tui::plugins::host::add(&harness.tui, titled().into());
    harness.tui.keymap.dispatch("titled.show", Some("First title"));
    harness.wait_for("First title");
    harness.tui.keymap.dispatch("titled.show", Some("Second title"));
    harness.wait_for("Second title");
}

fn presented() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command::new("presented.select"), |host, input| {
            let action = abi::Action::command("presented.select");
            let rows = ["alpha", "beta", "gamma"].map(|row| abi::SelectOption::new(row, row)).to_vec();
            let select =
                abi::Select::new("Presented", rows, action).key("p").when(input == Some("on"), abi::Select::centered);
            host.dialog(abi::Dialog::Select(select));
        });
        setup.command(Command::new("presented.alert"), |host, _| {
            let alert = abi::Alert::new("Told", "said").size(abi::PanelSize::XLarge).centered();
            host.dialog(abi::Dialog::Alert(alert));
        });
        setup.command(Command::new("presented.confirm"), |host, _| {
            let action = abi::Action::command("presented.alert");
            let confirm = abi::Confirm::new("Asked", "sure?", action).size(abi::PanelSize::Large);
            host.dialog(abi::Dialog::Confirm(confirm.centered()));
        });
        Ok(())
    }
    abi::Plugin { id: "test.presented", setup }
}

#[test]
fn a_dialog_takes_its_size_and_centering() {
    let (harness, _) = open(&[]);
    let tui = &harness.tui;
    opencode_tui::plugins::host::add(tui, presented().into());
    let row = |text: &str| support::at(&harness.app.render().text(), text).map(|(_, y)| y);
    tui.keymap.dispatch("presented.select", Some("off"));
    harness.wait_for("Presented");
    assert!(!tui.dialogs.centered());
    let high = row("Presented").unwrap();
    harness.app.type_text("et");
    harness.wait("the filter took", || row("alpha").is_none() && row("beta").is_some());
    tui.keymap.dispatch("presented.select", Some("on"));
    harness.wait("the select moved", || row("Presented").is_some_and(|low| low > high));
    assert!(tui.dialogs.centered());
    assert!(row("beta").is_some() && row("alpha").is_none(), "the filter went:\n{}", harness.app.text());
    tui.keymap.dispatch("presented.alert", None);
    harness.wait_for("Told");
    assert_eq!((tui.dialogs.size(), tui.dialogs.centered()), (opencode_ui::dialog::DialogSize::XLarge, true));
    tui.keymap.dispatch("presented.confirm", None);
    harness.wait_for("Asked");
    assert_eq!((tui.dialogs.size(), tui.dialogs.centered()), (opencode_ui::dialog::DialogSize::Large, true));
    tui.keymap.dispatch("presented.select", Some("off"));
    harness.wait_for("Presented");
    assert_eq!((tui.dialogs.size(), tui.dialogs.centered()), (opencode_ui::dialog::DialogSize::Medium, false));
}
