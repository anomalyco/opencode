# Phase 3 Amendment v3 — HELD State Inclusion

| Field | Value |
|---|---|
| Status | ✅ **APPROVED** (2026-06-19) |
| Author | Principal Engineer |
| Supersedes | PHASE3_SPECIFICATION.md (v2, 2026-06-16) |
| Based on | ADR-026 (Human-in-the-Loop & HELD State) |
| Motivation | F-04/F-06: Prevent unsafe concurrent activation without human review |
| Classification | Specification Amendment — pre-implementation for F-04 |

---

## Rationale

Phase 3 v2 explicitly excluded HELD from `ProposalStatus` (TG-09) as a deliberate scope boundary. The reasoning at the time:

> Phase 3 produces GOVERNED decisions under ADR-013 and ADR-014. HELD requires human-in-the-loop infrastructure which is Phase 4+ territory.

F-04 introduced the risk agent and advisor context, which creates a concrete need for HELD:

1. **Risk agent can veto proposals with critical recommendations** → outcome must be `HELD_FOR_REVIEW`, not silent rejection
2. **Concurrent activation (F-01)** requires the activation lock flag — but a lock alone cannot distinguish between "waiting for human" vs "in-flight computation"
3. **ADR-026** provides the full specification for human-in-the-loop; F-04 implements only the schema and engine portions (HL-H-01 + HL-H-03); the UI layer (HL-H-02) remains deferred

Adding HELD in F-04 (not Phase 3 F1) is consistent with the original sprint plan — the schema is established in F1, and the state machine is extended in F4 when the advisor system is implemented.

---

## Spec Changes

### Line 28 — Executive Summary

**Before**:
```
- Include HELD state (deferred to Phase 4)
```

**After**:
```
- Include HELD state (introduced in F-04 per ADR-026; full UI integration deferred to Phase 4)
```

### Line 381 — TG-09 Test Gate

**Before**:
```
| TG-09 | No HELD state | ProposalStatus enum has no HELD member (compile-time) | F1 |
```

**After**:
```
| TG-09 | HELD permitted with ADR-026 | ProposalStatus permits HELD when ADR-026 advisor context is active | F1+ |
```

### Line 408 — Failure Condition

**Before**:
```
| HELD state appears in code | Premature Phase 4 feature |
```

**After**:
```
| HELD state without ADR-026 context | Premature Phase 4 feature — HELD is valid only when advisor context exists |
```

### Line 435 — Sprint F1 Deliverable

**Before**:
```
- Verify: ProposalStatus enum has no HELD member (TG-09, compile-time check)
```

**After**:
```
- Verify: ProposalStatus schema exists with SUBMITTED | VALIDATING | ACCEPTED | REJECTED (F1 base)
- Note: HELD is added in F-04 per ADR-026; see PHASE3_AMENDMENT_V3.md
```

### Line 517 — Success Criteria

**Before**:
```
- [ ] No HELD state in codebase (TG-09 passes)
```

**After**:
```
- [ ] HELD state only used in ADR-026 advisor context (engine + reconciliation-log)
```

---

## Updated State Machine

```
Engine: produce proposal from context
    │
Engine: validateSchema(proposal)
    ├── INVALID → reject SCHEMA_INVALID
    │
    └── VALID → submit to Brain
                        │
                        ▼
              ProposalStore status → SUBMITTED
                        │
                        ▼
               Engine reconcile():
               ConsensusStrategy.select(candidates)
                        │
               ├── advisor veto (critical + REJECT)
               │   → outcome: HELD_FOR_REVIEW
               │   → ProposalStore status: HELD
               │
               ├── candidate selected
               │   → outcome: PROPOSAL_SUBMITTED
               │   → brain validation → ACCEPTED | REJECTED
               │
               ├── no candidates
               │   → outcome: NO_CANDIDATES
               │
               └── below confidence threshold
                   → outcome: BELOW_THRESHOLD
```

HELD transitions:
```
HELD → ACCEPTED  (human approves)
HELD → REJECTED  (human rejects, or auto-expiry)
```

---

## Scope Boundary

| Aspect | In Scope (F-04) | Deferred |
|---|---|---|
| `ProposalStatus` — HELD member | ✅ Schema extension | |
| `ReconciliationOutcome` — HELD_FOR_REVIEW | ✅ Engine outcome | |
| `AdvisorContext` — critical + recommendationCategory | ✅ Risk agent output | |
| Manual review UI | | ❌ HL-H-02 (Phase 4) |
| Auto-expiry of HELD proposals | | ❌ Requires config + scheduler (Phase 4) |
| Notification system | | ❌ Phase 4+ |

---

## Related Documents

- ADR-026 — Human-in-the-Loop & HELD State (full spec)
- PHASE3_SPECIFICATION.md (v2 — superseded by this amendment)
