---
name: observability-planner
description: Defines metrics, events, dashboards, alerts, and SLOs to monitor production systems. Use after Gate 2 or with release-manager to ensure production observability.
license: CC-BY-SA-4.0
metadata:
  version: "1.2"
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Metrics, Events & Trace Context
    - Dashboards & Alerts
    - SLOs & Error Budgets
    - Incident Feedback Loop
---

# Instructions

**Inherited contract:** Load `agile-v-core`; observability artifacts use applicable typed lineage and append decision rationale. Synthesis references require a baselined `REQ-XXXX` revision/baseline; material AI influence at any risk level requires `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

You operate **after Gate 2** (or parallel with release-manager). Goal: **Production Intelligence**.

Requirements are continuously validated in production. Every metric maps to REQ-XXXX. Incidents feed CR-XXXX for next cycle.

**Position:** Stage 5 (Acceptance) → RELEASE → **OPERATE** (You)
**Checkpoint Type:** Auto (monitoring) + Human-Verify (thresholds) + Human-Action (incidents)

## Core Responsibilities

1. **Metrics** — What to measure to validate REQs in production (MET-XXXX)
2. **Events** — Application logs, traces, structured events
3. **Dashboards** — Real-time system health + per-REQ validation
4. **Alerts** — Thresholds that trigger on REQ violations (ALR-XXXX)
5. **SLOs** — Service-level objectives + error budgets (SLO-XXXX)
6. **Incidents** — Detection + investigation triggers (INC-XXXX)
7. **Feedback Loop** — Production anomalies → CR-XXXX

**Rule:** Every metric must cite REQ-XXXX. No REQ = debugging metric (not a requirement) OR missing requirement (return to requirement-architect).

## Metrics & Events

### OBSERVABILITY_PLAN.md
```markdown
# Observability Plan

## MET-XXXX: [Metric Name]
**Type:** Counter/Gauge/Histogram · **REQ:** REQ-XXXX · **Description:** [What measured]
**Unit:** req/s, ms, bytes, % · **Labels:** [bounded endpoint template, status class, region] · **Source:** [app middleware, DB driver, business logic]
**Baseline:** [Normal range: p50=150ms, p95=300ms] · **Threshold:** [p95 >500ms for 5 min → Alert]
**Collection:** [Prometheus, CloudWatch, Datadog] · **Cardinality Budget:** [labels/value limits] · **Retention:** [90 days]

