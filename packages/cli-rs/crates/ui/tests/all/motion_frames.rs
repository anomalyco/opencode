use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_ui::motion::{
    FadeInText, ScannerOptions, ScannerStyle, ShimmerText, Spinner, one_cell_frame, scanner_colors, scanner_frames,
    set_running, work_spinner,
};
use opentui::AppOptions;
use opentui::prelude::*;
use opentui::testing::{Idle, TestApp};
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
fn sequenced_one_cell_spinners_play_their_intro_and_pace_from_their_age() {
    // The seed ticks every 32 ms (its 40 ms at the 1.25 pace), the sweep every 40 ms: each instant is on a tick.
    for (name, age, instants) in
        [("seed", 0, [320, 640, 3520]), ("block-soft-sweep", 0, [1000, 2000, 4000]), ("seed", 60_000, [0, 320, 640])]
    {
        let motion = work_spinner(name).unwrap();
        let app = test_app(1);
        app.root().add(&Spinner::one_cell(&app, &motion, ACCENT).age(Duration::from_millis(age)));
        let mut now = 0;
        for instant in instants {
            app.advance(Duration::from_millis(instant - now));
            now = instant;
            let frame = app.render();
            let expected = one_cell_frame(&motion, (age + instant) as f64);
            assert_eq!(frame.text(), expected.glyph, "{name} at {age} + {instant} ms");
            // The level is the glyph's alpha, blended over the black screen.
            let red = (f64::from(ACCENT.r) * expected.level).round() as i32;
            let actual = frame.cells[0].fg;
            assert!((i32::from(actual.r) - red).abs() <= 2, "{name} at {age} + {instant} ms: {actual:?} vs {red}");
        }
    }
}

#[test]
fn toggling_animations_resumes_the_spinner() {
    let app = test_app(12);
    let spinner = Spinner::new(&app).label("Working").animations(false);
    app.root().add(&spinner);
    assert_eq!(app.text(), "⋯ Working");
    spinner.set_animations(true);
    app.advance(Duration::from_millis(170));
    // The ticks due by now run in the next frame.
    let text = app.text();
    assert_eq!((spinner.frame(), text), (2, "⠹ Working".to_owned()));
}

#[test]
fn the_thread_switch_stops_and_resumes_every_driver() {
    let app = test_app(40);
    let row = View::new(&app).row();
    let spinner = Spinner::new(&app).label("Working");
    let shimmer = Spinner::new(&app).shimmer(Some(TEXT)).label("Check");
    row.add(&spinner);
    row.add(&shimmer);
    app.root().add(&row);
    app.advance(Duration::from_millis(80));
    app.render();
    set_running(app.app(), false);
    assert_eq!(app.render().text().trim_end(), "⋯ Working⋯ Check");
    // One tick may land before a driver sees the switch.
    app.advance(Duration::from_millis(80));
    app.render();
    app.advance(Duration::from_millis(500));
    assert!(!app.needs_frame(), "a driver ran with motion off");
    // A spinner made while off starts once motion is back.
    let late = Spinner::new(&app);
    row.add(&late);
    app.advance(Duration::from_millis(500));
    app.render();
    assert!(!app.needs_frame());
    set_running(app.app(), true);
    // The paint after the switch starts each motion again.
    app.render();
    app.advance(Duration::from_millis(80));
    assert!(app.needs_frame(), "motion did not resume");
    app.render();
    assert_eq!((spinner.frame(), late.frame()), (2, 1));
    // The resumed drivers still stop while their widgets are not drawn.
    row.visible(false);
    for _ in 0..20 {
        app.render();
        app.advance(Duration::from_millis(80));
    }
    assert!(!app.needs_frame(), "a resumed driver runs while hidden");
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

// An undrawn widget costs no frames and no wakeups. `TestApp::idle` sleeps as `App::run` does: until the next timer
// or, while a frame is wanted, the next frame slot at 60 fps. A stepped spinner's ticks follow it, so OpenTUI parks
// them, also while a scroll box clips it fully out of view, and resumes them when a frame draws it again; TS keeps
// ticking there, which differs in wakeups only.
#[test]
fn an_undrawn_animation_costs_no_frames_and_no_wakeups() {
    for widget in ["spinner", "shimmer spinner", "shimmer text"] {
        for hide in ["hidden parent", "detached", "culled", "clipped", "animations off"] {
            let app = test_app(24);
            let animated = match widget {
                "spinner" => Spinner::new(&app).label("Working").as_any(),
                "shimmer spinner" => Spinner::new(&app).shimmer(Some(TEXT)).label("Checking").as_any(),
                _ => ShimmerText::new(&app, "Checking").shimmer(TEXT).as_any(),
            };
            let holder = View::new(&app).child(&animated);
            // A scroll box culls rows out of view only among enough of them; with fewer it paints them clipped.
            let (rows, offset) = if hide == "culled" { (20, 10.0) } else { (1, 1.0) };
            let scroll = ScrollBox::new(&app).height(1);
            scroll.add(&holder);
            for row in 0..rows {
                scroll.add(&Text::new(&app, format!("row {row}")));
            }
            app.root().add(&scroll);
            let show = |shown: bool| match hide {
                "hidden parent" => drop(holder.visible(shown)),
                "detached" if shown => drop(holder.add(&animated)),
                "detached" => animated.detach(),
                "animations off" => set_running(app.app(), shown),
                _ => drop(scroll.scroll_to(0.0, if shown { 0.0 } else { offset })),
            };
            // TS: a stepped spinner ticks every 80 ms; shimmer moves on every frame.
            let rate = if widget == "spinner" { 12..=13 } else { 59..=61 };
            let case = format!("{widget}, {hide}");
            let second = || app.idle(Duration::from_secs(1));
            second();
            let shown = second();
            assert!(rate.contains(&shown.frames) && rate.contains(&shown.wakeups), "{case}: shown {shown:?}");
            show(false);
            // The frame that hides it, and at most one tick that finds it hidden.
            let hiding = second();
            assert!(hiding.frames <= 2 && hiding.wakeups <= 2, "{case}: hiding {hiding:?}");
            assert_eq!(second(), Idle::default(), "{case}: hidden");
            show(true);
            // The frame that draws it resumes or starts it again, with no other event.
            second();
            let again = second();
            assert!(rate.contains(&again.frames) && rate.contains(&again.wakeups), "{case}: shown again {again:?}");
        }
    }
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
