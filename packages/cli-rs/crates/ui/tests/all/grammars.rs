//! U.4b proof. P-COMP: `code::view` against the TypeScript `<code>` with the TUI's parsers, for each grammar of the
//! default build (`parity/component/U.4b-grammars.tsx`, corpus `parity/fixtures/U.4b/corpus.json`). Every cell
//! matches: text, colors, and attributes. Regenerate with `bun run fixtures`.

use opencode_parity::{Fixture, compare, fixtures_dir};
use opencode_ui::code;
use opencode_ui::theme::{Catalog, ThemeMode};
use opentui::prelude::*;
use opentui::testing::TestApp;

const CORPUS: &str = include_str!("../../../../parity/fixtures/U.4b/corpus.json");

#[test]
fn default_grammars_match_typescript() {
    let corpus: serde_json::Map<String, serde_json::Value> = serde_json::from_str(CORPUS).unwrap();
    let theme = Catalog::default()
        .load("opencode", ThemeMode::Dark)
        .unwrap()
        .theme;
    let syntax = code::syntax_theme(&theme);
    let mut failed = Vec::new();
    for (filetype, source) in &corpus {
        let options = AppOptions {
            theme: opentui::theme::Theme {
                background: theme.background.base,
                foreground: Color::WHITE,
                ..opentui::theme::Theme::default()
            },
            light_theme: None,
            ..AppOptions::default()
        };
        let app = TestApp::with_options(60, 12, options);
        let view = code::view(
            &app,
            &theme,
            &syntax,
            Some(filetype),
            source.as_str().unwrap(),
        );
        app.root().add(&view);
        let name = format!("U.4b/{filetype}");
        let expected = Fixture::load(fixtures_dir().join(format!("{name}.json"))).unwrap();
        let actual = Fixture::from_capture(&app.render());
        let comparison = compare(&expected, &actual);
        if !comparison.is_equal() {
            let path = std::env::temp_dir()
                .join("opencode-parity")
                .join(format!("{name}.json"));
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, actual.to_json()).unwrap();
            failed.push(format!("{name}: {comparison} ({})", path.display()));
        }
    }
    assert!(failed.is_empty(), "P-COMP:\n{}", failed.join("\n"));
}
