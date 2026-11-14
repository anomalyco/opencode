//! The plugin manager as a plugin of contract 2.0 (P6b, synthesis 4.10 and 4.14): what it holds once it is disabled
//! (`ledger`), when it hears of the plugins and what it shows then (`lifecycle`), what a plugin that reads the plugin
//! list hears (`delivery`), and the host's own `/plugins` while the manager has failed. Its frames against TS and the
//! requests it sends are `system`'s named tests; its keys are the shared fixture's (`plugin_machines`).

use std::cell::{Cell, RefCell};
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, Command};
use opencode_plugin::loader::native::loopback_described;
use opencode_plugin::loader::{Backend, Loader, entry_file};
use opencode_plugin::{Definition, ErrorFn, Host};
use opencode_tui::plugins::host::host;
use opencode_tui::plugins::manager::ID;
use opencode_tui::{Deps, Route};

use crate::support::{self, Fake, Harness, Log};

thread_local! {
    /// The built-ins, the manager among them, run across the C ABI's byte shims (review carbon-6).
    static ABI: Cell<bool> = const { Cell::new(false) };
}

/// Runs `test` with the built-ins linked, then across the C ABI's byte shims.
fn carriers(test: fn()) {
    for abi in [false, true] {
        ABI.set(abi);
        test();
    }
    ABI.set(false);
}

/// Home with the plugin list of `plugins`, over a server that answers `/api/plugin` with no plugin; and its log.
fn open(plugins: &[&str]) -> (Harness, Log) {
    open_with(serde_json::json!({ "plugins": plugins }), Vec::new())
}

/// Home with `config` beside `animations: false` and the built-ins with `extra`, on the carrier of [`ABI`].
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
        abi_builtins: ABI.get(),
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(100, 30, deps);
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

/// The plugin list reads the manager sent.
fn reads(log: &Log) -> usize {
    log.lock().unwrap().iter().filter(|seen| seen.path == "/api/plugin" && seen.method == "GET").count()
}

/// The commands that can be reached now, by ID.
fn commands(harness: &Harness) -> BTreeSet<String> {
    harness.tui.keymap.commands().into_iter().map(|command| command.id).collect()
}

/// The screen, without Home's random placeholder.
fn screen(harness: &Harness) -> String {
    let text = harness.app.render().text();
    text.lines().filter(|line| !line.contains("Ask anything")).collect::<Vec<_>>().join("\n")
}

/// Enables or disables plugin `id` as the host's own toggles do (the slow toast's Disable, Enable again): the registry,
/// then the route mounts again.
fn toggle(harness: &Harness, id: &str, active: bool) {
    let host = host(&harness.tui);
    assert_eq!(harness.tui.plugins.toggle(&host, id, active), Some(Ok(())), "{id}");
    host.remount();
    settle(harness);
}

// Expected (`ledger`): the manager disabled while its list shows closes it and holds nothing: no command of it is
// reachable, the list is not read again, and the screen and the commands equal a TUI started with `-opencode.plugins`
// (the twin). Enabled again, `/plugins` opens it.
#[test]
fn a_disabled_manager_holds_nothing_and_matches_one_never_enabled() {
    carriers(a_disabled_manager_holds_nothing_and_matches_one_never_enabled_on);
}

fn a_disabled_manager_holds_nothing_and_matches_one_never_enabled_on() {
    let (harness, log) = open(&[]);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
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

// Expected (`lifecycle`, 4.10): only `/plugins` opens the list. While it shows, a change of the plugins shows in its
// rows at once, with no read of the server list; under its error view a change shows nothing until Back, which brings
// the list back on the row with the change in it; once the list is closed, a change opens nothing.
#[test]
fn the_manager_shows_the_plugins_only_while_its_list_shows() {
    carriers(the_manager_shows_the_plugins_only_while_its_list_shows_on);
}

fn the_manager_shows_the_plugins_only_while_its_list_shows_on() {
    let (harness, log) = open(&["./broken.ts"]);
    harness.tui.plugins.tell_plugins();
    settle(&harness);
    assert!(!harness.tui.dialogs.is_open(), "a change opened the manager");
    let read = reads(&log);
    harness.dispatch("plugins.list");
    harness.wait_for("skipped, local");
    harness.wait("the manager's read", || reads(&log) == read + 1);
    // No package: no check (review carbon-5: hidden, so the list's reply changes it in place).
    assert!(!harness.app.text().contains("check for updates"), "{}", harness.app.text());
    opencode_tui::plugins::host::add(&harness.tui, watcher().into());
    harness.wait_for("test.watch");
    // The skipped row's error, with a change under it.
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
    /// What [`watcher`] heard: the plugins as it read them, at each change.
    static HEARD: RefCell<Vec<Vec<String>>> = const { RefCell::new(Vec::new()) };
}

/// A plugin that logs the plugin list at each change it hears of, and one command that panics.
fn watcher() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.on_plugins(|host| HEARD.with_borrow_mut(|heard| heard.push(listed(&host.plugins()))));
        let command = Command { name: "watch.boom".to_owned(), ..Command::default() };
        setup.command(command, |_, _| panic!("the watcher's command panics"));
        Ok(())
    }
    abi::Plugin { id: "test.watch", setup }
}

