# C-Suite Orchestration Primitives

> Reusable coordination patterns, escalation frameworks, and decision structures used across all C-Suite skills. Define once, reference everywhere.

These primitives abstract common orchestration patterns to eliminate duplication across C-Suite skills while maintaining domain customization.

---

## Escalation Patterns

### Standard Escalation Ladder

Used across all domains for conflict resolution and decision elevation.

**4-Tier Structure:**

| Tier | Handler | Scope | Response SLA | Authority Limit |
|------|---------|-------|--------------|-----------------|
| **Tier 1** | Team/Squad | Routine operational issues | Same-day | <$500, <1 sprint impact |
| **Tier 2** | Functional Lead / Manager | Domain-specific decisions, cross-team coordination | 1-2 days | $500-$5K, <1 month impact |
| **Tier 3** | C-Suite Officer | Strategic domain decisions, budget implications | 1 week | $5K-$100K, <1 quarter impact |
| **Tier 4** | CEO (chief-exec) | Cross-domain conflicts, existential risks, board-level | Immediate (if crisis) | >$100K, strategic pivots |

**Escalation Triggers:**
- Issue unresolved at tier N for >SLA duration → Escalate to N+1
- Impact exceeds tier authority limit → Escalate immediately
- Cross-domain conflict → Escalate to Tier 4 (CEO)
- CRITICAL severity (security, legal, customer safety) → Escalate to Tier 3+ immediately

**Domain Customization:**
Each C-Suite skill defines domain-specific escalation examples:
- **CTO:** Architecture conflicts, tech debt >25% backlog, CRITICAL vulnerabilities
- **CFO:** Runway <6 months, budget variance >15%, LTV:CAC <3:1
- **CHRO:** Attrition >15%, key-person dependency, culture score declining
- **COO:** Sprint completion <70% for >2 sprints, vendor SLA Tier 2+ breach

---

## Approval Matrix Template

### Spending Authority Framework

Standard approval tiers based on amount and category. Customize thresholds per organization size.

**Default Thresholds (adjust per org stage):**

| Amount / Impact | Auto-Approved | Manager | Director | C-Suite | CEO | Board |
|-----------------|---------------|---------|----------|---------|-----|-------|
| **<$500** | ✅ Team discretion | | | | | |
| **$500-$5K** | | ✅ Manager approval | | | | |
| **$5K-$25K** | | | ✅ Director approval | | | |
| **$25K-$100K** | | | | ✅ C-Suite (CFO typically) | | |
| **>$100K** | | | | ✅ C-Suite | ✅ CEO co-approval | |
| **>$500K** | | | | | ✅ CEO | ✅ Board approval |
| **Strategic pivot** | | | | | ✅ CEO | ✅ Board approval |
| **Fundraising** | | | | | ✅ CEO + CFO | ✅ Board approval |

**Category-Specific Adjustments:**

| Category | Modifier | Rationale |
|----------|----------|-----------|
| **OpEx (recurring)** | Standard | Predictable, budgeted |
| **CapEx** | -1 tier (more approval) | Long-term commitment |
| **Vendor contracts** | Standard for <1yr, -1 tier for multi-year | Lock-in risk |
| **Headcount** | -1 tier (CHRO + CFO) | Largest cost, hard to reverse |
| **Marketing campaigns** | Standard if within budget, -1 if experiment | ROI uncertainty |
| **Tech infrastructure** | CTO approval always, CFO if >$25K | Architectural impact |

**Usage:**
- **CFO (chief-finance):** Defines approval matrix in FINANCIAL_CONTROLS.md (CTRL-XXXX)
- **Other C-Suite:** References approval matrix for budget-related decisions
- **business-operations:** Executes approval workflows per matrix

---

## Health Status Definitions

### Traffic Light System

Consistent status coding across all C-Suite dashboards.

| Status | Meaning | Criteria | Action Required | Escalation |
|--------|---------|----------|-----------------|------------|
| 🟢 **Green** | On-track | Within ±10% of target | None (monitor) | No escalation |
| 🟡 **Yellow** | At-risk | 10-25% variance, action plan active | Execute mitigation, monitor closely | Notify C-suite officer |
| 🔴 **Red** | Critical | >25% variance or threshold breach | Immediate action, escalate | Escalate to CEO |

**Domain-Specific Thresholds (Examples):**

