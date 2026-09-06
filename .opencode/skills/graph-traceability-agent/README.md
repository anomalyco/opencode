# graph-traceability-agent

Part of the **Agile V + Understand Anything** integration.

This skill runs after the Build Agent and Test Designer. It links requirements to graph nodes,
changed files, and test results, producing the graph traceability matrix that forms the core
of the audit evidence chain.

## Key outputs

| File | Purpose |
|---|---|
| `graph_traceability_matrix.md` | Full REQ → node → file → test chain |
| `req_to_component_links.json` | Machine-readable requirement-to-component links |
| `component_to_test_links.json` | Machine-readable component-to-test links |
| `traceability_gaps.md` | Orphan requirements and unjustified changes |

## See also

- `SKILL.md` — full skill specification
- `metadata.json` — machine-readable skill metadata
- `../../integrations/understand-anything/examples/evidence_bundle_example.md` — full example
