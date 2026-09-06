# Example Output: Understanding Gate Decision

This is the Gate 0 decision document produced by `system-understanding-agent`.

---

# Understanding Gate Decision

## Change request

CR-001: Add rate limiting to the login endpoint (`POST /auth/login`).

## Graph status

- Graph available: **Yes**
- Graph path: `.understand-anything/knowledge-graph.json`
- Graph hash: `sha256:a3f2c1d9e847b650f3c2a1d8e9f0b341c6d7e2a8b9f1c0d3e5a2b7f4c6d9e1a2`
- Graph nodes: 142
- Graph edges: 387
- Languages detected: TypeScript

## Artifacts generated

| Artifact | Status |
|---|---|
| `system_overview.md` | Complete |
| `architecture_map.md` | Complete |
| `domain_flow_summary.md` | Complete |
| `knowledge_graph_summary.md` | Complete |
| `known_constraints.md` | Complete |
| `system_understanding_confidence.md` | Complete |

## Gate 0 checklist

| Criterion | Result |
|---|---|
| Knowledge graph found or absence documented | Pass |
| Graph hash recorded | Pass |
| System summary generated | Pass |
| Key entry points identified | Pass |
| Key dependencies identified | Pass |
| Risks and caution areas identified | Pass |
| Confidence level assigned | Pass — High |
| No blocking issues | Pass |

## Gate decision

**PASS**

The agent has sufficient system context to proceed to impact analysis and requirement generation.
Proceed to `impact-analysis-agent`.

## Reviewer acknowledgment

- Reviewed by: `<human reviewer or AI gate>`
- Reviewed at: `<timestamp>`
- Decision: Approved
