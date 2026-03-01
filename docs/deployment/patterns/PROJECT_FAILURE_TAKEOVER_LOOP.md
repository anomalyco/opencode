# Pattern: Project-Failure Takeover Loop

Decision link: `DECISION_133`

## Trigger

Project runtime or delivery path is failing and ownership/control is unclear.

## Mandatory Sequence

1. Stabilize: freeze churn and capture current failure signals.
2. Diagnose: classify blocker by domain (`config`, `runtime`, `data-state`, `dependency`, `environment`).
3. Remediate: apply minimal deterministic fix for highest-priority blocker.
4. Verify: run direct commands/tests to confirm blocker reduction.
5. Harden: update workflow docs and reusable patterns to prevent recurrence.

## Control Notes Requirement

For each phase, publish operator-facing notes with:

- Current blocker
- Next deterministic action
- Evidence path

## Closure Rule

Do not close while control notes are missing or while failure state remains generic/unclassified.
