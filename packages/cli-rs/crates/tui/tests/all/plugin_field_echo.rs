//! A field's echo (contract ergonomics, step 8). A tree that gives a field a text the field reported as a `change` is
//! the plugin catching up with the user, and leaves what they typed since; any other value replaces the text. Over the
//! pipe, a tree made before the user's later keys came took their letters back: `P.8/session-manager`'s search showed
//! "tee" for "theme".

use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const ID: &str = "test.echo";

thread_local! {
    /// The value the probe's view gives its field.
    static VALUE: RefCell<String> = const { RefCell::new(String::new()) };
}

// Expected: the user types "ab" into the field. A view that gives it "a", which it reported after the first key,
// leaves "ab"; one that gives it "x", which it never reported, shows "x"; and "ab" again, reported before "x" replaced
// it, is a new value too and shows "ab".
#[test]
fn a_value_the_field_reported_leaves_what_the_user_typed_since() {
    VALUE.set(String::new());
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: ID, setup: probe }.into());
    h.tui.navigate(Route::Plugin { id: ID.into(), name: "fe".into() });
    h.wait_for("echo page");
    _ = h.tui.keymap.dispatch("fe.focus", None);
    turns(&h);
    h.app.type_text("ab");
    turns(&h);
    let mut shown = Vec::new();
    for value in ["a", "x", "ab"] {
        _ = h.tui.keymap.dispatch("fe.set", Some(value));
        turns(&h);
        shown.push(field(&h));
    }
    assert_eq!(shown, ["ab", "x", "ab"]);
}

/// The text of the field, on the line under the page's title.
fn field(h: &Harness) -> String {
    let screen = h.app.render().text();
    let mut lines = screen.lines().skip_while(|line| !line.contains("echo page"));
    lines.nth(1).unwrap_or_default().trim().to_owned()
}

fn turns(h: &Harness) {
    for _ in 0..5 {
        h.app.advance(Duration::from_millis(1));
        h.app.render();
    }
}

/// The probe: a route `fe` of a title over the field `field`, whose value `fe.set` sets; `fe.focus` focuses it.
fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("fe".into()));
    setup.command(command("fe.focus"), |host, _| host.focus("field"));
    setup.command(command("fe.set"), |_, input| VALUE.set(input.unwrap_or_default().to_owned()));
    let surface = v2::Surface::new("fe", v2::Place::Route("fe".into()), |_| {
        let title = v2::Node::text(vec![abi::Span::new("echo page")]);
        v2::Node::column(vec![title, v2::Node::input(VALUE.with_borrow(Clone::clone)).with_id("field")])
    });
    setup.surface(surface);
    Ok(())
}
