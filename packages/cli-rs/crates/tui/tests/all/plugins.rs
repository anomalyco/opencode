//! External native plugins (P.4) in the real TUI: the sample plugin found in a `plugins` directory renders its
//! fence in a transcript and its slot on the home screen, reloads when it is rebuilt, a panic shows as failed in
//! the plugin manager while the TUI keeps running, and a major ABI mismatch is refused there with its reason.
//! Config and state live in temp directories. The real TUI calls `external` from `opencode-rs` (`commands/default.rs`).

use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bytes::Bytes;
use opencode_api::client::Client;
use opencode_api::generated::SessionID;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use opencode_local::cli_config::{Info, Resolved};
use opencode_plugin::loader::entry_file;
use opencode_tui::plugins::host::{External, external};
use opencode_tui::{Deps, Route, Tui};
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// The sample plugin (`crates/plugin/examples/sample`) built with `features`, once per test run.
fn build(features: &str) -> Vec<u8> {
    static BUILT: Mutex<Vec<(String, Vec<u8>)>> = Mutex::new(Vec::new());
    let mut built = BUILT
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
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
    let name = format!(
        "{}opencode_sample_plugin{}",
        std::env::consts::DLL_PREFIX,
        std::env::consts::DLL_SUFFIX
    );
    let library = std::fs::read(target.join("debug").join(name)).unwrap();
    built.push((features.to_owned(), library.clone()));
    library
}

/// Serves one session whose assistant reply is `text`.
struct Fixture {
    text: String,
}

impl Transport for Fixture {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        let path = request.url.path().to_owned();
        Box::pin(async move {
            let (status, body) = match path.as_str() {
                "/api/session" => (200, json!({ "data": [], "cursor": {} })),
                "/api/session/ses_p" => (200, json!({ "data": session() })),
                "/api/session/ses_p/message" => {
                    (200, json!({ "data": messages(&self.text), "cursor": {} }))
                }
                "/api/session/ses_p/permission" => (200, json!({ "data": [] })),
                _ => (404, json!({})),
            };
            Ok(Response {
                status,
                headers: vec![("content-type".into(), "application/json".into())],
                body: Box::pin(futures_util::stream::iter([Ok(Bytes::from(
                    serde_json::to_vec(&body).unwrap(),
                ))])),
            })
        })
    }
}

fn session() -> Value {
    json!({
        "id": "ses_p", "title": "Plugins", "projectID": "project", "cost": 0, "agent": "build",
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project" },
    })
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

struct Harness {
    app: TestApp,
    tui: Rc<Tui>,
    plugin: std::path::PathBuf,
    _root: tempfile::TempDir,
}

/// The TUI on `route` with the sample's `build` in `<config>/plugins/sample`.
fn open(route: Route, text: &str, build: &[u8]) -> Harness {
    let root = tempfile::tempdir().unwrap();
    let config = root.path().join("config");
    let plugin = config.join("plugins/sample");
    std::fs::create_dir_all(&plugin).unwrap();
    std::fs::write(plugin.join(entry_file()), build).unwrap();
    let client = Client::with_transport(
        "http://opencode.local",
        Arc::new(Fixture {
            text: text.to_owned(),
        }),
    )
    .unwrap();
    let app = TestApp::new(80, 24);
    let tui = opencode_tui::mount(
        &app,
        Deps {
            client,
            directory: "/project".into(),
            config: Resolved::new(Info::default(), |_| None),
            roots: None,
            route,
            continue_: false,
            events: false,
        },
    );
    external(
        &tui,
        External {
            config_dir: config,
            cwd: root.path().to_path_buf(),
        },
    );
    Harness {
        app,
        tui,
        plugin,
        _root: root,
    }
}

fn session_route() -> Route {
    Route::Session {
        id: SessionID("ses_p".into()),
    }
}

impl Harness {
    fn wait_for(&self, text: &str) -> String {
        let found = self
            .app
            .wait_until(Duration::from_secs(10), || self.app.text().contains(text));
        let screen = self.app.text();
        assert!(found, "{text:?} never showed:\n{screen}");
        screen
    }

    fn status(&self) -> opencode_plugin::Status {
        let target = self.plugin.to_string_lossy();
        self.tui
            .plugins
            .entries()
            .into_iter()
            .find(|entry| entry.target.as_deref() == Some(&*target))
            .unwrap()
            .status
    }
}

#[test]
fn the_sample_renders_in_the_transcript_and_reloads_on_change() {
    let h = open(
        session_route(),
        "Here:\n\n```sample\nhello plugin\n```",
        &build(""),
    );
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
    assert!(
        matches!(h.tui.route(), Route::Plugin { ref id, ref name } if id == "sample" && name == "hello")
    );
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
    assert!(
        row.trim_end().ends_with("local") && !row.contains("failed"),
        "{screen}"
    );
    print_excerpt("plugin manager with the sample active", &screen);
}

#[test]
fn a_panicking_plugin_shows_as_failed_in_the_plugin_manager() {
    let h = open(
        session_route(),
        "Crash:\n\n```sample-panic\nboom\n```",
        &build(""),
    );
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
    assert_eq!(
        h.status(),
        opencode_plugin::Status::Failed("run-command panicked: sample command panicked".to_owned())
    );
    h.wait_for("Plugin failed: sample");
    h.tui.keymap.dispatch("plugins.list", None);
    h.wait_for("view error space");
    h.app.press("space");
    let screen = h.wait_for("run-command panicked: sample command panicked");
    print_excerpt("error details after a panic", &screen);
    h.app.press("escape");
    h.wait_for("enable enter");
    h.app.press("enter");
    h.app.wait_until(Duration::from_secs(5), || {
        h.status() == opencode_plugin::Status::Active
    });
    assert_eq!(h.status(), opencode_plugin::Status::Active);
}

#[test]
fn a_major_abi_mismatch_is_refused_with_its_reason() {
    let h = open(Route::Home, "", &build("major-2"));
    let opencode_plugin::Status::Failed(error) = h.status() else {
        panic!("{:?}", h.status());
    };
    assert!(
        error.starts_with("plugin ABI 2.0 is not supported"),
        "{error}"
    );
    h.tui.keymap.dispatch("plugins.list", None);
    let screen = h.wait_for("failed, local");
    assert!(!screen.contains("sample plugin v1"), "{screen}");
    print_excerpt("plugin manager with a major mismatch", &screen);
    // A plugin that never loaded cannot be toggled, so enter opens its error.
    h.app.press("enter");
    let screen = h.wait_for("plugin ABI 2.0 is not supported");
    print_excerpt("error details of a major mismatch", &screen);
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
