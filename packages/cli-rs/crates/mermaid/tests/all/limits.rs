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

/// A Gantt axis whose steps no longer move its far-out dates, or that spans millions of years, still ends.
#[test]
fn far_gantt_axes_end() {
    for end in ["1e300, 1e300", "0, 1e18"] {
        let source = format!("gantt\n  dateFormat x\n  a :t1, {end}");
        assert!(matches!(render(&source, 80, &palette()), Rendered::Diagram(_)), "{source}");
    }
}
