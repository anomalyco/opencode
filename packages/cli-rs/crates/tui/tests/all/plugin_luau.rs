//! Luau plugins in the real TUI (spike `luau-spike`): an example draws and sends what its Rust twin does, a dialog's
//! answer comes back, and a plugin that spins is failed on CPU time while the TUI keeps drawing. The ownership table's
//! Luau column is `plugin_ownership`.

use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};

use opencode_plugin::abi::{self, Click, Command, Node, Placement, Render, Span, Toast, Variant};
use opencode_plugin::luau::{Sources, define};
use opencode_tui::{Deps, Route};

use crate::support::{self, Harness};

fn home(definition: opencode_plugin::Definition) -> Harness {
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, definition);
    h
}

fn example(name: &str) -> opencode_plugin::Definition {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/luau").join(name);
    define(&Sources::read(&dir).unwrap(), None).unwrap().0
}

fn frames(h: &Harness) {
    for _ in 0..3 {
        h.app.advance(Duration::from_millis(16));
        h.app.render();
    }
}

fn hello(setup: &mut abi::Setup) -> Result<(), String> {
    setup.command(Command::new("hello.greet").title("Say hello").slash("hello").palette(), |host, _input| {
        host.toast(Toast::new(Variant::Success, "Hello from a plugin"))
    });
    setup.slot(Placement::append("home.footer"), |_read, _input, _changed| {
        let text = Node::text([Span::new("hello").fg("text.muted")]);
        Render::Show(text.on_click(Click::command("hello.greet")))
    });
    Ok(())
}

#[test]
fn the_luau_quick_start_draws_and_sends_what_its_rust_source_does() {
    let rust = home(abi::Plugin { id: "example.hello", setup: hello }.into());
    let luau = home(example("hello"));
    let shown = |h: &Harness| {
        h.wait_for("hello");
        frames(h);
        let text = h.app.text();
        text.lines().map(|line| line.split("Ask anything").next().unwrap_or_default()).collect::<Vec<_>>().join("\n")
    };
    assert_eq!(shown(&luau), shown(&rust));
    for h in [&rust, &luau] {
        _ = h.tui.keymap.dispatch("hello.greet", None);
        h.wait_for("Hello from a plugin");
    }
    assert_eq!(shown(&luau), shown(&rust));
}

// The session and its reads are served: a fixture 404 for them sends the TUI home with an error toast, which lands at
// any time and, after the confirm, replaces the plugin's toast (the Windows preview run 44610300253).
#[test]
fn the_counter_asks_before_it_resets_and_its_answer_comes_back() {
    let server = support::Fake::new(|seen| match seen.path.as_str() {
        "/api/session/ses_a/inbox" => (200, serde_json::json!({ "data": [] })),
        _ => support::base(seen, support::DIRECTORY),
    });
    let h = support::mount(100, 30, support::deps(Arc::new(server)));
    h.wait_for("Fix the parser");
    opencode_tui::plugins::host::add(&h.tui, example("counter"));
    for _ in 0..3 {
        _ = h.tui.keymap.dispatch("counter.count", None);
        frames(&h);
    }
    _ = h.tui.keymap.dispatch("counter.reset", None);
    h.wait_for("The count is 3.");
    h.app.press("return");
    h.wait_for("The count is 0");
}

fn page(view: &str) -> Harness {
    let init = format!(
        r#"
        local plugin = require("@opencode/plugin")
        local builds, views = 0, 0
        return plugin.define(function(setup)
            setup:command({{ name = "poke" }}, function() end)
            setup:surface({{ name = "page", place = {{ type = "route", name = "page" }} }}, function(view)
                {view}
            end)
        end)
    "#
    );
    let sources = Sources::from_files([("plugin.toml", "id = \"test.page\""), ("init.luau", &init)]);
    let h = home(define(&sources, None).unwrap().0);
    h.tui.navigate(Route::Plugin { id: "test.page".into(), name: "page".into() });
    h
}

#[test]
fn a_luau_memo_keeps_its_subtree_while_its_value_stays() {
    let h = page(
        r#"views += 1
                local value = if builds >= 2 then 2 else 1
                local cards = view:memo("cards", value, function()
                    builds += 1
                    return { type = "text", spans = { { text = "cards built" } } }
                end)
                local count = { type = "text", spans = { { text = `builds {builds} views {views}` } } }
                return { type = "box", id = "root", children = { cards, count } }"#,
    );
    h.wait_for_all(&["cards built", "builds 1"]);
    for _ in 0..3 {
        _ = h.tui.keymap.dispatch("poke", None);
        frames(&h);
    }
    // The view ran again for each poke; the memo built once.
    let text = h.app.text();
    let views: u32 = text.split("views ").nth(1).and_then(|rest| rest.split_whitespace().next()?.parse().ok()).unwrap();
    assert!(text.contains("cards built") && text.contains("builds 1 views") && views > 1, "{text}");
}

