# EF-AI Evolution Layer — Complete Technical Reference

**Maintained**: 2026-06-19
**Scope**: Phase 1–5, AR-004 mitigations, all ADRs (1–25), error taxonomy, debts, risks, test gates, architecture, implementation details
**Source of Truth Hierarchy**: Source code > Test output > This document > ADR docs > Session log

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Principles (P-01 through P-11)](#2-architecture-principles-p-01-through-p-11)
3. [System Architecture Overview](#3-system-architecture-overview)
4. [Phase 1: Foundation Brain](#4-phase-1-foundation-brain)
5. [Phase 2: Context Intelligence](#5-phase-2-context-intelligence)
6. [Phase 3: Decision Engine](#6-phase-3-decision-engine)
7. [Phase 4: Agent Orchestration](#7-phase-4-agent-orchestration)
8. [Phase 5: Self-Improvement + Governance](#8-phase-5-self-improvement--governance)
9. [Memory Governance (AR-004)](#9-memory-governance-ar-004)
10. [Architecture Decision Records (ADR-001 through ADR-025)](#10-architecture-decision-records-adr-001-through-adr-025)
11. [Error Taxonomy Registry](#11-error-taxonomy-registry)
12. [Architecture Debt Registry](#12-architecture-debt-registry)
13. [Architectural Risk Watchlist](#13-architectural-risk-watchlist)
14. [Architectural Constraints (AC-01 through AC-29)](#14-architectural-constraints-ac-01-through-ac-29)
15. [Test Gate Reference](#15-test-gate-reference)
16. [CLI Command Reference](#16-cli-command-reference)
17. [Storage Schema](#17-storage-schema)
18. [Layer Composition & Dependency Injection](#18-layer-composition--dependency-injection)
19. [Agent Roster & Capabilities](#19-agent-roster--capabilities)
20. [Decision Engine Pipeline Flow](#20-decision-engine-pipeline-flow)
21. [Code Conventions & Patterns](#21-code-conventions--patterns)
22. [Current State & Roadmap](#22-current-state--roadmap)
23. [Key File Map](#23-key-file-map)

---

## 1. Executive Summary

EF-AI (Evolution Foundation AI) is an intelligence layer built on top of OpenCode that transforms
it from a stateless coding assistant into an AI software engineer with persistent project memory,
architectural decision tracking, multi-agent evaluation, and long-term context retention.

The system has been built incrementally over 5 phases across 8 days (2026-06-11 through 2026-06-19),
producing 25 Architecture Decision Records (ADRs), 29 Architectural Constraints (ACs), 10 registered
error classes, and approximately 285 automated tests across 30+ test files.

**Current state**: Phase 5 COMPLETE (6 sprints A–F finished). AR-004 MONITORING (all 6 mitigations
implemented). Phase 6 (Multi-Agent Orchestration & Autonomous Execution) COMPLETE — all 10 deliverables (P6-D01–P6-D10) implemented, all 10 test gates (TG-H01–TG-H09 + TG-E2E) verified. See PHASE6_ACCEPTANCE.md.

**Key architectural commitments**:
- Single-writer rule: every context type has exactly one writer
- Facade boundary: all external access goes through `Evolution.Service`
- Evidence-based gates: IMPLEMENTED → VERIFIED → ACCEPTED
- Error taxonomy: 4 categories with boundary rules
- In-memory cache: O(1) reads, O(n) writes (TD-001 resolved)

---

## 2. Architecture Principles (P-01 through P-11)

| ID | Title | Full Statement |
|----|-------|----------------|
| P-01 | EF-AI Bukan Router LLM | EF-AI is not an LLM router wrapper. Router is one small Phase 6 component. Every implementation decision is evaluated against: does this help or hinder the 5-phase architecture? |
| P-02 | Kontrak > Fitur | Honest interfaces, correct error models, clear boundaries over new features. If choosing between "phase late 2 weeks" and "technical debt in foundation," pick late. |
| P-03 | Dependency Direction | Evolution Layer → OpenCode Core (never reverse). Changes that make Core aware of Evolution details are architectural risk until proven harmless. |
| P-04 | Tiga Gate, Bukan Satu | Phase completion requires: IMPLEMENTED (code exists + reviewed), VERIFIED (tests green + tsc clean), ACCEPTED (architecture + verification approved). All three required. |
| P-05 | Type System Jujur | Runtime errors must be in type signatures. Hiding errors for clean typecheck = contract violation = upstream routing corruption. |
| P-06 | Technical Debt Bernama | Every debt gets TD-xxx or AD-xxx identifier with description, risk, target phase. Debt without identity is lost from project memory. |
| P-07 | Jangan Oversell | Describe actual capabilities: "keyword search" not "semantic search", "not autonomous" not "autonomous." Goal is correct system, not smart-sounding system. |
| P-08 | ADD vs REPLACE Wajib | Every proposal classified before implementation. ADD = new capability, no existing contract change. REPLACE = behavior/contract/architecture change with impact analysis. |
| P-09 | Phase Gate Rule | No new phase until previous: IMPLEMENTED + VERIFIED + ACCEPTED. "Interesting feature" or "pressing deadline" are not exceptions. |
| P-10 | Default Reviewer Posture | When unsure: critique first, verify first, implement later. Fixing foundation now is cheap. Fixing at Phase 4-5 is expensive — all layers above break. |
| P-11 | Evidence Gate | Every IMPLEMENTED claim requires: source reference, code location, verification evidence (test output or runtime trace), test evidence. Documentation is not evidence. Refined by ADR-012 v2. |

---

## 3. System Architecture Overview

### 3.1 High-Level Architecture

```
User (CLI / OpenCode Session)
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│              OpenCode Core (existing)                      │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │ Session Mgr │  │ V2 Runner    │  │ SystemContext     │ │
│  │             │  │ (LLM loop)   │  │ Registry (core)   │ │
│  └─────────────┘  └──────┬───────┘  └────────┬─────────┘ │
└──────────────────────────┼────────────────────┼───────────┘
                           │                    │
                           ▼                    ▼
┌──────────────────────────────────────────────────────────┐
│              EF-AI Evolution Layer                         │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            Evolution.Service (Facade)             │    │
│  │  status()  getConfig()  getMemories()  decisions()│    │
│  │  getProjectContext()                              │    │
│  └───────┬──────────────────────┬───────────────────┘    │
│          │                      │                          │
│  ┌───────▼────────┐    ┌───────▼──────────────────┐      │
│  │   Brain Layer   │    │   Context Intelligence   │      │
│  │  (memory.ts)    │    │  (composer/retriever)    │      │
│  │  (decisions.ts) │    │  → EvolutionContext DTO  │      │
│  │  (project.ts)   │    │  → SystemContextProvider │      │
│  │  (proposal-store)│   └──────────────────────────┘      │
│  └───────┬────────┘                                       │
│          │                                                 │
│  ┌───────▼─────────────────────────────────────┐         │
│  │   Decision Engine Layer                      │         │
│  │  AgentRegistry → AgentCoordinator → Engine   │         │
│  │  Reconciliation → ProposalStore → DecisionsBrain      │
│  └───────┬─────────────────────────────────────┘         │
│          │                                                 │
│  ┌───────▼─────────────────────────────────────┐         │
│  │   Self-Improvement Layer (Phase 5)          │         │
│  │  MetricsService → AnalyzerService → Improver│         │
│  └─────────────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Ownership Model (ADR-011)

| Context Type | Owner | Single Writer | Authorized Readers | Lifecycle |
|---|---|---|---|---|
| EvolutionMemory | MemoryBrain | MemoryBrain | ContextRetriever via facade | Persistent |
| EvolutionDecisions | DecisionsBrain | DecisionsBrain | ContextRetriever via facade | Persistent |
| ProjectProfile | ProjectBrain | ProjectBrain | ContextRetriever via facade | Cache |
| EvolutionContext | ContextComposer | ContextComposer | SystemContextProvider → Registry | Per-request |
| SystemContext (core) | SystemContextRegistry | Registered providers (each owns key) | V2 Runner | Per-location |
| DecisionContext | Decision Engine | Decision Engine | SystemContextProvider | Per-request |
| DecisionRecord | DecisionsBrain | Decision Engine PROPOSES → DecisionsBrain STORES | ContextRetriever via facade | Persistent |

**Single-Writer Rules**:
- **SW-01**: Each context type has EXACTLY ONE writer. No exceptions.
- **SW-02**: Two services writing same context = design review + Chief Architect approval.
- **SW-03**: "Read-through" only — never direct storage access.
- **SW-04**: Decision Engine writes via Evolution.Service facade, not brain/*.

### 3.3 Dependency Injection Chain

```
makeRuntime() → AppLayer
  └── Evolution.defaultLayer
        ├── EvolutionBrain.layer
        │     ├── MemoryBrain.layer (brain/memory.ts)
        │     ├── DecisionsBrain.layer (brain/decisions.ts)
        │     ├── ProjectBrain.layer (brain/project.ts)
        │     └── ProposalStore (internal to decisions)
        ├── ContextComposer.layer (context/composer.ts)
        └── EvolutionDecisionEngine.layer
              ├── AgentRegistry (register.ts)
              ├── AgentCoordinator
              ├── ReconciliationStrategy
              └── Activation (activation/index.ts)

SystemContextBuiltIns.registerExtra(EvolutionContextLayer.register)
  → core/builtins executes extras at startup
  → Evolution context composed into per-location system baseline
```

### 3.4 Data Flow — Full Decision Pipeline

```
Manual invocation (opencode evolution evaluate)
    │
    ▼
Composition root (app-runtime.ts)
    │  reads AgentRegistry, ConfigEvolution, DefaultCriteriaProvider
    │  constructs ReconcileInput
    ▼
EvolutionDecisionEngine.reconcile(input)
    │
    ├── ContextComposer.provide()
    │     → retrieves memories/decisions/project via facade
    │     → truncates to context budget
    │     → returns EvolutionContext DTO
    │
    ├── AgentCoordinator (Effect.all parallel fan-out)
    │     ├── ContextAnalystAgent (proposal-capable)
    │     ├── RiskAgent (advisor, enrichment only)
    │     └── PlanningAgent (advisor, enrichment only)
    │
    ├── ConfidenceReconciliationStrategy.reconcile(candidates)
    │     → maps reasoningStrength ordinal → numeric confidence
    │     → evaluates BELOW_THRESHOLD
    │     → selects winner (confidence DESC, agentId ASC tiebreak)
    │     → returns ReconciliationResult DTO
    │
    ├── Engine creates ReconciliationLog from result
    │     → persists via DecisionsBrain (AC-17: log before submit)
    │
    ├── If outcome == PROPOSAL_SUBMITTED:
    │     → ProposalStore.submit(proposal)
    │       → Tier 2: contradiction check (KEY-BASED)
    │       → Authority check (DA-01)
    │       → AC-06 timeout guard (5000ms default)
    │       → SUBMITTED → VALIDATING → ACCEPTED | REJECTED
    │
    └── Returns outcome to composition root
```

---

## 4. Phase 1: Foundation Brain

**Status**: ✅ COMPLETE (2026-06-13)
**Components**: 3 brain services + Evolution.Service facade
**Storage**: File-based JSON in `<project>/.opencode/evolution/`
**Tests**: 38 tests, 80 expect() calls, ~14.5 min

### 4.1 Memory Service (`brain/memory.ts`)

**Interface**:
```typescript
interface Interface {
  readonly save: (entry: Omit<MemoryEntry, "id" | "created" | "updated">) => Effect.Effect<
    MemoryEntry, EvolutionStorageError | EvolutionNotEnabledError | EvolutionMemoryLimitError
  >
  readonly retrieve: (query: MemoryQuery) => Effect.Effect<MemoryEntry[], EvolutionStorageError | EvolutionNotEnabledError>
  readonly search: (text: string) => Effect.Effect<MemoryEntry[], EvolutionStorageError | EvolutionNotEnabledError>
  readonly summarize: () => Effect.Effect<MemorySummary, EvolutionStorageError | EvolutionNotEnabledError>
  readonly compact: () => Effect.Effect<void, EvolutionStorageError>
  readonly verify: (memoryId: string) => Effect.Effect<void, EvolutionStorageError>
  readonly detectAnomalies: () => Effect.Effect<AnomalyReport, never>
}
```

**MemoryEntry Schema**:
```typescript
interface MemoryEntry {
  id: string                    // auto-generated
  type: "lesson" | "experience" | "pattern" | "fact"
  content: string
  tags: string[]
  source: MemorySource          // human | agent | system | llm
  confidence: number            // 0.0–1.0, set initially, decays over time
  verifiedAt?: number           // timestamp of last verification
  verificationCount: number     // how many times verified
  sessionID?: string
  created: number               // Unix ms
  updated: number               // Unix ms
}
```

**Key implementation details**:
- Write queue via keyed mutex (`mutex.withLock("memory", ...)`)
- In-memory cache: `readStorage()` caches after first disk read; `writeStorage()` updates cache via `Effect.tap`
- Max 500 entries (enforced by `compact()`)
- AR-004 additions: `verify()`, `detectAnomalies()`, `isStale()`, `effectiveConfidence()`

### 4.2 Decision Storage (`brain/decisions.ts`)

**Interface**:
```typescript
interface Interface {
  readonly save: (adr: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, EvolutionStorageError | EvolutionNotEnabledError>
  readonly get: (id: string) => Effect.Effect<DecisionRecord, EvolutionStorageError | AdrNotFoundError>
  readonly list: (status?: DecisionStatus) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly search: (query: string) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly summarize: () => Effect.Effect<DecisionSummary, EvolutionStorageError>
  readonly supersede: (id: string, newADR: Omit<DecisionRecord, "id" | "createdAt" | "updatedAt">) => Effect.Effect<DecisionRecord, EvolutionStorageError | AdrNotFoundError>
  readonly saveReconciliationLog: (log: ReconciliationLog) => Effect.Effect<void, EvolutionStorageError>
}
```

### 4.3 Project Profile (`brain/project.ts`)

Detects: frameworks, workspace structure (single/monorepo), dependencies, git info.
Cache-based: invalidated on git change or TTL.

### 4.4 Evolution.Service Facade (`evolution/index.ts`)

```typescript
interface Interface {
  readonly status: () => Effect.Effect<Status, EvolutionStorageError>
  readonly getConfig: () => ConfigEvolution
  readonly getMemories: (query?: MemoryQuery) => Effect.Effect<MemoryEntry[], EvolutionStorageError>
  readonly getDecisions: (status?: DecisionStatus) => Effect.Effect<DecisionRecord[], EvolutionStorageError>
  readonly getProjectContext: () => Effect.Effect<ProjectProfile, EvolutionStorageError>
  readonly memory: () => MemoryBrain.Interface
  readonly decisions: () => DecisionsBrain.Interface
}
```

### 4.5 Status Endpoint — Model B (ADR-006)

`status()` returns aggregate runtime state. On storage failure, error propagates to CLI boundary.
CLI catches `EvolutionStorageError` and degrades to disabled display — does NOT show raw error.

### 4.6 Error Boundary Model (ADR-005)

- Internal storage helpers keep honest `FSUtil.Error`
- Single translator: `toEvolutionStorageError(e, operation, path?)`
- Translation at public boundary only

---

## 5. Phase 2: Context Intelligence

**Status**: ✅ CLOSED (2026-06-16)
**Components**: ContextBudget, ContextRetriever, ContextComposer, SystemContextProvider
**Tests**: 17+ tests, 63+ expect calls
**Sprints**: A (budget), B (integration), C (wiring), C-Patch (fix + T-08), C-Verify, D (closure)

### 5.1 Component Stack

```
ContextBudget.Service (budget.ts)
    → calculates available tokens from config
    → pure calculation, no I/O

ContextRetriever.Service (retriever.ts)
    → reads from Evolution.Service facade
    → applies stale filtering (isStale) + confidence sorting
    → returns MemoryEntry[], DecisionRecord[], ProjectProfile

ContextComposer.Service (composer.ts)
    → orchestrates Retriever + Budget → EvolutionContext
    → monotonic shrink: Math.max(1, Math.min(oldCount - 1, Math.floor(oldCount × ratio × 0.8)))
    → truncation priority: Project > Decisions > Memory (hypothesis, DF-09)

SystemContextProvider (provider.ts)
    → registers via SystemContextRegistry.register()
    → graceful degradation: catches errors → console.warn → ""
    → returns formatted string with confidence/source tags
```

### 5.2 EvolutionContext DTO (ADR-004)

```typescript
interface EvolutionContext {
  project: ProjectSummary               // name, frameworks, structure
  memories: RelevantMemory[]            // content, type, relevanceHint, confidence, source
  decisions: ActiveDecision[]           // title, decision, status
  budget: ContextBudget                 // totalTokens, used, remaining, breakdown
}
```

### 5.3 Budget Governance

- Flat `contextBudget` config (default 4096)
- `strict` strategy: throws `ContextBudgetError` if skeleton doesn't fit
- `truncate` strategy: shrinks memories/decisions until budget fits
- No hidden 0.9 multiplier (AR-01, Option C)
- `Math.ceil` is the conservative approximation layer only

### 5.4 T-08 Wiring via `registerExtra`

**Problem**: `EvolutionContextLayer.layer` requires location-scoped service but lives in `packages/opencode` while location composition lives in `packages/core`.

**Solution**: Push-based registration hook in core:
```
core/builtins.ts:   registerExtra(effect) — push-based, no silent overwrite
core/builtins.ts:   loop at lines 47-49 executes all extras during init
app-runtime.ts:57:  SystemContextBuiltIns.registerExtra(EvolutionContextLayer.register)
```

**Why not `extraLayers = [...]`**: Assignment-based design would allow silent overwrite.
Push-based registration prevents this (AD-CP03-01 closed as never-implemented).

### 5.5 DF-10 Injection Chain (Verified)

```
SystemContextRegistry.register(evolution/context)
  → systemContext.load()              [runner/llm.ts:171]
  → SystemContext.combine(...)        [runner/llm.ts:173]
  → SessionContextEpoch.initialize()  [runner/llm.ts:184]
  → system.baseline                   [runner/llm.ts:222]
  → LLM.request({ system: [...] })    [runner/llm.ts:219]
```

---

## 6. Phase 3: Decision Engine

**Status**: ✅ COMPLETE (2026-06-16)
**Components**: ProposalStore, validation pipeline, DecisionEngine, Reconciliation
**Tests**: 36 tests across 10 files, 0 failures
**Sprints**: F1 (foundation), F2 (validation + projection), F3 (timeout + integration), F4 (engine + AC-07)

### 6.1 Decision Authority Model (ADR-013 v2)

**Tier Split**:

| Tier | Owner | Scope | I/O | State |
|---|---|---|---|---|
| Tier 1 | Decision Engine | Schema validation (field completeness, type, format) | None (pure function) | Stateless |
| Tier 2 | Evolution Brain | Contradiction check (KEY-BASED), Authority check | ProposalStore read | Stateful (Brain-owned) |

**Validation Pipeline**:
```
Engine.propose() → Tier 1 (schema) → ProposalStore.submit()
  → Tier 2: contradiction check (DUPLICATE_KEY only)
  → Tier 2: authority check (DA-01)
  → AC-06 timeout guard (5000ms default)
  → SUBMITTED → VALIDATING → ACCEPTED | REJECTED
```

### 6.2 ProposalStore (`brain/proposal-store.ts`)

**Storage**: `.opencode/evolution/proposals/{id}.json` (per-project, same pattern as ADR)
**Schema boundary**: `Schema.decodeUnknown(DecisionProposalSchema)` on read, `Schema.encode()` on write (AC-08, DA-10)
**State machine**: `SUBMITTED → VALIDATING → ACCEPTED | REJECTED` (DA-11)
**DecisionRecord**: PROJECTION of `ProposalStore.listByStatus("ACCEPTED")` — not a separate store (DA-06)

**Write authorization**: `requireProposalCapability(callerCaps)` invariant checker (CR-001, Sprint F):
```typescript
if (!callerCaps.includes("proposal")) {
  yield* Effect.die(new InvariantViolationError({...}))
}
```

### 6.3 Proposal Lifecycle

```
SUBMITTED  → Proposal submitted by Engine (schema-valid)
    │
VALIDATING → Brain runs Tier 2 checks (contradiction + authority)
    │
    ├── ACCEPTED → DecisionRecord created (projection entry)
    │
    └── REJECTED → Persisted with reason_code (never deleted)
```

**Rejection Codes**: `SCHEMA_INVALID`, `DUPLICATE_KEY`, `AUTHORITY_VIOLATION`, `VALIDATION_TIMEOUT`, `VALIDATION_ERROR`

**HELD state**: EXCLUDED from Phase 3 (deferred to Phase 4+). Phase 3 has exactly two terminal states.

### 6.4 DecisionEngine (ADR-015)

```typescript
interface Interface {
  readonly propose: (criteria: DecisionCriteria) => Effect.Effect<
    ProposalSubmissionResult, DecisionEngineError | LLMError
  >
}
```

- Single method: `propose()` — receives criteria, returns result
- No direct brain/* access — only `Evolution.Service` facade
- Stateless: all `const` declarations, zero `let`/`var` (verified by TG-STATELESS)
- Proposer identity: `"decision-engine"` (not `"evolution"`, not user-specific)
- AC-07 binding: `DecisionProposalSchema` passed directly as `schema:` to `LLM.generateObject()`

### 6.5 Error Model

| Error | Source | When |
|---|---|---|
| `LLMError` | `LLM.generateObject()` | LLM generation failure — propagates unswallowed |
| `DecisionEngineError` | `submit()` catch | Submission to DecisionsBrain fails unexpectedly |

---

## 7. Phase 4: Agent Orchestration

**Status**: ✅ COMPLETE (G4 Evidence Gate ACCEPTED 2026-06-18)
**Components**: AgentRegistry, AgentCoordinator, 3 agents, Reconciliation, Activation
**Tests**: 37+ tests across 6 files
**Sprints**: G1 (agent isolation), G2 (coordinator), G3 (reconciliation), G4 (enrichment + governance)

### 7.1 Agent Isolation Model (ADR-016)

**Rule**: Each agent receives ONLY:
1. `EvolutionContext` (same for all, read from facade)
2. `DecisionCriteria` (same for all)

**No agent sees another agent's output before reconciliation.**

**Enforcement**: Structural via `Effect.all` fan-out:
```typescript
const candidates = yield* Effect.all(
  agents.map(agent => agent.analyze(context, criteria)),
  { concurrency: "unbounded" },
)
// candidates: ProposalCandidate[] — no agent can access another's output
```

### 7.2 Reconciliation Authority (ADR-017)

| Concern | Owner |
|---|---|
| Reconciliation algorithm | DecisionEngine (Strategy interface) |
| ReconciliationLog (logical) | DecisionEngine (creates as output) |
| ReconciliationLog (physical) | DecisionsBrain (persists) |
| ReconciliationStrategy interface | DecisionEngine (abstract) |

**Algorithm (G1–G3, CONFIDENCE strategy)**:
1. Map ordinal `reasoningStrength` → numeric `confidenceScore` via SCORING_CONTRACT
2. Evaluate: 0 candidates → `NO_CANDIDATES`; all below threshold → `BELOW_THRESHOLD`; otherwise select winner
3. Tie-break: `confidenceScore` DESC → `agentId` lexical ASC
4. Returns `ReconciliationResult` DTO (domain result)
5. Engine creates `ReconciliationLog` from result (audit metadata only — AC-18)
6. Persist log BEFORE proposal submit (AC-17)
7. Submit proposal via Phase 3 path
8. Update log with `proposalId` and `submissionStatus: "SUBMITTED"` (best-effort)

### 7.3 Confidence Scoring Contract

| Aspect | Decision |
|---|---|
| Source | Ordinal `reasoningStrength: "low" | "medium" | "high"` — produced by agent LLM |
| Normalization | Engine maps via `SCORING_CONTRACT` pure function (LOW=0.2, MEDIUM=0.5, HIGH=0.9) |
| Comparison | Valid across all agents — same contract, same mapping |
| Precision | 3 buckets — no false precision |
| Auditability | "low"/"medium"/"high" is human-interpretable |

### 7.4 Activation Model (ADR-019)

**Trigger**: Manual invocation (`opencode evolution evaluate`). Session idle rejected.

**Purpose**: On-demand architectural evaluation (not runtime validation).

**Ownership**:
- Composition root (`app-runtime.ts`): activation workflow
- `EvolutionDecisionEngine.Service`: decision execution (propose/reconcile)
- `DefaultCriteriaProvider`: evaluation semantics

**Failure model**:
- Activation failures (engine not wired, empty registry): no retry — design gap
- Decision failures (LLMError, StorageError): retry max 3, 1s/2s/4s backoff
- In-flight drop: concurrent invocations silently ignored (AC-28)

### 7.5 Audit Ledger (ADR-023)

**Hash-chain integrity**: Each entry contains `previousHash` (SHA-256 of previous entry).
**Format**: Append-only JSONL.
**Storage**: Separate from ProposalStore — metadata only (proposal ID, timestamp, agent, outcome).
**Retention**: 7-year compliance, never deleted.

---

## 8. Phase 5: Self-Improvement + Governance

**Status**: ✅ COMPLETE (all 6 sprints finished 2026-06-19). Pending ACCEPTED gate.
**Tests**: 31 tests (8 TG-METRICS + 5 TG-ANALYZER + 7 TG-IMPROVER + 6 TG-WRITE + 5 misc)

### 8.1 Sprint A: MetricsService

**9 Metrics**:

| ID | Name | Formula | Range |
|---|---|---|---|
| M-01 | Accepted Rate | `count(ACCEPTED) / (count(ACCEPTED) + count(REJECTED))` | [0, 1] |
| M-02 | Rejection Distribution | Per-code count + percentage | — |
| M-03 | Below-Threshold Rate | `count(BELOW_THRESHOLD) / count(reconciliationLogs)` | [0, 1] |
| M-04 | Advisor Contribution | `count(logs with advisor participants) / count(logs)` | [0, 1] |
| M-05 | Confidence Histogram | Count per reasoningStrength bucket | — |
| M-06 | Enrichment Correlation | enrichedAcceptedRate - unenrichedAcceptedRate | [-1, 1] |
| M-07 | Median Validation Time | median of validatedAt - createdAt | ms |
| M-08 | Budget Utilization | mean(budget.used / budget.configured) | [0, ∞) |
| M-09 | Epistemic Diversity Index | `1 - (overlappingNGramCount / totalNGramCount)` | [0, 1] |

**Interface**:
```typescript
interface Interface {
  readonly snapshot: () => Effect.Effect<MetricsSnapshot, EvolutionStorageError>
}
```

**Key constraints**: AC-19 (read-only), AC-20 (facade-only), AC-21 (DTO), AC-22 (CLI formats)

### 8.2 Sprint B: AnalyzerService

**4 Analysis Types**:

| ID | Type | Classification |
|---|---|---|
| B-01 | Failure Pattern | Dominant rejection code analysis → SCHEMA_QUALITY_ISSUE / TIMEOUT_PRESSURE / DUPLICATE_SATURATION / AUTHORITY_MISCONFIGURED / HEALTHY / INSUFFICIENT_DATA |
| B-02 | Advisor Contribution | Enrichment effect → POSITIVE / NEGATIVE / NEUTRAL / INSUFFICIENT_DATA |
| B-03 | Config Health | Threshold + budget assessment → TOO_HIGH / TOO_LOW / HEALTHY / CONSTRAINED / WASTEFUL |
| B-04 | Usage Trend | Acceptance rate trend → IMPROVING / DEGRADING / STABLE / INSUFFICIENT_DATA |

**Interface**: `analyze(snapshot: MetricsSnapshot) => Effect.Effect<AnalysisReport, never>` — always succeeds.

### 8.3 Sprint C: ImproverService

**4 Suggestion Rules** (purely rule-based, no LLM — AC-25):

| Rule | Trigger | Category |
|---|---|---|
| I-01 | thresholdAssessment === "TOO_HIGH" && belowThresholdRate > 0.5 | CONFIG_THRESHOLD |
| I-02 | budgetAssessment === "CONSTRAINED" | CONFIG_BUDGET |
| I-03 | failurePattern === "SCHEMA_QUALITY_ISSUE" | AGENT_INSTRUCTION |
| I-04 | overallAssessment === "CRITICAL" && acceptedRate < 0.2 | MODE_ADJUSTMENT |

**Interface**: `suggest(report: AnalysisReport) => ReadonlyArray<Suggestion>` — synchronous.

### 8.4 Sprint D: Selection Governance Research

**G4-AR-001 Resolution**: Strategy C (Expanded Reconciliation) recommended.
**ADR-022 DRAFT**: All proposal-capable agents compete; highest confidence wins.
**Cross-agent comparability**: NOT PROVEN — requires Phase 6 spike.

### 8.5 Sprint E: Retention Analysis

**Binary recommendation**: DEFER — all thresholds comfortable.
**ADR-023 Audit Ledger**: Dual-store design (ProposalStore operational + Audit Ledger immutable).
**CR-003 resolved**: Metadata-only audit records survive retention cleanup.

### 8.6 Sprint F: Governance Enforcement

**F-01**: `requireProposalCapability()` invariant checker in ProposalStore (6/6 TG-WRITE tests)
**F-02**: ADR-024 DRAFT (Decision Provenance Graph — 5 node types, content-hash only)
**F-03**: ADR-025 DRAFT (Confidence Calibration — temperature scaling recommended)
**AD-003**: CI lint enforcement via `bun run lint:error-registry` in `.github/workflows/test.yml`

### 8.7 Phase 5 Data Flow

```
Storage Layer (read-only from Phase 5)
  ┌────────────────┐   ┌──────────────────────┐
  │ ProposalStore   │   │ ReconciliationLog     │
  │ *.json files    │   │ *.json files          │
  └───────┬────────┘   └──────────┬───────────┘
          │ via facade            │ via facade
          └───────────┬───────────┘
                      ▼
          ┌──────────────────────┐
          │   MetricsService      │ Sprint A
          │   (read-only)         │
          └──────────┬───────────┘
                     │ MetricsSnapshot DTO
                     ▼
          ┌──────────────────────┐
          │   AnalyzerService     │ Sprint B
          │   (pure function)     │
          └──────────┬───────────┘
                     │ AnalysisReport DTO
                     ▼
          ┌──────────────────────┐
          │   ImproverService     │ Sprint C
          │   (suggest-only)      │
          └──────────┬───────────┘
                     │ ReadonlyArray<Suggestion>
                     ▼
          ┌──────────────────────┐
          │   CLI Layer           │
          │ opencode evolution    │
          │ metrics / analyze /   │
          │ improve               │
          └──────────────────────┘
```

---

## 9. Memory Governance (AR-004)

**Status**: 🟡 MONITORING (mitigations implemented 2026-06-19)
**Evidence strength**: MEDIUM (external evidence confirms risk as OWASP Top Risk 2026, but no EF-AI-specific incident)
**Promotion criteria**: NOT MET (no memory-caused incorrect behavior in EF-AI production)

### 9.1 Mitigations Implemented

| # | Mitigation | Location | Details |
|---|---|---|---|
| M-01 | `memorySource` field | `memory.ts` | Every `MemoryEntry` has `source: MemorySource` = `"human"` | `"agent"` | `"system"` | `"llm"` |
| M-02 | Confidence decay | `memory.ts:effectiveConfidence()` | Exponential half-life: `confidence * 0.5^(daysSinceVerification / halfLifeDays)`. Default half-life: 30 days. |
| M-03 | Verification workflow | `memory.ts:verify()` | Sets `verifiedAt`, increments `verificationCount`. `isStale()` returns true if unverified > `staleThresholdDays` (configurable via `InfoEvolutionSchema`). `staleThresholdDays: 0` = never stale. |
| M-04 | Anomaly detection | `memory.ts:detectAnomalies()` | Flags: (a) confidence < `minCandidateConfidence` (default 0.3), (b) self-referential duplicate entries (same content, same tags, same source) |
| M-05 | CLI | `cli/memory.ts` | `opencode evolution memory` — lists entries with confidence, source, stale status, anomaly warnings |
| M-06 | Context tags | `context/provider.ts` | Output includes `(c:N.N, src:type)` indicators per memory line |

### 9.2 Stale Filtering in Context (retriever.ts)

```typescript
// Stale entries excluded from context assembly
const freshMemories = allMemories.filter(m => !isStale(m))

// Sorted by effectiveConfidence descending
freshMemories.sort((a, b) => effectiveConfidence(b) - effectiveConfidence(a))
```

### 9.3 Config Integration (InfoEvolutionSchema)

```typescript
// Core config (packages/core/src/v1/config/config.ts)
export const InfoEvolutionSchema = Schema.Struct({
  enabled: Schema.optional(Schema.Boolean),
  mode: Schema.optional(Schema.Literal("observe", "assist", "autonomous")),
  contextBudget: Schema.optional(Schema.Int),
  staleThresholdDays: Schema.optional(NonNegativeInt),  // AR-004
  minCandidateConfidence: Schema.optional(Schema.Number),
  // ... merged into ConfigEvolution via Schema.Struct({...fields, ...extra})
})
```

---

## 10. Architecture Decision Records (ADR-001 through ADR-025)

### 10.1 Phase 1 ADRs

**ADR-001 — Evolution Layer as separate service** (2026-06-11)
- Decision: Evolution Layer added as optional service layer, compatible with upstream OpenCode
- Status: Accepted

**ADR-002 — No direct memory injection to system prompt** (2026-06-11)
- Decision: Memory context provided via separate `EvolutionContext` layer, not injected directly into system prompt
- Reason: Prevents context overload
- Status: Accepted

**ADR-003 — Evolution Brain Consumer Interface** (2026-06-11, rev v2 2026-06-12)
- Decision: `Evolution.Service` as sole consumer boundary with 5 methods (status, getConfig, getMemories, getDecisions, getProjectContext)
- Reason: Prevent direct dependency between consumers and storage layer
- Status: Accepted v2

**ADR-004 — Context Intelligence Output Contract** (2026-06-12)
- Decision: `EvolutionContext` typed object with project, memories, decisions, budget fields
- Reason: ADR-002 prohibits direct prompt injection; typed object allows consumer choice
- Status: Accepted (pending OpenCode integration verification)

**ADR-005 — Error Boundary Model** (2026-06-13)
- Decision: Single translator `toEvolutionStorageError()` for all storage errors. Public interface exposes exactly 3 error types.
- Rules: (1) Internal helpers keep honest FSUtil.Error, (2) Public boundary: typed domain errors only, (3) Single translator, (4) CLI catches EvolutionStorageError
- Status: Accepted

**ADR-006 — Status Endpoint Model B** (2026-06-13)
- Decision: `status()` aggregates runtime state (Model B, not absorbed errors). Error propagates to CLI boundary.
- Status: Accepted

### 10.2 Phase 2 ADRs

**ADR-007 — Context Intelligence Foundation** (2026-06-14)
- Decision: 4-component stack (Budget → Retriever → Composer → Provider). All components are ADD (no existing code modified).
- Ownership: EvolutionContext owned by Composer. SystemContextProvider delivers to AI Session.
- Status: Accepted

**ADR-008 — Sprint B Implementation Decisions** (2026-06-14)
- AR-01 (no implicit margin): Option C — no hidden 0.9 multiplier. User owns effective limit via config.
- AR-02 (truncation priority): Hypothesis — Memory > Decisions > Project (project never truncated)
- AR-03 (monotonic shrink): `Math.max(1, Math.min(oldCount-1, Math.floor(oldCount × ratio × 0.8)))`
- AR-04 (internal wiring): Sprint C does NOT add `context()` to Evolution.Interface.
- AR-05 (graceful degradation): Errors → console.warn → ""; context is enrichment, not required.
- AR-06 (L-01 compliance): `load()` uses `Effect.tryPromise`, not fire-and-forget.
- AR-07 (error boundary ownership): Provider catches ContextBudgetError → console.warn → "".
- AR-08 (duplicate key): Duplicate registration = `Effect.die`.
- Status: Accepted

**ADR-009 — Sprint C-Patch** (2026-06-14)
- CP-01: Config.Service pattern fix (`Effect.map(Config.Service, ...)` → `config.get()` returns Effect)
- CP-02: D-02 uses real `EvolutionContextLayer.layer` (not manual registry call)
- CP-03: T-08 wiring via `registerExtra` push-based registration (not `extraLayers = [...]`)
- Status: Accepted

**ADR-010 — Extension Registration Governance** (2026-06-15)
- Decision: KEEP CURRENT DESIGN (`registerExtra`). FREEZE rule: no new `registerExtra()` call without Architecture Reviewer approval.
- Spike S-01: Multi-extension behavior test — deterministic ordering, no silent overwrite.
- Status: Accepted

**ADR-011 — Context Ownership Model** (2026-06-15, updated 2026-06-16)
- Decision: Complete ownership matrix (7 context types). Single-Writer Rules (SW-01 through SW-04).
- Lifecycles: per-request, per-location, persistent.
- Spike S-02: Decision ownership boundary test — ownership boundaries validated.
- Status: Accepted (BLOCKING gate for Phase 3)

**ADR-012 v2 — Evidence Lifecycle** (2026-06-15, updated 2026-06-16)
- Decision: State machine (PROPOSED → IMPLEMENTING → IMPLEMENTED_UNVERIFIED → VERIFIED → ACCEPTED)
- Provenance verification (not format verification): timing patterns, environment markers, exit codes, execution chain, consistency cross-check.
- 5 evidence categories: Source, Test, Integration, Architecture, Governance.
- Evidence windows: session-based, commit-based, phase-based.
- Forbidden evidence: no raw machine output = not valid evidence.
- Status: ACCEPTED (Chief Architect, 2026-06-16)

### 10.3 Phase 3 ADRs

**ADR-013 v2 — Revised Decision Authority Model** (2026-06-16)
- Decision: Tier split (Engine = schema, Brain = contradiction + authority). ProposalStore as single source of truth. DecisionRecord = projection.
- Changes from v1: (1) ProposalStore introduced, (2) HELD removed from Phase 3, (3) Tier split, (4) AC-06 timeout guard, (5) Projection model eliminates dual-source risk.
- 5 rejection codes. DA-01 through DA-12 rules.
- 5 AR-P3 amendments applied (AR-P3-01 through AR-P3-05).
- Status: ACCEPTED (Architecture Reviewer, v2 Amendment gate)

**ADR-014 — Memory Governance Boundary** (2026-06-16)
- Decision: Content immutable, tags mutable. Decision Engine writes via facade (SW-04).
- MG-01 through MG-06 rules. Max 50 entries per session (TD-001 Option A).
- Spike S-04: Decision Engine proposes memory via `evolution.memory().save()` — no new API.
- Status: ACCEPTED

**ADR-015 — DecisionEngine Ownership Model** (2026-06-16)
- Decision: Engine owns orchestration only (not memory, not LLM, not validation). Single method: `propose()`.
- Stateless: all `const`, zero `let`/`var`. Proposer identity: `"decision-engine"`.
- Error model: `LLMError` propagates unswallowed; `DecisionEngineError` catches submission failures.
- Status: ACCEPTED

### 10.4 Phase 4 ADRs

**ADR-016 — Agent Isolation Model** (2026-06-16, ACCEPTED P4-DR1)
- Strict isolation: each agent only sees EvolutionContext + DecisionCriteria. No inter-agent visibility.
- Enforcement: `Effect.all` parallel fan-out; no shared state.
- Status: ACCEPTED

**ADR-017 — Reconciliation Authority** (2026-06-16, ACCEPTED P4-DR1)
- Double ownership: Engine owns reconciliation algorithm + log creation; Brain persists log.
- G3 algorithm: CONFIDENCE strategy with deterministic tie-break.
- ReconciliationLog persisted BEFORE proposal submission (AC-17).
- Status: ACCEPTED

**ADR-019 — Decision Engine Activation Model** (2026-06-17, ACCEPTED)
- Trigger: Manual invocation. Session idle rejected (no business link, no producer for criteria, unwanted frequency, coupling).
- Purpose: On-demand architectural evaluation (not runtime validation).
- Ownership: Composition root (workflow) ≠ Engine (execution) ≠ Evolution.Service (data access).
- Failure model: activation failures = no retry; decision failures = max 3 retries 1s/2s/4s.
- In-flight dedup: `Ref<boolean>` flag.
- AC-23 through AC-29 constraints defined.
- Status: ACCEPTED (v4 revision)

### 10.5 Phase 5 ADRs

**ADR-020 — Metrics Governance** (2026-06-18, PROPOSED)
- AC-19: read-only, AC-20: facade-only, AC-21: DTO snapshot, AC-22: CLI formats.
- Status: PROPOSED

**ADR-021 — Improver Constraint Model** (2026-06-18, PROPOSED)
- AC-23: suggestion only, AC-24: metricSource required, AC-25: no LLM.
- 4 suggestion categories: CONFIG_THRESHOLD, CONFIG_BUDGET, AGENT_INSTRUCTION, MODE_ADJUSTMENT.
- Status: PROPOSED

**ADR-022 — Multi-Proposal-Agent Selection Strategy** (2026-06-19, DRAFT)
- Problem: When >1 agent has `proposal` capability, how to select primary generator?
- 3 strategies: A (primaryGenerator flag), B (first-registered-wins), C (expanded reconciliation).
- Recommendation: Strategy C (self-organizing, works with existing pipeline, zero migration cost).
- Condition: Cross-agent confidence comparability must be validated in Phase 6 spike.
- Status: DRAFT (Phase 6 pre-implementation gate)

**ADR-023 — Audit Ledger** (2026-06-19, Implemented)
- Hash-chain integrity, append-only JSONL, metadata-only (no PII).
- Dual-store: ProposalStore (operational, TTL-based) + Audit Ledger (immutable, 7-year).
- Key: `previousHash` for tamper detection.
- Status: Implemented (Sprint E deliverable)

**ADR-024 — Decision Provenance Graph** (2026-06-19, DRAFT)
- 5 node types: MemoryNode, ContextNode, ProposalNode, DecisionNode, AgentExecutionNode.
- Relationships: feeds_into, used_by, produces.
- Storage: Append-only JSONL, content-hash only (SHA-256).
- Phase 6 query API + visualization.
- Status: DRAFT

**ADR-025 — Confidence Calibration Framework** (2026-06-19, DRAFT)
- Research: Platt scaling vs Temperature scaling vs Isotonic regression.
- Recommendation: Temperature scaling (single parameter T, low overfit risk).
- Calibrated confidence used ONLY in reconciliation (cross-model comparison). Raw confidence for thresholding.
- Data requirement: Min 100 proposals per model.
- Status: DRAFT

---

## 11. Error Taxonomy Registry

### 11.1 Classification Rules

| Category | Definition | Boundary Status |
|---|---|---|
| Domain Error | Business domain failure (entity not found, invalid state) | Boleh keluar ke consumer |
| Storage Error | Storage layer failure (file not found, permission denied) | Boleh keluar setelah diterjemahkan via translator |
| Integration Error | External service failure (LLM API, git, filesystem) | Harus diterjemahkan sebelum boundary |
| Programming Defect | Developer mistake (null ref, invariant violation) | Tidak boleh typed — panic/defect via `Effect.die()` |

### 11.2 Full Error Registry

| # | Error Class | Category | Source File | Constructor | Boundary |
|---|---|---|---|---|---|
| 1 | `EvolutionStorageError` | Storage | `src/evolution/error.ts` | `toEvolutionStorageError(e, operation, path?)` — single path ✅ | ✅ Allowed |
| 2 | `EvolutionNotEnabledError` | Domain | `brain/memory.ts:10`, `brain/decisions.ts:10` | `new EvolutionNotEnabledError({ message })` | ✅ Allowed |
| 3 | `AdrNotFoundError` | Domain | `brain/decisions.ts:14` | `new AdrNotFoundError({ id, message })` | ✅ Allowed |
| 4 | `ContextBudgetError` | Domain | `context/budget.ts` | `new ContextBudgetError({ message })` | ✅ Allowed |
| 5 | `InvariantViolationError` | Programming Defect | `src/evolution/error.ts` | `new InvariantViolationError({ message, operation })` via `Effect.die()` | ❌ Defect |
| 6 | `EvolutionMemoryLimitError` | Domain | `src/evolution/error.ts` | `new EvolutionMemoryLimitError({ message, count, limit? })` | ✅ Allowed |
| 7 | `SchemaValidationError` | Domain | `brain/decisions.ts` | `new SchemaValidationError({ message, detail })` | ✅ Allowed |
| 8 | `ActivationError` | Domain | `decision/activation/index.ts` | `new ActivationError({ message })` | ✅ Allowed |
| 9 | `DecisionEngineError` | Domain | `decision/engine.ts:6` | `new DecisionEngineError({ message })` | ✅ Allowed |
| 10 | `ReconciliationError` | Domain | `decision/reconciliation.ts` | `new ReconciliationError({ message })` | ✅ Allowed |

### 11.3 Error Boundary Audit

| Item | Result |
|---|---|
| FileSystemError leaked to consumer? | ❌ No — all mapped via `toEvolutionStorageError()` |
| PlatformError leaked to consumer? | ❌ No — caught at FSUtil boundary |
| JSON parse error leaked to consumer? | ❌ No — caught locally (returns `[]`) |
| Unknown exception leaked? | ❌ No — all public signatures use typed errors |
| All EvolutionStorageError via single constructor? | ✅ Yes — only `toEvolutionStorageError()` |
| Direct `new FooError(...)` outside error module? | ✅ Acceptable — domain errors (NotEnabled, AdrNotFound, DecisionEngine) |

### 11.4 CI Enforcement

- Script: `script/check-error-registry.ts` scans all `src/evolution/*.ts` for error classes
- Cross-references against `ERROR_REGISTRY.md`
- Runs via `bun run lint:error-registry` in `packages/opencode/package.json`
- CI: `.github/workflows/test.yml:72-74` runs on every push/PR (Linux + Windows)

---

## 12. Architecture Debt Registry

### 12.1 Active Debts (5 entries)

| ID | Title | Status | Owner | Target | Risk |
|---|---|---|---|---|---|
| KL-001 | CLI Disabled Ambiguity | WONTFIX | Shared | P3 | CLI cannot distinguish "disabled in config" from "storage broken" — both produce same output |
| AD-CP03-03 | ProposalStore Growth | ACTIVE (DEFER P6) | Architecture | P6 | ProposalStore accumulates all proposals; no retention strategy; `listByStatus()` O(n) reads |
| G4-AR-001 | Multi-Proposal-Agent Selection | ACTIVE (research complete) | Architecture | P6 | When >1 agent has `proposal` capability, no rule defines primary generator |
| CR-005 | Decision Provenance | ACTIVE (ADR-024 DRAFT) | Architecture | P6 | No decision lineage tracking; audit log records output but not input provenance |
| CR-002 | Confidence Calibration | ACTIVE (ADR-025 DRAFT) | Architecture | P6 | `reasoningStrength` ordinal → confidence mapping not calibrated across models |

### 12.2 Resolved Debts (7 entries)

| ID | Title | Resolution |
|---|---|---|
| AD-001 | Facade Boundary Enforcement | oxlint `no-restricted-imports` rule + `@/evolution/index` canonical re-export. App-runtime.ts fix. D-01A/D-01B/D-01C test gates. |
| AD-003 | Error Taxonomy Governance | `bun run lint:error-registry` CI integration. 10 registered classes. Runs on every push/PR. |
| TD-001 | Memory Storage Scalability | In-memory cache in `memory.ts`. O(1) reads via cached entries. O(n) writes via `Effect.tap` cache invalidation. |
| ED-021 | ConfigEvolution Schema Duplication | `InfoEvolutionSchema` exported from `packages/core/src/v1/config/config.ts`. Reused via `Schema.Struct({...fields, ...extra})`. |
| CR-001 | Single-Writer Enforcement | `requireProposalCapability()` invariant checker in ProposalStore. 6/6 TG-WRITE tests. |
| AD-CP03-01 | extraLayers Silent Overwrite | CLOSED — never implemented. Replaced by `registerExtra` push-based registration before any code was written. |
| AD-CP03-02 | T-08-WIRE-COVERAGE | CLOSED — VERIFIED. 7 tests, 12 expect() calls in `verify.test.ts`. All 5 exit criteria (C1–C5) met. |

---

## 13. Architectural Risk Watchlist

### 13.1 Active Risks (9 entries)

| ID | Title | Status | Trigger Condition | Phase |
|---|---|---|---|---|
| AR-001 | Evolution.Service God Object | OBSERVED | Interface > 8 methods, facade method body > 30 lines non-delegation, Phase 2+ adds methods directly | 2+ |
| AR-002 | Context Explosion | OBSERVED | Context assembly > 50% token budget, 2+ domains compete for same slot, assembly needs 3+ domain knowledge | 3+ |
| AR-003 | Agent Explosion | OBSERVED | 2+ agents share implementation dependencies, routing needs agent internals, ungoverned agent creation | 4+ |
| AR-004 | Memory Governance Degradation | 🟡 MONITORING | ✅ Observed incident (OWASP), manual audit finds contradictory entry, Phase 5 design start triggered | 5 |
| AR-005 | Self-Reinforcement Feedback Loop | OBSERVED | Improver changed from suggestion-only to auto-execute, observed circular reasoning, 3+ self-referential entries | 6 |
| ARCH-WATCH-P3-01 | ProposalStore Retention | OBSERVED | ProposalStore > 10,000 entries, I/O > 500ms, Phase 5 design starts | 5 |
| ARCH-WATCH-P5-01 | Governance Debt Accumulation | OBSERVED | ADR count > 25, contradictory ADRs found, Phase 6 adds 3+ ADRs | 6 |
| ARCH-WATCH-P5-02 | Constraint Drift | OBSERVED | AC count > 30, logical conflict between ACs, Phase 6 AC contradicts existing | 6 |
| DA-FUTURE-02 | Contradiction Logic Evolution | OBSERVED | 2+ agents in codebase, missed semantic contradiction, Phase 4 design starts | 4+ |

### 13.2 AR-004 — Detailed Mitigation Status

**Status**: 🟡 MONITORING (was TRIGGERED 2026-06-19 → MONITORING post-mitigation)

**Promotion criteria** (to Architecture Debt — NOT YET MET):
1. ❌ Demonstrated incident of memory-caused incorrect behavior in EF-AI
2. ❌ Evidence that manual correction is insufficient

**All 6 mitigations implemented**:
1. `memorySource` — MemoryEntry.source field (human/agent/system/llm)
2. `effectiveConfidence()` — exponential half-life decay (30d), integrated into context composition
3. `verify()`/`isStale()` — verification workflow, stale exclusion from context
4. `detectAnomalies()` — low-confidence (<0.3) + duplicate anomaly flags
5. CLI `opencode evolution memory` — list with confidence/source/stale/anomaly
6. Context output tags — `(c:N.N, src:type)` per memory line

---

## 14. Architectural Constraints (AC-01 through AC-29)

### 14.1 Phase 1 ACs

| ID | Constraint | Source |
|---|---|---|
| AC-01 | All external access to brain modules must go through `Evolution.Service` facade | ADR-003 |

### 14.2 Phase 2 ACs

| ID | Constraint | Source |
|---|---|---|
| AC-02 | Context Intelligence produces typed `EvolutionContext` object (not raw string) | ADR-004 |
| AC-03 | Budget governed by flat `contextBudget` config value | ADR-007/AR-02 |
| AC-04 | Graceful degradation: errors → console.warn → empty string (context is enrichment) | ADR-008/AR-05 |
| AC-05 | Duplicate registry key → fatal programming error (`Effect.die`) | ADR-008/AR-08 |

### 14.3 Phase 3 ACs

| ID | Constraint | Source |
|---|---|---|
| AC-06 | Validation timeout → auto REJECTED (configurable, default 5000ms) | ADR-013 v2 |
| AC-07 | Decision proposals bound to `DecisionProposalSchema` via `LLM.generateObject({ schema: ... })` | ADR-015 |
| AC-08 | ProposalStore uses `Schema.decodeUnknown()` on read and `Schema.encode()` on write | ADR-013 v2 (DA-10) |
| AC-09 | `updateStatus()` enforces state machine (SUBMITTED→VALIDATING→ACCEPTED\|REJECTED) | ADR-013 v2 (DA-11) |
| AC-10 | ProposalStore import graph enforcement (imported ONLY by `brain/decisions.ts`) | ADR-013 v2 (DA-12) |

### 14.4 Phase 4 ACs

| ID | Constraint | Source |
|---|---|---|
| AC-14 | Reconciliation is deterministic + auditable | ADR-017 |
| AC-15 | Agent isolation: strict fan-out via `Effect.all`, no shared state | ADR-016 |
| AC-16 | BELOW_THRESHOLD check before proposal submit | ADR-017 |
| AC-17 | ReconciliationLog persisted BEFORE proposal submission | ADR-017 |
| AC-18 | ReconciliationLog = audit metadata only (not full context/prompt/rationale) | ADR-017 |

### 14.5 Activation ACs (ADR-019)

| ID | Constraint | Source |
|---|---|---|
| AC-23 | Manual invocation is sole activation trigger | ADR-019 §4 |
| AC-24 | Composition root owns activation workflow; engine owns decision execution | ADR-019 §5 |
| AC-25 | Max 3 retries, 1s/2s/4s backoff for transient failures | ADR-019 §7 |
| AC-28 | In-flight drop: concurrent invocations silently dropped | ADR-019 §7 |
| AC-29 | All producers (agent registry, defaults) must exist before activation wiring | ADR-019 §3 |

### 14.6 Phase 5 ACs

| ID | Constraint | Sprint | Source |
|---|---|---|---|
| AC-19 | MetricsService is READ-ONLY — no method writes to any storage | A | ADR-020 |
| AC-20 | MetricsService accesses ProposalStore/ReconciliationLog ONLY via Evolution.Service facade | A | ADR-020 |
| AC-21 | MetricsService produces `MetricsSnapshot` DTO — not Effect stream, not live view | A | ADR-020 |
| AC-22 | CLI layer owns formatting; MetricsService returns DTO | A | ADR-020 |
| AC-23 | ImproverService produces `ReadonlyArray<Suggestion>` — no file/config modification | C | ADR-021 |
| AC-24 | Every `Suggestion` must contain `metricSource: string[]` — no speculative suggestions | C | ADR-021 |
| AC-25 | ImproverService uses rule-based logic only — no LLM calls | C | ADR-021 |

---

## 15. Test Gate Reference

### 15.1 Phase 1 (38 tests, 80 expect, ~14.5 min)

| Test | Description | Assertions |
|---|---|---|
| memory.test.ts | Save, retrieve by tags/type/content, search, summarize, compact (510 entries) | 25 |
| decisions.test.ts | Save, get, list, search, summarize, supersede | 30 |
| project.test.ts | Profile, framework detection, structure, dependency check, refresh | 15 |
| evolution.test.ts | Status, facade access, disabled graceful degradation | 10 |

### 15.2 Phase 2 (17+ tests, 63+ expect)

| Test Gate | Tests | Assertions |
|---|---|---|
| T-01/T-02: Budget | Budget calculation, skeleton check, strict/truncate strategies | 8 |
| T-03/T-04/T-05: Integration | Retriever, Composer, Provider end-to-end | 22 |
| T-07a/T-07b: Boundary | Module reachability, export surface audit | 6 |
| T-08: Wiring | `registerExtra` production path, duplicate protection | 5 |
| C1–C5: Sprint C-Verify | Exactly once, catchDefect, deterministic order, failure observable, no disappearance | 12 |
| T-09: DF-10 | Full production pipeline: layer → load → initialize → non-empty baseline | 10 |

### 15.3 Phase 3 (36 tests across 10 files)

| Sprint | Files | Tests | Assertions |
|---|---|---|---|
| F1 | proposal-store.test.ts, boundary.test.ts | 9 | TG-09, P3-B01 |
| F2 | validation.test.ts, projection.test.ts | 8 | TG-01–TG-07 |
| F3 | timeout.test.ts, integration.test.ts | 7 | TG-08 (AC-06) |
| F4 | f4-e2e.test.ts, f4-rejection.test.ts, f4-auth.test.ts, f4-ac07.test.ts, f4-stateless.test.ts, f4-llm-fail.test.ts | 12 | TG-E2E, TG-REJ, TG-AUTH, TG-AC07, TG-STATELESS, TG-LLM-FAIL |

### 15.4 Phase 4 (37+ tests across 6 files)

| Sprint | Tests | Key Gates |
|---|---|---|
| G1–G3 | 20+ | Agent isolation (TG-AC15-ISOLATION), coordinator fan-out, deterministic reconciliation |
| G4 | 10+ | Enrichment pipeline, audit ledger integrity (TG-AUDIT-CHAIN), diversity index (TG-DIVERSITY) |
| Activation | 7+ | End-to-end `Activation.invoke()` → PROPOSAL_SUBMITTED, on-disk persistence |

### 15.5 Phase 5 (31 tests)

| Test Group | Tests | Assertions |
|---|---|---|
| TG-METRICS-NO-WRITE | grep audit | 0 write/save/insert/modify in metrics.ts |
| TG-METRICS-FACADE | grep + oxlint | 0 direct brain/* imports |
| TG-METRICS-NULL-SAFETY | unit test | Empty ProposalStore → null fields, no NaN |
| TG-METRICS-FORMULA | unit test | acceptedRate = N/(N+M) |
| TG-METRICS-CORRELATION | unit test | enriched vs unenriched delta correct |
| TG-METRICS-CLI | unit test | CLI renders with all null fields |
| TG-METRICS-DIVERSITY | unit test | identical content → diversityIndex ~0 |
| TG-METRICS-DIVERSITY-UNIQUE | unit test | all unique → diversityIndex ~1 |
| TG-ANALYZER-PURE | type check | `Effect.AnalysisReport, never` (always succeeds) |
| TG-ANALYZER-INSUFFICIENT | unit test | 0 proposals → INSUFFICIENT_DATA |
| TG-ANALYZER-HEALTHY | unit test | 100% accepted → HEALTHY |
| TG-ANALYZER-CRITICAL | unit test | 90% SCHEMA_INVALID → SCHEMA_QUALITY_ISSUE |
| TG-ANALYZER-TREND | unit test | <3 data points → INSUFFICIENT_DATA |
| TG-IMPROVER-NO-WRITE | grep audit | 0 write/save/modify in improver.ts |
| TG-IMPROVER-NO-LLM | grep audit | 0 LLM import in improver.ts |
| TG-IMPROVER-SYNC | type check | suggest() returns `ReadonlyArray`, not Effect |
| TG-IMPROVER-METRIC-SOURCE | runtime assert | Every Suggestion has metricSource.length > 0 |
| TG-IMPROVER-HEALTHY | unit test | HEALTHY report → 0 suggestions |
| TG-IMPROVER-CRITICAL | unit test | CRITICAL + acceptedRate < 0.2 → MODE_ADJUSTMENT |
| TG-IMPROVER-THRESHOLD | unit test | belowThresholdRate > 0.5 → CONFIG_THRESHOLD |
| TG-WRITE-INVARIANT-ACCEPT | unit test | With `proposal` capability → succeeds |
| TG-WRITE-INVARIANT-REJECT | unit test | Without `proposal` capability → InvariantViolationError |
| TG-WRITE-INVARIANT-MULTI | unit test | Multiple caps including `proposal` → succeeds |
| TG-WRITE-UPDATE-STATUS | unit test | updateStatus with valid transitions |
| TG-WRITE-DIRECT | unit test | Direct write attempt without facade → invariant violation |
| TG-WRITE-EXISTING | path audit | All existing callers pass proposal capability |

### 15.6 Boundary Tests

| Gate | Description | Enforcement |
|---|---|---|
| D-01A | Module reachability — verifies 9 key imports reachable through facade | Static test |
| D-01B | EXPORTED_EXPECTED list matches actual facade exports | Static test |
| D-01C | FORBIDDEN_INTERNALS — no direct brain/* import from outside evolution/ | Static test + oxlint |
| AD-001 | oxlint `no-restricted-imports` rule blocks `**/evolution/brain/**` | CI lint |
| D-02A/D-04 | Facade-only access patterns | Static test |

---

## 16. CLI Command Reference

| Command | Description | Phase | Implementation |
|---|---|---|---|
| `opencode evolution status` | Show evolution status (enabled/disabled, mode, storage health) | 1 | `cli/status.ts` |
| `opencode evolution memory` | List memory entries with confidence, source, stale status, anomaly warnings | 5 (AR-004) | `cli/memory.ts` |
| `opencode evolution evaluate` | Run decision engine evaluation (manual activation) | 4 | `decision/activation/` |
| `opencode evolution metrics` | Show decision quality metrics snapshot | 5 (A) | `evolution/metrics.ts` |
| `opencode evolution metrics --json` | Output MetricsSnapshot as JSON | 5 (A) | `evolution/metrics.ts` |
| `opencode evolution analyze` | Show pattern analysis from metrics | 5 (B) | `evolution/analyzer.ts` |
| `opencode evolution improve` | Show improvement suggestions | 5 (C) | `evolution/improver.ts` |

---

## 17. Storage Schema

### 17.1 File Layout

```
<project>/.opencode/evolution/
├── memory.json                         # All memory entries (array)
├── project.json                        # Cached project profile
├── adr/
│   ├── ADR-XXXXXXXX-XXXX.json         # Machine-readable ADR
│   ├── ADR-XXXXXXXX-XXXX.md           # Human-readable ADR
│   └── ...
├── proposals/
│   ├── {proposal-id}.json             # ProposalStore entries (all states)
│   └── ...
├── reconciliation/
│   ├── {log-id}.json                  # ReconciliationLog entries
│   └── ...
└── audit/
    └── ledger.jsonl                    # Audit Ledger (append-only, hash-chain, Phase 4)
```

### 17.2 Memory Entry Schema

```json
{
  "id": "k3x8m2p9q1r5",
  "type": "lesson",
  "content": "Always verify database migration rollback strategy before applying",
  "tags": ["database", "migration", "rollback"],
  "source": "human",
  "confidence": 0.75,
  "verifiedAt": 1718100000000,
  "verificationCount": 2,
  "sessionID": "abc123",
  "created": 1718000000000,
  "updated": 1718000000000
}
```

### 17.3 DecisionProposal Schema

```json
{
  "id": "proposal-abc123",
  "key": "decision-topic-hash",
  "title": "Use Drizzle ORM for database access",
  "context": "Need type-safe SQL with migration support...",
  "proposedDecision": "Adopt Drizzle ORM over Prisma",
  "consequences": "Simpler migration files, direct SQL access when needed",
  "tags": ["database", "orm"],
  "status": "ACCEPTED",
  "proposerId": "decision-engine",
  "createdAt": 1718000000000,
  "validatedAt": 1718000050000,
  "acceptedAt": 1718000050000,
  "rejectedReason": null,
  "auditRef": "audit-001"
}
```

### 17.4 Audit Ledger Entry (JSONL)

```json
{
  "entryId": "audit-001",
  "type": "proposal_accepted",
  "timestamp": 1718000050000,
  "proposalId": "proposal-abc123",
  "agentId": "context-analyst",
  "outcome": "ACCEPTED",
  "previousHash": "sha256-of-previous-entry",
  "contentHash": "sha256-of-proposal-content"
}
```

---

## 18. Layer Composition & Dependency Injection

### 18.1 Layer Stack

```
AppLayer (app-runtime.ts)
│
├── Evolution.defaultLayer
│     ├── EvolutionBrain.layer
│     │     ├── MemoryBrain.layer
│     │     │     ├── MemoryBrain.Service (brain/memory.ts)
│     │     │     └── Uses: FSUtil, Config.Service
│     │     ├── DecisionsBrain.layer
│     │     │     ├── DecisionsBrain.Service (brain/decisions.ts)
│     │     │     ├── ProposalStore (internal module, brain/proposal-store.ts)
│     │     │     └── Uses: FSUtil, Config.Service, Evolution.Service (for getConfig)
│     │     └── ProjectBrain.layer (brain/project.ts)
│     │           └── Uses: FSUtil, Config.Service
│     │
│     ├── ContextComposer.layer (context/composer.ts)
│     │     ├── ContextComposer.Service
│     │     ├── ContextBudget.Service (context/budget.ts)
│     │     ├── ContextRetriever.Service (context/retriever.ts)
│     │     └── Uses: Evolution.Service (facade)
│     │
│     └── EvolutionDecisionEngine.layer
│           ├── DecisionEngine.Service (decision/engine.ts)
│           ├── AgentCoordinator
│           ├── ConfidenceReconciliationStrategy (decision/reconciliation.ts)
│           ├── Activation (decision/activation/index.ts)
│           ├── AgentRegistry (decision/agents/register.ts)
│           └── Uses: Evolution.Service, LLM layer
│
├── InstanceState (src/effect/instance-state.ts)
│     └── ScopedCache per directory
│
├── SystemContextBuiltIns.registerExtra(EvolutionContextLayer.register)
│     └── core/builtins executes at startup
│
└── makeRuntime (src/effect/run-service.ts)
      └── Shared memoMap deduplicates layers
```

### 18.2 Test Layer Mock Pattern

```typescript
// In tests — never provide real layers that need Config/InstanceState
const testLayer = Layer.mergeAll(
  Layer.mock(AuditLedger.Service, {
    append: () => Effect.void,
    verifyChain: () => Effect.succeed(true),
  }),
  Layer.mock(Evolution.Service, {
    getConfig: () => ({ mode: "assist" }),
    getMemories: () => Effect.succeed([]),
    getDecisions: () => Effect.succeed([]),
    getProjectContext: () => Effect.succeed(defaultProfile),
  }),
)

const program = Effect.gen(function* () {
  const svc = yield* EvolutionDecisionEngine.Service
  // ...
})

yield* Effect.provide(program, testLayer)
```

### 18.3 InstanceState Pattern

```typescript
// Per-directory state with automatic cleanup
const state = InstanceState.make(state, () =>
  Effect.gen(function* () {
    // Set up per-instance state
    const watcher = yield* setupWatcher(state.dir)
    const cache = new Map<string, unknown>()

    // Cleanup on disposal
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* watcher.close()
        cache.clear()
      })
    )

    return { watcher, cache }
  })
)

// Access (deduplicated by ScopedCache)
const instance = yield* InstanceState.get(state, dir)
```

---

## 19. Agent Roster & Capabilities

| Agent ID | Capabilities | Role | Proposals |
|---|---|---|---|
| `context-analyst` | `["proposal", "evaluate"]` | Primary evaluation agent, generates architectural proposals | ✅ Yes |
| `risk-agent` | `["enrich", "identify_risks"]` | Advisor — identifies risks in proposals | ❌ No (enrichment only) |
| `planning-agent` | `["enrich", "plan_phases"]` | Advisor — suggests implementation phases | ❌ No (enrichment only) |

**Invariant**: Only `context-analyst` has `proposal` capability. `requireProposalCapability()` enforces this at the storage layer.

---

## 20. Decision Engine Pipeline Flow

### 20.1 Full Sequence

```
1. User runs: opencode evolution evaluate
      │
2. Composition root (app-runtime.ts):
      ├── Reads ConfigEvolution (minCandidateConfidence, contextBudget)
      ├── Reads AgentRegistry (3 agents)
      └── Reads DefaultCriteriaProvider (instruction, key format, tags)
      │
3. Engine.reconcile(input):
      │
      ├── 3a. ContextComposer.provide()
      │       └── Returns EvolutionContext
      │
      ├── 3b. AgentCoordinator (Effect.all, unbounded concurrency)
      │       ├── context-analyst → ProposalCandidate (with reasoningStrength)
      │       ├── risk-agent → EnrichmentEntry (risks identified)
      │       └── planning-agent → EnrichmentEntry (phases proposed)
      │
      ├── 3c. ConfidenceReconciliationStrategy
      │       ├── Maps ordinal → numeric (LOW=0.2, MEDIUM=0.5, HIGH=0.9)
      │       ├── Checks BELOW_THRESHOLD (< minCandidateConfidence)
      │       ├── Selects winner (confidence DESC, agentId ASC)
      │       └── Returns ReconciliationResult
      │
      ├── 3d. Engine creates ReconciliationLog
      │       └── Persists via DecisionsBrain (AC-17)
      │
      └── 3e. If PROPOSAL_SUBMITTED:
              └── ProposalStore.submit(proposal)
                    ├── Tier 1 (already passed — Engine-side schema validation)
                    ├── Tier 2: Contradiction check (DUPLICATE_KEY only)
                    ├── Tier 2: Authority check (proposer ≠ approver)
                    ├── AC-06: Timeout guard (5000ms)
                    ├── State: SUBMITTED → VALIDATING → ACCEPTED | REJECTED
                    └── Rejection codes: SCHEMA_INVALID, DUPLICATE_KEY,
                                         AUTHORITY_VIOLATION, VALIDATION_TIMEOUT,
                                         VALIDATION_ERROR
```

### 20.2 State Machine (ProposalStore)

```
                    ┌──────────┐
                    │ SUBMITTED │
                    └────┬─────┘
                         │
                    ┌────▼──────┐
                    │ VALIDATING│
                    └────┬──────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         ┌────▼────┐ ┌──▼───┐ ┌───▼────┐
         │ ACCEPTED│ │REJECTED│ │TIMEOUT │
         └─────────┘ └───────┘ └────────┘
```

### 20.3 Rejection Codes

| Code | Source | When | Owner |
|---|---|---|---|
| `SCHEMA_INVALID` | Tier 1 | Engine-side validation failure (never reaches ProposalStore) | Engine |
| `DUPLICATE_KEY` | Tier 2 | Exact key match in accepted DecisionRecord | Brain |
| `AUTHORITY_VIOLATION` | Tier 2 | Self-approval attempt (DA-01 violation) | Brain |
| `VALIDATION_TIMEOUT` | AC-06 | Tier 2 exceeded configurable timeout (default 5000ms) | Brain |
| `VALIDATION_ERROR` | AC-06 | Unexpected error during Tier 2 validation | Brain |

---

## 21. Code Conventions & Patterns

### 21.1 Module Shape

```typescript
// Do NOT use export namespace — not standard ESM
// Use flat exports + self-reexport:

export interface Interface { ... }
export class Service extends Context.Tag("Service")<Service, Interface>()("@opencode/Foo") {}
export const layer = Layer.effect(Service, ...)

export * as Foo from "."
```

### 21.2 Effect Patterns

```typescript
// Composition
Effect.gen(function* () {
  const config = yield* Config.Service
  const data = yield* config.get()
  return data.evolution ?? {}
})

// Named/traced effects
const compute = Effect.fn("Metrics.snapshot")(function* () { ... })
const helper = Effect.fnUntraced(function* () { ... })  // internal only

// Callback-based APIs
Effect.callback<string>((resume) => {
  fs.readFile(path, (err, data) => {
    if (err) resume(new Error(err.message))
    else resume(Effect.succeed(data.toString()))
  })
})

// Prefer over Effect.succeed(undefined)
Effect.void

// Early failure — not yield* Effect.fail(...)
yield* new InvariantViolationError({ message: "...", operation: "..." })

// Deduplication — not Fiber | undefined
const cached = yield* Effect.cached(expensiveOperation)
```

### 21.3 Schema Composition

```typescript
// Effect v4 beta.74: Schema.extend/extendTo not available
// Use Struct spread instead:
const ConfigEvolution = Schema.Struct({
  ...InfoEvolutionSchema.fields,
  // evolution-internal fields
  validation: Schema.optional(Schema.Literal("strict", "truncate")),
  minCandidateConfidence: Schema.optional(Schema.Number),
  reconciliationStrategy: Schema.optional(Schema.Literal("confidence")),
  retention: Schema.optional(Schema.Struct({ ... })),
})
```

### 21.4 Error Construction

```typescript
// Storage errors — single constructor path only
const err = toEvolutionStorageError(cause, "read", storagePath)

// Domain errors — direct constructor
const err = new EvolutionNotEnabledError({ message: "Evolution is disabled" })

// Programming defects — Effect.die
yield* Effect.die(new InvariantViolationError({
  message: "Write capability invariant violated",
  operation: "submit",
}))
```

### 21.5 Test Layer Mock (Layer.mock)

```typescript
// NEVER provide real layer chains (Config/FSUtil/InstanceState) in tests
// Use Layer.mock instead:

const mockLayer = Layer.mergeAll(
  Layer.mock(SomeService.Service, {
    method1: () => Effect.succeed("value"),
    method2: (arg: number) => Effect.succeed(arg * 2),
  }),
  // Multiple Layer.mock calls need explicit merge
  Layer.mock(OtherService.Service, {
    // ...
  }),
)

// Layer.provideMerge with separate calls (not Layer.mergeAll) when
// mock layers don't share dependencies
const fullLayer = mockLayer.pipe(
  Layer.provideMerge(anotherMockLayer),
)
```

### 21.6 Key Constraints

- **Parallelism**: `bun test --parallel 1` — serializes test files (workaround for bun v1.3.14 Windows parallel worker timeout race)
- **Schema decoding**: `Schema.decodeUnknown(DecisionProposalSchema)` on read — not `JSON.parse`
- **Configuration default**: `staleThresholdDays: 0` = never stale (preserves existing behavior)

---

## 22. Current State & Roadmap

### 22.1 Current Phase

| Metric | Value |
|---|---|
| Phase | 5 — Self-Improvement + Governance Enforcement |
| Status | ✅ COMPLETE (all 6 sprints A–F finished 2026-06-19) |
| Total tests | ~285 evolution tests |
| Test failures | 0 |
| bun run lint:error-registry | ✅ Passes (10 error classes) |
| oxlint AD-001 | ✅ 0 violations |
| AR-004 | 🟡 MONITORING (6 mitigations implemented) |
| D-01 boundary | ✅ 0 violations |
| Active debts | 5 (KL-001, AD-CP03-03, G4-AR-001, CR-005, CR-002) |
| Active risks | 9 (AR-001–005, WATCH-P3/P5 ×2, DA-FUTURE-02) |
| Pre-existing type errors | 164 (no new errors introduced) |

### 22.2 Blockers

1. **Phase 5 ACCEPTED gate**: Pending Architecture Reviewer formal acceptance
2. **Phase 6 (Multi-Agent Orchestration)**: ✅ COMPLETE — accepted 2026-07-10

### 22.3 Roadmap

| Phase | Title | Status | Description |
|---|---|---|---|
| 1 | Foundation Brain | ✅ Complete | Memory, Project, ADR services + facade |
| 2 | Context Intelligence | ✅ CLOSED | Budget, Retriever, Composer, Provider |
| 3 | Decision Engine | ✅ COMPLETE | ProposalStore, validation, engine, reconciliation |
| 4 | Agent Orchestration | ✅ COMPLETE | 3 agents, coordinator, reconciliation, activation |
| 5 | Self-Improvement + Governance | ✅ COMPLETE (pending gate) | Metrics, analyzer, improver, governance enforcement |
| 6 | Multi-Agent Orchestration & Autonomous Execution | ✅ COMPLETE | Committee consensus, risk-tiered execution gate, worker pool, async audit, semantic contradiction stub |
| 7 | Autonomous Evolution | 🔒 Locked | Auto-execute improvements |

### 22.4 Phase 6 Gates (Post-Acceptance)

| Gate | Status |
|---|---|
| All 10 deliverables (P6-D01–P6-D10) | ✅ Implemented |
| All 10 test gates (TG-H01–TG-H09 + TG-E2E) | ✅ Verified (32/32 tests pass) |
| All 7 ACs (AC-18–AC-24) | ✅ Satisfied |
| Production runtime registration | ✅ Registered in app-runtime.ts |
| ADR-022 (Selection Strategy) | ✅ ACCEPTED — Strategy C adopted by implementation; extended reconciliation selects winner via committee consensus not confidence score |
| ADR-023 (Audit Ledger) | ✅ ACCEPTED — AsyncAuditLogger (hash-chain) + WorkerPool drain implemented and verified |
| ADR-024 (Provenance Graph) | ✅ ACCEPTED — Full pipeline routing with approveDecision/rejectDecision implements provenance tracking through ExecutionDisposition |
| ADR-025 (Confidence Calibration) | ✅ ACCEPTED — Committee consensus replaces raw confidence comparison; each agent role (veto/feasibility/unanimous) calibrated independently |
| CR-002 (Calibration data) | ⏳ Data accumulation continues |
| AR-005 (Self-reinforcement) | 📋 Deferred to Phase 7 |
| AD-CP03-03 (Retention policy) | 📋 Deferred (thresholds not exceeded) |

---

## 23. Key File Map

### Source

| Purpose | Path | Key Lines |
|---|---|---|
| Evolution Facade | `src/evolution/index.ts` | Service interface, layer composition |
| Error Definitions | `src/evolution/error.ts` | EvolutionStorageError, InvariantViolationError, toEvolutionStorageError |
| Memory Service | `src/evolution/brain/memory.ts` | save, retrieve, search, compact, verify, detectAnomalies, isStale, effectiveConfidence |
| Decision Storage | `src/evolution/brain/decisions.ts` | save, list, supersede, saveReconciliationLog |
| Project Profile | `src/evolution/brain/project.ts` | profile, detectFrameworks, getStructure, refresh |
| ProposalStore | `src/evolution/brain/proposal-store.ts` | submit, updateStatus, getById, listByStatus, requireProposalCapability |
| Context Budget | `src/evolution/context/budget.ts` | budget calculation, strict/truncate strategies |
| Context Retriever | `src/evolution/context/retriever.ts` | retrieve from facade, stale filtering, confidence sorting |
| Context Composer | `src/evolution/context/composer.ts` | EvolutionContext assembly, monotonic shrink, truncateCount |
| Context Provider | `src/evolution/context/provider.ts` | SystemContextRegistry registration, graceful degradation, memory tags |
| Context Facade | `src/evolution/context/index.ts` | Re-exports: EvolutionContext, formatEvolutionContext, ContextComposer |
| Decision Engine | `src/evolution/decision/engine.ts` | propose, reconcile, orchestrator |
| Reconciliation | `src/evolution/decision/reconciliation.ts` | ConfidenceStrategy, ReconciliationResult, ReconciliationLog |
| Agent Registry | `src/evolution/decision/agents/register.ts` | AgentFn[], AgentManifest, registerAgents |
| Activation | `src/evolution/decision/activation/index.ts` | invoke, ReconcileInput construction |
| MetricsService | `src/evolution/evolution/metrics.ts` | snapshot (9 metrics), DTO |
| AnalyzerService | `src/evolution/evolution/analyzer.ts` | analyze (4 analysis types), pure function |
| ImproverService | `src/evolution/evolution/improver.ts` | suggest (4 rules, rule-based, no LLM) |
| Memory CLI | `src/evolution/cli/memory.ts` | opencode evolution memory — list with anomalies |
| Instance State | `src/effect/instance-state.ts` | ScopedCache per directory |

### Infrastructure

| Purpose | Path | Key Lines |
|---|---|---|
| App Runtime | `src/effect/app-runtime.ts` | Layer composition, registerExtra wiring, activation entry point |
| Run Service | `src/effect/run-service.ts` | makeRuntime, Layer.fresh, shared memoMap |
| Config Schema | `packages/core/src/v1/config/config.ts` | InfoEvolutionSchema, staleThresholdDays |
| SystemContext Builtins | `packages/core/src/system-context/builtins.ts` | registerExtra (push-based), execution loop |
| Error Registry lint | `script/check-error-registry.ts` | Scans src/evolution/*.ts for error classes |
| CI workflow | `.github/workflows/test.yml` | bun test, lint:error-registry, Linux + Windows |
| package.json | `packages/opencode/package.json` | test (--parallel 1), lint:error-registry |

### Documentation

| Document | Location | Content |
|---|---|---|
| Complete Reference (this) | `docs/evolution/EVOLUTION_COMPLETE_REFERENCE.md` | Full cross-reference of all artifacts |
| Architecture Principles | `docs/evolution/ARCHITECTURAL_PRINCIPLES.md` | P-01 through P-11 |
| Architecture Decisions | `docs/evolution/DECISIONS.md` | ADR-001 through ADR-025 (2330 lines) |
| Architecture Debt Registry | `docs/evolution/ARCHITECTURE_DEBT_REGISTRY.md` | 5 active, 7 resolved debts |
| Risk Watchlist | `docs/evolution/ARCHITECTURAL_RISK_WATCHLIST.md` | 9 risks with trigger/promotion criteria |
| Error Registry | `docs/evolution/ERROR_REGISTRY.md` | 10 error classes, classification, boundary audit |
| State (SSOT) | `docs/evolution/EF-AI_STATE.md` | Phase gates, acceptance decisions, active status |
| Phase 5 Spec | `docs/evolution/PHASE5_SPECIFICATION.md` | Full Sprint A–F specification (1466 lines) |
| Session Log | `docs/evolution/SESSION_LOG.md` | Chronological record of all sessions (1315 lines) |
| ADR-023 | `docs/evolution/ADR-023_AUDIT_LEDGER.md` | Full audit ledger design |
| ADR-024 | `docs/evolution/ADR-024_DECISION_PROVENANCE.md` | Full provenance graph design |
| ADR-025 | `docs/evolution/ADR-025_CONFIDENCE_CALIBRATION.md` | Full calibration framework design |
| G4 AR-001 Research | `docs/evolution/G4-AR-001-research.md` | 10-dimension strategy matrix |
| Sprint E Report | `docs/evolution/G5-SPRINT-E.md` | Retention analysis, binary recommendation |
| Evolution docs zip | `docs/evolution/evolution-docs.zip` | Archive of all docs (168,876 bytes) |

---

*Generated 2026-06-19. See individual ADR documents and source code for authoritative details.*
