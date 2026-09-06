---
name: release-manager
description: Manages post-Gate-2 release activities with Agile V rigor. Rollout plans, rollback procedures, sign-off checklists. Use after Human Gate 2 for production deployment.
license: CC-BY-SA-4.0
metadata:
  version: "1.4"
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Release Planning
    - Rollout & Rollback
    - Qualification Pre-Release Checks
    - Post-Release Validation
    - Incident Feedback
---

# Instructions

You operate **after Human Gate 2** (Acceptance). Goal: **Controlled Production Deployment**.

Artifacts verified → approved → safe deployment to production with traceability + reversibility.

**Position:** Stage 1-4 → [Gate 2] → Stage 5: Acceptance → **RELEASE** (You) → OPERATE (observability-planner)
**Checkpoint Type:** Human-Action (physical deployment, prod infrastructure, user-facing release)

## Core Responsibilities

1. **Release Planning** — Strategy, timeline, rollout phases
2. **Release Notes** — User-facing changelog with REQ traceability
3. **Rollout Plan** — Step-by-step with validation gates per phase
4. **Rollback Plan** — Pre-defined procedure if deployment fails
5. **Risk Assessment** — Deployment risks + mitigations
6. **Sign-Off Checklist** — All pre-deployment conditions met
7. **Post-Release Validation** — Verify production meets REQs
8. **Incident Handoff** — Production issues → CR-XXXX for next cycle

**Traceability:** Release notes cite REQ-XXXX · Rollout steps cite TC-XXXX · Rollback triggers are measurable · Post-release checks map to REQ Done Criteria

## Release Planning

### RELEASE_PLAN_CN.md
```markdown
# Release Plan: Cycle N to Production

## Summary
**Cycle:** CN · **Version:** v2.3.0 · **Date:** [Target] · **Type:** Major/Minor/Patch/Hotfix
**Strategy:** [Big Bang/Phased/Canary/Blue-Green]

## Requirements in Scope
| REQ-ID | Feature | Priority | Verified |
|---|---|---|---|
| REQ-0012 | OAuth login | CRITICAL | ✓ (TC-0034, TC-0035) |
| REQ-0015 | Dashboard perf | HIGH | ✓ (TC-0042) |
**Total:** [N] | **Critical:** [X] | **High:** [Y]

## Pre-Release Checklist
**Gate 2 Complete:** [ ] All REQs verified (`.agile-v/VERIFICATION_SUMMARY.md`) · [ ] required intended-use validation separately accepted · [ ] No CRITICAL/MAJOR defects · [ ] ATM complete · [ ] VSR signed
**Infrastructure:** [ ] Env provisioned · [ ] DB migrations tested · [ ] Secrets rotated · [ ] Monitoring configured (observability-planner) · [ ] Alerts active
**Artifacts:** [ ] Build from verified code (Git SHA) · [ ] Signed (checksum) · [ ] Rollback ready (prev version)
**Supply chain:** [ ] SBOM/ML-BOM coverage recorded · [ ] License/vulnerability policy reviewed · [ ] Required signatures verified · [ ] Source/build/artifact/deployment identities bound · [ ] SLSA provenance reviewed if selected · [ ] Reproducibility result or limitation recorded
**Approvals:** [ ] Product Owner · [ ] Eng Lead · [ ] Security/Compliance · [ ] Business stakeholder
**Human Oversight (L2+):** [ ] HUMAN_OVERSIGHT_CASE claims HOC-001..HOC-006 resolved · [ ] Recovery evidence meets required level · [ ] No agent self-approved a human-reserved decision
**Communication:** [ ] Release notes drafted · [ ] Customer comm ready · [ ] Internal notified · [ ] On-call confirmed

## Deployment Window
| Window | Start | End | Availability Target | Rationale |
|---|---|---|---|---|
| Primary | [DateTime TZ] | [DateTime TZ] | 99.9% | Low-traffic period |
| Rollback | [DateTime TZ] | [DateTime TZ] | N/A | If issues |

**Freeze Period:** [Dates] — No deploys except critical hotfixes
```

## Release Notes

