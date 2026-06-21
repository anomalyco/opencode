# Phase 3 — Decision Engine Foundation

**EF-AI Architecture Specification v2**

| Field | Value |
|---|---|
| Status | ✅ **APPROVED WITH CONDITIONS** (2026-06-16) — v2 Amendment Package applied |
| Author | Principal Engineer (revised), Architecture Reviewer (final v2) |
| Supersedes | Phase 3 draft specification (Sprint E output) + v1 Amendment |
| Based on | ADR-010 through ADR-014, ADR-013 Amendment v2 + v2 Amendment (5 AR-P3 fixes) |
| Sprint F1 | **AUTHORIZED** — Architecture Reviewer sign-off required before F2 |

---

## Executive Summary

Phase 3 introduces the first implementation of the Decision Engine.

Phase 3 is a **Decision Production Phase**, not an Autonomy Phase.

**Objective**: EF-AI capable of producing GOVERNED decisions under ADR-013 and ADR-014.

**Phase 3 does NOT**:
- Execute autonomous actions
- Orchestrate agents (Phase 4)
- Mutate memory directly (ADR-014)
- Approve its own proposals (ADR-013 DA-01)
- Include HELD state (introduced in F-04 per ADR-026; full UI integration deferred to Phase 4+)

---

## Architecture Overview

### Decision Lifecycle (Revised)

```
Decision Engine (stateless)
    │
    │  1. Produce proposal from context
    │  2. Schema validation (Tier 1, pure function, no I/O)
    │
    ▼ (schema-valid proposal)
ProposalStore (subsystem of DecisionsBrain)
    │
    │  3. Contradiction check (Tier 2, Brain, KEY-BASED, indexed)
    │  4. Authority check (Tier 2, Brain, deterministic)
    │  5. AC-06 timeout guard (configurable, default 5000ms)
    │
    ├── ACCEPTED → DecisionRecord (projection: ProposalStore filtered by "ACCEPTED")
    │
    └── REJECTED + reason_code (persisted in ProposalStore)
```

### Proposal Lifecycle States (Phase 3)

```
SUBMITTED  → Proposal submitted by Engine (schema-valid)
    │
VALIDATING → Brain runs Tier 2 checks (contradiction + authority)
    │
    ├── ACCEPTED → DecisionRecord created (projection entry)
    │
    └── REJECTED → Persisted with reason_code
```

**Two terminal states only**: ACCEPTED or REJECTED. No proposal exists in limbo.

---

## Data Model

### DecisionProposal

```typescript
interface DecisionProposal {
  readonly id: string                    // unique, generated at creation
  readonly key: string                   // human-readable, unique in DecisionRecord
  readonly title: string
  readonly context: string
  readonly proposedDecision: string
  readonly consequences: string
  readonly tags: readonly string[]
  readonly origin: ProposalOrigin        // who/what generated this
  readonly createdAt: number
  readonly status: ProposalStatus
  readonly rejectionReason?: RejectionCode
  readonly validatedAt?: number          // timestamp when Tier 2 completed
  readonly validatorId?: string          // identifies the validating Brain instance
  readonly acceptedAt?: number           // AR-P3-05: persisted at terminal transition to ACCEPTED
  readonly rejectedAt?: number           // AR-P3-05: persisted at terminal transition to REJECTED
}

type ProposalStatus =
  | "SUBMITTED"
  | "VALIDATING"
  | "ACCEPTED"
  | "REJECTED"
// Note: DRAFT is Engine-internal (not persisted).
// Note: HELD excluded from Phase 3 — deferred to Phase 4.

type RejectionCode =
  | "SCHEMA_INVALID"       // Tier 1 — Engine, never touched ProposalStore
  | "DUPLICATE_KEY"        // Tier 2 — exact key match
  | "AUTHORITY_VIOLATION"  // Tier 2 — self-approval (DA-01)
  | "VALIDATION_TIMEOUT"   // AC-06 — Tier 2 exceeded timeout
  | "VALIDATION_ERROR"     // AC-06 — unexpected error during validation
// Note: CONTRADICTS_RECORD excluded from Phase 3. Tag overlap != contradiction.
// Phase 3 DUPLICATE_KEY only. Semantic contradiction deferred to Phase 4+.

interface ProposalOrigin {
  readonly proposerId: string            // identifies the proposing agent/service
  readonly sessionId?: string
  readonly contextHash?: string          // hash of evolution context at proposal time
}
```