/// A plugin that panics on its command, which the delivery steps fail.
fn boom() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "boom.boom".to_owned(), ..Command::default() }, |_, _| panic!("boom"));
        Ok(())
    }
    abi::Plugin { id: "test.boom", setup }
}

/// `id status` of each plugin, as a plugin reads them.
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

// Expected (`delivery`): a plugin that reads the plugin list hears every change of it once, in order, after the event
// that made it, and nothing when nothing changed: a toggle in the manager, a toggle of the host, a plugin added, one
// that fails, and steps that change nothing (the manager opened and closed, a change told twice). What it reads is the
// registry. Seeded walks of the steps.
#[test]
fn a_plugin_hears_each_change_of_the_plugin_list_once() {
    carriers(a_plugin_hears_each_change_of_the_plugin_list_once_on);
}

fn a_plugin_hears_each_change_of_the_plugin_list_once_on() {
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
                // Enter on the home footer plugin's row, as the user toggles it.
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

/// The builds of a plugin that takes the manager's ID, through the C ABI's byte shims: its `/plugins` shows an alert,
/// and its command panics.
struct Shadow;

impl Backend for Shadow {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        _: &[u8],
        _: &std::path::Path,
        _: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        fn shadow(setup: &mut abi::Setup) -> Result<(), String> {
            if SHADOW_FAILS.get() {
                return Err("the manager's setup fails".to_owned());
            }
            setup.command(Command { name: "shadow.boom".to_owned(), ..Command::default() }, |_, _| {
                panic!("the manager panics")
            });
            setup.command(Command { name: "plugins.list".to_owned(), ..Command::default() }, |host, _| {
                let message = "the replacement serves /plugins".to_owned();
                host.dialog(abi::Dialog::Alert(abi::Alert {
                    title: "Shadow plugins".to_owned(),
                    message,
                    action: None,
                }));
            });
            Ok(())
        }
        loopback_described(host, abi::export_plugin!(@loopback_described "opencode.plugins", shadow))
    }
}

thread_local! {
    /// The replacement manager's next setups fail.
    static SHADOW_FAILS: Cell<bool> = const { Cell::new(false) };
}

/// Fails the replacement manager and opens the host's list on its row.
fn fail_shadow(harness: &Harness) {
    harness.dispatch("shadow.boom");
    settle(harness);
    while harness.tui.toasts.current().is_some() {
        harness.tui.toasts.dismiss();
    }
    harness.dispatch("plugins.list");
    harness.wait_for("failed, enter enables it again");
    harness.app.type_text("opencode.plugins");
    settle(harness);
}

fn manager_status(harness: &Harness) -> opencode_plugin::Status {
    let key = opencode_plugin::Entry::plugin_key(ID);
    harness.tui.plugins.entries().into_iter().find(|entry| entry.key == key).unwrap().status
}

// Expected (synthesis 3.6, 4.10; deviation F16-plugin-manager-fallback; review bigboi-1, bigboi-3): while the manager
// has failed, `/plugins` is the host's read-only list. Its row for the manager starts it again on the user's key or
// click, never on a run of the submit by name (as a plugin's `dispatch` runs it); then the host's list goes and the
// manager that runs serves `/plugins` again. A row's error shows, with Back to the list.
#[test]
fn the_host_lists_the_plugins_while_the_manager_has_failed() {
    carriers(the_host_lists_the_plugins_while_the_manager_has_failed_on);
}

