//! Load external libraries into a real TUI and exercise rendering, reload, faults, and storage.

#[cfg(native)]
use crate::support::deref_harness;
use crate::support::{self, Fake, Harness};

use std::cell::{Cell, RefCell};
#[cfg(native)]
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::Arc;
#[cfg(native)]
use std::sync::Mutex;
use std::time::Duration;

use opencode_plugin::abi;
#[cfg(native)]
use opencode_plugin::loader::entry_file;
#[cfg(native)]
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// The sample plugin (`crates/plugin/examples/sample`) built with `features`, once per test run.
#[cfg(native)]
pub(crate) fn build(features: &str) -> Vec<u8> {
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

#[cfg(native)]
pub(crate) struct Plugins {
    harness: Harness,
    pub(crate) plugin: std::path::PathBuf,
    _root: opencode_util::temp::TempDir,
}

#[cfg(native)]
deref_harness!(Plugins);

#[cfg(native)]
pub(crate) fn open(route: Route, text: &str, build: &[u8]) -> Plugins {
    open_with(route, text, build, |_| None)
}

#[cfg(native)]
fn open_with(
    route: Route,
    text: &str,
    build: &[u8],
    roots: impl FnOnce(&Path) -> Option<opencode_tui::app::Roots>,
) -> Plugins {
    let root = opencode_util::temp::tempdir().unwrap();
    let config = root.path().join("config");
    let plugin = config.join("plugins").join("sample");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join(entry_file()), build).unwrap();
    let deps = Deps { route, roots: roots(root.path()), ..support::deps(Arc::new(fake(text.to_owned()))) };
    let harness = support::mount(80, 24, deps);
    // The budget is not what these rows check. On the wall clock a loaded machine's stall in a call (memory reclaim,
    // swap), which is no wait on a run queue, is charged: one over the overrun fails the sample, whose fence then shows
    // its code. A call here takes no time.
    let now = std::time::Instant::now();
    harness.tui.plugins.monitor().set_clock(move || now);
    external(&harness.tui, External { config_dir: config, cwd: root.path().to_path_buf(), dev: Vec::new() });
    Plugins { harness, plugin, _root: root }
}

#[cfg(native)]
fn session_route() -> Route {
    support::session_route("ses_p")
}

#[cfg(native)]
impl Plugins {
    fn status(&self) -> opencode_plugin::Status {
        let target = self.plugin.to_string_lossy();
        self.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&*target)).unwrap().status
    }
}

#[test]
#[cfg(native)]
fn the_sample_renders_in_the_transcript_and_reloads_on_change() {
    let h = open(session_route(), "Here:\n\n```sample\nhello plugin\n```", &build(""));
    let screen = h.wait_for("SAMPLE v1 HELLO PLUGIN");
    assert!(!screen.contains("hello plugin"), "{screen}");
    assert_eq!(h.status(), opencode_plugin::Status::Active);

    write_atomic(&h.plugin.join(entry_file()), &build("v2"));
    h.wait_for("SAMPLE v2 HELLO PLUGIN");
}

#[test]
#[cfg(native)]
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
    assert!(row.trim_end().ends_with("local") && !row.contains("failed"), "{screen}");
    print_excerpt("plugin manager with the sample active", &screen);
}

#[test]
#[cfg(native)]
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
#[cfg(native)]
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
#[cfg(native)]
fn a_panicking_command_is_caught_and_enabling_restarts_the_plugin() {
    let h = open(Route::Home, "", &build(""));
    h.wait_for("sample plugin v1: home.footer");
    h.tui.keymap.dispatch("sample.panic", None);
    assert_eq!(h.status(), opencode_plugin::Status::Failed("run-command panicked: sample command panicked".to_owned()));
    let screen = h.wait_for("Plugin failed: sample");
    assert!(screen.contains("Open plugins") && !screen.contains("sample plugin v1: home.footer"), "{screen}");
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("view error space");
    h.app.press("space");
    let screen = h.wait_for("run-command panicked: sample command panicked");
    print_excerpt("error details after a panic", &screen);
    h.app.press("escape");
    // A failed active entry still toggles off before enabling starts a fresh activation.
    h.wait_for("disable enter");
    h.app.press("enter");
    h.app.wait_until(support::WAIT, || h.status() == opencode_plugin::Status::Inactive);
    assert_eq!(h.status(), opencode_plugin::Status::Inactive);
    h.wait_for("enable enter");
    h.app.press("enter");
    h.app.wait_until(support::WAIT, || h.status() == opencode_plugin::Status::Active);
    assert_eq!(h.status(), opencode_plugin::Status::Active);
}

