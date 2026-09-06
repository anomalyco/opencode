---
name: agile-v-lifecycle
description: Multi-cycle iteration management, document versioning, change requests, re-entry points, archival, and impact analysis. Load when starting a new cycle (C2+), processing change requests, or managing cross-cycle traceability.
license: CC-BY-SA-4.0
metadata:
  version: "1.4"
  standard: "Agile V"
  author: agile-v.org
  sections_index: ["Cycle ID", "Document Versioning", "REQ Status Tags", "Change Requests", "Cycle Triggers", "Re-Entry Points", "Archival", "Impact Analysis"]
---

# Instructions

Multi-cycle lifecycle management for Agile V. Requires **agile-v-core** loaded first.

## Cycle ID

`C1`, `C2`, ... -- recorded in STATE.md, propagated to all artifact IDs.

## Document Versioning

| Document | Rule | Example |
|---|---|---|
| `.agile-v/REQUIREMENTS.md` | Revision header + per-REQ lifecycle state | `<!-- Revision: C2 -->` |
| BUILD_MANIFEST.md | ART-XXXX.N suffix | ART-0001.2 |
| TEST_SPEC.md | TC origin cycle | TC-0001 [C1] |
| `.agile-v/VERIFICATION_SUMMARY.md` | One per cycle; prior archived | `VERIFICATION_SUMMARY_C1.md` |
| DECISION_LOG.md | Cycle-tagged entries | [C2] DECISION: ... |
| ATM.md | Partitioned by cycle | See compliance-auditor |

## REQ Lifecycle States

Use canonical states `draft_persisted -> independent_findings -> architect_revisions -> gate_1 -> approved -> baselined`; changes create a new revision in `architect_revisions`, while retirement uses `retired`. Record cycle and change class (`new`, `modified`, `unchanged`) separately. Legacy values require the migration mapping in the canonical lifecycle contract.

## Change Requests

Append-only in `.agile-v/CHANGE_LOG.md`. Format: `CR-XXXX` with Cycle, affected `REQ-XXXX` revision/baseline, change, rationale, ART/TC impact, requester, and approval status. Flow: Requirement Architect creates a new draft revision -> Logic Gatekeeper records findings without editing -> Requirement Architect resolves findings -> Human decides at Gate 1 -> approved revision is captured in a new immutable baseline.

## Cycle Triggers

(1) New feature request. (2) Verification failure requiring REQ change. (3) Approved CR invalidating artifacts. (4) Scheduled iteration. All require Human decision.

## Re-Entry Points

| Trigger | Re-Entry | Scope |
|---|---|---|
| New feature | Stage 1 | Full pipeline new REQs; regression unchanged |
| REQ change from verification | Stage 1 | CR -> Gate 1 -> full affected; regression others |
| Bug fix (no REQ change) | Stage 3 | Build fixes; re-verify affected only |
| Scheduled | Stage 1 | Review all; full for changes; regression stable |

## Archival

On Gate 2 acceptance: snapshot living docs -> `.agile-v/cycles/CN/` (frozen). Never modify archives. DECISION_LOG and CHANGE_LOG never archived -- append-only timeline.

## Impact Analysis (per agent)

(1) Req Architect: tag REQs new/modified/deprecated/unchanged. (2) Logic Gatekeeper: re-validate new+modified only. (3) Build Agent: rebuild modified only; carry forward unchanged. (4) Test Designer: delta tests for new/modified; regression baseline for unchanged. (5) Red Team: execute delta + regression separately. (6) Compliance Auditor: cycle-tag ATM; flag unupdated links.
