use std::time::{Duration, Instant};

use opencode_mermaid::{Palette, Rendered, render};
use opencode_plugin::node::Reader;
use opencode_ui::theme::{Catalog, ThemeMode};

fn palette() -> Palette {
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    Palette::read(&Reader::new(&theme, ThemeMode::Dark))
}

/// The labels of many parallel transitions find their places near their routes, not by scanning the plane.
#[test]
fn many_labeled_transitions_render_promptly() {
    let source = format!(
        "stateDiagram-v2\n  [*] --> Processing\n  state Processing {{\n    [*] --> Validate\n    Validate --> Decision\n    \
         Decision --> Accepted: valid\n    Decision --> Rejected: invalid\n    Accepted --> [*]\n    Rejected --> [*]\n  \
         }}\n  Processing --> Complete\n  Complete --> [*]\n{}",
        "  Decision --> Rejected: invalid\n".repeat(16)
    );
    let started = Instant::now();
    assert!(matches!(render(&source, 120, &palette()), Rendered::Diagram(_)));
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}

/// Repeated edges in a flowchart folded for a narrow terminal check their crossings by cell, not route by route.
#[test]
fn many_repeated_flowchart_edges_route_promptly() {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../../parity/fixtures/P.3/corpus.json")).unwrap();
    let cases = corpus["cases"].as_array().unwrap().iter().filter_map(|case| case["source"].as_str());
    let base = cases.into_iter().find(|source| source.contains("/inference/*")).unwrap();
    let source = format!("{base}\n{}", "    Client -->|/inference/*| DNS --> Infer\n".repeat(15));
    let started = Instant::now();
    assert!(matches!(render(&source, 10, &palette()), Rendered::Diagram(_)));
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}

/// A Gantt axis whose steps no longer move its far-out dates, or that spans millions of years, still ends.
#[test]
fn far_gantt_axes_end() {
    for end in ["1e300, 1e300", "0, 1e18"] {
        let source = format!("gantt\n  dateFormat x\n  a :t1, {end}");
        assert!(matches!(render(&source, 80, &palette()), Rendered::Diagram(_)), "{source}");
    }
}

/// A transition routed beside the states that leaves on the row it arrives on still ends.
#[test]
fn a_side_route_on_one_row_ends() {
    let source = "stateDiagram-v2\n  state Session {\n    state Open {\n      [*] --> Clean\n      Clean --> Dirty: edit\n      \
                  Dirty --> Clean: save\n    }\n  }\n  Session --> [*]\n  Clean😀 --> Dirty: edit\n  Clean --> Dirty: edit";
    assert!(matches!(render(source, 80, &palette()), Rendered::Diagram(_)));
}

/// A subgraph or composite state inside one of the same ID, even by way of another group, is a syntax error, not a
/// group nested without end.
#[test]
fn groups_nested_in_themselves_are_errors() {
    for source in [
        "flowchart LR\n  subgraph Outer\n    subgraph Outer\n      A\n    end\n  end",
        "flowchart LR\n  subgraph Y\n    subgraph X\n      A\n    end\n  end\n  subgraph X\n    subgraph Y\n      B\n    end\n  end",
        "stateDiagram-v2\n  state X {\n    state X {\n      A --> B\n    }\n  }",
    ] {
        assert!(matches!(render(source, 80, &palette()), Rendered::Syntax { .. }), "{source}");
    }
}