### ProposalStore (Internal Module of DecisionsBrain)

**Owner**: DecisionsBrain

**Implementation**: Internal module within `brain/` (e.g., `brain/proposal-store.ts`), imported ONLY by `brain/decisions.ts`. NOT a separate Service, NOT a separate Layer.

**Dependency chain (ACTUAL codebase)**:
```
Decision Engine
  → Evolution.Service.decisions()        (facade, src/evolution/index.ts:117)
    → EvolutionBrain.decisions            (brain/index.ts:20)
      → EvolutionDecisions.Service        (brain/decisions.ts)
        → ProposalStore                   (brain/proposal-store.ts, internal module)
```

**Key rule**: ProposalStore is NEVER exposed to Decision Engine. Engine calls `decisions.propose()` (new method on DecisionsBrain interface), and DecisionsBrain internally delegates to ProposalStore.

**Storage**: Per-project file-based storage in `.opencode/evolution/proposals/{id}.json` (same pattern as existing `brain/decisions.ts` which stores ADRs in `.opencode/evolution/adr/{id}.json+md`). Files persist on disk across sessions.

**Principle**: Single source of truth for ALL proposals in ALL lifecycle states.

**API**:

```typescript
// Internal module API (not exposed via Effect Service)

// AR-P3-02: REQUIRED usage — decode boundary on every read, encode on every write
//   const decoded = Schema.decodeUnknown(DecisionProposalSchema)(raw)  // read
//   const encoded = Schema.encode(DecisionProposalSchema)(proposal)     // write

interface ProposalStore {
  // Write
  submit(proposal: DecisionProposal): Effect.Effect<void, EvolutionStorageError>
  updateStatus(
    id: string,
    status: ProposalStatus,
    reason?: RejectionCode
  ): Effect.Effect<void, EvolutionStorageError>

  // Read (DecisionsBrain-internal only)
  getById(id: string): Effect.Effect<Option.Option<DecisionProposal>, EvolutionStorageError>
  listByStatus(status: ProposalStatus): Effect.Effect<DecisionProposal[], EvolutionStorageError>
  existsByKey(key: string): Effect.Effect<boolean, EvolutionStorageError>
}
```

**Access rules**:
- Decision Engine writes TO ProposalStore via `Evolution.Service.decisions().propose()` (DecisionsBrain interface)
- Decision Engine never reads FROM ProposalStore directly
- DecisionsBrain owns all state transitions
- No external service can bypass DecisionsBrain to write to ProposalStore (AD-001)

**State machine guard — updateStatus (AR-P3-03)**:

```
ALLOWED transitions:
  SUBMITTED → VALIDATING
  VALIDATING → ACCEPTED     (also sets acceptedAt = Date.now())
  VALIDATING → REJECTED     (also sets rejectedAt = Date.now())

FORBIDDEN transitions (→ Effect.fail):
  ACCEPTED → anything       (DA-02: immutable)
  REJECTED → anything       (DA-03: audit trail preserved)
  SUBMITTED → ACCEPTED      (bypasses VALIDATING — would skip Tier 2)
  SUBMITTED → REJECTED      (bypasses VALIDATING — would skip Tier 2)
  ID → same status          (no-op or fail — defined at implementation)
```

**Implementation pattern**:

```typescript
// Effect.succeed — only if transition is legal
const VALID_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  SUBMITTED: ["VALIDATING"],
  VALIDATING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: [],    // terminal — immutable
  REJECTED: [],    // terminal — audit trail
}
```

### DecisionRecord (Projection Model)

**DecisionRecord is NOT a separate store.**

DecisionRecord is a **PROJECTION**: `ProposalStore.listByStatus("ACCEPTED")`

