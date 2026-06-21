# Phase 4 — High-Level Design (P4-DR1)

**Status**: DRAFT (pending Architecture Review acceptance)
**Author**: Principal Engineer (Claude)
**Date**: 2026-06-16
**Source**: PHASE4_SPECIFICATION.md (P4-DR1 corrections applied)

---

## DR1-A — Full Ownership Matrix

| Component | Owns | Creates | Persists | May Read | May NOT |
|---|---|---|---|---|---|
| **AgentCoordinator** | Fan-out orchestration | Candidate collection request, Effect.all scope | Nothing | Evolution.Service facade (context + criteria) | Filter candidates, rank agents, access brain/*, register agents |
| **AgentRegistry** | Agent lifecycle (compile-time) | Agent list | Nothing | Agent interface definitions | Runtime registration, hot-reload agents |
| **DecisionEngine** | Reconciliation decision, confidence mapping | ReconciliationLog, formal DecisionProposal | ReconciliationLog (logical), Proposal (via submit) | ProposalCandidate[], ConfigEvolution | Self-approve, create DecisionRecord directly |
| **ReconciliationStrategy** | Selection algorithm (interface) | Winner determination | Nothing | ProposalCandidate[], threshold config | Direct storage access, modify candidates |
| **ReconciliationLog** | Audit trail (data model) | Nothing (created by Engine) | Nothing (persisted by Brain) | Nothing (written once, read-only after) | Influence future decisions, store full context |
| **Brain (DecisionsBrain)** | Validation, persistence | Validation result, terminal state | ReconciliationLog (physical), ProposalStore | ProposalStore, ConfigEvolution | Create reconciliation decision, influence algorithm |
| **ProposalStore** | Proposal persistence | Nothing | DecisionProposal files | Proposal data (read/write via Brain) | Accept writes from agents |

### Key ownership rules

1. **Engine creates log, Brain persists log** — DecisionEngine owns reconciliation *result*, DecisionsBrain owns *persistence*. This prevents the Brain from influencing the reconciliation algorithm.
2. **Coordinator: collect only** — AgentCoordinator receives all candidates, passes ALL to Engine. No filtering, no ranking, no reconciliation.
3. **ReconciliationStrategy is abstract** — Interface defined in G1, first impl (`ConfidenceStrategy`) in G3. Prevents God DecisionEngine.

---

## DR1-B — Sequence Diagrams

### Happy Path (Candidate Selected)

```
AgentCoordinator              Agents              DecisionEngine        Brain
      │                          │                     │                 │
      │  receive(EvolutionContext + Criteria)           │                 │
      │                          │                     │                 │
      │  fan-out (Effect.all parallel)                  │                 │
      │  ├──► ResearchAgent ────┤                     │                 │
      │  ├──► RiskAgent ────────┤──── ProposalCandidate[] ──►           │
      │  └──► PlanningAgent ────┤                     │                 │
      │                          │                     │                 │
      │                                              │  reconcile()     │
      │                                              │  ├─ map: ordinal → confidenceScore
      │                                              │  ├─ sort: descending
      │                                              │  ├─ select: highest >= threshold
      │                                              │  └─ winner: Agent "research"
      │                                              │                     │
      │                                              │  create Reconcil-  │
      │                                              │  iationLog         │
      │                                              │  ├─ outcome:       │
      │                                              │  │  PROPOSAL_SUBMITTED
      │                                              │  ├─ selected:      │
      │                                              │  │  "research"     │
      │                                              │  └─ reason:        │
      │                                              │     HIGHEST_       │
      │                                              │     CONFIDENCE     │
      │                                              │                     │
      │                                              │  persist ────────► persist Recon- │
      │                                              │  ReconciliationLog  ciliationLog  │
      │                                              │  (AC-17: log       (owned: Brain) │
      │                                              │   BEFORE submit)                 │
      │                                              │                     │
      │                                              │  create DecisionProposal         │
      │                                              │  submit() ─────────► submit()     │
      │                                              │                     │
      │                                              │                     │  Tier 1 +    │
      │                                              │                     │  Tier 2       │
      │                                              │                     │  validation   │
      │                                              │                     │       │       │
      │                                              │                     │  ACCEPTED     │
      │                                              │  ProposalResult ◄───│  (or REJECTED)│
```

### BELOW_THRESHOLD Path (All Candidates Rejected)

```
AgentCoordinator              Agents              DecisionEngine        Brain
      │                          │                     │                 │
      │  receive(EvolutionContext + Criteria)           │                 │
      │                          │                     │                 │
      │  fan-out (Effect.all parallel)                  │                 │
      │  ├──► ResearchAgent ────┤    reasoningStrength: "low"            │
      │  ├──► RiskAgent ────────┤─── ProposalCandidate[] ──►             │
      │  └──► PlanningAgent ────┤    reasoningStrength: "medium"         │
      │                          │                     │                 │
      │                                              │  reconcile()     │
      │                                              │  ├─ map: ordinal → confidenceScore
      │                                              │  │   "low" → 0.2
      │                                              │  │   "medium" → 0.5
      │                                              │  ├─ compare vs minCandidateConfidence (0.3)
      │                                              │  │   0.2 < 0.3 ✗
      │                                              │  │   0.5 >= 0.3 ✓
      │                                              │  │   0.5 >= 0.3 ✓
      │                                              │  ├─ select: PlanningAgent (highest)
      │                                              │  │   BUT: 0.5 >= 0.3, so threshold met
      │                                              │  └─ winner: PlanningAgent
      │
      │  ALTERNATIVE: ALL "low" → all < 0.3:
      │
      │                                              │  create Reconcil-  │
      │                                              │  iationLog         │
      │                                              │  ├─ outcome:       │
      │                                              │  │  BELOW_THRESHOLD│
      │                                              │  ├─ selected: null │
      │                                              │  └─ reason:        │
      │                                              │     ALL_BELOW_     │
      │                                              │     THRESHOLD      │
      │                                              │                     │
      │                                              │  persist ────────► persist       │
      │                                              │  [NO submit]       [NO validate]  │
      │                                              │                     │             │
      │                                              │  return             │             │
      │                                              │  { outcome:         │             │
      │                                              │    "BELOW_          │             │
      │                                              │    THRESHOLD" }     │             │
```

---

## DR1-C — DecisionEngine Reconciliation Algorithm

### Step-by-step deterministic flow

```
Input:  ProposalCandidate[] (from AgentCoordinator)
Input:  ConfigEvolution (minCandidateConfidence, reconciliationStrategy)
Output: ReconciliationLog + optional DecisionProposal

1.  VALIDATE: candidates array non-empty
      → if empty: return BELOW_THRESHOLD (no agents produced output)

2.  MAP: for each candidate, compute confidenceScore from reasoningStrength
      confidenceScore = SCORING_CONTRACT[reasoningStrength]
      Uses SCORING_CONTRACT (see DR1-D)

3.  FILTER (conceptual, not Candidate removal):
      aboveThreshold = candidates.filter(c => c.confidenceScore >= minCandidateConfidence)

4.  CHECK: if aboveThreshold is empty
      → log = create ReconciliationLog(outcome: BELOW_THRESHOLD, selected: null)
      → persist(log) [AC-17]
      → return { outcome: "BELOW_THRESHOLD", log }

5.  SELECT: sort aboveThreshold by confidenceScore descending
      → winner = aboveThreshold[0] (highest confidenceScore)
      → In CONFIDENCE strategy: confidenceScore is continuous (default mapping:
        low=0.2, medium=0.5, high=0.85). Extremely unlikely equal.
        If equal: first-produced wins (stable sort by producedAt ascending)

6.  CREATE: ReconciliationLog
      outcome: "PROPOSAL_SUBMITTED"
      selectedCandidateAgentId: winner.agentId
      selectionReason: "HIGHEST_CONFIDENCE"
      candidates: summary of all (including losers)

7.  PERSIST: ReconciliationLog [AC-17]
      → if persist fails: STOP — do NOT submit proposal [AC-17]
      → return failure error

8.  CREATE: DecisionProposal from winner candidate
      → map winner.proposedAction → DecisionProposal.title
      → map winner.rationale → DecisionProposal.context
      → map winner.tags → DecisionProposal.tags
      → origin: { proposerId: "decision-engine" } (existing Phase 3)

9.  SUBMIT: DecisionProposal via evolution.decisions().submit()
      → existing Phase 3 validation pipeline (Tier 1 + Tier 2)

10. RETURN: ReconciliationLog + ProposalSubmissionResult
```

### Algorithm properties

| Property | Guarantee |
|---|---|
| **Deterministic** | Same input → same output (pure function up to persistence step) |
| **Terminating** | Always reaches terminal state (BELOW_THRESHOLD or PROPOSAL_SUBMITTED) |
| **Auditable** | Full trail via ReconciliationLog (persisted BEFORE submit) |
| **Non-blocking** | Reconciliation is synchronous (no I/O until persist step) |
| **Configurable** | Algorithm selected via ConfigEvolution.reconciliationStrategy |

---

## DR1-D — Confidence Scoring Contract

### Ordinal → Numeric Mapping

```typescript
// SCORING_CONTRACT — pure function, deterministic
// Semua agent di Phase 4 menggunakan kontrak yang sama.
// Perbandingan confidenceScore antar agent VALID.

type ReasoningStrength = "low" | "medium" | "high"

const SCORING_CONTRACT: Record<ReasoningStrength, number> = {
  "low":    0.2,   // range [0.0, 0.4)
  "medium": 0.5,   // range [0.4, 0.7)
  "high":   0.85,  // range [0.7, 1.0]
}

function mapConfidence(strength: ReasoningStrength): number {
  return SCORING_CONTRACT[strength]
}
```

### Why ordinal, not direct scalar

| Aspect | Ordinal (reasoningStrength) | Raw scalar (0.0–1.0) |
|---|---|---|
| **Calibration** | Same for all agents — guaranteed comparable | Each LLM calibrates differently — incomparable |
| **False precision** | Impossible (3 buckets) | Likely (0.73 vs 0.71 is meaningless) |
| **Auditability** | "low" is auditable by human | "0.37" has no intuitive meaning |
| **LLM reliability** | LLM can self-classify confidence | LLM cannot produce calibrated probability |

### Agent implementation contract

Each specialist agent MUST:

1. Analyze `EvolutionContext` + `DecisionCriteria`
2. Call `LLM.generateObject({ schema: AgentOutputSchema, ... })` where `AgentOutputSchema` includes:
   ```typescript
   const AgentOutputSchema = Schema.Struct({
     reasoningStrength: Schema.Literal("low", "medium", "high"),
     rationale: Schema.String,
     proposedAction: Schema.String,
     tags: Schema.Array(Schema.String),
   })
   ```
3. Return `ProposalCandidate` with the `reasoningStrength` from LLM output

Agent does NOT compute or receive `confidenceScore` — that is Engine's responsibility.

### Comparison semantics

```
confidenceScore(A) > confidenceScore(B)  →  A has higher confidence (VALID comparison)
confidenceScore(A) = confidenceScore(B)  →  tie (use producedAt ascending)
confidenceScore(A) = 0.85               →  A was "high" confidence (same for ALL agents)
```

Because all agents use the same mapping function and the same ordinal categories, `confidenceScore` is **meaningfully comparable** across agents.

### Why not Option A (agent-generated raw)

Agent-generated scalar confidence (e.g., `0.85`) is not comparable across agents because:
- Agent A's LLM may be overconfident (always returns 0.85+)
- Agent B's LLM may be underconfident (always returns 0.4-0.6)
- No calibration mechanism exists to normalize

### Why not Option C (confidence ignored in v1)

Confidence is the primary differentiator between candidates. Without it, reconciliation becomes round-robin or first-produced-wins — which adds no value over single-agent mode.

---

## AC-to-File Mapping

| AC | Implementation File |
|---|---|
| AC-08 | `src/evolution/decision/coordinator.ts` — no brain/* imports; verify via oxlint |
| AC-09 | `src/evolution/decision/agents/*.ts` — no ProposalStore import; verify via grep |
| AC-10 | `src/evolution/decision/engine.ts` — sole submit() caller (existing, unchanged) |
| AC-11 | `src/evolution/decision/proposal-candidate.ts` — no write/persist method |
| AC-12 | `src/evolution/decision/coordinator.ts`, `agents/*.ts` — stateless audit (TG pattern) |
| AC-13 | `src/evolution/decision/engine.ts` — no autonomous submit pathway |
| AC-14 | `src/evolution/decision/reconciliation/confidence-strategy.ts` — deterministic sort |
| AC-15 | `src/evolution/decision/coordinator.ts` — Effect.all parallel, no shared state |
| AC-16 | `src/evolution/decision/engine.ts` — BELOW_THRESHOLD check before submit |
| AC-17 | `src/evolution/decision/engine.ts` — persist BEFORE submit, fail if persist fails |
| AC-18 | `src/evolution/decision/reconciliation-log.ts` — schema: no full context/prompt |

---

## Regression Test Plan

Tests that MUST pass at Sprint G4 end:

| Phase | File(s) | Count |
|---|---|---|
| Phase 1 | `evolution.test.ts`, `p3-b01-boundary.test.ts`, `tg-09-no-held.test.ts` | 47 |
| Phase 2 | `context/*.test.ts`, `boundary.test.ts`, `p3-gate-*.test.ts` | 46 |
| Phase 3 | `f2-validation.test.ts`, `f3-timeout.test.ts`, `f4-*.test.ts` | 36 |
| **Total** | | **129 tests, 0 failures** |

New Phase 4 tests added each sprint, but regression baseline remains 129 tests at 0 failures.
