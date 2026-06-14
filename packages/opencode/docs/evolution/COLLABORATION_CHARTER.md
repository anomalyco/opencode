# Collaboration Charter

**Hierarchy**: Level 1
**Owner**: Architecture Reviewer
**Purpose**: Define roles, authority, and decision process for EF-AI development
**Last updated**: 2026-06-13

---

## Roles

| Role | Entity | Responsibility |
|---|---|---|
| **Chief Architect** | User | Final authority. Approves/denies phase gates, scope changes, and architectural direction. |
| **Architecture Reviewer** | ChatGPT | Reviews architecture decisions. Maintains principles, debt registry, and documentation integrity. Must be falsifiable. No implementation. |
| **Executor** | Claude/OpenCode | Implements approved plans. Submits evidence for gate review. Does not declare VERIFIED or ACCEPTED. |

---

## Authority Hierarchy

```
Chief Architect (User)
    └── Architecture Reviewer (ChatGPT)
            └── Executor (Claude/OpenCode)
```

- Lower role may propose. Higher role approves.
- Executor cannot override Architecture Reviewer on architecture decisions.
- Architecture Reviewer cannot override Chief Architect on scope/priority.
- Chief Architect delegates architecture review to Reviewer but retains veto.

---

## Gate Process

Every phase progresses through exactly three gates:

```
IMPLEMENTED → VERIFIED → ACCEPTED
```

| Gate | Declared by | Evidence required |
|---|---|---|---|
| IMPLEMENTED | Executor | Code exists, reviewed, meets ADR contract |
| VERIFIED | Architecture Reviewer | Tests green, typecheck clean, boundary audit pass |
| ACCEPTED | Chief Architect (Owner) | Verification evidence reviewed, architecture confirmed, debt named |

**Rule**: No phase may start until previous phase is IMPLEMENTED + VERIFIED + ACCEPTED.
**Exception**: Only Chief Architect may waive this (documented, with reason).

---

## Decision Types

| Type | Who decides | Example |
|---|---|---|
| Architecture Decision | Architecture Reviewer + Chief Architect | ADR acceptance, boundary choice |
| Implementation Detail | Executor | Variable naming, file organization |
| Phase Scope | Chief Architect | What goes in each phase |
| Documentation | Shared | Architecture Reviewer approves structure, Executor writes |

---

## Evidence Rule

Every architecture claim must be backed by evidence.

| Classification | Meaning | Example |
|---|---|---|
| FACT | Demonstrated, verified, measurable | "38/38 tests pass" |
| INFERENCE | Derived from evidence, testable | "O(n²) pattern will fail at 10k entries" |
| HYPOTHESIS | Proposed, not yet tested | "God Object risk may manifest in Phase 4" |
| UNKNOWN | No data available | "Phase 7 requirements undefined" |

Claims without classification will be challenged by Architecture Reviewer.

---

## Falsifiability

Every architecture claim must be structured so it can be proven wrong.

**Good**: "If Phase 2 adds a 6th method to Evolution.Service without refactoring, facade registry pattern is not being followed."
**Bad**: "The architecture is solid."

---

## Prohibitions

1. **No unilateral VERIFIED/ACCEPTED declaration** — Executor submits evidence, Reviewer decides.
2. **No status in two places** — EF-AI_STATE.md is the single source of truth.
3. **No chat-only decisions** — Every ADR must be documented in DECISIONS.md.
4. **No debt without a name** — Every AD/TD must be registered.
5. **No hypothesis promoted to debt without evidence** — Must demonstrate architectural impact first.

---

## Communication Protocol

- **Architecture Reviewer outputs** should be labeled with classification: `[FACT]`, `[INFERENCE]`, `[HYPOTHESIS]`, `[UNKNOWN]`.
- **Executor outputs** should clearly separate evidence submission from interpretation.
- **Chief Architect decisions** are final and should be acknowledged in SESSION_LOG.md.

---

## Amendment

This charter may be amended by Chief Architect with Architecture Reviewer consultation.
Amendments must be documented with date and reason.
