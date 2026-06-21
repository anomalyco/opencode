# Phase 6 — Multi-Agent Orchestration & Autonomous Execution

**Date**: 2026-06-19
**Author**: Principal Engineer (Claude) + ChatGPT (Architecture Reviewer)
**Status**: ACCEPTED — All 10 deliverables (P6-D01–P6-D10) implemented and verified in production runtime
**Classification**: Phase Gate Document (Level 3)
**Prerequisite**: Phase 5 ACCEPTED, PHASE3_AMENDMENT_V3 applied, ADR-026 ACCEPTED
**Based on**: ADR-026 (HELD State), PHASE3_AMENDMENT_V3, Phase 1–5 complete, ARCHITECTURAL_PRINCIPLES.md

---

## Executive Summary

Phase 1–5 membangun fondasi: memory (P1), context (P2), decision engine (P3), multi-agent orchestration (P4), dan measurement loop (P5). Phase 6 adalah fase **otonomi terbatas** — sistem dapat mengeksekusi keputusan secara otomatis dalam batas risiko yang ditentukan, dengan koordinasi multi-agen berbasis veto hierarkis dan konsensus.

**Phase 6 bukan** tentang full autonomy. Phase 6 adalah tentang **execution with guardrails**: auto-execute untuk keputusan berisiko rendah, HELD + manual approval untuk keputusan berisiko tinggi, dengan semantic contradiction detection sebagai safety net.

### Konsep Inti

| Konsep | Prinsip |
|---|---|
| **Konsensus > Skor** | Sistem tidak memilih aksi dengan skor tertinggi — hanya yang disepakati semua agen |
| **Veto Hierarkis** | RiskAnalyst memiliki hak veto absolut; satu veto → HELD |
| **Risk-Tiered Execution** | Risiko rendah auto-execute; risiko tinggi → manual approval |
| **Semantic Check** | Kontradiksi semantik antar aturan → HELD (infrastructure ready) |
| **Bounded Concurrency** | Maksimal 5 worker paralel, antrian FIFO, timeout 60s |

---

## Section 1 — Multi-Agent Routing & Specialization

### 1.1 Agent Roles

| Agent | Role | Proposal-Capable | Veto Power |
|---|---|---|---|
| **ContextAnalyst** | Mengusulkan solusi berdasarkan context | ✅ Ya | ❌ Tidak |
| **RiskAnalyst** | Analisis risiko, hak veto absolut | ❌ Tidak (enrichment only) | ✅ Veto (HIGH/CRITICAL → HELD) |
| **PlanningAnalyst** | Pemeriksaan kelayakan teknis (feasibility) | ❌ Tidak (enrichment only) | ❌ Tidak (rekomendasi saja) |
| *(Future)* | Reserved untuk spesialis tambahan | TBD | TBD |

### 1.2 Committee Consensus Flow

```
Collect proposals from all proposal-capable agents (currently: ContextAnalyst only)
    │
    ▼
Collect enrichments from specialist agents (RiskAnalyst, PlanningAnalyst)
    │
    ▼
Compare proposedAction across all agents:
    │
    ├── Different proposedAction → HELD (konsensus gagal)
    │
    ├── RiskAnalyst veto (HIGH/CRITICAL) → HELD_FOR_REVIEW
    │
    └── All agents agree + low risk → PROPOSAL_SUBMITTED
```

### 1.3 Implementation

```typescript
interface AgentProposal {
  agentId: string
  proposedAction: string
  confidence: number
  reasoning: string
}

type ConsensusOutcome =
  | { type: "PROPOSAL_SUBMITTED"; selected: AgentProposal }
  | { type: "HELD_FOR_REVIEW"; conflicts: AgentProposal[]; vetoReason?: string }
```

**Rules**:
- Jika ada perbedaan `proposedAction` antar agen → HELD (tidak memilih salah satu)
- Jika RiskAnalyst memberi `recommendation: "REJECT"` dan `critical: true` → HELD
- Hanya jika semua agen menghasilkan aksi identik dan aman → PROPOSAL_SUBMITTED

### 1.4 RiskAnalyst Veto Authority

RiskAnalyst memiliki **hak veto absolut**. Outputnya:

```typescript
interface RiskAnalystOutput {
  assessment: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
  recommendation: "APPROVE" | "REJECT" | "MODIFY"
  critical: boolean
  recommendationCategory: string
}
```

Jika `critical === true` dan `recommendation === "REJECT"` → engine harus menahan proposal. Veto tidak bisa di-override oleh agen lain atau oleh confidence score.

---

## Section 2 — Auto-Execution Classification

### 2.1 Risk-Tiered Execution

Keputusan diklasifikasikan berdasarkan kategori risiko. Hanya kategori berisiko rendah yang diizinkan auto-execute:

| Kategori Risiko | Contoh | Auto-Execute |
|---|---|---|
| **CONFIG_THRESHOLD** | Perubahan threshold numerik, parameter tuning | ✅ Ya |
| **CONFIG_BUDGET** | Alokasi sumber daya, reversible | ✅ Ya |
| **AGENT_INSTRUCTION** | Prompt refinement, koreksi format | ✅ Ya |
| **MODE_OPERATION** | Perubahan mode operasi (assist ↔ auto) | ❌ Manual |
| **DATA_ARCHITECTURE** | Perubahan struktur data utama | ❌ Manual |
| **MEMORY_ADDITION** | Penambahan memori baru | ❌ Manual |
| **HELD_REVIEW** | Keputusan yang sebelumnya di-HELD | ❌ Manual |

### 2.2 Gate Function

```typescript
function isAutoExecutable(category: DecisionCategory): boolean {
  switch (category) {
    case "CONFIG_THRESHOLD":
    case "CONFIG_BUDGET":
    case "AGENT_INSTRUCTION":
      return true
    case "MODE_OPERATION":
    case "DATA_ARCHITECTURE":
    case "MEMORY_ADDITION":
    case "HELD_REVIEW":
      return false
  }
}
```

### 2.3 Execution Pipeline

```
Decision produced
    │
    ▼
isAutoExecutable(category)?
    │
    ├── YES → execute langsung → log ke audit
    │
    └── NO  → set status = HELD → notifikasi manusia → tunggu approval
                │
                ├── APPROVED → execute → log ke audit
                └── REJECTED → discard → log ke audit
```

### 2.4 Audit & Logging

Setiap keputusan, baik auto-execute maupun HELD, dicatat di ReconciliationLog:

```typescript
interface AuditEntry {
  decisionId: string
  category: DecisionCategory
  outcome: "AUTO_EXECUTED" | "HELD_FOR_REVIEW" | "APPROVED" | "REJECTED"
  executor: "system" | "human"
  timestamp: number
  reason: string
}
```

---

## Section 3 — Semantic Contradiction Detection (Infrastructure)

### 3.1 Architecture

Phase 6 menyiapkan infrastruktur untuk semantic contradiction detection. Implementasi embedding penuh ditunda ke Phase 7+, tetapi struktur data dan interface sudah siap.

```
┌──────────────────────────────┐
│      VectorStore             │
│  ┌────────────────────────┐  │
│  │ id: string             │  │
│  │ embedding: number[]    │  │  ← initially empty
│  │ metadata: {            │  │
│  │   ruleId, text, source │  │
│  │ }                      │  │
│  └────────────────────────┘  │
└──────────────────────────────┘
```

### 3.2 Similarity Function

```typescript
// Phase 6: stub — returns 0.0 (no contradiction detected)
// Phase 7+: implement with real embedding model
function calculateSimilarity(textA: string, textB: string): number {
  return 0.0  // stub: treat all rules as non-contradictory
}

// When similarity > threshold, flag as potential contradiction
function detectContradiction(rules: Rule[]): ContradictionReport {
  // Phase 6: always returns empty (no contradictions)
  return { contradictions: [] }
}
```

### 3.3 Data Structure

```typescript
interface RuleEmbedding {
  id: string
  embedding: number[]       // Phase 6: empty array
  metadata: {
    ruleId: string
    text: string
    source: string
    createdAt: number
  }
}

interface ContradictionReport {
  contradictions: Array<{
    ruleA: string
    ruleB: string
    similarity: number
    description: string
  }>
}
```