fn the_host_lists_the_plugins_while_the_manager_has_failed_on() {
    let (harness, _) = open_with(serde_json::json!({ "plugins": ["./broken.ts"] }), vec![crash().into()]);
    harness.dispatch("crash.boom");
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("manager");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(entry_file()), [1]).unwrap();
    let loader = Rc::new(Loader::new(Rc::new(Shadow), config, root.path().to_path_buf(), Vec::new()));
    harness.tui.plugins.set_loader(loader.clone());
    loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
    settle(&harness);
    harness.dispatch("plugins.list");
    harness.wait_for("Shadow plugins");
    harness.app.press("escape");
    settle(&harness);
    fail_shadow(&harness);
    // A row's error, and Back to the list on it.
    harness.app.press("escape");
    settle(&harness);
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("failed, enter enables it again");
    assert!(shown.contains("./broken.ts") && shown.contains("skipped"), "{shown}");
    harness.app.type_text("broken");
    settle(&harness);
    harness.app.press("enter");
    harness.wait_for("TUI plugin error");
    harness.app.press("escape");
    harness.wait_for("failed, enter enables it again");
    harness.app.press("escape");
    settle(&harness);
    // A failed built-in shows, in the error color; Back from its error is on its row.
    harness.dispatch("plugins.list");
    harness.wait_for("test.crash");
    let error = harness.tui.page().text.feedback.error.base;
    let line = harness.app.text().lines().position(|line| line.contains("test.crash")).unwrap() as u16;
    let column = harness.app.text().lines().nth(usize::from(line)).unwrap().find("failed").unwrap() as u32;
    assert_eq!(harness.app.render().cell(column, u32::from(line)).unwrap().fg, error);
    for _ in 0..harness.app.text().lines().filter(|line| line.contains("test.") || line.contains("opencode.")).count() {
        if harness.app.text().lines().any(|line| line.contains('┃') && line.contains("test.crash")) {
            break;
        }
        harness.app.press("down");
        settle(&harness);
    }
    harness.app.press("space");
    harness.wait_for("TUI plugin error");
    harness.app.press("escape");
    harness.wait("Back on the failed built-in's row", || {
        harness.app.text().lines().any(|line| line.contains('┃') && line.contains("test.crash"))
    });
    harness.app.press("escape");
    settle(&harness);
    // A restart whose setup fails leaves the manager failed and the host's list up (review carbon-3).
    fail_shadow(&harness);
    SHADOW_FAILS.set(true);
    harness.app.press("enter");
    settle(&harness);
    SHADOW_FAILS.set(false);
    assert!(
        matches!(manager_status(&harness), opencode_plugin::Status::Failed(_)),
        "a failed restart listed it inactive"
    );
    while harness.tui.toasts.current().is_some() {
        harness.tui.toasts.dismiss();
    }
    harness.dispatch("plugins.list");
    harness.wait_for("failed, enter enables it again");
    // Its own error shows on its own key.
    harness.app.type_text("opencode.plugins");
    settle(&harness);
    harness.app.press("space");
    harness.wait_for("the manager panics");
    harness.app.press("escape");
    settle(&harness);
    harness.app.press("escape");
    settle(&harness);
    // A run of the submit by name starts nothing.
    harness.dispatch("plugins.list");
    harness.wait_for("failed, enter enables it again");
    harness.app.type_text("opencode.plugins");
    settle(&harness);
    harness.dispatch("dialog.select.submit");
    settle(&harness);
    assert!(matches!(manager_status(&harness), opencode_plugin::Status::Failed(_)), "a submit by name restarted it");
    // The user's enter does, and the manager that runs serves `/plugins`.
    harness.app.press("enter");
    settle(&harness);
    assert_eq!(manager_status(&harness), opencode_plugin::Status::Active);
    harness.dispatch("plugins.list");
    harness.wait_for("Shadow plugins");
    harness.app.press("escape");
    settle(&harness);
    // So does a click on its row.
    fail_shadow(&harness);
    let (x, y) = harness.find("enter enables it again");
    harness.app.click(x, y);
    settle(&harness);
    assert_eq!(manager_status(&harness), opencode_plugin::Status::Active);
    harness.dispatch("plugins.list");
    harness.wait_for("Shadow plugins");
}

/// A built-in whose command panics.
fn crash() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "crash.boom".to_owned(), ..Command::default() }, |_, _| panic!("crash"));
        Ok(())
    }
    abi::Plugin { id: "test.crash", setup }
}

/// The builds of a plugin `test.ext`, through the C ABI's byte shims.
struct Ext;

