use std::rc::Rc;

use opencode_plugin::node::Fences;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::Value;

use crate::layout::Options;

/// P-ORACLE: every case of `parity/fixtures/P.2/layouts.json` (`parity/oracle/P.2-latex.ts`, the TypeScript
/// `renderLatex` over the sources of `packages/latex/src/*.test.ts` and more) lays out to the same text, geometry,
/// and cell styles, or fails to parse in both, except where opentui-tex draws otherwise: then Rust lays out as
/// `oracle_rust.json` expects, which must differ from TS (`parity/deviations/P2-latex-opentui-tex.md`).
/// `OPENCODE_RS_LATEX_ORACLE=write` rewrites `oracle_rust.json` with every case that differs from TS.
#[test]
fn layouts_match_typescript() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("../../../parity/fixtures/P.2/layouts.json")).unwrap();
    let rust: Vec<Value> = serde_json::from_str(include_str!("oracle_rust.json")).unwrap();
    let key = |case: &Value| (case["source"].clone(), case["options"].clone());
    if std::env::var("OPENCODE_RS_LATEX_ORACLE").is_ok_and(|value| value == "write") {
        let differ: Vec<String> = cases
            .iter()
            .filter_map(|case| {
                let actual = oracle_case(case);
                (actual != *case).then(|| serde_json::to_string(&actual).unwrap())
            })
            .collect();
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/src/oracle_rust.json");
        std::fs::write(path, format!("[\n {}\n]\n", differ.join(",\n "))).unwrap();
        return;
    }
    for expected in &rust {
        let ts = cases.iter().find(|case| key(case) == key(expected)).expect("a Rust expectation names a TS case");
        assert_ne!(ts, expected, "the Rust expectation equals TS: drop it from oracle_rust.json");
    }
    let failures: Vec<String> = cases
        .iter()
        .filter_map(|case| {
            let expected = rust.iter().find(|expected| key(expected) == key(case)).unwrap_or(case);
            let actual = oracle_case(case);
            (actual != *expected).then(|| format!("{:?}\n  expected {expected}\n  actual   {actual}", case["source"]))
        })
        .collect();
    assert!(failures.is_empty(), "{} of {} differ:\n{}", failures.len(), cases.len(), failures.join("\n"));
}

/// `case` as Rust lays it out, in the oracle's record.
fn oracle_case(case: &Value) -> Value {
    let source = case["source"].as_str().unwrap();
    let options = Options {
        display: case["options"]["displayMode"].as_bool().unwrap_or(true),
        compact_scripts: case["options"]["compactScripts"].as_bool().unwrap_or(true),
        ..Options::default()
    };
    let mut record = match crate::render_with(source, &options) {
        Err(_) => serde_json::json!({ "error": true }),
        Ok(layout) => serde_json::json!({
            "text": layout.to_string(),
            "width": layout.width,
            "height": layout.height,
            "baseline": layout.baseline,
            "styled": styled(&layout),
        }),
    };
    let object = record.as_object_mut().unwrap();
    object.insert("source".into(), case["source"].clone());
    if !case["options"].is_null() {
        object.insert("options".into(), case["options"].clone());
    }
    record
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
                Some(format!("{x},{y} {flags} {}", style.color.as_deref().unwrap_or("")).trim_end().to_owned())
            })
        })
        .collect()
}

