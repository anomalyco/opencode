//! U.4a proofs. P-ORACLE: `code::syntax_theme` against the TypeScript `generateSyntax` for a few themes
//! (`parity/oracle/U.4a-syntax.ts`). P-COMP: the Markdown, code, and diff wrappers against the TypeScript renders of
//! the same corpus (`parity/component/U.4a-*.tsx`). Regenerate both with `bun run fixtures`.

use indexmap::IndexMap;
use opencode_parity::{Fixture, app, compare, fixtures_dir};
use opencode_ui::theme::{Catalog, TerminalColors, Theme, ThemeMode, from_hex, generate_system};
use opencode_ui::{code, diff, markdown};
use opentui::native::Capture;
use opentui::prelude::*;
use opentui::style::Attributes;
use opentui::testing::TestApp;
use opentui::widget::DiffView;

const CORPUS: &str = include_str!("../../../../parity/fixtures/U.4a/corpus.json");
const SYNTAX: &str = include_str!("../../../../parity/fixtures/U.4a/syntax.json");

fn corpus(name: &str) -> String {
    let corpus: serde_json::Value = serde_json::from_str(CORPUS).unwrap();
    corpus[name].as_str().unwrap().to_owned()
}

fn theme(name: &str, mode: ThemeMode) -> Theme {
    Catalog::default().load(name, mode).unwrap().theme
}

