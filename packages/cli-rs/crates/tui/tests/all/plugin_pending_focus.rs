//! A focus of a field the mount's tree does not hold yet (contract 2.x, step B) on the carriers that view as the call
//! returns: linked Rust, the C ABI and Luau. It waits for the mount's next view and no longer: the view after the call
//! that asked. If that view shows the field, the field takes the focus (session-manager's `/`, which shows its search
//! field and focuses it in one call); if not, the focus is dropped, and a resize that shows the field later does not
//! focus it (big-boi's G2 of step B). The pipe's rows are in `plugin_compat`.

use crate::support::{self, Harness};

use std::cell::Cell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const ID: &str = "test.focus";

thread_local! {
    /// Whether the linked and C ABI probe's page shows its field `now`.
    static SHOW: Cell<bool> = const { Cell::new(false) };
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    Linked,
    CAbi,
    #[cfg(feature = "luau")]
    Luau,
}

fn carriers() -> Vec<Carrier> {
    vec![
        Carrier::Linked,
        Carrier::CAbi,
        #[cfg(feature = "luau")]
        Carrier::Luau,
    ]
}

// Expected: a route's command focuses `later`, a field its page shows only at 100 columns or more, at 80 columns. The
// view after the call keeps the page as it is, without the field, so the focus is dropped; the terminal widened to 120
// columns shows the field, which stays unfocused.
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

// Expected (session-manager's `/`): a route's command shows the field `now` and focuses it in one call. The view
// after the call shows it, and the field takes the focus.
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

/// The TUI at 80 columns on the probe's route, on `carrier`.
fn open(carrier: Carrier) -> Harness {
    SHOW.set(false);
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    let host = opencode_tui::plugins::host::host(&h.tui);
    let definition = match carrier {
        Carrier::Linked => abi::Plugin { id: ID, setup: probe }.into(),
        Carrier::CAbi => {
            let entries = abi::export_plugin!(@loopback "test.focus", probe);
            opencode_plugin::loader::native::loopback(&host, entries).unwrap().0
        }
        #[cfg(feature = "luau")]
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

/// The node of the route's mount that has the focus.
fn focused(h: &Harness) -> Option<String> {
    opencode_plugin::behave::mounts(h.app.app(), ID, "pf").pop().and_then(|mount| mount.focused)
}

fn turns(h: &Harness, count: usize) {
    for _ in 0..count {
        h.app.advance(Duration::from_millis(1));
        h.app.render();
    }
}

/// The probe: a route `pf` whose page shows the field `later` at 100 columns or more, and the field `now` once its
/// command `pf.show` ran; `pf.later` focuses `later` and changes nothing. The page is a memo of both, so a view that
/// changes neither keeps it.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    let command =
        |name: &str| abi::Command::default().with_name(name.into()).with_scope(abi::Scope::Route("pf".into()));
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

/// The probe in Luau.
#[cfg(feature = "luau")]
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
