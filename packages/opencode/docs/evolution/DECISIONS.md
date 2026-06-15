# Architecture Decisions

## ADR-001

Date:
2026-06-11

Decision:
Evolution Layer dibuat sebagai service layer tambahan.

Reason:
Agar tetap kompatibel dengan upstream OpenCode.

Status:
Accepted

## ADR-002

Date:
2026-06-11

Decision:
Tidak inject memory langsung ke system prompt.

Reason:
Menghindari context overload.

Impact:
Evolution Context dibuat sebagai layer terpisah.

Status:
Accepted

## ADR-003

Date:
2026-06-11

Title:
Evolution Brain Consumer Interface

Decision:

Phase 1 Evolution Brain hanya menyediakan data service.
Consumer berikutnya harus melalui Evolution.Service facade.

Revised contract (v2 — 2026-06-12):

Evolution.Service
    |
    +-- status()
    |     → Status
    |
    +-- getConfig()
    |     → ConfigEvolution
    |
    +-- getMemories(query)
    |     → MemoryEntry[]
    |     query: { tags?, type?, search?, limit? }
    |
    +-- getDecisions(status?)
    |     → DecisionRecord[]
    |
    +-- getProjectContext()
          → ProjectProfile

Note:
getMemories, getDecisions, getProjectContext adalah
Phase 1 completion task.
Harus ada sebelum Phase 2 coding dimulai.

Phase 2 Context Intelligence adalah consumer pertama.

Reason:
Prevent direct dependency between Context Intelligence
dan storage layer (brain/).

Impact:
Memory/Decisions/Project implementation dapat berubah
tanpa breaking Phase 2.

Status:
Accepted — Revised v2

## ADR-004

Date:
2026-06-12

Title:
Context Intelligence Output Contract

Decision:

Phase 2 Composer tidak menghasilkan raw string.
Output adalah EvolutionContext object.

Contract:

EvolutionContext
    |
    +-- project: ProjectSummary
    |     (name, frameworks, structure)
    |
    +-- memories: RelevantMemory[]
    |     (content, type, relevanceHint)
    |
    +-- decisions: ActiveDecision[]
    |     (title, decision, status)
    |
    +-- budget: ContextBudget
          (totalTokens, used, remaining, breakdown)

SystemContext Provider mengambil EvolutionContext
dan menginjeksikan ke OpenCode session via
session.addSystemContext(ctx) hook — jika tersedia.

Jika hook tidak tersedia: fallback ke
formatted string yang disimpan sebagai
session metadata (bukan raw system prompt).

Reason:
ADR-002 melarang inject memory langsung ke
system prompt. EvolutionContext sebagai typed object
memungkinkan consumer memilih cara konsumsi.

Impact:
Phase 3+ dapat menambah field ke EvolutionContext
tanpa breaking Phase 2 consumers.

Risk:
OpenCode session injection point belum diverifikasi.
Harus diverifikasi SEBELUM SystemContext Provider
di-implement.

Status:
Accepted — Pending OpenCode integration verification

## ADR-005

Date:
2026-06-13

Title:
Error Boundary Model — Single Translator Path

Decision:

Public Interface (Evolution.Service facade) exposes exactly three error types:
- EvolutionStorageError
- EvolutionNotEnabledError (per brain module)
- AdrNotFoundError

All internal FSUtil errors are translated via a single `toEvolutionStorageError(e, operation, path?)` in `src/evolution/error.ts`.

Internal storage helpers keep FSUtil.Error honest — no error swallowing.
Translation happens only at the public boundary via `toEvolutionStorageError`.

Rules:
1. Internal storage helpers: honest FSUtil.Error
2. Public Interface: typed domain errors only
3. Single translator function — no per-file translation
4. CLI catches `EvolutionStorageError` with `catchTag` → degrades to disabled state

Reason:
FSUtil.Error leaking to consumer violates error contract.
Defect swallowing (try/catch → never) hides real failures.
Single translator prevents inconsistent error handling.

Impact:
+ Clear error taxonomy at boundary
+ No hidden defect swallowing
+ CLI degrades gracefully on storage failure
+ Test helpers need generic `<E,R>` and explicit cast

Risk:
Convention-only — no compiler enforcement that new brain methods use translator.
Mitigation: ERROR_REGISTRY.md creation (AD-003).

Status:
Accepted

## ADR-006

Date:
2026-06-13

Title:
Status Endpoint — Model B (Aggregate Runtime)

Decision:

Evolution.Service.status() aggregates runtime state from all brain modules.
On storage failure (EvolutionStorageError), status() does NOT catch internally.
The CLI layer (cli/status.ts) catches the error and degrades to disabled display.

