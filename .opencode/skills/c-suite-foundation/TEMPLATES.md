# C-Suite Templates

> Reusable Markdown templates for decision records, dashboards, reports, and gate summaries used across all C-Suite orchestrator skills.

These templates eliminate duplication by defining structure once. Each C-Suite skill references these templates and customizes with domain-specific content.

---

## Template: Decision Record

**Usage:** All C-Suite decision logging (EXEC-XXXX, ADR-XXXX, FM-XXXX, ORG-XXXX, PLAY-XXXX)

**Required Fields:**
- `[PREFIX]-XXXX`: Decision ID (domain-specific prefix)
- `Type`: Domain-specific decision category
- `Date`: ISO-8601 timestamp (immutable once written)
- `Status`: proposed | approved | active | deprecated | superseded

**Optional Fields:**
- `Supersedes`: Reference to prior decision if superseding
- `Review Date`: Scheduled reassessment date

**Template:**

```markdown
## [PREFIX]-XXXX: [Decision Title]
**Type:** [decision type — domain-specific categories]
**Date:** [YYYY-MM-DDTHH:MM:SSZ]
**Status:** [proposed | approved | active | deprecated | superseded]
**Supersedes:** [[PREFIX]-YYYY if applicable]

**Decision:** [Clear, concise statement of what was decided]

**Rationale:** [Why this decision was made — evidence-based reasoning]

**Alternatives Considered:**
- **[Option A]:** [why rejected]
- **[Option B]:** [why rejected]
- **[Option C]:** [why rejected]

**Impact:**
- **Stakeholders:** [Who/what is affected]
- **Cost:** [$X one-time, $Y recurring per period]
- **Risk:** [Risk introduced or mitigated]
- **Timeline:** [Implementation timeframe]

**Linked Artifacts:** [REQ-XXXX, VIS-XXXX, PORT-XXXX, etc. — traceability]

**Approved By:** [Human Gate reference or delegated authority]

**Review Date:** [YYYY-MM-DD — when to revisit, if applicable]
```

**Domain Customization Examples:**

- **chief-tech (ADR):** Type = Platform | Framework | Tool | Architecture | Security
- **chief-finance (FM):** Type = Model Assumption | Fundraising | Spend Control | Pricing
- **chief-people (ORG):** Type = Structure | Role Definition | Reporting | Compensation
- **chief-ops (PLAY):** Type = Process | Vendor | Escalation | Delivery Cadence
- **chief-exec (EXEC):** Type = Strategic | Crisis | Board | Cross-Functional

---

## Template: Dashboard

**Usage:** All C-Suite domain dashboards (Tech, Finance, People, Ops, Executive)

**Required Sections:**
1. Health at a Glance (status table)
2. Key Metrics (targets vs actuals)
3. Critical Alerts (open issues requiring action)
4. Recent Decisions (links to decision log)
5. Trends (period-over-period analysis)

**Template:**

```markdown
# [Domain] Dashboard: [Period — e.g., 2026-Q2 or Week of 2026-04-19]

**Updated:** [YYYY-MM-DD HH:MM]
**Owner:** [C-Suite role]
**Status Summary:** [1-sentence overall health]

---

## Health at a Glance

| Area | Status | Key Metric | Target | Current | Trend | Flag |
|---|---|---|---|---|---|---|
| [Area 1] | 🟢/🟡/🔴 | [metric name] | [target] | [actual] | ↑/→/↓ | [alert text if red/yellow] |
| [Area 2] | 🟢/🟡/🔴 | [metric name] | [target] | [actual] | ↑/→/↓ | |
| [Area 3] | 🟢/🟡/🔴 | [metric name] | [target] | [actual] | ↑/→/↓ | |
| [Area N] | 🟢/🟡/🔴 | [metric name] | [target] | [actual] | ↑/→/↓ | |

**Rules:**
- 🟢 Green: Within 10% of target
- 🟡 Yellow: 10-25% variance, action plan in place
- 🔴 Red: >25% variance or critical threshold breached

---

## Key Metrics

### [Metric Category 1]
| Metric | Target | Current | Variance | Status | Notes |
|---|---|---|---|---|---|
| [Metric A] | [value] | [value] | [+/-X%] | 🟢/🟡/🔴 | [context] |
| [Metric B] | [value] | [value] | [+/-X%] | 🟢/🟡/🔴 | [context] |

### [Metric Category 2]
| Metric | Target | Current | Variance | Status | Notes |
|---|---|---|---|---|---|
| [Metric C] | [value] | [value] | [+/-X%] | 🟢/🟡/🔴 | [context] |

---

## Critical Alerts

| Alert ID | Severity | Description | Impact | Action Required | Owner | Deadline | Status |
|---|---|---|---|---|---|---|---|
| [ALERT-001] | CRITICAL/HIGH/MEDIUM | [what's wrong] | [consequence] | [what to do] | [who] | [YYYY-MM-DD] | OPEN/IN_PROGRESS/RESOLVED |

**Escalation Rules:**
- CRITICAL alerts unresolved >24hrs → escalate to CEO (chief-exec)
- HIGH alerts unresolved >3 days → escalate to next tier
- All alerts require owner + deadline

---

## Recent Decisions (Last 30 Days)

| Date | Decision ID | Decision Summary | Status | Impact |
|---|---|---|---|---|
| [YYYY-MM-DD] | [PREFIX-XXXX] | [1-line summary] | active/pending | [affected area] |

**Full log:** See [domain-specific decision log file]

---

## Trends (Period-over-Period)

**Improving:**
- [Metric X]: +Y% vs prior period
- [Metric Y]: Ahead of target by Z%

**Declining:**
- [Metric A]: -B% vs prior period — [mitigation plan]

**Stable:**
- [Metric C]: Within 5% variance

---

## Next Period Priorities

1. [Priority 1 — specific, measurable]
2. [Priority 2 — specific, measurable]
3. [Priority 3 — specific, measurable]
```

