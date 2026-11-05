//! H.1 proofs: the fixtures the TypeScript scripts write parse and reformat byte for byte, an injected one-cell
//! change is reported, and an opentui-rust widget matches the TypeScript render of the same OpenTUI elements.

use opencode_parity::{Fixture, assert_fixture, compare, fixtures_dir};
use opentui::prelude::*;
use opentui::testing::TestApp;

fn load(name: &str) -> (Fixture, String) {
    let path = fixtures_dir().join(format!("{name}.json"));
    (Fixture::load(&path).unwrap(), std::fs::read_to_string(&path).unwrap())
}

#[test]
fn typescript_fixtures_reformat_byte_for_byte() {
    for name in ["H.1/box", "H.1/alert"] {
        let (fixture, text) = load(name);
        assert_eq!(fixture.to_json(), text, "{name}");
        assert!(compare(&fixture, &Fixture::parse(&text).unwrap()).is_equal());
    }
}

#[test]
fn an_injected_one_cell_change_is_reported() {
    let (expected, _) = load("H.1/alert");
    let mut actual = expected.clone();
    let cell = actual.cell_mut(8, 6).unwrap();
    assert_eq!(cell.symbol, "s");
    cell.symbol = "S".to_owned();
    cell.fg = Color::RED;
    let comparison = compare(&expected, &actual);
    assert_eq!(comparison.differences, [(8, 6)]);
    let report = [
        "1 of 720 cells differ (60x12)".to_owned(),
        "row 6".to_owned(),
        format!("  expected |{:<60}|", "    The session was compacted."),
        format!("  actual   |{:<60}|", "    The Session was compacted."),
        format!("{}^", " ".repeat(20)),
        "(8,6) symbol \"s\" -> \"S\", fg #808080ff -> #800000ff@1".to_owned(),
        String::new(),
    ];
    assert_eq!(comparison.to_string(), report.join("\n"));
}

#[test]
fn the_summary_counts_cells_that_differ_in_color_only() {
    let (expected, _) = load("H.1/alert");
    let mut actual = expected.clone();
    actual.cell_mut(8, 6).unwrap().fg = Color::RED;
    actual.cell_mut(0, 0).unwrap().bg = Color::RED;
    actual.cell_mut(9, 6).unwrap().symbol = "E".to_owned();
    let report = compare(&expected, &actual).to_string();
    assert_eq!(report.lines().next(), Some("3 of 720 cells differ (60x12), 2 in color only"));
}

#[test]
fn a_size_change_is_reported() {
    let (expected, _) = load("H.1/box");
    let actual = Fixture { width: 1, height: 1, cells: expected.cells[..1].to_vec() };
    assert_eq!(compare(&expected, &actual).to_string(), "size 24x5 expected, 1x1 actual");
}

// The same tree as parity/component/H.1-box.tsx. The TypeScript screen is transparent outside the box, while an
// opentui-rust app clears the screen with its theme background, so that background is transparent here.
fn box_app(word: &str) -> TestApp {
    let theme = Theme { background: Color::TRANSPARENT, ..Theme::default() };
    let app = TestApp::with_options(24, 5, AppOptions { theme, light_theme: None, ..AppOptions::default() });
    let panel = View::new(&app)
        .size(20, 4)
        .border(BorderStyle::Rounded)
        .border_color(Color::hex(0x5c9cf5))
        .bg(Color::hex(0x1e1e2e))
        .title(" Hi ")
        .padding_edge(Edge::Left, 1);
    let fg = Color::hex(0xeeeeee);
    panel.add(&Text::new(&app, vec![word.to_owned().fg(fg).bold(), " 界".fg(fg)]));
    app.root().add(&panel);
    app
}

#[test]
fn an_opentui_rust_box_matches_the_typescript_box() {
    assert_fixture(&box_app("Hello").render(), "H.1/box");
}

#[test]
#[should_panic(expected = "P-COMP H.1/box: 1 of 120 cells differ")]
fn assert_fixture_panics_with_the_report() {
    assert_fixture(&box_app("Hellp").render(), "H.1/box");
}
