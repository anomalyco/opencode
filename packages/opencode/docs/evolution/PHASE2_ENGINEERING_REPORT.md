# Phase 2 Engineering Report — Context Intelligence

**Author**: Claude (Principal Engineer)
**Reviewed**: ChatGPT (Architecture Reviewer)
**Date**: 2026-06-14
**Status**: ✅ VERIFIED (Architecture Package) / ⏳ CONDITIONAL APPROVED (Design Freeze — resolved per DF-10)

---

## 1. Architecture Reviewer Findings

### Finding 1 — Budget Governance
**Verdict**: ✅ ACCEPT
`contextBudgetStrategy: "strict" | "truncate"` — Composer = truncation owner, Budget.Service = validator only. Konsisten dengan AD-003, ADR-007, Single Responsibility.

### Finding 2 — Facade Migration
**Verdict**: ✅ ACCEPT
4-step migration (ADD → Implement → Migrate → Remove). Step 4 = BREAKING — gate condition sebelum Phase 2 ACCEPTED.

### Finding 3 — TokenEstimator
**Verdict**: ✅ ACCEPT WITH NOTE
Pure utility (not Service). Catatan: `TokenEstimator = Approximation Layer` — `chars/4` adalah heuristik, ±10-15% untuk English/code. Bukan tokenizer resmi.

### Finding 4 — Truncation Priority
**Verdict**: ⚠ HYPOTHESIS only
Priority `project → decisions → memory` belum ada evidence. Diterima sebagai initial strategy untuk implementasi, tetapi harus diverifikasi di Phase 2 Verification. Tidak boleh ditulis sebagai FACT.

### Finding 5 — 31 Day Estimate
**Verdict**: ❌ REJECTED
Over-estimation. Mayoritas komponen Phase 2 kecil (TokenEstimator, Budget Service, Retriever, Composer). Yang berisiko hanya Provider integration + Facade migration. Estimasi tidak dipakai sebagai baseline planning.

### Finding 6 — OpenCode Injection Point (DF-10)
**Verdict**: 🚨 BLOCKING → ✅ RESOLVED
Verifikasi membuktikan V2 `SystemContextRegistry.register()` tersedia dan sudah ter-wire di `location-layer.ts`. Injection chain: register → `systemContext.load()` → `SystemContext.combine()` → `SessionContextEpoch.initialize()` → `system.baseline` → `LLM.request()`.

---

## 2. Design Freeze Checklist — Final

| # | Item | Status | Verdict |
|---|---|---|---|
| DF-01 | ADR-007 finalized | ✅ | ACCEPT |
| DF-02 | `contextBudgetStrategy` di ConfigEvolution | ✅ | ACCEPT |
| DF-03 | TokenEstimator pure utility (approx layer note) | ✅ | ACCEPT WITH NOTE |
| DF-04 | Facade migration 4-step | ✅ | ACCEPT |
| DF-05 | Budget.Service = validator only | ✅ | ACCEPT |
| DF-06 | Composer = truncation owner | ✅ | ACCEPT |
| DF-07 | `EvolutionContext.wasTruncated` field | ✅ | ACCEPT |
| DF-08 | ERROR_REGISTRY — ContextBudgetError registered | ✅ | ACCEPT |
| DF-09 | Truncation priority project→decisions→memory | ⚠ | HYPOTHESIS (initial strategy) |
| DF-10 | OpenCode session injection point | ✅ | RESOLVED via V2 SystemContextRegistry |

---

## 3. Component Architecture

```
Layer / Config
    ↓
TokenEstimator (pure utility, chars/4)
    ↓
ContextBudget.Service (validator — strict | truncate)
    ↓
ContextRetriever.Service (loads data from Evolution Brain)
    ↓
ContextComposer.Service (assembles + truncates → EvolutionContext)
    ↓
SystemContextRegistry.register(evolution/context)
    ↓
V2 SessionRunner → LLM.request(system: baseline)
```

### Component Details

| Component | Type | Dependencies | Owner |
|---|---|---|---|
| TokenEstimator | Pure utility (no DI, no async) | None | OpenCode |
| ContextBudget.Service | Effect Service | ConfigEvolution | OpenCode |
| ContextRetriever.Service | Effect Service | EvolutionBrain (facade) | OpenCode |
| ContextComposer.Service | Effect Service | ContextRetriever, ContextBudget, TokenEstimator | OpenCode |
| SystemContext registry entry | Effect Layer | ContextComposer, SystemContextRegistry | OpenCode |

---

## 4. Implementation Plan — 14 Tasks Across 4 Sprints

### Sprint A (Backward Compatible — 4 tasks)

| Task | Component | Description | Dependencies |
|---|---|---|---|
| T-01 | TokenEstimator | Implement pure utility class | None |
| T-02 | ContextBudget.Service | Implement validator with strategy config | T-01 |
| T-07a | ConfigEvolution | Add `contextBudgetStrategy` + `tokenLimit` config | None |
| T-07b | Tests | Config evolution schema + budget tests | T-02 |

### Sprint B (Core Assembly — 4 tasks)

