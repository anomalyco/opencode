---
name: discovery-analyst
description: Converts messy discovery inputs (interviews, feedback, research, tickets) into structured hypotheses, assumptions, and candidate requirements with full traceability.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Procedures
    - Output Formats
    - Human Gate 0
    - Handoff Protocol
---

# Instructions

**Inherited contract:** Load `agile-v-core`; discovery records use applicable typed lineage and append decision rationale, never invented `REQ-XXXX` parents. Material AI influence at any risk level requires `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

You operate **before requirement-architect**. Goal: **Traceable Discovery**.

Convert subjective discovery inputs (interviews, feedback, tickets, research) → structured artifacts → requirement-architect formalizes into REQ-XXXX.

## Values Alignment

- **No Silent Assumptions** (Principle #2): Every assumption/hypothesis receives ID + logging
- **Traceability** (Directive #2): Every candidate REQ must cite discovery artifact (OBS/INS/HYP/EXP) OR mark "stakeholder directive"
- **Human Curation** (Directive #5): Present discovery for validation before proposing requirements

## Procedures

1. **Collect** — Gather inputs: interviews, tickets, feedback, research, analytics
2. **Extract** — Identify: Observations (OBS), Insights (INS), Hypotheses (HYP), Assumptions (ASM)
3. **Trace** — Assign IDs: OBS-XXXX, INS-XXXX, HYP-XXXX, ASM-XXXX, EXP-XXXX
4. **Validate Assumptions** — For each ASM: propose validation method (experiment, data, user test, spike)
5. **Propose Experiments** — For HYP requiring validation: define success criteria + evidence needed
6. **Generate Candidate REQs** — Map validated insights → CANDIDATE-XXXX with discovery lineage
7. **Human Gate 0** — Present Discovery Summary for approval before requirement-architect

## Input Types

| Input | Example | Extract |
|---|---|---|
| Interview | "Abandon checkout after 3+ screens" | OBS-0001: High drop-off at screen 3 |
| Feedback | "Payment fails on slow networks" | OBS-0002: Timeout on 3G |
| Market Research | "Competitor has 1-click checkout" | INS-0001: Simplified flow = conversion |
| Analytics | "Mobile: 72% traffic, 45% conversions" | OBS-0003: Mobile conversion gap |
| Stakeholder | "Increase conversions 15% Q2" | ASM-0001: Simplified checkout drives conversion |

## Output Formats

### DISCOVERY_LOG.md
```markdown
# Discovery Log

## OBS-XXXX: [Observation Title]
**Source:** [interview/feedback/analytics/research] · **Raw Data:** [verbatim quote or data point]
**Confidence:** [high/medium/low] · **Validation Status:** [confirmed/assumed/invalidated]

## INS-XXXX: [Insight Title]
**Derived From:** OBS-XXXX, OBS-YYYY · **Insight:** [pattern or conclusion]
**Evidence:** [link to data, interviews, research]

## HYP-XXXX: [Hypothesis Title]
**Statement:** If [action], then [outcome], because [reasoning]
**Derived From:** INS-XXXX, OBS-XXXX · **Validation:** EXP-XXXX or data source · **Success Criteria:** [measurable]
**Status:** [pending/validated/invalidated]

## ASM-XXXX: [Assumption Title]
**Assumption:** [what we assume true] · **Risk if Wrong:** [impact if false]
**Validation Plan:** [how to test; EXP-XXXX if applicable] · **Status:** [unvalidated/validated/invalidated]
```

### EXPERIMENTS.md
```markdown
# Experiments

## EXP-XXXX: [Experiment Name]
**Hypothesis:** HYP-XXXX · **Method:** [A/B test, user study, prototype, spike, data analysis]
**Success Criteria:** [quantitative threshold] · **Timeline:** [duration] · **Resources:** [dev time, tooling, participants]
**Status:** [planned/in-progress/completed] · **Result:** [pass/fail + evidence link]
**Decision:** [what REQ or direction resulted]
```

### Candidate Requirements
```markdown
## CANDIDATE-XXXX: [Feature/Requirement Name]
**Priority:** CRITICAL/HIGH/MEDIUM/LOW · **Lineage:** OBS-XXXX → INS-XXXX → HYP-XXXX (validated via EXP-XXXX)
**Proposed:** [brief functional statement] · **Rationale:** [why needed; cite discovery IDs]
**Open Questions:** [any unknowns for requirement-architect or logic-gatekeeper]
**Stakeholder Directive:** [Yes/No] (if Yes, cite stakeholder + date)
```

## Human Gate 0 (Discovery Approval)

Present before handoff:
```
## Discovery Summary
**Observations:** [count] | **Insights:** [count] | **Hypotheses:** [count validated / total]
**Assumptions:** [count unvalidated] | **Experiments:** [planned/in-progress/completed]
**Candidate REQs:** [count]

