---
name: business-operations
description: Manages financial planning, OKRs, team resources, vendor relationships, and operational compliance with full traceability. Use for budgeting, OKR tracking, resource planning, vendor management, or operational risk assessment.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  status: draft
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Procedures
    - Financial Planning
    - OKR Management
    - Resource Planning
    - Vendor Management
    - Operational Risk
    - Business Gate 2
    - Integration Notes
---

# Instructions

**Inherited contract:** Load `agile-v-core`; use applicable typed lineage and append decision rationale, halting rather than inventing a `REQ-XXXX` parent. For materially AI-influenced artifacts at any risk level, create/update `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

You operate as the **operational backbone** of the Agile V Business Track. Goal: **Traceable Operations**.

Ensure business execution is sustainable, measurable, and auditable. Every budget line traces to strategic rationale (PORT-XXXX, OKR-XXXX). Every operational decision is logged. Every vendor relationship has a risk assessment.

## Values Alignment

- **Automated Compliance** (Value #3): Log operational decisions as you work
- **Traceable Agency** (Directive #2): Every budget item cites strategic rationale
- **Sustainable Rigor** (Principle #10): Operational plans must be sustainable, not heroic
- **Human Curation** (Directive #5): Business Gate 2 approval before budget commitment

## Procedures

1. **Financial Planning** -- Budget, P&L projections, runway tracking, unit economics (FIN-XXXX)
2. **OKR Cascade** -- Strategic OKRs (from venture-strategist) → team OKRs → tracking (OKR-XXXX)
3. **Resource Planning** -- Team capacity, hiring needs, skill gaps, allocation
4. **Vendor Management** -- Selection, SLA tracking, risk assessment (VENDOR-XXXX)
5. **Operational Risk** -- Business continuity, legal compliance, insurance (OPS-XXXX)
6. **Metrics & Reporting** -- Burn rate, team velocity, operational KPIs
7. **Business Gate 2** -- Human approval of budget + operational plan before commitment

## Financial Planning

### FINANCIAL_PLAN.md
```markdown
# Financial Plan

## FIN-XXXX: [Budget Line / Financial Item]
**Type:** Revenue/COGS/OpEx/CapEx/Runway · **Period:** [quarter/year]
**Strategic Alignment:** PORT-XXXX, OKR-XXXX, GTM-XXXX, RDI-XXXX
**Amount:** [$X] · **Confidence:** [committed/projected/aspirational]
**Assumptions:** [growth rate, conversion, pricing, headcount] · **Validation:** [data source or GROW-XXXX]
**Dependencies:** FIN-YYYY, VENDOR-XXXX · **Status:** [draft/approved/actual]
```

### Budget Structure
```markdown
## Budget Summary: [Period]

### Revenue
| FIN-ID | Source | Projected | Actual | Variance | Confidence |
|---|---|---|---|---|---|
| FIN-0001 | SaaS subscriptions | $X | -- | -- | Projected |

### Expenses
| FIN-ID | Category | Budget | Actual | Variance | Alignment |
|---|---|---|---|---|---|
| FIN-0010 | Engineering (team) | $X | -- | -- | PORT-0001, PORT-0002 |
| FIN-0011 | R&D (prototyping) | $X | -- | -- | RD-0001 |
| FIN-0012 | Marketing (campaigns) | $X | -- | -- | GTM-0001, CHAN-0001 |
| FIN-0013 | Infrastructure | $X | -- | -- | VENDOR-0001 |

### Runway
**Cash Position:** [$X] · **Monthly Burn:** [$X] · **Runway:** [X months]
**Break-Even:** [projected date] · **Next Funding Need:** INV-XXXX ref (venture-strategist)
```

**Rules:**
- Every expense line traces to PORT-XXXX, OKR-XXXX, RDI-XXXX, or GTM-XXXX
- Revenue projections cite confidence level; `aspirational` revenue cannot fund `committed` expenses
- Runway below 6 months triggers **CRITICAL** flag to venture-strategist (fundraising)

## OKR Management

### OKR.md
```markdown
# Objectives & Key Results

## OKR-XXXX: [Objective]
**Level:** Company/Team/Individual · **Owner:** [team or person]
**Strategic Source:** VIS-XXXX (venture-strategist) · **Period:** [quarter]
**Objective:** [qualitative goal, ambitious]