**Storage**: File-based JSON (`.opencode/evolution/embeddings.json`) — konsisten dengan pola storage Phase 1–5. Embedding array dikosongkan; struktur siap diisi oleh model embedding eksternal.

### 3.4 Integration with HELD

Ketika contradiction terdeteksi (Phase 7+):
```
Rule A contradicts Rule B semantically
    │
    ▼
detectContradiction() → similarity > threshold
    │
    ▼
Engine: set outcome = HELD_FOR_REVIEW
reason: "Semantic contradiction between Rule A and Rule B"
```

---

## Section 4 — Load Management & Resilience

### 4.1 Concurrency Limit

| Parameter | Value |
|---|---|
| Max concurrent workers | 5 |
| Queue discipline | FIFO (first-in, first-out) |
| Per-worker timeout | 60 seconds |
| Overflow behavior | Queue (not reject) |

### 4.2 Implementation

```typescript
interface WorkerPool {
  active: number        // current active workers (0–5)
  queue: Array<{        // FIFO queue
    id: string
    task: Effect.Effect<any>
    enqueuedAt: number
  }>
}

const POOL_CONFIG = {
  maxWorkers: 5,
  workerTimeout: Duration.seconds(60),
}
```

**Mechanism**:
- Semaphore-based: `Ref<number>` counting active workers
- Queue: `Queue` from Effect (bounded, dropping when full → queue instead)
- Timeout: `Effect.timeout(workerTimeout)` wrapping each worker task
- Lock release: `Effect.ensuring` di worker task → decrement semaphore + process next from queue

### 4.3 Timeout & Lock Release

```
Worker acquired (semaphore -1)
    │
    ▼
Worker task running
    │
    ├── completes in <60s → release lock (semaphore +1) → process queue
    │
    └── exceeds 60s → Effect.timeout fires
        → release lock (semaphore +1) via Effect.ensuring
        → log timeout to audit
        → process next from queue
```

### 4.4 Async Audit Logging

Audit logging berjalan asynchronous agar tidak memblokir execution pipeline:

```typescript
// Separate log queue — non-blocking
const logQueue = Queue.unbounded<AuditEntry>()

// Background consumer (forked at layer init)
const consumer = logQueue.takeBetween(1, 100).pipe(
  Effect.flatMap((batch) => writeBatchToLedger(batch)),
  Effect.forever,
  Effect.forkScoped,
)

// Producer — never blocks execution
function logAudit(entry: AuditEntry) {
  return logQueue.offer(entry).pipe(Effect.ignore)
}
```

---

## Section 5 — Test Gates

| ID | Test | What It Verifies | Sprint |
|---|---|---|---|
| TG-H01 | RiskAnalyst veto | RiskAnalyst REJECT + critical=true → HELD_FOR_REVIEW | F1 |
| TG-H02 | Agent disagreement | Two agents propose different actions → HELD | F1 |
| TG-H03 | Auto-execute threshold | CONFIG_THRESHOLD → auto-execute (no HELD) | F1 |
| TG-H04 | Manual-required mode change | MODE_OPERATION → HELD (not auto) | F1 |
| TG-H05 | Timeout recovery | Worker stuck 65s → timeout fires at 60s → lock released | F1 |
| TG-H06 | FIFO queue order | Tasks queued in order → processed in order | F2 |
| TG-H07 | Max concurrency | 6 simultaneous requests → 5 run, 1 queued | F2 |
| TG-H08 | Semantic contradiction stub | `calculateSimilarity` returns 0.0 for all inputs | F2 |
| TG-H09 | Async audit non-blocking | Log queue does not block execution pipeline | F2 |
| TG-E2E | Full workflow | Propose → consensus → auto-execute/HELD → audit log | F3 |

---

## Section 6 — Deliverables

| ID | Deliverable | Sprint |
|---|---|---|
| P6-D01 | Agent specialization roles & registry | F1 |
| P6-D02 | Committee consensus engine (veto-aware) | F1 |
| P6-D03 | Risk-tiered execution gate (isAutoExecutable) | F1 |
| P6-D04 | Execution pipeline with HELD routing | F1 |
| P6-D05 | Worker pool with FIFO queue + semaphore | F2 |
| P6-D06 | Per-worker timeout + lock release | F2 |
| P6-D07 | Async audit logging infrastructure | F2 |
| P6-D08 | Vector store data structure (stub embeddings) | F2 |
| P6-D09 | Semantic similarity interface | F2 |
| P6-D10 | Evidence package + regression suite | F3 |