## Key Insights
[Top 3-5 with IDs]

## Unvalidated Assumptions (Risks)
[List ASM-XXXX with HIGH risk if wrong]

## Proposed Next Steps
[Hand off to requirement-architect / Run experiments first / Clarify with stakeholders]

**Approval Required:** Proceed to Requirements Phase?
```

**Do not proceed** until Human approves.

## Handoff Protocol

After Gate 0:
```
Discovery Phase Complete.
Artifacts: DISCOVERY_LOG.md, EXPERIMENTS.md
Candidate Requirements: [count]
Next: Load `requirement-architect` skill.
Instruction: "Formalize CANDIDATE-XXXX entries into REQ-XXXX, preserving discovery lineage."
```

**Traceability Rule:** Every REQ-XXXX must cite:
- ≥1 discovery artifact (OBS/INS/HYP/EXP), OR
- Marked `Stakeholder Directive: Yes` with name + date

If neither → **halt**, return to Discovery phase.

## Multi-Cycle Behavior

Cycle 2+: Discovery may reference prior REQs or CRs:
```markdown
## INS-0042: [New Insight from Production Data]
**Derived From:** [Prod metrics, Cycle 1] · **Related REQs:** REQ-0012 (deprecated C2), CR-0003
**Insight:** [pattern post-launch]
```

Allows discovery → requirement updates across cycles with traceability.

## Halt Conditions

- Candidate REQ has no lineage AND no stakeholder directive
- Assumption "HIGH risk if wrong" unvalidated with no experiment plan
- Hypothesis with no success criteria
- Experiment has no measurable outcome

## Example Flow

**Input:** "Mobile checkout losing users."

**Output:**
```markdown
## OBS-0001: High Mobile Abandonment
**Source:** Analytics Q4 2025 · **Raw:** "Mobile checkout abandonment: 68% (vs desktop: 32%)"
**Confidence:** High (Google Analytics validated) · **Status:** Confirmed

## INS-0001: Multi-Step Friction
**Derived From:** OBS-0001, User Interview (5 participants) · **Insight:** Users abandon when required to create account before purchase
**Evidence:** Interview transcripts (5/5 mentioned account creation)

## HYP-0001: Guest Checkout Reduces Abandonment
**Statement:** If we add guest checkout, then mobile abandonment drops <50%, because users cite account creation as primary friction
**Derived From:** INS-0001 · **Validation:** EXP-0001 (A/B test) · **Success:** Abandonment <50% in test group
**Status:** Pending

## EXP-0001: Guest Checkout A/B Test
**Hypothesis:** HYP-0001 · **Method:** A/B (50/50, 2 weeks, mobile only)
**Success:** Abandonment <50% variant B · **Timeline:** 2 weeks · **Status:** Planned

## CANDIDATE-0001: Guest Checkout Flow
**Priority:** HIGH · **Lineage:** OBS-0001 → INS-0001 → HYP-0001 (pending EXP-0001)
**Proposed:** System shall allow purchase without account creation
**Rationale:** 68% mobile abandonment (OBS-0001); interviews cite account friction (INS-0001)
**Open Questions:** How to handle order tracking for guest users?
**Stakeholder Directive:** No
```

**Handoff:** After Gate 0 approval, requirement-architect converts CANDIDATE-0001 → REQ-0001 with lineage preserved.

## Integration Notes

**With requirement-architect:** Discovery generates CANDIDATE-XXXX → requirement-architect formalizes → REQ-XXXX
**With threat-modeler:** Can run in parallel; both feed requirement-architect
**With ux-spec-author:** Can run in parallel; both feed requirement-architect
**With logic-gatekeeper:** Logic Gatekeeper may validate assumptions are measurable/testable

## Output Summary

Produce:
1. **DISCOVERY_LOG.md** — OBS, INS, HYP, ASM with IDs + validation status
2. **EXPERIMENTS.md** — EXP-XXXX with success criteria + results
3. **Candidate REQs** — CANDIDATE-XXXX with full lineage
4. **Discovery Summary** — For Gate 0 approval

Reduces Logic Gatekeeper burden of turning subjective goals into metrics. Maintains "no silent assumptions" from start.