**Compatibility with existing storage architecture**:
The current `brain/decisions.ts` stores ADRs as per-project files in `.opencode/evolution/adr/{id}.json`. `listAll()` reads all files from the directory (O(n) — same pattern as memory storage). ProposalStore uses the same file-per-entry pattern.

Projection model works as follows:
- ProposalStore writes proposals as individual files in `.opencode/evolution/proposals/{id}.json`
- `DecisionRecord` = `ProposalStore.listByStatus("ACCEPTED")` — filtered read from the same directory
- No separate storage, no sync, no replication
- O(n) read is acceptable for Phase 3 per-session volume

**Eliminates**:
- Dual-source-of-truth risk
- Synchronization code
- Replication logic
- History divergence (P3-R02 — RESOLVED)

```typescript
// DecisionRecord is a view, not a store
// Reads from the SAME ProposalStore files, filtered by status
// AR-P3-05: acceptedAt is a PERSISTED field, not computed at read time
const decisionRecord = Effect.fn("DecisionsBrain.decisionRecord")(function* () {
  const proposals = yield* proposalStore.listByStatus("ACCEPTED")
  return proposals.map(toDecisionView)
})

// AR-P3-05 correction — toDecisionView reads persisted acceptedAt/rejectedAt:
//   acceptedAt: proposal.acceptedAt ?? proposal.validatedAt (fallback for F2-F3 gap)
//   rejectedAt: proposal.rejectedAt
// After F1 migration: the ?? fallback is never needed (F1 always sets acceptedAt)
```

---

## Validation Architecture

### Tier 1 — Schema Validation (Decision Engine)

```typescript
// Pure function, no I/O, synchronous
function validateSchema(proposal: DecisionProposal):
  | { valid: true }
  | { valid: false; reason: "SCHEMA_INVALID"; detail: string }

// Checks:
//   - All required fields present
//   - key non-empty, alphanumeric
//   - title non-empty
//   - context non-empty
//   - proposedDecision non-empty
//   - consequences non-empty
//   - tags is array (possibly empty)
//   - origin.proposerId non-empty
```

**Owner**: Decision Engine
**Rule**: Engine submits to Brain ONLY if schema valid. Schema-invalid proposals are rejected before touching ProposalStore.

### Tier 2 — Contradiction + Authority Validation (Evolution Brain)

```typescript
// KEY-BASED contradiction check (exact key match only)
// O(log n) with ProposalStore index on DecisionRecord
function checkContradiction(proposal: DecisionProposal):
  | { contradiction: false }
  | { contradiction: true; reason: "DUPLICATE_KEY" }

// DUPLICATE_KEY: exact key match in accepted DecisionRecord
// Phase 3 uses DUPLICATE_KEY ONLY.
// Semantic contradiction detection (e.g., tag-overlap, meaning-based)
// deferred to Phase 4+ per EF-AI principle: UNKNOWN > wrong conclusion.
// See watchlist DA-FUTURE-02.

// Authority check (ADR-013 DA-01)
function checkAuthority(proposal: DecisionProposal):
  | { authorized: true }
  | { authorized: false; reason: "AUTHORITY_VIOLATION" }
// Rule: proposal.origin.proposerId must NOT be the evolution system itself
// (no self-approval)
```

**Owner**: Evolution Brain
**Rule**: Brain receives SUBMITTED proposal from Engine, runs Tier 2, writes terminal state.

### Validation Flow

```
Engine: produce proposal from context
    │
Engine: validateSchema(proposal)
    ├── INVALID → reject SCHEMA_INVALID (never touches ProposalStore)
    │
    └── VALID → Engine calls Brain: proposalStore.submit(proposal)
                        │
                        ▼
              ProposalStore status → SUBMITTED
                        │
                        ▼
               Brain: checkContradiction(proposal)  // DUPLICATE_KEY only (Phase 3)
                        │
                        ├── CONTRADICTION → reject (status=REJECTED, reason=DUPLICATE_KEY)
                        │
                        └── NO CONTRADICTION → checkAuthority(proposal)
                                    │
                                    ├── VIOLATION → reject (status=REJECTED, reason=AUTHORITY_VIOLATION)
                                    │
                                    └── AUTHORIZED → ACCEPTED (status=ACCEPTED, DecisionRecord created)
```

