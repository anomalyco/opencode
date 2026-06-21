# Architectural Risk Watchlist

**Purpose**: Track architectural risks that are not yet demonstrated as debt.
**Not**: Architecture debt registry, bug tracker, or feature backlog.

**Rule**: Risk becomes Architecture Debt (promoted to ARCHITECTURE_DEBT_REGISTRY.md) only when:
1. Evidence exists that the risk is materializing.
2. Impact is demonstrated (not hypothetical).
3. Mitigation requires architectural work (not just code change).

Until all three criteria are met, the item remains in this watchlist.

**Maintained**: 2026-06-18 (Phase 4 closeout — G4 Evidence Gate ACCEPTED; AR-003 trigger condition met)
**Owner**: Architecture

---

## Risk Lifecycle

| Status | Meaning |
|---|---|
| OBSERVED | Pattern identified, no evidence of harm yet |
| MONITORING | Active observation — specific triggers defined |
| TRIGGERED | Evidence of impact detected — escalation pending |
| PROMOTED | Moved to ARCHITECTURE_DEBT_REGISTRY.md |

---

## AR-001 — Evolution.Service God Object Risk

| Field | Value |
|---|---|
| **Title** | Evolution.Service God Object Risk |
| **Status** | OBSERVED |
| **Created** | 2026-06-13 |
| **Last Reviewed** | 2026-06-13 |
| **Owner Type** | Architecture |

**Current Evidence**: Evolution.Service starts with 5 methods and 3 sub-domains. Each Phase adds more. Trajectory without intervention leads to God Service.

**Trigger Condition** (any of):
- Interface exceeds 8 methods without facade registry refactor
- Business logic accumulates in facade (method body >30 lines that is not delegation)
- Phase 2 adds methods directly to Evolution.Service instead of creating new Service classes

**Promotion Criteria** (all must be met):
- Demonstrated architectural impact: a consumer depends on Evolution.Service for non-routing concerns
- Evidence that facade registry pattern would reduce coupling

**Mitigation**: Follow God Object Prevention Rules in PHASE2_PRECONDITIONS.md. Each new domain = new Service class.

---

## AR-002 — Context Explosion Risk

| Field | Value |
|---|---|
| **Title** | Context Explosion Risk |
| **Status** | OBSERVED |
| **Created** | 2026-06-13 |
| **Last Reviewed** | 2026-06-13 |
| **Owner Type** | Architecture |

**Current Evidence**: Phase 2 introduces Context Intelligence. Phase 3 introduces Decision Engine. Each new domain adds context overhead. Without context governance, the system prompt grows unbounded.

**Trigger Condition** (any of):
- Context assembly exceeds 50% of LLM token budget
- Two or more domains compete for the same context slot
- Context assembly logic requires knowledge of 3+ domains

**Promotion Criteria** (all must be met):
- Demonstrated context budget violation in production-like test
- Evidence that no simple configuration fix exists

**Mitigation**: EvolutionContext typed object (ADR-004). Budget tracking at assembly point. Domain boundaries enforced at context composition.

---

## AR-003 — Agent Explosion Risk

| Field | Value |
|---|---|
| **Title** | Agent Explosion Risk |
| **Status** | OBSERVED |
| **Created** | 2026-06-13 |
| **Last Reviewed** | 2026-06-13 |
| **Owner Type** | Architecture |

**Current Evidence**: Phase 4+ envisions multiple agents. Without routing governance, each agent grows independently with overlapping capabilities and inconsistent boundaries.

**Trigger Condition** (any of):
- Two or more agents share implementation dependencies
- Agent routing requires knowledge of agent internals
- Agent creation is ungoverned (no registry, no interface contract)

**Promotion Criteria** (all must be met):
- At least two agents exist in codebase
- Evidence of capability overlap or dependency conflict

**Mitigation**: Deferred to Phase 4 design. Watchlist ensures awareness during Phase 2-3 decisions.

---

## AR-004 — Memory Governance Degradation

| Field | Value |
|---|---|
| **Title** | Memory Governance / Anti-Degradation |
| **Status** | **MONITORING** (mitigations implemented 2026-06-19) |
| **Created** | 2026-06-12 |
| **Last Reviewed** | 2026-06-19 (AR-004 full implementation) |
| **Owner Type** | Architecture |

**Current Evidence**: Memory.Service previously stored all entries without evaluation. AR-004 implementation (2026-06-19) adds: confidence decay integration in context composition, stale memory exclusion via `isStale()` + verification flag, anomaly detection (`detectAnomalies()`), verification workflow (`verify()`), and CLI `opencode evolution memory`. *No demonstrated incident of harm in EF-AI production yet.*

