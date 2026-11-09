//! The home footer on the one plugin API (O-67): its nested `home.footer.status` slot, which keeps rendering while
//! the footer keeps its node, and the footer through the C ABI's byte shims.

use crate::support::{self, DIRECTORY, Fake, Harness, list};

use std::cell::RefCell;
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::Arc;

use opencode_api::generated::{SessionID, V2Event};
use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use opentui::prelude::*;
use serde_json::json;

/// A `home.footer.status` claim that shows the last session whose status changed, kept across mounts.
fn status(setup: &mut abi::Setup) -> Result<(), String> {
    let last = Rc::new(RefCell::new("none".to_owned()));
    setup.slot(abi::Placement::append("home.footer.status"), move |_, _, changed| {
        let Some(session) = changed.sessions.last() else {
            return match changed.all {
                true => abi::Render::Show(abi::Node::text([abi::Span::new(format!("status {}", last.borrow()))])),
                false => abi::Render::Keep,
            };
        };
        *last.borrow_mut() = session.clone();
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("status {session}"))]))
    });
    Ok(())
}

/// The home at `width` columns, with two connected MCP servers and `plugins` in the config.
fn mount(width: u16, plugins: &[&str], builtins: Vec<opencode_plugin::Builtin>) -> Harness {
    let servers = json!([
        { "name": "github", "status": { "status": "connected" } },
        { "name": "linear", "status": { "status": "connected" } },
    ]);
    let fake = Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/mcp") => (200, list(DIRECTORY, servers.clone())),
        _ => support::base(seen, DIRECTORY),
    });
    let config = json!({ "animations": false, "plugins": plugins });
    let deps = Deps {
        config: support::config(support::decode(&config.to_string())),
        route: Route::Home,
        builtins,
        ..support::deps(Arc::new(fake))
    };
    support::mount(width, 30, deps)
}

fn started(h: &Harness, session: &str) {
    let event: V2Event = serde_json::from_value(json!({
        "id": "evt_1", "created": 1, "type": "session.execution.started",
        "durable": { "aggregateID": session, "seq": 1, "version": 1 }, "data": { "sessionID": session },
    }))
    .unwrap();
    h.tui.data.apply(&[event]);
}

