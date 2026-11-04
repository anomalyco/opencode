//! U.4a proofs. P-ORACLE: `code::syntax_theme` against the TypeScript `generateSyntax` for a few themes
//! (`parity/oracle/U.4a-syntax.ts`). P-COMP: the Markdown, code, and diff wrappers against the TypeScript renders of
//! the same corpus (`parity/component/U.4a-*.tsx`). Regenerate both with `bun run fixtures`.
//!
//! Rows where the current opentui-rust widgets differ from Core are listed per test with the deviation file that
//! explains them. A listed row must still differ, so a fix upstream fails here until its deviation is removed.

use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opencode_ui::{code, diff, markdown};
use opentui::native::Capture;
use opentui::prelude::*;
use opentui::style::Attributes;
use opentui::testing::TestApp;
use opentui::widget::DiffView;
use std::ops::RangeInclusive;

const CORPUS: &str = include_str!("../../../parity/fixtures/U.4a/corpus.json");
const SYNTAX: &str = include_str!("../../../parity/fixtures/U.4a/syntax.json");
const V03: &str = "V03-markdown-widget";
const H06: &str = "H06-highlight-queries";

fn corpus(name: &str) -> String {
    let corpus: serde_json::Value = serde_json::from_str(CORPUS).unwrap();
    corpus[name].as_str().unwrap().to_owned()
}

fn theme(name: &str, mode: ThemeMode) -> Theme {
    Catalog::default().load(name, mode, false).unwrap().theme
}