**Trigger Condition** (any of — all confirmed as of 2026-06-19):
- ✅ Observed incident of memory poisoning (AI makes decision based on stale/incorrect memory) — External evidence confirms this as OWASP Top Risk 2026. Mitigations now in place.
- Manual audit finds entry contradicting current project state
- ✅ Phase 5 implementation triggers design — **COMPLETE** (all mitigations implemented)

**Promotion Criteria** (all must be met — NOT YET):
- [ ] Demonstrated incident of memory-caused incorrect behavior in EF-AI
- [ ] Evidence that manual correction is insufficient

**Mitigations implemented** (2026-06-19):
1. **M-01: memorySource** (Sprint C) — `MemorySource` type on every `MemoryEntry` (human/agent/system/llm).
2. **M-02: Confidence decay** (`effectiveConfidence()`) — exponential half-life decay (30d default). Now integrated into context composition: `retriever.ts` sorts by confidence; `composer.ts` processes confidence-ordered entries.
3. **M-03: Verification flag** — `verifiedAt`, `verificationCount` on `MemoryEntry`. `isStale()` marks entries unverified in >90 days. `verify(memoryId)` method. Stale entries excluded from context. Configurable via `staleThresholdDays` in `InfoEvolutionSchema`.
4. **M-04: Anomaly detection** — `detectAnomalies()` flags low-confidence (<0.3) and self-referential duplicate entries.
5. **CLI** — `opencode evolution memory` subcommand lists entries with confidence/source/stale status plus anomaly warnings.
6. **Context output** — Provider includes `(c:N.N, src:type)` indicators per memory line.

**Evidence Strength**: MEDIUM (external evidence confirms risk, but no EF-AI-specific incident)

---

## ARCH-WATCH-P3-01 — ProposalStore Retention Strategy Undefined

| Field | Value |
|---|---|
| **Title** | ProposalStore Retention Strategy Undefined |
| **Status** | OBSERVED |
| **Created** | 2026-06-16 |
| **Owner Type** | Architecture |

**Context**: ProposalStore accumulates ALL proposals in ALL states (SUBMITTED, VALIDATING, ACCEPTED, REJECTED). ProposalStore uses per-project persistent files (`.opencode/evolution/proposals/{id}.json` — same pattern as existing ADR storage in `brain/decisions.ts`). Files persist on disk across sessions. `listByStatus()` reads ALL files and filters in-memory (O(n)).

No explicit strategy exists for:
- When proposals are cleaned up
- Who performs cleanup
- Whether ACCEPTED proposals are included in cleanup
- Whether REJECTED proposals are included in cleanup
- Whether cleanup is time-based, count-based, or event-based

**Key resolution**: This is NOT a per-session store. ProposalStore uses per-project persistent files (like current ADR storage). The risk is about CROSS-SESSION accumulation, not within-session growth. Phase 3 bounded writes (TD-001: max 50 memories) keep per-session volume manageable, but REJECTED proposals accumulate across sessions with no cleanup.

**Audit trail clarification**: ProposalStore IS the audit trail. There is no separate audit store. `listByStatus()` provides complete proposal history. This means cleanup of old proposals would also affect audit trail — a design tension that must be resolved in Phase 5.

**Trigger Condition** (any of):
- ProposalStore exceeds 10,000 entries across all sessions
- I/O latency from reading all proposal files exceeds 500ms
- Phase 5 persistent proposal history design starts

**Promotion Criteria** (all must be met):
- Demonstrated storage growth impact (I/O latency, memory pressure)
- Evidence that per-project persistent files are insufficient

**Mitigation**: Deferred to Phase 5 design. Phase 3 per-project persistence is acceptable for expected Phase 3 volume (single-agent, bounded decisions per session). Document retention strategy requirement in ARCHITECTURE_DEBT_REGISTRY.md when Phase 5 begins. See AD-CP03-03 for architecture debt tracking.

---

## DA-FUTURE-02 — Contradiction Logic Evolution

| Field | Value |
|---|---|
| **Title** | Contradiction Logic Evolution |
| **Status** | OBSERVED |
| **Created** | 2026-06-16 |
| **Owner Type** | Architecture |

**Context**: Phase 3 contradiction detection uses KEY-BASED matching and tag-set overlap threshold. This is sufficient for single-agent Phase 3 but insufficient for multi-agent environments (Phase 4+) where semantic contradiction detection is required.

Tag overlap ≠ semantic contradiction — two proposals can share tags without contradicting, or contradict without sharing tags.

**Trigger Condition** (any of):
- Two or more agents exist in codebase
- Observed missed contradiction — proposals that semantically conflict but pass tag-based check
- Phase 4 agent orchestration design starts

**Promotion Criteria** (all must be met):
- Demonstrated missed contradiction incident
- Evidence that KEY-BASED + tag overlap is insufficient

