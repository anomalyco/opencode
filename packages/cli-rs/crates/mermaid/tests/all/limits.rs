use std::time::{Duration, Instant};

use opencode_mermaid::{Palette, Rendered, render};
use opencode_plugin::node::Reader;
use opencode_ui::theme::{Catalog, ThemeMode};

/// The labels of many parallel transitions find their places near their routes, not by scanning the plane.
#[test]
fn many_labeled_transitions_render_promptly() {
    let source = format!(
        "stateDiagram-v2\n  [*] --> Processing\n  state Processing {{\n    [*] --> Validate\n    Validate --> Decision\n    \
         Decision --> Accepted: valid\n    Decision --> Rejected: invalid\n    Accepted --> [*]\n    Rejected --> [*]\n  \
         }}\n  Processing --> Complete\n  Complete --> [*]\n{}",
        "  Decision --> Rejected: invalid\n".repeat(16)
    );
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let palette = Palette::read(&Reader::new(&theme, ThemeMode::Dark));
    let started = Instant::now();
    assert!(matches!(render(&source, 120, &palette), Rendered::Diagram(_)));
    assert!(started.elapsed() < Duration::from_secs(3), "{:?}", started.elapsed());
}