impl Backend for Ext {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        _: &[u8],
        _: &std::path::Path,
        _: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        fn ext(_: &mut abi::Setup) -> Result<(), String> {
            Ok(())
        }
        loopback_described(host, abi::export_plugin!(@loopback_described "test.ext", ext))
    }
}

// Expected (TS `plugins.tsx`): a failed built-in shows while the built-ins are hidden, failed, with `view error` on its
// own key beside its toggle, which disables it as it is still active, and not on enter; and the filter finds a plugin
// by its target, not only by its title.
#[test]
fn a_failed_built_in_shows_and_a_plugin_is_found_by_its_target() {
    carriers(a_failed_built_in_shows_and_a_plugin_is_found_by_its_target_on);
}

fn a_failed_built_in_shows_and_a_plugin_is_found_by_its_target_on() {
    let (harness, _) = open_with(serde_json::json!({}), vec![crash().into()]);
    harness.dispatch("crash.boom");
    settle(&harness);
    while harness.tui.toasts.current().is_some() {
        harness.tui.toasts.dismiss();
    }
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("show internal");
    let row = shown.lines().find(|line| line.contains("test.crash")).unwrap_or_else(|| panic!("{shown}"));
    assert!(row.contains("failed") && !shown.contains("opencode.stats"), "{shown}");
    harness.app.type_text("test.crash");
    let shown = harness.wait_for("view error space");
    assert!(shown.contains("disable enter") && !shown.contains("view error enter"), "{shown}");
    harness.app.press("escape");
    settle(&harness);
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("ext-dir");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(entry_file()), [1]).unwrap();
    let loader = Rc::new(Loader::new(Rc::new(Ext), config, root.path().to_path_buf(), Vec::new()));
    harness.tui.plugins.set_loader(loader.clone());
    loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
    settle(&harness);
    harness.dispatch("plugins.list");
    harness.wait_for("test.ext");
    harness.app.type_text("ext-dir");
    let shown = harness.wait_for("test.ext");
    assert!(!shown.contains("test.crash"), "{shown}");
}

/// The builds of a plugin that takes `0`'s ID, through the C ABI's byte shims; its setup does nothing.
struct Named(&'static str);

impl Backend for Named {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        _: &[u8],
        _: &std::path::Path,
        _: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        fn named(_: &mut abi::Setup) -> Result<(), String> {
            Ok(())
        }
        match self.0 {
            "opencode.stats" => {
                loopback_described(host, abi::export_plugin!(@loopback_described "opencode.stats", named))
            }
            _ => loopback_described(host, abi::export_plugin!(@loopback_described "opencode.plugins", named)),
        }
    }
}

/// A build of a plugin of ID `id`, which crashed the client last time, held back as the client starts again; and its
/// target. The loader's digest of the bytes `[1]` with no options names the build.
fn held_crash(harness: &Harness, id: &'static str) -> (Rc<Loader>, String, opencode_util::temp::TempDir) {
    use std::hash::Hasher;
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("held-build");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(entry_file()), [1]).unwrap();
    let mut hasher = std::hash::DefaultHasher::new();
    hasher.write(&[1]);
    hasher.write(b"");
    let target = dir.to_string_lossy().into_owned();
    let crashed = opencode_plugin::Crashed {
        id: id.to_owned(),
        target: target.clone(),
        digest: format!("{:016x}", hasher.finish()),
        reason: "crashed the client in `run-command` and is disabled".to_owned(),
    };
    harness.tui.plugins.set_crashed(vec![crashed], |_| Ok(()));
    let loader = Rc::new(Loader::new(Rc::new(Named(id)), config, root.path().to_path_buf(), Vec::new()));
    harness.tui.plugins.set_loader(loader.clone());
    loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
    settle(harness);
    (loader, target, root)
}

fn status_of(harness: &Harness, key: &str) -> Option<(opencode_plugin::Status, bool)> {
    let entries = harness.tui.plugins.entries();
    entries.into_iter().find(|entry| entry.key == key).map(|entry| (entry.status, entry.active))
}

// Expected (review bigboi-3): a build held back after a crash that shares its ID with a running built-in is a row of
// its own: enter on it releases that build and leaves the built-in running, and the build loads next. A held build of
// the manager's ID does not put up the host's list, is a row of the manager that serves `/plugins`, and is released
// the same way (review carbon-3).
#[test]
fn a_held_build_that_shares_an_id_is_a_row_of_its_own() {
    carriers(a_held_build_that_shares_an_id_is_a_row_of_its_own_on);
}

