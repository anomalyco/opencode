use std::rc::Rc;

use opencode_plugin::node::Fences;
use opencode_ui::markdown::CodeBlockRenderers;
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;
use serde_json::Value;

use crate::layout::Options;

/// `OPENCODE_RS_LATEX_ORACLE=write` records only layouts that differ from the TypeScript renderer.
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

fn oracle_case(case: &Value) -> Value {
    let source = case["source"].as_str().unwrap();
    let options = Options {
        display: case["options"]["displayMode"].as_bool().unwrap_or(true),
        compact_scripts: case["options"]["compactScripts"].as_bool().unwrap_or(true),
        ..Options::default()
    };
    let mode = crate::Mode { permissive: case["options"]["strict"] == false, ..crate::Mode::default() };
    let mut record = match crate::render_mode(source, &options, mode) {
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

/// Match the oracle's screen background.
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

struct Dark;

impl opencode_plugin_abi::Read for Dark {
    fn theme_mode(&self) -> opencode_plugin_abi::ThemeMode {
        opencode_plugin_abi::ThemeMode::Dark
    }

    fn color(&self, _: &str) -> Option<opencode_plugin_abi::Rgba> {
        None
    }
}

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

/// The radical and matrix layouts have known differences, and TS draws two blank rows above a formula after a block
/// (`parity/deviations/F16-plugin-fence-margin.md`); `invalid` has no formula after a block and matches cell for cell.
#[test]
fn transcript_fences_match_typescript() {
    let corpus: Value = serde_json::from_str(include_str!("../../../parity/fixtures/P.2/corpus.json")).unwrap();
    for (name, width, height, differ) in
        [("structures", 60, 30, 145), ("adapter", 60, 36, ADAPTER_DIFFERS), ("wide", 30, 8, 52), ("invalid", 60, 20, 0)]
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

const ADAPTER_DIFFERS: usize = 147;

fn frame(source: &str, width: u16) -> String {
    let (app, theme) = app(width, 16);
    let text = markdown(&app, &theme, false).set_markdown(source);
    app.root().add(&text);
    app.render().text()
}

#[test]
fn markdown_math_renders() {
    for (source, shown) in [
        ("Energy is $E=mc^2$ here.", "Energy is E = mc² here."),
        ("Then \\(\\alpha \\le \\frac{1}{2}\\) holds.", "Then α ≤ 1/2 holds."),
        ("A root $\\sqrt{x+1}$, a sum $\\sum_{i=1}^n i$.", "A root √(x + 1), a sum ∑ⁿᵢ₌₁ i."),
        ("Broken $\\frac{1}{x$ here.", "Broken \\frac{1}{x here."),
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

#[test]
fn streaming_inline_math_shows_once_closed() {
    let frames = stream(&["Energy $E=mc", "^", "2", "$ now", " and $x^", "$ too"], false);
    assert!(frames[0].contains("Energy $E=mc"), "{}", frames[0]);
    assert!(frames[1].contains("$E=mc^") && frames[2].contains("$E=mc^2"), "{frames:?}");
    for frame in &frames[3..] {
        assert!(frame.contains("Energy E = mc² now"), "{frame}");
    }
    assert!(frames[4].contains("and $x^"), "{}", frames[4]);
    assert!(frames[5].contains("and x^ too"), "{}", frames[5]);
}

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

#[test]
fn ending_the_fence_or_stream_drops_the_preview() {
    for stop in [true, false] {
        let mut chunks = vec!["```latex\nx^2", " + \\frac{1}{"];
        if !stop {
            chunks.push("\n```\n");
        }
        let frames = stream(&chunks, stop);
        assert!(frames[1].contains("x²") && !frames[1].contains('\\'), "{}", frames[1]);
        assert!(frames[2].contains("x^2 + \\frac{1}{"), "{}", frames[2]);
    }
    let frames = stream(&["```latex\nx^2", " + \\unsupported{x}\n```\n"], true);
    assert!(frames[1].contains("x^2 + \\unsupported{x}"), "{}", frames[1]);
    assert!(frames[2].contains("x^2 + \\unsupported{x}"), "{}", frames[2]);
}

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

/// Named colors, bold relations and italics reach the drawn cells. A fence draws the rest in the theme's text and
/// structure colors; inline math keeps the color of the text around it.
#[test]
fn styles_reach_the_drawn_cells() {
    let cells = |source: &str| {
        let (app, theme) = app(40, 6);
        app.root().add(&markdown(&app, &theme, false).set_markdown(source));
        app.render().cells.into_iter().filter(|cell| !cell.symbol.trim().is_empty()).collect::<Vec<_>>()
    };
    let find = |cells: &[opentui::native::Cell], symbol: &str| {
        cells.iter().find(|cell| cell.symbol == symbol).cloned().unwrap()
    };
    let fence = cells("```latex\n\\mathbf{x+\\mathit{y}}+\\textcolor{red}{z} \\le w\n```");
    let (y, z, le, w) = (find(&fence, "y"), find(&fence, "z"), find(&fence, "≤"), find(&fence, "w"));
    assert!(y.attributes.contains(Attributes::BOLD | Attributes::ITALIC), "{y:?}");
    assert!(le.attributes.contains(Attributes::BOLD) && !w.attributes.contains(Attributes::BOLD), "{le:?} {w:?}");
    assert_ne!(z.fg, w.fg);
    let inline = cells("Then $a \\le \\mathit{b} + \\textcolor{#f00}{c} + \\sqrt{2}$ end");
    let (text, a, le, b, c, root) = (
        find(&inline, "T"),
        find(&inline, "a"),
        find(&inline, "≤"),
        find(&inline, "b"),
        find(&inline, "c"),
        find(&inline, "√"),
    );
    assert!(le.attributes.contains(Attributes::BOLD) && b.attributes.contains(Attributes::ITALIC), "{le:?} {b:?}");
    assert_eq!((a.fg, root.fg), (text.fg, text.fg));
    assert_ne!(c.fg, text.fg);
}

/// Inline math draws on the text's row. Each formula is a list item, one row each.
#[test]
fn inline_math_takes_one_row() {
    let cases = [
        ("x^2", "x²"),
        ("E = mc^2", "E = mc²"),
        ("a_n + b_{ij}", "aₙ + bᵢⱼ"),
        ("\\alpha + \\beta = \\gamma", "α + β = γ"),
        ("x^{ab}", "xᵃᵇ"),
        ("e^{i\\pi}", "e^(iπ)"),
        ("x_{\\alpha}", "x_α"),
        ("\\frac{a}{b}", "a/b"),
        ("\\frac{x+1}{y}", "(x + 1)/y"),
        ("\\frac{1}{1+\\frac{1}{x}}", "1/(1 + 1/x)"),
        ("\\sqrt{2}", "√2"),
        ("\\sqrt{x+1}", "√(x + 1)"),
        ("\\sqrt[3]{x}", "∛x"),
        ("\\sqrt[n]{x}", "ⁿ√x"),
        ("\\sum\\limits_{i=1}^{n} i", "∑ⁿᵢ₌₁ i"),
        ("\\int_0^1 f(x)\\,dx", "∫¹₀ f(x)dx"),
        ("\\lim_{x \\to 0}", "lim_(x → 0)"),
        ("\\hat{x}", "x\u{302}"),
        ("\\vec{v} \\cdot \\bar{u}", "v\u{20d7} · u\u{304}"),
        ("\\overline{AB}", "A\u{305}B\u{305}"),
        ("\\hat{\\frac{a}{b}}", "(a/b)^"),
        ("\\hat{\\mathbf{x}}", "x\u{302}"),
        ("\\tilde{\\mathbb{R}}", "ℝ\u{303}"),
        ("\\mathbb{R}^n", "ℝⁿ"),
        ("\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}", "(a, b; c, d)"),
        ("\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}", "x = 1; y = 2"),
        ("\\binom{n}{k}", "(n k)"),
        ("\\overset{def}{=}", "=ᵈᵉᶠ"),
        ("\\underbrace{a+b}_{n}", "a + bₙ"),
        ("\\left(\\frac{a}{b}\\right)", "(a/b)"),
        ("f'(x) \\le \\infty", "f'(x) ≤ ∞"),
    ];
    let source: Vec<String> = cases.iter().map(|(tex, _)| format!("- ${tex}$")).collect();
    let (app, theme) = app(40, cases.len() as u16);
    app.root().add(&markdown(&app, &theme, false).set_markdown(source.join("\n")));
    let frame = app.render().text();
    for (row, (tex, shown)) in frame.lines().zip(cases) {
        assert!(row.contains(shown), "{tex:?}\n{frame}");
    }
}

/// A fence that is still streaming draws the formula so far, with a placeholder for each part not yet written. What
/// can never close fails.
#[test]
fn streaming_previews_draw_what_has_arrived() {
    let preview = |source: &str| {
        let options = Options { display: false, ..Options::default() };
        crate::render_mode(source, &options, crate::Mode { permissive: false, incomplete: true }).map(|l| l.to_string())
    };
    for (source, expected) in [
        ("\\frac", " □\n───\n □"),
        ("\\operatorname*", "□"),
        ("\\overbrace{", "╭┴╮\n □"),
        ("\\mathbb", "□"),
        ("\\textcolor{red}{", "□"),
        ("\\left(x\\right\\", "(x"),
        ("x\u{305}^", " □\nx\u{305}"),
        ("\\left[\u{305}x", "[\u{305}x"),
        ("\\sqrt[\\frac{1}{2}", " 1\n───\n 2 ╭─\n  √ □"),
        ("\\sqrt[a_b]{", "a\n b╭─\n √ □"),
        ("\\sum\\limits_", "∑\n□"),
        ("x^\\displaystyle", " □\nx"),
        ("\\begin{matrix}1&&2", "1  2"),
        ("\\begin{matrix}1&&", "1  □"),
        ("\\begin{matrix}1& % comment", "1 □"),
        ("\\begin{matrix}   ", "□"),
        ("\\begin{array}{|", "│ □"),
        ("\\displaylines{a\\\\b", "a\nb"),
        ("\\cfrac[l]{1}{123", " 1\n─────\n 123"),
        ("\\cfrac[r]{1}{123", "   1\n─────\n 123"),
        ("\\cfrac[", " □\n───\n □"),
        ("\\frac{1}{", " 1\n───\n □"),
        ("\\text{abc", "abc"),
        ("\\mathbf{\\sum_1}\\limits^2", "2\n∑\n1"),
        ("\\not\u{600}{x}", "\u{600}\u{338}x"),
    ] {
        assert_eq!(preview(source).as_deref(), Ok(expected), "{source:?}");
    }
    let both = crate::Mode { permissive: true, incomplete: true };
    let kept = crate::render_mode("\\left(x\\rightfoo", &Options::default(), both).unwrap().to_string();
    assert!(kept.contains("\\rightfoo"), "{kept}");
    for source in [
        "a}b",
        "\\frac}",
        "\\not}",
        "\\left(x\\right}",
        "\\end{matrix}",
        "\\begin{matrix}1\\end{pmatrix}",
        "\\begin{unknown}x",
        "\\alpha\u{305}}",
        "\\begin{array}{p{2cm}}x",
        "\\cfrac[c]12",
        "\\cfrac[l{1}{2}",
        "\\displaylines[l]{x}",
        "\\begin{matrix}x}",
    ] {
        assert!(preview(source).is_err(), "{source:?} drew a preview");
    }
}

/// Properties over every formula of the P.2 oracle: a complete formula previews as it renders, every prefix of one
/// previews or fails without a panic, and empty scripts add no geometry.
#[test]
fn previews_and_empty_scripts_keep_the_layout() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("../../../parity/fixtures/P.2/layouts.json")).unwrap();
    let incomplete = crate::Mode { permissive: false, incomplete: true };
    for source in cases.iter().filter(|case| case["options"].is_null()).filter_map(|case| case["source"].as_str()) {
        let strict = crate::render(source);
        if strict.is_ok() {
            assert_eq!(crate::render_mode(source, &Options::default(), incomplete).ok(), strict.ok(), "{source:?}");
        }
        for (at, _) in source.char_indices() {
            let _ = crate::render_mode(&source[..at], &Options::default(), incomplete);
        }
    }
    for base in
        ["x", r"\frac{1}{2}", r"\sqrt{x}", r"\begin{pmatrix}a\\b\end{pmatrix}", r"\overbrace{abcd}", r"\sum\limits"]
    {
        for display in [false, true] {
            let options = Options { display, ..Options::default() };
            let render = |tail: &str| crate::render_with(&format!("{base}{tail}"), &options).unwrap();
            for empty in ["", r"\text{}", r"\textcolor{red}{}"] {
                for tail in [format!("^{{{empty}}}"), format!("_{{{empty}}}"), format!("^{{{empty}}}_{{{empty}}}")] {
                    assert_eq!(render(&tail), render(""), "{base}{tail}");
                }
                assert_eq!(render(&format!("^{{{empty}}}_q")), render("_q"), "{base}");
            }
        }
    }
}

/// Limits: source length, layout cells, and nesting depth, which would otherwise exhaust the stack.
#[test]
fn sources_layouts_and_nesting_are_bounded() {
    use crate::parse::{Environment, Node};
    let text = |value: &str| Node::Text(value.into());
    assert_eq!(crate::render(&"x".repeat(4096)).unwrap().width, 4096);
    assert_eq!(crate::render(&"x\u{305}".repeat(1365)).unwrap().width, 1365);
    for source in [String::new(), "x".repeat(4097), "x\u{305}".repeat(1366), "\u{1f600}".repeat(1025), "   ".into()] {
        assert!(crate::render(&source).is_err(), "{} bytes", source.len());
    }
    assert!(crate::render(&format!("{}x{}", "\\sqrt[".repeat(100), "]{x}".repeat(100))).is_err());
    // Each script is laid out once, so nested scripts stay within the cell budget.
    assert_eq!(crate::render(&format!("{}x{}", "x^{".repeat(25), "}".repeat(25))).unwrap().height, 26);
    let matrix = format!("\\begin{{matrix}}{}{}\\end{{matrix}}", "&".repeat(1500), "\\\\".repeat(1500));
    assert!(matrix.len() < 10_000 && crate::render(&matrix).is_err());
    let small = format!("\\begin{{matrix}}{}{}\\end{{matrix}}", "x&".repeat(60), "x\\\\".repeat(60));
    assert!(crate::render(&small).is_ok());
    let options = Options { display: false, ..Options::default() };
    assert_eq!(crate::layout::layout(&text(&"x".repeat(16384)), &options).map(|l| l.width), Some(16384));
    assert!(crate::layout::layout(&text(&"x".repeat(16385)), &options).is_none());
    let fraction =
        Node::Fraction { numerator: Box::new(text("1")), denominator: Box::new(text("2")), bar: true, align: None };
    let wide = Node::Matrix {
        rows: vec![vec![text(&"x".repeat(8192)), text("y")], vec![fraction, text("z")]],
        environment: Environment::Array,
        columns: Some("|l||r|".into()),
    };
    assert!(crate::layout::layout(&wide, &options).is_none());
    assert!(
        crate::layout::layout(&Node::Brace { body: Box::new(text(&"x".repeat(8193))), over: true }, &options).is_none()
    );
    // Zero-width delimiter marks may fail to render, but must not panic.
    for display in [false, true] {
        for incomplete in [false, true] {
            let mode = crate::Mode { permissive: false, incomplete };
            let source = "\\left\u{3164}\u{305}\\frac{1}{2}\\right.";
            let _ = crate::render_mode(source, &Options { display, ..Options::default() }, mode);
        }
    }
    // 256 levels of commands take about 4 MB of a debug build's stack: the main thread's 8 MB, where the TUI parses,
    // not a test thread's 2 MB.
    let deep =
        |prefix: &str, middle: &str, suffix: &str| format!("{}{middle}{}", prefix.repeat(257), suffix.repeat(257));
    let sources = [
        deep("{", "", "}"),
        deep("\\frac", "x", ""),
        deep("\\mathbb{", "x", "}"),
        deep("\\displaylines{", "x", "}"),
        deep("\\color{red}", "x", ""),
        deep("\\text{", "", "}"),
    ];
    let parsed = std::thread::Builder::new()
        .stack_size(8 << 20)
        .spawn(move || sources.iter().map(|source| crate::parse::parse(source).is_err()).collect::<Vec<_>>());
    assert_eq!(parsed.unwrap().join().unwrap(), [true; 6]);
    assert_eq!(crate::render(&format!("{}x{}", "{".repeat(255), "}".repeat(255))).unwrap().to_string(), "x");
}
