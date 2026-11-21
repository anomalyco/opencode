use std::time::{Duration, Instant};

use opencode_mermaid::{Palette, Rendered, render};
use opencode_plugin::node::Reader;
use opencode_ui::theme::{Catalog, ThemeMode};

/// Diagrams that once overflowed the stack, looped or froze draw, or fail as a syntax error, within seconds.
#[test]
fn hostile_diagrams_end_promptly() {
    let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
    let palette = Palette::read(&Reader::new(&theme, ThemeMode::Dark));
    // A hundred parallel labeled transitions out of a choice, in a composite state with a note.
    let labels = format!(
        "stateDiagram-v2\n  [*] --> Processing\n  state Processing {{\n    [*] --> Validate\n    Validate --> Decision\n    \
         state Decision <<choice>>\n    Decision --> Accepted: valid\n    Decision --> Rejected: invalid\n    \
         Accepted --> [*]\n    Rejected --> [*]\n  }}\n  note right of Processing\n    Validation and routing happen\n    \
         inside this composite state.\n  end note\n  Processing --> Complete\n  Complete --> [*]\n{}",
        "  Decision --> Rejected: invalid\n".repeat(96)
    );
    for (source, drawn) in [
        // Groups nested in one of their own ID, by way of another group.
        (
            "flowchart LR\n  subgraph Y\n    subgraph X\n      A\n    end\n  end\n  subgraph X\n    subgraph Y\n      B\n    end\n  end",
            false,
        ),
        ("stateDiagram-v2\n  state X {\n    state X {\n      A --> B\n    }\n  }", false),
        // A side route that leaves on the row it arrives on.
        (
            "stateDiagram-v2\n  state Session {\n    state Open {\n      [*] --> Clean\n      Clean --> Dirty: edit\n      \
             Dirty --> Clean: save\n    }\n  }\n  Session --> [*]\n  Clean😀 --> Dirty: edit\n  Clean --> Dirty: edit",
            true,
        ),
        // A Gantt axis whose steps no longer move its dates.
        ("gantt\n  dateFormat x\n  a :t1, 1e300, 1e300", true),
        (&labels, true),
    ] {
        let started = Instant::now();
        let rendered = render(source, 120, &palette);
        let ended =
            if drawn { matches!(rendered, Rendered::Diagram(_)) } else { matches!(rendered, Rendered::Syntax { .. }) };
        assert!(ended, "{source}");
        assert!(started.elapsed() < Duration::from_secs(8), "{:?}: {source}", started.elapsed());
    }
}