#[test]
#[cfg(native)]
fn a_major_abi_mismatch_is_refused_with_its_reason() {
    let h = open(Route::Home, "", &build("major-3"));
    let opencode_plugin::Status::Failed(error) = h.status() else {
        panic!("{:?}", h.status());
    };
    assert!(error.starts_with("plugin ABI 3.0 is not supported"), "{error}");
    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("failed, local");
    assert!(!screen.contains("sample plugin v1"), "{screen}");
    print_excerpt("plugin manager with a major mismatch", &screen);
    // A plugin that never loaded cannot be toggled, so enter opens its error.
    h.app.press("enter");
    let screen = h.wait_for("plugin ABI 3.0 is not supported");
    print_excerpt("error details of a major mismatch", &screen);
}

#[test]
#[cfg(native)]
fn a_plugin_stores_an_array() {
    let h =
        open_with(Route::Home, "", &build(""), |root| support::roots(support::home_paths(&root.join("home")), "test"));
    h.wait_for("sample plugin v1: home.footer");
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

#[test]
#[cfg(native)]
fn a_project_plugin_runs_once_approved_and_the_approval_is_kept() {
    let root = opencode_util::temp::tempdir().unwrap();
    project_plugin(root.path(), "sample", &build(""));
    let open = || project_tui(root.path());
    let h = open();
    h.wait_for("Plugin needs approval");
    assert!(!h.app.text().contains("sample plugin v1"), "{}", h.app.text());
    h.tui.keymap.dispatch("plugins.list", None);
    h.app.type_text("sample");
    h.wait_for("pending, local");
    h.app.press("enter");
    h.wait_for("Run project plugin?");
    // Decline is active at first.
    h.app.press("right");
    h.app.press("enter");
    let back = h.app.wait_until(support::WAIT, || {
        let text = h.app.text();
        !text.contains("Run project plugin?") && text.contains("Plugins") && !text.contains("pending")
    });
    assert!(back, "{}", h.app.text());
    h.app.press("escape");
    h.wait_for("sample plugin v1: home.footer");
    assert!(h.tui.state_dir().unwrap().join("plugin-approvals.json").is_file());
    drop(h);
    let h = open();
    h.wait_for("sample plugin v1: home.footer");
    assert!(!h.app.text().contains("needs approval"), "{}", h.app.text());
}

#[test]
#[cfg(native)]
fn a_state_directory_inside_the_project_keeps_no_decision() {
    let root = opencode_util::temp::tempdir().unwrap();
    project_plugin(root.path(), "sample", &build(""));
    let open = || project_tui_at(root.path(), &root.path().join("work/home"));
    let h = open();
    h.wait_for("Plugin needs approval");
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("pending, local");
    h.app.press("enter");
    h.wait_for("Run project plugin?");
    // The path the loader finds, whose separators are all `\` on Windows.
    let target = root.path().join("work").join(".opencode").join("plugins").join("sample");
    let target = target.to_string_lossy().into_owned();
    let (_, unsaved) = opencode_tui::plugins::host::held(&h.tui, &target).unwrap();
    assert!(unsaved.as_deref().is_some_and(|reason| reason.contains("inside the project")), "{unsaved:?}");
    h.app.press("right");
    h.app.press("enter");
    let back = h.app.wait_until(support::WAIT, || {
        let text = h.app.text();
        !text.contains("Run project plugin?") && text.contains("Plugins") && !text.contains("pending")
    });
    assert!(back, "{}", h.app.text());
    h.app.press("escape");
    h.wait_for("sample plugin v1: home.footer");
    assert!(!h.tui.state_dir().unwrap().join("plugin-approvals.json").exists());
    drop(h);
    open().wait_for("Plugin needs approval");
}

#[cfg(native)]
fn project_tui(root: &Path) -> Harness {
    project_tui_at(root, &root.join("home"))
}

/// [`project_tui`] with the home directory `home`, which holds the state directory.
#[cfg(native)]
fn project_tui_at(root: &Path, home: &Path) -> Harness {
    let roots = support::roots(support::home_paths(home), "test");
    let harness =
        support::mount(80, 24, Deps { route: Route::Home, roots, ..support::deps(Arc::new(fake(String::new()))) });
    external(&harness.tui, External { config_dir: root.join("config"), cwd: root.join("work"), dev: Vec::new() });
    harness
}

#[cfg(unix)]
#[cfg(native)]
fn project_tui_logged(root: &Path) -> (Harness, support::Log) {
    let fake = fake(String::new());
    let log = fake.log();
    let roots = support::roots(support::home_paths(&root.join("home")), "test");
    let harness = support::mount(80, 24, Deps { route: Route::Home, roots, ..support::deps(Arc::new(fake)) });
    external(&harness.tui, External { config_dir: root.join("config"), cwd: root.join("work"), dev: Vec::new() });
    (harness, log)
}

#[cfg(native)]
fn project_plugin(root: &Path, name: &str, library: &[u8]) {
    let dir = root.join("work/.opencode/plugins").join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join(entry_file()), library).unwrap();
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
#[cfg(native)]
fn nothing_of_a_project_plugin_is_mapped_before_it_is_approved() {
    let witness = std::env::temp_dir().join(format!("opencode-sample-witness-{}", std::process::id()));
    let _ = std::fs::remove_file(&witness);
    let root = opencode_util::temp::tempdir().unwrap();
    project_plugin(root.path(), "sample", &build("witness"));
    let h = project_tui(root.path());
    h.wait_for("Plugin needs approval");
    assert!(!witness.exists());
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("pending, local");
    h.app.press("enter");
    h.wait_for("Run project plugin?");
    // Decline is active at first.
    h.app.press("enter");
    h.wait_for("declined, local");
    h.app.press("escape");
    assert!(!witness.exists());
    drop(h);
    let h = project_tui(root.path());
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("declined, local");
    assert!(!witness.exists());
    h.app.press("enter");
    h.wait_for("Run project plugin?");
    h.app.press("right");
    h.app.press("enter");
    let mapped = h.app.wait_until(support::WAIT, || witness.exists());
    assert!(mapped, "{}", h.app.text());
    let _ = std::fs::remove_file(&witness);
}

#[test]
#[cfg(native)]
fn the_list_comes_back_on_the_row_that_was_asked_about() {
    let root = opencode_util::temp::tempdir().unwrap();
    project_plugin(root.path(), "first", &build(""));
    project_plugin(root.path(), "second", &build(""));
    let h = project_tui(root.path());
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("second");
    h.app.press("down");
    h.app.press("enter");
    h.wait_for(&format!("plugins{}second", std::path::MAIN_SEPARATOR));
    h.app.press("escape");
    let back = h.app.wait_until(support::WAIT, || !h.app.text().contains("Run project plugin?"));
    assert!(back);
    h.wait_for("pending, local");
    h.app.press("enter");
    let screen = h.wait_for("Run project plugin?");
    let named = |name: &str| format!("plugins{}{name}", std::path::MAIN_SEPARATOR);
    assert!(screen.contains(&named("second")) && !screen.contains(&named("first")), "{screen}");
}

/// A plugin whose command panics.
#[cfg(unix)]
#[cfg(native)]
fn boom() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.command(abi::Command::new("boom.boom"), |_, _| -> () { panic!("boom") });
        Ok(())
    }
    abi::Plugin { id: "test.boom", setup }
}

