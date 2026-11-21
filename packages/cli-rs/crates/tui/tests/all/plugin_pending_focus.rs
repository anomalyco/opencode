//! Verify focus requested before a plugin field's first view.

use crate::support::{self, Harness};

use std::cell::Cell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const ID: &str = "test.focus";

thread_local! {
    static SHOW: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    Linked,
    #[cfg(luau)]
    Luau,
}

fn carriers() -> Vec<Carrier> {
    vec![
        Carrier::Linked,
        #[cfg(luau)]
        Carrier::Luau,
    ]
}

#[test]
fn a_focus_of_a_field_the_next_view_lacks_is_dropped() {
    let failed: Vec<Carrier> = carriers()
        .into_iter()
        .filter(|carrier| {
            let h = open(*carrier);
            _ = h.tui.keymap.dispatch("pf.later", None);
            turns(&h, 5);
            h.app.resize(120, 24);
            h.wait_for("wide page");
            turns(&h, 5);
            focused(&h).is_some()
        })
        .collect();
    assert_eq!(failed, [], "a resize applied a focus the next view lacked");
}

#[test]
fn a_field_shown_and_focused_in_one_call_takes_the_focus() {
    let failed: Vec<Carrier> = carriers()
        .into_iter()
        .filter(|carrier| {
            let h = open(*carrier);
            _ = h.tui.keymap.dispatch("pf.show", None);
            h.wait_for("field shown");
            turns(&h, 5);
            focused(&h).as_deref() != Some("now")
        })
        .collect();
    assert_eq!(failed, [], "the field shown by the call took no focus");
}

fn open(carrier: Carrier) -> Harness {
    SHOW.set(false);
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let definition = match carrier {
        Carrier::Linked => abi::Plugin { id: ID, setup: probe }.into(),
        #[cfg(luau)]
        Carrier::Luau => {
            let sources = opencode_plugin::luau::Sources::from_files([
                ("plugin.toml", "id = \"test.focus\""),
                ("init.luau", LUAU),
            ]);
            opencode_plugin::luau::define(&sources, None).unwrap().0
        }
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    h.tui.navigate(Route::Plugin { id: ID.into(), name: "pf".into() });
    h.wait_for("focus page");
    turns(&h, 5);
    h
}

fn focused(h: &Harness) -> Option<String> {
    opencode_plugin::behave::mounts(h.app.app(), ID, "pf").pop().and_then(|mount| mount.focused)
}

fn turns(h: &Harness, count: usize) {
    for _ in 0..count {
        h.app.advance(Duration::from_millis(1));
        h.app.render();
    }
}

/// The width threshold and command expose different fields so a stale focus cannot pass accidentally.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("pf".into()));
    setup.command(command("pf.later"), |host, _| host.focus("later"));
    setup.command(command("pf.show"), |host, _| {
        SHOW.set(true);
        host.focus("now");
    });
    let surface = v2::Surface::new("pf", v2::Place::Route("pf".into()), |view| {
        let (wide, show) = (view.input.width >= 100, SHOW.get());
        view.memo("page", (wide, show), |_| page(wide, show))
    })
    .mounts();
    setup.surface(surface);
    Ok(())
}

fn page(wide: bool, show: bool) -> v2::Node {
    let text = |text: &str| v2::Node::text(vec![abi::Span::new(text)]);
    let mut nodes = vec![text(if wide { "focus page, wide page" } else { "focus page" })];
    if wide {
        nodes.push(v2::Node::input("").with_id("later"));
    }
    if show {
        nodes.push(text("field shown"));
        nodes.push(v2::Node::input("").with_id("now"));
    }
    v2::Node::column(nodes)
}

#[cfg(luau)]
const LUAU: &str = r#"local plugin = require("@opencode/plugin")
local show = false
local function text(text) return { type = "text", spans = { { text = text } } } end
return plugin.define(function(setup)
    setup:command({ name = "pf.later", scope = { route = "pf" } }, function(host) host:focus("later") end)
    setup:command({ name = "pf.show", scope = { route = "pf" } }, function(host)
        show = true
        host:focus("now")
    end)
    setup:surface({ name = "pf", place = { type = "route", name = "pf" }, mounts = true }, function(view)
        local wide = (view.input.width or 0) >= 100
        return view:memo("page", `{wide} {show}`, function()
            local children = { text(if wide then "focus page, wide page" else "focus page") }
            if wide then table.insert(children, { type = "input", id = "later" }) end
            if show then
                table.insert(children, text("field shown"))
                table.insert(children, { type = "input", id = "now" })
            end
            return { type = "box", children = children }
        end)
    end)
end)
"#;