/// A test app in dark `opencode`, with the screen cleared as the TypeScript screen is (`crates/ui/tests/all/content.rs`).
fn app(width: u16, height: u16) -> (TestApp, Theme) {
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
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

/// The host as the plugin reads it: dark.
struct Dark;

impl opencode_plugin_abi::Read for Dark {
    fn theme_mode(&self) -> opencode_plugin_abi::ThemeMode {
        opencode_plugin_abi::ThemeMode::Dark
    }

    fn color(&self, _: &str) -> Option<opencode_plugin_abi::Rgba> {
        None
    }
}

/// `TextPart`'s Markdown with the plugin's renderers for `latex` and `math` fences, through the host's fence adapter,
/// and for inline math, as the plugin host registers them.
fn markdown(app: &TestApp, theme: &Theme, streaming: bool) -> Markdown {
    let mut setup = opencode_plugin_abi::Registered::new("opencode.latex", None);
    (crate::plugin().setup)(&mut setup.setup()).unwrap();
    let mut renderers = CodeBlockRenderers::default();
    for (language, render) in setup.fences() {
        let (render, theme, fences) = (render.clone(), theme.clone(), Fences::default());
        renderers.register(
            language.clone(),
            Rc::new(move |block| fences.render(block, &theme, |fence| render(&Dark, &fence))),
        );
    }
    for render in setup.inline_math() {
        let (render, theme) = (render.clone(), theme.clone());
        renderers.register_math(Rc::new(move |tex| {
            Some(render(&Dark, tex)?.iter().map(|span| opencode_plugin::node::styled(&theme, span, None)).collect())
        }));
    }
    let syntax = opencode_ui::code::syntax_theme(theme);
    opencode_ui::markdown::view(app, theme, &syntax, &renderers, true, streaming)
}

/// P-COMP: the fences of `parity/component/P.2-latex.tsx` in the transcript's Markdown, every cell, but the cells
/// opentui-tex's radical and matrix rows change (`parity/deviations/P2-latex-opentui-tex.md`): exactly that many.
#[test]
fn transcript_fences_match_typescript() {
    let corpus: Value = serde_json::from_str(include_str!("../../../parity/fixtures/P.2/corpus.json")).unwrap();
    for (name, width, height, differ) in
        [("structures", 60, 30, 125), ("adapter", 60, 36, ADAPTER_DIFFERS), ("wide", 30, 8, 0), ("invalid", 60, 20, 0)]
    {
        let (app, theme) = app(width, height);
        let text = markdown(&app, &theme, false).set_markdown(corpus[name].as_str().unwrap().trim());
        app.root().add(&View::new(&app).padding_edge(Edge::Left, 3).shrink(0.0).child(&text));
        let capture = app.render();
        if differ == 0 {
            opencode_parity::assert_fixture(&capture, &format!("P.2/{name}"));
            continue;
        }
        let path = opencode_parity::fixtures_dir().join(format!("P.2/{name}.json"));
        let expected = opencode_parity::Fixture::load(path).unwrap();
        let comparison = opencode_parity::compare(&expected, &opencode_parity::Fixture::from_capture(&capture));
        assert_eq!(comparison.differences.len(), differ, "P-COMP P.2/{name}: {comparison}");
    }
}

const ADAPTER_DIFFERS: usize = 197;

/// The frame of `source` in the transcript's Markdown, `width` columns wide.
fn frame(source: &str, width: u16) -> String {
    let (app, theme) = app(width, 16);
    let text = markdown(&app, &theme, false).set_markdown(source);
    app.root().add(&text);
    app.render().text()
}

/// Beyond TS (`parity/deviations/P2-latex-inline.md`): with the plugin, Markdown parses math (OpenTUI #2072).
/// `$…$` and `\(…\)` draw on one row in the text; `$$…$$` and `\[…\]` reach the `math` fence renderer.
#[test]
fn markdown_math_renders() {
    for (source, shown) in [
        ("Energy is $E=mc^2$ here.", "Energy is E = mc² here."),
        ("Then \\(\\alpha \\le \\frac{1}{2}\\) holds.", "Then α ≤ 1/2 holds."),
        ("A root $\\sqrt{x+1}$, a sum $\\sum_{i=1}^n i$.", "A root √(x + 1), a sum ∑ⁿᵢ₌₁ i."),
        // TeX that does not parse shows as typed, without its delimiters.
        ("Broken $\\frac{1}{x$ here.", "Broken \\frac{1}{x here."),
        // opentui-tex's `document.test.ts`, where OpenTUI's parser takes `parseInline`'s place.
        ("cost \\$5 and $x^2$ now", "cost $5 and x² now"),
        ("Text $x \\$ y$ after", "Text x$y after"),
        ("an $open formula", "an $open formula"),
        ("# Notes\n\nEnergy is $E=mc^2$.\n\n$$x^2$$", "Energy is E = mc²."),
    ] {
        let frame = frame(source, 60);
        assert!(frame.contains(shown), "{source:?}\n{frame}");
    }
    for source in ["$$\n\\frac{1}{2}\n$$", "\\[\n\\frac{1}{2}\n\\]", "Before\n\n$$\\frac{1}{2}$$\n\nafter"] {
        let frame = frame(source, 60);
        assert!(frame.contains("───") && frame.contains(" 1") && !frame.contains("frac"), "{source:?}\n{frame}");
    }
}

/// Dollars that are not math stay text, as OpenTUI decides: currency, shell variables, a lone `$`.
#[test]
fn dollars_that_are_not_math_stay_text() {
    for (source, shown) in [
        ("It costs $5 and $10 today.", "It costs $5 and $10 today."),
        ("Run `echo $HOME` or echo $PATH now.", "Run echo $HOME or echo $PATH now."),
        ("Set $HOME and $PATH first.", "Set $HOME and $PATH first."),
        ("A lone $ sign.", "A lone $ sign."),
        ("Escaped \\$x\\$ stays.", "Escaped $x$ stays."),
        ("Spaced $ x $ stays.", "Spaced $ x $ stays."),
    ] {
        let frame = frame(source, 60);
        assert!(frame.contains(shown), "{source:?}\n{frame}");
    }
}

/// Streaming: a `$` shows as text until OpenTUI decides it is math, then the math shows and stays (its property:
/// shown math never reverts), so a half-typed `$x^` never draws as broken math.
#[test]
fn streaming_inline_math_shows_once_closed() {
    let frames = stream_text(&["Energy $E=mc", "^", "2", "$ now", " and $x^", "$ too"]);
    assert!(frames[0].contains("Energy $E=mc"), "{}", frames[0]);
    assert!(frames[1].contains("$E=mc^") && frames[2].contains("$E=mc^2"), "{frames:?}");
    for frame in &frames[3..] {
        assert!(frame.contains("Energy E = mc² now"), "{frame}");
    }
    assert!(frames[4].contains("and $x^"), "{}", frames[4]);
    // `x^` closed does not parse: its TeX shows as typed.
    assert!(frames[5].contains("and x^ too"), "{}", frames[5]);
}

/// Streams `chunks` of prose into one document, returning the frame text after each.
fn stream_text(chunks: &[&str]) -> Vec<String> {
    let (app, theme) = app(60, 6);
    let view = markdown(&app, &theme, true);
    app.root().add(&view);
    chunks
        .iter()
        .map(|chunk| {
            view.append(chunk);
            app.render().text()
        })
        .collect()
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

/// opentui-tex's streaming preview (`parseMathIncomplete`): an open fence draws as far as it goes, `□` for what has
/// not come, where TS shows the source until the formula parses (`markdown.test.ts`: "renders the next valid
/// formula after an incomplete streaming prefix").
#[test]
fn streaming_draws_an_incomplete_formula() {
    let frames = stream(&["```latex\n\\frac{1}{", "2}", "\n```"], true);
    assert!(frames[0].contains("□") && frames[0].contains("───") && !frames[0].contains("\\frac"), "{}", frames[0]);
    for frame in &frames[1..] {
        assert!(frame.contains("───") && !frame.contains("\\frac") && !frame.contains("□"), "{frame}");
    }
    let frames = stream(&["```latex\n\\frac{a_1+b_1}{c_1+d_1}", "+\\frac{a_", "2+b_2}{c_2+d_2}"], false);
    assert!(frames[1].contains("□") && frames[1].contains("a₁ + b₁"), "{}", frames[1]);
    assert!(!frames[2].contains("□") && !frames[2].contains("\\frac"), "{}", frames[2]);
}

/// `markdown.test.ts`: "retains the last valid Unicode formula while the next fraction is incomplete", where even
/// the incomplete preview fails: a command name half typed. Shown math never goes back to the source.
#[test]
fn streaming_keeps_the_last_formula_that_parsed() {
    let frames = stream(&["```latex\n\\frac{a_1+b_1}{c_1+d_1}", "+\\fr", "ac{a_2}{c_2}"], false);
    assert_eq!(frames[1], frames[0]);
    assert_ne!(frames[2], frames[0]);
    assert!(!frames[2].contains("\\fr"), "{}", frames[2]);
}

/// `markdown.test.ts`: "discards an incomplete preview when the stream ends: close". The document still streams.
#[test]
fn closing_the_fence_drops_a_retained_preview() {
    let frames = stream(&["```latex\nx^2", " + \\frac{1}{", "\n```\n"], false);
    assert!(frames[1].contains("x²") && !frames[1].contains('\\'), "{}", frames[1]);
    assert!(frames[2].contains("x^2 + \\frac{1}{"), "{}", frames[2]);
}

/// `markdown.test.ts`: "discards an incomplete preview when the stream ends: stop", and "does not leave a stale
/// formula when a stream ends with invalid math".
#[test]
fn stopping_drops_a_retained_preview() {
    let frames = stream(&["```latex\nx^2", " + \\frac{1}{"], true);
    assert!(frames[1].contains("x²") && !frames[1].contains('\\'), "{}", frames[1]);
    assert!(frames[2].contains("x^2 + \\frac{1}{"), "{}", frames[2]);
    // The closing fence arrives with the broken math, so the source shows before the stream ends too.
    let frames = stream(&["```latex\nx^2", " + \\unsupported{x}\n```\n"], true);
    assert!(frames[1].contains("x^2 + \\unsupported{x}"), "{}", frames[1]);
    assert!(frames[2].contains("x^2 + \\unsupported{x}"), "{}", frames[2]);
}

/// `markdown.test.ts`: "does not reuse another fence's preview or keep a removed fence's preview".
#[test]
fn a_preview_belongs_to_its_fence() {
    let (app, theme) = app(40, 12);
    let view = markdown(&app, &theme, true);
    app.root().add(&view);
    // `\fr` is no command yet, so even the incomplete preview fails.
    view.set_markdown("```latex\nx^2\n```\n\n```latex\n\\fr");
    assert!(app.render().text().contains("\\fr"));
    view.set_markdown("");
    app.render();
    view.set_markdown("```latex\nx^2 + \\fr");
    assert!(app.render().text().contains("x^2 + \\fr"));
}

/// `markdown.test.ts`: "allows wide formulas to scroll horizontally without wrapping".
#[test]
fn wide_formulas_scroll_sideways() {
    let (app, theme) = app(24, 6);
    let view = markdown(&app, &theme, false)
        .set_markdown("```latex\n\\text{Start a very long formula with enough content to overflow Finish}\n```");
    app.root().add(&view);
    let frame = app.render().text();
    assert!(frame.contains("Start") && !frame.contains("Finish"), "{frame}");
    for _ in 0..80 {
        app.mouse(MouseEventKind::ScrollRight, 2, 0);
    }
    let frame = app.render().text();
    assert!(frame.contains("Finish") && !frame.contains("Start"), "{frame}");
}

// Expected (bigboi notes): the formula a streaming fence keeps goes once the host frees its block, so N streaming
// fences drawn and removed leave nothing.
#[test]
fn removed_streaming_fences_leave_nothing_kept() {
    let (app, theme) = app(40, 10);
    let shown: crate::Shown = Rc::default();
    let mut registered = opencode_plugin_abi::Registered::new("opencode.latex", None);
    crate::register(&mut registered.setup(), shown.clone());
    let registered = Rc::new(registered);
    let gone: opencode_plugin::node::Gone = {
        let registered = registered.clone();
        Rc::new(move |key| registered.fence_gone().iter().for_each(|run| run(key)))
    };
    let mut renderers = CodeBlockRenderers::default();
    for (language, render) in registered.fences() {
        let (render, theme, fences) = (render.clone(), theme.clone(), Fences::new(Some(gone.clone())));
        renderers.register(
            language.clone(),
            Rc::new(move |block| fences.render(block, &theme, |fence| render(&Dark, &fence))),
        );
    }
    let syntax = opencode_ui::code::syntax_theme(&theme);
    for _ in 0..5 {
        let view = opencode_ui::markdown::view(&app, &theme, &syntax, &renderers, true, true);
        app.root().add(&view);
        view.append("```latex\nx^2");
        app.render();
        assert_eq!(shown.borrow().len(), 1);
        app.root().clear();
        drop(view);
        app.render();
    }
    assert!(shown.borrow().is_empty(), "{:?}", shown.borrow());
}

// Expected (r2 review, bigboi-ui-2 and carbon-ui-1): a short ragged matrix whose rectangle takes more cells than
// the layout allows fails like oversized input (TS `layoutLatex` returns nothing on `RangeError`), so the fence shows
// its source instead of allocating the grid on the UI thread.
#[test]
fn an_oversized_matrix_falls_back_to_the_source() {
    let source = format!("\\begin{{matrix}}{}{}\\end{{matrix}}", "&".repeat(1500), "\\\\".repeat(1500));
    assert!(source.len() < 10_000);
    assert!(crate::render(&source).is_err());
    // opentui-tex's block limit: 16 384 cells.
    let small = format!("\\begin{{matrix}}{}{}\\end{{matrix}}", "x&".repeat(60), "x\\\\".repeat(60));
    assert!(crate::render(&small).is_ok());
}