fn a_held_build_that_shares_an_id_is_a_row_of_its_own_on() {
    let (harness, _) = open(&[]);
    let (loader, target, _root) = held_crash(&harness, "opencode.stats");
    let held = opencode_plugin::Entry::held_key(&target);
    assert!(matches!(status_of(&harness, &held), Some((opencode_plugin::Status::Failed(_), false))));
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
    harness.app.type_text("held-build");
    let shown = harness.wait_for("enable enter");
    assert!(shown.contains("opencode.stats") && shown.contains("failed"), "{shown}");
    harness.app.press("enter");
    settle(&harness);
    assert_eq!(status_of(&harness, "plugin:opencode.stats"), Some((opencode_plugin::Status::Active, true)));
    assert_eq!(status_of(&harness, &held), None, "the held build stayed");
    loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
    assert!(!harness.tui.plugins.held(&target));

    let (harness, _) = open(&[]);
    let (_loader, target, _root) = held_crash(&harness, ID);
    harness.dispatch("plugins.list");
    harness.wait_for("show internal");
    harness.app.type_text("held-build");
    // Listed by the manager that runs, not by the host's list.
    let shown = harness.wait_for("enable enter");
    assert!(shown.contains("show internal") && !shown.contains("enables it again"), "{shown}");
    // The user may release it, as any held build: the manager that runs is untouched until it loads.
    harness.app.press("enter");
    settle(&harness);
    assert_eq!(
        status_of(&harness, &opencode_plugin::Entry::plugin_key(ID)),
        Some((opencode_plugin::Status::Active, true))
    );
    assert!(!harness.tui.plugins.held(&target), "the held build stayed");
}

thread_local! {
    /// What [`reader`] read of the plugin list, as JSON.
    static READ: RefCell<String> = const { RefCell::new(String::new()) };
}

/// A plugin that reads the plugin list as it changes and on its command.
fn reader() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        let read = |host: &dyn abi::Read| READ.set(serde_json::to_string(&host.plugins()).unwrap());
        setup.on_plugins(move |host| read(host));
        setup.command(Command { name: "reader.read".to_owned(), ..Command::default() }, move |host, _| read(host));
        Ok(())
    }
    abi::Plugin { id: "test.reader", setup }
}

/// Plugins whose setup fails, and whose command panics, each with a private marker.
fn secrets() -> [abi::Plugin; 2] {
    fn setup(_: &mut abi::Setup) -> Result<(), String> {
        Err("SECRET-setup /home/user/.token".to_owned())
    }
    fn run(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "secret.run".to_owned(), ..Command::default() }, |_, _| panic!("SECRET-run"));
        Ok(())
    }
    [abi::Plugin { id: "test.setup", setup }, abi::Plugin { id: "test.run", setup: run }]
}

/// A build that fails to load, with a private marker.
struct Unloadable;

impl Backend for Unloadable {
    fn load(
        &self,
        _: &Rc<dyn Host>,
        _: &[u8],
        _: &std::path::Path,
        _: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        Err("SECRET-load".to_owned())
    }
}

// Expected (review bigboi-2, synthesis 3.6): the plugin list a plugin reads, linked or over the C ABI, holds no error
// text of another plugin: not a setup's, a panic's or a load's. The user still sees each in the manager's error view,
// which the host fills.
#[test]
fn the_plugin_list_holds_no_error_text() {
    for abi in [false, true] {
        let (harness, _) = open(&[]);
        let read = match abi {
            false => opencode_plugin::Builtin::Plugin(reader()),
            true => opencode_plugin::Builtin::Abi(reader()),
        };
        opencode_tui::plugins::host::add(&harness.tui, read.into());
        for plugin in secrets() {
            opencode_tui::plugins::host::add(&harness.tui, plugin.into());
        }
        harness.dispatch("secret.run");
        let root = opencode_util::temp::tempdir().unwrap();
        std::fs::create_dir(root.path().join(".git")).unwrap();
        let config = root.path().join("config");
        let dir = config.join("plugins").join("unloadable");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(entry_file()), [1]).unwrap();
        let loader = Rc::new(Loader::new(Rc::new(Unloadable), config, root.path().to_path_buf(), Vec::new()));
        harness.tui.plugins.set_loader(loader.clone());
        loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
        settle(&harness);
        harness.dispatch("reader.read");
        settle(&harness);
        let read = READ.take();
        assert!(read.contains("test.setup") && read.contains("test.run") && read.contains("unloadable"), "{read}");
        assert!(!read.contains("SECRET") && !read.contains(".token"), "abi {abi}: {read}");
        let errors: Vec<String> = harness
            .tui
            .plugins
            .entries()
            .into_iter()
            .filter_map(|entry| match entry.status {
                opencode_plugin::Status::Failed(error) => Some(error),
                _ => None,
            })
            .collect();
        assert_eq!(errors.iter().filter(|error| error.contains("SECRET")).count(), 3, "{errors:?}");
        while harness.tui.toasts.current().is_some() {
            harness.tui.toasts.dismiss();
        }
        harness.dispatch("plugins.list");
        harness.wait_for("show internal");
        harness.app.type_text("test.setup");
        harness.wait_for("view error space");
        harness.app.press("space");
        harness.wait_for("SECRET-setup");
    }
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

