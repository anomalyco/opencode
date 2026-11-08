//! The sidebar's MCP and footer sections on the one plugin API (O-67): clicks that run commands, a fold and a
//! dismissal kept in plugin storage, their settings listeners, and the MCP section through the C ABI's byte shims.

use crate::support::{self, DIRECTORY, Fake, deref_harness, list};

use std::ffi::c_void;
use std::sync::Arc;

use opencode_plugin::{Host, SlotInput, abi, slot};
use opencode_tui::{Deps, Route};
use opentui::prelude::*;
use serde_json::{Value, json};

/// Three servers, so the list folds; `linear` failed.
fn servers() -> Value {
    json!([
        { "name": "linear", "status": { "status": "failed", "error": "MCP error -32000: Connection closed" } },
        { "name": "github", "status": { "status": "connected" } },
        { "name": "sentry", "status": { "status": "needs_auth", "error": "Authentication required" } },
    ])
}

struct Sidebar {
    harness: support::Harness,
    _home: Option<opencode_util::temp::TempDir>,
}

deref_harness!(Sidebar);

/// `ses_a` with the sidebar docked and `plugins` in the config, with TUI storage when `stored`.
fn mount(plugins: &[&str], stored: bool) -> Sidebar {
    let fake = Fake::new(|seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/mcp") => (200, list(DIRECTORY, servers())),
        _ => support::base(seen, DIRECTORY),
    });
    let home = stored.then(|| opencode_util::temp::tempdir().unwrap());
    let config = json!({ "animations": false, "plugins": plugins });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        roots: home.as_ref().and_then(|home| support::roots(support::home_paths(home.path()), "test")),
        ..support::deps(Arc::new(fake))
    };
    let harness = support::mount(170, 30, deps);
    let sidebar = Sidebar { harness, _home: home };
    sidebar.wait_for("Getting started");
    sidebar
}

impl Sidebar {
    /// Waits for the MCP list, and dismisses the toast its sign-in server shows over the sidebar.
    fn servers(&self) {
        self.wait_for("sentry");
        self.wait_for("MCP server needs authentication");
        self.tui.toasts.dismiss();
        self.wait_gone("MCP server needs authentication");
    }

    /// Clicks `text` in the sidebar, on the right.
    fn click(&self, text: &str) {
        let screen = self.app.text();
        let (x, y) = screen
            .lines()
            .enumerate()
            .filter_map(|(y, line)| Some((line[..line.rfind(text)?].chars().count() as u16, y as u16)))
            .find(|(x, _)| *x > 120)
            .unwrap_or_else(|| panic!("no {text:?} in the sidebar:\n{screen}"));
        self.app.click(x, y);
    }
}

// Expected: a click on a failed server opens the MCP dialog on its error, as `mcp.list` with the server's name.
#[test]
fn a_failed_mcp_row_opens_its_error() {
    let h = mount(&[], false);
    h.servers();
    h.click("linear");
    let screen = h.wait_for("MCP server: linear");
    assert!(screen.contains("MCP error -32000: Connection closed"), "{screen}");
}

// Expected: a folded MCP list stays folded when the session view mounts again, without TUI storage.
#[test]
fn a_fold_survives_a_remount() {
    let h = mount(&[], false);
    h.servers();
    h.click("MCP");
    h.wait_for("MCP (1 active, 2 errors)");
    assert!(!h.app.text().contains("sentry"), "{}", h.app.text());
    h.tui.navigate(Route::Home);
    h.wait_gone("MCP (1 active");
    h.tui.navigate(support::session_route("ses_a"));
    h.wait_for("MCP (1 active, 2 errors)");
    h.click("MCP");
    h.wait_for("sentry");
}

// Expected: dismissing the getting started card hides it, storage reads the new value back at once, and the value
// reaches the disk.
#[test]
fn dismissing_the_card_stores_the_new_value() {
    let h = mount(&[], true);
    h.click("✕");
    h.wait_gone("Getting started");
    let key = "plugin.opencode.sidebar.footer.getting-started";
    let stored: Value = serde_json::from_str(&h.tui.storage_read(key).unwrap()).unwrap();
    assert_eq!(stored, json!({ "dismissed": true }));
    let storage = h.tui.storage().unwrap();
    let written = h.app.wait_until(support::WAIT, || storage.load(key, &Value::Null).ok() == Some(stored.clone()));
    assert!(written, "{:?}", storage.load(key, &Value::Null));
}

// Expected: a mounted section listens to the settings until it unmounts, so mounting the sidebar's slots many times
// leaves no listener behind.
#[test]
fn the_sections_let_go_of_their_settings_listeners() {
    let h = mount(&[], false);
    let input = SlotInput { session_id: Some("ses_a".to_owned()), ..SlotInput::default() };
    let mounts = |count: usize| {
        for _ in 0..count {
            let parent = View::new(&h.app);
            let content = opencode_tui::plugins::host::slot(&h.tui, &parent, slot::SIDEBAR_CONTENT, &input, |_| {});
            let footer = opencode_tui::plugins::host::slot(&h.tui, &parent, slot::SIDEBAR_FOOTER, &input, |_| {});
            assert!(!content.is_empty() && !footer.is_empty());
        }
        h.app.render();
        h.tui.settings.listener_count()
    };
    let before = mounts(0);
    assert_eq!(mounts(50), before);
}

#[allow(unsafe_code)]
unsafe extern "C" fn mcp_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    let plugin = opencode_tui::plugins::sidebar_mcp::plugin();
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("loopback.sidebar.mcp", plugin.setup, host, options, instance, out) }
}

/// The frames of the sidebar as mounted, after a click folds the MCP list, and after one opens it again. With
/// `loopback`, the MCP section is wired through the byte shims of the C ABI (`Loopback`) instead of running in
/// process.
fn mcp_frames(loopback: bool) -> Vec<opentui::testing::Capture> {
    let h = mount(if loopback { &["-opencode.sidebar.mcp"] } else { &[] }, false);
    if loopback {
        let (definition, _) = opencode_plugin::loader::native::loopback(&h.tui, mcp_create).unwrap();
        opencode_tui::plugins::host::add(&h.tui, definition);
    }
    h.servers();
    let mut frames = vec![h.app.render()];
    h.click("MCP");
    h.wait_for("MCP (1 active, 2 errors)");
    frames.push(h.app.render());
    h.click("MCP");
    h.wait_for("sentry");
    frames.push(h.app.render());
    h.click("linear");
    h.wait_for("MCP server: linear");
    frames
}

// Expected: the MCP section draws the same cells through the C ABI's byte shims as in process, and its clicks run
// the same commands there: the fold through the plugin's hidden command and storage, the row through `mcp.list`.
#[test]
fn the_mcp_section_acts_the_same_through_the_c_abi_loopback() {
    assert_eq!(mcp_frames(true), mcp_frames(false));
}