## Event Schema (Structured Logs)
{
  "timestamp": "ISO8601", "level": "ERROR", "event": "checkout_failure",
  "req_id": "REQ-XXXX", "trace_id": "...", "span_id": "...",
  "error_code": "PAYMENT_TIMEOUT", "context": {...}
}
```

### Trace Context, Telemetry Safety, and Versioning

Use W3C Trace Context (`traceparent`, `tracestate`) for inbound, outbound, and asynchronous handoffs. Preserve the parent relationship where possible; otherwise create a span link and record the handoff reason. Pin the OpenTelemetry SDK/distribution and applicable OpenTelemetry semantic-convention version in `OBSERVABILITY_PLAN.md`; do not mix convention versions without a documented migration.

For agent or AI-assisted operations, record only bounded, redacted attributes: `trace_id`, `span_id`, parent/link, task/REQ/ART/approval/run IDs, agent/runtime/model/tool/server version, operation/protocol, start/end/status/error/retries, token/latency/cost totals, policy/authorization outcome, schema digest, and redacted evidence locator. Do not capture prompt or completion bodies, secrets, credentials, raw personal data, or unbounded request identifiers by default.

| Telemetry control | Plan must state |
|---|---|
| Redaction and access | Data classification, redaction before export, access roles, audit path |
| Cardinality | Approved dimensions and per-metric budget; never use user IDs, request IDs, prompt text, or arbitrary URLs as metric labels |
| Sampling | Head/tail rules, error/slow-trace retention, bias/coverage limits, correlation preservation |
| Retention | Logs, metrics, traces, evidence retention periods plus deletion/hold policy |
| Cost and failure handling | Volume/cost budget; exporter failure behavior that does not expose data or break service |

**Common Metrics (examples):**
- MET-0001: HTTP latency (Histogram, REQ-0015: Dashboard ≤3s) → p95 threshold 3s
- MET-0002: Error rate (Counter, REQ-0020: API reliability) → 5xx rate threshold 1%
- MET-0003: DB query duration (Histogram, REQ-0018: Query <100ms) → p95 threshold 100ms
- MET-0004: Active sessions (Gauge, REQ-0012: User auth) → Capacity alert >5000
- MET-0005: Business conversion rate (Gauge, REQ-0025: Checkout) → Drop >10% WoW

## Dashboards

**Dashboard Categories:**
1. **System Health** — RED metrics (Rate, Errors, Duration)
2. **Requirement Validation** — Per-REQ panels (is each REQ satisfied in prod?)
3. **Business Metrics** — KPIs, conversion, engagement
4. **Incident Response** — Drill-down by trace, user, endpoint

**Example Panel (Requirement Validation Dashboard):**
```markdown
### Panel: REQ-0015 (Dashboard Load ≤3s)
**Metric:** MET-0001 · **Query:** `histogram_quantile(0.95, rate(http_duration_bucket{endpoint="/dashboard"}[5m]))`
**Threshold:** ≤3s · **Viz:** Time series, 24h · **Status:** Green <3s, Red ≥3s
```

## Alerts & Notifications

```markdown
## ALR-XXXX: [Alert Name]
**Metric:** MET-XXXX · **REQ:** REQ-XXXX · **Condition:** [PromQL or equivalent]
**Threshold:** [When to fire] · **Duration:** [5 minutes sustained] · **Severity:** CRITICAL/HIGH/MEDIUM/LOW
**Notification:** [PagerDuty, Slack, Email] · **Runbook:** [/runbooks/alert-name.md]
```

**Examples:**
- ALR-0001: High error rate (MET-0002, REQ-0020) → >1% for 5 min → CRITICAL → PagerDuty
- ALR-0002: Dashboard slow (MET-0001, REQ-0015) → p95 >3s for 5 min → HIGH → Slack
- ALR-0003: Conversion drop (MET-0005, REQ-0025) → >10% WoW for 1 day → HIGH → Email PO

**Alert Severity:**
| Severity | Impact | Response Time | Notification |
|---|---|---|---|
| CRITICAL | Service down, data loss, SLO violation | Immediate 24/7 | PagerDuty |
| HIGH | Degraded perf, REQ violation, user-facing | <1h business hours | Slack + Email |
| MEDIUM | Non-critical degradation, anomaly | <4h | Slack |
| LOW | Informational, capacity planning | Next day | Email digest |

## SLOs & Error Budgets

```markdown
## SLO-XXXX: [Service Level Objective]
**REQ:** REQ-XXXX · **Metric:** MET-XXXX · **Objective:** [99.9% requests succeed over 28 days]
**Measurement Window:** [Rolling 28 days] · **Error Budget:** [0.1% error rate = ~40 min downtime/month]
**Calculation:** `1 - (sum(errors[28d]) / sum(total[28d]))`
**Budget Policy:**
- 50% consumed: Alert engineering (informational)
- 75% consumed: Pause non-critical features, focus reliability
- 100% consumed: Stop feature work, incident declared, root cause required

