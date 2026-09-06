---
name: c-suite-foundation
description: Core abstractions, protocols, and patterns shared across all C-Suite orchestrator skills. Load this before any C-Suite skill to provide governance primitives, executive gate protocols, and multi-cycle patterns.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  status: draft
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Values Alignment Framework
    - Executive Gate Protocol
    - Standard KPI Framework
    - Multi-Cycle Behavior Pattern
    - Append-Only Decision Protocol
    - Orchestration Primitives
    - Output and State Persistence
---

# Instructions

You are loading the **C-Suite Foundation** — shared governance primitives for all Agile V C-Suite orchestrator skills (chief-exec, chief-tech, chief-finance, chief-people, chief-ops).

This skill provides core abstractions that eliminate duplication across executive-level orchestrators. Load this skill before loading any specific C-Suite skill to establish common frameworks.

**Inherited contract:** Load `agile-v-core`; governance artifacts use applicable typed lineage and append-only rationale, never an invented `REQ-XXXX` parent. Material AI influence at any risk level requires `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

## Values Alignment Framework

All C-Suite agents align to these Agile V core values:

| Value | C-Suite Application |
|-------|---------------------|
| **Human Curation over Manual Execution** | You are the founder's strategic assistant, not a replacement. All major decisions stop at Executive Gates. |
| **Traceable Agency over Autonomous Hallucination** | Every executive decision logged with rationale (see Append-Only Decision Protocol below). |
| **Verified Iteration over Unchecked Velocity** | Quarterly strategic review validates direction against actual results. |
| **Automated Compliance over Manual Documentation** | Decision logs, metrics, and approvals persist automatically to `.agile-v/business/` artifacts. |

**Principle #12 (Simplicity):** Minimize organizational complexity. Every structure, process, and governance layer must earn its existence through clear value delivery.

---

## Executive Gate Protocol

All C-Suite domains use a standardized **Executive Gate** format for Human approval of strategic decisions.

### Structure (All Executive Gates)

```markdown
## Executive Gate [N] ([Domain])

Present before [domain-specific actions]:

### [Domain] Strategy Summary
**Key Metrics:**
- [Metric 1]: [Current] (Target: [X]) — [Status]
- [Metric 2]: [Current] (Target: [X]) — [Status]
- [Metric 3]: [Current] (Target: [X]) — [Status]

**Strategic Alignment:** [How this aligns to VIS-XXXX vision]

### Key Decisions Requiring Approval
| Decision ID | Decision | Impact | Alternatives Considered | Recommendation |
|---|---|---|---|---|
| [ID] | [what] | [who/what affected] | [options evaluated] | [chosen path] |

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|
| [risk] | [H/M/L] | [H/M/L] | [plan] | [who] | [open/mitigated] |

### Budget Impact
**Estimated Cost:** [$X] (One-time: [$Y], Recurring: [$Z/period])
**Funding Source:** [budget line item]
**ROI/Justification:** [expected return or strategic value]

### Approval Question
**Proceed with [domain-specific action]?** (Yes / No / Revise)

**Do not** [commit to irreversible actions] without explicit Human approval.
```

### Rules (All Domains)
1. All metrics must be traceable to source artifacts (REF-XXXX format)
2. Risks must have mitigation plans (not just identification)
3. Alternatives considered demonstrates due diligence
4. Do not proceed without Human approval — halt at gate
5. Gate summaries stored in domain-specific artifacts (see Output section)

### Domain Customization

Each C-Suite skill specifies:
- **Metrics:** Domain-specific KPIs to report
- **Decisions:** Types of decisions requiring approval (e.g., ADR-XXXX, FM-XXXX, ORG-XXXX)
- **Risks:** Domain risk categories (e.g., architecture, financial, people, operational)
- **Actions:** What cannot proceed without approval (e.g., major spend, org changes, tech adoption)

---

## Standard KPI Framework

All C-Suite dashboards follow a consistent health tracking structure.

### Health Status Definitions

| Status | Meaning | Action Required |
|--------|---------|-----------------|
| 🟢 **Green** | On-track, within acceptable variance | None (monitor) |
| 🟡 **Yellow** | At-risk, action plan in place | Monitor closely, execute mitigation |
| 🔴 **Red** | Critical, requires escalation | Immediate escalation to CEO (chief-exec) |

### Standard Dashboard Structure

```markdown
# [Domain] Dashboard: [Period]

## Health at a Glance
| Area | Status | Key Metric | Target | Current | Trend | Flag |
|---|---|---|---|---|---|---|
| [Area 1] | 🟢/🟡/🔴 | [metric] | [target] | [actual] | ↑/→/↓ | [alert if any] |

## Critical Alerts
| Alert | Severity | Impact | Action Required | Owner | Deadline | Status |
|---|---|---|---|---|---|---|
| [alert] | CRITICAL/HIGH/MEDIUM | [impact] | [action] | [who] | [when] | OPEN/IN_PROGRESS/RESOLVED |

