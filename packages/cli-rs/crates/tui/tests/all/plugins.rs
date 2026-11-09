//! External native plugins (P.4) in the real TUI: the sample plugin found in a `plugins` directory renders its
//! fence in a transcript and its slot on the home screen, reloads when it is rebuilt, a panic shows as failed in
//! the plugin manager while the TUI keeps running, and a major ABI mismatch is refused there with its reason.
//! Config and state live in temp directories. The real TUI calls `external` from `opencode-rs` (`commands/default.rs`).

use crate::support::{self, Fake, Harness, deref_harness};

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::loader::entry_file;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// The sample plugin (`crates/plugin/examples/sample`) built with `features`, once per test run.
fn build(features: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some((_, library)) = built.iter().find(|(known, _)| known == features) {
        return library.clone();
    }
    let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/sample");
    let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/sample-plugin");
    let status = Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(sample.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .args(["--features", features])
        .status()
        .unwrap();
    assert!(status.success(), "the sample plugin did not build");
    let name = format!("{}opencode_sample_plugin{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join("debug").join(name)).unwrap();
    built.push((features.to_owned(), library.clone()));
    library
}

/// Serves one session whose assistant reply is `text`.
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

struct Plugins {
    harness: Harness,
    plugin: std::path::PathBuf,
    _root: opencode_util::temp::TempDir,
}

deref_harness!(Plugins);

/// The TUI on `route` with the sample's `build` in `<config>/plugins/sample`.
fn open(route: Route, text: &str, build: &[u8]) -> Plugins {
    open_with(route, text, build, |_| None)
}

/// [`open`], with the roots `roots` gives for the temp directory.
fn open_with(
    route: Route,
    text: &str,
    build: &[u8],
    roots: impl FnOnce(&Path) -> Option<opencode_tui::app::Roots>,
) -> Plugins {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let plugin = config.join("plugins/sample");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join(entry_file()), build).unwrap();
    let deps = Deps { route, roots: roots(root.path()), ..support::deps(Arc::new(fake(text.to_owned()))) };
    let harness = support::mount(80, 24, deps);
    external(&harness.tui, External { config_dir: config, cwd: root.path().to_path_buf() });
    Plugins { harness, plugin, _root: root }
}

fn session_route() -> Route {
    support::session_route("ses_p")
}

impl Plugins {
    fn status(&self) -> opencode_plugin::Status {
        let target = self.plugin.to_string_lossy();
        self.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&*target)).unwrap().status
    }
}

#[test]
fn the_sample_renders_in_the_transcript_and_reloads_on_change() {
    let h = open(session_route(), "Here:\n\n```sample\nhello plugin\n```", &build(""));
    let screen = h.wait_for("SAMPLE v1 HELLO PLUGIN");
    assert!(!screen.contains("hello plugin"), "{screen}");
    assert_eq!(h.status(), opencode_plugin::Status::Active);

    // A new build in place: the watcher reconciles, the route remounts, and the transcript draws v2.
    write_atomic(&h.plugin.join(entry_file()), &build("v2"));
    h.wait_for("SAMPLE v2 HELLO PLUGIN");
}

#[test]
fn the_sample_claims_the_home_footer_and_runs_its_command() {
    let h = open(Route::Home, "", &build(""));
    h.wait_for("sample plugin v1: home.footer");
    h.tui.keymap.dispatch("sample.open", None);
    h.wait_for("Sample route hello");
    assert!(matches!(h.tui.route(), Route::Plugin { ref id, ref name } if id == "sample" && name == "hello"));
    // Without storage the command still toasts.
    h.tui.keymap.dispatch("sample.hello", None);
    h.wait_for("Hello from sample v1 (1)");
    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("disable enter");
    let row = screen
        .lines()
        .find(|line| line.contains("sample") && line.contains("local"))
        .unwrap_or_else(|| panic!("no sample row:\n{screen}"));
    // An active plugin shows only its origin, as in TS.
    assert!(row.trim_end().ends_with("local") && !row.contains("failed"), "{screen}");
    print_excerpt("plugin manager with the sample active", &screen);
}

// Expected: an external slot claim asks for its rows again with each change batch, so it shows state the plugin
// changed since it was mounted. The `still` build starts no ticker, so only the change batch draws it again.
#[test]
fn an_external_claim_draws_again_on_a_change_batch() {
    let h = open(Route::Home, "", &build("still"));
    h.wait_for("home.footer, 0 hellos");
    h.tui.keymap.dispatch("sample.hello", None);
    h.wait_for("Hello from sample v1 (1)");
    let event = json!({
        "id": "evt_1", "created": 10_000, "type": "session.execution.started",
        "durable": { "aggregateID": "ses_p", "seq": 1, "version": 1 },
        "data": { "sessionID": "ses_p" },
    });
    h.tui.data.apply(&[serde_json::from_value(event).unwrap()]);
    h.wait_for("home.footer, 1 hellos");
}

