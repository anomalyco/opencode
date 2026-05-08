# Visual Communication in Plan Documents

Section 3.4 covers diagrams about the *solution being planned* (pseudo-code, mermaid sequences, state diagrams). The existing Section 4.3 mermaid rule encourages those solution-design diagrams within Technical Design and per-unit fields. This guidance covers a different concern: visual aids that help readers *navigate and comprehend the plan document itself* -- dependency graphs, interaction diagrams, and comparison tables that make plan structure scannable.

Visual aids are conditional on content patterns, not on plan depth classification -- a Lightweight plan about a complex multi-unit workflow may warrant a dependency graph; a Deep plan about a straightforward feature may not.

**When to include:**

| Plan describes... | Visual aid | Placement |
|---|---|---|
| 4+ implementation units with non-linear dependencies (parallelism, diamonds, fan-in/fan-out) | Mermaid dependency graph | Before or after the Implementation Units heading |
| System-Wide Impact naming 3+ interacting surfaces or cross-layer effects | Mermaid interaction or component diagram | Within the System-Wide Impact section |
| Summary or Problem Frame involving 3+ behavioral modes, states, or variants | Markdown comparison table | Within Summary or Problem Frame (legacy plans may still use `Overview`) |
| Key Technical Decisions with 3+ interacting decisions, or Alternative Approaches with 3+ alternatives | Markdown comparison table | Within the relevant section |

**When to skip:**
- The plan has 3 or fewer units in a straight dependency chain -- the Dependencies field on each unit is sufficient
- Prose already communicates the relationships clearly
- The visual would duplicate what the High-Level Technical Design section already shows
- The visual describes code-level detail (specific method names, SQL columns, API field lists)

**Format selection:**
- **Mermaid** (default) for dependency graphs and interaction diagrams -- 5-15 nodes, no in-box annotations, standard flowchart shapes. Use `TB` (top-to-bottom) direction so diagrams stay narrow in both rendered and source form. Source should be readable as fallback in diff views and terminals.
- **ASCII/box-drawing diagrams** for annotated flows that need rich in-box content -- file path layouts, decision logic branches, multi-column spatial arrangements. More expressive than mermaid when the diagram's value comes from annotations within nodes. Follow 80-column max for code blocks, use vertical stacking.
- **Markdown tables** for mode/variant comparisons and decision/approach comparisons.
- Keep diagrams proportionate to the plan. A 6-unit linear chain gets a simple 6-node graph. A complex dependency graph with fan-out and fan-in may need 10-15 nodes -- that is fine if every node earns its place.
- Place inline at the point of relevance, not in a separate section.
- Plan-structure level only -- unit dependencies, component interactions, mode comparisons, impact surfaces. Not implementation architecture, data schemas, or code structure (those belong in Section 3.4).
- Prose is authoritative: when a visual aid and its surrounding prose disagree, the prose governs.

After generating a visual aid, verify it accurately represents the plan sections it illustrates -- correct dependency edges, no missing surfaces, no merged units.
