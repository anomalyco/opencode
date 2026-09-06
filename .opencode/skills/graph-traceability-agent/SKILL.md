---
name: graph-traceability-agent
description: Create traceability from Agile V requirements to Understand Anything graph nodes, changed files, and tests, ensuring full evidence chain coverage.
license: CC-BY-SA-4.0
compatibility: opencode
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
---

# Instructions

## Purpose

Create traceability from Agile V requirements to Understand Anything graph nodes, changed files,
and tests. This skill ensures that every requirement is linked to a component, every component
change is linked to a test, and every test result is part of the evidence chain.

---

## Trigger conditions

Use this skill when:

- Requirements exist for a change to an existing system.
- A knowledge graph is available.
- The evidence bundle needs component-level traceability.
- A change request modifies existing components.
- An auditor or reviewer requests a traceability matrix.
- The Red Team needs to verify predicted vs actual impact.

---

## Inputs

```text
- .agile-v/REQUIREMENTS.md                        required
- .agile-v/phases/01-impact/impact_map.md          required
- .agile-v/phases/01-impact/affected_components.json required
- implementation diff (git diff or patch file)    required
- test results (JSON or JUnit XML)                required
- .agile-v/phases/00-understanding/normalized_graph.json optional but preferred
```

---

## Outputs

All outputs are written to canonical `.agile-v/traceability/`.

```text
graph_traceability_matrix.md
req_to_component_links.json
component_to_test_links.json
traceability_gaps.md
```

---

## Required behavior

### Step 1: Link requirements to graph nodes

For each requirement in `requirements.md`:
1. Extract the requirement ID and description.
2. Search `affected_components.json` for components linked to this requirement.
3. Search the normalized graph for nodes that match the described behavior.
4. Record: `requirement_id → component_id → path/symbol`.

### Step 2: Link graph nodes to changed files

For each affected component in `affected_components.json`:
1. Confirm whether the component was changed in the implementation diff.
2. Record change type: modified, added, removed, or not changed.
3. If a predicted component was not changed, flag it for review.

### Step 3: Link requirements to tests

For each requirement:
1. Find test cases in the test results that cover the requirement.
2. Use test names, comments, or explicit `@covers REQ-XXXX` annotations.
3. Record: `requirement_id → test_id → test_path → result`.

### Step 4: Link changed files to test evidence

For each changed file:
1. Find tests that import or reference it.
2. Confirm those tests were executed and their results are in the evidence.
3. Flag any changed file with no linked test.

### Step 5: Identify orphan requirements

An orphan requirement is one with no linked component or no linked test.
Record each orphan with the reason (no component found / no test found).

### Step 6: Identify orphan changes

An orphan change is a file that was modified in the diff but is not linked to any requirement.
Record each orphan change. An orphan change is acceptable if it is justified (e.g., module
wiring, formatting fix) but it must be explicitly acknowledged.

---

## Output template: graph_traceability_matrix.md

```markdown
# Graph Traceability Matrix

| Requirement | Graph Node | File/Symbol | Change Type | Test Evidence | Status |
|---|---|---|---|---|---|
| REQ-0001 | node-042 | src/auth/auth.controller.ts::login | Modified | tests/auth/auth.e2e.ts::login_test | Verified |

## Orphan Requirements

| Requirement | Issue |
|---|---|
| ... | No linked component / No linked test |

## Orphan Changes

| File/Symbol | Issue |
|---|---|
| ... | Changed but not linked to a requirement |

## Traceability Decision

- Pass / Fail / Pass with findings
- Findings: ...
```

---

## Output schema: req_to_component_links.json

```json
[
  {
    "requirement_id": "REQ-0001",
    "component_id": "node-042",
    "path": "src/auth/auth.controller.ts",
    "symbol": "AuthController.login",
    "confidence": "high"
  }
]
```

## Output schema: component_to_test_links.json

```json
[
  {
    "component_id": "node-042",
    "path": "src/auth/auth.controller.ts",
    "test_id": "TEST-001",
    "test_path": "test/auth/auth.e2e-spec.ts",
    "test_result": "pass|fail|not_run",
    "evidence_path": ".agile-v/evidence/test-results.json"
  }
]
```

---

## Anti-patterns to avoid

- Do not invent traceability links that are not supported by evidence.
- Do not mark orphan changes as acceptable without a justification.
- Do not skip the traceability gaps document even if there are no gaps.
- Do not include implementation code in the traceability matrix.

Use typed graph relations from the canonical lifecycle contract: artifacts `implements` and tests `verifies` a specific baselined `REQ-XXXX` revision with baseline evidence; verification `evaluates` artifacts/test cases. Halt rather than invent links. If AI materially influences outputs at any risk level, update `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

---

## Compatible tools

Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Cline.
