//! U.6 P-ORACLE on frame sequences. `parity/component/U.6-motion.tsx` renders the TUI's motion renderables under
//! OpenTUI's manual clock and stacks row 0 of the frame at each instant of `parity/fixtures/U.6/instants.json`
//! into a filmstrip. Each test builds the Rust widget in a `TestApp`, advances its clock to the same instants,
//! and compares the stacked rows cell by cell.

use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_ui::motion::{
    FadeInText, ScannerOptions, ScannerStyle, ShimmerText, Spinner, scanner_colors, scanner_frames, work_spinner,
};
use opentui::AppOptions;
use opentui::prelude::*;
use opentui::testing::TestApp;
use std::collections::BTreeMap;
use std::time::Duration;

const MUTED: Color = Color::hex(0x808080);
const TEXT: Color = Color::hex(0xeeeeee);
const BACKDROP: Color = Color::hex(0x0a0a0a);
const ACCENT: Color = Color::hex(0xfab283);
const PAGE: Color = Color::hex(0x1a1b26);
const FAINT: Color = Color::rgba(0xe4, 0xe4, 0xe4, 0x5e);

// The TypeScript screen is transparent, while an opentui-rust app clears the screen with its theme background.
fn test_app(width: u16) -> TestApp {
    let theme = Theme { background: Color::TRANSPARENT, ..Theme::default() };
    TestApp::with_options(width, 1, AppOptions { theme, light_theme: None, ..AppOptions::default() })
}

/// Renders `app` at every instant of the case and compares the filmstrip with the TypeScript one.
#[track_caller]
fn assert_filmstrip(app: &TestApp, name: &str) {
    let instants: BTreeMap<String, Vec<u64>> =
        serde_json::from_str(&std::fs::read_to_string(fixtures_dir().join("U.6/instants.json")).unwrap()).unwrap();
    let expected = Fixture::load(fixtures_dir().join(format!("U.6/{name}.json"))).unwrap();
    let mut actual = Fixture { width: expected.width, height: 0, cells: Vec::new() };
    let mut now = 0;
    for &instant in &instants[name] {
        app.advance(Duration::from_millis(instant - now));
        now = instant;
        let frame = app.render();
        actual.cells.extend(frame.cells[..frame.width as usize].iter().cloned());
        actual.height += 1;
    }
    let comparison = compare(&expected, &actual);
    assert!(comparison.is_equal(), "U.6/{name} (row N = instant N): {comparison}");
}

#[test]
fn spinner_with_label_steps_through_the_braille_frames() {
    let app = test_app(12);
    app.root().add(&Spinner::new(&app).color(MUTED).label("Working"));
    assert_filmstrip(&app, "spinner");
}

#[test]
fn prompt_scanner_matches_create_frames_and_create_colors() {
    let app = test_app(8);
    let options = ScannerOptions {
        style: ScannerStyle::Blocks,
        inactive_factor: 0.6,
        min_alpha: 0.3,
        ..ScannerOptions::new(ACCENT)
    };
    let spinner = Spinner::new(&app)
        .frames(&scanner_frames(&options))
        .color(scanner_colors(&options))
        .interval(Duration::from_millis(40));
    app.root().add(&spinner);
    assert_filmstrip(&app, "scanner");
}

#[test]
fn prompt_scanner_blends_into_the_page_background() {
    let app = test_app(8);
    let options = ScannerOptions {
        style: ScannerStyle::Blocks,
        inactive_factor: 0.6,
        min_alpha: 0.3,
        ..ScannerOptions::new(ACCENT)
    };
    let page = View::new(&app).bg(PAGE);
    page.add(
        &Spinner::new(&app)
            .frames(&scanner_frames(&options))
            .color(scanner_colors(&options))
            .interval(Duration::from_millis(40)),
    );
    app.root().add(&page);
    assert_filmstrip(&app, "scanner-page");
}

#[test]
fn an_alpha_spinner_and_label_blend_into_the_page_background() {
    let app = test_app(12);
    let page = View::new(&app).bg(PAGE);
    page.add(&Spinner::new(&app).color(FAINT).label("Working"));
    app.root().add(&page);
    assert_filmstrip(&app, "spinner-page");
}

#[test]
fn one_cell_soft_slide_brightens_by_level() {
    let app = test_app(1);
    app.root().add(&Spinner::one_cell(&app, &work_spinner("block-soft-slide").unwrap(), ACCENT));
    assert_filmstrip(&app, "soft-slide");
}

#[test]
fn shimmer_text_sweeps_toward_the_shimmer_color() {
    let app = test_app(24);
    app.root().add(&ShimmerText::new(&app, "Checking for updates…").fg(MUTED).shimmer(TEXT));
    assert_filmstrip(&app, "shimmer");
}

#[test]
fn fade_in_text_sweeps_in_from_the_backdrop() {
    let app = test_app(16);
    let backdrop = View::new(&app).bg(BACKDROP);
    backdrop.add(&FadeInText::new(&app, "Welcome back").fg(MUTED).backdrop(BACKDROP));
    app.root().add(&backdrop);
    assert_filmstrip(&app, "fade");
}

// Behavior beyond the filmstrips.

#[test]
fn animations_off_shows_the_still_glyph_and_requests_no_frames() {
    let app = test_app(12);
    app.root().add(&Spinner::new(&app).color(MUTED).label("Working").animations(false));
    assert_eq!(app.text(), "⋯ Working");
    app.advance(Duration::from_millis(500));
    assert!(!app.needs_frame());
    assert_eq!(app.text(), "⋯ Working");
}

#[test]
fn toggling_animations_resumes_the_spinner() {
    let app = test_app(12);
    let spinner = Spinner::new(&app).label("Working").animations(false);
    app.root().add(&spinner);
    spinner.set_animations(true);
    app.advance(Duration::from_millis(170));
    assert_eq!((spinner.frame(), app.text()), (2, "⠹ Working".to_owned()));
}

#[test]
fn a_shimmering_spinner_steps_its_glyph_on_the_spinner_interval() {
    let app = test_app(24);
    let spinner = Spinner::new(&app).color(MUTED).shimmer(Some(TEXT)).label("Checking");
    app.root().add(&spinner);
    for _ in 0..17 {
        app.advance(Duration::from_millis(10));
        app.render();
    }
    assert_eq!((spinner.frame(), app.text()), (2, "⠹ Checking".to_owned()));
}

#[test]
fn a_dropped_spinner_stops_its_timer() {
    let app = test_app(12);
    let spinner = Spinner::new(&app);
    app.root().add(&spinner);
    app.render();
    app.advance(Duration::from_millis(80));
    assert!(app.needs_frame(), "a live spinner redraws on its interval");
    app.render();
    spinner.detach();
    drop(spinner);
    app.render();
    app.advance(Duration::from_millis(400));
    assert!(!app.needs_frame());
}

#[test]
fn fade_in_settles_and_a_disabled_fade_shows_at_once() {
    let app = test_app(16);
    app.root().add(&FadeInText::new(&app, "Welcome back").fg(MUTED).enabled(false));
    let frame = app.render();
    assert_eq!((frame.text(), frame.cells[0].fg), ("Welcome back".to_owned(), MUTED));

    let app = test_app(16);
    app.root().add(&FadeInText::new(&app, "Welcome back").fg(MUTED).backdrop(BACKDROP));
    for _ in 0..30 {
        app.advance(Duration::from_millis(10));
        app.render();
    }
    assert!(!app.needs_frame(), "the fade stops after 200 ms");
    assert_eq!(app.render().cells[11].fg, MUTED);
}
