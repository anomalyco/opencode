# Architecture Debt Registry

**Purpose**: Single authoritative registry for all known architecture debt.
**Not**: Risk watchlist, feature backlog, or bug tracker.

**Maintained**: 2026-06-13
**Owner**: Architecture

---

## Lifecycle

| Status | Meaning |
|---|---|
| ACTIVE | Debt acknowledged, no fix in progress |
| MITIGATING | Active work to reduce impact |
| RESOLVED | Fix verified and accepted |
| WONTFIX | Accepted as permanent cost |

Each entry must have:
- Evidence (why this is real debt, not hypothesis)
- Exit Criteria (what conditions resolve it)

---

## AD-001 — Facade Boundary Enforcement

| Field | Value |
|---|---|
| **Title** | Enforce Evolution Facade Boundary |
| **Status** | ACTIVE |
| **Owner Type** | Architecture |
| **Created** | 2026-06-12 |
| **Last Reviewed** | 2026-06-13 |
| **Target Phase** | 3 |
| **Risk** | Phase 2+ dapat bypass `Evolution.Service` dan import `brain/` langsung. Facade menjadi konvensi tanpa enforcement. |
| **Evidence** | Direct import of `@/evolution/brain/*` is possible without compile-time error. Boundary audit (2026-06-13): convention is followed but not enforced. |
| **Exit Criteria** | At least one enforcement mechanism exists: ESLint no-restricted-imports rule, module boundary test, or restricted export structure. |

---

## AD-003 — Error Taxonomy Governance

| Field | Value |
|---|---|
| **Title** | Error Taxonomy Governance |
| **Status** | ACTIVE |
| **Owner Type** | Architecture |
| **Created** | 2026-06-13 |
| **Last Reviewed** | 2026-06-13 |
| **Target Phase** | 2+ (ongoing) |
| **Risk** | Phase 3+ akan memproduksi error class secara liar (RetrieverError, ContextError, dll). Setiap consumer harus handle `catchTag` hell. |
| **Evidence** | ERROR_REGISTRY.md created 2026-06-13 with 3 registered errors and 11 call sites. No governance mechanism beyond documentation. |
| **Exit Criteria** | Classification rule enforced (Domain / Storage / Integration / Programming Defect). New errors must pass PR review against registry. |

---

## TD-001 — Memory Storage Scalability

| Field | Value |
|---|---|
| **Title** | Memory Storage Scalability |
| **Status** | ACTIVE |
| **Owner Type** | Implementation |
| **Created** | 2026-06-12 |
| **Last Reviewed** | 2026-06-13 |
| **Target Phase** | 3 |
| **Risk** | O(n) read-all pattern on every operation. O(n²) cumulative write cost. Compact test: 510 entries = 45.6s setup. At 10,000 entries: ~20s per save. |
| **Evidence** | Compact test breakdown: setup 45,639ms (510 sequential saves), compact() 67ms. Root cause: read-all → push → write-all × 510. |
| **Exit Criteria** | At least one: pagination/offset, streaming read, append-only write, or in-memory index that breaks O(n) per operation. |

---

## KL-001 — CLI Disabled Ambiguity

| Field | Value |
|---|---|
| **Title** | CLI Degradation Ambiguity |
| **Status** | WONTFIX (Phase 3) |
| **Owner Type** | Shared |
| **Created** | 2026-06-13 |
| **Last Reviewed** | 2026-06-13 |
| **Target Phase** | 3 |
| **Risk** | CLI cannot distinguish "Evolution disabled in config" from "Evolution enabled but storage inaccessible." Both produce same disabled output. |
| **Evidence** | `status.ts` catches `EvolutionStorageError` and falls back to `{ enabled: false }`. No way for user to know storage is broken vs feature is off. |
| **Exit Criteria** | Status interface refactored to Model A with explicit degraded state. |

---

## Index

| ID | Title | Status | Owner | Target |
|---|---|---|---|---|---|
| AD-001 | Facade Boundary Enforcement | ACTIVE | Architecture | P3 |
| AD-003 | Error Taxonomy Governance | ACTIVE | Architecture | P2+ |
| TD-001 | Memory Storage Scalability | ACTIVE | Implementation | P3 |
| KL-001 | CLI Disabled Ambiguity | WONTFIX | Shared | P3 |
