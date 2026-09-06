# Activation Cases: system-understanding-agent

## When should this skill activate?

The following inputs should trigger this skill.

| Case | Input signal | Expected behavior |
|---|---|---|
| AC-001 | `.understand-anything/knowledge-graph.json` exists in the repository | Skill activates automatically as part of Gate 0. |
| AC-002 | User says "what does this system do?" | Skill activates; produces system overview without proceeding to build. |
| AC-003 | User says "what will this change affect?" | Skill activates; produces system overview and impact map primer. |
| AC-004 | Change request targets an existing repository | Skill activates as Gate 0 before `impact-analysis-agent`. |
| AC-005 | User asks for an onboarding guide | Skill activates; produces system overview and architecture map. |
| AC-006 | Task involves more than 3 files in the change request | Skill activates to reduce risk of blind changes. |
| AC-007 | Risk level is L3 or L4 | Skill is mandatory. |
| AC-008 | User asks for a traceability matrix | Skill activates to establish the graph context needed by `graph-traceability-agent`. |

## Chaining behavior

After this skill runs:
- If gate passes: proceed to `impact-analysis-agent`.
- If gate fails: block and request human clarification or additional context.
- If graph not available: record absence and proceed with reduced confidence.
