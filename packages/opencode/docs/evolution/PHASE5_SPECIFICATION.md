# EF-AI Phase 5 — Final Proposal
# Self-Improvement Loop: Measure First, Improve Second

**Date**: 2026-06-18
**Author**: Claude (Principal Engineer, Anthropic)
**Status**: SUBMITTED — Pending Architecture Reviewer ACCEPTED gate
**Classification**: Phase Gate Document (Level 3)
**Prerequisite**: Phase 4 ACCEPTED (G4 evidence gate closed)
**Based on**: Phase 1–4 complete history, all active debts/risks, ADR-012v2 evidence standards

---

## Section 1 — Preamble: The Nature of Phase 5

Phase 5 adalah satu-satunya phase di EF-AI yang tujuannya bukan menambah kapabilitas — melainkan **mengukur apakah kapabilitas yang sudah ada bekerja**.

Ini adalah perubahan paradigma yang penting. Phase 1–4 adalah fases konstruksi:

```
Phase 1: Foundation Brain       → sistem bisa menyimpan memori dan keputusan
Phase 2: Context Intelligence   → sistem bisa menyusun context untuk LLM
Phase 3: Decision Engine        → sistem bisa memproduksi proposal tervalidasi
Phase 4: Agent Orchestration    → sistem bisa melibatkan multi-agent perspective
```

Phase 5 adalah fase refleksi:

```
Phase 5: Self-Improvement Loop → sistem menjawab: apakah semua itu benar-benar berguna?
```

Tanpa Phase 5, EF-AI adalah sistem yang beroperasi tanpa umpan balik. Mesin yang berjalan tanpa tahu apakah outputnya relevan, apakah agent-nya berkontribusi, atau apakah konfigurasinya optimal.

**Prinsip utama Phase 5**: *Measurement is not an optimization phase. Measurement is a prerequisite for any future optimization.*

Per Architecture Reviewer: "Risiko terbesar bukan lagi kekurangan agent. Risiko terbesar adalah Agent Explosion." Phase 5 menyediakan evidence untuk mempertanyakan setiap tambahan capability sebelum dieksekusi.

---

## Section 2 — Capability Gap Analysis (Architecture Reviewer Request)

### 2.1 Apa yang Phase 4 Sudah Buktikan

| Capability | Evidence |
|---|---|
| Multi-agent execution | 3 agents (ContextAnalyst, RiskAgent, PlanningAgent) beroperasi via Effect.all |
| Proposal-capable isolation | Only ContextAnalyst submits proposals — RiskAgent dan PlanningAgent tidak |
| Enrichment pipeline | Advisor output masuk ke ReconciliationLog.participants sebagai enrichment |
| Ownership boundaries | DecisionsBrain = sole ProposalStore writer — terbukti via G4 boundary tests |
| Agent Registry v1 | Compile-time known agents, no runtime discovery |
| Reconciliation algorithm | CONFIDENCE strategy deterministic — confidenceScore DESC, producedAt ASC tiebreak |
| AC-17 enforcement | ReconciliationLog persisted BEFORE proposal submission |
| AC-06 enforcement | VALIDATION_TIMEOUT terminal state — no limbo proposals |
| ADR-019 activation | `opencode evolution evaluate` — on-demand manual trigger |

### 2.2 Apa yang Phase 4 Belum Selesai

| Gap | Status | Destination |
|---|---|---|
| Decision quality improvement | UNKNOWN — belum pernah diukur | Phase 5 Sprint A |
| Multi-agent value quantification | UNKNOWN — apakah 3 agents lebih baik dari 1? | Phase 5 Sprint A |
| Selection strategy when >1 proposal agent | G4-AR-001 ACTIVE | Phase 5 Sprint D research |
| ProposalStore retention policy | AD-CP03-03 ACTIVE | Phase 5 Sprint E analysis |
| Memory governance degradation | AR-004 TRIGGERED (per DAFTAR TEMUAN KRITIS) | Phase 5 Sprint C + F |
| Single-writer rule technical enforcement | CR-001 (DAFTAR TEMUAN KRITIS) | Phase 5 Sprint F |
| Decision provenance (end-to-end lineage) | CR-005 — zero coverage | Phase 5 Sprint F ADR |
| Confidence calibration | CR-002 — not critical yet (1 LLM) | Phase 5 Sprint F research |
| Contradiction detection (semantic) | DA-FUTURE-02 OBSERVED | Phase 6 (research deferred) |
| HELD state workflow | G4-D03 incomplete | Phase 6 |
| Semantic contradiction detection | G4-D04 incomplete | Phase 6 |

### 2.3 Capability Gap Yang Phase 5 Tutup

**Gap terkecil yang Phase 5 harus tutup**:

```
CURRENT STATE:
EF-AI beroperasi tanpa feedback loop.
No metric exists to answer: "is it working?"

AFTER PHASE 5:
EF-AI dapat mengukur kualitas keputusan sendiri.
EF-AI dapat mengidentifikasi pola kegagalan.
EF-AI dapat menyarankan perbaikan konfigurasi.
EF-AI governance research tersedia untuk Phase 6 decisions.
```

**Yang bukan target Phase 5**:

- Automatic improvement (sistem tidak mengeksekusi perubahan sendiri)
- New agents (tidak ada agent baru yang dibangun)
- New capabilities (tidak ada capability baru yang diberikan ke LLM)
- Major architecture redesign (ProposalStore, ReconciliationLog, agent pipeline tetap unchanged; hanya invariant checker ditambahkan di Sprint F)

### 2.4 Mengapa Measurement Harus Mendahului Improvement

`[FACT]` Satu-satunya proposal yang pernah dieksekusi di Phase 4 runtime adalah ADR-MQI4AZF5-9E8B (proposal yang dihasilkan saat `Activation.invoke()` pertama kali berjalan). Ini adalah sample size = 1.

`[INFERENCE]` Dengan sample size 1, tidak ada pattern yang bisa diidentifikasi. Tidak ada evidence untuk menyarankan perubahan apapun.

`[DECISION]` Phase 5 harus MENGUMPULKAN DATA sebelum MENYARANKAN perubahan. Sprint A dan B mendahului Sprint C. Ini bukan preferensi — ini adalah syarat epistemologis.

---

## Section 3 — Open Items Disposition

### 3.1 Active Debts (7 items) — Phase 5 Stance

| Debt | Phase 5 Action | Gate |
|---|---|---|
| **AD-001** Facade Boundary Enforcement | WATCH — tidak ada perubahan facade di Phase 5 | Ongoing |
| **AD-003** Error Taxonomy Governance | **ENHANCE** — tambah exit criteria: CI lint check that detects unregistered error types (per CR-008) | Sprint F |
| **TD-001** Memory Storage Scalability | MONITOR via Sprint A metrics (memory write frequency) | Sprint A |
| **KL-001** CLI Disabled Ambiguity | WONTFIX — unchanged | — |
| **ED-021** ConfigEvolution Schema Duplication | WATCH — Phase 5 mungkin menambah 2 field baru ke ConfigEvolution | Sprint C |
| **AD-CP03-03** ProposalStore Growth | **RESOLVE** via Sprint E analysis — actual measurement, bukan asumsi. Sprint E scope diperluas: resolusi konflik audit vs retention (per CR-003) | Sprint E |
| **G4-AR-001** Multiple Proposal-Capable Agents | **RESEARCH** via Sprint D — ADR draft sebagai deliverable | Sprint D |
| **CR-001** Single-Writer Enforcement | **IMPLEMENT** — invariant checker di ProposalStore.write() | Sprint F |
| **CR-005** Decision Provenance | **RESEARCH** — ADR Decision Provenance Graph | Sprint F |

### 3.2 Active Risks (6 items) — Phase 5 Stance

| Risk | Phase 5 Action |
|---|---|
| **AR-001** God Object | ENFORCE — Phase 5 services TIDAK boleh masuk Evolution.Service facade |
| **AR-002** Context Explosion | MONITOR via Sprint A metrics (contextBudget.used per session) |
| **AR-003** Agent Explosion | PREVENT — Phase 5 tidak menambah agent; Sprint D governance research mencegah proliferasi |
| **AR-004** Memory Governance Degradation | **TRIGGERED** — Per DAFTAR TEMUAN KRITIS (CR-004), trigger condition Phase 5 design start terpenuhi. Sprint F akan meneliti mekanisme memory decay/archival dan source separation. |
| **AR-005** Self-Reinforcement Feedback Loop | **OBSERVED** — Risiko baru per CR-007. Trigger: ketika Improver diubah dari suggestion-only ke auto-execute (Phase 6). |
| **ARCH-WATCH-P3-01** ProposalStore Retention | **DIRECT TARGET** — Sprint E adalah jawaban langsung untuk watchlist ini |
| **ARCH-WATCH-P5-01** Governance Debt Accumulation (R-NEW-05) | **MONITOR** — Jumlah ADR dan AC bertambah; butuh deprecation mechanism |
| **ARCH-WATCH-P5-02** Constraint Drift (R-NEW-06) | **MONITOR** — AC-01..AC-25 akan bertambah; butuh invariant-checking tool |
| **DA-FUTURE-02** Contradiction Logic | DEFER ke Phase 6 — bukan Phase 5 concern |

