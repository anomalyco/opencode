# Architecture Notes

**Purpose**: Lessons learned, process observations, and non-binding architectural guidance.
**Relationship**: Not a decision record, not a debt entry, not a risk. Observations that improve future process quality.

---

## ARCH-NOTE-CP03-DOC-DRIFT — Documentation-Implementation Divergence

| Field | Value |
|---|---|
| **Date** | 2026-06-15 |
| **Type** | Lesson Learned (not debt) |
| **Subject** | Sprint C-Patch documentation claimed `extraLayers` was implemented; audit proved no source code existed |

### What Happened

During Sprint C-Patch documentation, the design approach (`LocationServiceMap.extraLayers`) was recorded as "implemented" in DECISIONS.md, SESSION_LOG.md, and EF-AI_STATE.md. A subsequent dead-code audit (ARCH REVIEW, 2026-06-15) found:

- **`extraLayers`**: Zero source code — no declaration, no read, no write in any file
- **`registerExtra`**: The actual implementation — declared in `builtins.ts:11`, written in `app-runtime.ts:57`, consumed in `builtins.ts:47-49`
- **Root cause**: Design discussion was documented as "implemented" before source verification

### Impact

- AD-CP03-01 (extraLayers silent overwrite risk) was entered as ACTIVE debt for a mechanism that never existed
- Two review cycles were spent comparing approaches that were never both in the codebase
- Timeline accuracy in DECISIONS.md and SESSION_LOG.md was compromised
- Future reviewers would have falsely believed `extraLayers` was once implemented and then removed

### Mitigation (Process Rule) → Formalized as P-11 → ADR-012 v2

The rule below was elevated to **P-11 Evidence Gate** in `ARCHITECTURAL_PRINCIPLES.md` (2026-06-15), then further refined to **ADR-012 v2 (Evidence Lifecycle)** in `DECISIONS.md`. ADR-012 v2 replaces checklist-based evidence with:
- Evidence Lifecycle state machine (PROPOSED → IMPLEMENTING → IMPLEMENTED_UNVERIFIED → VERIFIED → ACCEPTED)
- Provenance verification (bukan format verification — lihat `DECISIONS.md` ADR-012 v2 Q2)
- Evidence Window (session-based, bukan per-claim rerun)
- 5 artifact classes (Source, Test, Integration, Architecture, Governance)

Sprint D D-01 target: ADR-012 v2 ACCEPTED (2026-06-16 — Chief Architect).

Future ACCEPTED status updates for any implementation claim MUST include:

1. **Source reference** — specific file path(s) containing the implementation
2. **Code location** — line number(s) where the implementation lives
3. **Verification evidence** — how the implementation was confirmed (test output, runtime trace, etc.)
4. **Test evidence** — test file path + number of assertions

Without all four, the status must use one of:
- `PROPOSED` — design exists, code may or may not exist
- `PLANNED` — design accepted, implementation not started
- `IN PROGRESS` — partial implementation, not yet verifiable

**"IMPLEMENTED" requires code + test evidence.**

### Source-of-Truth Hierarchy (Explicit)

| Level | Authority |
|---|---|
| 1 — Runtime behavior | Final truth |
| 2 — Source code | Primary verifiable representation |
| 3 — Tests | Executable specification |
| 4 — Documentation | Secondary record, always subordinate to code |

Documentation discrepancies must be resolved in favor of source code.
