# impact-analysis-agent

Part of the **Agile V + Understand Anything** integration.

This skill runs after `system-understanding-agent` (Gate 0) and before `requirement-architect`.
It maps the change request to the knowledge graph and produces a focused impact map that guides
the Build Agent, Test Designer, and Red Team.

## Key outputs

| File | Purpose |
|---|---|
| `impact_map.md` | Predicted affected components (direct and indirect) |
| `affected_components.json` | Machine-readable component list for Build Agent context |
| `regression_test_candidates.md` | Preliminary regression test candidates (refined by `regression-selection-agent`) |
| `change_risk_assessment.md` | Risk register pre-change |

## See also

- `SKILL.md` — full skill specification
- `metadata.json` — machine-readable skill metadata
- `../system-understanding-agent/` — prerequisite skill
- `../regression-selection-agent/` — companion skill for test selection
- `../../integrations/understand-anything/examples/impact_analysis_example.md` — full example
