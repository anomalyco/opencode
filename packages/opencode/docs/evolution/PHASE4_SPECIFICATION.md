# Phase 4 — Agent Orchestration

**Status**: HLD UNDER REVIEW (P4-DR1 gate)
**Target**: ACCEPTED after P4-DR1
**Author**: Principal Engineer (Claude)
**Synthesis**: ChatGPT (Architecture Reviewer) + Gemini + Grok
**Prerequisite**: Phase 3 COMPLETE (36 tests, 0 failures, 2026-06-16)
**Dependencies**: ADR-012 v2, ADR-013, ADR-014, ADR-015
**New ADRs required**: ADR-016 (Agent Isolation), ADR-017 (Reconciliation Authority)

---

## Executive Summary

Phase 1–3 membangun sistem yang bisa mengingat (Memory), memahami (Context), dan memutuskan (Decision Engine). Phase 4 menambahkan kemampuan untuk mengambil **banyak perspektif sebelum memutuskan**.

Phase 4 **bukan** tentang autonomy. Phase 4 adalah tentang kualitas keputusan melalui multiple specialist viewpoints, dengan semua authority boundaries dari Phase 3 tetap intact.

---

## Architecture Pipeline

```
                    ┌─────────────────────────────┐
                    │      AgentCoordinator        │
                    │  (stateless, fan-out/fan-in) │
                    └──────────────┬───────────────┘
                                   │ receives: EvolutionContext + Criteria
                                   │ fan-out to N agents (parallel)
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ResearchAgent          RiskAgent          PlanningAgent
     (stateless)            (stateless)         (stateless)
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │ produces: ProposalCandidate[]
                                   ▼
                    ┌─────────────────────────────┐
                    │      DecisionEngine          │
                    │  (reconciliation + submit)   │
                    └──────────────┬───────────────┘
                                   │
                   ┌───────────────┼───────────────┐
                   ▼               ▼               ▼
            ReconciliationLog  ProposalStore  (one candidate
            (auditable,        (existing,      selected or
             persisted)         unchanged)      rejected)
                                   │
                                   ▼
                        Phase 3 Validation Pipeline
                        (Tier 1 + Tier 2, unchanged)
                                   │
                         ┌─────────┴──────────┐
                         ▼                    ▼
                    ACCEPTED            REJECTED + reason_code
                    (DecisionRecord)    (ProposalStore audit)
```

---

## Data Model

### ProposalCandidate (transient, NEVER persisted)

```typescript
interface ProposalCandidate {
  readonly agentId: string
  readonly confidenceScore: number           // 0.0 – 1.0
  readonly rationale: string
  readonly proposedAction: string
  readonly tags: readonly string[]
  readonly producedAt: number                // timestamp, for ordering
  // supportingContext is intentionally excluded — agents don't share context with each other
}

// ProposalCandidate lifecycle:
// Created by Agent → Passed to AgentCoordinator → Passed to DecisionEngine
// NEVER written to disk, NEVER passed to ProposalStore directly
// Garbage collected after DecisionEngine reconciliation completes
```

### ReconciliationLog (created by DecisionEngine, persisted by Brain — audit metadata only)

```typescript
interface ReconciliationLog {
  readonly sessionId: string
  readonly contextHash: string               // hash of EvolutionContext used
  readonly candidates: readonly CandidateSummary[]
  readonly selectedCandidateAgentId: string | null  // null = all rejected
  readonly selectionReason: ReconciliationReason
  readonly outcome: "PROPOSAL_SUBMITTED" | "ALL_REJECTED" | "BELOW_THRESHOLD"
  readonly proposalId?: string              // if PROPOSAL_SUBMITTED
  readonly createdAt: number
}

interface CandidateSummary {
  readonly agentId: string
  readonly reasoningStrength: "low" | "medium" | "high"  // ordinal, per agent
  readonly confidenceScore: number                        // engine-normalized, 0.0–1.0
  readonly selected: boolean
  readonly rejectionReason?: string         // if not selected
}

type ReconciliationReason =
  | "HIGHEST_CONFIDENCE"                   // default: winner by score (G1–G3 only)
  | "ALL_BELOW_THRESHOLD"                  // all rejected, no submission
```

**Note**: ReconciliationLog = audit metadata only. Tidak ada full rationale, full prompt, atau full context dalam log. Setiap candidate menyimpan `agentId`, `reasoningStrength`, `confidenceScore` (engine-normalized), `selected`, dan optional `rejectionReason`. `CONSENSUS` dan `EXPERT_HIERARCHY` strategies dipindahkan ke future ADR (Phase 5+).