#[test]
fn a_refused_luau_tree_fails_the_plugin_the_second_time() {
    let h = page(
        r#"local function same() return { type = "text", id = "x", spans = { { text = "twice" } } } end
                return { type = "box", children = { same(), same() } }"#,
    );
    h.wait("the plugin failed", || {
        frames(&h);
        let entries = h.tui.plugins.entries();
        entries
            .iter()
            .any(|entry| entry.id == "test.page" && matches!(entry.status, opencode_plugin::Status::Failed(_)))
    });
    assert!(!h.app.text().contains("twice"));
}

#[test]
fn a_spinning_luau_plugin_is_failed_and_the_tui_keeps_drawing() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "spin" }, function() while true do end end)
            setup:slot({ path = "home.footer" }, function() return plugin.show(plugin.text("spinner claim")) end)
        end)
    "#;
    let sources = Sources::from_files([("plugin.toml", "id = \"test.spin\""), ("init.luau", init)]);
    let h = home(define(&sources, None).unwrap().0);
    h.wait_for("spinner claim");
    let start = Instant::now();
    _ = h.tui.keymap.dispatch("spin", None);
    let took = start.elapsed();
    assert!(took < Duration::from_millis(1500), "the UI thread was held {took:?}");
    h.wait_gone("spinner claim");
    let entries = h.tui.plugins.entries();
    let spin = entries.iter().find(|entry| entry.id == "test.spin").unwrap();
    let opencode_plugin::Status::Failed(error) = &spin.status else { panic!("{:?}", spin.status) };
    assert!(error.contains("Luau budget"), "{error}");
    h.app.type_text("still here");
    h.wait_for("still here");
}

// `--no-plugins` (D01-no-plugins): the quick start, in the global `plugins` directory and named in `cli.json`, loads and
// draws its footer line; with the flag it does not, and `/plugins` lists its target as skipped, with why.
#[test]
fn a_configured_luau_plugin_does_not_load_with_no_plugins() {
    for no_plugins in [false, true] {
        let root = opencode_util::temp::tempdir().unwrap();
        let config = root.path().join("config");
        let dir = config.join("plugins").join("hello");
        std::fs::create_dir_all(&dir).unwrap();
        let example = Path::new(env!("CARGO_MANIFEST_DIR")).join("../plugin/examples/luau/hello");
        for file in ["plugin.toml", "init.luau"] {
            std::fs::copy(example.join(file), dir.join(file)).unwrap();
        }
        let target = dir.to_string_lossy().into_owned();
        let deps = Deps {
            route: Route::Home,
            config: support::config(support::decode(&serde_json::json!({ "plugins": [target] }).to_string())),
            ..support::deps(Arc::new(support::empty()))
        };
        let args = opencode_tui::Args { no_plugins, ..opencode_tui::Args::default() };
        let h = support::mount_on(opentui::testing::TestApp::new(80, 24), deps, args);
        let external = opencode_tui::plugins::host::External { config_dir: config, cwd: root.path().to_path_buf() };
        opencode_tui::plugins::host::external(&h.tui, external);
        let status = || {
            let entries = h.tui.plugins.entries();
            entries.into_iter().find(|entry| entry.target.as_deref() == Some(&*target)).map(|entry| entry.status)
        };
        let expected = match no_plugins {
            false => opencode_plugin::Status::Active,
            true => opencode_plugin::Status::Skipped(opencode_plugin::SKIPPED_NO_PLUGINS.to_owned()),
        };
        h.wait("the plugin's status", || {
            frames(&h);
            status() == Some(expected.clone())
        });
        frames(&h);
        let footer = h.app.text().lines().any(|line| line.trim_end().ends_with("hello"));
        assert_eq!(footer, !no_plugins, "no_plugins {no_plugins}:\n{}", h.app.text());
    }
}

#[test]
fn a_dialog_the_host_keeps_out_answers_its_task_nil() {
    let init = r#"
        local plugin = require("@opencode/plugin")
        return plugin.define(function(setup)
            setup:command({ name = "ask" }, function(host)
                local answer = host:confirm({ title = "Kept out?", message = "asked under the host's dialog" })
                host:toast({ variant = "info", message = "answer=" .. tostring(answer) })
            end)
        end)
    "#;
    let sources = Sources::from_files([("plugin.toml", "id = \"test.ask\""), ("init.luau", init)]);
    let h = home(define(&sources, None).unwrap().0);
    frames(&h);
    let options = opencode_ui::dialog::DialogOptions::new(opencode_ui::dialog::DialogSize::Medium).key("host.approval");
    h.tui.dialogs.replace(|cx| opentui::prelude::View::new(&cx.app), None, options);
    _ = h.tui.keymap.dispatch("ask", None);
    h.wait_for("answer=nil");
    assert!(!h.app.text().contains("Kept out?"));
}