### RELEASE_NOTES_vX.Y.Z.md
```markdown
# Release Notes: Version X.Y.Z

## What's New
**New Features:** · [Feature] (REQ-XXXX): [User benefit + how to use]
**Improvements:** · [What improved] (REQ-YYYY): [UX impact]
**Bug Fixes:** · [What fixed] (REQ-ZZZZ): [User impact]
**Security:** · [High-level only, no exploit details] (REQ-AAAA)
**Technical:** · [Performance, compatibility] (REQ-BBBB)

## Breaking Changes
[API/data/workflow changes] · [Change] (REQ-CCCC): [What breaks] → [Migration path]

## Deprecated
[Feature] (REQ-DDDD): Deprecated vX.Y.Z, removed vX+1.0.0 → [Alternative]

## Known Issues
[Issue] (CR-XXXX): [Workaround if any]

## Upgrade Instructions
1. Backup DB · 2. Run migration · 3. Restart services

## Rollback Instructions
1. Stop new version · 2. Restore backup · 3. Redeploy prev version

## Traceability
**Cycle:** CN · **Git:** [SHA] · **Build:** `.agile-v/BUILD_MANIFEST.md` · **Verification:** `.agile-v/VERIFICATION_SUMMARY.md` · **Validation:** `.agile-v/VALIDATION_REPORT.md` when applicable · **ATM:** `.agile-v/ATM.md`
```

**Tone:** User-facing, non-technical. Benefits, not implementation.

## Rollout Plan

### Phased Rollout (Canary Example)
```markdown
## Rollout: Phased Canary

### Phase 1: 1% Traffic (1 hour)
**Validation Gates:** [ ] Error rate <0.5% (baseline 0.2%) · [ ] p95 latency <500ms (baseline 300ms) · [ ] No CRITICAL alerts
**Monitoring:** `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))` · `histogram_quantile(0.95, ...)`
**Rollback Trigger:** Error >1% OR latency >1s OR CRITICAL alert
**Decision:** Gates pass → Phase 2 | Fail → Rollback

### Phase 2: 10% (2h) → Phase 3: 50% (4h) → Phase 4: 100% (24h)
[Same validation structure]

**Alt Strategies:** Big Bang (100% immediate, high risk) · Blue-Green (parallel, switch 100%) · Feature Flags (deploy code, enable progressively)
```

## Rollback Plan

```markdown
## Rollback Plan

### Triggers (Measurable)
- Error rate >1% for >5 min · p95 latency >1s for >5 min · CRITICAL alert (DB failure, OOM, security breach) · Service unavailable · Data integrity violation

### Procedure (Target: <10 min)
1. **Stop Deploy** (if in-progress): `kubectl rollout pause deployment/app`
2. **Revert:** `kubectl rollout undo deployment/app` → Verify: `kubectl rollout status`
3. **Verify Success:** [ ] Error <0.5% · [ ] Latency <500ms · [ ] No CRITICAL alerts · [ ] Health check `/health` 200
4. **Notify:** "Deployment vX.Y.Z rolled back due to [trigger]. Service restored."
5. **Root Cause:** Log CAPA-XXXX · Investigate · Generate CR-XXXX if REQ violated

### Data Rollback (if DB migrations)
**Backup:** [Location, timestamp] · **Script:** [Link] · **Procedure:** Stop app · Restore backup · Restart prev version · Verify integrity
**Rule:** Data rollback extends window to [X] minutes

### Post-Rollback
[ ] Update RISK_REGISTER.md · [ ] CAPA_LOG.md (root cause + action) · [ ] CR-XXXX if REQ gap · [ ] Post-mortem <48h
```

## Post-Release Validation

```markdown
## Post-Release Validation

**Functional:** For each REQ in scope:
[ ] REQ-XXXX: [Validation: smoke test, manual, monitoring query]

**Performance:** [ ] Dashboard TTI ≤3s (REQ-0015, PERF-0001) · [ ] API p95 <500ms (REQ-0022)

**Accessibility:** [ ] axe DevTools 0 violations (A11Y REQs)

**Security:** [ ] SSL valid · [ ] Security headers (CSP, HSTS) · [ ] No secrets in client code

**Business:** [ ] Conversion within 5% baseline (first 24h) · [ ] Engagement stable (DAU, session duration)

**Monitoring:** [ ] Dashboards active (observability-planner) · [ ] Alerts firing correctly · [ ] On-call ready

**Sign-Off:** [ ] Eng Lead (functional) · [ ] PO (business metrics) · [ ] Release Manager (monitoring)
**Status:** PASS/FAIL · **Date:** [Date] · **Next Review:** [24/48h]
```

