# diff-evidence-agent

Part of the **Agile V + Understand Anything** integration.

This skill closes the evidence loop between the pre-change impact prediction and the actual
implementation. It compares predicted vs actual changes, explains unexpected modifications,
and updates the risk status for the Red Team and reviewer.

## Key outputs

| File | Purpose |
|---|---|
| `diff_impact_report.md` | Predicted vs actual impact comparison |
| `risk_delta.md` | Updated risk status after build |
| `release_impact_summary.md` | Reviewer-friendly change summary |
| `changed_node_list.json` | Machine-readable list of changed components |

## See also

- `SKILL.md` — full skill specification
- `metadata.json` — machine-readable skill metadata
- `../../integrations/understand-anything/examples/evidence_bundle_example.md` — full example