| Domain | Metric | Green | Yellow | Red |
|--------|--------|-------|--------|-----|
| **Finance** | Runway | >12 months | 6-12 months | <6 months |
| **Finance** | LTV:CAC | >3:1 | 2-3:1 | <2:1 |
| **Tech** | DORA Lead Time | <7 days | 7-14 days | >14 days |
| **Tech** | CRITICAL Vulns | 0 | 0 (but HIGH >7d old) | Any open >24hr |
| **People** | Attrition | <15% annually | 15-20% | >20% |
| **People** | Engagement | >7/10 | 6-7/10 | <6/10 |
| **Ops** | Sprint Completion | >85% | 70-85% | <70% |
| **Ops** | Cross-Team Blocks | <2/sprint | 2-3/sprint | >3/sprint |

**Trend Indicators:**
- ↑ Improving (moving toward target)
- → Stable (within ±5% for 2+ periods)
- ↓ Declining (moving away from target)

**Usage:**
- All C-Suite dashboards use consistent color coding
- Thresholds defined per domain in skill files
- Red status for >48 hours without action plan → Escalates to CEO

---

## Risk Assessment Template

### Standard Risk Table Format

Used across all C-Suite skills for risk identification and mitigation tracking.

**Table Structure:**

| Risk ID | Risk Description | Category | Likelihood | Impact | Risk Score | Mitigation | Owner | Status | Review Date |
|---------|------------------|----------|------------|--------|------------|------------|-------|--------|-------------|
| RISK-XXXX | [Clear description of risk] | [Category] | H/M/L | H/M/L | [L×I] | [Mitigation plan] | [Who] | OPEN/MITIGATED/CLOSED | [Date] |

**Risk Categories (by Domain):**

| Domain | Risk Categories |
|--------|-----------------|
| **CEO** | Strategic, Market, Competitive, Legal, Reputational, Crisis |
| **CTO** | Architecture, Security, Scalability, Tech Debt, Vendor Lock-in, Technical |
| **CFO** | Financial, Cash, Fundraising, Unit Economics, Revenue, Cost |
| **CHRO** | People, Attrition, Key-Person, Skills Gap, Culture, Compliance (labor) |
| **COO** | Operational, Process, Vendor, Delivery, Resource, Scaling |

**Likelihood Scale:**

| Level | Probability | Timeframe |
|-------|-------------|-----------|
| **High (H)** | >70% | Within 1 quarter |
| **Medium (M)** | 30-70% | Within 2 quarters |
| **Low (L)** | <30% | Beyond 2 quarters or unlikely |

**Impact Scale:**

| Level | Financial | Operational | Strategic |
|-------|-----------|-------------|-----------|
| **High (H)** | >$100K or >10% revenue | >1 month delay, customer impact | Threatens core business |
| **Medium (M)** | $10K-$100K or 1-10% revenue | 1-4 weeks delay | Affects single initiative |
| **Low (L)** | <$10K or <1% revenue | <1 week delay | Minor inconvenience |

**Risk Score Matrix:**

| | Low Impact | Medium Impact | High Impact |
|---|---|---|---|
| **High Likelihood** | 🟡 MEDIUM | 🔴 HIGH | 🔴 CRITICAL |
| **Medium Likelihood** | 🟢 LOW | 🟡 MEDIUM | 🔴 HIGH |
| **Low Likelihood** | 🟢 LOW | 🟢 LOW | 🟡 MEDIUM |

**Risk Status:**
- **OPEN:** Identified, mitigation planned
- **MITIGATED:** Mitigation implemented, monitoring
- **CLOSED:** Risk no longer present or accepted
- **ACCEPTED:** Risk acknowledged, no mitigation (document rationale)

**Review Cadence:**
- CRITICAL risks: Weekly
- HIGH risks: Bi-weekly
- MEDIUM risks: Monthly
- LOW risks: Quarterly

**Usage:**
- All C-Suite skills maintain risk registers
- Risks aggregate to chief-exec RISK_REGISTER.md
- CRITICAL risks escalate to CEO immediately

---

## Decision Framework Template

### Structured Decision-Making Process

Standard approach for significant decisions across all domains.

**5-Step Framework:**

