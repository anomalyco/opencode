//! P-APP (H.2, `docs/H.2.md`): the recordings `parity/app/scenarios.test.tsx` writes, masks, and the checkpoint
//! and request comparisons. The runner that drives the Rust TUI is `crates/tui/tests/app.rs`; this module does
//! not depend on the TUI.

use std::collections::BTreeMap;
use std::fmt::Write;
use std::path::{Path, PathBuf};

use opentui::native::Cell;
use opentui::style::{Attributes, Color};
use serde::Deserialize;
use serde_json::Value;

use crate::{Comparison, Fixture, compare, fixtures_dir};

/// A decoded query: each name with its values, names sorted.
pub type Query = BTreeMap<String, Vec<String>>;

/// `parity/fixtures/<step>/<name>.app.json`.
#[derive(Clone, Debug, Deserialize)]
pub struct Recording {
    pub scenario: String,
    pub width: u16,
    pub height: u16,
    /// The location directory the TS fixture serves.
    pub directory: String,
    /// `cli.json` `Info`, with `animations: false`.
    pub config: Value,
    pub args: Args,
    /// Environment variables the TUI reads at startup, such as `OPENCODE_ROUTE`.
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub routes: Vec<RouteSpec>,
    pub steps: Vec<Step>,
    /// A deviation that allows the request comparison to differ.
    pub deviation: Option<String>,
    pub requests: Requests,
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Args {
    #[serde(rename = "sessionID")]
    pub session_id: Option<String>,
    #[serde(rename = "continue", default)]
    pub continue_: bool,
    /// Fork the `sessionID` or `continue` session.
    #[serde(default)]
    pub fork: bool,
    pub prompt: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
    #[serde(rename = "newSessionID")]
    pub new_session_id: Option<String>,
}

/// A scenario route, in H.3's shape (`parity/lib/fake-server.ts`).
#[derive(Clone, Debug, Deserialize)]
pub struct RouteSpec {
    pub method: Option<String>,
    pub path: String,
    pub status: Option<u16>,
    pub json: Option<Value>,
    pub body: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Step {
    Checkpoint(Checkpoint),
    Keys {
        keys: Vec<String>,
    },
    Type {
        #[serde(rename = "type")]
        text: String,
    },
    /// A left press and release at `[x, y]`.
    Click {
        click: [u16; 2],
    },
    Event {
        event: Value,
    },
    /// A left-button drag from one cell to another (E.12).
    Drag {
        drag: [[u16; 2]; 2],
    },
    /// A left click at a cell (E.12).
    Click {
        click: [u16; 2],
    },
}

#[derive(Clone, Debug, Deserialize)]
pub struct Checkpoint {
    pub checkpoint: String,
    pub until: Option<String>,
    #[serde(default)]
    pub masks: Vec<Mask>,
    #[serde(default)]
    pub deviation: Vec<String>,
    /// The cell file under `parity/fixtures`, without `.json`.
    pub fixture: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(untagged)]
pub enum Mask {
    Rect {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        reason: String,
    },
    /// Blanks every match of the regex on every row.
    Line { line: String, reason: String },
}

#[derive(Clone, Debug, Default, Deserialize)]
pub struct Requests {
    pub writes: Vec<Exchange>,
    pub reads: Vec<Exchange>,
}

/// A request, as either side sent it.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Sent {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: Query,
    pub body: Option<Value>,
}

/// A request the TS TUI sent, with the response it got.
#[derive(Clone, Debug, Deserialize)]
pub struct Exchange {
    pub method: String,
    pub path: String,
    #[serde(default)]
    pub query: Query,
    pub body: Option<Value>,
    pub status: u16,
    pub json: Option<Value>,
    pub text: Option<String>,
    #[serde(rename = "contentType")]
    pub content_type: Option<String>,
}

impl Recording {
    pub fn load(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .map_err(|error| format!("{}: {error}", path.display()))?;
        serde_json::from_str(&text).map_err(|error| format!("{}: {error}", path.display()))
    }

    /// Every recording under `parity/fixtures/*/`, by name. `only` (`<step>/<name>`) selects one.
    pub fn all(only: Option<&str>) -> Result<Vec<Self>, String> {
        let mut paths: Vec<PathBuf> = std::fs::read_dir(fixtures_dir())
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|step| std::fs::read_dir(step.path()).ok())
            .flatten()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.to_string_lossy().ends_with(".app.json"))
            .collect();
        paths.sort();
        let recordings = paths
            .iter()
            .map(Self::load)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(recordings
            .into_iter()
            .filter(|recording| only.is_none_or(|only| recording.scenario == only))
            .collect())
    }
}

