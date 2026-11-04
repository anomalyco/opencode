//! P-ORACLE for P.3: renders every source of parity/fixtures/P.3/corpus.json (written by
//! parity/oracle/P.3-mermaid.ts from the TS plugin) and compares each styled line with TS.

use opencode_mermaid::{Palette, Rendered, render};
use opencode_ui::theme::{Catalog, ThemeMode};
use opentui::prelude::Color;

const CORPUS: &str = include_str!("../../../parity/fixtures/P.3/corpus.json");

fn hex(color: Option<Color>) -> String {
    color.map_or("-".to_string(), |c| format!("{:02x}{:02x}{:02x}{:02x}", c.r, c.g, c.b, c.a))
}

/// A case as the fixture stores it: lines and per-line [code points, style key] runs.
type Case = (Vec<String>, Vec<Vec<(usize, String)>>);

fn rust_case(source: &str, width: u16, palette: &Palette) -> Option<Case> {
    let diagram = match render(source, width, palette) {
        Rendered::Diagram(diagram) => diagram,
        Rendered::Syntax { prefix: Some(diagram), .. } => diagram,
        Rendered::Code | Rendered::Syntax { prefix: None, .. } => return None,
    };
    let lines = diagram.lines.iter().map(|line| line.iter().map(|run| run.text.as_str()).collect()).collect();
    let runs = diagram
        .lines
        .iter()
        .map(|line| {
            line.iter()
                .filter(|run| !run.text.is_empty())
                .map(|run| (run.text.chars().count(), format!("{} {} {}", hex(run.fg), hex(run.bg), run.attributes)))
                .collect()
        })
        .collect();
    Some((lines, runs))
}

/// Joins neighboring runs with the same style, as TS chunks of equal style may also be split.
fn merged(runs: Vec<(usize, String)>) -> Vec<(usize, String)> {
    let mut out: Vec<(usize, String)> = Vec::new();
    for (count, style) in runs {
        match out.last_mut() {
            Some(last) if last.1 == style => last.0 += count,
            _ => out.push((count, style)),
        }
    }
    out
}

/// The diagram kinds the port covers so far.
const PORTED: &[&str] = &["flowchart", "sequence", "gantt", "gitGraph", "timeline"];

/// The kind a source's header names, independent of the Rust detector under test.
fn header_kind(source: &str) -> &'static str {
    let header = source
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty() && !line.starts_with("%%"))
        .unwrap_or("")
        .to_ascii_lowercase();
    let word = header.split_whitespace().next().unwrap_or("");
    match word {
        "flowchart" | "graph" => "flowchart",
        "sequencediagram" => "sequence",
        "statediagram" | "statediagram-v2" => "state",
        "gantt" => "gantt",
        "gitgraph" | "gitgraph:" => "gitGraph",
        "timeline" => "timeline",
        _ => "none",
    }
}

#[test]
fn diagrams_match_typescript() {
    let corpus: serde_json::Value = serde_json::from_str(CORPUS).unwrap();
    let styles: Vec<String> =
        corpus["styles"].as_array().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect();
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let palette = Palette::from_theme(&theme);
    let only = std::env::var("MERMAID_ONLY").ok();
    let mut failures: Vec<String> = Vec::new();
    let mut total = 0;
    for case in corpus["cases"].as_array().unwrap() {
        let source = case["source"].as_str().unwrap();
        let width = case["width"].as_u64().unwrap() as u16;
        let kind = header_kind(source);
        if !PORTED.contains(&kind) || only.as_deref().is_some_and(|only| only != kind) {
            continue;
        }
        total += 1;
        let empty = case["height"].as_u64() == Some(0);
        let expected: Option<Case> = case["lines"].as_array().map(|lines| {
            if empty {
                return (Vec::new(), Vec::new());
            }
            let lines: Vec<String> = lines.iter().map(|line| line.as_str().unwrap().to_string()).collect();
            let runs: Vec<Vec<(usize, String)>> = case["runs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| {
                    row.as_array()
                        .unwrap()
                        .iter()
                        .map(|run| {
                            (run[0].as_u64().unwrap() as usize, styles[run[1].as_u64().unwrap() as usize].clone())
                        })
                        .collect()
                })
                .collect();
            (lines, runs)
        });
        let actual = rust_case(source, width, &palette);
        let report = match (&expected, &actual) {
            (None, None) => None,
            (Some(_), None) => Some("TS draws a diagram; Rust keeps the code".to_string()),
            (None, Some(_)) => Some("TS keeps the code; Rust draws a diagram".to_string()),
            (Some((lines, runs)), Some((actual_lines, actual_runs))) => {
                if lines != actual_lines {
                    Some(format!("text differs:\n--- TS\n{}\n--- Rust\n{}", lines.join("\n"), actual_lines.join("\n")))
                } else {
                    let row = runs
                        .iter()
                        .zip(actual_runs)
                        .position(|(a, b)| merged(a.clone()) != merged(b.clone()));
                    row.map(|row| {
                        format!(
                            "styles differ on row {row} ({:?}):\n  TS   {:?}\n  Rust {:?}",
                            lines[row], runs[row], actual_runs[row]
                        )
                    })
                }
            }
        };
        if let Some(report) = report {
            failures.push(format!("[{kind} width {width}]\n{source}\n{report}"));
        }
    }
    eprintln!("P.3 oracle: {} of {total} cases equal", total - failures.len());
    if !failures.is_empty() {
        let directory = std::env::temp_dir().join("opencode-parity/P.3");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("failures.txt"), failures.join("\n\n========\n\n")).unwrap();
        panic!(
            "{} of {total} cases differ from TS (details in {}):\n\n{}",
            failures.len(),
            directory.join("failures.txt").display(),
            failures.iter().take(3).cloned().collect::<Vec<_>>().join("\n\n========\n\n")
        );
    }
}
