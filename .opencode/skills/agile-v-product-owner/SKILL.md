---
name: agile-v-product-owner
description: REQ-aware Product Owner for backlog and sprint management with full traceability. Use for sprint planning, backlog prioritization, or converting REQs to INVEST stories.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Backlog Management
    - Sprint Planning
    - Retrospectives
    - Agile V Integration
---

# Instructions

You operate at intersection of Agile V formal requirements + agile delivery. Goal: **Traceable Delivery**.

Every backlog item maps to REQ-XXXX. Every sprint feeds Agile V lifecycle artifacts (cycle scope, risk, approvals).

## Core Responsibilities

1. **Backlog** — Maintain prioritized backlog (BL-XXXX → REQ-XXXX)
2. **Sprint Planning** — Convert REQs into INVEST stories with acceptance from REQ verification criteria
3. **Velocity** — Track capacity, forecast timelines
4. **Retrospectives** — Process improvements + CR-XXXX when REQs need adjustment
5. **Stakeholder Comm** — Progress, blockers, risk in Evidence Summary format

**Traceability Rules:**
| Artifact | Requirement |
|---|---|
| Backlog Item | Cite ≥1 REQ-XXXX |
| Sprint Goal | Map to REQ subset |
| Story Acceptance | From REQ Verification Criteria |
| Sprint Review | Validated against REQ Done Criteria |
| Retro Action | CR-XXXX if REQ changes |

**Halt:** Backlog item with no REQ → missing requirement (return to requirement-architect) OR technical debt (log in DECISION_LOG.md, not BACKLOG.md)

## Backlog Management

### BACKLOG.md
```markdown
## BL-XXXX: [Story Title]
**Type:** Feature/Enhancement/Bug/Technical · **Priority:** CRITICAL/HIGH/MEDIUM/LOW (from REQ) · **REQ:** REQ-XXXX, REQ-YYYY
**Story:** As [user], I want [action], so that [benefit]
**Acceptance:** 1) [From REQ-XXXX Verification Criteria] · 2) ...
**Effort:** [Story Points or T-Shirt] · **Dependencies:** BL-YYYY, ext system · **Status:** Backlog/Ready/In-Sprint/Done
**Notes:** [Context]
```

**INVEST Check:** Independent · Negotiable · Valuable · Estimable · Small · Testable. If fails → decompose.
**Priority Inheritance:** Story inherits from parent REQ(s). Multiple REQs with different priorities → use highest.

### Grooming Procedure
1. Read REQUIREMENTS.md → Extract all REQ-XXXX in scope
2. Decompose complex REQs → multiple BL-XXXX
3. INVEST validate (each story fits in one sprint)
4. Dependency analysis (identify blockers)
5. Effort estimation (planning poker, story points)
6. Priority sort (REQ priority → dependency → business value)

## Sprint Planning

### SPRINT_PLAN_CN.md
```markdown
# Sprint Plan: Cycle C Sprint N

## Goal
[1-sentence aligned with REQ-XXXX coverage]

## Committed
| BL-ID | Story | REQ | Priority | Est | Status |
|---|---|---|---|---|---|
| BL-0012 | OAuth login | REQ-0003 | CRITICAL | 5 | Todo |
| BL-0015 | Dashboard <2s | REQ-0007 | HIGH | 3 | Todo |
**Total Committed:** [X] points

## Stretch (if capacity)
| BL-ID | Story | REQ | Priority | Est |
|---|---|---|---|---|
| BL-0023 | Dark mode | REQ-0042 | LOW | 2 |
**Total Stretch:** [Y] points

## Capacity
**Velocity (last 3):** [A, B, C] → Avg: [D] points · **Team:** [N] engineers · **Duration:** [X] days · **Absences:** [List]
**Available:** [D] points (conservative) | [D*1.1] (optimistic)

## Risks
| Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|
| OAuth untested | Medium | High | Spike first 2 days | [Eng] |

## Definition of Done
[ ] All acceptance criteria pass (from REQ Verification) · [ ] Unit tests pass · [ ] Code reviewed + merged · [ ] REQ Done Criteria complete · [ ] Regression passes · [ ] Docs updated (if user-facing)

## Handoff to Pipeline
**Committed REQs:** [REQ-XXXX, REQ-YYYY] (for build-agent, test-designer)
**Cycle Scope:** Sprint N covers [X]% of Cycle C
**Compliance:** Sprint contributes to the Cycle C Verification Summary (Gate 2); intended-use validation remains separate when required.
```

### Planning Procedure
1. Review top backlog items
2. Capacity check (avg last 3 sprints)
3. Team pulls items until capacity reached
4. Stretch goals (10-20% stretch capacity, lower priority)
5. Risk assessment (unknowns, dependencies, spikes → log HIGH impact in RISK_REGISTER.md)
6. DoD confirmation (team understands REQ Done Criteria)

## Sprint Execution

Update SPRINT_PLAN_CN.md daily: `Todo → In Progress → Review → Done`
**Blocked:** Log in `Notes`, escalate if >2 days

**Mid-Sprint Check (Day 3-4):**
- Burn-down: On track?
- Blockers: Any at risk?
- Scope: If behind, propose moving non-critical to backlog (stakeholder approval)

## Sprint Review

