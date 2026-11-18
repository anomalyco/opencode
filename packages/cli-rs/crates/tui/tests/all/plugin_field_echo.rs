//! Verify that a delayed field echo does not overwrite a more recent edit.

use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::{self, v2};
use opencode_tui::{Deps, Route};

const ID: &str = "test.echo";

thread_local! {
    static VALUE: RefCell<(String, Option<u64>)> = const { RefCell::new((String::new(), None)) };
    static EDITS: RefCell<Vec<(u64, String)>> = const { RefCell::new(Vec::new()) };
}

#[test]
fn a_value_the_field_reported_leaves_what_the_user_typed_since() {
    VALUE.set((String::new(), None));
    EDITS.set(Vec::new());
    let h = support::mount(80, 24, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_tui::plugins::host::add(&h.tui, abi::Plugin { id: ID, setup: probe }.into());
    h.tui.navigate(Route::Plugin { id: ID.into(), name: "fe".into() });
    h.wait_for("echo page");
    _ = h.tui.keymap.dispatch("fe.focus", None);
    turns(&h);
    h.app.type_text("ab");
    turns(&h);
    let seq = |text: &str| EDITS.with_borrow(|edits| edits.iter().rfind(|(_, said)| said == text).map(|(seq, _)| *seq));
    let mut shown = Vec::new();
    for (value, seen) in [("a", seq("a")), ("x", seq("ab"))] {
        shown.push(show(&h, value, seen));
    }
    h.app.press("backspace");
    h.app.type_text("y");
    turns(&h);
    assert_eq!(EDITS.with_borrow(|edits| edits.len()), 4, "{:?}", EDITS.with_borrow(Clone::clone));
    shown.push(show(&h, "", None));
    assert_eq!(shown, ["ab", "x", ""]);
}

/// What the field shows once the probe's view gives it `value`, made after it heard edit `seen`.
fn show(h: &Harness, value: &str, seen: Option<u64>) -> String {
    VALUE.set((value.to_owned(), seen));
    _ = h.tui.keymap.dispatch("fe.set", None);
    turns(h);
    field(h)
}

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

fn probe(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command::new(name).scope(abi::Scope::Route("fe".into()));
    setup.command(command("fe.focus"), |host, _| host.focus("field"));
    setup.command(command("fe.set"), |_, _| ());
    let surface = v2::Surface::new("fe", v2::Place::Route("fe".into()), |_| {
        let title = v2::Node::text(vec![abi::Span::new("echo page")]);
        let (value, seen) = VALUE.with_borrow(Clone::clone);
        let input = v2::Node::Input {
            id: Some("field".into()),
            value,
            placeholder: String::new(),
            lines: None,
            layout: abi::Layout::default(),
            seen,
        };
        v2::Node::column(vec![title, input])
    })
    .on(|_, event| {
        if let abi::interact::Event::Change { text, seq, .. } = event {
            EDITS.with_borrow_mut(|edits| edits.push((*seq, text.clone())));
        }
        abi::interact::Handled::Pass
    });
    setup.surface(surface);
    Ok(())
}