### 3.3 Commitment: What Phase 5 Does NOT Touch

Per Architecture Reviewer directive — dokumen ini secara eksplisit melarang:

| Item | Justification |
|---|---|
| `primaryGenerator: boolean` di AgentManifest | Premature — hanya 1 proposal agent. Sprint D research, bukan implementation |
| Retention policy implementation | Premature — belum ada growth data. Sprint E analysis first |
| Auto-execute improvements | Phase 5 = suggestion only (AC-23). Auto-execute = Phase 6 |
| Decision provenance implementation | Sprint F hanya ADR (research). Implementasi = Phase 6 |
| Confidence calibration implementation | Sprint F hanya ADR (research). Implementasi = Phase 6 |
| HELD state | G4-D03 research belum selesai. Phase 6 |
| Semantic contradiction | DA-FUTURE-02 belum triggered. Phase 6 |
| New agents (Phase 5) | AR-003 prevention. Tidak ada agent baru di Phase 5 |
| Memory archival/during Phase 5 | Sprint F hanya meneliti memory lifecycle design + source separation. Tidak ada implementasi retention/decay di Phase 5 |

---

## Section 4 — New ADR Proposals (ADR-020, ADR-021)

Per ADR-012v2: "Tidak ada implementasi sebelum ADR relevan PROPOSED."

### ADR-020 — Metrics Governance

**Problem**: Phase 5 Sprint A mengintroduksi MetricsService. Tanpa boundary contract yang jelas, MetricsService berpotensi:

- Menulis ke ProposalStore (violates read-only principle)
- Membuat storage baru (violates no-new-store principle)
- Mengekspos internal data format ke CLI layer (violates encapsulation)

**Decision**:

```
AC-19: MetricsService adalah READ-ONLY. Tidak ada method yang menulis ke storage manapun.

AC-20: MetricsService mengakses ProposalStore dan ReconciliationLog HANYA via Evolution.Service facade
       (AD-001 compliance). Tidak ada direct file system access dari metrics layer.

AC-21: MetricsService menghasilkan MetricsSnapshot DTO (plain data object). Bukan Effect stream,
       bukan live view, bukan subscription. Snapshot satu waktu per invokasi.

AC-22: CLI layer (opencode evolution metrics) bertanggung jawab untuk formatting MetricsSnapshot
       menjadi human-readable output. MetricsService tidak tahu CLI format.
```

**Enforcement**: Per ADR-011 SW-01 (Single-Writer Rule), ProposalStore hanya memiliki satu writer path. MetricsService tidak menambah writer. Code review gate: MetricsService methods harus semua menggunakan `Effect.map`, `Effect.flatMap`, bukan `Effect.tap` dengan side effects.

**Status**: PROPOSED — target ACCEPTED via Phase 5 gate.

---

### ADR-021 — Improver Constraint Model

**Problem**: Phase 5 Sprint C mengintroduksi ImproverService. Tanpa constraint model yang eksplisit, Improver berpotensi melampaui "suggestion" dan melakukan perubahan otomatis — bertentangan dengan Architecture Reviewer directive.

**Decision**:

```
IMPROVER BOUNDARY CONTRACT:

AC-23: ImproverService menghasilkan ReadonlyArray<Suggestion>.
       ImproverService tidak memodifikasi file apapun.
       ImproverService tidak mengubah config apapun.
       ImproverService tidak memanggil LLM apapun.

AC-24: Setiap Suggestion harus berisi:
       - suggestionId: string     (unique, format "S-YYYYMMDD-NNN")
       - category: SuggestionCategory
       - currentValue: unknown    (apa yang ada sekarang)
       - suggestedValue: unknown  (apa yang disarankan)
       - rationale: string        (mengapa — harus reference metric data)
       - confidence: "low" | "medium" | "high"
       - metricSource: string[]   (metric ID yang mendukung suggestion ini)

AC-25: ImproverService TIDAK diizinkan untuk:
       - Membuat Suggestion tanpa metricSource (suggestion spekulatif)
       - Mengeksekusi Suggestion (auto-apply)
       - Menyimpan Suggestion history (tidak ada SuggestionStore)
       - Memanggil LLM untuk menghasilkan Suggestion (rule-based only)
```

**Suggestion categories** (exhaustive, Phase 5):

| SuggestionCategory | Target | Example |
|---|---|---|
| `CONFIG_THRESHOLD` | `ConfigEvolution.minCandidateConfidence` | "Acceptance rate 15% — consider lowering to 0.2" |
| `CONFIG_BUDGET` | `ConfigEvolution.contextBudget` | "Context truncation rate 60% — consider increasing" |
| `AGENT_INSTRUCTION` | `AgentManifest.instruction` | "RiskAgent rejection correlation high — review instruction" |
| `MODE_ADJUSTMENT` | `ConfigEvolution.mode` | "Rejection rate 80% in autonomous — suggest assist mode" |

**Enforcement**: TG-IMPROVER-NO-WRITE — grep ImproverService source for any write/save/modify/execute patterns → zero results.

**Status**: PROPOSED — target ACCEPTED via Phase 5 gate.

---

## Section 5 — Architectural Constraints (AC-19 through AC-25)

Summary table (AC-01 through AC-18 are Phase 1–4 constraints):

| ID | Constraint | Phase | Enforcement |
|---|---|---|---|
| AC-19 | MetricsService = read-only | 5 | Code review + TG-METRICS-NO-WRITE |
| AC-20 | MetricsService uses facade only (AD-001) | 5 | oxlint + grep audit |
| AC-21 | MetricsSnapshot = DTO (no stream/subscription) | 5 | Type system: no Effect stream in return types |
| AC-22 | CLI owns formatting, MetricsService owns data | 5 | Separation: service returns DTO, CLI renders |
| AC-23 | ImproverService produces suggestions only — no execution | 5 | Code review + TG-IMPROVER-NO-WRITE |
| AC-24 | Every Suggestion must have metricSource[] | 5 | Runtime assertion + test |
| AC-25 | ImproverService uses rule-based logic only — no LLM | 5 | grep for LLM import in improver.ts → 0 |

---

## Section 6 — Sprint A: Decision Quality Metrics

**Authorization**: Requires Phase 4 ACCEPTED + ADR-020 PROPOSED
**Goal**: Measure what Phase 4 has produced. No improvement, no suggestion. Only measurement.
**Deliverable**: `src/evolution/evolution/metrics.ts` + CLI command

### 6.1 Metric Definitions (Exact Formulas)

Setiap metrik memiliki formula yang deterministik. Bukan deskripsi, tapi spesifikasi.

