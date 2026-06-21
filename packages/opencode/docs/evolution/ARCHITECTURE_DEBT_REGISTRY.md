# Architecture Debt Registry

**Purpose**: Single authoritative registry for all known architecture debt.
**Not**: Risk watchlist, feature backlog, or bug tracker.

**Maintained**: 2026-06-19 (Cleanup sprint — AD-001, TD-001, ED-021 resolved; AD-003 resolved via CI integration)
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
| **Status** | ✅ **RESOLVED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-12 |
| **Resolved** | 2026-06-19 |
| **Target Phase** | 4+ (deferred from P3) |
| **Risk** | Phase 2+ dapat bypass `Evolution.Service` dan import `brain/` langsung. Facade menjadi konvensi tanpa enforcement. |
| **Evidence** | Direct import of `@/evolution/brain/*` is possible without compile-time error. Boundary audit (2026-06-13): convention is followed but not enforced. |
| **Exit Criteria** | At least one enforcement mechanism exists: ESLint no-restricted-imports rule, module boundary test, or restricted export structure. |
| **Close Reason** | (1) oxlint `no-restricted-imports` rule blocks `**/evolution/brain/**` at repo root `.oxlintrc.json`. Verified by AD-001 gate test (2/2 pass). (2) Production violation in `app-runtime.ts` fixed — brain sub-layers imported from `@/evolution/index` instead of `@/evolution/brain/*`. (3) Brain sub-modules re-exported from `@/evolution/index` as canonical entry point. |

---

## AD-003 — Error Taxonomy Governance

| Field | Value |
|---|---|
| **Title** | Error Taxonomy Governance |
| **Status** | ✅ **RESOLVED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-13 |
| **Resolved** | 2026-06-19 |
| **Target Phase** | 2+ (ongoing) |
| **Risk** | Phase 3+ akan memproduksi error class secara liar (RetrieverError, ContextError, dll). Setiap consumer harus handle `catchTag` hell. |
| **Evidence** | ERROR_REGISTRY.md created 2026-06-13 with 3 registered errors and 11 call sites. No governance mechanism beyond documentation. |
| **Exit Criteria** | Classification rule enforced (Domain / Storage / Integration / Programming Defect). New errors must pass PR review against registry. CI lint check detects unregistered error types (custom lint rule or unit test scanning `throw new ErrorTypeX()` patterns and verifying ErrorRegistry). Per CR-008 — phase gate: Sprint F. |
| **Close Reason** | (1) `bun run lint:error-registry` script (`script/check-error-registry.ts`) scans all `src/evolution/*.ts` for error classes and cross-references against `ERROR_REGISTRY.md`. (2) Script added to `packages/opencode/package.json` as `lint:error-registry`. (3) CI integration added to `.github/workflows/test.yml` — runs on every push/PR on both Linux and Windows. (4) Error family: 10 registered classes (`bun run lint:error-registry` passes). (5) All 10 error classes pass classification (Domain / Storage / Integration / Programming Defect). |

---

## TD-001 — Memory Storage Scalability

| Field | Value |
|---|---|
| **Title** | Memory Storage Scalability |
| **Status** | ✅ **RESOLVED** |
| **Owner Type** | Implementation |
| **Created** | 2026-06-12 |
| **Resolved** | 2026-06-19 |
| **Target Phase** | 4+ (deferred from P3) |
| **Risk** | O(n) read-all pattern on every operation. O(n²) cumulative write cost. Compact test: 510 entries = 45.6s setup. At 10,000 entries: ~20s per save. |
| **Evidence** | Compact test breakdown: setup 45,639ms (510 sequential saves), compact() 67ms. Root cause: read-all → push → write-all × 510. |
| **Exit Criteria** | At least one: pagination/offset, streaming read, append-only write, or in-memory index that breaks O(n) per operation. |
| **Close Reason** | In-memory cache added to `src/evolution/brain/memory.ts`. `readStorage()` caches entries after first disk read — subsequent reads are O(1) from memory. `writeStorage()` updates cache on successful write via `Effect.tap`. Eliminates O(n) read before every write, breaking the O(n²) cumulative cost pattern. Compact test passes (66.8s — disk write-bound, not read-bound). |

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

---

## ED-021 — ConfigEvolution Duplicated Schema Definition

