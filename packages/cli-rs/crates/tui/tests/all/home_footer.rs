//! Home footer status claims across carriers and screen sizes.

use crate::support::{self, DIRECTORY, Fake, Harness, list};

use std::cell::RefCell;
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

#[test]
fn a_status_claim_updates_while_the_footer_keeps_its_node() {
    let h = mount(100, &[], vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    h.wait_for("2 MCP");
    h.wait_for("status none");
    h.app.wait_until(std::time::Duration::from_millis(100), || false);
    let before = View::new(&h.app).id();
    started(&h, "ses_x");
    h.wait_for("status ses_x");
    // The probe view only.
    assert_eq!(View::new(&h.app).id(), before + 1, "{}", h.app.text());
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

fn footer(h: &Harness) -> Vec<opentui::testing::Cell> {
    let frame = h.app.render();
    frame.cells[((frame.height - 3) * frame.width) as usize..].to_vec()
}

/// The home footer's own source built as a `cdylib` (`crates/plugin/examples/home-footer`), once per test run.
fn library() -> Vec<u8> {
    static BUILT: std::sync::Mutex<Option<Vec<u8>>> = std::sync::Mutex::new(None);
    let mut built = BUILT.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(library) = &*built {
        return library.clone();
    }
    let crate_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/home-footer");
    let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/home-footer-plugin");
    let status = std::process::Command::new(std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_owned()))
        .args(["build", "--quiet", "--manifest-path"])
        .arg(crate_dir.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target)
        .status()
        .unwrap();
    assert!(status.success(), "the home footer library did not build");
    let name = format!("{}opencode_home_footer{}", std::env::consts::DLL_PREFIX, std::env::consts::DLL_SUFFIX);
    let library = std::fs::read(target.join("debug").join(name)).unwrap();
    *built = Some(library.clone());
    library
}

#[derive(Clone, Copy, Debug)]
enum Run {
    Linked,
    /// Through the byte shims of the C ABI (`Loopback`), in process.
    Loopback,
    Library,
}

/// The footer rows with the status claim, as mounted, after a status change and after a resize, the footer run as
/// `run` says.
fn footer_frames(run: Run) -> Vec<Vec<opentui::testing::Cell>> {
    let plugins: &[&str] = if matches!(run, Run::Linked) { &[] } else { &["-opencode.home.footer"] };
    let h = mount(100, plugins, vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    let _root = matches!(run, Run::Library).then(|| {
        let root = opencode_util::temp::tempdir().unwrap();
        let config = root.path().join("config");
        let dir = config.join("plugins").join("home-footer");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(opencode_plugin::loader::entry_file()), library()).unwrap();
        let external = opencode_tui::plugins::host::External {
            config_dir: config,
            cwd: root.path().to_path_buf(),
            dev: Vec::new(),
        };
        opencode_tui::plugins::host::external(&h.tui, external);
        root
    });
    if matches!(run, Run::Loopback) {
        let (definition, _) = opencode_plugin::loader::native::loopback(
            &opencode_tui::plugins::host::host(&h.tui),
            abi::export_plugin!(@loopback "loopback.home.footer", opencode_tui::plugins::home_footer::plugin().setup),
        )
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

#[test]
fn the_home_footer_draws_the_same_through_the_c_abi_loopback() {
    let linked = footer_frames(Run::Linked);
    assert_eq!(footer_frames(Run::Loopback), linked);
    assert_eq!(footer_frames(Run::Library), linked);
}

#[test]
fn a_nested_status_claim_stays_across_the_footer_thresholds() {
    let h = mount(100, &[], vec![abi::Plugin { id: "test.status", setup: status }.into()]);
    h.wait_for("2 MCP");
    h.wait_for("status none");
    for (height, shown) in [(15, true), (13, false), (30, true), (15, true)] {
        h.app.resize(100, height);
        let ready = || {
            let screen = h.app.render().text();
            let row = screen.lines().any(|line| line.contains("2 MCP") && line.contains("status none"));
            screen.contains("2 MCP") == shown && screen.contains("status none") && (row || !shown)
        };
        h.wait(&format!("the footer at {height} rows"), ready);
        for _ in 0..5 {
            h.app.advance(std::time::Duration::from_millis(1));
            assert!(ready(), "{height} rows, five frames on:\n{}", h.app.render().text());
        }
    }
}

thread_local! {
    static SHOWN: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
}

/// A 2.0 surface in `home.footer` whose box holds a label and the `home.footer.status` slot, shown or hidden by its
/// command `toggle.flip`, which changes nothing else.
fn toggle(setup: &mut abi::Setup) -> Result<(), String> {
    use opencode_plugin::abi::v2::{Node, Place, Surface};
    setup.command(abi::Command::new("toggle.flip"), |_, _| {
        SHOWN.set(!SHOWN.get());
    });
    setup.surface(Surface::new("toggle", Place::Slot(abi::Placement::append("home.footer")), |_| {
        let label = Node::text([abi::Span::new("label")]);
        Node::row(vec![label, Node::Slot { path: "home.footer.status".into() }]).gap(1).visible(SHOWN.get())
    }));
    Ok(())
}

#[test]
fn a_hidden_and_shown_box_keeps_its_nested_claim() {
    SHOWN.set(true);
    let plugins = vec![
        abi::Plugin { id: "test.toggle", setup: toggle }.into(),
        abi::Plugin { id: "test.status", setup: status }.into(),
    ];
    let h = mount(100, &["-opencode.home.footer"], plugins);
    h.wait_for("label status none");
    h.dispatch("toggle.flip");
    h.wait_gone("label");
    h.dispatch("toggle.flip");
    h.wait_for("label");
    for _ in 0..5 {
        h.app.advance(std::time::Duration::from_millis(1));
    }
    assert!(h.app.render().text().contains("label status none"), "{}", h.app.text());
}

fn growing(setup: &mut abi::Setup) -> Result<(), String> {
    use abi::{Layout, Node, Render, Span};
    setup.slot(abi::Placement::append("home.footer.status"), |_, _, _| {
        let spacer = Node::column(Vec::new()).layout(Layout::default().grow());
        let row = Node::row(vec![Node::text([Span::new("L")]), spacer, Node::text([Span::new("R")])]);
        Render::Show(row.layout(Layout::default().grow()))
    });
    Ok(())
}

#[test]
fn a_growing_status_claim_fills_the_footer_row() {
    let h = mount(100, &[], vec![abi::Plugin { id: "test.grow", setup: growing }.into()]);
    h.wait_for("2 MCP");
    let screen = h.app.text();
    let line = screen.lines().find(|line| line.contains("2 MCP")).unwrap();
    let (left, right) = (line.find(" L ").unwrap(), line.find(" R ").unwrap());
    assert!(right - left > 30 && line.trim_end().ends_with("local"), "{screen}");
}

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