```typescript
// M-01: Proposal Accepted Rate
acceptedRate = count(ACCEPTED) / (count(ACCEPTED) + count(REJECTED))
// Range: [0.0, 1.0]. NaN if no terminal proposals.
// Interpretation: > 0.7 = healthy; 0.3–0.7 = needs analysis; < 0.3 = systematic problem

// M-02: Rejection Reason Distribution
rejectionDistribution: { [RejectionCode]: { count: number; percentage: number } }
// Sources: ProposalStore.listByStatus("REJECTED")
// Keys: "SCHEMA_INVALID" | "DUPLICATE_KEY" | "AUTHORITY_VIOLATION" |
//       "VALIDATION_TIMEOUT" | "VALIDATION_ERROR"

// M-03: Below-Threshold Rate
belowThresholdRate = count(outcome === "BELOW_THRESHOLD") / count(reconciliationLogs)
// Range: [0.0, 1.0]. High rate = minCandidateConfidence too high, or agents underperforming.

// M-04: Advisor Contribution Rate
advisorContributionRate = count(logs where participants.some(p => p.contributionType !== "proposal"))
                        / count(reconciliationLogs)
// Range: [0.0, 1.0]. < 0.5 = advisors rarely executing.

// M-05: Confidence Score Distribution (Histogram)
confidenceHistogram: {
  "low":    count(candidates with reasoningStrength === "low"),
  "medium": count(candidates with reasoningStrength === "medium"),
  "high":   count(candidates with reasoningStrength === "high"),
}
// Source: ReconciliationLog.candidates[].reasoningStrength

// M-06: Enrichment-to-Acceptance Correlation
// Proposals WITH enrichment (participants.length > 1 proposal agent):
enrichedAcceptedRate = count(ACCEPTED proposals where its reconLog has >0 advisor participants) /
                       count(all proposals where its reconLog has >0 advisor participants)
// Proposals WITHOUT enrichment:
unenrichedAcceptedRate = count(ACCEPTED proposals where reconLog has 0 advisors) /
                         count(all proposals where reconLog has 0 advisors)
// Correlation: enrichedAcceptedRate - unenrichedAcceptedRate
// Positive = enrichment helps; Negative = enrichment hurts; ~0 = no effect

// M-07: Time-to-Validation (median, in ms)
medianValidationTimeMs = median(
  proposals.filter(p => p.validatedAt && p.createdAt)
           .map(p => p.validatedAt - p.createdAt)
)
// High value = AC-06 timeouts frequent or Tier 2 slow

// M-08: Context Budget Utilization
averageBudgetUtilization = mean(EvolutionContext.budget.used / EvolutionContext.budget.configured)
// Source: requires EvolutionContext tracking (Sprint A scope: READ from existing audit data only)
// If no tracking exists: M-08 = UNAVAILABLE (not fabricated)

// M-09: Epistemic Diversity Index
// Mengukur seberapa beragam kontribusi advisor — deteksi false consensus (CR-006)
// Formula: unique advisor content ratio = 1 - (total overlapping content / total advisor content)
// Overlapping = n-gram (tri-gram) yang muncul di 2+ advisor outputs
// Jika semua advisor menghasilkan output identik → DiversityIndex mendekati 0 (false consensus risk)
// Jika setiap advisor menghasilkan output unik → DiversityIndex mendekati 1
epistemicDiversityIndex = 1 - (overlappingNGramCount / totalNGramCount)
// Range: [0.0, 1.0]. < 0.3 = high false consensus risk; > 0.7 = healthy diversity
// Source: ReconciliationLog.participants[] — content dari setiap advisor execution
// Note: hanya tersedia jika ReconciliationLog menyimpan advisor output content
// Jika tidak tersedia: M-09 = UNAVAILABLE (tidak difabrikasi)
```

### 6.2 Data Sources and Query Paths

```
MetricsService DATA ACCESS MAP:

M-01, M-02:
  evolution.decisions().listProposals()
  → ProposalStore.listByStatus("ACCEPTED") + listByStatus("REJECTED")
  → Respects AD-001 (facade-only access)

M-03, M-04, M-05, M-06:
  evolution.decisions().getReconciliationLogs()
  → ReconciliationLog files (Brain-persisted)
  → Path: .opencode/evolution/reconciliation/*.json (or Brain-defined path)
  → Respects AD-001 (via facade, not direct file read)

M-07:
  Cross-query: join ProposalStore entries with validatedAt timestamps
  evolution.decisions().listProposals({ includeTerminalOnly: true })

M-08:
  Derived from EvolutionContext audit if available
  If not available: field = null (UNAVAILABLE, not fabricated)

CRITICAL: MetricsService MUST NOT directly import:
  - brain/decisions.ts
  - brain/proposal-store.ts
  - Any fs/FileSystem operation
Only: Evolution.Service.decisions() interface
```

### 6.3 TypeScript Interface

```typescript
// src/evolution/evolution/metrics.ts

// Per ADR-012v2: all types declared before implementation

export interface MetricsSnapshot {
  readonly capturedAt: number                          // Unix ms timestamp
  readonly sessionWindow: {
    readonly projectDir: string
    readonly proposalCount: number
    readonly reconciliationLogCount: number
  }

  // M-01: Acceptance
  readonly acceptedRate: number | null                 // null if no data
  readonly totalProposals: number
  readonly totalAccepted: number
  readonly totalRejected: number

  // M-02: Rejection distribution
  readonly rejectionDistribution: ReadonlyArray<{
    readonly code: string                              // RejectionCode
    readonly count: number
    readonly percentage: number
  }>

  // M-03: Below-threshold
  readonly belowThresholdRate: number | null

  // M-04: Advisor participation
  readonly advisorContributionRate: number | null

  // M-05: Confidence histogram
  readonly confidenceHistogram: {
    readonly low: number
    readonly medium: number
    readonly high: number
  }

  // M-06: Enrichment correlation
  readonly enrichmentCorrelation: {
    readonly enrichedAcceptedRate: number | null
    readonly unenrichedAcceptedRate: number | null
    readonly correlationDelta: number | null           // enriched - unenriched
  }

  // M-07: Validation time
  readonly medianValidationTimeMs: number | null

  // M-08: Budget utilization
  readonly averageBudgetUtilization: number | null     // null if UNAVAILABLE

  // M-09: Epistemic diversity
  readonly epistemicDiversityIndex: number | null      // [0.0, 1.0]; null if UNAVAILABLE
  readonly falseConsensusWarning: boolean              // true if diversityIndex < 0.3
}

export namespace MetricsService {
  export interface Interface {
    /**
     * Compute MetricsSnapshot from all available data.
     * READ-ONLY. No writes. AC-19, AC-20 compliant.
     *
     * @returns Effect<MetricsSnapshot, EvolutionStorageError>
     * Fails only if underlying ProposalStore or ReconciliationLog is unreadable.
     * Empty data is NOT an error — produces snapshot with null fields.
     */
    readonly snapshot: () => Effect.Effect<MetricsSnapshot, EvolutionStorageError>
  }
}
```

### 6.4 CLI Contract

```
COMMAND: opencode evolution metrics

OUTPUT FORMAT (human-readable, not JSON):

=== EF-AI Decision Quality Metrics ===
Captured: 2026-06-18T09:00:00Z
Window: project at /path/to/project

PROPOSAL OUTCOMES (N total)
  Accepted:         N (XX.X%)
  Rejected:         N (XX.X%)
  Below-threshold:  N (XX.X%)
  In-progress:      N (open)

REJECTION REASONS
  DUPLICATE_KEY:        N (XX.X%)
  SCHEMA_INVALID:       N (XX.X%)
  VALIDATION_TIMEOUT:   N (XX.X%)
  AUTHORITY_VIOLATION:  N (XX.X%)
  VALIDATION_ERROR:     N (XX.X%)

AGENT PERFORMANCE
  Advisor contribution rate: XX.X%
  Confidence distribution:
    high:   N candidates (XX.X%)
    medium: N candidates (XX.X%)
    low:    N candidates (XX.X%)

ENRICHMENT CORRELATION
  With enrichment:    XX.X% accepted
  Without enrichment: XX.X% accepted
  Delta: +/-XX.X% (enrichment [helps|hurts|neutral])

TIMING
  Median validation time: N ms
  Budget utilization: XX.X% (or UNAVAILABLE)

DIVERSITY (CR-006)
  Epistemic diversity index: X.XX (or UNAVAILABLE)
  False consensus warning: [YES|NO]

  Note: Low diversity (< 0.3) may indicate false consensus risk.
  Check advisor output uniqueness by running `opencode evolution analyze`.

Note: All metrics are read-only observations. No data is modified.
Use `opencode evolution analyze` for trend analysis and pattern detection.

ALTERNATIVE: opencode evolution metrics --json
→ Outputs MetricsSnapshot as JSON (for programmatic use)
```

### 6.5 Test Gates (Sprint A)