/// The style of a masked cell, on both sides (`MASKED_STYLE` in `parity/lib/app.ts`).
fn masked() -> Cell {
    Cell {
        symbol: " ".to_owned(),
        fg: Color::rgba(0, 0, 0, 0),
        bg: Color::rgba(0, 0, 0, 0),
        attributes: Attributes::NONE,
    }
}

/// Blanks the masked cells, as `applyMasks` in `parity/lib/app.ts` does.
pub fn apply_masks(fixture: &mut Fixture, masks: &[Mask]) -> Result<(), String> {
    for mask in masks {
        match mask {
            Mask::Rect {
                x,
                y,
                width,
                height,
                ..
            } => {
                for row in *y..y + height {
                    for column in *x..x + width {
                        if let Some(cell) = fixture.cell_mut(column, row) {
                            *cell = masked();
                        }
                    }
                }
            }
            Mask::Line { line, .. } => {
                let pattern =
                    regex::Regex::new(line).map_err(|error| format!("mask {line:?}: {error}"))?;
                for row in 0..fixture.height {
                    let symbols: Vec<String> = fixture
                        .row(row)
                        .iter()
                        .map(|cell| cell.symbol.clone())
                        .collect();
                    // The byte offset where each cell starts, so a match maps back to cells.
                    let starts: Vec<usize> = symbols
                        .iter()
                        .scan(0, |offset, symbol| {
                            let start = *offset;
                            *offset += symbol.len();
                            Some(start)
                        })
                        .collect();
                    let text = symbols.concat();
                    for found in pattern.find_iter(&text) {
                        for (column, start) in starts.iter().enumerate() {
                            if (found.start()..found.end()).contains(start) {
                                *fixture.cell_mut(column as u32, row).expect("in range") = masked();
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// The outcome of one checkpoint.
pub struct CheckpointResult {
    pub comparison: Comparison,
    /// The capture, masked, as fixture JSON, for a diff against the recorded file.
    pub actual: String,
}

/// Masks the capture and compares it with the checkpoint's recorded cells.
pub fn compare_checkpoint(
    checkpoint: &Checkpoint,
    actual: Fixture,
) -> Result<CheckpointResult, String> {
    let expected = Fixture::load(fixtures_dir().join(format!("{}.json", checkpoint.fixture)))?;
    let mut actual = actual;
    apply_masks(&mut actual, &checkpoint.masks)?;
    Ok(CheckpointResult {
        comparison: compare(&expected, &actual),
        actual: actual.to_json(),
    })
}

/// Whether `parity/deviations/<name>.md` exists.
pub fn deviation_exists(name: &str) -> bool {
    fixtures_dir()
        .join("../deviations")
        .join(format!("{name}.md"))
        .is_file()
}

/// P-REQ: writes must match in order (method, path, body); every Rust read must have been answered. TS reads
/// the Rust TUI does not send are listed in `not_sent`, not failed.
pub struct RequestComparison {
    pub writes_differ: Option<String>,
    pub unmatched: Vec<String>,
    pub not_sent: Vec<String>,
}

impl RequestComparison {
    pub fn is_equal(&self) -> bool {
        self.writes_differ.is_none() && self.unmatched.is_empty()
    }
}

/// A GET, or a plugin RPC named `get` (the goal footer posts one); the same rule as `isRead` in
/// `parity/app/scenarios.test.tsx`.
pub fn is_read(method: &str, path: &str) -> bool {
    method == "GET"
        || path
            .strip_prefix("/api/rpc/")
            .and_then(|rest| rest.strip_suffix("/get"))
            .is_some_and(|plugin| !plugin.is_empty() && !plugin.contains('/'))
}

/// `actual` holds every Rust request in order; `unmatched` the ones no route answered.
pub fn compare_requests(
    recording: &Recording,
    actual: &[Sent],
    unmatched: &[Sent],
) -> RequestComparison {
    let writes: Vec<(&str, &str, Option<&Value>)> = actual
        .iter()
        .filter(|sent| !is_read(&sent.method, &sent.path))
        .map(|sent| (sent.method.as_str(), sent.path.as_str(), sent.body.as_ref()))
        .collect();
    let expected: Vec<(&str, &str, Option<&Value>)> = recording
        .requests
        .writes
        .iter()
        .map(|sent| (sent.method.as_str(), sent.path.as_str(), sent.body.as_ref()))
        .collect();
    let line = |(method, path, body): &(&str, &str, Option<&Value>)| {
        format!(
            "{method} {path}{}",
            body.map(|body| format!(" {body}")).unwrap_or_default()
        )
    };
    let writes_differ = (writes != expected).then(|| {
        let mut out = String::from("writes differ\n");
        for write in &expected {
            let _ = writeln!(out, "  - ts | {}", line(write));
        }
        for write in &writes {
            let _ = writeln!(out, "  + rs | {}", line(write));
        }
        out
    });
    let mut not_sent: Vec<String> = recording
        .requests
        .reads
        .iter()
        .filter(|read| {
            !actual
                .iter()
                .any(|sent| sent.method == read.method && sent.path == read.path)
        })
        .map(|read| format!("{} {}", read.method, read.path))
        .collect();
    not_sent.dedup();
    RequestComparison {
        writes_differ,
        unmatched: unmatched
            .iter()
            .map(|sent| format!("{} {}", sent.method, sent.path))
            .collect(),
        not_sent,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&str]) -> Fixture {
        let cells = rows
            .iter()
            .flat_map(|row| row.chars())
            .map(|symbol| Cell {
                symbol: symbol.to_string(),
                fg: Color::rgba(255, 255, 255, 255),
                bg: Color::rgba(0, 0, 0, 255),
                attributes: Attributes::NONE,
            })
            .collect();
        Fixture {
            width: rows[0].chars().count() as u32,
            height: rows.len() as u32,
            cells,
        }
    }

    fn text(fixture: &Fixture) -> Vec<String> {
        (0..fixture.height)
            .map(|y| {
                fixture
                    .row(y)
                    .iter()
                    .map(|cell| cell.symbol.as_str())
                    .collect()
            })
            .collect()
    }

    #[test]
    fn line_and_rect_masks_blank_cells() {
        let mut fixture = grid(&["Ask anything… \"x\" ab", "took 12ms here      "]);
        let masks = [
            Mask::Line {
                line: "Ask anything… \".*\"".into(),
                reason: "random".into(),
            },
            Mask::Rect {
                x: 5,
                y: 1,
                width: 4,
                height: 1,
                reason: "duration".into(),
            },
        ];
        apply_masks(&mut fixture, &masks).unwrap();
        assert_eq!(
            text(&fixture),
            ["                  ab", "took      here      "]
        );
        assert_eq!(*fixture.cell(0, 0).unwrap(), masked());
        assert_ne!(*fixture.cell(18, 0).unwrap(), masked());
    }

    #[test]
    fn requests_compare_writes_in_order_and_report_unanswered_reads() {
        let sent = |method: &str, path: &str, body: Option<Value>| Sent {
            method: method.into(),
            path: path.into(),
            query: Query::new(),
            body,
        };
        let recording: Recording = serde_json::from_value(serde_json::json!({
            "scenario": "x/y", "width": 1, "height": 1, "directory": "/", "config": {}, "args": {},
            "routes": [], "steps": [],
            "requests": {
                "writes": [{ "method": "POST", "path": "/api/a", "query": {}, "body": { "n": 1 }, "status": 204 }],
                "reads": [{ "method": "GET", "path": "/api/vcs", "query": {}, "status": 200, "json": {} }],
            },
        }))
        .unwrap();
        let same = [sent("POST", "/api/a", Some(serde_json::json!({ "n": 1 })))];
        let result = compare_requests(&recording, &same, &[]);
        assert!(result.is_equal());
        assert_eq!(result.not_sent, ["GET /api/vcs"]);

        let other = [sent("POST", "/api/a", Some(serde_json::json!({ "n": 2 })))];
        let missing = [sent("GET", "/api/nope", None)];
        let result = compare_requests(&recording, &other, &missing);
        assert!(
            result
                .writes_differ
                .unwrap()
                .contains("+ rs | POST /api/a {\"n\":2}")
        );
        assert_eq!(result.unmatched, ["GET /api/nope"]);

        assert!(is_read("POST", "/api/rpc/opencode.goal/get"));
        assert!(!is_read("POST", "/api/rpc/opencode.goal/set"));
        assert!(!is_read("POST", "/api/rpc//get"));
    }

    #[test]
    fn steps_decode_every_kind() {
        let steps: Vec<Step> = serde_json::from_value(serde_json::json!([
            { "keys": ["ctrl+x", "l"] },
            { "type": "hello" },
            { "event": { "type": "x" } },
            { "checkpoint": "home", "fixture": "H.2/a/home", "masks": [{ "line": "a", "reason": "r" }] },
        ]))
        .unwrap();
        assert!(matches!(&steps[0], Step::Keys { keys } if keys.len() == 2));
        assert!(matches!(&steps[1], Step::Type { text } if text == "hello"));
        assert!(matches!(&steps[2], Step::Event { .. }));
        assert!(matches!(&steps[3], Step::Checkpoint(checkpoint) if checkpoint.masks.len() == 1));
    }
}
