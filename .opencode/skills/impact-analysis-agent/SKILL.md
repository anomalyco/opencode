---
name: impact-analysis-agent
description: Identify the likely impact of a proposed change before implementation by mapping it to graph nodes, affected files, functions, APIs, and tests.
license: CC-BY-SA-4.0
compatibility: opencode
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
---

# Instructions

## Purpose

Identify the likely impact of a proposed change before implementation. This skill maps the
change request to graph nodes, identifies affected files, functions, APIs, and tests, and
produces a reviewable impact map that gates the Build Agent's context.

---

## Trigger conditions

Use this skill when:

- A change request targets an existing system.
- The change could affect multiple files or modules.
- Regression risk exists (the change touches shared code).
- The user asks "what will this impact?" or "what could break?"
- The Red Team needs a pre-change risk map.
- Gate 0 (`system-understanding-agent`) has passed.

---

## Inputs

```text
- change_request.md                            required
- .agile-v/phases/00-understanding/system_overview.md    required
- .agile-v/phases/00-understanding/normalized_graph.json optional but strongly preferred
- .understand-anything/diff-overlay.json       optional
- existing requirements (if any)               optional
```

---

## Outputs

All outputs are written to canonical `.agile-v/phases/01-impact/`.

```text
impact_map.md
affected_components.json
regression_test_candidates.md
change_risk_assessment.md
impact_confidence.md
```

---

## Required behavior

### Step 1: Map change request to graph nodes

1. Read the change request.
2. Identify key concepts: changed APIs, functions, modules, behaviors.
3. Search the normalized graph for nodes whose `name`, `path`, or `summary` match.
4. Classify each matched node as directly or indirectly affected.

### Step 2: Identify direct impact

Direct impact = nodes that must be modified, added, or removed to satisfy the change request.

For each directly affected node, record:
- Component ID
- File path
- Symbol name
- Reason for impact
- Confidence: High / Medium / Low

### Step 3: Identify indirect impact

Indirect impact = nodes that import, call, extend, test, or document a directly affected node.

Walk the graph one or two hops from each directly affected node.
Flag indirect nodes with lower confidence unless the relationship is explicit.

### Step 4: Identify regression test candidates

For each affected node:
- Find test nodes connected by `tests` or `covers` edges.
- Find test files that import or reference the affected file path.
- Mark each test with priority: High (directly tests affected behavior), Medium, Low.

### Step 5: Generate risk assessment

For each risk identified:
- Assign Risk ID, description, severity (High/Medium/Low).
- Propose a mitigation.
- Specify a verification approach.

### Step 6: Record confidence and assumptions

- State overall confidence: High/Medium/Low.
- List assumptions made during impact analysis.
- Flag low-confidence nodes explicitly.

---

## Output template: impact_map.md

See `integrations/understand-anything/examples/impact_analysis_example.md`.

---

## Output schema: affected_components.json

```json
[
  {
    "component_id": "<node id>",
    "path": "<file path>",
    "symbol": "<function or class name, or null>",
    "impact_type": "modify|add|remove|review|test-only|doc-only",
    "reason": "<why this component is affected>",
    "confidence": "high|medium|low"
  }
]
```

---

## Anti-patterns to avoid

- Do not include the entire graph in the impact map. Focus on the change.
- Do not generate implementation code.
- Do not mark files as affected just because they are large or important.
- Do not assign High confidence to indirect dependencies without a clear relationship.
- Do not skip the risk assessment step for `L3`/`L4` changes.

Inherited obligations: apply `agile-v-core` halt, decision-log, and applicable typed-lineage rules; if AI materially influences these outputs at any risk level, create/update `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

---

## Gate 1 evidence contribution

The impact map informs Human Gate 1 but does not redefine it. Gate 1 reviews the persisted requirement revision plus independent findings; this supporting evidence must be reviewed where applicable:

- Impact map reviewed and accepted.
- Interface contract reviewed.
- Regression-test plan accepted.

---

## Compatible tools

Claude Code, Cursor, Copilot, Codex, Gemini CLI, OpenCode, Cline.