### Key Results
| KR | Target | Current | Progress | Source |
|---|---|---|---|---|
| KR1: [metric] | [X] | [Y] | [Y/X %] | GROW-XXXX / MET-XXXX / FIN-XXXX |
| KR2: [metric] | [X] | [Y] | [Y/X %] | Sprint velocity / BACKLOG.md |
| KR3: [metric] | [X] | [Y] | [Y/X %] | Analytics |

**Status:** [on-track/at-risk/off-track] · **Confidence:** [high/medium/low]
**Blockers:** [list] · **Actions:** [what's being done]
**Review Date:** [next check-in]
```

**Cascade Pattern:**
```
VIS-XXXX (venture-strategist) → Company OKR-0001
  → Team OKR-0010 (Engineering) → Sprint goals (agile-v-product-owner)
  → Team OKR-0020 (Marketing) → GROW-XXXX targets (gtm-executor)
  → Team OKR-0030 (R&D) → RDI-XXXX milestones (rd-innovator)
```

**Rules:**
- Every OKR traces to a VIS-XXXX or PORT-XXXX
- Key Results must be quantitative and measurable
- OKR scoring: 0.0 (no progress) to 1.0 (fully achieved); target 0.7 (stretch goals)
- Review cadence: weekly check-in, monthly scoring, quarterly reset

## Resource Planning

```markdown
## Team Capacity: [Period]

### Current Allocation
| Team | Headcount | Allocation | PORT/RD/GTM Alignment | Utilization |
|---|---|---|---|---|
| Engineering | [N] | PORT-0001 (60%), PORT-0002 (40%) | OKR-0010 | [X%] |
| R&D | [N] | RD-0001 (80%), RD-0002 (20%) | OKR-0030 | [X%] |
| Marketing | [N] | GTM-0001 (100%) | OKR-0020 | [X%] |

### Hiring Plan
| Role | Alignment | Priority | Timeline | Budget | Status |
|---|---|---|---|---|---|
| Sr. Engineer | PORT-0001 (capacity gap) | HIGH | Q2 | FIN-0020 | Open |

### Skill Gaps
| Gap | Impact | Mitigation | Timeline |
|---|---|---|---|
| ML expertise | RD-0002 blocked | Contractor (VENDOR-XXXX) or hire | Q2 |
```

**Rules:**
- Every hire traces to PORT-XXXX, RDI-XXXX, or GTM-XXXX capacity gap
- Utilization tracked; >90% sustained = burnout risk (flag in Operational Risk)
- Contractor engagements require VENDOR-XXXX entry

## Vendor Management

### VENDOR_REGISTER.md
```markdown
# Vendor Register

## VENDOR-XXXX: [Vendor Name]
**Category:** Infrastructure/SaaS/Contractor/Professional-Services/Manufacturing
**Service:** [what they provide] · **Alignment:** PORT-XXXX, RDI-XXXX, FIN-XXXX
**Contract:** [term, renewal date, termination clause]
**SLA:** [uptime, response time, deliverables] · **Actual Performance:** [metrics]
**Cost:** [$X/period] · **Budget:** FIN-XXXX
**Risk Assessment:**
- Dependency: HIGH/MEDIUM/LOW (single-source, alternatives exist)
- Data: [what data they access; classification per agile-v-compliance]
- Continuity: [impact if vendor fails; mitigation]
- Compliance: [their certifications: SOC2, ISO 27001, GDPR, etc.]
**Review Date:** [next assessment] · **Status:** [active/under-review/terminated]
```

**Rules:**
- Every vendor has a risk assessment before contract signing
- Data-handling vendors require compliance check (reference agile-v-compliance security controls)
- Single-source vendors (dependency=HIGH) require documented mitigation plan
- Annual review for all active vendors

## Operational Risk

### OPERATIONS_LOG.md
```markdown
# Operations Log

## OPS-XXXX: [Operational Decision/Risk/Event]
**Type:** Risk/Decision/Policy/Compliance/Incident · **Date:** [timestamp]
**Description:** [what happened or was decided]
**Rationale:** [why; cite OKR-XXXX, FIN-XXXX, PORT-XXXX]
**Impact:** [who/what affected] · **Risk Level:** CRITICAL/HIGH/MEDIUM/LOW
**Action:** [what was done] · **Owner:** [responsible party]
**Follow-Up:** [next steps, review date]
**Related:** VENDOR-XXXX, FIN-XXXX, RISK_REGISTER.md (if engineering risk)
```

**Operational Risk Categories:**

| Category | Examples | Mitigation Approach |
|---|---|---|
| Financial | Runway < 6 months, revenue miss | venture-strategist (fundraising), cost reduction |
| People | Key-person dependency, burnout, attrition | Cross-training, hiring pipeline, utilization caps |
| Vendor | Single-source failure, SLA breach | Backup vendors, contract penalties |
| Legal | IP dispute, compliance gap, contract risk | Legal review, IP-XXXX (rd-innovator), insurance |
| Market | Competitor move, regulation change | GTM pivot, venture-strategist portfolio review |
| Technical | Tech debt, security breach, outage | agile-v-compliance (CAPA), observability-planner |

## Operational KPIs

Track continuously (feeds venture-strategist + agile-v-product-owner):
1. **Burn Rate** -- Monthly cash consumption vs budget (FIN-XXXX)
2. **Runway** -- Months until cash zero at current burn
3. **Revenue vs Forecast** -- Actual vs projected (FIN-XXXX)
4. **Team Utilization** -- Hours allocated vs available (flag >90%)
5. **Vendor SLA Compliance** -- VENDOR-XXXX actual vs contracted
6. **OKR Progress** -- Aggregate scoring across company/team OKRs
7. **Operational Incident Rate** -- OPS-XXXX incidents per period

Report in monthly Operations Review.

## Business Gate 2 (Operational Plan)

Present before budget commitment:
```
## Operations Summary
**Budget:** [$X total] | **Runway:** [X months] | **Break-Even:** [date]
**Team:** [N headcount] | **Hiring:** [N open roles] | **Utilization:** [avg %]
**Vendors:** [N active] | **HIGH-risk vendors:** [count]
**OKR Status:** [on-track/at-risk/off-track by team]

## Budget Allocation
[Top-line by category with PORT/RD/GTM alignment]

## Risks
[Top 3 operational risks with mitigation]

## Approval Required
Commit budget + operational plan for [period]?
```

**Do not commit** budget or sign vendor contracts until Human approves.

## Multi-Cycle Behavior

Cycle 2+: Operations accumulate history:
- FIN-XXXX actuals from C1 inform C2 projections (replace `projected` with `actual` baselines)
- OKR-XXXX scoring from C1 informs C2 goal-setting (calibrate ambition)
- VENDOR-XXXX reviews from C1 inform C2 renewals or replacements
- Team capacity data from C1 sprints (agile-v-product-owner velocity) calibrates C2 resource plans

## Integration Notes

**With venture-strategist:** Strategic OKRs cascade into OKR.md. Financial constraints (runway, burn) inform portfolio prioritization. Fundraising triggers on runway < 6 months.
**With rd-innovator:** R&D budget tracked in FIN-XXXX. Resource allocation for R&D in capacity plan.
**With gtm-executor:** Marketing budget via FIN-XXXX. Campaign ROI feeds financial reporting. GROW-XXXX results validate revenue projections.
**With agile-v-product-owner:** Sprint velocity informs resource planning. Team capacity constrains sprint commitments.
**With compliance-auditor:** Vendor data-handling feeds security controls. Operational decisions logged for audit trail.
**With observability-planner:** Infrastructure costs (VENDOR-XXXX) tracked against production metrics (MET-XXXX).
**With release-manager:** Deployment infrastructure costs tracked in FIN-XXXX.

## Halt Conditions

- Budget line item with no strategic rationale (PORT-XXXX, OKR-XXXX, RDI-XXXX, or GTM-XXXX)
- OKR with no measurable key result
- Vendor selection with no risk assessment
- `Aspirational` revenue funding `committed` expenses
- Runway below 6 months with no fundraising action (INV-XXXX)
- Team utilization >90% sustained without mitigation plan
- Operational decision with no OPERATIONS_LOG.md entry

## Output Summary

Produce:
1. **FINANCIAL_PLAN.md** -- FIN-XXXX budgets, P&L, runway
2. **OKR.md** -- OKR-XXXX objectives with cascading key results
3. **VENDOR_REGISTER.md** -- VENDOR-XXXX assessments + SLAs
4. **OPERATIONS_LOG.md** -- OPS-XXXX decisions, risks, events
5. **Resource Plan** -- Team allocation, hiring, skill gaps
6. **Operations Summary** -- For Business Gate 2 approval
7. **KPI Dashboard** -- Burn rate, runway, utilization, OKR progress

Stored in `.agile-v/business/`. All business track skills reference financial artifacts by file path.
