# AI BOM Diff Report

> Doc ID: AIBOM-DIFF-0003 | Task: AAV-0117 | Risk Level: L2 | Date: 2026-07-14

## Summary

Model version changed from `20260601` to `20261001` between the baseline and current run.
Revalidation of affected test artifacts is recommended for L2.

| Field | Baseline Run | Current Run | Change Type | Risk |
|-------|-------------|-------------|-------------|------|
| model_version | 20260601 | 20261001 | updated | medium |
| agent_framework | OpenHands 0.37.0 | OpenHands 0.38.0 | updated | low |
| sandbox_image_digest | sha256:old... | sha256:a1b2... | updated | low |

## Baseline

- Manifest: `.agile-v/aibom/AAV-0117/baseline/AI_RUN_MANIFEST.yaml`
- Manifest hash: `sha256:000aaa...`
- Run ID: `RUN-0035`
- Date: `2026-07-01T09:00:00Z`

## Current

- Manifest: `.agile-v/aibom/AAV-0117/AI_RUN_MANIFEST.yaml`
- Manifest hash: `sha256:a1b2c3...`
- Run ID: `RUN-0042`
- Date: `2026-07-14T14:23:00Z`

## Changed Components

| Component | Field | Baseline Value | Current Value | Confidence (baseline) | Confidence (current) |
|-----------|-------|---------------|---------------|----------------------|----------------------|
| claude-sonnet-4 | model_version | 20260601 | 20261001 | declared | declared |
| OpenHands | framework_version | 0.37.0 | 0.38.0 | verified | verified |
| runtime sandbox | sandbox_image_digest | sha256:old... | sha256:a1b2... | verified | verified |

## Revalidation Assessment

| Risk Level | Revalidation Required | Reason |
|------------|----------------------|--------|
| L2 | yes | Model version changed; re-run affected test cases TC-0081, TC-0082 |

**Revalidation required:** yes

**Rationale:** Model version change (`20260601` → `20261001`) triggers revalidation for L2 per `AI_BOM_POLICY.yaml`. Scope limited to authentication-related test cases.

**Approver (if risk-accepted):** N/A — revalidation planned

## Verifier Notes

Red-team-verifier reviewed BOM diff. No other material changes detected. Sandbox image update is routine patch, low risk.

## Human Approval

- [x] Reviewed — revalidation planned
- **Approver:** Jane Smith (Tech Lead)
- **Date:** 2026-07-14
- **APPROVALS.md ref:** GATE-0088