### Confidence Threshold

```typescript
interface ConfigEvolution {
  // ... existing Phase 2/3 fields ...
  minCandidateConfidence?: number           // default: 0.3 (below = auto-rejected)
  reconciliationStrategy?: "CONFIDENCE"     // G1–G3: only CONFIDENCE strategy
                                           // default: "CONFIDENCE"
}
```

**Confidence model**: Agent menghasilkan ordinal `reasoningStrength: "low" | "medium" | "high"`. DecisionEngine menormalisasi ke `confidenceScore` numeric untuk comparison:

| reasoningStrength | confidenceScore mapping |
|---|---|
| `"low"` | mapped to range [0.0, 0.4) — default 0.2 |
| `"medium"` | mapped to range [0.4, 0.7) — default 0.5 |
| `"high"` | mapped to range [0.7, 1.0] — default 0.85 |

Ini memastikan:
- Perbandingan antar agent valid (semua under same scoring contract)
- Tidak ada false precision (ordinal, bukan scalar yang tidak terkalibrasi)
- Deterministic (mapping function adalah pure function)
- Audit trail tetap mencakup `reasoningStrength` asli

Jika semua candidates < `minCandidateConfidence`:
- → outcome: `"BELOW_THRESHOLD"`
- → TIDAK ada proposal yang disubmit ke validation
- → ReconciliationLog mencatat alasan
- → TIDAK ada error — ini adalah valid outcome

---

## Component Responsibility Matrix

| Component | Diperbolehkan | DILARANG |
|---|---|---|
| **AgentCoordinator** | Agent selection, parallel fan-out, candidate collection, passing to Engine | Direct brain access, ProposalStore write, reading other agents' candidates, **filtering/ranking/reconciliation** |
| **Specialist Agent** | Context analysis, produce ONE ProposalCandidate | State between calls, brain imports, ProposalStore write, knowing other agents |
| **DecisionEngine** | Reconciliation via ReconciliationLog, formal Proposal generation, submit to validation, **create ReconciliationLog** | Self-approval, direct DecisionRecord creation, persistent state |
| **ReconciliationLog** | Audit trail for reconciliation decision, persistence by Brain | Influencing future reconciliation decisions |
| **ProposalStore** | All proposal persistence (existing, unchanged) | Direct writes from agents |
| **Evolution Brain** | Validate, **persist** ReconciliationLog, accept/reject proposals | Creating reconciliation decision, influencing algorithm |

**AgentCoordinator boundary**: collect only. No filtering, no ranking, no reconciliation.
**ReconciliationLog lifecycle**: DecisionEngine creates log (owns reconciliation result) → Brain persists log (owns persistence only).

Kunci: Agents **TIDAK** bisa saling melihat kandidat masing-masing. Isolation ini mencegah cognitive bias antar agent (→ ADR-016).

---

## Architectural Constraints (Existing + New)

| ID | Constraint | Source |
|---|---|---|
| AC-08 | AgentCoordinator TIDAK boleh akses brain internals langsung | Phase 3 AD-001 |
| AC-09 | Agent TIDAK boleh write ke ProposalStore | New |
| AC-10 | DecisionEngine adalah satu-satunya submission authority | Phase 3 ADR-013 |
| AC-11 | ProposalCandidate adalah transient — TIDAK pernah dipersist | New |
| AC-12 | AgentCoordinator dan semua Agents harus stateless | New |
| AC-13 | Tidak ada autonomous execution — human approval tetap mandatory | New |
| AC-14 | Reconciliation logic harus deterministic dan auditable (→ ReconciliationLog) | New (Grok) |
| AC-15 | **Agent isolation** — Agent A tidak boleh akses kandidat Agent B sebelum rekonsiliasi. Fan-out adalah parallel, bukan sequential pipeline. | New (ADR-016) |
| AC-16 | **Confidence threshold** — jika semua candidates < threshold, TIDAK ADA proposal yang disubmit. Outcome: BELOW_THRESHOLD, tidak ada error. | New (gap resolution) |
| AC-17 | **ReconciliationLog wajib persisted** SEBELUM proposal disubmit ke validation. Jika ReconciliationLog gagal disimpan → proposal TIDAK disubmit. | New (gap resolution) |
| AC-18 | **ReconciliationLog = audit metadata only**. Tidak ada full rationale, full prompt, atau full context dalam log. Mencegah log menjadi proposal storage kedua. | New (P4-RISK-02) |