---

## Architectural Constraints

| ID | Constraint | Source | Enforcement |
|---|---|---|---|
| **AC-01** | Facade Only — Decision Engine must use Evolution.Service facade only | ADR-011 SW-04 | AD-001 oxlint rule |
| **AC-02** | No Direct Memory Mutation — no direct write to MemoryBrain | ADR-014 MG-03 | Facade architecture |
| **AC-03** | No Self-Approval — Engine cannot approve own proposals | ADR-013 DA-01 | Tier 2 authority check |
| **AC-04** | No Bypass — Engine cannot create DecisionRecord directly | ADR-013 | ProposalStore single-writer |
| **AC-05** | Engine Stateless — no persistent state between invocations | ADR-013 | All state in ProposalStore (Brain-owned) |
| **AC-06** | Validation Timeout — Tier 2 has configurable timeout; on timeout → auto REJECTED | Gemini #3 + Grok A-04 | Effect.timeout + catchAll |
| **AC-07** | Structured Output — Decision Engine MUST use LLM structured output (JSON Schema) for proposal generation. No plain-text extraction, no `extractProposalFromText()`. | Gemini #3 + Grok A-04 | Code review gate: TG-AC07 |
| **AC-08** | Schema Decode Boundary — ProposalStore MUST use `Schema.decodeUnknown()` on read and `Schema.encode()` on write. Raw `JSON.parse`/`JSON.stringify` prohibited. | Architecture Reviewer AR-P3-02 | TypeScript type enforcement |

---

## Deliverables

| ID | Deliverable | Sprint |
|---|---|---|---|
| P3-D01 | DecisionProposal schema + ProposalStatus type + RejectionCode enum | F1 |
| P3-D02 | DecisionEngine service (schema validation + AC-07 structured output) | F4 |
| P3-D03 | ProposalStore (internal module, Schema.decode boundary, state machine guard) | F1 |
| P3-D04 | Tier 1 + Tier 2 validation pipeline (schema, contradiction, authority) | F2 |
| P3-D05 | DecisionRecord projection (ProposalStore → filtered VIEW) | F2 |
| P3-D06 | AC-06 timeout guard + full integration + regression | F3 |

---

## Decision Engine Service (Precise Scope)

```typescript
namespace DecisionEngine {
  interface Interface {
    /**
     * Produce a proposal from current evolution context.
     *
     * Decision Engine responsibilities:
     *   1. Read EvolutionContext (via Evolution.Service facade)
     *   2. Evaluate context against configured decision criteria
     *   3. Schema-validate the produced proposal (Tier 1)
     *   4. Submit schema-valid proposals to Brain (via Evolution.Service.decisions())
     *
     * Decision Engine does NOT:
     *   - Store proposals (Brain does, via ProposalStore)
     *   - Run contradiction checks (Brain does)
     *   - Create DecisionRecord (Brain does)
     *   - Approve proposals (prohibited by ADR-013)
     */
    readonly propose: (
      context: EvolutionContext,
      criteria: DecisionCriteria
    ) => Effect.Effect<ProposalSubmissionResult, DecisionEngineError>
  }

  interface ProposalSubmissionResult {
    readonly proposalId: string
    readonly status: "SUBMITTED" | "SCHEMA_REJECTED"
    readonly rejectionReason?: "SCHEMA_INVALID"
  }
}
```

---

## Test Gates