**Burn-rate alerts:** Define both fast and slow windows for each critical SLO (for example, a high burn over 1h/5m and a lower sustained burn over 6h/30m), with thresholds derived from the error-budget policy, not copied as universal values. Each alert cites the SLO, window, budget fraction, runbook, and rollback/escalation decision.
```

**Examples:**
- SLO-0001: API availability 99.9% (REQ-0020) → Error budget 0.1% = 40 min/month
- SLO-0002: Dashboard p95 ≤3s, 95% of time (REQ-0015) → Budget 5% slow requests

## Incident Detection & Feedback Loop

### Synthetic Checks

For critical user journeys and externally visible dependencies, define synthetic checks with a bounded test account/data policy: journey/endpoint, region, cadence, timeout, success criteria, alert, ownership, and evidence retention. Run them before rollout and continuously after release. Synthetic success supplements, but does not replace, real-user and service telemetry.

### Incident Lifecycle
1. **Detection** — Alert fires (ALR-XXXX) → On-call notified
2. **Triage** — Follow runbook → Identify root cause
3. **Mitigation** — Execute runbook → Restore service
4. **Resolution** — Verify metrics baseline → Close
5. **Post-Mortem** — Root cause analysis → INC-XXXX, CAPA-XXXX, CR-XXXX
6. **Feedback** — CR-XXXX → next cycle (requirement-architect + logic-gatekeeper)

### Incident Record
```markdown
## INC-XXXX: [Title]
**Severity:** CRITICAL/HIGH · **Detected:** [Date/Time] (ALR-XXXX) · **Resolved:** [Date/Time] · **Duration:** [15 min]
**Impact:** [Checkout unavailable, 500 users affected]
**Root Cause:** [N+1 query caused DB timeout]
**REQ Violation:** REQ-0018 (Query <100ms) · **Why Missed:** [No query count test in TC-XXXX]
**Resolution:** [Rollback to prev version; fixed N+1 in hotfix]
**Follow-Up:**
- CAPA-XXXX: Add query count test (prevent recurrence)
- CR-XXXX: Update REQ-0018: specify max query count per request
- RISK-XXXX: Update RISK_REGISTER (DB scaling risk)
```

**Feed into CR-XXXX:** If incident reveals REQ gap or ambiguity → create CR → requirement-architect → Gate 1 approval → next cycle

**Monitoring-to-CAPA linkage:** Every actionable alert, SLO burn, or failed synthetic check that requires corrective action links its alert/check evidence to `INC-XXXX` (when incident criteria are met), `CAPA-XXXX` (cause, corrective/preventive action, owner, due date, effectiveness check), and `CR-XXXX` when a requirement or design change is needed. Close the alert action only after the CAPA effectiveness evidence is recorded; a resolved signal alone is not proof of prevention.

## Runbooks

For each alert, provide runbook (stored in project `/runbooks/`):
```markdown
# Runbook: High Error Rate (ALR-0001)
## Symptom: 5xx rate >1% for >5 min
## Impact: REQ-0020 violation, service degraded
## Triage: 1) Check dashboard · 2) Identify endpoints (topk query) · 3) Recent deploy? · 4) Upstream services? · 5) Check logs
## Mitigation: Rollback (if recent deploy) · Failover (if dependency down) · Scale DB (if overload)
## Resolution: Execute mitigation · Verify error rate <1% · Monitor 15 min · Notify stakeholders
## Post-Incident: Log INC-XXXX, CAPA-XXXX, CR-XXXX · Post-mortem 48h
```

## Handoff to Release Manager

Before rollout:
1. **Observability ready:** OBSERVABILITY_PLAN.md complete
2. **Dashboards live:** All panels showing data
3. **Alerts active:** Test notifications sent
4. **Runbooks written:** One per CRITICAL/HIGH alert
5. **On-call confirmed:** Engineer notified, has dashboard access

Release Manager includes in pre-release checklist: "Monitoring & Alerting configured (observability-planner sign-off)"

## Integration with Agile V Lifecycle

- **Pre-Release:** Define metrics/alerts (this skill)
- **During Release:** Release Manager monitors dashboards during phased rollout
- **Post-Release:** Monitor 24/7; incidents feed CAPA_LOG.md + CR-XXXX
- **Multi-Cycle:** Each cycle adds new REQs → new metrics → new alerts; OBSERVABILITY_PLAN.md versioned per cycle

## Halt Conditions

- Metric defined with no REQ-XXXX mapping · Alert has no runbook · SLO has no error budget policy or burn-rate treatment · Critical journey has no justified synthetic-check decision · Release planned with no monitoring configured · CRITICAL alert has no PagerDuty

## Output Summary

At any time, produce:
1. **OBSERVABILITY_PLAN.md** — MET-XXXX (metrics), ALR-XXXX (alerts), SLO-XXXX (objectives)
2. **Dashboards** — System Health, Requirement Validation, Business Metrics
3. **Runbooks** — `/runbooks/*.md` (per alert)
4. **Incident Reports** — INC-XXXX (post-incident analysis, CR-XXXX generation)

All stored in `.agile-v/` for traceability.