```markdown
## Decision: [Clear statement of what needs to be decided]

### 1. Context
**Why this decision now:** [Trigger, urgency, strategic importance]
**Constraints:** [Budget, timeline, resources, regulatory]
**Strategic Alignment:** [VIS-XXXX, PORT-XXXX, OKR-XXXX references]

### 2. Options Analysis
| Option | Pros | Cons | Cost | Timeline | Risk |
|--------|------|------|------|----------|------|
| Option A | [Benefits] | [Drawbacks] | [$X] | [Duration] | [H/M/L] |
| Option B | [Benefits] | [Drawbacks] | [$X] | [Duration] | [H/M/L] |
| Option C (Status Quo) | [Benefits] | [Drawbacks] | [$X] | [Duration] | [H/M/L] |

### 3. Evaluation Criteria
| Criterion | Weight | Option A Score | Option B Score | Option C Score |
|-----------|--------|----------------|----------------|----------------|
| Strategic fit | 40% | 8/10 | 6/10 | 4/10 |
| Cost-effectiveness | 30% | 5/10 | 8/10 | 9/10 |
| Risk profile | 20% | 7/10 | 5/10 | 8/10 |
| Timeline | 10% | 6/10 | 9/10 | 10/10 |
| **Weighted Total** | | **6.9** | **6.8** | **6.5** |

### 4. Recommendation
**Selected Option:** [A/B/C] — [1-sentence rationale]
**Key Trade-offs:** [What we're giving up by not choosing other options]
**Reversibility:** [Can this decision be undone? At what cost?]

### 5. Implementation
**Next Steps:** [Immediate actions, owner, timeline]
**Success Metrics:** [How we'll know this decision was right]
**Review Date:** [When to reassess this decision]
```

**When to Use:**
- Decisions with budget impact >$25K
- Decisions affecting >2 quarters timeline
- Architecture decisions (ADR-XXXX)
- Strategic decisions (EXEC-XXXX, TS-XXXX, ORG-XXXX)
- Build-vs-buy decisions
- Vendor selection decisions

**Minimum Requirements:**
- At least 2 options (+ status quo)
- Clear evaluation criteria with weights
- Documented trade-offs
- Reversibility assessment

---

## Coordination Patterns

### Cross-Functional Synchronization

Common patterns for coordinating work across domains.

**Pattern 1: Sequential Handoff**

```
Domain A completes → Artifact produced → Domain B consumes
Example: venture-strategist produces PORT-XXXX → discovery-analyst consumes
```

**Coordination Mechanism:**
- Domain A notifies Domain B via file path reference
- Domain B reads artifact (zero-token pattern)
- No cross-domain context inheritance

**Pattern 2: Parallel Execution with Gate**

```
Domain A || Domain B || Domain C → All complete → Gate → Next phase
Example: discovery-analyst || threat-modeler || ux-spec-author → Human Gate 1 → build phase
```

**Coordination Mechanism:**
- Orchestrator (e.g., agile-v-pipeline) assigns wave
- Domains execute independently (fresh context each)
- Orchestrator aggregates outputs at gate
- Gate approval before proceeding

**Pattern 3: Continuous Collaboration**

```
Domain A ↔ Domain B (ongoing)
Example: chief-tech ↔ chief-people (org structure + architecture alignment)
```

**Coordination Mechanism:**
- Regular sync points (monthly, quarterly)
- Mutual artifact references (ORG-XXXX ↔ ADR-XXXX)
- Escalation when misalignment detected

**Pattern 4: Hub-and-Spoke (CEO)**

```
chief-exec (hub) ↔ all other C-suite (spokes)
```

**Coordination Mechanism:**
- All C-suite report health to EXEC_DASHBOARD
- CEO coordinates cross-domain initiatives
- CEO arbitrates conflicts

---

## Meeting Cadence Framework

### Standard Organizational Rhythms

Recommended cadences for coordination across C-suite.

| Cadence | Participants | Purpose | Duration | Artifacts |
|---------|--------------|---------|----------|-----------|
| **Daily Standup** | Team | Blockers, sync | 15 min | None |
| **Weekly 1:1** | Manager + Report | Coaching, feedback | 30 min | None |
| **Bi-Weekly Sprint** | Squad + PO | Planning, review, retro | 2 weeks | Sprint goals |
| **Monthly Business Review** | C-suite + leads | Metrics, OKRs, issues | 2 hours | Domain dashboards |
| **Quarterly Planning** | All teams | Next quarter priorities | Half-day | OKR-XXXX |
| **Quarterly Board** | C-suite + board | Strategy, financials, governance | 2 hours | BRD-XXXX |
| **Annual Strategy** | C-suite | Vision, long-term plan | Full-day | VIS-XXXX update |