// Expected (review bigboi-6, TS `createResource`): the manager shows the newest read of the server plugins, also when
// an older one, of the same open or an earlier one, answers after it.
#[test]
fn the_newest_server_list_shows_whatever_order_the_replies_come_in() {
    carriers(the_newest_server_list_shows_whatever_order_the_replies_come_in_on);
}

fn the_newest_server_list_shows_whatever_order_the_replies_come_in_on() {
    use opencode_api::memory::{Memory, Route as MemoryRoute};
    let memory = Memory::new(vec![
        MemoryRoute::json("GET", "/api/location", 200, &support::location("/tmp/app")),
        MemoryRoute::json("GET", "/api/session", 200, &serde_json::json!({ "data": [], "cursor": {} })),
    ]);
    let gated = Arc::new(Gated { inner: memory.clone(), held: Default::default() });
    let deps = Deps { route: Route::Home, events: true, abi_builtins: ABI.get(), ..support::deps(gated.clone()) };
    let harness = support::mount(100, 30, deps);
    opencode_tui::features::location::navigate_home(&harness.tui, Some(opencode_store::Location::new("/tmp/other")));
    settle(&harness);
    // In one open: its read, then a read on `plugin.updated`.
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

/// A plugin that does nothing, under `id`.
fn quiet(id: &'static str) -> abi::Plugin {
    fn setup(_: &mut abi::Setup) -> Result<(), String> {
        Ok(())
    }
    abi::Plugin { id, setup }
}

// Expected (review bigboi-7): in one filtered open, on both carriers, each enter toggles the selected plugin alone and
// the selection stays on its row; a plugin that fails while the list shows shows failed on its row, the selection
// stays, and the others' registrations are unchanged; enter on it then disables it.
#[test]
fn toggles_in_one_filtered_open_reach_the_selected_plugin_alone() {
    for abi in [false, true] {
        let deps = Deps { route: Route::Home, abi_builtins: abi, ..support::deps(Arc::new(support::empty())) };
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
        assert!(row(&harness, "test.a").contains("inactive"), "abi {abi}: {}", harness.app.text());
        assert_eq!(selected(&harness), "test.a", "abi {abi}");
        assert_eq!(state(&harness).iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, true, true]);
        harness.app.press("down");
        harness.app.press("enter");
        settle(&harness);
        assert_eq!(selected(&harness), "test.b", "abi {abi}");
        assert_eq!(state(&harness).iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, false, true]);
        harness.app.press("down");
        settle(&harness);
        harness.dispatch("boom.boom");
        settle(&harness);
        assert!(row(&harness, "test.boom").contains("failed"), "abi {abi}: {}", harness.app.text());
        assert_eq!(selected(&harness), "test.boom", "abi {abi}");
        assert!(state(&harness)[2].0.contains("Failed") && state(&harness)[2].1);
        assert_eq!(state(&harness)[..2].iter().map(|(_, active)| *active).collect::<Vec<_>>(), [false, false]);
        harness.app.press("enter");
        settle(&harness);
        assert!(!state(&harness)[2].1, "abi {abi}: the failed plugin stayed active");
        assert_eq!(selected(&harness), "test.boom", "abi {abi}");
    }
}

thread_local! {
    /// The runs of the picker's own actions.
    static PICKED: Cell<u32> = const { Cell::new(0) };
}