#[test]
fn a_panicking_plugin_shows_as_failed_in_the_plugin_manager() {
    let h = open(session_route(), "Crash:\n\n```sample-panic\nboom\n```", &build(""));
    // The fence falls back to the code view and the TUI keeps running.
    let screen = h.wait_for("boom");
    assert!(!screen.contains("SAMPLE"), "{screen}");
    h.wait_for("Plugin failed: sample");
    let opencode_plugin::Status::Failed(error) = h.status() else {
        panic!("{:?}", h.status());
    };
    assert_eq!(error, "render-fence panicked: sample fence panicked");

    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("Plugins");
    let row = screen
        .lines()
        .find(|line| line.contains("sample") && line.contains("local"))
        .unwrap_or_else(|| panic!("no sample row:\n{screen}"));
    assert!(row.contains("failed"), "{screen}");
    print_excerpt("plugin manager", &screen);
}

#[test]
fn a_panicking_command_is_caught_and_enabling_restarts_the_plugin() {
    let h = open(Route::Home, "", &build(""));
    h.wait_for("sample plugin v1: home.footer");
    h.tui.keymap.dispatch("sample.panic", None);
    assert_eq!(h.status(), opencode_plugin::Status::Failed("run-command panicked: sample command panicked".to_owned()));
    // Its claims draw empty, and the toast offers the plugin manager, as in TS.
    let screen = h.wait_for("Plugin failed: sample");
    assert!(screen.contains("Open plugins") && !screen.contains("sample plugin v1: home.footer"), "{screen}");
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("view error space");
    h.app.press("space");
    let screen = h.wait_for("run-command panicked: sample command panicked");
    print_excerpt("error details after a panic", &screen);
    h.app.press("escape");
    // A plugin that failed while active is still active, as in TS: enter disables it, then enables it afresh.
    h.wait_for("disable enter");
    h.app.press("enter");
    h.app.wait_until(Duration::from_secs(5), || h.status() == opencode_plugin::Status::Inactive);
    assert_eq!(h.status(), opencode_plugin::Status::Inactive);
    h.wait_for("enable enter");
    h.app.press("enter");
    h.app.wait_until(Duration::from_secs(5), || h.status() == opencode_plugin::Status::Active);
    assert_eq!(h.status(), opencode_plugin::Status::Active);
}

#[test]
fn a_major_abi_mismatch_is_refused_with_its_reason() {
    let h = open(Route::Home, "", &build("major-2"));
    let opencode_plugin::Status::Failed(error) = h.status() else {
        panic!("{:?}", h.status());
    };
    assert!(error.starts_with("plugin ABI 2.0 is not supported"), "{error}");
    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("failed, local");
    assert!(!screen.contains("sample plugin v1"), "{screen}");
    print_excerpt("plugin manager with a major mismatch", &screen);
    // A plugin that never loaded cannot be toggled, so enter opens its error.
    h.app.press("enter");
    let screen = h.wait_for("plugin ABI 2.0 is not supported");
    print_excerpt("error details of a major mismatch", &screen);
}

// Expected: a plugin built on the frozen 1.3 SDK, which stores objects or arrays, stores an array in real TUI storage,
// reads it back at once, and finds it on disk (bigboi-3).
#[test]
fn a_1_3_plugin_stores_an_array() {
    let h = open_with(Route::Home, "", &build("abi-1-3"), |root| {
        support::roots(support::home_paths(&root.join("home")), "test")
    });
    h.wait_for("sample plugin 1.3: home.footer");
    let storage = h.tui.storage().unwrap();
    let file = storage.file("plugin.sample.list").unwrap();
    opencode_local::storage::write_json_atomic(&file, &json!([7])).unwrap();
    h.tui.keymap.dispatch("sample.list", None);
    h.wait_for("list [7] then [1,2]");
    let written = h
        .app
        .wait_until(support::WAIT, || storage.load("plugin.sample.list", &Value::Null).ok() == Some(json!([1, 2])));
    assert!(written, "{:?}", storage.load("plugin.sample.list", &Value::Null));
}

// Expected: a plugin that fails to load shows TS's error toast, which offers to open the plugin manager, and the home
// footer counts it (carbon-5).
#[test]
fn a_plugin_that_fails_to_load_shows_a_toast_and_the_footer_counts_it() {
    let h = open(Route::Home, "", &build("major-2"));
    let screen = h.wait_for("Plugin failed:");
    assert!(screen.contains("Open plugins"), "{screen}");
    h.wait_for("⊙ 1 plugin failed");
}

/// Replaces `path` as editors and build tools do: a new file renamed over the old one.
fn write_atomic(path: &Path, bytes: &[u8]) {
    let next = path.with_extension("next");
    std::fs::write(&next, bytes).unwrap();
    std::fs::rename(next, path).unwrap();
}

fn print_excerpt(title: &str, screen: &str) {
    println!("----- {title} -----");
    for line in screen.lines().filter(|line| !line.trim().is_empty()) {
        println!("{line}");
    }
}

