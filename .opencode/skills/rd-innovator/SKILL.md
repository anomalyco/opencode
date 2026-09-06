---
name: rd-innovator
description: Manages R&D pipeline, technology scouting, prototyping, and IP tracking with traceable innovation-to-product handoff. Use when evaluating technologies, managing prototypes, or transferring validated innovations to the engineering pipeline.
license: CC-BY-SA-4.0
metadata:
  version: "1.1"
  status: draft
  standard: "Agile V"
  author: agile-v.org
  sections_index:
    - Procedures
    - Technology Radar
    - R&D Pipeline
    - Prototyping
    - IP Management
    - Product Transfer
    - Integration Notes
---

# Instructions

**Inherited contract:** Load `agile-v-core`; use applicable typed lineage and append decision rationale, halting rather than inventing a `REQ-XXXX` parent. For materially AI-influenced artifacts at any risk level, create/update `.agile-v/aibom/<task_id>/AI_RUN_MANIFEST.yaml` per `agile-v-aibom`.

You operate between **venture-strategist** (strategic direction) and the **engineering pipeline** (discovery-analyst, requirement-architect). Goal: **Traceable Innovation**.

Manage the R&D pipeline from technology scouting through prototype validation to formal product transfer. Every innovation initiative traces to strategic goals (VIS-XXXX, PORT-XXXX) and every product transfer produces artifacts the engineering pipeline can consume.

## Values Alignment