/// A plugin whose keyless select has a row that toggles the plugin of the target its command is given, and actions and
/// keys the host cannot bind or must not let it take.
fn picker() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "picker.picked".to_owned(), ..Command::default() }, |_, _| {
            PICKED.set(PICKED.get() + 1);
        });
        setup.command(Command { name: "picker.open".to_owned(), ..Command::default() }, |host, input| {
            let picked = abi::Action::Command { name: "picker.picked".to_owned(), input: None };
            let row =
                abi::SelectOption { toggle: input.map(str::to_owned), ..abi::SelectOption::new("other row", "r") };
            let bad = |command: Option<&str>, key: Option<&str>| abi::SelectAction {
                title: "bad".to_owned(),
                key: key.map(str::to_owned),
                action: picked.clone(),
                hidden: Vec::new(),
                primary: None,
                rowless: false,
                command: command.map(str::to_owned),
                disabled: false,
                hidden_all: false,
            };
            let mut select = abi::Select::new("Picker", vec![row], picked.clone());
            select.actions = vec![
                bad(Some(""), None),
                bad(None, Some("")),
                bad(Some("plugins.toggle"), Some("escape")),
                bad(Some("dialog.select.submit"), Some("f9")),
            ];
            select.binds = vec![abi::PanelBind { key: " ".to_owned(), title: "bad".to_owned(), action: picked }];
            host.dialog(abi::Dialog::Select(select));
        });
        Ok(())
    }
    abi::Plugin { id: "test.picker", setup }
}

// Expected (review carbon-1, carbon-2): a select's action with an empty keybind name or key, or a key the host cannot
// bind, is left out and the TUI runs on; one that names the host's `plugins.toggle` or a select command of the host is
// left out too, so the user's remapped toggle is the host's, with its real key. A keyless select's row names a plugin
// by its target, and the toggle reaches it.
#[test]
fn a_select_cannot_break_or_take_the_hosts_keys() {
    carriers(a_select_cannot_break_or_take_the_hosts_keys_on);
}

fn a_select_cannot_break_or_take_the_hosts_keys_on() {
    let (harness, _) = open_with(serde_json::json!({ "keybinds": { "plugins.toggle": "ctrl+t" } }), Vec::new());
    opencode_tui::plugins::host::add(&harness.tui, picker().into());
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let config = root.path().join("config");
    let dir = config.join("plugins").join("ext-dir");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(entry_file()), [1]).unwrap();
    let loader = Rc::new(Loader::new(Rc::new(Ext), config, root.path().to_path_buf(), Vec::new()));
    harness.tui.plugins.set_loader(loader.clone());
    loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
    settle(&harness);
    PICKED.set(0);
    harness.tui.keymap.dispatch("picker.open", Some(&dir.to_string_lossy()));
    let shown = harness.wait_for("Picker");
    assert!(shown.contains("disable test.ext ctrl+t") && !shown.contains("bad"), "{shown}");
    harness.app.press("ctrl+t");
    settle(&harness);
    assert_eq!(status_of(&harness, "plugin:test.ext").map(|(_, active)| active), Some(false));
    assert_eq!(PICKED.get(), 0);
    harness.app.press("escape");
    settle(&harness);
    assert!(!harness.tui.dialogs.is_open() && PICKED.get() == 0, "{}", harness.app.text());
}

// Expected (review carbon-5): the manager's own commands act only while its list shows: run by name with no list
// they open nothing and read nothing.
#[test]
fn the_managers_own_commands_open_nothing() {
    carriers(the_managers_own_commands_open_nothing_on);
}

fn the_managers_own_commands_open_nothing_on() {
    let (harness, log) = open(&[]);
    let read = reads(&log);
    for name in ["internal", "check", "update", "error", "back", "asked"] {
        harness.tui.keymap.dispatch(&format!("opencode.plugins.{name}"), Some("tui:plugin:opencode.stats"));
        settle(&harness);
        assert!(!harness.tui.dialogs.is_open(), "{name}: {}", harness.app.text());
    }
    assert_eq!(reads(&log), read);
}

// Expected (review carbon-3): the slow toast of the manager offers no Disable, which would leave no `/plugins`; another
// plugin's does.
#[test]
fn the_slow_manager_cannot_be_disabled_from_its_toast() {
    carriers(the_slow_manager_cannot_be_disabled_from_its_toast_on);
}

