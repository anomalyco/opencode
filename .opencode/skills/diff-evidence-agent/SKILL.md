---
name: diff-evidence-agent
description: Create evidence explaining the actual implementation diff and its relationship to the predicted impact, closing the loop between pre-change prediction and post-change reality.
license: CC-BY-SA-4.0
compatibility: opencode
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
---

# Instructions

## Purpose

Create evidence explaining the actual implementation diff and its relationship to the predicted
impact. This skill closes the loop between the pre-change impact prediction and the post-change
reality, and is a key input for the Red Team's evidence quality check.

---

## Trigger conditions

Use this skill after implementation and before final validation. Specifically:

- After the Build Agent has made changes.
- After tests have been run.
- Before Red Team evidence verification.
- When generating the final evidence bundle.
- When a reviewer asks "what actually changed vs what was predicted?"

---

## Inputs

```text
- implementation diff (git diff HEAD~1 or patch file)      required
- .agile-v/phases/01-impact/impact_map.md                  required
- .agile-v/phases/01-impact/change_risk_assessment.md      required
- .agile-v/REQUIREMENTS.md                                 required
- .agile-v/traceability/graph_traceability_matrix.md       required
- test results (JSON or JUnit XML)                         required
- .understand-anything/diff-overlay.json                   optional
```

---

## Outputs

All outputs are written to `.agile-v/traceability/` (alongside the traceability matrix).

```text
diff_impact_report.md
risk_delta.md
release_impact_summary.md
changed_node_list.json
```

---

## Required behavior

### Step 1: Parse the diff

1. List all files changed, added, and deleted in the implementation diff.
2. For each changed file, extract the key symbols modified (function names, class names).
3. Map each changed file to graph nodes using the normalized graph (if available).

### Step 2: Compare predicted vs actual impact

For each node in `impact_map.md`:
1. Check whether it was actually changed.
2. Record: Predicted=Yes, Changed=Yes/No.

For each changed file:
1. Check whether it was in the impact map.
2. If not, record as an unexpected change.

### Step 3: Explain unexpected changes

For each unexpected change (file changed but not in impact map):
1. Identify why it was changed.
2. Classify: acceptable (module wiring, formatting, etc.) or concerning (scope creep, unintended).
3. Record in `diff_impact_report.md`.

### Step 4: Update risk status

For each risk in `change_risk_assessment.md`:
1. Check whether the risk was realized (test failed, unexpected behavior found).
2. Update risk status: mitigated / realized / residual.
3. Record in `risk_delta.md`.

### Step 5: Record decision

Decide:
- **Accept** — all unexpected changes are justified, risks are mitigated, tests pass.
- **Rework required** — unexpected changes are not justified, tests failed, risks unmitigated.

---

## Output template: diff_impact_report.md

```markdown
# Diff Impact Report

## Summary

<What changed and why.>

## Predicted vs Actual Impact

| Component | Predicted | Changed | Explanation |
|---|---|---|---|
| src/auth/auth.controller.ts | Yes | Yes | Expected implementation change |
| src/auth/auth.module.ts | Yes | Yes | Required for module wiring |
| src/auth/auth.service.ts | Low confidence | No | Not required; guard runs before service |

## Unexpected Changes

| File | Reason | Risk |
|---|---|---|
| ... | ... | Acceptable / Scope creep |

## Regression Evidence

| Risk | Test Evidence | Result |
|---|---|---|
| ... | ... | Pass/Fail |

## Decision

- Accept / Rework required
- Reason: ...
```

---

## Output schema: changed_node_list.json

```json
[
  {
    "path": "src/auth/auth.controller.ts",
    "component_id": "node-042",
    "change_type": "modified",
    "predicted": true,
    "symbols_changed": ["AuthController.login"],
    "unexpected": false,
    "justification": null
  }
]
```

---

## Anti-patterns to avoid

- Do not mark all unexpected changes as acceptable without a specific justification.
- Do not skip the risk delta document.
- Do not accept the diff if any critical risk is unrealized (test failed for a high-severity risk).
- Do not include raw source code diffs in the evidence report (use line counts and symbol names).

Use canonical typed lineage and preserve `REQ-XXXX` revision/baseline references; this evidence supports verification and is not intended-use validation. Apply inherited `agile-v-core` halt/decision rules and `agile-v-aibom` manifest capture for materially AI-influenced output at any risk level.

---

## Compatible tools

Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Cline.