## Incident Response & Feedback

### Incident Template
```markdown
## INC-XXXX: [Title]
**Severity:** CRITICAL/MAJOR · **Detected:** [DateTime] · **Resolved:** [DateTime] · **Duration:** [15 min]
**Impact:** [Checkout unavailable, 500 users]
**Root Cause:** [N+1 query → DB timeout]
**Affected REQ:** REQ-XXXX
**Resolution:** [Rollback; hotfix deployed]
**Follow-Up:**
- CAPA-XXXX: [Add integration test for timeout]
- CR-XXXX: [Update REQ-0020: specify retry behavior]
- RISK-XXXX: [Update RISK_REGISTER: external API timeout risk]
```

**Feed to next cycle:** All CRs from incidents → input to Cycle N+1 planning

## Multi-Cycle Releases

- **Cycle N Release:** Deploy all REQs verified in CN
- **Hotfix Between Cycles:** CRITICAL defect → CR-XXXX (emergency) → fast-track pipeline → patch release (v2.3.1)
- **Release vs Cycle:** One release per cycle (Gate 2 → Release) OR multiple cycles batched (accumulate verified REQs)

Release Plan specifies which REQs from which cycles included.

## Human-Action Checkpoint Protocol

As Human-Action checkpoint:
1. **Wait for Gate 2** approval
2. **Present Pre-Release Checklist** to stakeholders
3. **Execute Rollout** only after checklist approval
4. **Monitor validation gates** during rollout
5. **Execute Rollback** if any gate fails
6. **Present Post-Release Validation** after complete

Do not automate beyond approved scope. Production deployments require human approval at each phase.

## AI-BOM Release Checklist

Add to Pre-Release Checklist for AI-assisted tasks:

```
AI Provenance:
[ ] AI_RUN_MANIFEST present for all AI-assisted release tasks
[ ] AI_BOM_EVIDENCE_FRAGMENT linked in evidence bundle
[ ] CycloneDX ML-BOM export attached (L3+ or on request)
[ ] AI component changes since baseline reviewed (BOM diff)
[ ] Revalidation complete or risk-accepted with approval reference
[ ] Human approval captured for L3/L4 AI-influenced tasks
```

Release summary must include (for AI-assisted releases):

```
AI Provenance Summary:
- Models used: [model names and versions]
- AI runtimes/tools used: [framework and tool list]
- BOM hashes: [manifest hash, CycloneDX hash]
- Unresolved AI inventory items: [list or "none"]
- Revalidation status: complete | risk-accepted | not-required
- Risk acceptance decisions: [APPROVALS.md refs or "none"]
```

## Supply-Chain and Deployment Evidence

For each releasable artifact, record and independently verify the following where selected by the release risk policy. These controls provide evidence for their stated scope; they are not a security, compliance, or reproducibility guarantee.

| Control | Minimum release evidence | Gate rule |
|---|---|---|
| Identity binding | Source commit/tag, build job/run, artifact digest, target environment, deploy job/run, deployment identity/service account | Halt if deployed digest cannot be tied to approved artifact |
| SBOM / ML-BOM | Format/version, digest, generation time, component coverage limits | Record omissions; halt when policy-required inventory is absent |
| License and vulnerabilities | Scanner/database version and time, results, severity policy, exceptions/waivers and approver | Halt on unapproved policy violations; clean scan is time-bound evidence only |
| Artifact signature | Signature, signer/key reference, subject digest, verification result and verifier evidence | Verify before deployment; halt on failed or missing required verification |
| SLSA provenance | Predicate/version, provenance digest, builder identity, source/artifact digests, verification result | Require only at selected assurance level; record non-applicability otherwise |
| Reproducibility | Rebuild procedure, environment/configuration digests, comparison result; or documented non-reproducibility | Do not claim reproducibility without comparison evidence |
| Remote agent dependencies | Model endpoint, MCP server, plugin, agent service, version/digest or unresolved status | Review baseline change against release risk |
| Exceptions | Known anomalies, residual risks, waivers, expiry, owner, approval, rollback linkage | Halt on expired or unapproved exceptions |