| ID | Test | What It Verifies | Sprint |
|---|---|---|---|---|
| P3-B01 | Boundary audit | Import graph: ProposalStore imported only by brain/decisions.ts | F1 |
| TG-09 | HELD permitted with ADR-026 | ProposalStatus permits HELD when ADR-026 advisor context is active | F1+ |
| TG-01 | Proposal creation | Valid proposal produced from context | F2 |
| TG-02 | Schema rejection | Invalid proposal rejected BEFORE ProposalStore touch | F2 |
| TG-03 | Duplicate key detection | DUPLICATE_KEY rejection from Brain (engine → submit flow) | F2 |
| TG-04 | Authority enforcement | Self-approval attempt rejected (DA-01) | F2 |
| TG-05 | Decision persistence | ACCEPTED proposal creates DecisionRecord entry | F2 |
| TG-06 | Decision immutability | Accepted DecisionRecord cannot be modified (state machine guard) | F2 |
| TG-07 | Audit preservation | REJECTED proposals visible in ProposalStore with reason_code | F2 |
| TG-08 | Validation timeout | Timeout produces VALIDATION_TIMEOUT (not limbo) | F3 |
| TG-E2E | Full workflow | End-to-end: propose → submit → validate → ACCEPTED | F4 |
| TG-REJ | Rejection path | Duplicate key → REJECTED with audit trail | F4 |
| TG-AUTH | Authority path | AUTHORITY_VIOLATION correctly rejected | F4 |
| TG-AC07 | Structured output | Engine source has no text extraction patterns | F4 |

---

## Failure Conditions (Immediate Review Trigger)

Phase 3 implementation FAILS if:

| Condition | Violation |
|---|---|
| Decision Engine has internal persistent state | AC-05 |
| Decision Engine runs contradiction check against historical data | AC-05 + Tier split |
| Decision Engine creates DecisionRecord directly | AC-04 |
| Decision Engine mutates memory directly | AC-02, ADR-014 |
| A proposal exists in limbo (no terminal state reached) | AC-06 |
| HELD state without ADR-026 context | Premature Phase 4 feature — HELD is valid only when advisor context exists |
| Two separate proposal storage locations exist | ProposalStore single-source violation |
| Direct brain imports in DecisionEngine files | AD-001 (caught by oxlint) |
| ProposalStore uses JSON.parse instead of Schema.decode | AC-08 (AR-P3-02) |
| updateStatus allows illegal transition (e.g., ACCEPTED→REJECTED) | DA-02, DA-11 (AR-P3-03) |
| ProposalStore imported outside brain/decisions.ts | DA-12, P3-B01 (AR-P3-04) |
| acceptedAt/rejectedAt not persisted as fields | AR-P3-05 |

---

## Sprint Plan

### Sprint F1 — Foundation (per Architecture Review — APPROVED WITH CONDITIONS)

**Gate**: Architecture Reviewer sign-off required before F2.

**Goal**: Establish schema + storage foundation with integrity guards. NO validation pipeline, NO engine, NO authority.

**Deliverables**: P3-D01, P3-D03
**Test Gates**: P3-B01, TG-09

- Create DecisionProposal schema, ProposalStatus, RejectionCode types
- Implement ProposalStore as internal module of DecisionsBrain (`brain/proposal-store.ts`)
- **AR-P3-02**: ProposalStore uses `Schema.decodeUnknown(DecisionProposalSchema)` on read, `Schema.encode` on write (new decode boundary standard — see ADR-013 Amendment)
- **AR-P3-03**: `updateStatus()` includes state machine guard — only `SUBMITTED→VALIDATING→ACCEPTED|REJECTED`; all others → `Effect.fail`
- **AR-P3-05**: `acceptedAt?: number` and `rejectedAt?: number` as persisted fields in DecisionProposal, set on terminal state transition
- **AR-P3-04**: P3-B01A verifies ProposalStore imported ONLY by `brain/decisions.ts` (import graph enforcement)
- Verify: ProposalStatus base types exist (SUBMITTED | VALIDATING | ACCEPTED | REJECTED)
- Note: HELD is added in F-04 per ADR-026; see PHASE3_AMENDMENT_V3.md
- Persistence: per-project file-based storage (`.opencode/evolution/proposals/{id}.json`)
- Write ProposalStore unit tests

**Explicitly NOT in F1**:
- Decision Engine service (F4)
- Tier 1 / Tier 2 validation (F2)
- DecisionRecord projection (F2)
- AC-06 timeout (F3)

### Sprint F2 — Validation + Projection

**Deliverables**: P3-D04, P3-D05
**Test Gates**: TG-01, TG-02, TG-03, TG-04, TG-05, TG-06, TG-07

- Implement Tier 1 schema validation (pure function, stateless)
- Implement Tier 2 validation pipeline:
  - Contradiction check (DUPLICATE_KEY only — Phase 3)
  - Authority check (DA-01 enforcement — no self-approval)