#[cfg(unix)]
#[test]
#[cfg(native)]
fn the_list_comes_back_as_the_plugins_are_after_the_question() {
    use std::os::unix::fs::PermissionsExt;
    for answer in ["escape", "unsaved", "filtered"] {
        let root = opencode_util::temp::tempdir().unwrap();
        project_plugin(root.path(), "first", &build(""));
        let (h, log) = project_tui_logged(root.path());
        let reads =
            || log.lock().unwrap().iter().filter(|seen| seen.method == "GET" && seen.path == "/api/plugin").count();
        opencode_tui::plugins::host::add(&h.tui, boom().into());
        h.tui.keymap.dispatch("plugins.list", None);
        h.wait_for("pending, local");
        h.wait_for("test.boom");
        if answer == "filtered" {
            h.app.type_text("first");
            h.wait_for("pending, local");
        }
        h.app.press("enter");
        h.wait_for("Run project plugin?");
        h.tui.keymap.dispatch("boom.boom", None);
        h.app.render();
        let before = reads();
        let state = support::home_paths(&root.path().join("home")).state;
        match answer {
            "escape" | "filtered" => h.app.press("escape"),
            _ => {
                std::fs::create_dir_all(&state).unwrap();
                std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o500)).unwrap();
                h.app.press("right");
                h.app.press("enter");
            }
        }
        h.wait_for("pending, local");
        std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o700)).ok();
        if answer != "filtered" {
            h.wait_for("x test.boom");
            h.wait("the server list read again", || reads() == before + 1);
            continue;
        }
        let screen = h.app.text();
        let lines: Vec<&str> = screen.lines().collect();
        let title = lines.iter().position(|line| line.contains("Plugins") && line.contains("esc")).unwrap();
        assert_eq!(lines[title + 2].trim(), "first", "the filter went\n{screen}");
    }
}