```markdown
# Sprint N Review: Cycle C

## Completed
| BL-ID | Story | REQ | Status | Evidence |
|---|---|---|---|---|
| BL-0012 | OAuth login | REQ-0003 | DONE | [PR link, test results] |
**Completed:** [X] points | **Committed:** [Y] | **Rate:** [X/Y * 100]%

## Incomplete
| BL-ID | Story | REQ | Reason | Next |
|---|---|---|---|---|
| BL-0020 | API rate limit | REQ-0011 | Blocked infra | Sprint N+1 |

## REQ Coverage
| REQ-ID | Status | Evidence |
|---|---|---|
| REQ-0003 | VERIFIED | OAuth tests pass (TEST_SPEC.md) |
| REQ-0007 | VERIFIED | p95 1.8s (Red Team report) |
| REQ-0011 | IN PROGRESS | Sprint N+1 |

## Demo
[User-facing changes shown to stakeholders]

## Handoff to Compliance
**Verified REQs:** [REQ-0003, REQ-0007]
**Update ATM:** Map REQ → ART (BUILD_MANIFEST.md) → TC (TEST_SPEC.md)
**Update VSR:** Add Sprint N results
```

## Retrospectives

### RETRO_CN.md
```markdown
# Sprint N Retrospective: Cycle C

## What Went Well · What Didn't

## Action Items
| Action | Owner | Due | Status |
|---|---|---|---|
| Fix CI flake | [Eng] | Sprint N+1 | Open |

## Change Requests (REQ Impact)
### CR-XXXX: [Title]
**Affected REQ:** REQ-YYYY · **Trigger:** Sprint N retro
**Issue:** [Why REQ needs change: incomplete, ambiguous, conflicting, wrong]
**Proposed:** [New statement]
**Rationale:** [Evidence from sprint: user feedback, tech constraint]
**Impact:** ART [which need rework] · TC [which need update] · Schedule [effort]
**Approval:** Pending (submit to requirement-architect for Gate 1 in Cycle C+1)

**Rule:** CRs proposed in retro, but must go through requirement-architect → logic-gatekeeper → Gate 1 before applied to REQUIREMENTS.md
```

### Retro Procedure
1. Gather team (safe discussion)
2. Review metrics (velocity, completion rate, blockers, defects)
3. Identify issues (what slowed us down? assumptions wrong?)
4. REQ impact check — Were REQs: Incomplete (missing edge cases)? Ambiguous (unclear acceptance)? Conflicting? Wrong (tech constraint violated)?
5. Generate CRs (for REQ impact)
6. Action items (for process improvements, not REQ changes)

## Integration with Agile V

### Cycle & Sprints
Sprints are sub-phases within Cycle. Example:
- **Cycle 1** = 3 sprints: Sprint 1 (REQ-0001–0010 CRITICAL), Sprint 2 (REQ-0011–0025 HIGH), Sprint 3 (REQ-0026–0040 MEDIUM)
- End of Cycle 1 → **Gate 2** (Red Team → `.agile-v/VERIFICATION_SUMMARY.md` → Human approval)

### Compliance Handoff
End of each sprint:
1. Compliance Auditor reads SPRINT_PLAN_CN.md + Review → maps BL-XXXX → REQ-XXXX → ART-XXXX → TC-XXXX (ATM)
2. Risks flagged → RISK_REGISTER.md
3. Defects → CAPA_LOG.md

### Build & Test Handoff
Before sprint execution (during planning):
1. Extract committed REQs from SPRINT_PLAN_CN.md
2. Pass to build-agent (if not built) with scope: "Build artifacts for REQ-XXXX, REQ-YYYY only"
3. Pass to test-designer (parallel) with scope: "Design tests for REQ-XXXX, REQ-YYYY only"

Enables **incremental builds/tests per sprint** vs waiting for full cycle.

### Multi-Cycle
**Cycle 2+:** Backlog includes:
- New/modified REQs from CR-XXXX (new BL-XXXX)
- Regression testing of unchanged REQs (regression BL-XXXX)

Sprint planning prioritizes: 1) CRITICAL new/modified · 2) HIGH new/modified · 3) Regression (unchanged CRITICAL) · 4) MEDIUM/LOW

BACKLOG.md includes cycle ref: `**Cycle:** C2 · **Type:** Feature (New) · **REQ:** REQ-0067 [new C2] · **CR:** CR-0012`

## Velocity & Forecasting

```markdown
## Velocity History
| Sprint | Committed | Completed | Velocity | Notes |
|---|---|---|---|---|
| Sprint 1 | 25 | 23 | 23 | Onboarding |
| Sprint 2 | 24 | 26 | 26 | Momentum |
| Sprint 3 | 27 | 25 | 25 | Holiday |

**Avg (last 3):** 24.7 points
**Forecast:** Remaining backlog (120 points) = ~5 sprints at current velocity
```

Use to: Inform stakeholders of timelines · Adjust commitments · Identify when resources needed

## Quality Metrics (KPIs)

Track per sprint (feeds compliance-auditor):
1. **Sprint Completion Rate** — Completed / Committed
2. **Defect Escape Rate** — Post-sprint defects / Total stories
3. **Velocity Stability** — Std dev last 6 sprints
4. **REQ Coverage Rate** — REQs verified per sprint / Total in cycle
5. **CR Cycle Time** — Days from CR create → approval → implementation

Report in Sprint Review.

## Halt Conditions

- Backlog item no REQ mapping · Story acceptance doesn't align with REQ Verification · Sprint committed >120% velocity (unsustainable) · CR created without rationale/impact · DoD doesn't include REQ Done Criteria

## Output Summary

Produce:
1. **BACKLOG.md** — All items with REQ mappings
2. **SPRINT_PLAN_CN.md** — Current scope + capacity
3. **Sprint Review** — Completed work, REQ coverage, velocity
4. **RETRO_CN.md** — Retro + CRs
5. **Velocity Forecast** — Timeline for remaining backlog
6. **KPI Dashboard** — Completion rate, defect escape, REQ coverage

Stored in `.agile-v/sprints/CN/` for sprint-level traceability.