---

## New ADRs Required (before Sprint G1)

### ADR-016: Agent Isolation Model

**Problem**: Jika Agent A bisa lihat kandidat Agent B sebelum reconciliation, Agent A bisa "meniru" atau "bereaksi" terhadap Agent B. Ini menciptakan correlation yang mengurangi nilai multi-perspective.

**Decision**: Strict isolation — setiap agent hanya menerima:
- `EvolutionContext` (baca dari facade, sama untuk semua)
- `DecisionCriteria` (sama untuk semua)
- Tidak ada akses ke kandidat agent lain

**Enforcement**: `AgentCoordinator` mengeksekusi fan-out sebagai `Effect.all` parallel. Setiap agent adalah isolated Effect yang tidak ada shared state.

### ADR-017: Reconciliation Authority

**Problem**: DecisionEngine perlu memilih satu dari banyak candidates. Siapa yang menentukan algoritma reconciliation? Siapa yang memiliki reconciliation result vs persistence?

**Decision**:

1. **DecisionEngine OWNS reconciliation decision** — termasuk algorithm selection, candidate comparison, winner selection, dan ReconciliationLog creation.
2. **DecisionsBrain OWNS reconciliation persistence** — menyimpan ReconciliationLog yang sudah dibuat oleh Engine.
3. **ReconciliationLog = audit metadata only** — tidak ada full rationale, full prompt, atau full context. Mencegah log menjadi proposal storage kedua.

**Algorithm**: G1–G3 hanya `CONFIDENCE` strategy. Highest confidenceScore menang. Tiebreaker tidak diperlukan di v1 (confidenceScore adalah continuous value dengan default mapping, sangat unlikely equal).

**Interface**: `ReconciliationStrategy` didefinisikan sebagai abstract interface sejak G1, meskipun implementasi awal hanya `ConfidenceStrategy`. Ini mencegah God DecisionEngine.

```typescript
interface ReconciliationStrategy {
  readonly name: string
  readonly reconcile: (
    candidates: readonly ProposalCandidate[],
    config: { minCandidateConfidence: number },
  ) => ReconciliationLog
}
```

**Confidence model**: Agen menghasilkan ordinal `reasoningStrength: "low" | "medium" | "high"`. Engine menormalisasi ke confidenceScore numeric dengan mapping function deterministic. Semua agent under same scoring contract — perbandingan valid.

**Terminal condition**: If all candidates < minCandidateConfidence → BELOW_THRESHOLD. Tidak ada error — ini valid outcome.

**Enforcement**:
- AC-14 (deterministic + auditable via ReconciliationLog)
- AC-16 (threshold behavior)
- AC-17 (log before submit)
- AC-18 (audit metadata only, not storage)

---

## Sprint Plan

### P4-DR1: High-Level Design Review Gate

**Mandatory before Sprint G1 dimulai.**

HLD detail ada di `PHASE4_HLD.md`. HLD harus menjawab:

1. **DR1-A**: Full ownership matrix — AgentCoordinator, AgentRegistry, DecisionEngine, ReconciliationStrategy, ReconciliationLog, Brain, ProposalStore
2. **DR1-B**: Sequence diagram untuk BOTH paths — happy path (candidate selected) AND all-below-threshold (no proposal)
3. **DR1-C**: DecisionEngine reconciliation algorithm — step-by-step deterministic flow (fan-out → collect → compare → select → log → submit/reject)
4. **DR1-D**: Confidence scoring contract — bagaimana agents produce comparable scores (ordinal reasoningStrength → engine-mapped confidenceScore)

**P4-DR1 acceptance criteria**:
- DR1-A through DR1-D answered in `PHASE4_HLD.md`
- Architecture Reviewer (ChatGPT) accepts HLD
- Gemini dan Grok review — no fatal assumptions found
- Principal Engineer confirms ADR-016 + ADR-017 language
- Chief Architect authorizes Sprint G1

---

### Sprint G1 — Data Foundation

| | |
|---|---|
| **Deliverables** | G1-D01: ProposalCandidate schema + utilities (types + validation) |
| | G1-D02: Agent interface contract (typed input/output) |
| | G1-D03: ReconciliationLog schema + ProposalStore integration |
| | G1-D04: ConfigEvolution additions (minCandidateConfidence, reconciliationStrategy) |
| | G1-D05: ADR-016 + ADR-017 formal text in DECISIONS.md |

