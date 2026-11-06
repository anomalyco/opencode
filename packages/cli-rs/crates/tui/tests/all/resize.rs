//! Footers that follow the terminal size (`useTerminalDimensions`) refresh on a resize alone, with no store
//! change: the home footer, the prompt footer and the sidebar footer.

use crate::support::{self, DIRECTORY, Fake, Harness};

use std::sync::Arc;

use opencode_tui::{Deps, Route};

fn mount(width: u16, height: u16, route: Route) -> Harness {
    let fake = Fake::new(|seen| support::base(seen, DIRECTORY));
    support::mount(
        width,
        height,
        Deps { config: support::config(support::still()), route, ..support::deps(Arc::new(fake)) },
    )
}

#[test]
fn the_home_footer_hides_when_the_terminal_gets_short() {
    let h = mount(80, 20, Route::Home);
    h.wait_for("ctrl+p commands");
    h.wait_for("Model M");
    h.app.advance(std::time::Duration::from_millis(10));
    let screen = h.app.text();
    assert!(screen.lines().last().unwrap().trim_end().ends_with("local"), "{screen}");
    h.app.resize(80, 12);
    h.wait("the home footer stays below 14 rows", || !h.app.text().contains("local"));
}

#[test]
fn the_prompt_footer_shows_its_hints_when_the_terminal_gets_wide() {
    let h = mount(36, 20, Route::Home);
    h.wait_for("Model M");
    h.app.advance(std::time::Duration::from_millis(10));
    assert!(!h.app.text().contains("ctrl+p commands"), "{}", h.app.text());
    h.app.resize(80, 20);
    h.wait_for("ctrl+p commands");
}

#[test]
fn the_sidebar_card_shows_when_the_terminal_gets_tall() {
    let h = mount(140, 18, support::session_route("ses_a"));
    h.wait_for("Fix the parser");
    h.app.advance(std::time::Duration::from_millis(10));
    assert!(!h.app.text().contains("Getting started"), "{}", h.app.text());
    h.app.resize(140, 26);
    h.wait_for("Getting started");
}