**Principles:**
- All meetings timeboxed (no open-ended)
- All meetings have agenda + output
- Meeting cadence aligned across teams (same sprint start/end)
- Async-first: meetings only when synchronous required

---

## Capacity Planning Model

### Resource Allocation Framework

Standard approach for capacity planning across domains.

**Capacity Equation:**

```
Available Capacity = (Headcount × Hours/Period) × (1 - Utilization Overhead)

Utilization Overhead = Meetings + Context Switching + Operational Support + PTO
Target: 20-30% overhead (70-80% productive capacity)
```

**Healthy Utilization Bands:**

| Utilization | Status | Interpretation | Action |
|-------------|--------|----------------|--------|
| **<60%** | 🟡 Underutilized | Excess capacity, low workload, or inefficiency | Review workload, consider reallocation |
| **70-90%** | 🟢 Optimal | Healthy utilization with buffer for unplanned work | Maintain |
| **>90%** | 🔴 Overutilized | Burnout risk, no buffer for urgency | Add capacity (hire) or reduce scope |

**Capacity Allocation (by Priority):**

| Priority | Allocation | Examples |
|----------|------------|----------|
| **CRITICAL** | Immediate, all available | Customer-facing incidents, security vulnerabilities, legal compliance |
| **HIGH** | Planned, 60-70% capacity | PORT-XXXX priority 1, critical OKR work |
| **MEDIUM** | Planned, 15-20% capacity | Tech debt paydown, process improvement, PORT-XXXX priority 2 |
| **LOW** | Opportunistic, 10-15% capacity | Nice-to-have features, exploration, training |

**Usage:**
- **CHRO:** Capacity planning for hiring decisions
- **COO:** Resource arbitration between teams
- **Product Owner:** Sprint capacity calculation

---

## Change Management Protocol

### Standard Approach for Organizational Changes

Used when changes affect multiple teams or domains.

**Change Classification:**

| Type | Scope | Examples | Approval |
|------|-------|----------|----------|
| **Structural** | Org design, reporting | ORG-XXXX changes | CHRO + CEO (Executive Gate 1) |
| **Process** | Workflow, tools | PROC-XXXX changes | COO (Executive Gate 1 if major) |
| **Technical** | Architecture, platform | ADR-XXXX, PLT-XXXX | CTO (Executive Gate 1 if major) |
| **Financial** | Budget, compensation | FM-XXXX, COMP-XXXX | CFO + CEO (Executive Gate 1) |

**Change Impact Assessment:**

```markdown
## Change Impact Assessment: [Change Name]

### Affected Domains
| Domain | Impact | Adaptation Required | Timeline |
|--------|--------|---------------------|----------|
| Engineering | HIGH | New tooling, training | 2 sprints |
| Marketing | MEDIUM | Process update | 1 sprint |
| Finance | LOW | Reporting change | 1 week |

### Communication Plan
| Audience | Message | Channel | Timing |
|----------|---------|---------|--------|
| All teams | Change overview | All-hands | -2 weeks |
| Affected teams | Detailed plan | Team meetings | -1 week |
| Individuals | 1:1 support | Manager 1:1s | Ongoing |

### Rollback Plan
**If change fails:** [Steps to revert]
**Rollback window:** [How long before irreversible]
```

**Change Approval:**
- Impact >2 teams → COO coordinates
- Budget impact >$25K → CFO approves
- Org structure change → CHRO + CEO approve
- All major changes → Executive Gate 1

---

## Usage Guidelines

**For C-Suite Skills:**
- Reference these primitives rather than duplicating
- Customize thresholds and examples per domain
- Maintain consistency with primitive definitions

**For Agents:**
- Use these primitives for cross-domain coordination
- Apply escalation patterns when conflicts arise
- Reference risk assessment and decision frameworks for structured analysis

**Maintenance:**
- Primitives evolve based on organizational learning
- Changes to primitives ripple to all C-suite skills
- Version control tracks primitive evolution

---

**Last Updated:** 2026-04-19  
**Version:** 1.0  
**Status:** Active