**Domain Customization:**
- **chief-tech:** Areas = Platform, Security, Tech Debt, Cost; Metrics = DORA, uptime, incident count
- **chief-finance:** Areas = Cash, Runway, Revenue, Burn; Metrics = CAC, LTV, gross margin
- **chief-people:** Areas = Hiring, Retention, Performance, Culture; Metrics = headcount, attrition %, time-to-hire
- **chief-ops:** Areas = Delivery, Quality, Velocity, Vendor; Metrics = sprint completion %, cycle time, SLA adherence
- **chief-exec:** Cross-domain health + strategic OKR progress

---

## Template: Executive Gate Summary

**Usage:** All Executive Gate checkpoints (Gate 0 for CEO, domain gates for each C-Suite officer)

**Required Components:**
1. Strategy Summary (metrics dashboard)
2. Key Decisions Requiring Approval
3. Risk Assessment
4. Budget Impact
5. Approval Question

**Template:**

```markdown
## Executive Gate [N] ([Domain])

**Date:** [YYYY-MM-DD]
**Prepared By:** [C-Suite role]
**Approval Required From:** [Human authority]

---

### [Domain] Strategy Summary

**Strategic Alignment:** [How this aligns to VIS-XXXX vision and PORT-XXXX portfolio]

**Key Metrics:**
| Metric | Target | Current | Status | Notes |
|---|---|---|---|---|
| [Metric 1] | [value] | [value] | 🟢/🟡/🔴 | [context] |
| [Metric 2] | [value] | [value] | 🟢/🟡/🔴 | [context] |
| [Metric 3] | [value] | [value] | 🟢/🟡/🔴 | [context] |

---

### Key Decisions Requiring Approval

| Decision ID | Decision | Impact | Alternatives Considered | Recommendation |
|---|---|---|---|---|
| [PREFIX-XXXX] | [what] | [who/what affected] | [options evaluated with pros/cons] | ✅ [chosen path + rationale] |

**Supporting Artifacts:** [Link to detailed decision records]

---

### Risk Assessment

| Risk ID | Risk | Likelihood | Impact | Mitigation | Owner | Status |
|---|---|---|---|---|---|---|
| RISK-XXXX | [description] | H/M/L | H/M/L | [mitigation plan] | [who] | OPEN/MITIGATED |

**Critical Risks:** [Call out any HIGH likelihood + HIGH impact risks]

---

### Budget Impact

| Item | One-Time Cost | Recurring Cost (per period) | Funding Source | ROI / Justification |
|---|---|---|---|---|
| [Item 1] | $X | $Y/[month/quarter] | [budget line] | [expected return or strategic value] |
| **TOTAL** | **$X** | **$Y/period** | | |

**Runway Impact:** [Effect on cash runway, if applicable]

---

### Approval Question

**Proceed with [domain-specific action]?**

- [ ] **Yes** — Approved to proceed
- [ ] **No** — Rejected, provide feedback: ___________________
- [ ] **Revise** — Conditional approval, changes required: ___________________

**Human Signature/Approval:** ______________________ **Date:** __________

---

**Do not** [commit to irreversible actions] without explicit approval above.

**Post-Approval Actions:**
1. Update decision log with approval reference
2. Update STATUS in decision records to `approved`
3. Proceed with execution per approved plan
4. Report progress at next dashboard review
```

**Domain Gate Customization:**
- **Executive Gate 0 (chief-exec):** Cross-domain strategic alignment, board-level decisions
- **Executive Gate 1 (chief-tech):** Architecture decisions, major platform changes, tech adoption
- **Executive Gate 1 (chief-finance):** Financial model assumptions, fundraising terms, major spend
- **Executive Gate 1 (chief-people):** Org restructuring, compensation framework changes, major hires
- **Executive Gate 1 (chief-ops):** Process overhauls, vendor changes, delivery cadence shifts

---

## Template: Board Report

**Usage:** chief-exec board communications (BRD-XXXX)

**Template:**