#[test]
#[cfg(native)]
fn a_plugin_that_fails_to_load_shows_a_toast_and_the_footer_counts_it() {
    let h = open(Route::Home, "", &build("major-3"));
    let screen = h.wait_for("Plugin failed:");
    assert!(screen.contains("Open plugins"), "{screen}");
    h.wait_for("⊙ 1 plugin failed");
}

#[cfg(native)]
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) {
    let next = path.with_extension("next");
    std::fs::write(&next, bytes).unwrap();
    std::fs::rename(next, path).unwrap();
}

#[cfg(native)]
fn print_excerpt(title: &str, screen: &str) {
    println!("----- {title} -----");
    for line in screen.lines().filter(|line| !line.trim().is_empty()) {
        println!("{line}");
    }
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

/// The TUI's home with `setup` active, in process or wired through the C ABI's byte shims (`Loopback`).
fn home_with(
    setup: fn(&mut abi::Setup) -> Result<(), String>,
    create: crate::support::Loopback,
    loopback: bool,
    deps: Deps,
) -> Harness {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..deps });
    let definition = match loopback {
        true => crate::support::loopback(&opencode_tui::plugins::host::host(&h.tui), create).unwrap().0,
        false => abi::Plugin { id: "probe", setup }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h
}

#[test]
fn a_dispatch_and_a_storage_write_reach_the_claims_in_call_order() {
    for loopback in crate::support::LOOPBACK {
        let h = home_with(
            probe,
            crate::support::loopback_entries!("probe", probe),
            loopback,
            support::deps(Arc::new(fake(String::new()))),
        );
        h.wait_for("probe renders []");
        h.tui.keymap.dispatch("probe.act", None);
        h.wait_for("probe renders [true]");
        h.app.wait_until(Duration::from_millis(100), || false);
        let screen = h.wait_for("probe renders [true]");
        assert!(!screen.contains("false"), "loopback {loopback}: {screen}");
    }
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
    for loopback in crate::support::LOOPBACK {
        let h = home_with(
            chain,
            crate::support::loopback_entries!("probe", chain),
            loopback,
            support::deps(Arc::new(fake(String::new()))),
        );
        h.wait_for("chain ready");
        CHAINED.set((0, 0));
        h.tui.keymap.dispatch("chain.self", None);
        h.app.advance(Duration::from_millis(16));
        let ran = CHAINED.get().0;
        assert!((2..=100).contains(&ran), "loopback {loopback}: the chain ran {ran} times");
        h.app.advance(Duration::from_millis(16));
        assert_eq!(CHAINED.get().0, ran, "loopback {loopback}: the chain went on");
        h.tui.keymap.dispatch("chain.fan", None);
        h.app.advance(Duration::from_millis(16));
        let first = CHAINED.get().1;
        let budget = opencode_plugin::FRAME_EFFECTS;
        assert!((2..=budget).contains(&first), "loopback {loopback}: {first} ran before the first paint");
        // The rest waits for the next paint, and runs just after it, one budget (frame-effects).
        h.app.advance(Duration::from_millis(16));
        assert_eq!(CHAINED.get().1, first, "loopback {loopback}: more ran with no paint");
        h.app.render();
        assert_eq!(CHAINED.get().1, first, "loopback {loopback}: the paint ran more than its budget");
        h.app.advance(Duration::ZERO);
        let second = CHAINED.get().1;
        assert!(second > first && second - first <= budget, "loopback {loopback}: {first} then {second}");
        // One processed item enqueues two; the queue must stop growing at its bound.
        for _ in 0..80 {
            h.app.render();
            h.app.advance(Duration::ZERO);
        }
        let waiting = opencode_plugin::effects_waiting();
        assert!((60_000..=1 << 16).contains(&waiting), "loopback {loopback}: {waiting} effects wait");
        h.app.type_text("still here");
        h.wait_for("still here");
        h.tui.plugins.deactivate_all();
        h.app.advance(Duration::from_millis(16));
    }
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
    for loopback in crate::support::LOOPBACK {
        let h = home_with(
            chain,
            crate::support::loopback_entries!("probe", chain),
            loopback,
            support::deps(Arc::new(fake(String::new()))),
        );
        let host = opencode_tui::plugins::host::host(&h.tui);
        let definition = match loopback {
            true => {
                let entries = crate::support::loopback_entries!("fetcher", fetcher);
                crate::support::loopback(&host, entries).unwrap().0
            }
            false => abi::Plugin { id: "fetcher", setup: fetcher }.into(),
        };
        opencode_tui::plugins::host::add(&h.tui, definition);
        h.wait_for("chain ready");
        FETCHES.with_borrow_mut(|fetches| *fetches = Default::default());
        h.tui.keymap.dispatch("chain.fan", None);
        for _ in 0..80 {
            h.app.render();
            h.app.advance(Duration::ZERO);
        }
        assert!(opencode_plugin::effects_waiting() >= 60_000, "loopback {loopback}: the queue is not under pressure");
        h.tui.keymap.dispatch("fetcher.go", None);
        let under = FETCHES.with_borrow(|fetches| fetches.0.clone());
        let refused = matches!(&under[..], [Err(error)] if error.contains("the effects that wait fill its queue"));
        assert!(refused, "loopback {loopback}: a fetch with no room returned {under:?}");
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
        assert_eq!(left, 0, "loopback {loopback}: the queue did not drain within a frame for each budget of {waiting}");
        h.tui.keymap.dispatch("fetcher.go", None);
        let replied = h.app.wait_until(support::WAIT, || {
            let (given, replies) = FETCHES.with_borrow(|fetches| fetches.clone());
            given.iter().flatten().all(|id| replies.contains(id))
        });
        let (given, replies) = FETCHES.with_borrow(|fetches| fetches.clone());
        assert!(replied && given.len() == 2 && given[1].is_ok(), "loopback {loopback}: {given:?} {replies:?}");
        h.tui.plugins.deactivate_all();
        h.app.advance(Duration::from_millis(16));
    }
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
    for loopback in crate::support::LOOPBACK {
        let h = home_with(
            burst,
            crate::support::loopback_entries!("probe", burst),
            loopback,
            support::deps(Arc::new(fake(String::new()))),
        );
        h.wait_for("burst ready");
        BURST.set((0, 0));
        h.tui.keymap.dispatch("burst.go", None);
        h.app.advance(Duration::from_millis(16));
        let first = BURST.get().0;
        assert!((1..=1024).contains(&first), "loopback {loopback}: {first} ran before the first paint");
        while BURST.get().0 < 3000 {
            let before = BURST.get().0;
            h.app.render();
            h.app.advance(Duration::ZERO);
            let ran = BURST.get().0 - before;
            assert!(ran > 0, "loopback {loopback}: stuck at {before}");
            assert!(ran <= opencode_plugin::FRAME_EFFECTS, "loopback {loopback}: {ran} ran in one frame");
        }
        assert_eq!(BURST.get().0, 3000, "loopback {loopback}");
        let (x, y) = h.find("PAD");
        h.app.click(x, y);
        for _ in 0..4 {
            h.app.advance(Duration::from_millis(16));
            h.app.render();
        }
        let closes = BURST.get().1;
        assert!((2..=100).contains(&closes), "loopback {loopback}: the overlay closed {closes} times");
        h.app.render();
        assert_eq!(BURST.get().1, closes, "loopback {loopback}: the chain went on");
        h.tui.plugins.deactivate_all();
        h.app.advance(Duration::from_millis(16));
    }
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
    for loopback in crate::support::LOOPBACK {
        let memory = opencode_api::memory::Memory::new(vec![opencode_api::memory::Route::json(
            "GET",
            "/api/session",
            200,
            &json!({ "data": [], "cursor": {} }),
        )]);
        let deps = Deps { events: true, ..support::deps(Arc::new(memory.clone())) };
        let h = home_with(updates, crate::support::loopback_entries!("probe", updates), loopback, deps);
        h.wait_for("updates 0");
        memory.emit(&json!({
            "id": "evt_rpc", "created": 1, "type": "rpc.example.updated",
            "location": { "directory": support::DIRECTORY }, "data": {},
        }));
        h.wait_for("updates 1");
    }
}

