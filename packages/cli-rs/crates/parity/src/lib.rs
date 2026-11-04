//! Cell fixtures, per-cell comparison, and reports (H.1).
//!
//! P-COMP: a TypeScript script under `parity/component/` renders a TUI component and writes
//! `parity/fixtures/<name>.json` (see `parity/lib/component.tsx`). A Rust test renders the matching widget in a
//! `TestApp` at the same size and calls [`assert_fixture`], which panics with a readable list of the cells that
//! differ.
//!
//! ```ignore
//! let app = TestApp::new(60, 12);
//! // build the widget...
//! opencode_parity::assert_fixture(&app.render(), "U.3/alert");
//! ```

mod fixture;

pub use fixture::Fixture;

use opentui::native::{Capture, Cell};
use opentui::style::Attributes;
use std::fmt;
use std::path::PathBuf;

/// The cells listed in a report before it summarizes the rest.
const REPORT_CELLS: usize = 40;

/// `parity/fixtures` in this package.
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../parity/fixtures"
    ))
}

/// Compares a capture with `parity/fixtures/<name>.json` cell by cell. On a difference it writes the capture to
/// `<temp>/opencode-parity/<name>.json` in the fixture format, so the two files can be diffed, and panics with the
/// report.
#[track_caller]
pub fn assert_fixture(capture: &Capture, name: &str) {
    let expected = Fixture::load(fixtures_dir().join(format!("{name}.json")))
        .unwrap_or_else(|error| panic!("{error}"));
    let actual = Fixture::from_capture(capture);
    let comparison = compare(&expected, &actual);
    if comparison.is_equal() {
        return;
    }
    let path = std::env::temp_dir()
        .join("opencode-parity")
        .join(format!("{name}.json"));
    let written = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| std::fs::write(&path, actual.to_json()))
        .map_or_else(
            |error| format!("could not write the actual cells: {error}"),
            |()| format!("actual cells: {}", path.display()),
        );
    panic!("P-COMP {name}: {comparison}\n{written}");
}

/// Compares two grids cell by cell.
pub fn compare(expected: &Fixture, actual: &Fixture) -> Comparison {
    if (expected.width, expected.height) != (actual.width, actual.height) {
        return Comparison {
            expected: expected.clone(),
            actual: actual.clone(),
            differences: Vec::new(),
            size_differs: true,
        };
    }
    let differences = expected
        .cells
        .iter()
        .zip(&actual.cells)
        .enumerate()
        .filter(|(_, (expected, actual))| expected != actual)
        .map(|(index, _)| (index as u32 % expected.width, index as u32 / expected.width))
        .collect();
    Comparison {
        expected: expected.clone(),
        actual: actual.clone(),
        differences,
        size_differs: false,
    }
}

/// The result of [`compare`]. Its `Display` is the report: each differing row from both sides with a marker under
/// the differing columns, then each differing cell with the fields that differ.
#[derive(Clone, Debug)]
pub struct Comparison {
    expected: Fixture,
    actual: Fixture,
    size_differs: bool,
    /// The `(x, y)` of each differing cell, in row-major order.
    pub differences: Vec<(u32, u32)>,
}

impl Comparison {
    pub fn is_equal(&self) -> bool {
        !self.size_differs && self.differences.is_empty()
    }
}

impl fmt::Display for Comparison {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (expected, actual) = (&self.expected, &self.actual);
        if self.size_differs {
            return write!(
                out,
                "size {}x{} expected, {}x{} actual",
                expected.width, expected.height, actual.width, actual.height
            );
        }
        if self.differences.is_empty() {
            return write!(out, "all {} cells equal", expected.cells.len());
        }
        writeln!(
            out,
            "{} of {} cells differ ({}x{})",
            self.differences.len(),
            expected.cells.len(),
            expected.width,
            expected.height
        )?;
        let mut rows: Vec<u32> = self.differences.iter().map(|&(_, y)| y).collect();
        rows.dedup();
        for &y in &rows {
            let marker: String = (0..expected.width)
                .map(|x| {
                    if self.differences.contains(&(x, y)) {
                        '^'
                    } else {
                        ' '
                    }
                })
                .collect();
            writeln!(out, "row {y}")?;
            writeln!(out, "  expected |{}|", text(expected.row(y)))?;
            writeln!(out, "  actual   |{}|", text(actual.row(y)))?;
            writeln!(out, "            {}", marker.trim_end())?;
        }
        for &(x, y) in self.differences.iter().take(REPORT_CELLS) {
            let (want, got) = (
                expected.cell(x, y).expect("in range"),
                actual.cell(x, y).expect("in range"),
            );
            writeln!(out, "({x},{y}) {}", fields(want, got).join(", "))?;
        }
        if self.differences.len() > REPORT_CELLS {
            writeln!(
                out,
                "... and {} more cells",
                self.differences.len() - REPORT_CELLS
            )?;
        }
        Ok(())
    }
}

// A row as it shows in a terminal; control characters become '?', so the markers stay aligned.
fn text(row: &[Cell]) -> String {
    row.iter()
        .map(|cell| {
            if cell.symbol.chars().any(char::is_control) {
                "?"
            } else {
                cell.symbol.as_str()
            }
        })
        .collect()
}

fn fields(want: &Cell, got: &Cell) -> Vec<String> {
    let mut fields = Vec::new();
    if want.symbol != got.symbol {
        fields.push(format!("symbol {:?} -> {:?}", want.symbol, got.symbol));
    }
    if want.fg != got.fg {
        fields.push(format!(
            "fg {} -> {}",
            fixture::format_color(want.fg),
            fixture::format_color(got.fg)
        ));
    }
    if want.bg != got.bg {
        fields.push(format!(
            "bg {} -> {}",
            fixture::format_color(want.bg),
            fixture::format_color(got.bg)
        ));
    }
    if want.attributes != got.attributes {
        fields.push(format!(
            "attributes {} -> {}",
            attributes(want.attributes),
            attributes(got.attributes)
        ));
    }
    fields
}

fn attributes(value: Attributes) -> String {
    const NAMES: [(Attributes, &str); 8] = [
        (Attributes::BOLD, "bold"),
        (Attributes::DIM, "dim"),
        (Attributes::ITALIC, "italic"),
        (Attributes::UNDERLINE, "underline"),
        (Attributes::BLINK, "blink"),
        (Attributes::INVERSE, "inverse"),
        (Attributes::HIDDEN, "hidden"),
        (Attributes::STRIKETHROUGH, "strikethrough"),
    ];
    let names: Vec<&str> = NAMES
        .iter()
        .filter(|(flag, _)| value.contains(*flag))
        .map(|(_, name)| *name)
        .collect();
    if names.is_empty() {
        "none".to_owned()
    } else {
        names.join("+")
    }
}