Model A rejected: absorb errors internally → return "unknown" status.
Model B accepted: propagate honest error to boundary → CLI decides.

Reason:
Model A swallows storage failures → admin sees "running" when storage is broken.
Model B preserves diagnostic signal → CLI clearly shows disabled state.
Evolution.Service is infrastructure code — should not lie about availability.

Impact:
- status() can fail with EvolutionStorageError
- CLI degrades to disabled on catchTag
- Future aggregators (dashboard, API) can distinguish "disabled" vs "broken"

Status:
Accepted

## ADR-007

Date:
2026-06-14

Title:
Context Intelligence Foundation — Phase 2

Decision:

Phase 2 — Context Intelligence is APPROVED AS DIRECTION with the following architectural decisions:

**AR-01 — Context Ownership (Opsi A)**:
EvolutionContext is the typed output object per ADR-004. SystemContextProvider delivers it to the AI Session. Evolution.Service does NOT own the composed context — it only provides the registry/sub-domain access.

Chain: `EvolutionContext → SystemContextProvider → AI Session`

**AR-02 — Budget Governance (Opsi 1 — flat)**:
ConfigEvolution uses flat token budget:
```
contextBudget: 4096
```
Not per-domain breakdown. Allocation logic lives in ContextBudget.Service.

**AR-03 — Provider Boundary (Facade only)**:
SystemContextProvider must NOT call Retriever directly. It may only call Evolution.Service facade. This preserves AD-001 (Boundary Enforcement).

**AR-04 — Error Contract**:
ContextBudgetError is classified as Domain Error. Registered in ERROR_REGISTRY.md.

Component stack (implementation order):
1. ContextBudget.Service — budget calculation, no external deps
2. ContextRetriever.Service — reads from Evolution.Service facade
3. ContextComposer.Service — orchestrates Retriever + Budget → EvolutionContext
4. SystemContextProvider — registers via SystemContextRegistry.register()

All components are ADD. No existing code is modified (except Evolution.Service facade REPLACE at end).

Reason:
Phase 1 foundation complete. Automatic context loading into AI sessions is the next capability needed. These decisions resolve all open architecture questions.

Impact:
+ ADR-004 contract fulfilled (EvolutionContext output)
+ AD-001 preserved (Facade-only boundary)
+ Error taxonomy extended (ContextBudgetError)
+ Implementation order clear

Risk:
Budget allocation logic may need refinement in Phase 3 (Decision Engine). Flat config may be insufficient for per-domain tuning. Mitigation: configurable via ConfigEvolution, no hardcoding.

Status:
Accepted

Date:
2026-06-12 (updated 2026-06-13)

Title:
Memory Storage Scalability — Technical Debt

Description:
Memory storage uses O(n) read-all → O(n²) cumulative write pattern.
Each save() reads entire file, appends one entry, writes entire file.
Compact test (510 entries): setup 45.6s, compact() 67ms.
Total time scales quadratically with entry count.

Concurrent compact() race condition is a secondary concern.
The primary problem is the O(n²) I/O pattern — not the race condition alone.

Current mitigation:
Write queue (ditambahkan di Phase 1 hardening).
compact() belum diproteksi dari concurrent compact().

Risk level:
Low untuk Phase 2 (read-heavy).
Medium untuk Phase 3 (Decision Engine mulai write lebih banyak).

Fix target:
Phase 3 prerequisite — bukan Phase 4.

Reason untuk mempercepat:
Phase 3 Decision Engine akan trigger lebih banyak
write operations. O(n²) cost becomes prohibitive at scale.

Expanded scope:
- O(n) read-all on every write
- O(n²) cumulative write cost
- No streaming / pagination interface
- Concurrent compact() race condition remains unaddressed

Success criteria for fix:
- Background compaction via streaming read (not read-all)
- Incremental write (append-only log + periodic compaction)
- Concurrent compact() protection
- Test: 510 entries in < 5s total (current: ~46s)

Status:
Open — tracked

## AD-001

Date:
2026-06-12 (updated 2026-06-13)

Title:
Enforce Evolution Facade Boundary

Problem:
Phase 2+ dapat bypass Evolution.Service dan import brain/ langsung.
Tidak ada compiler atau tooling yang melarang ini sekarang.
Facade tidak berguna jika boundary tidak di-enforce.

Current state:
Convention only — no technical enforcement.