#[test]
fn syntax_theme_matches_generate_syntax() {
    let views: Vec<serde_json::Value> = serde_json::from_str(SYNTAX).unwrap();
    let pack = |color: Option<Color>| {
        color.map(|c| format!("{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a))
    };
    for view in views {
        let mode = if view["mode"] == "light" {
            ThemeMode::Light
        } else {
            ThemeMode::Dark
        };
        let name = view["name"].as_str().unwrap();
        let syntax = code::syntax_theme(&theme(name, mode));
        let styles = view["styles"].as_object().unwrap();
        assert_eq!(
            syntax.names().count(),
            styles.len(),
            "{name} {mode:?}: scope count"
        );
        for (scope, expected) in styles {
            let style = syntax
                .get(scope)
                .unwrap_or_else(|| panic!("{name}: no style for {scope}"));
            let flag = |attribute| style.attributes.contains(attribute);
            let actual = serde_json::json!([
                pack(style.fg),
                pack(style.bg),
                flag(Attributes::BOLD),
                flag(Attributes::ITALIC),
                flag(Attributes::UNDERLINE),
            ]);
            assert_eq!(&actual, expected, "{name} {mode:?} {scope}");
        }
    }
}

/// What a deviation lets differ in its rows.
#[derive(Clone, Copy, PartialEq)]
enum Allow {
    /// Any cell.
    Anything,
    /// Foreground and attributes of cells whose symbol and background match: highlighting only.
    Highlight,
}

/// Compares a capture with `parity/fixtures/<name>.json`. Each deviation lets its rows differ as `Allow` says, and
/// must be needed: some row in it differs.
#[track_caller]
fn assert_parity(capture: &Capture, name: &str, deviations: &[(RangeInclusive<u32>, Allow, &str)]) {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let actual = Fixture::from_capture(capture);
    let differing = compare(&expected, &actual).differences;
    let mut masked = actual.clone();
    for (rows, allow, file) in deviations {
        assert!(
            differing.iter().any(|(_, y)| rows.contains(y)),
            "{name}: rows {rows:?} match now; remove the {file} exception"
        );
        for (x, y) in differing.iter().filter(|(_, y)| rows.contains(y)) {
            let want = expected.cell(*x, *y).unwrap();
            let cell = masked.cell_mut(*x, *y).unwrap();
            if *allow == Allow::Anything || (cell.symbol == want.symbol && cell.bg == want.bg) {
                *cell = want.clone();
            }
        }
    }
    let comparison = compare(&expected, &masked);
    if !comparison.is_equal() {
        let path = std::env::temp_dir()
            .join("opencode-parity")
            .join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
        panic!(
            "P-COMP {name}, outside its deviations: {comparison}\nactual cells: {}",
            path.display()
        );
    }
}

/// A test app in dark `opencode`, with the screen cleared as the TypeScript screen is: the page background and white
/// text.
fn app(width: u16, height: u16) -> (TestApp, Theme) {
    let theme = theme("opencode", ThemeMode::Dark);
    let options = AppOptions {
        theme: opentui::theme::Theme {
            background: theme.background.base,
            foreground: Color::WHITE,
            ..opentui::theme::Theme::default()
        },
        light_theme: None,
        ..AppOptions::default()
    };
    (TestApp::with_options(width, height, options), theme)
}

/// `TextPart`: the text, trimmed, in a column indented by 3.
fn markdown_app(text: &str, conceal: bool) -> TestApp {
    let (app, theme) = app(60, 24);
    let syntax = code::syntax_theme(&theme);
    let renderers = markdown::CodeBlockRenderers::default();
    let text =
        markdown::view(&app, &theme, &syntax, &renderers, conceal, false).set_markdown(text.trim());
    app.root().add(
        &View::new(&app)
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&text),
    );
    app
}

#[test]
fn markdown_prose_matches_typescript() {
    assert_parity(
        &markdown_app(&corpus("prose"), true).render(),
        "U.4a/markdown-prose",
        &[
            // The italic color, and the colors of the link's ` (url)`, on the paragraph's two rows.
            (2..=3, Allow::Highlight, V03),
            // The `###` heading's color.
            (15..=15, Allow::Highlight, V03),
        ],
    );
}

#[test]
fn markdown_fences_match_typescript() {
    assert_parity(
        &markdown_app(&corpus("fences"), true).render(),
        "U.4a/markdown-fences",
        &[(2..=3, Allow::Highlight, H06)],
    );
}

/// U.4c: `session.markdown = "raw"`, markers shown.
#[test]
fn raw_markdown_matches_typescript() {
    assert_parity(
        &markdown_app(&corpus("prose"), false).render(),
        "U.4c/markdown-raw",
        &[
            // The italic color, and the colors of the link's brackets and URL.
            (2..=3, Allow::Highlight, V03),
            // The `###` heading's color.
            (15..=15, Allow::Highlight, V03),
        ],
    );
}

/// U.4c: grid tables with one column of cell padding.
#[test]
fn markdown_table_matches_typescript() {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/fixtures/U.4c/corpus.json")).unwrap();
    assert_parity(
        &markdown_app(corpus["table"].as_str().unwrap(), true).render(),
        "U.4c/markdown-table",
        &[],
    );
}

/// U.4c: a registered code-block renderer draws its fences, and streamed text ends as one parse of the whole text.
#[test]
fn markdown_renders_fences_and_streams() {
    let text = "Before.\n\n```mermaid\ngraph TD\n```\n\nAfter **all**.";
    let (app, theme) = app(40, 8);
    let syntax = code::syntax_theme(&theme);
    let mut renderers = markdown::CodeBlockRenderers::default();
    renderers.register(
        "mermaid",
        std::rc::Rc::new(|block: &opentui::widget::CodeBlock<'_>| {
            Some(Text::new(block.app, format!("diagram: {}", block.code.trim())).as_any())
        }),
    );
    let streamed = markdown::view(&app, &theme, &syntax, &renderers, true, true);
    app.root().add(&streamed);
    for chunk in text.as_bytes().chunks(7) {
        streamed.append(std::str::from_utf8(chunk).unwrap());
        app.render();
    }
    streamed.streaming(false);
    let frame = app.render().text();
    assert!(frame.contains("diagram: graph TD"), "{frame}");
    assert!(!frame.contains("```"), "{frame}");

    let (whole, _) = self::app(40, 8);
    whole
        .root()
        .add(&markdown::view(&whole, &theme, &syntax, &renderers, true, false).set_markdown(text));
    assert_eq!(frame, whole.render().text());
}

#[test]
fn numbered_code_matches_typescript() {
    let (app, theme) = app(60, 10);
    let syntax = code::syntax_theme(&theme);
    let view = code::view(&app, &theme, &syntax, Some("typescript"), &corpus("code"));
    app.root().add(&code::numbered(&app, &theme, &view));
    assert_parity(
        &app.render(),
        "U.4a/code",
        &[(0..=6, Allow::Highlight, H06)],
    );
}

#[test]
fn patch_matches_typescript() {
    let (app, theme) = app(60, 14);
    let syntax = code::syntax_theme(&theme);
    let patch = diff::view(
        &app,
        &theme,
        &syntax,
        &corpus("diff"),
        DiffView::Unified,
        Some("typescript"),
        WrapMode::Word,
        0,
    );
    app.root().add(
        &View::new(&app)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 3)
            .child(&patch),
    );
    assert_parity(
        &app.render(),
        "U.4a/diff",
        &[
            (0..=0, Allow::Highlight, H06),
            (6..=9, Allow::Highlight, H06),
        ],
    );
}
