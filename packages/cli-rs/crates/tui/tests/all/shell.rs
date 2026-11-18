use crate::support;

use std::sync::Arc;

use opencode_tui::{Deps, Route};
use opentui::prelude::*;
use opentui::testing::TestApp;

#[test]
fn a_theme_change_keeps_a_pending_leader_and_the_focus() {
    let app = TestApp::new(80, 30);
    let tui = opencode_tui::mount(&app, support::deps(Arc::new(support::empty())));
    // The home's logo (E.1).
    support::wait_for(&app, "█▀▀█");

    // The terminal reports a light background between the leader and its second key.
    app.press("ctrl+x");
    app.event(Event::ThemeMode(opentui::theme::ThemeMode::Light));
    app.press("l");
    assert!(tui.dialogs.is_open(), "the session list did not open:\n{}", app.text());
    support::wait_for(&app, "Search sessions");
    app.press("escape");
    assert!(!tui.dialogs.is_open());

    // A focused prompt stays focused across a theme change.
    let prompt = tui.textarea.borrow().clone().unwrap();
    app.app().focus(&prompt);
    app.type_text("draft");
    support::wait_for(&app, "draft");
    app.event(Event::ThemeMode(opentui::theme::ThemeMode::Dark));
    app.type_text(" kept");
    support::wait_for(&app, "draft kept");
}

// Expected: in the `system` theme, the terminal's color scheme notice (`?997`) reads the palette again and the theme
// follows it, as TS `theme.tsx` does. Actual: the palette was read once at startup and `system` stayed stale.
#[test]
fn the_system_theme_follows_the_terminal_palette_after_a_color_scheme_change() {
    use opentui::input::OscColor;
    let app = TestApp::with_options(80, 30, AppOptions { palette_size: 16, ..AppOptions::default() });
    let theme = opencode_local::cli_config::Theme { name: Some("system".into()), mode: None };
    let info = opencode_local::cli_config::Info { theme: Some(theme), ..Default::default() };
    let deps = Deps { config: support::config(info), route: Route::Home, ..support::deps(Arc::new(support::empty())) };
    let tui = opencode_tui::mount(&app, deps);
    support::wait_for(&app, "█▀▀█");
    let foreground = Color::rgb(0xe0, 0xd0, 0xc0);
    assert_ne!(tui.page().text.base, foreground);

    app.event(Event::ColorScheme);
    let colors = (0..16).map(|index| OscColor::Palette(index, Color::rgb(index * 16, 0x40, 0x80)));
    let rest = [
        OscColor::Foreground(foreground),
        OscColor::Background(Color::rgb(0x10, 0x10, 0x18)),
        OscColor::Cursor(Color::rgb(0xff, 0xff, 0xff)),
    ];
    for color in colors.chain(rest) {
        app.event(Event::Color(color));
    }
    assert_eq!(tui.page().text.base, foreground, "the system theme takes the new foreground");
    support::wait_for(&app, "█▀▀█");
}