#[test]
fn syntax_theme_matches_generate_syntax() {
    let views: Vec<serde_json::Value> = serde_json::from_str(SYNTAX).unwrap();
    let pack = |color: Option<Color>| color.map(|c| format!("{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a));
    for view in views {
        let mode = if view["mode"] == "light" { ThemeMode::Light } else { ThemeMode::Dark };
        let name = view["name"].as_str().unwrap();
        let syntax = code::syntax_theme(&theme(name, mode));
        let styles = view["styles"].as_object().unwrap();
        assert_eq!(syntax.names().count(), styles.len(), "{name} {mode:?}: scope count");
        for (scope, expected) in styles {
            let style = syntax.get(scope).unwrap_or_else(|| panic!("{name}: no style for {scope}"));
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

/// The paste chip keeps the page color on its warning background under a transparent page too
/// (`parity/deviations/O89-paste-chip-contrast.md`): the terminal's background when the system theme read one, else the
/// neutral end that reads better on the chip. TypeScript draws the light foreground on the dark-mode system theme.
#[test]
fn paste_chip_text_is_the_page_color_on_a_transparent_page() {
    let tokyo = "#1a1b26 #f7768e #9ece6a #e0af68 #7aa2f7 #ad8ee6 #449dab #a9b1d6 #414868 #ff7a93 #b9f27c #ff9e64 #7da6ff #bb9af7 #0db9d7 #c0caf5";
    let day = "#e9e9ed #f52a65 #587539 #8c6c3e #2e7de9 #9854f1 #007197 #6172b0 #a1a6c5 #f52a65 #587539 #8c6c3e #2e7de9 #9854f1 #007197 #3760bf";
    let system = |palette: &str, background: &str, foreground: &str, mode| {
        let colors = TerminalColors {
            palette: palette.split(' ').map(|color| Some(color.to_owned())).collect(),
            default_foreground: Some(foreground.to_owned()),
            default_background: Some(background.to_owned()),
            ..TerminalColors::default()
        };
        let mut catalog = Catalog::default();
        catalog.set_system(Some(generate_system(&colors, mode)));
        catalog.load("system", mode).unwrap().theme
    };
    let mut unknown: serde_json::Value =
        serde_json::from_str(include_str!("../../../../../tui/src/theme/assets/tokyonight.json")).unwrap();
    unknown["theme"]["background"] = "none".into();
    let mut catalog = Catalog::default();
    catalog.set_custom(IndexMap::from([("unknown".to_owned(), unknown)]));
    let cases = [
        ("system dark", system(tokyo, "#1a1b26", "#a9b1d6", ThemeMode::Dark), "#1a1b26", "#e0af68"),
        ("system light", system(day, "#e1e2e7", "#3760bf", ThemeMode::Light), "#e1e2e7", "#8c6c3e"),
        ("tokyonight dark", theme("tokyonight", ThemeMode::Dark), "#1a1b26", "#ff966c"),
        ("tokyonight light", theme("tokyonight", ThemeMode::Light), "#e1e2e7", "#b15c00"),
        ("no background", catalog.load("unknown", ThemeMode::Dark).unwrap().theme, "#171828", "#ff966c"),
    ];
    for (name, theme, fg, bg) in cases {
        let style = code::syntax_theme(&theme).get("extmark.paste").unwrap();
        assert_eq!((style.fg, style.bg), (Some(from_hex(fg)), Some(from_hex(bg))), "{name}");
    }
}

/// Compares a capture with `parity/fixtures/<name>.json`, every cell.
#[track_caller]
fn assert_parity(capture: &Capture, name: &str) {
    assert_parity_within(capture, name, &[]);
}

/// As [`assert_parity`], allowing the cells `deviation` allows.
#[track_caller]
fn assert_parity_within(capture: &Capture, name: &str, deviation: &[app::Deviation]) {
    assert!(deviation.iter().all(|entry| app::deviation_exists(&entry.file)), "{name}: a deviation file is missing");
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
    let actual = Fixture::from_capture(capture);
    let comparison = compare(&expected, &actual);
    if !comparison.is_equal() && !app::allows(deviation, &comparison) {
        let path = std::env::temp_dir().join("opencode-parity").join(format!("{name}.json"));
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, actual.to_json()).unwrap();
        panic!("P-COMP {name}: {comparison}\nactual cells: {}", path.display());
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
    let text = markdown::view(&app, &theme, &syntax, &renderers, conceal, false).set_markdown(text.trim());
    app.root().add(&View::new(&app).padding_edge(Edge::Left, 3).shrink(0.0).child(&text));
    app
}

#[test]
fn markdown_prose_matches_typescript() {
    assert_parity(&markdown_app(&corpus("prose"), true).render(), "U.4a/markdown-prose");
}

#[test]
fn markdown_fences_match_typescript() {
    assert_parity(&markdown_app(&corpus("fences"), true).render(), "U.4a/markdown-fences");
}

/// U.4c: `session.markdown = "raw"`, markers shown.
#[test]
fn raw_markdown_matches_typescript() {
    assert_parity(&markdown_app(&corpus("prose"), false).render(), "U.4c/markdown-raw");
}

/// U.4c: grid tables with one column of cell padding. The `---:` column is right-aligned, where TS left-aligns it
/// (`parity/deviations/OT2112-table-alignment.md`): 14 cells.
#[test]
fn markdown_table_matches_typescript() {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../../parity/fixtures/U.4c/corpus.json")).unwrap();
    let deviation = app::Deviation { file: "OT2112-table-alignment".into(), cells: 14, style_only: false };
    let capture = markdown_app(corpus["table"].as_str().unwrap(), true).render();
    assert_parity_within(&capture, "U.4c/markdown-table", &[deviation]);
}

/// U.4c: thematic breaks, drawn as Core draws them: the `conceal` scope's color, else the text color.
#[test]
fn markdown_rules_match_typescript() {
    // Also in parity/component/U.4c-markdown.tsx.
    let rules = "Before the rules.\n\n- - -\n\nBetween them.\n\n***\n\nAfter the rules.";
    assert_parity(&markdown_app(rules, true).render(), "U.4c/markdown-rules");
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
    whole.root().add(&markdown::view(&whole, &theme, &syntax, &renderers, true, false).set_markdown(text));
    assert_eq!(frame, whole.render().text());
}

/// A restyle equals a view built in the new theme, while it streams: text that arrives later, a table included,
/// takes the new colors.
#[test]
fn markdown_restyles_as_built_in_the_new_theme() {
    let (start, end) = ("Before.\n\n```rust\nlet x = \"a\"; // b\n```\n", "\n| a | b |\n|---|---|\n| 1 | 2 |\n");
    let (app, old) = app(40, 12);
    let new = theme("tokyonight", ThemeMode::Dark);
    let renderers = markdown::CodeBlockRenderers::default();
    let view = markdown::view(&app, &old, &code::syntax_theme(&old), &renderers, true, true).set_markdown(start);
    app.root().add(&view);
    app.render();
    let syntax = code::syntax_theme(&new);
    markdown::restyle(&view, markdown::view_colors(&new, &syntax), &syntax);
    view.append(end);
    let restyled = app.render();

    let (fresh, _) = self::app(40, 12);
    fresh
        .root()
        .add(&markdown::view(&fresh, &new, &syntax, &renderers, true, true).set_markdown(format!("{start}{end}")));
    assert_eq!(restyled.cells, fresh.render().cells, "{}", restyled.text());
}

#[test]
fn numbered_code_matches_typescript() {
    let (app, theme) = app(60, 10);
    let syntax = code::syntax_theme(&theme);
    let view = code::view(&app, &theme, &syntax, Some("typescript"), &corpus("code"));
    app.root().add(&code::numbered(&app, &theme, &view));
    assert_parity(&app.render(), "U.4a/code");
}

#[test]
fn code_wraps_at_a_word_as_core_does() {
    let (app, theme) = app(20, 3);
    let syntax = code::syntax_theme(&theme);
    app.root().add(&code::view(&app, &theme, &syntax, None, "const alpha = betagamma"));
    let frame = app.render().text();
    let rows: Vec<_> = frame.lines().map(str::trim_end).collect();
    assert_eq!(rows[..2], ["const alpha =", "betagamma"], "{frame}");
}

#[test]
fn patch_matches_typescript() {
    let (app, theme) = app(60, 14);
    let syntax = code::syntax_theme(&theme);
    let patch =
        diff::view(&app, &theme, &syntax, &corpus("diff"), DiffView::Unified, Some("typescript"), WrapMode::Word, 0);
    app.root().add(&View::new(&app).padding_edge(Edge::Left, 1).padding_edge(Edge::Right, 3).child(&patch));
    assert_parity(&app.render(), "U.4a/diff");
}

/// The added JSON file of TS `diff-viewer.test.tsx` "virtualizes a large added file": 7,502 lines, one of them very
/// long.
fn large_added_patch() -> String {
    let rows = (0..7500).map(|index| {
        let repeat = if index == 777 {
            2000
        } else if index % 7 == 0 {
            24
        } else {
            1
        };
        let comma = if index == 7499 { "" } else { "," };
        format!("+  \"row-{index:04}\": \"{}\"{comma}", "value".repeat(repeat))
    });
    let lines: Vec<String> = std::iter::once("+{".to_owned()).chain(rows).chain(["+}".to_owned()]).collect();
    format!(
        "diff --git a/snapshot.json b/snapshot.json\nnew file mode 100644\n--- /dev/null\n+++ b/snapshot.json\n@@ -0,0 +1,{} @@\n{}",
        lines.len(),
        lines.join("\n")
    )
}

// Expected (r2 review, bigboi-ui-6): an added file over 3,000 lines mounts only the 128-line chunks near the view,
// as TS `VirtualAddedPatch` does: fewer than 2,000 lines at the start and at the end, and every row in place.
#[test]
fn a_large_added_file_mounts_only_the_chunks_in_view() {
    let app = TestApp::new(80, 24);
    let theme = theme("opencode", ThemeMode::Dark);
    let syntax = code::syntax_theme(&theme);
    let patch = large_added_patch();
    assert!(diff::split_added("@@ -1 +1 @@\n-a\n+b", 128).is_none());
    let chunks = diff::split_added(&patch, 128).unwrap();
    assert_eq!((chunks.len(), chunks.iter().map(|chunk| chunk.rows).sum::<usize>()), (59, 7502));
    assert!(
        chunks[1].patch.ends_with("\"value\",") && chunks[1].patch.contains("@@ -0,0 +129,128 @@\n+  \"row-0127\"")
    );
    let chunked = diff::Chunked::new(app.app(), &theme, &syntax, &patch, Some("json"), 0).unwrap();
    let scroll = ScrollBox::new(app.app()).scrollbars(false).width(80).height(24);
    scroll.add(chunked.root());
    app.root().add(&scroll);
    assert!(app.render().text().contains("row-0000"));
    assert!(chunked.mounted_lines() < 2000, "{}", chunked.mounted_lines());
    scroll.scroll_to(0.0, 7502.0 - 24.0);
    chunked.show(7502 - 24, 24);
    let screen = app.render().text();
    assert!(screen.contains("row-7499") && screen.contains('}'), "{screen}");
    assert!(chunked.mounted_lines() < 2000, "{}", chunked.mounted_lines());
    assert!(diff::Chunked::new(app.app(), &theme, &syntax, &corpus("diff"), None, 0).is_none());
}