#[test]
#[cfg(native)]
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
            let spawned = Command::new(std::env::current_exe().unwrap())
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

#[test]
#[cfg(native)]
fn toggling_a_plugin_frees_the_view_and_the_manager() {
    let h = open(session_route(), "Here:\n\n```sample\nhello plugin\n```", &build("still"));
    h.wait_for("SAMPLE v1 HELLO PLUGIN");
    let marker = Rc::new(());
    for status in [opencode_plugin::Status::Inactive, opencode_plugin::Status::Active] {
        assert!(support::mark(&h.app, &h.tui.frame.main(), 0, &marker) > 0);
        h.tui.keymap.dispatch("plugins.list", None);
        h.wait_for("able enter");
        assert!(support::mark(&h.app, h.tui.dialogs.host(), 2, &marker) > 0);
        let (x, y) = h.find("able enter");
        h.app.hover(x, y);
        h.app.click(x, y);
        h.wait("the plugin toggled", || h.status() == status);
        h.app.press("escape");
        h.app.render();
    }
    h.wait_for("SAMPLE v1 HELLO PLUGIN");
    assert_eq!(Rc::strong_count(&marker), 1);
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

#[test]
#[cfg(native)]
fn an_app_claim_shows_under_every_route() {
    let h = open(Route::Home, "Done here.", &build("app"));
    let last =
        |screen: &str| screen.lines().rev().find(|line| !line.trim().is_empty()).unwrap_or_default().trim().to_owned();
    let screen = h.wait_for("sample app: under the route");
    assert_eq!(last(&screen), "sample app: under the route", "{screen}");
    h.tui.navigate(session_route());
    let screen = h.wait_for("Done here.");
    assert_eq!(last(&screen), "sample app: under the route", "{screen}");
    h.tui.keymap.dispatch("plugins.list", None);
    let (x, y) = h.find("disable enter");
    h.app.hover(x, y);
    h.app.click(x, y);
    h.wait("the plugin toggled", || h.status() == opencode_plugin::Status::Inactive);
    h.app.press("escape");
    h.wait_gone("sample app: under the route");
}

#[test]
#[cfg(native)]
fn a_panic_turns_the_fences_already_drawn_back_into_code() {
    let h = open(session_route(), "Here:\n\n```sample\nhello plugin\n```", &build("still"));
    h.wait_for("SAMPLE v1 HELLO PLUGIN");
    h.tui.keymap.dispatch("sample.panic", None);
    h.wait_for("hello plugin");
    h.wait_gone("SAMPLE v1 HELLO PLUGIN");
}

#[test]
#[cfg(native)]
fn a_plugins_change_in_cli_json_reconciles_while_running() {
    let h = open(Route::Home, "", &build(""));
    h.wait_for("sample plugin v1: home.footer");
    let plugins = |value: Value| {
        opencode_tui::dialogs::settings::update(&h.tui, move |config| {
            opencode_tui::dialogs::settings::set_path(config, &["plugins"], value)
        })
    };
    plugins(json!(["-sample"]));
    assert_eq!(h.status(), opencode_plugin::Status::Inactive);
    assert!(!h.app.render().text().contains("sample plugin v1"));
    plugins(json!([]));
    assert_eq!(h.status(), opencode_plugin::Status::Active);
    h.wait_for("sample plugin v1: home.footer");
}

#[test]
#[cfg(native)]
fn a_dev_library_survives_a_settings_edit() {
    let root = opencode_util::temp::tempdir().unwrap();
    let dev = root.path().join("crate").join("target").join("opencode-dev");
    std::fs::create_dir_all(&dev).unwrap();
    let library = dev.join(entry_file());
    std::fs::write(&library, build("")).unwrap();
    let harness = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(fake(String::new()))) });
    let target = library.to_string_lossy().into_owned();
    let config_dir = root.path().join("config");
    external(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: vec![target.clone()] });
    harness.wait_for("sample plugin v1: home.footer");
    opencode_tui::dialogs::settings::update(&harness.tui, |value| {
        opencode_tui::dialogs::settings::set_path(value, &["plugins"], json!(["an-unrelated-entry"]));
    });
    harness.app.advance(Duration::from_millis(1));
    let entries = harness.tui.plugins.entries();
    let entry =
        entries.iter().find(|entry| entry.target.as_deref() == Some(&*target)).expect("the dev target is listed");
    assert_eq!(entry.status, opencode_plugin::Status::Active);
    let plugins = harness.tui.config().info.plugins.clone().unwrap_or_default();
    assert!(plugins.iter().all(|plugin| !format!("{plugin:?}").contains("opencode-dev")), "{plugins:?}");
    write_atomic(&library, &build("v2"));
    harness.wait_for("sample plugin v2: home.footer");
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
    for carrier in crate::plugin_surface::CARRIERS {
        let root = opencode_util::temp::tempdir().unwrap();
        let paths = support::home_paths(&root.path().join("home"));
        let storage = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
        storage.update("plugin.acme.cloud.token", &json!({}), |value| *value = json!({ "legacy": true })).unwrap();
        STORED.with_borrow_mut(Vec::clear);
        let deps = Deps {
            route: Route::Home,
            roots: support::roots(paths, "test"),
            builtins: vec![
                crate::plugin_surface::builtin(carrier, abi::Plugin { id: "acme", setup: acme }),
                crate::plugin_surface::builtin(carrier, abi::Plugin { id: "acme.cloud", setup: cloud }),
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
            ],
            "{carrier:?}"
        );
        let file = |key: &str| storage.load(key, &Value::Null).unwrap();
        assert_eq!(file("plugin.acme..cloud.token"), own, "{carrier:?}");
        assert_eq!(file("plugin.acme.cloud.token"), other, "{carrier:?}: TS's name is the dot-free key's");
    }
}