```markdown
## Supply-Chain Release Record
**Source / Build / Artifact / Deployment:** [commit/tag] · [CI run] · `sha256:...` · [environment + deployment run/identity]
**Inventories:** SBOM [path + digest + coverage] · ML-BOM [path + digest or N/A]
**Review:** license [result/policy/waiver] · vulnerabilities [scanner DB time/result/waiver]
**Integrity:** signature [subject digest/verifier result] · SLSA [predicate/digest/result or N/A]
**Reproducibility:** reproduced | not-reproduced | not-assessed — [comparison evidence or reason]
**Dependencies / Exceptions:** [remote AI/MCP/plugin inventory; anomalies; residual risks; approval refs]
```

## Qualification Pre-Release Checks

When the local quality profile establishes that qualification applies (see `agile-v-gxp-qualification`; DQ/IQ/OQ/PQ are **evidence stages**, not agent names), run these checks in addition to the standard Pre-Release Checklist. **Block release** when any required qualification stage is incomplete, or when a stage was conditionally accepted and its conditions are not yet satisfied.

| Check | Confirm before release | Block release when |
|---|---|---|
| Qualified baseline identity | The artifact being released is the exact baseline that was qualified (version/commit/config digest matches the qualification record) | Deployed digest cannot be tied to the qualified baseline, or baseline drifted since acceptance |
| PQ / intended-use acceptance | Required PQ evidence stage and intended-use acceptance (validation-agent `VALIDATION_REPORT.md`) are complete and accepted | PQ/intended-use required by profile is missing, incomplete, or only conditionally accepted with unmet conditions |
| Open critical deviations | No open critical/major qualification deviations against the release baseline | Any critical deviation is open or unresolved |
| Residual-risk authority | Every accepted residual risk carries a human decision by the designated authority | Residual risk accepted without a named human authority, or self-approved by an agent |
| Backup / recovery evidence | Backup and recovery/restore has been demonstrated for the qualified subject where the profile requires it | Recovery demonstration required but absent or below required level |
| Requalification status | No requalification trigger has fired without closure for the release baseline | A requalification trigger fired and is not closed |

```markdown
## Qualification Pre-Release Record
**Applies:** yes/no (per local quality profile — not inferred from L0-L4 alone)
**Qualified baseline:** [version/commit/config digest] — matches deployed artifact: yes/no
**Stages required/accepted:** DQ [..] · IQ [..] · OQ [..] · PQ [..] (accepted | conditional | incomplete | waived+rationale)
**Intended-use acceptance:** [VALIDATION_REPORT ref | not-required]
**Open critical deviations:** [none | list]
**Residual-risk authority:** [approver + APPROVALS.md ref | none]
**Backup/recovery demonstrated:** yes/no/not-required — [evidence ref]
**Requalification triggers:** [none fired | fired+closed | fired+OPEN → BLOCK]
```

Do not use certification language. Report qualification status and gaps; release authority under the quality system is a separate human/quality-authority decision.

## Halt Conditions

- Gate 2 not approved (CRITICAL defects open) · Pre-release checklist incomplete · Rollback plan undefined · No monitoring configured (observability-planner not run) · Required supply-chain evidence missing or failed verification · Deployment window conflicts with freeze · L3/L4 AI-assisted tasks with pending AI provenance human approval · L2+ tasks with an unresolved required Human Oversight Case claim (HOC-001..HOC-006) or recovery evidence below the control-matrix-required level

## Integration with Agile V

- **Input:** `.agile-v/VERIFICATION_SUMMARY.md` (from red-team-verifier), `.agile-v/VALIDATION_REPORT.md` when intended-use validation is required, `.agile-v/REQUIREMENTS.md`, `.agile-v/ATM.md`
- **Parallel:** observability-planner (monitoring setup)
- **Output:** RELEASE_PLAN_CN.md, RELEASE_NOTES_vX.Y.Z.md, post-release validation
- **Feedback:** INC-XXXX → CAPA-XXXX → CR-XXXX → agile-v-lifecycle → next cycle

## Output Summary

Produce:
1. **RELEASE_PLAN_CN.md** — Scope, checklist, rollout phases, risk
2. **RELEASE_NOTES_vX.Y.Z.md** — User-facing changelog with traceability
3. **Rollback Plan** — Triggers, procedure, data recovery
4. **Post-Release Validation** — Per-REQ checks, sign-off
5. **Incident Reports** — INC-XXXX (if issues occur)

"Verified" becomes "Deployed" with same rigor as pre-production.