fn the_slow_manager_cannot_be_disabled_from_its_toast_on() {
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

// Expected (review carbon-4): a `plugins` entry added to the config while the TUI runs, which loads nothing and is
// listed skipped, reaches a plugin that reads the plugin list.
#[test]
fn a_skipped_entry_added_to_the_config_is_heard() {
    carriers(a_skipped_entry_added_to_the_config_is_heard_on);
}

fn a_skipped_entry_added_to_the_config_is_heard_on() {
    let (harness, _) = open(&[]);
    let root = opencode_util::temp::tempdir().unwrap();
    std::fs::create_dir(root.path().join(".git")).unwrap();
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
        dev: Vec::new(),
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
    let deps = Deps { route: Route::Home, abi_builtins: ABI.get(), ..support::deps(Arc::new(fake)) };
    let harness = support::mount(100, 30, deps);
    settle(&harness);
    (harness, log)
}

// Expected (TS `plugins.tsx`; review carbon-5, carbon-6): a failed outdated package lists update before view error, as
// TS's footer does; a package the server updates shows `updating` with the spinner; a check or an update that fails
// toasts the server's message, and the check says `checking for updates` while it runs, once however often it is asked.
#[test]
fn the_server_rows_follow_typescript() {
    carriers(the_server_rows_follow_typescript_on);
}

fn the_server_rows_follow_typescript_on() {
    let failed = serde_json::json!({ "state": { "status": "failed", "error": "boom" } });
    let opened: Gate = Arc::new((std::sync::Mutex::new(true), std::sync::Condvar::new()));
    let (harness, _) = open_on(package_server(failed, 500, opened.clone()));
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("update ctrl+u");
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
    harness.wait_for("update available");
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

// Expected (review carbon-6): a handler of the plugin list is a contained call named `on-plugins`: one that panics fails
// its plugin with that name, linked and across the C ABI.
#[test]
fn a_panicking_plugin_list_handler_fails_its_plugin() {
    for abi in [false, true] {
        let (harness, _) = open(&[]);
        let plugin = match abi {
            false => opencode_plugin::Builtin::Plugin(panicky()),
            true => opencode_plugin::Builtin::Abi(panicky()),
        };
        opencode_tui::plugins::host::add(&harness.tui, plugin.into());
        opencode_tui::plugins::host::add(&harness.tui, quiet("test.a").into());
        settle(&harness);
        let status = status_of(&harness, "plugin:test.panicky").unwrap().0;
        let opencode_plugin::Status::Failed(error) = status else { panic!("abi {abi}: {status:?}") };
        assert!(error.contains("on-plugins"), "abi {abi}: {error}");
    }
}

thread_local! {
    /// The time the monitor reads in [`a_plugin_hears_when_a_plugin_becomes_slow_and_stops`], and what a call of
    /// `slowly.work` takes on it.
    static CLOCK: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    static COST: Cell<Duration> = const { Cell::new(Duration::ZERO) };
}

/// A plugin whose command takes [`COST`] on [`CLOCK`].
fn slowly() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "slowly.work".to_owned(), ..Command::default() }, |_, _| {
            CLOCK.set(CLOCK.get() + COST.get());
        });
        Ok(())
    }
    abi::Plugin { id: "test.slowly", setup }
}

// Expected (review carbon-4): a plugin that reads the plugin list hears each time a plugin becomes slow and stops, the
// second time too, which no toast tells; and nothing when only what a slow frame costs changed.
#[test]
fn a_plugin_hears_when_a_plugin_becomes_slow_and_stops() {
    carriers(a_plugin_hears_when_a_plugin_becomes_slow_and_stops_on);
}

fn a_plugin_hears_when_a_plugin_becomes_slow_and_stops_on() {
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
    // Slower frames change the cost, not that it is slow.
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

/// A plugin whose keyed select takes its title from its command's input.
fn titled() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(Command { name: "titled.show".to_owned(), ..Command::default() }, |host, input| {
            let action = abi::Action::Command { name: "titled.show".to_owned(), input: None };
            let mut select =
                abi::Select::new(input.unwrap_or_default(), vec![abi::SelectOption::new("row", "r")], action);
            select.key = Some("t".to_owned());
            host.dialog(abi::Dialog::Select(select));
        });
        Ok(())
    }
    abi::Plugin { id: "test.titled", setup }
}

// Expected (review carbon-5): a keyed select shown again with another title shows it.
#[test]
fn a_keyed_select_shown_again_takes_its_new_title() {
    let (harness, _) = open(&[]);
    opencode_tui::plugins::host::add(&harness.tui, titled().into());
    harness.tui.keymap.dispatch("titled.show", Some("First title"));
    harness.wait_for("First title");
    harness.tui.keymap.dispatch("titled.show", Some("Second title"));
    harness.wait_for("Second title");
}