| Task | Component | Description | Dependencies |
|---|---|---|---|
| T-03 | ContextRetriever.Service | Load project/memory/decisions via facade | Sprint A |
| T-04 | ContextComposer.Service | Assemble + truncate → EvolutionContext | T-01, T-02, T-03 |
| T-05 | EvolutionContext schema | Typed output contract (Phase 2 boundary) | Sprint A |
| T-07c | Tests | Retriever + Composer unit/integration | T-03, T-04 |

### Sprint C (Integration — 3 tasks)

| Task | Component | Description | Dependencies |
|---|---|---|---|
| T-06 | SystemContext entry | Register evolution/context via `SystemContextRegistry` | T-04, T-05 |
| T-07d | Boundary audit | Grep verify ContextRetriever only imports Evolution.Service | T-03 |
| T-08 | Tests | System context integration + DF-02/DF-06/DF-07/DF-09 | T-06 |

### Sprint D (Migration + Regression — 3 tasks)

| Task | Component | Description | Dependencies |
|---|---|---|---|
| T-09 | Facade Step 3 | Migrate internal consumers | Sprint C |
| T-10 | Facade Step 4 | Remove legacy methods (BREAKING) | T-09 |
| T-11 | Regression suite | Full test suite + typecheck | All |

---

## 5. Test Matrix (10 TM Items)

| ID | Scope | Type | Success |
|---|---|---|---|
| TM-01 | TokenEstimator accuracy (English/code) | Unit | ±15% |
| TM-02 | ContextBudget strict mode | Unit | Error when exceeded |
| TM-03 | ContextBudget truncate mode | Unit | Returns truncated context |
| TM-04 | ContextRetriever data loading | Integration | Returns project + memory + decisions |
| TM-05 | ContextComposer assembly | Integration | Produces valid EvolutionContext |
| TM-06 | EvolutionContext schema validation | Unit | Rejects invalid data |
| TM-07 | SystemContextRegistry registration | Integration | Entry loaded + combined |
| TM-08 | End-to-end injection | Integration | EvolutionContext appears in LLM system message |
| TM-09 | Facade migration regression | Regression | Phase 1 tests pass after Step 3-4 |
| TM-10 | Budget enforcement boundary error | Unit | Domain Error, not Integration Error |

---

## 6. Risk Register (7 Risks)

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | Injection point not available | Eliminated (DF-10 resolved) | Critical | V2 SystemContextRegistry confirmed |
| R-02 | TokenEstimator accuracy poor for non-English | Medium | Medium | Document as approximation; CJK Phase 3 |
| R-03 | ContextBudget too conservative (4096) | Medium | Low | Configurable — operators adjust |
| R-04 | Facade Step 4 breaks consumers | Low | High | Detect at compile time (typecheck) |
| R-05 | SystemContext combine rejects duplicate keys | Low | Medium | Unique key `evolution/context` |
| R-06 | Performance: loadSystemContext on every turn | Low | Medium | SystemContext.initialize is one-time; reconcile is incremental |
| R-07 | Phase 1 debts worsen (AD-001, AD-003, TD-001) | Low | Medium | Debt register mandates no regression |

---

## 7. Debt Impact Assessment

| Debt | Impact | Phase 2 Action |
|---|---|---|
| AD-001 — Boundary enforcement (convention only) | Low | ContextRetriever must respect Evolution.Service boundary |
| AD-003 — Error taxonomy (no governance) | Low | ContextBudgetError registered per governance |
| TD-001 — O(n) read-all scalability | Low | Not triggered — Phase 2 reads are limited |
| KL-001 — Effect v4 beta | Low | Use `Effect.catchTag`, `Schema.Literals` |

---

## 8. Key Interface Contracts

### TokenEstimator
```typescript
// Pure utility — not a Service, no DI, no async
function estimateTokens(text: string): number
// Math.ceil(text.length / 4)
// Accuracy: ±10-15% for English/code. Approximation only.
// Budget enforcement uses conservative rounding.
```

### ContextBudget.Service
```typescript
interface Interface {
  readonly check: (params: {
    tokens: number
    strategy?: "strict" | "truncate"
  }) => Effect.Effect<{ allowed: boolean; exceeded: number }>
}
```

### ContextComposer.Service
```typescript
interface Interface {
  readonly compose: (hint?: SessionHint) => Effect.Effect<EvolutionContext, ContextBudgetError | EvolutionStorageError>
}
```

### EvolutionContext (Phase 2 boundary)
```typescript
interface EvolutionContext {
  readonly contexts: ReadonlyArray<ContextItem>
  readonly budget: {
    readonly total: number
    readonly used: number
    readonly remaining: number
    readonly wasTruncated: boolean
    readonly truncationReason?: string
  }
}

interface ContextItem {
  readonly source: "project" | "memory" | "decisions"
  readonly content: string
  readonly tokens: number
}
```

---

## 9. Phase 2 to Phase 3 Extension Points

| Extension | Phase 2 | Phase 3 |
|---|---|---|
| Token estimator | `chars/4` heuristik | `tiktoken` or provider-specific |
| SessionHint for compose() | Optional (fetch all data) | Rank by relevance |
| Context sources | project, decisions, memory | Git diff, file tree, MCP context |
| Strategy | truncate only | Rank → filter → truncate |
