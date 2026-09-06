# Expected Artifacts: system-understanding-agent

## Required outputs (always)

| Artifact | Location | Notes |
|---|---|---|
| `system_overview.md` | `.agile-v/understanding/` | Must include: summary, layers, entry points, dependencies, flows, constraints, confidence. |
| `architecture_map.md` | `.agile-v/understanding/` | Must include: layer table. Mermaid diagram optional. |
| `system_understanding_confidence.md` | `.agile-v/understanding/` | Must state High/Medium/Low with rationale. |
| `understanding_gate_decision.md` | `.agile-v/understanding/` | Must state PASS/FAIL/PASS_WITH_FINDINGS. |

## Required outputs (when graph is available)

| Artifact | Location | Notes |
|---|---|---|
| `knowledge_graph_summary.md` | `.agile-v/understanding/` | Node count, edge count, languages. |
| `knowledge_graph_hash.txt` | `.agile-v/understanding/` | SHA-256 of the source graph. |

## Optional outputs

| Artifact | Location | Notes |
|---|---|---|
| `domain_flow_summary.md` | `.agile-v/understanding/` | Required for domain-complex systems. |
| `known_constraints.md` | `.agile-v/understanding/` | Required if constraints are identified. |

## Content checks for system_overview.md

- Contains a `## Summary` section with at least one non-empty sentence.
- Contains a `## Main Architectural Layers` table with at least one row.
- Contains a `## Key Entry Points` table with at least one row.
- Contains a `## Confidence` section with `High`, `Medium`, or `Low`.
- Does not contain raw source code.
- Does not contain hallucinated file paths not confirmed by graph or inspection.

## Content checks for understanding_gate_decision.md

- Contains `Graph available: Yes` or `Graph available: No`.
- Contains `Graph hash:` if graph was available.
- Contains a `Gate decision:` line with PASS, FAIL, or PASS_WITH_FINDINGS.
- If FAIL, contains at least one blocking issue.