**Mitigation**: Deferred to Phase 4 design. Phase 3 KEY-BASED + tag overlap is acceptable for single-agent scope. Document requirement for semantic contradiction detection in Phase 4 spec.

---

## AR-005 — Self-Reinforcement Feedback Loop

| Field | Value |
|---|---|
| **Title** | Self-Reinforcement Feedback Loop |
| **Status** | OBSERVED |
| **Created** | 2026-06-18 |
| **Last Reviewed** | 2026-06-18 |
| **Owner Type** | Architecture |

**Source**: DAFTAR TEMUAN KRITIS CR-007.

**Context**: Improver Service (Phase 5) produces read-only suggestions — no auto-execute yet. However, the roadmap includes future capability for the system to feed its own output back into memory and context. Without source-label separation (self-generated vs external), the system can create a feedback loop where its own output reinforces its own biases — a form of automated confirmation bias (knowledge collapse).

**Current Evidence**: No source separation exists for self-generated vs external memory. Improver is currently read-only (AC-23), which limits immediate risk. The risk materializes when auto-execute is introduced (Phase 6).

**Trigger Condition** (any of):
- Improver Service is changed from suggestion-only to auto-execute (Phase 6 design starts)
- Observed incident of circular reasoning (system references its own earlier output as evidence)
- Manual audit finds a chain of 3+ self-referential memory entries

**Promotion Criteria** (all must be met):
- Demonstrated incident where self-reinforcement caused incorrect behavior
- Evidence that manual intervention could not break the cycle
- Auto-execute feature is in active design or implementation

**Mitigation**: Require `memorySource` field on every memory entry (self_generated vs external vs mixed vs unknown) before auto-execute is enabled. Phase 5 Sprint C introduces this field in Suggestion. Phase 5 Sprint F ADR-024 provenance graph includes node source labels.

---

## ARCH-WATCH-P5-01 — Governance Debt Accumulation (R-NEW-05)

| Field | Value |
|---|---|
| **Title** | Governance Debt Accumulation |
| **Status** | OBSERVED |
| **Created** | 2026-06-18 |
| **Related** | R-NEW-05 from DAFTAR TEMUAN KRITIS |

**Context**: Jumlah ADR, AC, dan kebijakan arsitektur bertambah setiap phase. Tanpa deprecation mechanism, dokumen lama dan baru bisa saling bertentangan. Risiko meningkat seiring jumlah ADR > 25.

**Trigger Condition** (any of):
- ADR count exceeds 25
- Two or more ADRs are found to have contradictory statements
- Phase 6 design starts (expected to add 3+ new ADRs)

**Promotion Criteria** (all must be met):
- Demonstrated contradiction between active ADRs
- Evidence that manual resolution is insufficient

**Mitigation**: Establish ADR deprecation policy: every new ADR must declare which prior ADR it supersedes (if any). Phase 6 pre-requisite.

---

## ARCH-WATCH-P5-02 — Constraint Drift (R-NEW-06)

| Field | Value |
|---|---|
| **Title** | Constraint Drift |
| **Status** | OBSERVED |
| **Created** | 2026-06-18 |
| **Related** | R-NEW-06 from DAFTAR TEMUAN KRITIS |

**Context**: AC-01 through AC-25 defined across 5 phases. New ACs may contradict older ACs without detection. Currently relies on manual audit. No automated invariant-checking tool.

**Trigger Condition** (any of):
- AC count exceeds 30
- Two or more ACs are found to have logical conflict
- A Phase 6 AC is added that contradicts an existing Phase 1-5 AC

**Promotion Criteria** (all must be met):
- Demonstrated AC conflict that caused incorrect system behavior
- Evidence that manual review missed the conflict

**Mitigation**: Introduce AC cross-reference requirement: every new AC must declare which existing ACs it relates to. Phase 6 pre-requisite.

---

## Index

| ID | Title | Status | Target Visibility |
|---|---|---|---|---|
| AR-001 | Evolution.Service God Object | OBSERVED | Phase 2+ |
| AR-002 | Context Explosion | OBSERVED | Phase 3+ |
| AR-003 | Agent Explosion | OBSERVED | Phase 4+ |
| AR-004 | Memory Governance Degradation | **TRIGGERED** | Phase 5 |
| AR-005 | Self-Reinforcement Feedback Loop | OBSERVED | Phase 6 |
| ARCH-WATCH-P3-01 | ProposalStore Retention Strategy | OBSERVED | Phase 5 |
| ARCH-WATCH-P5-01 | Governance Debt Accumulation | OBSERVED | Phase 6 |
| ARCH-WATCH-P5-02 | Constraint Drift | OBSERVED | Phase 6 |
| DA-FUTURE-02 | Contradiction Logic Evolution | OBSERVED | Phase 4+ |
