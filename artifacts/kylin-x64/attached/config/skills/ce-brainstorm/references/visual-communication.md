# Visual Communication in Requirements Documents

Visual aids are conditional on content patterns, not on depth classification — a Lightweight brainstorm about a complex workflow may warrant a diagram; a Deep brainstorm about a straightforward feature may not.

**When to include:**

| Requirements describe... | Visual aid | Placement |
|---|---|---|
| A multi-step user workflow or process | Mermaid flow diagram or ASCII flow with annotations | After Problem Frame, or under its own `## User Flow` heading for substantial flows (>10 nodes) |
| 3+ behavioral modes, variants, or states | Markdown comparison table | Within the Requirements section |
| 3+ interacting participants (user roles, system components, external services) | Mermaid or ASCII relationship diagram | After Problem Frame, or under its own `## Architecture` heading |
| Multiple competing approaches being compared | Comparison table | Within Phase 2 approach exploration |

**When to skip:**
- Prose already communicates the concept clearly
- The diagram would just restate the requirements in visual form without adding comprehension value
- The visual describes implementation architecture, data schemas, state machines, or code structure (that belongs in `ce-plan`)
- The brainstorm is simple and linear with no multi-step flows, mode comparisons, or multi-participant interactions

**Format selection:**
- **Mermaid** (default) for simple flows — 5-15 nodes, no in-box annotations, standard flowchart shapes. Use `TB` (top-to-bottom) direction so diagrams stay narrow in both rendered and source form. Source should be readable as fallback in diff views and terminals.
- **ASCII/box-drawing diagrams** for annotated flows that need rich in-box content — CLI commands at each step, decision logic branches, file path layouts, multi-column spatial arrangements. More expressive than mermaid when the diagram's value comes from annotations within steps. Follow 80-column max for code blocks, use vertical stacking.
- **Markdown tables** for mode/variant comparisons and approach comparisons.
- Keep diagrams proportionate to the content. A simple 5-step workflow gets 5-10 nodes. A complex workflow with decision branches and annotations at each step may need 15-20 nodes — that is fine if every node earns its place.
- Place inline at the point of relevance, not in a separate section.
- Conceptual level only — user flows, information flows, mode comparisons, component responsibilities. Not implementation architecture, data schemas, or code structure.
- Prose is authoritative: when a visual aid and surrounding prose disagree, the prose governs.

After generating a visual aid, verify it accurately represents the prose requirements — correct sequence, no missing branches, no merged steps. Diagrams without code to validate against carry higher inaccuracy risk than code-backed diagrams.