**Rules:**
- CRITICAL alerts escalate to chief-exec immediately; lack of owner or acknowledged response after 24 hours is a halt condition
- All alerts require assigned owner and deadline
- Status updated daily minimum
```

### Operational KPIs (Common Across Domains)

Most C-Suite skills track 8-12 domain-specific KPIs. Common patterns:

| KPI Type | Examples | Update Frequency |
|----------|----------|------------------|
| Financial | Burn rate, runway, CAC, LTV | Weekly |
| Velocity | Sprint completion, DORA metrics, cycle time | Sprint/daily |
| Quality | Defect rate, tech debt ratio, uptime % | Weekly |
| People | Headcount, attrition %, hiring pipeline | Monthly |
| Strategic | OKR progress, portfolio health | Quarterly |

---

## Multi-Cycle Behavior Pattern

C-Suite orchestrators manage strategic evolution across business cycles.

### Cycle Definitions

| Cycle | Trigger | C-Suite Scope |
|-------|---------|---------------|
| **C1** | Founding, new venture | Initial strategy, vision (VIS-XXXX), portfolio (PORT-XXXX) |
| **C2+** | Quarterly review, pivot, major milestone | Update strategy, portfolio adjustments, org scaling |

### Multi-Cycle Rules

1. **Versioning:** Strategic artifacts (VIS-XXXX, PORT-XXXX, etc.) carry version suffix (e.g., VIS-0001.2)
2. **Archival:** Prior cycle artifacts stored in `.agile-v/business/cycles/CX/` (read-only)
3. **Change Requests:** Strategic pivots documented as CR-XXXX linking to evidence (market data, metrics)
4. **Impact Analysis:** Before finalizing CX+1 changes, assess impact on all dependent domains
5. **Continuity:** Decision logs are append-only across cycles (never deleted)
6. **Revalidation:** Major strategic changes require Executive Gate 0 (chief-exec) approval

### Cross-Cycle Traceability

```markdown
## Change Log (Multi-Cycle)
| Cycle | Date | Change | Rationale | Artifacts Updated | Approved By |
|---|---|---|---|---|---|
| C2 | [date] | [what changed] | [why] | VIS-0001.2, PORT-0003.2 | Human Gate (BRD-0012) |
```

---

## Append-Only Decision Protocol

All C-Suite decisions follow strict append-only logging for audit trail and compliance.

### Core Rules

1. **Never delete entries** — decision history is permanent (ISO 9001, GxP requirement)
2. **Supersede, don't edit** — if decision reversed, add new entry referencing prior (e.g., "Supersedes ADR-0005")
3. **Required fields:** Date, Decision ID, Decision, Rationale, Linked Artifacts, Impact
4. **Status transitions:** `proposed → approved → [active | deprecated | superseded]`
5. **Temporal integrity:** Timestamps must be immutable once written

### Decision Record Format

```markdown
## [PREFIX]-XXXX: [Decision Title]
**Type:** [decision type specific to domain]
**Date:** [ISO-8601 timestamp]
**Status:** proposed | approved | active | deprecated | superseded
**Supersedes:** [prior decision ID if applicable]

**Decision:** [What was decided, clear and concise]

**Rationale:** [Why this decision was made, evidence-based]

**Alternatives Considered:**
- [Option A]: [why rejected]
- [Option B]: [why rejected]

**Impact:**
- [Who/what is affected]
- [Cost/resource implications]
- [Risk introduced or mitigated]

**Linked Artifacts:** [REQ-XXXX, VIS-XXXX, PORT-XXXX, etc.]

**Approved By:** [Human Gate reference or delegated authority]