// Expected: a status claim nested in the home footer renders a store batch the footer itself keeps, so only the
// status claim's text is built again, and it stays after a resize rebuilds the footer around it.
#[test]
fn a_status_claim_updates_while_the_footer_keeps_its_node() {
    let h = mount(100, &[], vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    h.wait_for("2 MCP");
    h.wait_for("status none");
    h.app.wait_until(std::time::Duration::from_millis(100), || false);
    let before = View::new(&h.app).id();
    started(&h, "ses_x");
    h.wait_for("status ses_x");
    // The probe view, and the status claim's text.
    assert_eq!(View::new(&h.app).id(), before + 2, "{}", h.app.text());
    let screen = h.app.text();
    let line = screen.lines().find(|line| line.contains("2 MCP")).unwrap();
    assert!(line.contains("status ses_x") && line.trim_end().ends_with("local"), "{screen}");
    h.app.resize(120, 30);
    h.wait("the footer to follow the width", || {
        h.app.text().lines().any(|line| {
            line.contains("status ses_x") && line.trim_end().ends_with("local") && line.trim_end().chars().count() > 110
        })
    });
}

#[allow(unsafe_code)]
unsafe extern "C" fn footer_create(
    host: *const abi::HostApi,
    options: abi::Bytes,
    instance: *mut *mut c_void,
    out: *mut abi::Owned,
) -> i32 {
    let plugin = opencode_tui::plugins::home_footer::plugin();
    // SAFETY: the loader passes what `PluginApi::create` documents.
    unsafe { abi::runtime::create("loopback.home.footer", plugin.setup, host, options, instance, out) }
}

/// The cells of the footer's three rows (the prompt's placeholder above them is random).
fn footer(h: &Harness) -> Vec<opentui::testing::Cell> {
    let frame = h.app.render();
    frame.cells[((frame.height - 3) * frame.width) as usize..].to_vec()
}

/// The footer rows with the status claim, as mounted, after a status change and after a resize. With `loopback`, the
/// footer is wired through the byte shims of the C ABI (`Loopback`) instead of running in process.
fn footer_frames(loopback: bool) -> Vec<Vec<opentui::testing::Cell>> {
    let plugins: &[&str] = if loopback { &["-opencode.home.footer"] } else { &[] };
    let h = mount(100, plugins, vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    if loopback {
        let (definition, _) =
            opencode_plugin::loader::native::loopback(&opencode_tui::plugins::host::host(&h.tui), footer_create)
                .unwrap();
        opencode_tui::plugins::host::add(&h.tui, definition);
    }
    h.wait_for("2 MCP");
    h.wait_for("status none");
    let mut frames = vec![footer(&h)];
    started(&h, "ses_x");
    h.wait_for("status ses_x");
    frames.push(footer(&h));
    h.app.resize(60, 30);
    h.wait("the footer to follow the width", || h.app.text().lines().all(|line| !line.contains("/mcps")));
    frames.push(footer(&h));
    frames
}

// Expected: the home footer draws the same cells through the C ABI's byte shims as in process, its nested slot
// included.
#[test]
fn the_home_footer_draws_the_same_through_the_c_abi_loopback() {
    assert_eq!(footer_frames(true), footer_frames(false));
}

/// A `home.footer.status` claim whose root grows: `L` at its start and `R` at its end.
fn growing(setup: &mut abi::Setup) -> Result<(), String> {
    use abi::{Layout, Node, Render, Span};
    setup.slot(abi::Placement::append("home.footer.status"), |_, _, _| {
        let spacer = Node::column(Vec::new()).layout(Layout::default().grow());
        let row = Node::row(vec![Node::text([Span::new("L")]), spacer, Node::text([Span::new("R")])]);
        Render::Show(row.layout(Layout::default().grow()))
    });
    Ok(())
}

// Expected: a status claim is a flex item of the footer's row, as in TS's `<Slot>` fragment, so a growing root takes
// its share of the room between the MCP servers and the version with the footer's spacer (carbon's probe 2).
#[test]
fn a_growing_status_claim_fills_the_footer_row() {
    let h = mount(100, &[], vec![abi::Plugin { id: "test.grow", setup: growing }.into()]);
    h.wait_for("2 MCP");
    let screen = h.app.text();
    let line = screen.lines().find(|line| line.contains("2 MCP")).unwrap();
    let (left, right) = (line.find(" L ").unwrap(), line.find(" R ").unwrap());
    assert!(right - left > 30 && line.trim_end().ends_with("local"), "{screen}");
}

// Expected: with the footer plugin off, `home.footer.status` is not mounted, so a status claim is appended to
// `home.footer` instead (TS `survivingAncestor`).
#[test]
fn a_status_claim_shows_in_the_home_footer_without_the_footer_plugin() {
    let h = mount(100, &["-opencode.home.footer"], vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    h.wait_for("status none");
    assert!(!h.app.text().contains("2 MCP"), "{}", h.app.text());
}

/// The home at `width` columns, whose server lists `failed` failed plugins after a moment, so the answer comes after the
/// footer's first renders.
fn mount_failing(width: u16, failed: &'static [&'static str]) -> Harness {
    let fake = Fake::new(move |seen| match (seen.method.as_str(), seen.path.as_str()) {
        ("GET", "/api/plugin") => {
            std::thread::sleep(std::time::Duration::from_millis(300));
            let plugins: Vec<_> = failed
                .iter()
                .map(|name| json!({
                    "source": { "type": "package", "target": name }, "features": { "server": true },
                    "state": { "status": "failed", "error": "Cannot find module" },
                }))
                .chain([json!({ "source": { "type": "builtin" }, "features": { "server": true }, "state": { "status": "active" } })])
                .collect();
            (200, list(DIRECTORY, json!(plugins)))
        }
        _ => support::base(seen, DIRECTORY),
    });
    let deps = Deps {
        config: support::config(support::decode(r#"{ "animations": false }"#)),
        route: Route::Home,
        ..support::deps(Arc::new(fake))
    };
    support::mount(width, 30, deps)
}

// Expected: the footer counts the failed server plugins once their list arrives, which tells the claims `local`, with
// `/plugins` from 80 columns; a click on the count opens the plugin manager, and the new failure shows TS's error
// toast that offers to open it (carbon-5).
#[test]
fn the_footer_counts_failed_plugins_and_a_toast_tells_of_them() {
    let h = mount_failing(100, &["team-audit"]);
    let screen = h.wait_for("1 plugin failed");
    let line = screen.lines().find(|line| line.contains("1 plugin failed")).unwrap();
    assert!(line.contains("⊙ 1 plugin failed /plugins"), "{screen}");
    let screen = h.wait_for("Plugin failed: team-audit");
    assert!(screen.contains("Run /plugins to view details.") && screen.contains("Open plugins"), "{screen}");
    h.tui.toasts.dismiss();
    h.wait_gone("Open plugins");
    let (x, y) = support::at(&h.app.text(), "/plugins").unwrap();
    h.app.click(x, y);
    h.wait_for("Plugins");
    h.wait_for("team-audit");

    let h = mount_failing(70, &["one", "two"]);
    let screen = h.wait_for("⊙ 2 plugins failed");
    let line = screen.lines().find(|line| line.contains("⊙ 2 plugins failed")).unwrap();
    assert!(!line.contains("/plugins"), "{screen}");
    let screen = h.wait_for("one, two");
    assert!(screen.contains("2 plugins failed") && screen.contains("Open plugins"), "{screen}");
}

// Expected: a toast about a session without a title takes the session's title, as TS `toast.title ??
// session.title` (carbon-6).
#[test]
fn a_session_toast_without_a_title_takes_the_sessions() {
    let h = mount(100, &[], Vec::new());
    h.tui.navigate(support::session_route("ses_a"));
    let known = || h.tui.data.read(|state| state.session(&SessionID("ses_a".to_owned())).is_some());
    h.wait("the session", known);
    h.tui.navigate(Route::Home);
    opencode_plugin::Host::toast(
        &*h.tui,
        &abi::Toast::new(abi::Variant::Info, "Finished background job").session("ses_a"),
    );
    let screen = h.wait_for("Finished background job");
    let line = screen.lines().find(|line| line.contains("› Open")).unwrap_or_default();
    assert!(line.contains("Fix the parser"), "{screen}");
}