**Test Gates**:
- TG-ISOLATION: Agent interface has no access to other agents' output type
- TG-TRANSIENT: ProposalCandidate has no storage method (structural, not behavioral)
- TG-THRESHOLD: ConfigEvolution parses minCandidateConfidence correctly
- TG-RLOG-SCHEMA: ReconciliationLog schema validates correctly

**Evidence (ADR-012 v2 compliant)**:
- `bun test test/evolution/decision/g1-*.test.ts` output (verbatim)
- `grep "ProposalCandidate" src/evolution/decision/proposal-candidate.ts`
- `grep "ReconciliationLog" src/evolution/brain/decisions.ts`

---

### Sprint G2 — First Specialist Agent

**Scope**: Satu agent dulu, bukan semua sekaligus. *"Do one thing right before scaling."*

| | |
|---|---|
| **Deliverables** | G2-D01: ContextAnalystAgent (first specialist agent) |
| | | - Input: EvolutionContext + DecisionCriteria |
| | | - Output: ProposalCandidate (confidence + rationale) |
| | | - Uses: LLM via generateObject (AC-07 compliant, structured output) |
| | | - Stateless: no let, no var, no cache, no Map, no Set |
| | G2-D02: Agent Registry (Effect service, compile-time registration only — no runtime discovery in Phase 4) |