Evidence:
Boundary audit 2026-06-13: 6/6 items clean.
- No direct import of brain/* outside evolution/
- evolution/index.ts does not re-export brain submodules
- Dependency direction: Phase 2 → Evolution.Service → Brain ✅
Audit confirms convention is currently followed — but not enforced.

Decision:
Enforce boundary dengan tooling pada Phase 3.
Jangan implement sekarang.

Options (evaluation Phase 3):
- eslint no-restricted-imports rule
- barrel export — tidak re-export brain/ dari index.ts
- dependency-cruiser architecture rule
- architecture test (import boundary check)

Target:
Phase 3 prerequisite

Status:
Open — evidence-backed

## AD-002

Date:
2026-06-12

Title:
Memory Governance — Anti-Degradation System

Problem:
Memory.Service saat ini menyimpan semua entry tanpa evaluasi.
Tidak ada mekanisme untuk memverifikasi apakah lesson masih valid.

Risiko utama: Feedback Degradation Loop

  Input buruk
       ↓
  Memory salah tersimpan
       ↓
  Decision berdasarkan memory salah
       ↓
  Memory baru semakin buruk
       ↓
  Loop berlanjut

Ini berbeda dari simple bug.
Ini degradasi sistemik yang makin parah seiring waktu.
AI yang sering dipakai justru menjadi makin salah.

Example failure mode:
  entry: { lesson: "always use library X" }
  — library X deprecated, tidak ada yang update entry ini
  — AI terus rekomendasikan X karena confidence tinggi dari frekuensi

Current state yang berbahaya:
  {
    "lesson": "always use X"
  }

Target state Phase 5:
  {
    "content": "always use X",
    "confidence_score": 0.85,
    "source": "session-abc123",
    "created_at": 1234567890,
    "validated_at": null,
    "validation_status": "unverified",
    "decay_rate": 0.02,
    "expiration": 1267567890,
    "approval_state": "auto-accepted",
    "contradictions": []
  }

Decision:
Governance diimplementasikan pada Phase 5.
Bukan sekarang — fondasi harus stabil dulu.

Scope Phase 5:
- confidence_score: 0.0-1.0 per entry
- source tracking: dari session mana entry ini berasal
- timestamp + expiration / TTL
- validation_status: unverified / verified / rejected / expired
- decay: confidence turun jika entry jarang diakses / jarang terbukti benar
- contradiction detection: entry baru vs existing yang bertentangan
- approval_state: auto-accepted / pending-review / approved / rejected

Target:
Phase 5 — Self Improvement

Status:
Open — tracked

## AD-003

Date:
2026-06-13

Title:
Error Taxonomy Governance

Problem:
Phase 3+ will produce new error types (RetrieverError, ContextError, ComposerError, etc.).
Without governance, every new module picks its own error style, category, and boundary leakage pattern.
Effect v4's tagged-error pattern makes it easy to add errors — too easy.

Current state:
ERROR_REGISTRY.md created 2026-06-13. Three registered errors.
Governance is documentation-only — no enforcement.

Decision:
Every new typed error must pass classification before entering ERROR_REGISTRY.md.
Classification criteria:
1. Category (Domain / Storage / Integration / Programming Defect)
2. Boundary (allowed to leave boundary or must be translated?)
3. Source file + constructor pattern
4. Consumer impact

Governance mechanism (Phase 2+):
- ERROR_REGISTRY.md is source of truth
- New error = new entry + PR review classification
- Phase 3: consider CODEOWNERS / lint rule for error module

Risk:
Governance is documentation-only until Phase 3 tooling.
Phase 2 Context Intelligence will produce new errors — must follow governance from Day 1.

Target:
Phase 2 precondition (ERROR_REGISTRY.md) — any new error in Phase 2 must be registered

Status:
Open — registry established

## AD-004

Date:
2026-06-13

Title:
Service Discovery Governance

Observation:
There is no mechanism to discover which services exist, their Interface declaration, or Layer composition.
Evolution layer has 4 services (Memory, Decisions, Project, Service facade).
Phase 2 will add Context Intelligence services.
Discovery today requires grep of the codebase.

Status:
Observation — no action yet, no explicit decision

## DF-10 — EvolutionContext Injection Point

Date:
2026-06-14

Title:
EvolutionContext Injection via V2 SystemContextRegistry

Decision:
EvolutionContext tidak memerlukan modifikasi session runner. Cukup register entry ke `SystemContextRegistry` pada saat layer startup, mirip `SystemContextBuiltIns.layer` di `location-layer.ts:54`.

Injection chain:
```
SystemContextRegistry.register(evolution/context)
  → systemContext.load()
  → SystemContext.combine() + skillGuidance + referenceGuidance
  → SessionContextEpoch.initialize()
  → system.baseline (string)
  → LLM.request({ system: [agent.system, system.baseline] })
```

Reason:
- `SystemContextRegistry.register()` sudah tersedia di `core/src/system-context/registry.ts`
- Pattern sudah ada contoh dari `builtins.ts:39` dan `instruction-context.ts:73`
- V2 runner (`runner/llm.ts:170-173`) otomatis load + combine semua registered entries
- Tidak perlu modifikasi prompt.ts, system.ts, atau runner/llm.ts

Implementation:
1. Buat `packages/core/src/evolution/evolution-context.ts` yang `register()` entry ke `SystemContextRegistry`
2. Layer ini ditambahkan ke `LocationServiceMap` di `location-layer.ts`

Location in codebase:
- `packages/core/src/session/runner/llm.ts:170-224` (injection point — sudah ada)
- `packages/core/src/system-context/registry.ts:11-14` (register/load interface)
- `packages/core/src/system-context/builtins.ts:39` (contoh registrasi)
- `packages/core/src/location-layer.ts:95` (V2 runner ter-wire)

Fallback (if V2 runner not active):
V1 path: injection via `experimental.chat.system.transform` plugin hook di `request.ts:69-73`

Status:
Resolved — DF-10 blocker cleared

## ADR-008

Date:
2026-06-14

Title:
Sprint B Implementation Decisions + Sprint C Integration Approach

Decision:

### AR-01 — Safety Margin: Option C (no implicit margin)

No hidden 0.9 multiplier in code.
`budget.configured` = exact value of `ConfigEvolution.contextBudget`.
User owns the effective limit via config.
`Math.ceil` is the conservative approximation layer only — not a hidden margin.

Evidence: `budget.ts:22` (`budget: () => config.contextBudget ?? 4096`).
Verified: grep clean — no 0.9 matches in `context/*.ts`.

### AR-02 — Truncation Priority: HYPOTHESIS (DF-09)

Current priority: Memory > Decisions > Project (project never truncated).
Evidence: None — hypothesis pending Phase 2 Verification.
Risk: Wrong priority = poor context quality.
Mitigation: Integration tests will reveal behavior. Phase 2 Verification owns this finding.

### AR-03 — Monotonic Shrink Formula

`Math.max(1, Math.min(oldCount - 1, Math.floor(oldCount × ratio × 0.8)))`

Guarantees `newCount < oldCount` each iteration (monotonic decrease).
Precondition: skeleton (1 memory + 1 decision + project) must fit budget.
If skeleton > budget → `ContextBudgetError` thrown (both `truncate` and `strict` strategies).

Evidence: `composer.ts:37` — `truncateCount()` function.

### AR-04 — Sprint C Integration Approach: Internal Wiring Only

**Principle: Integration Before Contract Expansion.**
Sprint C does NOT add `context()` to `Evolution.Interface`.
Sprint C wires `ContextComposer` internally via `SystemContextProvider`.
Registration via `SystemContextRegistry.register()` (pattern: `instruction-context.ts`).
Public API expansion (`context()` accessor) deferred to post-Sprint C ADR.

### AR-05 — Graceful Degradation Contract

`SystemContextProvider.provide()` returns `Effect<string, never>` — errors never propagate.
On `EvolutionStorageError` or `ContextBudgetError`: logs a warning, returns empty string.
Evolution context is enrichment, not required for session.

### AR-06 — L-01 Compliance (Effect Chain)

`load()` callback in `SystemContextRegistry.register()` uses `Effect.tryPromise`.
NOT fire-and-forget. Pattern per `instruction-context.ts:73`.

Reason:
- AR-01: Sprint B safety margin resolved as Option C across all reviewers. Must be formalized.
- AR-02: DF-09 truncation priority accepted as hypothesis during Design Freeze.
- AR-03: Monotonic shrink formula specified in Sprint B spec, implemented in `composer.ts`.
- AR-04: Sprint C internal wiring approved Architecture Reviewer (conditional).
- AR-05: Graceful degradation per Phase 1 Acceptance.
- AR-06: L-01 hard requirement from Phase 1 Acceptance.

Impact:
+ Sprint B decisions formalized (was pending ADR)
+ Sprint C scope clearly bounded (no public contract expansion)
+ DF-10 runtime path will be proven end-to-end
+ Graceful degradation prevents session crashes
+ Context enrichment available in V2 runner system baseline

Risk:
- AR-02 (truncation priority): Unverified hypothesis. Mitigation: Phase 2 Verification.
- AR-04 (no context() accessor): Internal callers import provider.ts directly. Acceptable for Sprint C.
- Sprint C wires evolution into production path for first time — graceful degradation masks errors.

Status:
Accepted — implemented per Sprint C-Patch

### AR-07 — Error Boundary Ownership

SystemContextProvider owns error boundary for Evolution domain errors.
`composer.provide()` may throw `ContextBudgetError`; provider catches with `Effect.catch` → `console.warn` → `""`.
Core/Registry never see Evolution domain errors.

Implementation:
- `provider.ts:16` — `Effect.catch(composer.provide(), ...)` wraps the composer call
- No changes needed to `SystemContextRegistry` or core

Status:
Accepted — implemented per Sprint C Evidence Package

### AR-08 — Duplicate Key Registration Policy

Duplicate registration key = fatal programming error (`Effect.die`).
Pattern: `registry.ts:27` (`current.some(item => item.key === entry.key)` → `Effect.die`).
Acceptable because registration is startup-only — no concurrent hot-reload.
Re-audit if dynamic/hot-reload registration introduced in future.

Implementation:
- `registry.ts:27-29` — die on duplicate key
- Test: `duplicate-registration.test.ts` — Q4 passes

Status:
Accepted — implemented per Sprint C Evidence Package

## ADR-009

Date:
2026-06-14

Title:
Sprint C-Patch — Root Cause Fix + T-08 Wiring

Decision:

### CP-01 — Config.Service Pattern Fix

`register.ts:14` bug: `Effect.map(yield* Config.Service, ...)` passed a plain service object (not an Effect) to `Effect.map`, causing `"Not a valid effect: [object Object]"` across all layer compositions.

Fix: Use the same pattern as `evolution/index.ts:56-58`:
```
const config = yield* Config.Service
const data = yield* config.get()
const cfg = data.evolution ?? {}
```
`config.get()` returns `Effect<Info>` — properly deferable.

### CP-02 — D-02 Test Uses Real Layer

D-02 was manually calling `registry.register()`, bypassing `EvolutionContextLayer.layer`. After CP-01 fix, D-02 now uses the real layer via `Layer.provideMerge`:
```
Effect.provide(EvolutionContextLayer.layer.pipe(
  Layer.provideMerge(SystemContextRegistry.layer),
  Layer.provideMerge(Layer.succeed(Config.Service, mockConfig)),
  Layer.provideMerge(Layer.succeed(Evolution.Service, mockEvolution)),
))
```
D-02 now proves the complete DF-10 pipeline: layer registration → `load()` → `initialize()` → non-empty baseline.

### CP-03 — T-08 Wiring via Extension Point

**Problem**: `EvolutionContextLayer.layer` requires location-scoped `SystemContextRegistry.Service`, but lives in `packages/opencode` while location composition lives in `packages/core`. Cannot import evolution from core.

**Solution**: Extension point on `LocationServiceMap`:
- Core (`location-layer.ts:137`): `static extraLayers: ReadonlyArray<Layer.Layer<any, any, any>> = []` merged into `lookup()` return
- Core imports nothing from opencode — extension slot only
- Opencode (`app-runtime.ts`): `LocationServiceMap.extraLayers = [EvolutionContextLayer.layer]`
- Lifecycle ownership stays in core; opencode contributes extensions
- Dependency direction: core ← opencode (no reverse import)

### Type Safety

The `extraLayers` slot uses `Layer.Layer<any, any, any>` as the constraint — intentionally generic. Type safety is enforced at the injection site (opencode), not at the slot definition (core). This prevents framework-specific taint in core while allowing any well-typed layer to be injected.

### Duplicate Registration Safety

`extraLayers` is set via replacement (`=` not `.push()`), so module re-imports in tests are idempotent. Each location creation gets a fresh merge — no accumulation risk.

Reason:
- CP-01: Root cause of all layer composition failures in Sprint C
- CP-02: Evidence gap — D-02 was bypassing the real layer
- CP-03: Architectural requirement — inject evolution context into per-location system context without breaking dependency direction or lifecycle ownership

Impact:
- D-02 now proves real `EvolutionContextLayer.layer` in 96ms
- `register.ts` no longer produces "Not a valid effect" errors
- Evolution context is registered per-location at app startup
- Other opencode modules can use the `extraLayers` slot for future extensions

Files changed:
- `packages/opencode/src/evolution/context/register.ts:14` (CP-01)
- `packages/core/src/location-layer.ts:113,137` (CP-03a)
- `packages/opencode/src/effect/app-runtime.ts:5-6,9` (CP-03b)
- `packages/opencode/test/evolution/context/duplicate-registration.test.ts` (CP-02)

Status:
Accepted — implemented per Sprint C-Patch
