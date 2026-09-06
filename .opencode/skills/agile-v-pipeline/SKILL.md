---
name: agile-v-pipeline
description: Orchestration pipeline, wave execution, handoff protocols, and checkpoint types for the Agile V 5-stage workflow. Load when orchestrating multi-agent pipelines or managing stage transitions.
license: CC-BY-SA-4.0
metadata:
  version: "1.6"
  standard: "Agile V"
  author: agile-v.org
  sections_index: ["Pipeline", "Handoffs", "Wave Execution", "Checkpoint Types"]
  adapted_from:
    - name: "Get Shit Done (GSD)"
      url: "https://github.com/gsd-build/get-shit-done"
      license: "MIT"
      copyright: "Copyright (c) 2025 Lex Christopherson"
      sections: "Orchestration Pipeline"
---

# Instructions

Orchestration pipeline for Agile V. Requires **agile-v-core** loaded first.

## Pipeline

```
Stage 1: draft_persisted -> Stage 2: independent_findings -> Stage 1: architect_revisions -> gate_1 -> approved -> baselined -> Stage 3: Synthesis (Build Agent || Test Designer) -> Stage 4: Verification -> [Human Gate 2] -> Stage 5: Acceptance
Compliance Auditor observes all stages.
```

## Handoffs

1. Req Architect persists draft `.agile-v/REQUIREMENTS.md` -> Logic Gatekeeper reads without editing.
2. Gatekeeper records independent findings -> Req Architect revises -> Gate 1 (findings + revision evidence, Human approves).
3. Approval creates a baseline; Build Agent || Test Designer use only that baselined revision, with no shared context.
4. Build Manifest + Test Cases -> Red Team Verifier.
5. Verification Summary -> Gate 2; intended-use validation evidence, when required, remains separate.

**Gate 2 prereqs (Phase 1):** `.agile-v/EVAL_RESULTS.md` + `.agile-v/VERIFICATION_SUMMARY.md` **EvalGate** line. **Gate pause (Phase 2):** append `.agile-v/CHECKPOINTS.md` (`PENDING` + `resume_token`); resume only with matching `.agile-v/APPROVALS.md` entry (see `agile-v-core`).

## Stage Failure Handling

If a stage fails (e.g., Logic Gatekeeper rejects requirements, Red Team finds CRITICAL issues), the pipeline **stops at that stage**. Do not proceed to the next stage.

| Failure | Action |
|---------|--------|
| Gate 1 rejected | Return to architect revisions; preserve rejected revision and findings |
| Build Agent HALT | Human resolves blocker; Build Agent resumes; do not skip to Stage 4 |
| Red Team FAIL | Return to Stage 3; Builder addresses findings; re-verify affected only |
| Gate 2 blocked | Do not proceed to Stage 5; resolve EVAL gate or get WAIVED approval |

Never advance to Stage 5 with open CRITICAL or MAJOR findings.

## Wave Execution

Dependency analysis -> Wave assignment (no-deps = Wave 1) -> Parallel within waves (fresh context each) -> Sequential across waves -> Prefer vertical slices (feature > layer).

## Checkpoint Types


| Type           | Action                 |
| -------------- | ---------------------- |
| Auto           | Proceed                |
| Human-Verify   | Confirm output         |
| Human-Decision | Choose alternative     |
| Human-Action   | Physical/external step |


All except Auto require Human Gate protocol.