| Gate | Test | Mechanism |
|---|---|---|
| TG-METRICS-NO-WRITE | MetricsService source has no write/save/modify/insert/delete calls | grep audit |
| TG-METRICS-FACADE | MetricsService has no direct brain/* imports | grep + oxlint |
| TG-METRICS-NULL-SAFETY | Empty ProposalStore → snapshot returns null fields, not NaN/error | unit test |
| TG-METRICS-FORMULA | Given N accepted + M rejected, acceptedRate = N/(N+M) | unit test |
| TG-METRICS-CORRELATION | Given enriched vs unenriched proposals, delta computed correctly | unit test |
| TG-METRICS-CLI | CLI renders MetricsSnapshot without crashing when all fields null | unit test |
| TG-METRICS-DIVERSITY | Given identical advisor content → diversityIndex near 0, falseConsensusWarning = true | unit test |
| TG-METRICS-DIVERSITY-UNIQUE | Given all unique advisor content → diversityIndex near 1, falseConsensusWarning = false | unit test |

### 6.6 Evidence Requirements (ADR-012v2)

| Evidence Category | Required Artifact |
|---|---|
| Source Reference | `grep -rn "MetricsService" src/evolution/` → files exist |
| No-Write Boundary | `grep -rn "write\|save\|insert\|modify" src/evolution/evolution/metrics.ts` → 0 results |
| Formula Correctness | Unit test output: all 6 formula tests pass |
| CLI Rendering | `opencode evolution metrics` output (screenshot or captured output) |
| Phase 1-4 Regression | Full evolution test suite — 0 new failures |

---

## Section 7 — Sprint B: Analyzer Service

**Authorization**: Requires Sprint A ACCEPTED
**Goal**: Identify patterns from MetricsSnapshot data. No suggestion yet. Pattern detection only.
**Deliverable**: `src/evolution/evolution/analyzer.ts` + CLI command

### 7.1 Analysis Types

```typescript
// ANALYSIS TAXONOMY (exhaustive for Phase 5)

// B-01: Failure Pattern Analysis
interface FailurePattern {
  readonly dominantRejectionCode: string | null     // most frequent RejectionCode
  readonly dominantRejectionRate: number | null     // % of rejections with dominant code
  readonly patternClassification:
    | "SCHEMA_QUALITY_ISSUE"    // SCHEMA_INVALID > 30% of rejections
    | "TIMEOUT_PRESSURE"        // VALIDATION_TIMEOUT > 20% of rejections
    | "DUPLICATE_SATURATION"    // DUPLICATE_KEY > 50% of rejections
    | "AUTHORITY_MISCONFIGURED" // AUTHORITY_VIOLATION > 0
    | "HEALTHY"                 // no dominant code, < 30% total rejection
    | "INSUFFICIENT_DATA"
}

// B-02: Advisor Contribution Analysis
interface AdvisorAnalysis {
  readonly advisorExecutionRate: number | null      // M-04 from Sprint A
  readonly enrichmentEffect:
    | "POSITIVE"      // enriched proposals accepted more
    | "NEGATIVE"      // enriched proposals accepted less
    | "NEUTRAL"       // delta < 5%
    | "INSUFFICIENT_DATA"
  readonly underperformingAdvisors: ReadonlyArray<{
    readonly agentId: string
    readonly contributionType: string
    readonly executionCount: number
  }>
}

// B-03: Configuration Health Analysis
interface ConfigAnalysis {
  readonly thresholdAssessment:
    | "TOO_HIGH"      // belowThresholdRate > 50%
    | "TOO_LOW"       // all candidates always above threshold (suspicious)
    | "HEALTHY"       // 10%–40% below threshold
    | "INSUFFICIENT_DATA"
  readonly budgetAssessment:
    | "CONSTRAINED"   // averageBudgetUtilization > 80%
    | "WASTEFUL"      // averageBudgetUtilization < 20% (over-provisioned)
    | "HEALTHY"
    | "UNAVAILABLE"
}

// B-04: Usage Trend Analysis (requires >1 session of data)
interface UsageTrend {
  readonly dataPoints: number               // number of snapshots available
  readonly trendDirection:
    | "IMPROVING"   // acceptance rate increasing over time
    | "DEGRADING"   // acceptance rate decreasing over time
    | "STABLE"
    | "INSUFFICIENT_DATA"   // <3 data points for trend
}
```

### 7.2 TypeScript Interface

```typescript
export interface AnalysisReport {
  readonly generatedAt: number
  readonly basedOnSnapshot: MetricsSnapshot        // the snapshot this report analyzes

  readonly failurePattern: FailurePattern
  readonly advisorAnalysis: AdvisorAnalysis
  readonly configAnalysis: ConfigAnalysis
  readonly usageTrend: UsageTrend

  readonly overallAssessment:
    | "HEALTHY"           // no concerning patterns found
    | "NEEDS_ATTENTION"   // one or more patterns suggest review needed
    | "CRITICAL"          // fundamental issue requiring immediate action
    | "INSUFFICIENT_DATA" // <5 proposals total — cannot assess

  readonly assessmentRationale: string  // human-readable explanation
}

export namespace AnalyzerService {
  export interface Interface {
    readonly analyze: (
      snapshot: MetricsSnapshot,
    ) => Effect.Effect<AnalysisReport, never>
    // ALWAYS succeeds — insufficient data is a valid report state
    // AC-19: Read-only — MetricsSnapshot is the input, no storage access needed
  }
}
```

### 7.3 CLI Contract

```
COMMAND: opencode evolution analyze

OUTPUT FORMAT:

=== EF-AI Decision Analysis Report ===
Generated: 2026-06-18T09:01:00Z
Assessment: NEEDS_ATTENTION

FAILURE PATTERN: DUPLICATE_SATURATION
  Duplicate key rejections dominate (67% of rejections).
  Cause: Decision Engine is proposing already-decided topics.
  Implication: minCandidateConfidence tuning may not help.
  Action: Review which topics are being evaluated repeatedly.

ADVISOR ANALYSIS: POSITIVE effect
  Enriched proposals accepted 73% vs unenriched 41%.
  Advisors executing in 89% of sessions.
  No underperforming advisors detected.

CONFIG HEALTH: HEALTHY
  Below-threshold rate: 12% (within expected range 10-40%).
  Budget utilization: 45% (healthy).

TREND: INSUFFICIENT_DATA
  Only 1 session of data available.
  Run evaluation in 5+ sessions for trend analysis.

RATIONALE: Duplicate saturation indicates the evaluation criteria
may be too broad. Consider narrowing the instruction scope or
implementing topic tracking.

Use `opencode evolution improve` for actionable suggestions.
```

### 7.4 Test Gates (Sprint B)

| Gate | Test | Mechanism |
|---|---|---|
| TG-ANALYZER-PURE | AnalyzerService.analyze() is a pure function (no Effect required, returns Effect<never>) | Type check |
| TG-ANALYZER-INSUFFICIENT | 0 proposals → overallAssessment = "INSUFFICIENT_DATA" | unit test |
| TG-ANALYZER-HEALTHY | 100% accepted, no timeouts → overallAssessment = "HEALTHY" | unit test |
| TG-ANALYZER-CRITICAL | 90% SCHEMA_INVALID → failurePattern.patternClassification = "SCHEMA_QUALITY_ISSUE" | unit test |
| TG-ANALYZER-TREND | <3 data points → usageTrend.trendDirection = "INSUFFICIENT_DATA" | unit test |

---

## Section 8 — Sprint C: Improver Service (Read-Only Suggestions)

**Authorization**: Requires Sprint B ACCEPTED
**Goal**: Generate actionable suggestions based on AnalysisReport. NO execution. NO auto-apply.
**Deliverable**: `src/evolution/evolution/improver.ts` + CLI command

### 8.1 Suggestion Generation Rules (Rule-Based, No LLM)

```
RULE ENGINE (imperative, deterministic):

Rule I-01: If configAnalysis.thresholdAssessment === "TOO_HIGH" AND belowThresholdRate > 0.5:
  → Generate Suggestion: CONFIG_THRESHOLD
    currentValue: ConfigEvolution.minCandidateConfidence
    suggestedValue: max(0.1, currentValue - 0.15)
    rationale: "Below-threshold rate is {belowThresholdRate*100}%. Lowering threshold
                may increase candidate pool. Verify rejection patterns are not data quality."
    confidence: if belowThresholdRate > 0.8 then "high" else "medium"
    metricSource: ["M-03", "M-01"]

Rule I-02: If configAnalysis.budgetAssessment === "CONSTRAINED":
  → Generate Suggestion: CONFIG_BUDGET
    currentValue: ConfigEvolution.contextBudget
    suggestedValue: min(8192, currentValue * 1.5)
    rationale: "Context budget utilization is {avgUtilization*100}%. Frequent truncation
                may reduce context quality for Decision Engine."
    confidence: "medium"
    metricSource: ["M-08"]

Rule I-03: If failurePattern.patternClassification === "SCHEMA_QUALITY_ISSUE":
  → Generate Suggestion: AGENT_INSTRUCTION
    targetAgentId: "context-analyst"   // sole proposal agent in Phase 5
    rationale: "SCHEMA_INVALID rejection rate is {rate}%. The agent instruction may
                be producing malformed proposals. Review the instruction for clarity."
    confidence: if rate > 0.5 then "high" else "low"
    metricSource: ["M-02"]

Rule I-04: If overallAssessment === "CRITICAL" AND acceptedRate < 0.2:
  → Generate Suggestion: MODE_ADJUSTMENT
    rationale: "Acceptance rate is {acceptedRate*100}%. In autonomous mode, this means
                frequent low-quality decisions. Consider switching to assist mode until
                root cause is identified."
    confidence: "high"
    metricSource: ["M-01", "M-02"]

CONSTRAINT (AC-24): Every suggestion MUST reference at least one metricSource.
CONSTRAINT (AC-25): No LLM call in any rule. All reasoning is conditional logic.
CONSTRAINT (AC-23): Return ReadonlyArray<Suggestion>. No file modification.
```

### 8.2 TypeScript Interface

```typescript
export type SuggestionCategory =
  | "CONFIG_THRESHOLD"
  | "CONFIG_BUDGET"
  | "AGENT_INSTRUCTION"
  | "MODE_ADJUSTMENT"

export interface Suggestion {
  readonly suggestionId: string                      // "S-20260618-001"
  readonly category: SuggestionCategory
  readonly targetField?: string                      // e.g. "ConfigEvolution.minCandidateConfidence"
  readonly targetAgentId?: string                    // if AGENT_INSTRUCTION
  readonly currentValue?: unknown                    // current observed value
  readonly suggestedValue?: unknown                  // what to change it to
  readonly rationale: string                         // human-readable, metric-referenced
  readonly confidence: "low" | "medium" | "high"
  readonly metricSource: ReadonlyArray<string>       // ["M-01", "M-03"]
  readonly howToApply: string                        // exact steps to apply (manual)

  // Anti-memory-poisoning (CR-004): setiap memory entry yang mempengaruhi suggestion
  // harus mencatat asalnya. Field ini diisi oleh implementasi Sprint C saat
  // membaca Memory.Service — self-generated vs external source.
  readonly memorySource: "self_generated" | "external" | "mixed" | "unknown"
}

export namespace ImproverService {
  export interface Interface {
    readonly suggest: (
      report: AnalysisReport,
    ) => ReadonlyArray<Suggestion>
    // SYNCHRONOUS — no Effect, no I/O, no LLM
    // Returns empty array if no suggestions applicable
    // AC-23: Read-only. AC-24: metricSource required. AC-25: no LLM.
  }
}
```

### 8.3 CLI Contract

```
COMMAND: opencode evolution improve

OUTPUT FORMAT:

=== EF-AI Improvement Suggestions ===
Generated: 2026-06-18T09:02:00Z
Suggestions: 2 found

SUGGESTION S-20260618-001 [confidence: high]
Category: CONFIG_THRESHOLD
Target: ConfigEvolution.minCandidateConfidence

Current value: 0.3
Suggested value: 0.15

Rationale: Below-threshold rate is 67%. Lowering the threshold may increase
the candidate pool. Verify rejection patterns are not caused by data quality
issues (check `opencode evolution analyze` for SCHEMA_QUALITY_ISSUE pattern).

Metric sources: M-03 (below-threshold rate), M-01 (acceptance rate)

How to apply:
  Edit your OpenCode config file and set:
  evolution.minCandidateConfidence: 0.15
  Then run `opencode evolution evaluate` to observe effect.

WARNING: These are suggestions, not automatic changes. Review each suggestion
before applying. EF-AI does not modify your configuration automatically.

---

SUGGESTION S-20260618-002 [confidence: medium]
...

NOTE: 2 suggestions generated from data collected in 1 session.
More sessions = more reliable suggestions. Run `opencode evolution evaluate`
regularly to improve suggestion quality.
```

### 8.4 Test Gates (Sprint C)

| Gate | Test | Mechanism |
|---|---|---|
| TG-IMPROVER-NO-WRITE | ImproverService source has no write/save/modify calls | grep audit |
| TG-IMPROVER-NO-LLM | ImproverService source has no LLM import | grep audit |
| TG-IMPROVER-SYNC | ImproverService.suggest() is synchronous (no Effect) | type check |
| TG-IMPROVER-METRIC-SOURCE | Every Suggestion has metricSource.length > 0 | runtime assertion |
| TG-IMPROVER-HEALTHY | HEALTHY report → 0 suggestions | unit test |
| TG-IMPROVER-CRITICAL | CRITICAL + acceptedRate < 0.2 → includes MODE_ADJUSTMENT | unit test |
| TG-IMPROVER-THRESHOLD | belowThresholdRate > 0.5 → includes CONFIG_THRESHOLD | unit test |

---

## Section 9 — Sprint D: Selection Governance Research (G4-AR-001)

**Authorization**: Requires Sprint A ACCEPTED (data needed to assess strategies)
**Goal**: Produce ADR-022 DRAFT — not implementation. Research deliverable.
**Deliverable**: ADR-022 draft in `docs/evolution/`, research document

### 9.1 G4-AR-001 Resolution Framework

G4-AR-001 asks: *When >1 agent has `proposal` capability, how does the system select a primary generator?*

This question cannot be answered without evidence about when this scenario materializes. Sprint D produces the governance framework so Phase 6 can answer it with implementation.

**Three strategies to research and compare**:

### Strategy A: `primaryGenerator: boolean` Flag in AgentManifest

```typescript
// Proposed extension to AgentManifest (NOT IMPLEMENTED in Phase 5)
interface AgentManifest {
  readonly id: string
  readonly capabilities: readonly AgentCapability[]
  readonly instruction: string
  readonly primaryGenerator?: boolean  // if true: this agent submits proposals
  // Only ONE agent may have primaryGenerator: true at any time
  // If multiple: validation error at registry time
}
```

| Dimension | Assessment |
|---|---|
| Predictability | HIGH — explicit, deterministic |
| Flexibility | LOW — requires manifest change to swap primary |
| Migration cost | LOW — additive field, backward compatible |
| Risk | MEDIUM — what if primaryGenerator agent underperforms? no auto-fallback |
| Phase 6 compatibility | HIGH — works with multi-model routing |

### Strategy B: Ordering Rule (First Registered Wins)

```
Rule: Among proposal-capable agents, the agent registered first in AgentLayers
      becomes the effective primary generator.
```

| Dimension | Assessment |
|---|---|
| Predictability | MEDIUM — depends on import order, which is not obvious |
| Flexibility | MEDIUM — change order to change primary |
| Migration cost | NONE — no schema change |
| Risk | HIGH — implicit ordering is a hidden contract |
| Phase 6 compatibility | MEDIUM — routing may conflict with first-registered assumption |

### Strategy C: Expanded Reconciliation (All Proposal-Capable Compete)

```
Rule: All proposal-capable agents produce ProposalCandidate.
      ConfidenceReconciliationStrategy selects highest confidence winner.
      Existing Phase 4 pipeline — no change needed.
```

| Dimension | Assessment |
|---|---|
| Predictability | MEDIUM — depends on confidence scores (non-deterministic LLM output) |
| Flexibility | HIGH — add any agent, system self-organizes |
| Migration cost | NONE — works today |
| Risk | MEDIUM — confidence score comparability across different agent types is unproven |
| Phase 6 compatibility | HIGH — natural multi-agent competition |

### 9.2 Decision Criteria for ADR-022

Sprint D must produce answers to these questions:

| Question | Method |
|---|---|
| Is Phase 6 adding a second proposal-capable agent? | Architecture Reviewer decision |
| Will the second agent be same-domain or different-domain? | Informs Strategy C viability |
| Is confidence score comparability proven across agent types? | Sprint A M-05 data + analysis |
| Is ordering rule acceptable as governance? | Team discussion — not data-driven |

### 9.3 ADR-022 Draft Template (to be filled during Sprint D)

```markdown
## ADR-022 — Multi-Proposal-Agent Selection Strategy

**Date**: [Sprint D completion date]
**Status**: DRAFT (proposed, not accepted)
**Phase**: 5 Research → Phase 6 Implementation

### Problem
When >1 agent has `proposal` capability in AgentManifest, the system must
deterministically select which agent's output becomes the formal proposal.

### Evidence from Sprint A Metrics
[Fill in: M-05 confidence distribution across agents]
[Fill in: M-06 enrichment correlation data]

### Decision
Choose ONE of:
- [ ] Strategy A: primaryGenerator flag (explicit, Schema change)
- [ ] Strategy B: Ordering rule (implicit, no Schema change)
- [ ] Strategy C: Expanded reconciliation (self-organizing, no change)

### Rationale
[Fill in: why chosen strategy is preferred based on Sprint D research]

### Impact
[Fill in: what changes in Phase 6 if this strategy is adopted]

**Status**: DRAFT — NOT ACCEPTED until Phase 6 pre-implementation review
```

### 9.4 Sprint D Evidence Requirements

| Deliverable | Format | Location |
|---|---|---|
| Strategy comparison matrix | Markdown table | `docs/evolution/G4-AR-001-research.md` |
| Tradeoff analysis per strategy | Pros/cons list | Same document |
| Phase 6 impact analysis | Migration path description | Same document |
| ADR-022 draft | ADR format | `docs/evolution/DECISIONS.md` (appended as DRAFT) |

---

## Section 10 — Sprint E: Retention Analysis (AD-CP03-03 + CR-003)

**Authorization**: Requires Sprint A ACCEPTED (need growth data)
**Goal**: Measure ProposalStore growth rate AND resolve audit trail vs retention conflict (CR-003).
**Deliverable**: Growth analysis report + binary retention recommendation + audit-trail conflict resolution design

### 10.1 Measurement Methodology

```typescript
// Retention Analysis Queries (all read-only)

interface RetentionAnalysis {
  // Volume metrics
  readonly totalProposals: number           // count all files in proposals/
  readonly totalReconciliationLogs: number  // count all files in reconciliation/
  readonly totalStorageBytes: number        // sum of all file sizes

  // Growth projection
  readonly proposalsPerSession: number      // total / session count
  readonly projectedProposalsIn30Sessions: number
  readonly projectedProposalsIn100Sessions: number

  // Performance benchmark
  readonly listByStatusLatencyMs: {
    readonly p50: number    // median latency for listByStatus() call
    readonly p95: number    // 95th percentile latency
    readonly p99: number    // 99th percentile latency
  }

  // Retention decision
  readonly recommendation:
    | "DEFER"     // all thresholds comfortable; defer retention policy
    | "PLAN"      // approaching thresholds; plan retention policy for next phase
    | "IMPLEMENT" // thresholds exceeded; implement retention policy now
  readonly recommendationRationale: string
}
```

### 10.2 Growth Thresholds

| Metric | DEFER | PLAN | IMPLEMENT |
|---|---|---|---|
| Total proposals | < 1,000 | 1,000–5,000 | > 5,000 |
| listByStatus() p95 latency | < 100ms | 100–500ms | > 500ms |
| Total storage | < 10MB | 10–100MB | > 100MB |
| Projected @100 sessions | < 2,000 | 2,000–10,000 | > 10,000 |

### 10.3 Decision Framework

#### 10.3.1 Retention Decision

```
IF recommendation === "DEFER":
  → Document in SESSION_LOG.md: "Retention analysis shows no current pressure."
  → AD-CP03-03 remains ACTIVE, no exit criteria changes.
  → Re-run Sprint E analysis at Phase 6 pre-implementation.

IF recommendation === "PLAN":
  → Create AD-CP03-03 exit criteria milestone: "Implement before Phase 6 ACCEPTED"
  → Research Phase 6 retention options: count-based (max N), time-based (older than X days),
    status-based (REJECTED older than X days eligible for cleanup)
  → Do NOT implement retention policy in Phase 5.

IF recommendation === "IMPLEMENT":
  → Create new sprint (Phase 5 Sprint F) for retention policy implementation
  → Phase 5 ACCEPTED gate requires Sprint F completion
  → AD-CP03-03 exit criteria: Sprint F verification tests
```

**The key principle**: Only implement if evidence proves necessity. Default is DEFER.

#### 10.3.2 Audit-Trail Conflict Resolution (CR-003)

Terlepas dari hasil retention decision, Sprint E HARUS menyelesaikan konflik audit vs retention:

| Concern | ProposalStore (operational) | Audit Ledger (proposed — terpisah) |
|---|---|---|
| Tujuan | Penyimpanan proposal aktif untuk pengambilan keputusan | Catatan immutable untuk forensik dan governance |
| Retention | Terbatas (berdasarkan keputusan §10.3.1) | Append-only, tidak pernah dihapus |
| Isi | Proposal lengkap + status + metadata | Ringkasan: proposal ID, timestamp, agent, outcome. Tanpa konten penuh |
| Ukuran | Besar (konten proposal lengkap) | Kecil (hanya metadata) |
| Hubungan | Proposal ID → Audit Ledger entry via foreign key | Entry mereferensi Proposal ID (jika masih ada) |

**Rekomendasi minimal (wajib)**:

1. **Pisahkan storage** — ProposalStore operasional boleh di-retensi; Audit Ledger append-only terpisah
2. **Setiap ProposalStore entry memiliki `auditRef`** — ID unik yang tetap ada di Audit Ledger meski proposal dihapus
3. **Audit Ledger menyimpan immutable record**: proposal ID, agent ID, timestamp, outcome, rejecting agent ID (jika relevant)
4. **Jika GDPR/delete-right diperlukan di masa depan**: hanya ProposalStore entry yang dihapus; Audit Ledger tetap menyimpan metadata tanpa PII

**Output Sprint E**: (a) binary retention recommendation, (b) Audit Ledger schema DRAFT, (c) migration path dari single-store ke dual-store, (d) trade-off analysis: storage cost vs auditability vs complexity.

### 10.4 Sprint E Evidence Requirements

| Deliverable | Format |
|---|---|
| RetentionAnalysis DTO | JSON output from `opencode evolution retention-status` |
| Growth projection | Table: current → @30 sessions → @100 sessions |
| Latency benchmark | p50/p95/p99 of listByStatus() |
| Binary recommendation | DEFER / PLAN / IMPLEMENT with rationale |
| AD-CP03-03 status update | Updated in ARCHITECTURE_DEBT_REGISTRY.md |
| Audit Ledger schema DRAFT | ADR-023 draft in `docs/evolution/DECISIONS.md` |
| Audit vs retention trade-off analysis | Markdown section in Sprint E deliverable |
| Migration path (single-store → dual-store) | Migration steps + rollback plan |

---

## Section 11 — Error Registry: Phase 5 Additions

Per AD-003 (Error Taxonomy Governance): registration before implementation.

**Phase 5 determination**: MetricsService, AnalyzerService, and ImproverService use only:

- `EvolutionStorageError` (existing) — when ProposalStore or ReconciliationLog reads fail
- No new error class needed

Justification:

- MetricsService errors are read failures → `EvolutionStorageError` covers this
- AnalyzerService is pure function (no Effect) → no typed errors
- ImproverService is synchronous → no typed errors
- Sprint D is research → no runtime errors
- Sprint E is read-only measurement → `EvolutionStorageError` covers read failures

**Phase 5 ERROR_REGISTRY.md update**:

```markdown
## Phase 5 Error Assessment (added Sprint A)

All Phase 5 services (MetricsService, AnalyzerService, ImproverService) reuse
existing EvolutionStorageError for I/O failures. No new error classes introduced.

Error family remains at 5 entries.
```

---

## Section 12 — Phase 6 Compatibility Assessment

Phase 6 adalah Multi-AI Routing. Sebelum Phase 5 dapat ditutup, setiap keputusan Phase 5 harus diverifikasi tidak memblokir Phase 6.

| Phase 5 Decision | Phase 6 Implication | Compatibility |
|---|---|---|
| MetricsService = read-only | Phase 6 may extend with write-capable monitoring | ✅ Additive — read services compose with future write services |
| ImproverService = suggestion-only | Phase 6 may add auto-apply | ✅ Additive — suggestion service is a precursor to execution service |
| ADR-022 Strategy A/B/C | Phase 6 adds second LLM as agent | ✅ All strategies are compatible with multi-LLM setup |
| G4-AR-001 research (not implementation) | Phase 6 implements the chosen strategy | ✅ Research in Phase 5 unblocks Phase 6 decision |
| Retention analysis (not implementation) | Phase 6 may trigger retention implementation | ✅ Analysis data makes Phase 6 decision evidence-based |
| No new agents | Phase 6 adds routing layer and new LLM agents | ✅ No conflict — Phase 5 doesn't touch agent registry |

**Critical Phase 6 dependency**: ADR-022 (Sprint D) is the PRIMARY gate for Phase 6. Phase 6 cannot safely add a second proposal-capable LLM without the selection strategy defined in ADR-022.

---

## Section 13 — Gate Summary and Success Criteria

### 13.1 Per-Sprint Gate

| Sprint | Gate Criteria | Declared By |
|---|---|---|
| **A** — Metrics | MetricsService exists, all TG-METRICS-* pass, CLI renders, no writes | Architecture Reviewer |
| **B** — Analyzer | AnalyzerService.analyze() pure, all TG-ANALYZER-* pass | Architecture Reviewer |
| **C** — Improver | ImproverService.suggest() sync, all TG-IMPROVER-* pass, no LLM | Architecture Reviewer |
| **D** — Governance | ADR-022 draft complete, strategy matrix complete, G4-AR-001 research deliverable | Architecture Reviewer |
| **E** — Retention | RetentionAnalysis complete + audit-ledger schema (ADR-023) draft + binary recommendation documented + AD-CP03-03 updated | Architecture Reviewer |
| **F** — Governance Enforcement | TG-WRITE-* (3 tests) pass, ADR-024 draft (provenance graph), ADR-025 draft (confidence calibration), AD-003 CI lint enforcement specified | Architecture Reviewer |

### 13.2 Phase 5 ACCEPTED Criteria

Phase 5 ACCEPTED ketika SEMUA gate tertutup DAN:

| Criteria | Verification |
|---|---|
| MetricsSnapshot captures real project data | `opencode evolution metrics` output artifact |
| AnalysisReport identifies at least one pattern (HEALTHY or otherwise) | `opencode evolution analyze` output artifact |
| ImproverService generates ≥0 suggestions (may be empty if HEALTHY) | `opencode evolution improve` output artifact |
| ADR-022 draft exists in DECISIONS.md | grep "ADR-022" in DECISIONS.md |
| ADR-024 draft (Provenance Graph) exists in DECISIONS.md | grep "ADR-024" in DECISIONS.md |
| ADR-025 draft (Confidence Calibration) exists in DECISIONS.md | grep "ADR-025" in DECISIONS.md |
| RetentionAnalysis recommendation + audit-ledger schema documented | Session log entry + ADR-023 draft |
| Write capability invariant: 3 TG-WRITE-* tests pass | Test suite output |
| Phase 1–4 regression: 0 new failures | Full evolution test suite |
| No new storage layer created | grep for "new.*Store\|new.*Registry" in Phase 5 source → 0 |
| AR-004 status: TRIGGERED (was OBSERVED) | Updated ARCHITECTURAL_RISK_WATCHLIST.md |
| AR-005 added: Self-Reinforcement Loop | New risk entry in watchlist |
| AD-003 exit criteria enhanced: CI lint enforcement | Updated ARCHITECTURE_DEBT_REGISTRY.md |

---

## Section 14 — Phase 5 Architecture Diagram

```
╔════════════════════════════════════════════════════════════════╗
║                    PHASE 5 DATA FLOW                           ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  EXISTING STORAGE (read-only from Phase 5)                     ║
║  ┌─────────────────────┐   ┌──────────────────────────┐        ║
║  │   ProposalStore     │   │   ReconciliationLog       │        ║
║  │ .../proposals/*.json│   │ .../reconciliation/*.json │        ║
║  └──────────┬──────────┘   └────────────┬─────────────┘        ║
║             │ via facade                │ via facade            ║
║             └──────────────┬────────────┘                      ║
║                            ▼                                    ║
║              ┌─────────────────────────┐                       ║
║              │    MetricsService        │ Sprint A              ║
║              │  (AC-19: read-only)      │                       ║
║              └────────────┬────────────┘                       ║
║                           │ MetricsSnapshot DTO                 ║
║                           ▼                                     ║
║              ┌─────────────────────────┐                       ║
║              │    AnalyzerService       │ Sprint B              ║
║              │  (pure function)         │                       ║
║              └────────────┬────────────┘                       ║
║                           │ AnalysisReport DTO                  ║
║                           ▼                                     ║
║              ┌─────────────────────────┐                       ║
║              │    ImproverService       │ Sprint C              ║
║              │  (AC-23: suggest-only)   │                       ║
║              └────────────┬────────────┘                       ║
║                           │ ReadonlyArray<Suggestion>           ║
║                           ▼                                     ║
║              ┌─────────────────────────┐                       ║
║              │    CLI Layer             │                       ║
║              │  opencode evolution      │                       ║
║              │  metrics / analyze /     │                       ║
║              │  improve                 │                       ║
║              └─────────────────────────┘                       ║
║                                                                ║
║  PARALLEL RESEARCH TRACKS                                      ║
║  ┌──────────────────────┐  ┌─────────────────────────────┐    ║
║  │  Sprint D             │  │  Sprint E                    │    ║
║  │  G4-AR-001 Research   │  │  Retention Analysis          │    ║
║  │  → ADR-022 DRAFT      │  │  → Binary Recommendation     │    ║
║  └──────────────────────┘  └─────────────────────────────┘    ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

---

## Section 16 — Sprint F: Governance Enforcement (DAFTAR TEMUAN KRITIS)

**Authorization**: Requires Sprint E ACCEPTED (retention analysis provides input to provenance ADR)
**Goal**: Address 3 critical findings from DAFTAR TEMUAN KRITIS that cannot wait for Phase 6.
**Deliverable**: Invariant checker + 2 ADR drafts

---

### 16.1 F-01: Write Capability Enforcement (CR-001)

**Problem**: Single-writer rule (ADR-013, AC-04) hanya enforced via convention. Tidak ada technical enforcement yang mencegah modul non-proposal menulis ke ProposalStore.

**Solution**: Invariant checker di layer akses ProposalStore.

```typescript
// ProposalStore.write() invariant check
// Setiap panggilan write() harus diverifikasi bahwa caller memiliki capability "proposal"
// Mekanisme: capability token yang diteruskan dari AgentManifest ke ProposalStore

// DI ProposalStore.write():
export const write = (proposal: ProposalInput, callerCaps: AgentCapability[]) =>
  Effect.gen(function* () {
    // Invariant: caller harus memiliki capability "proposal"
    if (!callerCaps.includes("proposal")) {
      yield* Effect.die(new InvariantViolationError({
        message: "Write capability invariant violated",
        detail: `Caller does not have 'proposal' capability. Capabilities: ${callerCaps.join(", ")}`,
        proposalId: proposal.id,
      }))
    }

    // ... existing write logic ...
  })
```

**Design decisions**:

| Decision | Choice | Rationale |
|---|---|---|
| Error type | `InvariantViolationError` (new, registered via AD-003) | Berbeda dari `EvolutionStorageError` — ini adalah invariant violation, bukan storage error |
| Enforcement level | Runtime invariant (Effect.die) | Compile-time tidak mungkin karena caller composition tidak diketahui di type level |
| Token type | `AgentCapability[]` (eksisting) | Tidak perlu capability token baru — reuse existing AgentRegistry |
| Testing | TG-WRITE-INVARIANT-ACCEPT + TG-WRITE-INVARIANT-REJECT + TG-WRITE-INVARIANT-MULTI | Unit test + effect test |

**Exit criteria**:

| Gate | Test | Mechanism |
|---|---|---|
| TG-WRITE-INVARIANT-ACCEPT | `ProposalStore.write()` with `proposal` capability → succeeds | Unit test |
| TG-WRITE-INVARIANT-REJECT | `ProposalStore.write()` without `proposal` capability → InvariantViolationError | Unit test |
| TG-WRITE-INVARIANT-MULTI | Multiple capabilities including `proposal` → succeeds | Unit test |
| TG-WRITE-EXISTING-CALLERS | All existing callers (ContextAnalyst) pass `proposal` capability | Path audit |

**ADR**: None needed — this is implementation of existing ADR-013 / AC-04 enforcement.

---

### 16.2 F-02: Decision Provenance Graph ADR (CR-005)

**Problem**: Tidak ada decision lineage tracking. Audit log hanya mencatat output, bukan "dari mana informasi berasal".

**Solution**: ADR-024 — Decision Provenance Graph. Hanya ADR (research), tidak ada implementasi.

**ADR-024 scope**:

```
PROVENANCE GRAPH: ENTITIES

- MemoryNode:     setiap entri Memory.Service yang digunakan sebagai input
- ContextNode:    assembly context yang disusun dari MemoryNodes
- ProposalNode:   proposal yang dihasilkan dari context
- DecisionNode:   keputusan akhir (ACCEPTED/REJECTED) dengan outcome
- AgentExecutionNode: setiap eksekusi agen (input → output)

RELATIONSHIPS:

MemoryNode ──feeds_into──▶ ContextNode
ContextNode ──used_by────▶ AgentExecutionNode (per agent)
AgentExecutionNode ──produces──▶ ProposalNode (jika proposal-capable)
ProposalNode ──feeds_into──▶ DecisionNode

PROPERTIES PER NODE:

Setiap node memiliki:
- id: string (UUID)
- timestamp: number
- sourceLabel: "memory" | "agent" | "user" | "system"
- confidence: number | null (jika tersedia)
- contentHash: string (SHA-256 konten — untuk integrity check tanpa menyimpan konten penuh)

STORAGE:

Terpisah dari ProposalStore — append-only ledger terpisah.
Format: append-only JSONL (setiap baris = satu edge/node event).
```
`);

**Design constraints**:

| Constraint | Detail |
|---|---|
| Storage | Terpisah dari ProposalStore (audit operasional vs provenance graph) |
| Format | Append-only (setiap event ditambahkan, tidak pernah diubah) |
| Performance | Write O(1) — hanya append. Read — via index atau query API |
| Phase 6 implementation | Build query API + visualization |
| GDPR compatibility | Provenance graph menyimpan contentHash, bukan konten — tidak ada PII |

**Exit criteria**:

| Deliverable | Format |
|---|---|
| ADR-024 DRAFT | `docs/evolution/DECISIONS.md` — PROPOSED status |
| Graph schema (entities + relationships) | TypeScript types in ADR |
| Storage format decision | JSONL vs SQLite vs flat files — with trade-offs |
| Phase 6 migration impact | Analysis: what changes needed to adopt provenance graph |

---

### 16.3 F-03: Confidence Calibration Research ADR (CR-002)

**Problem**: `reasoningStrength` ordinal → confidence mapping (LOW=0.2, MEDIUM=0.5, HIGH=0.9) tidak terkalibrasi. Skor dari model berbeda tidak dapat dibandingkan secara adil.

**Solution**: ADR-025 — Confidence Calibration Framework. Hanya ADR (research), tidak ada implementasi.

**Research questions**:

```
Q1: Apakah post-hoc calibration layer diperlukan?
    - Platt scaling: belajar mapping dari raw confidence ke calibrated probability
    - Temperature scaling: satu parameter T yang men-scaling logits
    - Isotonic regression: non-parametric calibration (untuk non-monotonic mappings)

Q2: Bagaimana normalisasi antar-model?
    - Per-model baseline: setiap model memiliki calibration curve sendiri
    - Normalization: calibrated_confidence = f_model(raw_confidence)
    - Tantangan: baseline diperoleh dari data historis — butuh sample size tertentu

Q3: Kapan kalibrasi diterapkan?
    - Hanya untuk cross-model comparison (bukan untuk single-model thresholding)
    - Threshold (minCandidateConfidence) tetap menggunakan raw confidence per-model
    - Reconciliation yang membandingkan confidence antar agent menggunakan calibrated confidence

Q4: Apa impact pada existing reconciliation?
    - Saat ini: confidence DESC, producedAt ASC tiebreak
    - Dengan calibrated: calibrated_confidence DESC (bukan raw confidence DESC)
    - Backward compatibility: system harus bisa fallback ke raw jika calibration data tidak tersedia
```

**Design constraints**:

| Constraint | Detail |
|---|---|
| Scope | ADR hanya — tidak ada implementasi di Phase 5 |
| Existing behavior | Tidak berubah — raw confidence tetap digunakan untuk thresholding |
| Phase 6 adoption | Calibrated confidence hanya aktif di reconciliation layer |
| Data requirement | Minimum 100 proposals per model untuk membangun calibration curve |

**Exit criteria**:

| Deliverable | Format |
|---|---|
| ADR-025 DRAFT | `docs/evolution/DECISIONS.md` — PROPOSED status |
| Calibration technique comparison | Table: Platt vs Temperature vs Isotonic with pros/cons |
| Phase 6 implementation cost | Estimated effort: low/medium/high |
| Data requirement analysis | How many proposals needed per model |

---

### 16.4 Sprint F — New Error Registration

Per AD-003, Sprint F memperkenalkan 1 new error class:

```markdown
## Phase 5 Sprint F Addition

- `InvariantViolationError` — Runtime invariant violation (e.g., non-proposal agent
  attempting to write to ProposalStore). Registered as `Domain` classification.
  Not a storage error — this is an architecture behavior error.
```

Error family grows from 5 → 6 entries.

---

### 16.5 Sprint F Evidence Requirements

| Deliverable | Format | Location |
|---|---|---|
| Write capability invariant | Source code: `proposal-store.ts` | `src/evolution/decision/brain/` |
| Invariant test suite | 3 tests (TG-WRITE-*) | `test/evolution/decision/` |
| ADR-024 DRAFT | Decision lineage graph | `docs/evolution/DECISIONS.md` |
| ADR-025 DRAFT | Confidence calibration framework | `docs/evolution/DECISIONS.md` |
| Error registry update | InvariantViolationError | `ERROR_REGISTRY.md` |
| AD-003 exit criteria update | CI lint enforcement | `ARCHITECTURE_DEBT_REGISTRY.md` |

---

## Section 17 — Updated Architecture Diagram

```
╔════════════════════════════════════════════════════════════════════════╗
║                         PHASE 5 DATA FLOW                             ║
╠════════════════════════════════════════════════════════════════════════╣
║                                                                        ║
║  EXISTING STORAGE (read-only from Phase 5 services)                    ║
║  ┌─────────────────────┐   ┌──────────────────────────┐               ║
║  │   ProposalStore     │   │   ReconciliationLog       │               ║
║  │ .../proposals/*.json│   │ .../reconciliation/*.json │               ║
║  └──────────┬──────────┘   └────────────┬─────────────┘               ║
║             │ via facade                │ via facade                   ║
║             └──────────────┬────────────┘                             ║
║                            ▼                                           ║
║              ┌─────────────────────────┐                              ║
║              │    MetricsService        │ Sprint A                     ║
║              │  (AC-19: read-only)      │                              ║
║              └────────────┬────────────┘                              ║
║                           │ MetricsSnapshot DTO                        ║
║                           ▼                                            ║
║              ┌─────────────────────────┐                              ║
║              │    AnalyzerService       │ Sprint B                     ║
║              │  (pure function)         │                              ║
║              └────────────┬────────────┘                              ║
║                           │ AnalysisReport DTO                         ║
║                           ▼                                            ║
║              ┌─────────────────────────┐                              ║
║              │    ImproverService       │ Sprint C                     ║
║              │  (AC-23: suggest-only)   │                              ║
║              └────────────┬────────────┘                              ║
║                           │ ReadonlyArray<Suggestion>                  ║
║                           ▼                                            ║
║              ┌─────────────────────────┐                              ║
║              │    CLI Layer             │                              ║
║              │  opencode evolution      │                              ║
║              │  metrics / analyze /     │                              ║
║              │  improve                 │                              ║
║              └─────────────────────────┘                              ║
║                                                                        ║
║  PARALLEL RESEARCH & GOVERNANCE TRACKS                                 ║
║  ┌──────────────────────┐  ┌─────────────────────────┐                ║
║  │  Sprint D             │  │  Sprint E                │                ║
║  │  G4-AR-001 Research   │  │  Retention + Audit       │                ║
║  │  → ADR-022 DRAFT      │  │  → ADR-023 Audit Ledger  │                ║
║  └──────────────────────┘  └─────────────────────────┘                ║
║                                                                        ║
║  ┌─────────────────────────────────────────────────────────┐          ║
║  │  Sprint F (GOVERNANCE ENFORCEMENT — NEW)                  │          ║
║  │  F-01: Write Capability Invariant (ProposalStore)        │          ║
║  │  F-02: Decision Provenance ADR-024 (research)            │          ║
║  │  F-03: Confidence Calibration ADR-025 (research)         │          ║
║  │  AD-003: CI lint enforcement exit criteria               │          ║
║  └─────────────────────────────────────────────────────────┘          ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝
```

---

## Section 15 — Token-Optimized Summary for Architecture Reviewer

```
[PRINCIPAL ENGINEER → ARCHITECTURE REVIEWER]

Phase 5 Final Proposal submitted — 6 sprints specified (Sprint F added per DAFTAR TEMUAN KRITIS).

ARCHITECTURAL STANCE:
  Phase 5 = measurement first, suggestion second, governance enforcement before Phase 6.
  No new agents. No new storage. No autonomous execution.

NEW ADRs PROPOSED:
  ADR-020: Metrics Governance (AC-19/20/21/22 — read-only facade access)
  ADR-021: Improver Constraint Model (AC-23/24/25 — suggestion-only, no LLM)
  ADR-024: Decision Provenance Graph (Sprint F — research, not implementation)
  ADR-025: Confidence Calibration Framework (Sprint F — research, not implementation)

OPEN ITEMS DISPOSITION:
  AD-CP03-03 → Sprint E analysis + audit vs retention conflict resolution (CR-003)
  G4-AR-001 → Sprint D research → ADR-022 DRAFT (enable Phase 6)
  AR-004 → TRIGGERED per CR-004 evidence — Sprint C + F memory lifecycle research
  AR-005 → NEW: Self-Reinforcement Feedback Loop (CR-007) — OBSERVED
  CR-001 → Sprint F: Write capability invariant enforcement in ProposalStore
  CR-005 → Sprint F: ADR-024 Decision Provenance Graph (research)
  CR-002 → Sprint F: ADR-025 Confidence Calibration (research)
  CR-008 → AD-003 exit criteria: CI lint enforcement
  DA-FUTURE-02 → Deferred Phase 6 (no new evidence yet)
  TD-001 → Monitored via Sprint A metrics (memory write frequency)

PHASE 6 COMPATIBILITY:
  ADR-022 (Sprint D) + ADR-024 (Sprint F) + ADR-025 (Sprint F) = PRIMARY Gates
  for Phase 6. Cannot add second LLM without selection strategy, provenance graph,
  or calibrated confidence comparison.

REQUEST:
  1. ADR-020 PROPOSED accepted?
  2. ADR-021 PROPOSED accepted?
  3. Sprint A gate criteria (§6.5) sufficient?
  4. Sprint D ADR-022 draft template (§9.3) approved?
  5. Sprint E decision thresholds (§10.2) accepted?
  6. Sprint F scope (§16) approved? (Write invariant + ADR-024 + ADR-025 + AD-003 CI)

Phase 5 implementation begins after Architecture Reviewer confirms.
```

---

*[Principal Engineer — Claude, Anthropic]*
*Ini adalah proposal yang dibangun di atas 17 bulan arsitektur EF-AI.*
*Setiap constraint berasal dari lesson learned Phase 1–4.*
*Setiap metrik didesain untuk menjawab satu pertanyaan nyata.*
*Phase 5 bukan tentang melakukan lebih banyak. Phase 5 tentang memahami apa yang sudah dilakukan.*
*2026-06-18*