---

## Section 7 — Architectural Constraints

| ID | Constraint | Source |
|---|---|---|
| **AC-18** | Konsensus > Skor — tidak ada seleksi berdasarkan confidence score tertinggi jika agen tidak setuju | ADR-026 |
| **AC-19** | Veto tidak bisa di-override — RiskAnalyst veto adalah final | ADR-026 |
| **AC-20** | Execution gate wajib — `isAutoExecutable` harus dipanggil sebelum eksekusi | P6-D03 |
| **AC-21** | Worker pool bound — max 5 concurrent workers, FIFO queue | P6-D05 |
| **AC-22** | Timeout wajib — setiap worker punya batas 60 detik | P6-D06 |
| **AC-23** | Audit async — log tidak boleh memblokir execution | P6-D07 |
| **AC-24** | HELD without ADR-026 context = violation — lihat PHASE3_AMENDMENT_V3 | PHASE3_AMENDMENT_V3 |

---

## Section 8 — Failure Conditions (Immediate Review Trigger)

| Condition | Violation |
|---|---|
| Engine selects winner by confidence score when agents disagree | AC-18 |
| RiskAnalyst veto diabaikan | AC-19 |
| Keputusan berisiko tinggi dieksekusi tanpa manual approval | AC-20 |
| Lebih dari 5 worker berjalan bersamaan | AC-21 |
| Worker hang lebih dari 60 detik tanpa timeout | AC-22 |
| Audit log blocking execution pipeline | AC-23 |
| HELD state muncul tanpa advisor context | AC-24 |

---

## Section 9 — Sprint Plan

### Sprint F1 — Core Engine (Consensus + Execution Gate)

**Goal**: Veto-aware consensus engine + risk-tiered execution

**Deliverables**: P6-D01, P6-D02, P6-D03, P6-D04
**Test Gates**: TG-H01, TG-H02, TG-H03, TG-H04

- Define agent specialization roles in registry
- Implement committee consensus flow (compare proposedAction, check veto)
- Implement `isAutoExecutable()` gate function
- Implement execution pipeline with HELD routing for non-auto cases
- Integration test: veto flow, disagreement flow, auto-execute flow, manual-required flow

### Sprint F2 — Infrastructure (Load + Logging + Semantic)

**Goal**: Production-hardened execution infrastructure

**Deliverables**: P6-D05, P6-D06, P6-D07, P6-D08, P6-D09
**Test Gates**: TG-H05, TG-H06, TG-H07, TG-H08, TG-H09

- Implement WorkerPool with semaphore + FIFO queue
- Implement per-worker timeout with Effect.timeout + Effect.ensuring
- Implement async audit logging with background consumer
- Create vector store data structure (empty embeddings, ready for future)
- Create semantic similarity interface (stub returning 0.0)
- Integration test: timeout recovery, queue ordering, concurrency limit, async audit

### Sprint F3 — Validation + Evidence

**Deliverable**: P6-D10
**Test Gate**: TG-E2E

- End-to-end workflow test
- Regression suite (all Phase 1–5 + Phase 6 tests)
- Evidence package per ADR-012v2

---

## Section 10 — Related Documents

- ADR-026 — Human-in-the-Loop & HELD State (source ADR for HELD)
- PHASE3_AMENDMENT_V3 — HELD State Inclusion (amends Phase 3 TG-09)
- PHASE3_SPECIFICATION.md — Decision Engine Foundation
- PHASE4_SPECIFICATION.md — Agent Orchestration
- PHASE5_SPECIFICATION.md — Self-Improvement Loop
- ARCHITECTURAL_PRINCIPLES.md — Prinsip P-14 (Evidence-Based Certification)
- ARCHITECTURAL_RISK_WATCHLIST.md — DA-FUTURE-02 (Semantic Contradiction)
