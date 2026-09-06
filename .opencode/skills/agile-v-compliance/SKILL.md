---
name: agile-v-compliance
description: Risk management, CAPA protocol, human gate approval records, AI agent security controls, and periodic revalidation. Load when running gates, handling CAPAs, or auditing compliance and security posture.
license: CC-BY-SA-4.0
metadata:
  version: "1.6"
  standard: "Agile V"
  compliance: "ISO 9001 6.1, ISO 13485 8.5, ISO 27001 A.5.23/A.8.3, 21 CFR Part 11, GxP/GAMP 5"
  author: agile-v.org
  sections_index: ["Risk Management", "CAPA Protocol", "Human Gate Approval Records", "AI Agent Security Controls", "Periodic Review & Revalidation", "Qualification Deviations and Requalification"]
---

# Instructions

Compliance protocols for Agile V. Requires **agile-v-core** loaded first.

## Risk Management (ISO 9001 6.1 / AS9100D 8.1.1)

Append-only, cycle-tagged register in `.agile-v/RISK_REGISTER.md`: `RISK-ID | Cycle | Level(L0-L4) | Category | Description | Likelihood | Impact | Controls | Residual Decision | Owner | Status`. Apply `docs/agile-v-runtime/04_RISK_CLASSIFICATION.md`; legacy `R0-R3` maps only as documented there.

**Categories:** Technical, Process, Compliance, Security. **Severity matrix:** High x High = Critical, High x Med = High, High x Low / Med x Med = Medium, rest = Low. Critical risks require Human resolution or documented acceptance before Gate 2.

**When:** draft persisted = Req Architect identifies; independent findings = Logic Gatekeeper flags constraints; Stage 4 = Red Team finds residual; cycle boundary = Compliance Auditor reviews. Baselining requires Gate 1 approval and no unresolved mandatory finding.

## CAPA Protocol (ISO 13485 8.5 / ISO 9001 10.1-10.2)

**Triggers:** CRITICAL finding, recurring NC across cycles, regression FAIL with no CR, 3-attempt escalation.

Record in `.agile-v/CAPA_LOG.md`: `CAPA-XXXX` with Cycle, Trigger, Nonconformity, Root Cause (5-Whys), Corrective Action, Preventive Action, Effectiveness Verification, Status (open -> corrective-complete -> preventive-complete -> verified-effective -> closed), Owner.

**Workflow:** Detect -> Record -> Analyze -> Correct -> Prevent -> Verify effectiveness. Compliance Auditor tracks open CAPAs at Gate 2, flags overdue (>2 cycles).

## Human Gate Approval Records (21 CFR Part 11 / Annex 11)

Append-only in `.agile-v/APPROVALS.md`: `GATE-XXXX` with Gate type, Cycle, Scope, Decision (Approved/Conditional/Rejected), Conditions, Approver (full name), Role/Authority, Timestamp (ISO 8601), Signature Method, Evidence Reference (commit hash). **Durable HITL (Phase 2):** when closing a pending interrupt, include `resume_token=[value]` and `INTERRUPT-ID=[INT-XXXX]` matching `.agile-v/CHECKPOINTS.md`; Compliance Auditor verifies token pairing on Gate 2.

**Rules:** Name + role required (not just "Human"). Authority from matrix in config.json. Rejected = pipeline halts.

**Checkpoint SLA:** If `CHECKPOINTS.md` shows `due_at` passed with `PENDING`, escalate per project policy; append `ESCALATED` or `EXPIRED` row before forcing resume.

| Regulatory Context | Minimum Signature |
|---|---|
| Non-regulated | APPROVALS.md entry with name + timestamp |
| ISO 9001/27001 | + Git commit attribution |
| GxP / 21 CFR Part 11 | + Signed commit + authority verification |
| ISO 13485 | + Digital signature + authority matrix + retention |

## AI Agent Security Controls (ISO 27001 A.5.23 / A.8.3)

**LLM Provider Registry** in config.json: per provider record name, models, data_residency, retention, api_data_usage, approved_for classifications, review_date. Verify input classification vs provider approval before sending. Never send credentials/patient data unless provider approved. Least privilege per agent. Context sanitization on session end.

**File Integrity:** Git-tracked = verify clean status. Store hashes in STATE.md at Gates; verify before next stage. Flag unverifiable files to Human.

## Periodic Review & Revalidation (GxP / GAMP 5)

**Triggers:** LLM model change, runtime/platform major update, skill file change, >5 CRs since last revalidation, 12-month interval.

Record in `.agile-v/REVALIDATION_LOG.md`: `REVAL-XXXX` with Date, Trigger, Scope, Results, Decision, Reviewer. Regression failure = new cycle trigger.

**Model Tracking** in config.json: model_versions with tier IDs + last_validated + validated_by. Any change triggers revalidation.

## Qualification Deviations and Requalification (GxP / GAMP 5)

For GxP computerized-system qualification, DQ/IQ/OQ/PQ are evidence stages, not agent names; see `agile-v-gxp-qualification`. `red-team-verifier` owns OQ execution; `validation-agent` owns any PQ/intended-use mapping.

| Concern | Record / Action |
|---|---|
| Qualification deviations | Record `QDEV-XXXX` in `.agile-v/QUALIFICATION_DEVIATIONS.md`: Stage (IQ/OQ/PQ), Description, Impact, Disposition, Approver, linked `RISK-XXXX`/`CAPA-XXXX`. Open critical deviation blocks stage release. |
| Stage release | Release an IQ/OQ/PQ stage only when its evidence is complete, deviations are dispositioned, and required Human Gate approval is recorded in `APPROVALS.md`. |
| Requalification assessment | On qualification-relevant change, assess scope of requalification (which stages must be re-executed) and record the decision and rationale in `REVALIDATION_LOG.md`. |
| Periodic-review triggers | Trigger requalification review on the Periodic Review triggers above plus: qualified-baseline change, infrastructure/environment change, or a critical qualification deviation. |

Qualification deviation handling reuses the CAPA and Periodic Review workflows above: a rejected pipeline halts, and stage/gate records remain consistent with matching agile v checkpoints md.
