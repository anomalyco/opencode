//! P-COMP for P.3: `TextPart`'s Markdown with the Mermaid plugin's renderer, compared cell by cell with
//! parity/fixtures/P.3/markdown.json (written by parity/component/P.3-markdown.tsx through the TS plugin).

use std::rc::Rc;

use opencode_mermaid::{Palette, Rendered, fenced, render};
use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_plugin::node::{Fences, Reader, Scroll, lines_widget};
use opencode_plugin_abi::Fenced;
use opencode_ui::theme::{Catalog, Theme, ThemeMode};
use opencode_ui::{code, markdown};
use opentui::prelude::*;
use opentui::testing::TestApp;
use opentui::widget::CodeBlock;

/// The plugin's `mermaid` render from a fresh setup, through the host's fence adapter in dark `theme`, as the
/// plugin host registers it.
fn renderer(theme: &Theme) -> impl Fn(&CodeBlock<'_>) -> Option<AnyWidget> + use<> {
    let mut setup = opencode_plugin_abi::Setup::in_process(opencode_mermaid::ID, None);
    (opencode_mermaid::plugin().setup)(&mut setup).unwrap();
    let (language, render) = setup.fences()[0].clone();
    assert_eq!(language, "mermaid");
    let (theme, fences) = (theme.clone(), Fences::default());
    move |block| fences.render(block, &theme, |fence| render(&Reader::new(&theme, ThemeMode::Dark), &fence))
}

/// `createMermaidCodeBlockRenderer`'s fallbacks while a fence streams: the previous diagram of the same kind,
/// else the lines before an unsupported last statement, else the code.
#[test]
fn streaming_fence_keeps_its_last_diagram() {
    let app = TestApp::new(80, 20);
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let shown = renderer(&theme);
    let block = |code: &'static str, previous| opentui::widget::CodeBlock {
        app: &app,
        language: "mermaid",
        info: "mermaid",
        code,
        closed: false,
        conceal: true,
        streaming: true,
        previous,
    };
    let good = shown(&block("flowchart LR\n  A --> B", None)).expect("a diagram");
    // An unsupported statement followed by more lines: the previous diagram stays, else the code shows.
    let broken = "flowchart LR\n  A --> B\n  C((circle))\n  B --> C";
    assert_eq!(shown(&block(broken, Some(&good))), Some(good.clone()));
    assert_eq!(renderer(&theme)(&block(broken, None)), None);
    // An unsupported last statement with nothing after it: the lines before it render.
    let tail = "flowchart LR\n  A --> B\n  C((cir";
    assert!(renderer(&theme)(&block(tail, None)).is_some());
    // Another kind does not reuse a flowchart.
    let sequence = "sequenceDiagram\n  A->>B: hi\n  bogus line\n  B->>A: ok";
    assert_eq!(shown(&block(sequence, Some(&good))), None);
}

/// A diagram wider than the view scrolls sideways under a left drag, as TS `StaticDiagramRenderable` does.
#[test]
fn dragging_scrolls_a_wide_diagram() {
    let app = TestApp::new(30, 6);
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let source = "flowchart LR\n  A[Alpha] --> B[Bravo] --> C[Charlie]";
    // Laid out for a wide terminal, so it stays horizontal in the narrow view.
    let palette = Palette::read(&Reader::new(&theme, ThemeMode::Dark));
    let Rendered::Diagram(diagram) = render(source, 120, &palette) else {
        panic!("a diagram");
    };
    let Fenced::Lines { lines, fg, .. } = fenced(&diagram) else {
        panic!("rows");
    };
    app.root().add(&lines_widget(&app, &theme, &lines, fg.as_ref(), Scroll::Drag));
    let before = app.render().text();
    assert!(before.contains("Alpha"), "{before}");
    app.drag((20, 1), (5, 1));
    let after = app.render().text();
    assert!(!after.contains("Alpha") && after.contains("Charlie"), "{after}");
}

#[test]
fn markdown_diagrams_match_typescript() {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../parity/fixtures/P.3/message.json")).unwrap();
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let app = TestApp::with_options(
        80,
        30,
        AppOptions {
            theme: opentui::theme::Theme {
                background: theme.background.base,
                foreground: Color::WHITE,
                ..opentui::theme::Theme::default()
            },
            light_theme: None,
            ..AppOptions::default()
        },
    );
    let syntax = code::syntax_theme(&theme);
    let mut renderers = markdown::CodeBlockRenderers::default();
    renderers.register("mermaid", Rc::new(renderer(&theme)));
    let text = markdown::view(&app, &theme, &syntax, &renderers, true, false)
        .set_markdown(corpus["message"].as_str().unwrap().trim());
    app.root().add(&View::new(&app).padding_edge(Edge::Left, 3).shrink(0.0).child(&text));

    let expected = Fixture::load(fixtures_dir().join("P.3/markdown.json")).unwrap();
    let actual = Fixture::from_capture(&app.render());
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() {
        let path = std::env::temp_dir().join("opencode-parity/P.3/markdown.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
        panic!("P-COMP P.3/markdown: {comparison}\nactual cells: {}", path.display());
    }
}