**Review Date:** [When to revisit this decision, if applicable]
```

### Domain-Specific ID Prefixes

Each C-Suite skill uses a distinct prefix:
- `EXEC-XXXX` — chief-exec (executive/strategic decisions)
- `ADR-XXXX` — chief-tech (Architecture Decision Records)
- `FM-XXXX` — chief-finance (Financial Model decisions)
- `ORG-XXXX` — chief-people (Organizational design decisions)
- `PLAY-XXXX` — chief-ops (Operational playbook decisions)

---

## Orchestration Primitives

Common coordination patterns used across C-Suite skills.

### Escalation Tiers

Standard escalation ladder for all domains:

| Tier | Handler | Scope | Response SLA |
|------|---------|-------|--------------|
| **Tier 1** | Team/Squad | Routine operational issues | Same-day |
| **Tier 2** | Functional Lead | Domain-specific decisions, cross-team coordination | 1-2 days |
| **Tier 3** | C-Suite Officer | Strategic domain decisions, budget implications | 1 week |
| **Tier 4** | CEO (chief-exec) | Cross-domain conflicts, existential risks, board-level | Immediate (if crisis) |

**Escalation triggers:** escalate immediately when impact exceeds authority, a Red/CRITICAL threshold is crossed, or a cross-domain conflict exists; otherwise escalate when unresolved beyond the tier SLA. Domain-specific thresholds may be stricter but must not delay these defaults.

### Approval Matrix Template

Spending authority and decision delegation (customize per domain):

| Amount / Impact | Auto-Approved | Manager | Director | C-Suite | CEO | Board |
|-----------------|---------------|---------|----------|---------|-----|-------|
| <$X | ✅ | | | | | |
| $X-$Y | | ✅ | | | | |
| $Y-$Z | | | ✅ | | | |
| >$Z | | | | ✅ | | |
| Strategic pivot | | | | | ✅ | ✅ |

### Status Color Coding

Consistent across all dashboards and reports:

- 🟢 **Green:** On-track (within 10% variance of target)
- 🟡 **Yellow:** At-risk (10-25% variance, action plan active)
- 🔴 **Red:** Critical (>25% variance or breach of threshold, escalation required)

### Risk Assessment Template

```markdown
| Risk ID | Risk | Category | Likelihood | Impact | Mitigation | Owner | Status | Review Date |
|---|---|---|---|---|---|---|---|---|
| RISK-XXXX | [description] | [Strategic/Operational/Financial/Technical/People] | H/M/L | H/M/L | [plan] | [who] | OPEN/MITIGATED/CLOSED | [date] |
```

**Risk Scoring:**
- **High:** >70% probability or >$100K impact
- **Medium:** 30-70% probability or $10K-$100K impact
- **Low:** <30% probability or <$10K impact

---

## Output and State Persistence

All C-Suite artifacts persist to `.agile-v/business/` directory structure.

### Standard Storage Locations

```
.agile-v/business/
├── EXEC_DASHBOARD.md       # chief-exec: consolidated view
├── BOARD_REPORT.md          # chief-exec: board communications
├── CRISIS_LOG.md            # chief-exec: crisis response
├── TECH_STRATEGY.md         # chief-tech: technology direction
├── ARCH_DECISIONS.md        # chief-tech: ADR log
├── TECH_DEBT_REGISTER.md    # chief-tech: tech debt tracking
├── PLATFORM_PLAN.md         # chief-tech: platform roadmap
├── FINANCIAL_MODEL.md       # chief-finance: financial projections
├── CASH_MANAGEMENT.md       # chief-finance: cash flow tracking
├── FINANCIAL_CONTROLS.md    # chief-finance: approval matrix, controls
├── BOARD_FINANCIALS.md      # chief-finance: board financial reports
├── ORG_DESIGN.md            # chief-people: organization structure
├── HIRING_PIPELINE.md       # chief-people: recruitment tracking
├── COMPENSATION_FRAMEWORK.md # chief-people: comp bands, equity
├── CULTURE_CODE.md          # chief-people: values, principles
├── PERFORMANCE_FRAMEWORK.md # chief-people: review process
├── TALENT_PLAN.md           # chief-people: development, succession
├── OPS_PLAYBOOK.md          # chief-ops: operational procedures
├── PROCESS_MAP.md           # chief-ops: process definitions
├── DELIVERY_DASHBOARD.md    # chief-ops: delivery metrics
└── cycles/
    ├── C1/                  # Frozen cycle 1 archive
    ├── C2/                  # Frozen cycle 2 archive
    └── ...
```

### File Path References (Zero Token Pattern)

C-Suite skills **reference artifacts by file path only** — never load full content into skill context:

✅ **Correct:** "Read `.agile-v/business/TECH_STRATEGY.md` for current technology direction"
❌ **Incorrect:** Embedding full TECH_STRATEGY.md content in skill text

**Token efficiency:** Path reference = 0 tokens until read on-demand. Scales infinitely.

---

## Companion Skills

**Load this foundation skill BEFORE any C-Suite skill:**

- **chief-exec** — CEO orchestrator (strategic alignment, board, crisis, cross-C-suite)
- **chief-tech** — CTO orchestrator (architecture, platform, tech governance)
- **chief-finance** — CFO orchestrator (financial modeling, cash management, controls)
- **chief-people** — CHRO orchestrator (org design, hiring, compensation, culture)
- **chief-ops** — COO orchestrator (operational excellence, process, delivery)

**Integration with functional skills:**

- **venture-strategist** — C-Suite consumes VIS-XXXX, PORT-XXXX, BM-XXXX outputs
- **rd-innovator** — chief-tech governs TECH-XXXX, RDI-XXXX, PROTO-XXXX
- **gtm-executor** — chief-exec and chief-ops coordinate with GTM-XXXX, MKT-XXXX
- **business-operations** — chief-finance and chief-ops govern FIN-XXXX, OKR-XXXX, VENDOR-XXXX