/// Commands that act in one order, and a home claim that records `step` on each render with `local` after `seen` was
/// stored: `probe.act` dispatches `probe.first`, which stores `step`, then stores `seen` itself.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("seen");
    setup.storage_key("step");
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
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

#[allow(unsafe_code)]
unsafe extern "C" fn probe_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("probe", probe, host, options, instance, out) }
}

/// The TUI's home with `setup` active, in process or wired through the C ABI's byte shims (`Loopback`).
fn home_with(
    setup: fn(&mut abi::Setup) -> Result<(), String>,
    create: unsafe extern "C" fn(*const abi::HostApi, abi::Bytes, *mut *mut c_void, *mut abi::Owned) -> i32,
    loopback: bool,
    deps: Deps,
) -> Harness {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..deps });
    let definition = match loopback {
        true => {
            opencode_plugin::loader::native::loopback(&opencode_tui::plugins::host::host(&h.tui), create).unwrap().0
        }
        false => abi::Plugin { id: "probe", setup }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h
}

// Expected: a dispatch and a storage write run in the order the command asked for them, on both paths: the claims
// hear of the storage once, after the dispatched command stored its own key, and render once, seeing it.
#[test]
fn a_dispatch_and_a_storage_write_reach_the_claims_in_call_order() {
    for loopback in [false, true] {
        let h = home_with(probe, probe_create, loopback, support::deps(Arc::new(fake(String::new()))));
        h.wait_for("probe renders []");
        h.tui.keymap.dispatch("probe.act", None);
        h.wait_for("probe renders [true]");
        h.app.wait_until(Duration::from_millis(100), || false);
        let screen = h.wait_for("probe renders [true]");
        assert!(!screen.contains("false"), "loopback {loopback}: {screen}");
    }
}

/// A handler of `rpc.example.updated`, which counts it in plugin state, and a home claim that shows the count.
fn updates(setup: &mut abi::Setup) -> Result<(), String> {
    let seen = Rc::new(Cell::new(0));
    let counted = seen.clone();
    setup.on_event(&["rpc.example.updated"], move |_, _| counted.set(counted.get() + 1));
    setup.slot(abi::Placement::append("home.footer"), move |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("updates {}", seen.get()))]))
    });
    Ok(())
}

#[allow(unsafe_code)]
unsafe extern "C" fn updates_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("probe", updates, host, options, instance, out) }
}

// Expected: an event that changes only plugin state, with no store batch and no storage write, renders the plugin's
// claims again, on both paths.
#[test]
fn an_event_handler_renders_its_plugins_claims_again() {
    for loopback in [false, true] {
        let memory = opencode_api::memory::Memory::new(vec![opencode_api::memory::Route::json(
            "GET",
            "/api/session",
            200,
            &json!({ "data": [], "cursor": {} }),
        )]);
        let deps = Deps { events: true, ..support::deps(Arc::new(memory.clone())) };
        let h = home_with(updates, updates_create, loopback, deps);
        h.wait_for("updates 0");
        memory.emit(&json!({
            "id": "evt_rpc", "created": 1, "type": "rpc.example.updated",
            "location": { "directory": support::DIRECTORY }, "data": {},
        }));
        h.wait_for("updates 1");
    }
}

// Expected (carbon-2): an external plugin whose setup fails shows the "Plugin failed" toast with "Open plugins", and
// the plugin manager lists it failed and offers to enable it; a fixed build loaded by hot reload refreshes the open
// manager, which then lists it active and offers to disable it.
#[test]
fn a_failed_setup_is_offered_to_enable_and_the_open_manager_follows_a_reload() {
    let h = open(Route::Home, "", &build("setup-fails"));
    let screen = h.wait_for("Plugin failed:");
    assert!(screen.contains("Open plugins"), "{screen}");
    assert_eq!(h.status(), opencode_plugin::Status::Failed("sample setup failed".to_owned()));
    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("enable enter");
    assert!(screen.contains("failed, local") && !screen.contains("disable"), "{screen}");
    write_atomic(&h.plugin.join(entry_file()), &build(""));
    let screen = h.wait_for("disable enter");
    assert!(!screen.contains("failed, local"), "{screen}");
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

// Expected (carbon-1): as the TUI exits, every active plugin is disposed while the TUI is still alive, as TS's plugin
// context does on exit.
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

// Expected: once a plugin panics, the fences it drew before fall back to the code view too, as `docs/P.4.md` says.
#[test]
fn a_panic_turns_the_fences_already_drawn_back_into_code() {
    let h = open(session_route(), "Here:\n\n```sample\nhello plugin\n```", &build("still"));
    h.wait_for("SAMPLE v1 HELLO PLUGIN");
    h.tui.keymap.dispatch("sample.panic", None);
    h.wait_for("hello plugin");
    h.wait_gone("SAMPLE v1 HELLO PLUGIN");
}