**Test Gates**:
- TG-AGENT-STATELESS: ContextAnalystAgent source has no mutable state
- TG-AGENT-OUTPUT: Agent produces schema-valid ProposalCandidate
- TG-AGENT-ISOLATION: Agent cannot import from brain/*
- TG-AGENT-NO-STORE: Agent has no ProposalStore import

**Evidence**:
- `bun test test/evolution/decision/g2-*.test.ts` output
- `bun x oxlint src/evolution/decision/agents/` (no violations)
- `grep "let \|var " src/evolution/decision/agents/` → 0 matches

---

### Sprint G3 — AgentCoordinator + Reconciliation

| | |
|---|---|
| **Deliverables** | G3-D01: AgentCoordinator service (stateless, Effect-based fan-out) |
| | | - fan-out via Effect.all (parallel, isolated) |
| | | - collects ProposalCandidate[] |
| | | - **collect only**: no filtering, no ranking, no reconciliation |
| | | - ALL candidates passed to DecisionEngine (including low-confidence) |
| | | - passes to DecisionEngine (does NOT reconcile itself) |
| | G3-D02: Reconciliation logic in DecisionEngine |
| | | - implement AC-14: deterministic by confidenceScore |
| | | - implement AC-16: BELOW_THRESHOLD terminal outcome |
| | | - implement ADR-017 authority |
| | G3-D03: ReconciliationLog persistence (before proposal submission) |
| | | - implement AC-17: log BEFORE submit |

**Test Gates**:
- TG-FANOUT: AgentCoordinator fans out to N agents in parallel
- TG-RECONCILE-HIGHEST: highest confidence wins when threshold met
- TG-RECONCILE-THRESHOLD: all below threshold → BELOW_THRESHOLD outcome, no proposal
- TG-RLOG-PERSISTED: ReconciliationLog written before ProposalStore.submit
- TG-AC12-COORDINATOR: AgentCoordinator source has no mutable state
- TG-AC15-ISOLATION: agents cannot access each other's candidates

**Evidence**:
- `bun test test/evolution/decision/g3-*.test.ts` output
- ReconciliationLog file exists at `.opencode/evolution/reconciliation-*.json`

---

### Sprint G4 — Integration + Design Investigations

| | |
|---|---|
| **Deliverables** | G4-D01: Additional specialist agents (RiskAgent, PlanningAgent) |
| | | Following same pattern as G2-D01 |
| | G4-D02: Full integration test — end-to-end |
| | | AgentCoordinator → 3 agents → reconciliation → Engine → Validation → Record |
| | G4-D03: HELD State Design Document (P4-D06) |
| | | - Research, NOT implementation |
| | | - Define: what does HELD mean, who resolves it, how is Phase 5 the right home |
| | | - Output: ADR-018 DRAFT (proposed, not accepted) |
| | G4-D04: Contradiction Analysis Research Report (P4-D07, DA-FUTURE-02) |
| | | - Research: what semantic contradiction detection looks like |
| | | - Prototype: simple tag-based contradiction (not semantic similarity) |
| | | - Output: Technical report + candidate ADR for Phase 5 |

**Test Gates**:
- TG-E2E: Full pipeline passes with 3 agents (multi-candidate reconciliation)
- TG-REGRESSION: All Phase 1–3 tests still pass (129 tests, 0 failures baseline)
- TG-RLOG-AUDIT: ReconciliationLog readable, agent selections auditable

**Evidence**:
- `bun test test/evolution/` output — ALL phases
- Full test count: expected > 129 + Phase 4 additions
- 0 failures

---

## Explicit Non-Goals (Phase 4)

| Non-Goal | Destination |
|---|---|
| ❌ Self-improvement loops | → Phase 5 |
| ❌ Autonomous coding | → Phase 5+ |
| ❌ Recursive agent spawning | → Phase 5+ |
| ❌ Multi-model routing | → Phase 6 |
| ❌ HELD state implementation | → Phase 5 (investigation in G4-D03) |
| ❌ Semantic contradiction detection | → Phase 5 (research in G4-D04) |
| ❌ Autonomous execution | → Never without explicit architecture gate |

---

## Success Criteria

Phase 4 IMPLEMENTED ketika:

| Criteria | Verified By |
|---|---|
| Multiple agents menghasilkan ProposalCandidate | TG-FANOUT |
| DecisionEngine merekonsiliasi secara deterministic | TG-RECONCILE-HIGHEST |
| BELOW_THRESHOLD outcome berfungsi (no proposal when all low-confidence) | TG-RECONCILE-THRESHOLD |
| ReconciliationLog persisted sebelum proposal submit | TG-RLOG-PERSISTED |
| Agent isolation terjaga (AC-15) | TG-AC15-ISOLATION |
| Semua agents stateless (AC-12) | TG-AC12-COORDINATOR |
| No direct brain imports di agents (AD-001 oxlint) | `bun x oxlint agents/` |
| Phase 1–3 regression tidak rusak | Full regression, 0 failures |
| ADR-016 + ADR-017 accepted | Architecture Reviewer verdict |
| Enrichment Pipeline (bukan competition) | G4-04: generator/advisors split |
| Ownership protection (advisors bukan winner) | G4-04: AR-001 enforcement |
| Winner dari proposal-capable agent only | G4-04: REQ-05 enforcement |
| Debt G4-AR-001 tercatat | ARCHITECTURE_DEBT_REGISTRY.md |

Phase 4 ACCEPTED membutuhkan tambahan:

| Criteria | Verified By |
|---|---|
| Evidence DTO: participants, enrichments, winner di runtime | G4-D02: summariseAdvisorOutput tests |
| CLI evaluate menampilkan participants + enrichments | Source verification — evaluate.ts |
| Real LLM execution artifact | `opencode evolution evaluate` output |

---

## State Update Post-Phase 4 Complete

EF-AI akan memiliki:

| Phase | Title | Status |
|---|---|---|
| Phase 1 | Foundation Brain | ✅ Complete |
| Phase 2 | Context Intelligence | ✅ Complete |
| Phase 3 | Decision Engine | ✅ Complete |
| Phase 4 | Agent Orchestration | ✅ **IMPLEMENTED** — G4 ACCEPTANCE PENDING |

Capability pipeline setelah Phase 4:

```
Evidence → Context → Memory
→ [RiskAgent, PlanningAgent] (advisors, enrich proposal)
→ ContextAnalyst (proposal generator, single proposal-capable)
→ Reconciliation (deterministic, confidence-based — generators only)
→ DecisionEngine (formal proposal submission)
→ Validation (Tier 1 + Tier 2)
→ ACCEPTED / REJECTED (with full audit trail)
```

---

## Gate Summary

```
P4-DR1 → HLD Review (mandatory before G1)
  ↓
Sprint G1 → Data Foundation (schema, types, ADR-016/017)
  ↓
Sprint G2 → First Agent (ContextAnalystAgent)
  ↓
Sprint G3 → Coordinator + Reconciliation
  ↓
Sprint G4 → Multi-Agent Foundation + Enrichment Pipeline
  ↓
G4 Evidence Gate → Runtime evidence: participants, enrichments, winner
  ↓
Phase 4 ACCEPTED  →  Phase 5 UNLOCKED

See PHASE5_SPECIFICATION.md for G5 proposal.
```