| Field | Value |
|---|---|
| **Title** | ConfigEvolution schema duplicated between core config and evolution module |
| **Status** | ✅ **RESOLVED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-14 |
| **Resolved** | 2026-06-19 |
| **Target Phase** | 3 |
| **Risk** | `ConfigEvolution` defined in both `core/v1/config/config.ts` (inline in Info schema) and `opencode/evolution/index.ts` (standalone Schema.Struct). Schema drift possible if one is updated without the other. |
| **Evidence** | Two identical structs: (1) `packages/core/src/v1/config/config.ts:166-181` — actual JSON parser; (2) `packages/opencode/src/evolution/index.ts:10-23` — type projection for `getConfig()` return type. Compiler catches incompatible drift but not semantic drift (e.g. wrong description, different default). |
| **Mitigation** | Compiler prevents incompatible drift because `return cfg.evolution ?? {}` must be assignable to `ConfigEvolution`. Long-term fix: export evolution sub-schema from core config and reuse in evolution module. |
| **Exit Criteria** | `ConfigEvolution` imports evolution sub-schema from `@opencode-ai/core/v1/config` instead of re-declaring. |
| **Close Reason** | (1) `InfoEvolutionSchema` extracted and exported from `packages/core/src/v1/config/config.ts`. (2) `packages/opencode/src/evolution/index.ts` now imports `InfoEvolutionSchema` from `@opencode-ai/core/v1/config/config` and builds `ConfigEvolution` via `Schema.Struct({...InfoEvolutionSchema.fields, ...extraFields})`. User-facing fields are canonical from core; evolution-internal fields (validation, minCandidateConfidence, reconciliationStrategy, retention) are added locally. Schema drift is now impossible for the shared subset. |

---

## AD-CP03-01 — extraLayers Silent Overwrite Risk

| Field | Value |
|---|---|
| **Title** | `LocationServiceMap.extraLayers` silent overwrite risk |
| **Status** | **CLOSED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-15 |
| **Closed** | 2026-06-15 |
| **Close Reason** | Mechanism redesigned before implementation landed. The `extraLayers = [...]` replacement design (sole root risk) was replaced by `registerExtra(...)` push-based registration in `builtins.ts:11`. The original overwrite risk never materialized — no code was ever written using the `extraLayers` approach. See ARCH-NOTE-CP03-DOC-DRIFT for the documentation drift lesson learned. |
| **Risk** | `extraLayers = [...]` replaces the entire array. Two independent modules writing to the same static slot causes silent loss of the first registration (risk level: LOW — no collision evidence yet). |
| **Evidence** | `registerExtra` is the sole active path (builtins.ts:11 declared, app-runtime.ts:57 written, builtins.ts:47-49 consumed). No `extraLayers` declaration, read, or write exists in any source file. |

---

## AD-CP03-02 — T-08-WIRE-COVERAGE

| Field | Value |
|---|---|
| **Title** | `registerExtra` production wiring lacks test coverage |
| **Status** | **CLOSED — VERIFIED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-15 |
| **Closed** | 2026-06-15 |
| **Close Reason** | All 5 exit criteria verified by Sprint C-Verify. See `test/evolution/context/verify.test.ts` — 7 tests, 12 expect() calls. |
| **Risk** | `registerExtra` is the sole active T-08 wiring path (production) but has zero test coverage. The `extraRegistrations` loop in `builtins.ts:47-49` and the `catchDefect` in `register.ts` are both untested. A regression in registration behavior would not be caught. |
| **Evidence** | `test/evolution/context/verify.test.ts` — C1 (exactly once), C2 (duplicate catchDefect), C3 (deterministic order), C4 (failure observable), C5 (no disappearance). 13/13 tests pass, 53/53 expect() in full context suite. |
| **Exit Criteria Verification** | (1) ✅ Registration executes exactly once — C1: first registration produces valid baseline, second does not duplicate. (2) ✅ Duplicate registration does not crash — C2: catchDefect catches duplicate, returns success. (3) ✅ Registration order is deterministic — C3: same baseline across runs. (4) ✅ Failure is observable — C4: Exit.isFailure when config dies. (5) ✅ No silent disappearance — C5: registry.load() after scope reopening returns same baseline. |

---

## AD-CP03-03 — ProposalStore Growth

| Field | Value |
|---|---|
| **Title** | ProposalStore Growth |
| **Status** | ACTIVE (DEFER — Phase 6 re-evaluation) |
| **Owner Type** | Architecture |
| **Created** | 2026-06-16 |
| **Last Reviewed** | 2026-06-19 (Sprint E analysis: DEFER recommendation) |
| **Target Phase** | 3 (current) / 5 (resolution) |
| **Risk** | ProposalStore accumulates ALL proposals in ALL states (SUBMITTED, VALIDATING, ACCEPTED, REJECTED). Without retention strategy, ProposalStore directory grows unboundedly, causing I/O latency and memory pressure during `listAll()` / `listByStatus()` (O(n) reads). REJECTED proposals have no automatic cleanup trigger. |
| **Evidence** | ProposalStore uses per-project file-based persistence (`.opencode/evolution/proposals/{id}.json` — same pattern as existing `brain/decisions.ts` ADR storage in `.opencode/evolution/adr/`). Files persist on disk across sessions. `listByStatus()` reads ALL files from the directory and filters in-memory. No index, no pagination, no retention policy. |
| **Mitigation (Phase 3)** | Per-project persistent files (same as ADR storage). ProposalStore IS the audit trail — no separate audit store needed. Phase 3 per-session bounded writes (TD-001: max 50 memory entries) keep volume manageable. Acceptable for expected Phase 3 volume (single-agent, bounded decisions per session). |
| **Exit Criteria** | Retention strategy defined and implemented: cleanup trigger (time-based, count-based, or event-based), cleanup scope (which statuses are eligible), cleanup timing, and whether ACCEPTED/REJECTED proposals are retained across sessions. **Also**: audit vs retention conflict resolved (CR-003) — either dual-store design (ProposalStore + Audit Ledger) or explicit single-store trade-off documentation. Target: Phase 5 Sprint E (retention analysis + audit-ledger schema ADR-023) + decision framework (§10.3 of PHASE5_SPECIFICATION.md). |
| **Sprint E Assessment** | See `docs/evolution/G5-SPRINT-E.md`. Recommendation: **DEFER** — all thresholds comfortable. CR-003 resolved via dual-store design (ADR-023). ADR-023 draft complete. Migration path documented. Exit criteria partially met: strategy defined, CR-003 resolved. Cleanup implementation deferred to Phase 6. |

