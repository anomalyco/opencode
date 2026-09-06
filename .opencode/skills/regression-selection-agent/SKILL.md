---
name: regression-selection-agent
description: Select and prioritize regression tests based on the impact map and graph dependency relationships, flagging coverage gaps before the Red Team step.
license: CC-BY-SA-4.0
compatibility: opencode
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
---

# Instructions

## Purpose

Select and prioritize regression tests based on the impact map and graph dependency relationships.
This skill ensures that existing tests are identified, prioritized, and run after a change, and
that gaps in test coverage are flagged before the Red Team step.

---

## Trigger conditions

Use this skill when:

- Existing behavior must not break (regression risk).
- An impact map is available.
- The change affects shared modules, services, or APIs.
- The system has existing tests that need to be triaged.
- The Test Designer needs to know which existing tests to include.
- A release gate requires documented regression-test coverage.

---

## Inputs

```text
- .agile-v/phases/01-impact/impact_map.md       required
- .agile-v/phases/01-impact/affected_components.json required
- test inventory (discovered from test/ directory or graph test nodes)   required
- .agile-v/phases/00-understanding/normalized_graph.json optional but preferred
- previous test results (if available)          optional
```

---

## Outputs

All outputs are written to canonical `.agile-v/phases/03-regression/`.

```text
required_regression_tests.md
selected_tests.json
regression_coverage_rationale.md
missing_regression_tests.md
```

---

## Required behavior

### Step 1: Discover existing tests

1. Search the repository for test files (`.spec.ts`, `.test.ts`, `_test.py`, `test_*.py`, etc.).
2. If a normalized graph is available, use test nodes from the graph.
3. Build a test inventory: `test_path → linked_components` (from imports and graph edges).

### Step 2: Select tests linked to impacted components

For each test:
1. Check whether it imports, references, or tests any affected component.
2. Prioritize tests that directly test affected entry points.
3. Assign priority: High (direct), Medium (indirect), Low (general).

### Step 3: Identify gaps

For each affected component in `affected_components.json`:
1. Check whether any selected test covers it.
2. If no test is found, record a gap in `missing_regression_tests.md`.
3. Suggest a test name and structure for the missing coverage.

### Step 4: Build rationale

For each selected test, record:
- Why it was selected.
- Which requirement or risk it covers.
- Which component it links to.

---

## Output template: required_regression_tests.md

```markdown
# Required Regression Tests

| Test | Linked Component | Linked Requirement | Risk Covered | Priority |
|---|---|---|---|---|
| tests/auth/session.test.ts | src/auth/session.ts | REQ-0003 | Session regression | High |

## Missing Regression Tests

| Required behavior | Reason | Suggested test |
|---|---|---|
| Rate limit boundary (5th pass, 6th fail) | No existing test | auth.e2e-spec.ts::boundary_test |
```

---

## Output schema: selected_tests.json

```json
[
  {
    "test_path": "test/auth/auth.e2e-spec.ts",
    "test_name": "should login with valid credentials",
    "linked_component_ids": ["node-042"],
    "linked_requirement_ids": ["REQ-0001"],
    "risk_covered": "Core login path not broken",
    "priority": "high",
    "selection_reason": "Directly tests the affected login endpoint."
  }
]
```

---

## Anti-patterns to avoid

- Do not select all tests in the repository. Select only tests linked to affected components.
- Do not skip gap identification even if the test suite seems comprehensive.
- Do not assign High priority to tests with no clear link to affected components.
- Do not generate new test implementations in this skill (that is `test-designer`).

Every requirement link must identify a baselined `REQ-XXXX` revision and baseline; selected tests use `test_case -> verifies -> requirement` lineage. Apply inherited `agile-v-core` halt/decision rules and `agile-v-aibom` manifest capture for materially AI-influenced output at any risk level.

---

## Compatible tools

Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Cline.