- Implement DecisionRecord projection (ProposalStore → filtered VIEW)
- Audit trail: ProposalStore IS the audit trail. `listByStatus()` provides complete history.
- Wire submission flow: Engine stub → Brain → ProposalStore
- Write validation + projection tests

### Sprint F3 — Timeout + Integration

**Deliverables**: P3-D06
**Test Gates**: TG-08

- Implement AC-06 timeout guard (configurable, default 5000ms, auto REJECTED on timeout or error)
- Full integration tests
- Full regression suite (Phase 2 + Phase 3)
- Verify no proposal can exist in limbo (TG-08)

### Sprint F4 — DecisionEngine + AC-07

**Deliverables**: P3-D02
**Test Gates**: TG-E2E, TG-REJ, TG-AUTH, TG-AC07

- Implement DecisionEngine service:
  - **AC-07**: MUST use LLM Structured Output (`generateStructured({ schema: DecisionProposalSchema })`)
  - **AC-05**: Stateless — no in-memory cache, no retry state accumulation
  - **AC-01**: Uses Evolution.Service facade only — no brain/* imports
- Implement AC-07 enforcement test: Engine source has no text extraction patterns
- End-to-end workflow test (propose → submit → validate → ACCEPTED/REJECTED)
- Full regression suite

---

## Open Risks

| ID | Risk | Severity | Mitigation | Target |
|---|---|---|---|---|
| P3-R01 | God Authority — Engine secretly becomes decision-maker | MEDIUM | AC-03, DA-01, TG-04 | Phase 3 |
| P3-R02 | History Divergence — DecisionRecord diverges from ProposalStore | RESOLVED | Projection model eliminates divergence | Phase 3 |
| P3-R03 | Context Ownership Drift | LOW | ADR-011 ownership model | Phase 3 |
| P3-R04 | Phase 4 Assumptions Leak | LOW | No HELD, no agent triggers, strict scope | Phase 3 |
| P3-R05 | ProposalStore Growth — accumulation of all proposals (REJECTED + ACCEPTED) | LOW | File-based per-project persistence (same pattern as current ADR storage). ProposalStore IS the audit trail — no separate construct needed. Phase 5: retention policy. See AD-CP03-03. | Phase 3 |
| P3-R06 | Validation Timeout Under Load — 5s default too short | LOW | Configurable; adjust per deployment | Phase 3 |
| P3-R07 | Schema decode boundary violation — ProposalStore uses JSON.parse instead of Schema.decode (AR-P3-02) | RESOLVED | AC-08 enforces Schema.decode/enforce boundary at F1 | Phase 3 |
| P3-R08 | State machine violation — updateStatus allows illegal transitions (AR-P3-03) | RESOLVED | Transition guard enforced at F1; TG-06 verifies immutability | Phase 3 |

---

## Watchlist (Architecture Reviewer)

| ID | Item | Risk | Target |
|---|---|---|---|
| ARCH-WATCH-P3-01 | ProposalStore Retention Strategy Undefined — when/how proposals are cleaned up | LOW | Phase 5 |
| DA-FUTURE-02 | Contradiction Logic Evolution — tag overlap ≠ semantic contradiction | MEDIUM | Phase 4+ |

---

## Success Criteria

Phase 3 is **ACCEPTED** when:

- [ ] Decision Engine produces proposals from context
- [ ] ProposalStore persists all proposals in all states
- [ ] Brain validates + records accepted proposals
- [ ] Rejected proposals visible with reason_code
- [ ] No proposal in limbo (TG-08 passes)
- [ ] HELD state only used in ADR-026 advisor context (engine + reconciliation-log)
- [ ] No ADR-013 violations (TG-04 passes)
- [ ] No ADR-014 violations (no direct memory mutation)
- [ ] No direct brain imports (AD-001 oxlint passes)
- [ ] All 9 test gates pass
- [ ] Full regression suite passes (Phase 2 + Phase 3 tests)

Evidence requirements per ADR-012 v2: all deliverables require grep source reference + bun test output + build clean. Human narrative NOT accepted as evidence.