```markdown
# Board Report: [Period — e.g., 2026-Q2]

## BRD-XXXX: [Report Title]
**Type:** Report | Resolution | Action Item | Meeting Minutes
**Date:** [YYYY-MM-DD]
**Attendees:** [Board members present]

---

### CEO Update

**Strategic Summary:** [1-2 paragraphs: where we are, what changed, where we're going]

**Key Wins (Top 3):**
1. [Achievement 1 — specific, measurable]
2. [Achievement 2 — specific, measurable]
3. [Achievement 3 — specific, measurable]

**Key Challenges (Top 3):**
1. [Challenge 1 — with mitigation plan]
2. [Challenge 2 — with mitigation plan]
3. [Challenge 3 — with mitigation plan]

---

### Domain Reports (Summary from Each C-Suite Officer)

| Domain | Owner | Highlights | Concerns | Detail Link |
|---|---|---|---|---|
| Finance | CFO | [1-line headline] | [1-line headline] | BFN-XXXX |
| Technology | CTO | [1-line headline] | [1-line headline] | TECH_STRATEGY.md |
| People | CHRO | [1-line headline] | [1-line headline] | TALENT_PLAN.md |
| Operations | COO | [1-line headline] | [1-line headline] | OPS_PLAYBOOK.md |
| GTM | (via CEO) | [1-line headline] | [1-line headline] | GTM-XXXX |

**Detailed appendices attached in `.agile-v/business/` artifacts**

---

### Financial Summary (from CFO)

| Metric | Target | Current | Variance | Notes |
|---|---|---|---|---|
| Runway | [X months] | [Y months] | [+/-Z months] | [context] |
| Burn Rate | [$X/month] | [$Y/month] | [+/-Z%] | [context] |
| Revenue (if applicable) | [$X] | [$Y] | [+/-Z%] | [context] |

---

### Strategic OKRs

| OKR ID | Objective | Owner | Q Progress | Annual Progress | Confidence | Flag |
|---|---|---|---|---|---|---|
| OKR-XXXX | [objective] | [C-suite] | [X%] | [Y%] | High/Med/Low | [if at-risk] |

---

### Decisions Requiring Board Approval

[Include Executive Gate 0 summaries for board-level decisions]

---

### Next Board Meeting

**Scheduled:** [YYYY-MM-DD]
**Agenda Items:** [Preview of topics]
```

---

## Template: Crisis Response

**Usage:** chief-exec crisis management (CRI-XXXX)

**Template:**

```markdown
# Crisis Log: [Crisis Name]

## CRI-XXXX: [Crisis Title]
**Severity:** CRITICAL | HIGH | MEDIUM
**Status:** OPEN | CONTAINED | RESOLVED | POST-MORTEM
**Date Opened:** [YYYY-MM-DD HH:MM]
**Date Resolved:** [YYYY-MM-DD HH:MM or N/A]

---

### Situation Summary

**What Happened:** [Factual description of the incident]

**Impact:**
- **Customers:** [number affected, severity]
- **Revenue:** [financial impact]
- **Reputation:** [brand/PR impact]
- **Operations:** [internal impact]

**Root Cause:** [Technical/process/human cause, if known]

---

### Response Timeline

| Time | Action Taken | By Whom | Result |
|---|---|---|---|
| [HH:MM] | [action] | [who] | [outcome] |
| [HH:MM] | [action] | [who] | [outcome] |

---

### C-Suite Coordination

| Domain | Officer | Action Required | Status | Notes |
|---|---|---|---|---|
| Technology | CTO | [specific action] | COMPLETE/IN_PROGRESS | [notes] |
| Finance | CFO | [specific action] | COMPLETE/IN_PROGRESS | [notes] |
| People | CHRO | [specific action] | COMPLETE/IN_PROGRESS | [notes] |
| Operations | COO | [specific action] | COMPLETE/IN_PROGRESS | [notes] |

---

### Communication Plan

**Internal:**
- [Stakeholder group]: [message, channel, frequency]

**External:**
- [Stakeholder group]: [message, channel, frequency]

**Board Notification:** [Yes/No — if yes, BRD-XXXX reference]

---

### Corrective Actions (Post-Resolution)

| Action | Owner | Deadline | Status | Verification |
|---|---|---|---|---|
| [Immediate fix] | [who] | [YYYY-MM-DD] | COMPLETE | [how verified] |
| [Short-term mitigation] | [who] | [YYYY-MM-DD] | IN_PROGRESS | |
| [Long-term prevention] | [who] | [YYYY-MM-DD] | PLANNED | |

**CAPA Log:** Link to CAPA-XXXX (Corrective/Preventive Action tracking)

---

### Post-Mortem

**Date:** [YYYY-MM-DD]
**Attendees:** [list]

**What Went Well:**
- [positive]

**What Went Wrong:**
- [issue]

**Lessons Learned:**
- [lesson]

**Action Items:**
- [actionable improvement]
```

---

## Usage Notes

1. **Copy template structure** into domain-specific artifact files
2. **Customize sections** with domain-specific content (remove brackets, fill in values)
3. **Reference by file path** — never duplicate full templates in skill definitions
4. **Maintain append-only** for decision logs and crisis logs (audit trail requirement)
5. **Update status fields** as situations evolve (e.g., OPEN → RESOLVED)

**Token Efficiency:** These templates are loaded once (this file) and referenced by path, eliminating 120-150 lines of duplication across 5 C-Suite skills.
