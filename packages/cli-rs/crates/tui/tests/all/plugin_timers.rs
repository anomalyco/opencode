//! Timers (contract-ergonomics 2.3): a plugin keeps time on the host's clock, with no thread of its own, and a timer
//! whose plugin changes nothing costs no frame.

use std::cell::Cell;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::abi::v2;
use opencode_tui::{Deps, Route};

use crate::support;

thread_local! {
    /// The ticks of [`ticking`]'s `every`.
    static TICKS: Cell<u32> = const { Cell::new(0) };
}

/// A route whose view never changes, and a one-second `every` from setup that changes nothing.
fn ticking(setup: &mut abi::Setup) -> Result<(), String> {
    let tasks = setup.tasks();
    tasks.every(setup.host(), Duration::from_secs(1), |_| async {
        TICKS.set(TICKS.get() + 1);
        ControlFlow::Continue(())
    });
    // Once the host holds its tree, the view keeps it.
    setup.surface(v2::Surface::new("tick", v2::Place::Route("tick".into()), |view| match view.input.full {
        true => v2::Node::text(vec![abi::Span::new("ticking")]).with_id("root"),
        false => v2::Node::keep("root"),
    }));
    Ok(())
}

/// [`ticking`] in Luau.
#[cfg(feature = "luau")]
const TICKING: &str = r#"local plugin = require("@opencode/plugin")
return plugin.define(function(setup)
    plugin.every(1000, function() end)
    setup:surface({ name = "tick", place = { type = "route", name = "tick" } }, function(view)
        if view.input.full then
            return { type = "text", id = "root", spans = { { text = "ticking" } } }
        end
        return { type = "keep", key = "root" }
    end)
end)
"#;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    InProcess,
    CAbi,
    #[cfg(feature = "luau")]
    Luau,
}

// Expected (timers, contract-ergonomics 2.3; big-boi tm-2): a one-second `every` whose route's view does not change
// ticks once a second and makes no frame, also over 400 s: the app wakes for each tick and paints nothing. Disabled, the plugin's timer wakes the app
// no more. In process, through the C ABI and in Luau.
#[test]
fn a_ticking_plugin_that_changes_nothing_makes_no_frame() {
    #[cfg_attr(not(feature = "luau"), allow(unused_mut))]
    let mut carriers = vec![Carrier::InProcess, Carrier::CAbi];
    #[cfg(feature = "luau")]
    carriers.push(Carrier::Luau);
    for carrier in carriers {
        ticks_without_frames(carrier);
    }
}

fn ticks_without_frames(carrier: Carrier) {
    TICKS.set(0);
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&h.tui);
    let definition = match carrier {
        Carrier::CAbi => {
            let entries = abi::export_plugin!(@loopback "test.tick", ticking);
            opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
        }
        #[cfg(feature = "luau")]
        Carrier::Luau => {
            let sources = opencode_plugin::luau::Sources::from_files([
                ("plugin.toml", "id = \"test.tick\""),
                ("init.luau", TICKING),
            ]);
            opencode_plugin::luau::define(&sources, None).unwrap().0
        }
        Carrier::InProcess => abi::Plugin { id: "test.tick", setup: ticking }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h.tui.navigate(Route::Plugin { id: "test.tick".into(), name: "tick".into() });
    h.wait_for("ticking");
    // The startup polls end, and the route's first frames are painted.
    h.app.idle(Duration::from_secs(3));
    let ticks = TICKS.get();
    let ticking = h.app.idle(Duration::from_secs(5));
    assert_eq!(ticking.frames, 0, "{carrier:?}: the ticks painted frames: {ticking:?}");
    // Luau's ticks are its own; the Rust ones count theirs.
    if matches!(carrier, Carrier::InProcess | Carrier::CAbi) {
        assert_eq!(TICKS.get() - ticks, 5, "{carrier:?}: it did not tick once a second");
    }
    // Nor ever: ticks with no paint between them do not add up to the frame's bound of effects (big-boi tm-2).
    let long = h.app.idle(Duration::from_secs(400));
    assert_eq!(long.frames, 0, "{carrier:?}: 400 s of ticks painted frames: {long:?}");
    assert!(h.tui.plugins.set_active(&host, "test.tick", false));
    h.app.idle(Duration::from_millis(100));
    let before = TICKS.get();
    let disabled = h.app.idle(Duration::from_secs(5));
    assert_eq!(TICKS.get(), before, "{carrier:?}: a disabled plugin ticked");
    assert!(
        ticking.wakeups >= disabled.wakeups + 4,
        "{carrier:?}: the ticks did not wake the app, or the disabled plugin's still do: {ticking:?}, {disabled:?}"
    );
}

