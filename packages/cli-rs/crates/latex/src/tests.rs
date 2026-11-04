use std::rc::Rc;

use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::Value;

use crate::layout::Options;

/// P-ORACLE: every case of `parity/fixtures/P.2/layouts.json` (`parity/oracle/P.2-latex.ts`, the TypeScript
/// `renderLatex` over the sources of `packages/latex/src/*.test.ts` and more) lays out to the same text, geometry,
/// and cell styles, or fails to parse in both.
#[test]
fn layouts_match_typescript() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../parity/fixtures/P.2/layouts.json")).unwrap();
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let source = case["source"].as_str().unwrap();
            let options = Options {
                display: case["options"]["displayMode"].as_bool().unwrap_or(true),
                compact_scripts: case["options"]["compactScripts"].as_bool().unwrap_or(true),
                color: None,
            };
            let actual = match crate::render_with(source, &options) {
                Err(_) => serde_json::json!({ "error": true }),
                Ok(layout) => serde_json::json!({
                    "text": layout.to_string(),
                    "width": layout.width,
                    "height": layout.height,
                    "baseline": layout.baseline,
                    "styled": styled(&layout),
                }),
            };
            let mut expected = case.clone();
            let object = expected.as_object_mut().unwrap();
            object.remove("source");
            object.remove("options");
            (actual != expected)
                .then(|| format!("{source:?}\n  expected {expected}\n  actual   {actual}"))
        })
        .collect();
    assert!(
        failures.is_empty(),
        "{} of {} differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}

fn styled(layout: &crate::Layout) -> Vec<String> {
    layout
        .cells
        .iter()
        .enumerate()
        .flat_map(|(y, row)| {
            row.iter().enumerate().filter_map(move |(x, cell)| {
                let style = &cell.as_ref()?.style;
                let flags: String = [(style.bold, 'b'), (style.italic, 'i'), (style.dim, 'd')]
                    .iter()
                    .filter(|f| f.0)
                    .map(|f| f.1)
                    .collect();
                if flags.is_empty() && style.color.is_none() {
                    return None;
                }
                Some(
                    format!("{x},{y} {flags} {}", style.color.as_deref().unwrap_or(""))
                        .trim_end()
                        .to_owned(),
                )
            })
        })
        .collect()
}

/// A test app in dark `opencode`, with the screen cleared as the TypeScript screen is (`crates/ui/tests/content.rs`).
fn app(width: u16, height: u16) -> (TestApp, Theme) {
    let theme = Catalog::default()
        .load("opencode", ThemeMode::Dark)
        .unwrap()
        .theme;
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

/// `TextPart`'s Markdown with the LaTeX renderer for `latex` and `math`, as the plugin host registers it.
fn markdown(app: &TestApp, theme: &Theme, streaming: bool) -> Markdown {
    let render = Rc::new(crate::renderer());
    let mut renderers = CodeBlockRenderers::default();
    for language in ["latex", "math"] {
        let (render, theme) = (render.clone(), theme.clone());
        renderers.register(language, Rc::new(move |block| render(block, &theme)));
    }
    let syntax = opencode_ui::code::syntax_theme(theme);
    opencode_ui::markdown::view(app, theme, &syntax, &renderers, true, streaming)
}

/// P-COMP: the fences of `parity/component/P.2-latex.tsx` in the transcript's Markdown, every cell.
#[test]
fn transcript_fences_match_typescript() {
    let corpus: Value =
        serde_json::from_str(include_str!("../../../parity/fixtures/P.2/corpus.json")).unwrap();
    for (name, width, height) in [
        ("structures", 60, 30),
        ("adapter", 60, 36),
        ("wide", 30, 8),
        ("invalid", 60, 20),
    ] {
        let (app, theme) = app(width, height);
        let text =
            markdown(&app, &theme, false).set_markdown(corpus[name].as_str().unwrap().trim());
        app.root().add(
            &View::new(&app)
                .padding_edge(Edge::Left, 3)
                .shrink(0.0)
                .child(&text),
        );
        opencode_parity::assert_fixture(&app.render(), &format!("P.2/{name}"));
    }
}

/// Streams `chunks` into one document, returning the frame text after each.
fn stream(chunks: &[&str], stop: bool) -> Vec<String> {
    let (app, theme) = app(40, 10);
    let view = markdown(&app, &theme, true);
    app.root().add(&view);
    let mut frames: Vec<String> = chunks
        .iter()
        .map(|chunk| {
            view.append(chunk);
            app.render().text()
        })
        .collect();
    if stop {
        view.streaming(false);
        frames.push(app.render().text());
    }
    frames
}

/// `markdown.test.ts`: "renders the next valid formula after an incomplete streaming prefix".
#[test]
fn streaming_renders_once_the_formula_parses() {
    let frames = stream(&["```latex\n\\frac{1}{", "2}", "\n```"], true);
    assert!(frames[0].contains("\\frac{1}{"), "{}", frames[0]);
    for frame in &frames[1..] {
        assert!(
            frame.contains("───") && !frame.contains("\\frac"),
            "{frame}"
        );
    }
}

/// `markdown.test.ts`: "retains the last valid Unicode formula while the next fraction is incomplete".
#[test]
fn streaming_keeps_the_last_formula_that_parsed() {
    let frames = stream(
        &[
            "```latex\n\\frac{a_1+b_1}{c_1+d_1}",
            "+\\frac{a_",
            "2+b_2}{c_2+d_2}",
        ],
        false,
    );
    assert_eq!(frames[1], frames[0]);
    assert_ne!(frames[2], frames[0]);
    assert!(!frames[2].contains("\\frac"), "{}", frames[2]);
}

/// `markdown.test.ts`: "discards an incomplete preview when the stream ends: close". The document still streams.
#[test]
fn closing_the_fence_drops_a_retained_preview() {
    let frames = stream(&["```latex\nx^2", " + \\frac{1}{", "\n```"], false);
    assert!(
        frames[1].contains("x²") && !frames[1].contains('\\'),
        "{}",
        frames[1]
    );
    assert!(frames[2].contains("x^2 + \\frac{1}{"), "{}", frames[2]);
}

/// `markdown.test.ts`: "discards an incomplete preview when the stream ends: stop", and "does not leave a stale
/// formula when a stream ends with invalid math".
#[test]
fn stopping_drops_a_retained_preview() {
    let frames = stream(&["```latex\nx^2", " + \\frac{1}{"], true);
    assert!(
        frames[1].contains("x²") && !frames[1].contains('\\'),
        "{}",
        frames[1]
    );
    assert!(frames[2].contains("x^2 + \\frac{1}{"), "{}", frames[2]);
    // The closing fence arrives with the broken math, so the source shows before the stream ends too.
    let frames = stream(&["```latex\nx^2", " + \\unsupported{x}\n```"], true);
    assert!(
        frames[1].contains("x^2 + \\unsupported{x}"),
        "{}",
        frames[1]
    );
    assert!(
        frames[2].contains("x^2 + \\unsupported{x}"),
        "{}",
        frames[2]
    );
}

/// `markdown.test.ts`: "does not reuse another fence's preview or keep a removed fence's preview".
#[test]
fn a_preview_belongs_to_its_fence() {
    let (app, theme) = app(40, 12);
    let view = markdown(&app, &theme, true);
    app.root().add(&view);
    view.set_markdown("```latex\nx^2\n```\n\n```latex\n\\frac{1}{");
    assert!(app.render().text().contains("\\frac{1}{"));
    view.set_markdown("");
    app.render();
    view.set_markdown("```latex\nx^2 + \\frac{1}{");
    assert!(app.render().text().contains("x^2 + \\frac{1}{"));
}

/// `markdown.test.ts`: "allows wide formulas to scroll horizontally without wrapping".
#[test]
fn wide_formulas_scroll_sideways() {
    let (app, theme) = app(24, 6);
    let view = markdown(&app, &theme, false).set_markdown(
        "```latex\n\\text{Start a very long formula with enough content to overflow Finish}\n```",
    );
    app.root().add(&view);
    let frame = app.render().text();
    assert!(
        frame.contains("Start") && !frame.contains("Finish"),
        "{frame}"
    );
    for _ in 0..80 {
        app.mouse(MouseEventKind::ScrollRight, 2, 0);
    }
    let frame = app.render().text();
    assert!(
        frame.contains("Finish") && !frame.contains("Start"),
        "{frame}"
    );
}