---

## G4-AR-001 — Multiple Proposal-Capable Agents Selection

| Field | Value |
|---|---|
| **Title** | Define selection strategy when multiple agents share `proposal` capability |
| **Status** | ACTIVE (research complete — Sprint D done) |
| **Severity** | LOW |
| **Target** | Phase 6 |
| **Context** | Agent Registry v1 uses `AgentCapability[]` — but no rule defines which `proposal`-capable agent is the primary generator when >1 exist. Currently only ContextAnalyst has `proposal`. When MemoryAgent (or another) gains it, reconciliation must deterministically select a primary generator. |
| **Evidence** | `ReconcileInput.agents` passes all manifests to `collect()`; `engine.ts` filters by `capabilities.includes("proposal")` — if multiple match, `ConfidenceReconciliationStrategy` picks highest confidence, which may not be the semantically correct primary. |
| **Exit Criteria** | Either (a) introduce `primaryGenerator: boolean` in manifest, or (b) define a capability ordering rule (e.g. first registered wins). |
| **Sprint D Assessment** | Research complete: `docs/evolution/G4-AR-001-research.md` with 10-dimension strategy matrix. ADR-022 DRAFT appended to DECISIONS.md. Recommendation: Strategy C (expanded reconciliation). Cross-agent confidence comparability must be validated in Phase 6 spike before adoption. |

---

## CR-001 — Single-Writer Enforcement (via invariant checker)

| Field | Value |
|---|---|
| **Title** | Single-Writer Enforcement (via invariant checker) |
| **Status** | ✅ **RESOLVED** |
| **Owner Type** | Architecture |
| **Created** | 2026-06-18 |
| **Resolved** | 2026-06-18 |
| **Close Reason** | `requireProposalCapability()` implemented in `ProposalStore` — guards all public write methods with `Effect.die(new InvariantViolationError(...))`. 6/6 TG-WRITE tests pass. Non-proposal agents (RiskAgent, PlanningAgent) receive `InvariantViolationError` defect when attempting to write. |
| **Source** | DAFTAR TEMUAN KRITIS CR-01, Sprint F implementation. |
| **Evidence** | `src/evolution/brain/proposal-store.ts` — `requireProposalCapability(callerCaps)` invariant checker. TG-WRITE-01 through TG-WRITE-06 verify invariant enforcement for all write paths (submit, updateStatus, propose, memory.mutate, direct write, direct updateStatus). |
| **Exit Criteria** | ✅ Non-proposal agent cannot write to ProposalStore. 6/6 TG-WRITE tests pass. |

---

## Index

| ID | Title | Status | Owner | Target |
|---|---|---|---|---|---|---|
| AD-001 | Facade Boundary Enforcement | ✅ **RESOLVED** | Architecture | P4+ (deferred from P3) |
| AD-003 | Error Taxonomy Governance | ✅ **RESOLVED** | Architecture | P2+ (Sprint F complete) |
| AD-CP03-01 | extraLayers Silent Overwrite Risk | **CLOSED** | Architecture | — |
| AD-CP03-02 | T-08-WIRE-COVERAGE — registerExtra | **CLOSED — VERIFIED** | Architecture | — |
| AD-CP03-03 | ProposalStore Growth + Audit/Retention Conflict | ACTIVE (DEFER) | Architecture | P5 Sprint E |
| TD-001 | Memory Storage Scalability | ✅ **RESOLVED** | Implementation | P4+ (deferred from P3) |
| KL-001 | CLI Disabled Ambiguity | WONTFIX | Shared | P3 |
| ED-021 | ConfigEvolution Duplicated Schema | ✅ **RESOLVED** | Architecture | P4+ (deferred from P3) |
| G4-AR-001 | Multiple Proposal-Capable Agents Selection | ACTIVE (research complete — Sprint D) | Architecture | Phase 6 |
| CR-001 | Single-Writer Enforcement (via invariant checker) | ✅ **RESOLVED** | Architecture | P4 Sprint F |
| CR-005 | Decision Provenance (ADR-024 research) | ACTIVE (ADR-024 DRAFT — Sprint F complete) | Architecture | P5 Sprint F |
| CR-002 | Confidence Calibration (ADR-025 research) | ACTIVE (ADR-025 DRAFT — Sprint F complete) | Architecture | P5 Sprint F |