// Expected (big-boi tm-3): a JS plugin keeps time with `setTimeout`, so the pipe refuses the raw timer request before
// it gives an ID: the effect's result is `null`, and no reply is left to wait for.
#[cfg(feature = "ts")]
#[test]
fn the_pipe_refuses_a_timer_without_giving_it_an_id() {
    let Some(config) = crate::plugin_pipe::config() else { return };
    let root = opencode_util::temp::tempdir().unwrap();
    let log = root.path().join("log");
    let plugin = root.path().join("config").join("plugins").join("timer");
    std::fs::create_dir_all(&plugin).unwrap();
    let script = format!(
        r#"import {{ appendFileSync }} from "node:fs"
export default {{ id: "example.timer", setup(api) {{
  const carrier = api[Symbol.for("opencode.carrier")]
  carrier.command({{ name: "timer.go", title: "timer.go" }}, () => {{
    carrier.effect({{ type: "timer", ms: 20 }}).then(
      (result) => appendFileSync({log:?}, "result " + JSON.stringify(result) + "\n"),
      (error) => appendFileSync({log:?}, "error " + error + "\n"),
    )
  }})
}} }}
"#
    );
    std::fs::write(plugin.join("tui.ts"), script).unwrap();
    let harness = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let external = opencode_tui::plugins::host::External {
        config_dir: root.path().join("config"),
        cwd: root.path().to_path_buf(),
        dev: Vec::new(),
    };
    opencode_tui::plugins::host::external_with(&harness.tui, external, Some(config));
    let pipe = crate::plugin_pipe::Pipe { harness, root: opencode_util::temp::tempdir().unwrap() };
    pipe.active("example.timer");
    pipe.harness.tui.keymap.dispatch("timer.go", None);
    let read = || std::fs::read_to_string(&log).unwrap_or_default();
    pipe.harness.app.wait_until(support::WAIT, || {
        pipe.harness.app.advance(Duration::from_millis(1));
        !read().is_empty()
    });
    assert_eq!(read(), "result null\n", "the pipe gave a timer an ID");
}

thread_local! {
    /// The ticks of [`every_of_a_mount`]'s `every`.
    static MOUNT_TICKS: Cell<u32> = const { Cell::new(0) };
}

/// A route whose key starts a 50 ms `every`: the mount's, as its handler started it.
fn every_of_a_mount(setup: &mut abi::Setup) -> Result<(), String> {
    let tasks = setup.tasks();
    let layer = abi::interact::Layer::default()
        .scope(abi::interact::LayerScope::Global)
        .keys(vec![abi::interact::Bind::new("x", "tick")]);
    let surface =
        v2::Surface::new("tick", v2::Place::Route("tick".into()), |_| v2::Node::text(vec![abi::Span::new("ticking")]))
            .layers(vec![layer])
            .on(move |host, event| match event {
                abi::interact::Event::Key(key) if key.bind.as_deref() == Some("tick") => {
                    tasks.every(host, Duration::from_millis(50), |_| async {
                        MOUNT_TICKS.set(MOUNT_TICKS.get() + 1);
                        ControlFlow::Continue(())
                    });
                    abi::interact::Handled::Consume
                }
                _ => abi::interact::Handled::Pass,
            });
    setup.surface(surface);
    Ok(())
}

/// [`every_of_a_mount`] in Luau: it counts its ticks in its storage.
#[cfg(feature = "luau")]
const EVERY_OF_A_MOUNT: &str = r#"local plugin = require("@opencode/plugin")
return plugin.define(function(setup)
    setup:storageKey("ticks")
    local layer = { scope = "global", keys = { { key = "x", name = "tick" } } }
    setup:surface({ name = "tick", place = { type = "route", name = "tick" }, layers = { layer } },
        function() return { type = "text", spans = { { text = "ticking" } } } end,
        function(host, event)
            if event.type == "key" and event.bind == "tick" then
                plugin.every(50, function(host)
                    local ticks = host:storageGet("ticks") or { n = 0 }
                    host:storageSet("ticks", { n = ticks.n + 1 })
                    return true
                end)
                return "consume"
            end
            return "pass"
        end)
end)
"#;

// Expected (timers, big-boi's note on `every`): an `every` a mount's handler started is that mount's: each tick's call is
// the mount's, so each next sleep is too, and the loop ends when the mount closes, also after its first tick. In
// process, through the C ABI and in Luau.
#[test]
fn an_every_a_mount_started_ends_with_that_mount() {
    #[cfg_attr(not(feature = "luau"), allow(unused_mut))]
    let mut carriers = vec![Carrier::InProcess, Carrier::CAbi];
    #[cfg(feature = "luau")]
    carriers.push(Carrier::Luau);
    for carrier in carriers {
        MOUNT_TICKS.set(0);
        let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
        let host = opencode_tui::plugins::host::host(&h.tui);
        let definition = match carrier {
            Carrier::CAbi => {
                let entries = abi::export_plugin!(@loopback "test.tick", every_of_a_mount);
                opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
            }
            #[cfg(feature = "luau")]
            Carrier::Luau => {
                let files = [("plugin.toml", "id = \"test.tick\""), ("init.luau", EVERY_OF_A_MOUNT)];
                opencode_plugin::luau::define(&opencode_plugin::luau::Sources::from_files(files), None).unwrap().0
            }
            Carrier::InProcess => abi::Plugin { id: "test.tick", setup: every_of_a_mount }.into(),
        };
        opencode_tui::plugins::host::add(&h.tui, definition);
        let ticks = || match carrier {
            #[cfg(feature = "luau")]
            Carrier::Luau => opencode_plugin::Host::storage_read(&*h.tui, "plugin.test.tick.ticks")
                .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
                .and_then(|ticks| ticks["n"].as_u64())
                .map_or(0, |ticks| ticks as u32),
            _ => MOUNT_TICKS.get(),
        };
        h.tui.navigate(Route::Plugin { id: "test.tick".into(), name: "tick".into() });
        h.wait_for("ticking");
        for _ in 0..3 {
            h.app.advance(Duration::from_millis(1));
            h.app.render();
        }
        h.app.press("x");
        for _ in 0..4 {
            h.app.advance(Duration::from_millis(50));
        }
        let open = ticks();
        assert!(open >= 3, "{carrier:?}: it did not tick while the route showed: {open}");
        h.tui.navigate(Route::Home);
        h.app.advance(Duration::from_millis(10));
        let closed = ticks();
        for _ in 0..10 {
            h.app.advance(Duration::from_millis(50));
        }
        assert_eq!(ticks(), closed, "{carrier:?}: the mount's every ticked on after the mount closed");
    }
}
