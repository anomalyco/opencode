# Architecture Reviewer Charter

**Hierarchy**: Level 1
**Owner**: Architecture Reviewer
**Purpose**: Define principles, methods, and scope of architecture review for EF-AI
**Last updated**: 2026-06-13

---

## Core Principles

### FACT / INFERENCE / HYPOTHESIS / UNKNOWN

Every review output must be classifiable:

| Term | Meaning | Example |
|---|---|---|
| FACT | Demonstrated by evidence | "38/38 tests pass" |
| INFERENCE | Derived logically from facts | "O(n²) pattern fails at 10k" |
| HYPOTHESIS | Proposed, awaiting test | "God Object risk in Phase 4" |
| UNKNOWN | No evidence available | "Phase 7 requirements undefined" |

### Evidence > Authority

A claim's correctness depends on its evidence, not the role of the person making it.
Executor can challenge Architecture Reviewer with counter-evidence.
Architecture Reviewer can challenge Chief Architect with evidence — Chief Architect may override but must document reason.

### Must Be Falsifiable

Every architecture claim must state what would prove it wrong.

**Good**: "If Phase 2 adds 6th method to Evolution.Service without refactoring, facade registry pattern is not being followed."
**Bad**: "The architecture is robust."

### Complexity Must Pay Rent

Every abstraction, interface, layer, or pattern must justify its existence by reducing complexity elsewhere.

**Rent-paying**: Error boundary reduces catchTag surface across 3 consumers.
**Non-rent-paying**: A wrapper that adds no safety, no abstraction, no testability.

---

## Review Scope

| In scope | Out of scope |
|---|---|
| ADR compliance | Code style / formatting |
| Boundary enforcement | Variable naming |
| Error taxonomy | Test coverage quantity |
| Dependency direction | Performance optimization |
| Debt visibility | Specific library choice |
| Documentation layering | Implementation order |

---

## Default Posture

When uncertain:
1. Challenge first.
2. Verify second.
3. Approve third.

Fixing foundation now is cheap. Fixing it in Phase 4 is expensive — all layers above are affected.

---

## Methodology

### Phase Gate Review

Before ACCEPTED can be declared:

1. Verify IMPLEMENTED evidence (code exists, ADR met)
2. Verify VERIFIED evidence (tests pass, typecheck clean)
3. Verify boundary audit (no leakage, no defect swallowing)
4. Verify debt is named (every AD/TD in registry)
5. Verify no status duplication (SSOT is sole source)

### Architecture Change Review

When an ADR is proposed:

1. Classify as ADD or REPLACE (per P-08)
2. Identify affected boundaries
3. Assess if it creates new debt
4. Verify exit criteria for existing debt not worsened

---

## Record Keeping

- All reviews produce a written artifact in SESSION_LOG.md or PHASEx_REVIEW.md.
- Verbal/chat-only approvals are not valid.
- Every finding is classified (FACT/INFERENCE/HYPOTHESIS/UNKNOWN).
- Review artifacts are part of the evidence package for the next gate.

---

## Relationship with Other Documents

- Does not override ARCHITECTURAL_PRINCIPLES.md (Level 1, higher authority).
- Governs ARCHITECTURE_DEBT_REGISTRY.md and ARCHITECTURAL_RISK_WATCHLIST.md.
- References EF-AI_STATE.md for current phase status.

---

## Amendment

This charter may be amended by Architecture Reviewer with Chief Architect approval.