#[test]
#[cfg(native)]
fn a_failed_dev_build_says_so() {
    let root = opencode_util::temp::tempdir().unwrap();
    let dev = root.path().join("crate").join("target").join("opencode-dev");
    std::fs::create_dir_all(&dev).unwrap();
    let library = dev.join(entry_file());
    std::fs::write(&library, build("")).unwrap();
    let log = dev.join("build.log");
    std::fs::write(&log, "an old failure").unwrap();
    let harness = support::mount(100, 24, Deps { route: Route::Home, ..support::deps(Arc::new(fake(String::new()))) });
    let target = library.to_string_lossy().into_owned();
    let config_dir = root.path().join("config");
    external(&harness.tui, External { config_dir, cwd: root.path().to_path_buf(), dev: vec![target] });
    harness.wait_for("sample plugin v1: home.footer");
    assert!(harness.tui.toasts.current().is_none(), "the old log told");
    write_atomic(&log, b"error[E0425]: cannot find value");
    let screen = harness.wait_for("plugin dev: the build failed");
    assert!(screen.contains("build.log"), "{screen}");
    // It stays until the next build, as the author looks back from the editor later (dx-fresh).
    harness.app.advance(opencode_ui::toast::DEFAULT_DURATION * 10);
    harness.wait_for("plugin dev: the build failed");
    harness.tui.toasts.dismiss();
    write_atomic(&log, b"");
    harness.wait_for("plugin dev: the build passes again");
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
    for carrier in crate::plugin_surface::CARRIERS {
        BIG.with_borrow_mut(Vec::clear);
        let deps = Deps {
            route: Route::Home,
            builtins: vec![crate::plugin_surface::builtin(carrier, abi::Plugin { id: "big", setup: big })],
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
            "{carrier:?}: the replace was refused, or the addition kept"
        );
    }
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
    for carrier in crate::plugin_surface::CARRIERS {
        let root = opencode_util::temp::tempdir().unwrap();
        let paths = support::home_paths(&root.path().join("home"));
        let other = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
        TWO.with_borrow_mut(Vec::clear);
        let deps = Deps {
            route: Route::Home,
            roots: support::roots(paths, "test"),
            builtins: vec![crate::plugin_surface::builtin(carrier, abi::Plugin { id: "two", setup: two })],
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
        assert_eq!(fields(stored), Some(vec!["b".to_owned()]), "{carrier:?}: both fields were kept");
        // The refusal reaches the UI thread at once, which reads the key again: before the storage watcher's debounce.
        harness.app.advance(Duration::ZERO);
        run("two.read");
        assert_eq!(
            TWO.with_borrow(|two| two.last().cloned()),
            Some(vec!["b".to_owned()]),
            "{carrier:?}: this client still shows its own merge"
        );
        assert_eq!(TWO.with_borrow(|two| two.first().cloned()), Some(Vec::new()), "{carrier:?}");
    }
}

#[test]
fn a_refused_write_leaves_the_cache_equal_to_the_file_when_its_notice_is_lost() {
    for carrier in crate::plugin_surface::CARRIERS {
        let root = opencode_util::temp::tempdir().unwrap();
        let paths = support::home_paths(&root.path().join("home"));
        let other = opencode_local::storage::Storage::new(&paths.state, "test").unwrap();
        TWO.with_borrow_mut(Vec::clear);
        let deps = Deps {
            route: Route::Home,
            roots: support::roots(paths, "test"),
            builtins: vec![crate::plugin_surface::builtin(carrier, abi::Plugin { id: "two", setup: two })],
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
        assert_eq!(TWO.take().last().cloned(), Some(vec!["b".to_owned()]), "{carrier:?}: the refused merge shows");
        for key in ["plugin.two.state", "plugin.two.note"] {
            let file =
                other.load(key, &Value::Null).ok().filter(|value| !value.is_null()).map(|value| value.to_string());
            assert_eq!(opencode_plugin::Host::storage_read(&*harness.tui, key), file, "{carrier:?}: {key}");
        }
    }
}
