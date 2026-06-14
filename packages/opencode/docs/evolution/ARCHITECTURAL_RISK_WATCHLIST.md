# Architectural Risk Watchlist

**Purpose**: Track architectural risks that are not yet demonstrated as debt.
**Not**: Architecture debt registry, bug tracker, or feature backlog.

**Rule**: Risk becomes Architecture Debt (promoted to ARCHITECTURE_DEBT_REGISTRY.md) only when:
1. Evidence exists that the risk is materializing.
2. Impact is demonstrated (not hypothetical).
3. Mitigation requires architectural work (not just code change).

Until all three criteria are met, the item remains in this watchlist.

**Maintained**: 2026-06-13
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
| **Status** | OBSERVED |
| **Created** | 2026-06-12 |
| **Last Reviewed** | 2026-06-13 |
| **Owner Type** | Architecture |

**Current Evidence**: Memory.Service stores all entries without evaluation. No confidence scoring, no decay, no validation. Theoretical risk of feedback degradation loop — entry with outdated lesson remains indefinitely. *No demonstrated incident of harm yet.*

**Trigger Condition** (any of):
- Observed incident of memory poisoning (AI makes decision based on stale/incorrect memory)
- Manual audit finds entry contradicting current project state
- Phase 5 (Self Improvement) design starts

**Promotion Criteria** (all must be met):
- Demonstrated incident of memory-caused incorrect behavior
- Evidence that manual correction is insufficient

**Mitigation**: Full spec in DECISIONS.md AD-002. Target Phase 5.

**Evidence Strength**: LOW (hypothetical risk, no observed incident)

---

## Index

| ID | Title | Status | Target Visibility |
|---|---|---|---|
| AR-001 | Evolution.Service God Object | OBSERVED | Phase 2+ |
| AR-002 | Context Explosion | OBSERVED | Phase 3+ |
| AR-003 | Agent Explosion | OBSERVED | Phase 4+ |
| AR-004 | Memory Governance Degradation | OBSERVED | Phase 5 |
