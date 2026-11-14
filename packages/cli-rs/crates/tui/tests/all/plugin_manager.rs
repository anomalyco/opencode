//! The plugin manager as a plugin of contract 2.0 (P6b, synthesis 4.10 and 4.14): what it holds once it is disabled
//! (`ledger`), when it hears of the plugins and what it shows then (`lifecycle`), what a plugin that reads the plugin
//! list hears (`delivery`), and the host's own `/plugins` while the manager has failed. Its frames against TS and the
//! requests it sends are `system`'s named tests; its keys are the shared fixture's (`plugin_machines`).

use std::cell::RefCell;
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

/// Home with the plugin list of `plugins`, over a server that answers `/api/plugin` with no plugin; and its log.
fn open(plugins: &[&str]) -> (Harness, Log) {
    let fake = Fake::new(|seen| match seen.path.as_str() {
        "/api/plugin" => (200, serde_json::json!({ "location": support::location("/tmp/app"), "data": [] })),
        _ => support::base(seen, "/tmp/app"),
    });
    let log = fake.log();
    let config = serde_json::json!({ "animations": false, "plugins": plugins });
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&config.to_string())),
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(100, 30, deps);
    settle(&harness);
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
    let (harness, log) = open(&["./broken.ts"]);
    harness.tui.plugins.tell_plugins();
    settle(&harness);
    assert!(!harness.tui.dialogs.is_open(), "a change opened the manager");
    let read = reads(&log);
    harness.dispatch("plugins.list");
    harness.wait_for("skipped, local");
    harness.wait("the manager's read", || reads(&log) == read + 1);
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
    plugins.iter().map(|entry| format!("{} {:?} {}", entry.id, entry.status, entry.active)).collect()
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
            format!("{} {status:?} {}", entry.id, entry.active)
        })
        .collect()
}

// Expected (`delivery`): a plugin that reads the plugin list hears every change of it once, in order, after the event
// that made it, and nothing when nothing changed: a toggle in the manager, a toggle of the host, a plugin added, one
// that fails, and steps that change nothing (the manager opened and closed, a change told twice). What it reads is the
// registry. Seeded walks of the steps.
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

/// The builds of a plugin that takes the manager's ID, through the C ABI's byte shims; its command panics.
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
            let command = Command { name: "shadow.boom".to_owned(), ..Command::default() };
            setup.command(command, |_, _| panic!("the manager panics"));
            Ok(())
        }
        loopback_described(host, abi::export_plugin!(@loopback_described "opencode.plugins", shadow))
    }
}

// Expected (synthesis 3.6, 4.10; deviation F16-plugin-manager-fallback): while the manager has failed, `/plugins` is
// the host's read-only list, whose row for the manager starts it again; then the host's list goes. A manager that is
// running, or one the user disabled, has no such list.
#[test]
fn the_host_lists_the_plugins_while_the_manager_has_failed() {
    let (harness, _) = open(&["./broken.ts"]);
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
    // A manager of the same ID replaced the built-in, with no `/plugins` of its own; no host list either.
    assert!(!commands(&harness).contains("plugins.list"));
    harness.dispatch("shadow.boom");
    settle(&harness);
    while harness.tui.toasts.current().is_some() {
        harness.tui.toasts.dismiss();
    }
    harness.dispatch("plugins.list");
    let shown = harness.wait_for("failed, enter enables it again");
    assert!(shown.contains("./broken.ts") && shown.contains("skipped"), "{shown}");
    // A row's error, and Back to the list on it.
    harness.app.type_text("broken");
    settle(&harness);
    harness.app.press("enter");
    harness.wait_for("TUI plugin error");
    harness.app.press("escape");
    harness.wait_for("failed, enter enables it again");
    harness.app.press("escape");
    settle(&harness);
    // The manager's row starts it again.
    harness.dispatch("plugins.list");
    harness.wait_for("failed, enter enables it again");
    harness.app.type_text("opencode.plugins");
    settle(&harness);
    harness.app.press("enter");
    settle(&harness);
    let entry = harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).unwrap();
    assert_eq!(entry.status, opencode_plugin::Status::Active);
    assert!(!commands(&harness).contains("plugins.list"), "the host's list stayed");
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
    let mut builtins = support::deps(Arc::new(support::empty())).builtins;
    builtins.push(crash().into());
    let deps = Deps { route: Route::Home, builtins, ..support::deps(Arc::new(support::empty())) };
    let harness = support::mount(100, 30, deps);
    settle(&harness);
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
