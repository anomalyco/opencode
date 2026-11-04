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