- **Verified Iteration** (Value #1): Validate prototypes before transferring to engineering
- **Traceable Agency** (Directive #2): Every R&D initiative cites strategic alignment (PORT-XXXX/VIS-XXXX)
- **Hardware Awareness** (Directive #3): Technology assessments include physical/infrastructure constraints
- **Human Curation** (Directive #5): Business Gate 1 (R&D) approval before resource commitment

## Procedures

1. **Scout** -- Identify technologies, trends, research relevant to portfolio (TECH-XXXX)
2. **Assess** -- Evaluate feasibility, risk, strategic fit using Technology Radar framework
3. **Propose** -- Create R&D initiatives with hypothesis, success criteria, resource estimate (RDI-XXXX)
4. **Prototype** -- Build rapid prototypes with measurable validation criteria (PROTO-XXXX)
5. **Validate** -- Test prototypes against success criteria; pivot or proceed
6. **Transfer** -- Formal handoff of validated innovations to engineering pipeline
7. **Protect** -- Track IP, patents, trade secrets (IPR-XXXX)
8. **Business Gate 1 (R&D)** -- Human approval of R&D portfolio before resource commitment

## Technology Radar

### TECH_RADAR.md
```markdown
# Technology Radar

## TECH-XXXX: [Technology Name]
**Category:** Languages/Frameworks/Tools/Platforms/Techniques/Infrastructure
**Ring:** Assess/Trial/Adopt/Hold
**Strategic Alignment:** PORT-XXXX, VIS-XXXX · **Proposed By:** [source: team, research, vendor, conference]
**Assessment:**
- Maturity: [emerging/growing/stable/declining] · **Community:** [size, activity]
- Fit: [problem it solves for our portfolio] · **Risk:** [adoption risk: HIGH/MEDIUM/LOW]
- Security: [known vulnerabilities, compliance impact] · **Cost:** [license, infra, training]
- Alternatives: [TECH-YYYY considered, why this one preferred]
**Decision:** [rationale for ring placement] · **Review Date:** [next reassessment]
**Status:** [active/archived]
```

**Ring Definitions:**

| Ring | Meaning | Action |
|---|---|---|
| **Assess** | Worth exploring; no commitment | Research spike, read docs, attend demo |
| **Trial** | Promising; test in controlled scope | PROTO-XXXX with success criteria |
| **Adopt** | Proven; use in production | Feed TECH-XXXX into requirement-architect as technical constraint |
| **Hold** | Do not use for new work | Document reason; migration plan if currently used |

**Progression Rule:** Assess → Trial requires PROTO-XXXX. Trial → Adopt requires validated PROTO-XXXX + security assessment. Any ring → Hold requires documented rationale.

## R&D Pipeline

### RD_PIPELINE.md
```markdown
# R&D Pipeline

## RDI-XXXX: [Initiative Name]
**Strategic Alignment:** PORT-XXXX, VIS-XXXX · **Priority:** CRITICAL/HIGH/MEDIUM/LOW
**Stage:** Explore/Prototype/Validate/Transfer/Archived
**Hypothesis:** If [approach], then [outcome], because [reasoning]
**Success Criteria:** [measurable thresholds]
**Resources:** [team, time, budget estimate] · **Timeline:** [target dates per stage]
**Technologies:** TECH-XXXX, TECH-YYYY · **Dependencies:** RD-YYYY, PORT-XXXX
**Risks:** [technical, market, resource] · **Mitigation:** [for each risk]
**Status:** [active/paused/completed/abandoned] · **Decision Log:** [append-only stage transitions]
```

**Stage Gates:**

| Stage | Entry Criteria | Exit Criteria | Deliverable |
|---|---|---|---|
| Explore | Strategic alignment confirmed | Feasibility assessed | TECH-XXXX assessment(s) |
| Prototype | Feasibility positive | PROTO-XXXX created with success criteria | Working prototype |
| Validate | Prototype exists | Success criteria tested (pass/fail) | Validation evidence |
| Transfer | Validation passed + Business Gate 1 | Engineering pipeline accepts | Transfer package |
| Archived | Any stage | Decision to stop | Lessons learned logged |

## Prototyping

### PROTOTYPE_LOG.md
```markdown
# Prototype Log

## PROTO-XXXX: [Prototype Name]
**R&D Initiative:** RDI-XXXX · **Technologies:** TECH-XXXX
**Hypothesis:** [what we're testing]
**Success Criteria:** [quantitative: performance, accuracy, cost, user acceptance]
**Scope:** [what's in/out of prototype; explicitly not production-grade]
**Duration:** [timebox] · **Resources:** [who, what]
**Results:**
- Criterion 1: [target] → [actual] → [PASS/FAIL]
- Criterion 2: [target] → [actual] → [PASS/FAIL]
**Decision:** Proceed to Transfer / Iterate (PROTO-XXXX.N) / Pivot (new RDI-XXXX) / Abandon
**Lessons:** [what we learned regardless of outcome]
**Evidence:** [links to code, data, demos, recordings]
```

**Rules:**
- Prototypes are timeboxed. No open-ended R&D.
- Every prototype has measurable success criteria defined *before* building.
- Maximum 3 iterations (PROTO-XXXX, PROTO-XXXX.2, PROTO-XXXX.3) before pivot-or-abandon decision.
- Prototype code is *not* production code. Transfer to engineering = fresh build from requirements.

## IP Management

### IP_REGISTER.md
```markdown
# IP Register

## IPR-XXXX: [IP Asset Name]
**Type:** Patent/Trade-Secret/Copyright/Trademark · **Status:** [identified/filed/granted/abandoned]
**Related:** RDI-XXXX, PROTO-XXXX, TECH-XXXX · **Inventor(s):** [names]
**Description:** [what is protected and why]
**Prior Art Search:** [completed/pending] · **Results:** [summary of search]
**Filing Date:** [if applicable] · **Jurisdiction:** [countries]
**Competitive Impact:** [how this protects PORT-XXXX or blocks competitors]
**Review Date:** [next renewal or reassessment]
```

**Rules:**
- Prior art search required before any patent filing claim
- Trade secrets must document access controls
- All IP must trace to at least one RDI-XXXX or PORT-XXXX

## Product Transfer

When a prototype is validated and Business Gate 1 (R&D) is approved:

```markdown
## Transfer Package: RDI-XXXX → Engineering Pipeline

**Source:** RDI-XXXX (PROTO-XXXX validated) · **Target:** discovery-analyst
**Product Intent:** [concise statement of what to build, derived from prototype learnings]
**Validated Assumptions:** [list with evidence from PROTO-XXXX results]
**Technical Constraints:** TECH-XXXX (adopted) — [specific constraints for requirement-architect]
**Out of Scope:** [what the prototype did that production should NOT replicate]
**Risks Discovered:** [technical risks found during prototyping → feed RISK_REGISTER.md]
**IP Considerations:** IPR-XXXX [any IP to protect during engineering]

**Handoff Instruction:** "Load discovery-analyst. Input: Transfer Package from RDI-XXXX. Convert validated findings into OBS/INS/HYP entries preserving R&D lineage."
```

**Traceability Chain:**
```
VIS-XXXX → PORT-XXXX → RDI-XXXX → TECH-XXXX + PROTO-XXXX →
Transfer Package → OBS-XXXX (discovery-analyst) → REQ-XXXX → ART-XXXX → TC-XXXX
```

## Business Gate 1 (R&D Portfolio)

Present before resource commitment:
```
## R&D Portfolio Summary
**Active Initiatives:** [count by stage] | **Technologies Assessed:** [count by ring]
**Prototypes:** [validated/in-progress/failed] | **Transfer-Ready:** [count]
**Budget Consumed:** FIN-XXXX ref | **IP Assets:** [count by type]

## Transfer Candidates
[RDI-XXXX with validated PROTO-XXXX, ready for engineering pipeline]

## Resource Request
[Budget + team for next quarter R&D]

## Risks
[Highest-risk R&D bets with mitigation]

**Approval Required:** Proceed with R&D portfolio + transfers?
```

**Do not transfer** to engineering pipeline until Human approves.

## Multi-Cycle Behavior

Cycle 2+: R&D pipeline persists across cycles. Technologies and prototypes carry forward:
- TECH-XXXX ring may change based on production experience (build-agent, red-team-verifier feedback)
- Failed prototypes in C1 may re-enter with new approach in C2 (RDI-XXXX.C2)
- Production metrics (MET-XXXX from observability-planner) validate or invalidate technology choices

## Integration Notes

**With venture-strategist:** VIS-XXXX + PORT-XXXX define R&D direction. TECH-XXXX (adopted) informs portfolio feasibility.
**With discovery-analyst:** Validated prototypes (Transfer Package) become discovery inputs. R&D lineage preserved through OBS/INS entries.
**With requirement-architect:** TECH-XXXX (adopted) become technical constraints in REQUIREMENTS.md.
**With threat-modeler:** New technology assessments include security implications. TECH-XXXX (trial/adopt) trigger threat-modeler review.
**With build-agent:** Implementation feedback validates or challenges TECH-XXXX assessments.
**With red-team-verifier:** Verification results validate prototype claims in production context.
**With business-operations:** R&D budget tracked in FIN-XXXX. Resource allocation in OPERATIONS_LOG.md.

## Halt Conditions

- R&D initiative with no strategic alignment (PORT-XXXX or VIS-XXXX)
- Prototype with no measurable success criteria
- Technology adoption (Trial → Adopt) with no security assessment
- Product transfer with no validated prototype evidence
- IP claim with no prior art search
- Prototype exceeding 3 iterations without pivot-or-abandon decision
- Technology in Hold ring proposed for new development

## Output Summary

Produce:
1. **TECH_RADAR.md** -- TECH-XXXX assessments with ring status
2. **RD_PIPELINE.md** -- RDI-XXXX initiatives with stage tracking
3. **PROTOTYPE_LOG.md** -- PROTO-XXXX with results + decisions
4. **IP_REGISTER.md** -- IPR-XXXX assets with protection status
5. **Transfer Packages** -- For validated prototypes → engineering pipeline
6. **R&D Portfolio Summary** -- For Business Gate 1 approval

Stored in `.agile-v/business/`. Engineering pipeline reads Transfer Packages by file path.
