# G4-AR-001: Multi-Proposal-Agent Selection Strategy Research

**Author**: Architecture Reviewer
**Date**: 2026-06-19
**Status**: RESEARCH COMPLETE

## 1. Problem Statement

G4-AR-001 asks: *When >1 agent has `proposal` capability in AgentManifest, how does the system deterministically select which agent's output becomes the formal proposal?*

This scenario does NOT exist in Phase 5. Currently, only 1 agent (`context-analyst`) has `proposal` capability. Two advisors exist with distinct non-overlapping capabilities:

| Agent | Capability |
|---|---|
| `context-analyst` | `proposal` |
| `risk-agent` | `risk-analysis` |
| `planning-agent` | `execution-plan` |

G4-AR-001 is a forward-looking research question. Phase 6 is expected to introduce multi-proposal-agent scenarios.

## 2. Evidence from Sprint A Metrics

### 2.1 Agent Roster (Current)

- **Proposal-capable agents**: 1 (`context-analyst`)
- **Total agents**: 3
- **Capability distribution**: 1:1:1 — each agent owns exactly one unique capability

### 2.2 Confidence Score Data (M-05)

Since only `context-analyst` produces candidates, confidence score distribution across proposal-capable agents cannot be empirically measured. Per-agent confidence scores are recorded in `ReconciliationLog.candidates[]` and `ReconciliationLog.participants[]` — the schema supports per-agent tracking, but with a single generator, cross-agent comparability remains theoretical.

**Available data structure** (schema only, no multi-generator data):
```typescript
interface CandidateSummary {
  agentId: string
  reasoningStrength: "low" | "medium" | "high"
  confidenceScore: number
  selected: boolean
}
```

**Finding**: Confidence score comparability across agent types is **NOT PROVEN** in Phase 5. Strategy C assumes cross-agent confidence scores are comparable — this assumption must be validated in Phase 6 pre-implementation.

### 2.3 Enrichment Correlation (M-06)

Enrichment effect is currently `INSUFFICIENT_DATA` (computed in `AnalyzerService`). Per-proposal enrichment tracking does not exist in the current data model. `ReconciliationLog.participants[]` records who participated but does not link participants to specific proposals.

**Finding**: Enrichment correlation cannot be computed in Phase 5. Strategy evaluation is not informed by enrichment data.

### 2.4 Below-Threshold Rate

Available via `MetricsSnapshot.reconciliationOutcomeCounts.belowThreshold / total`. This data exists per-snapshot and can inform threshold tuning recommendations (used by ImproverService I-01).

## 3. Strategy Comparison Matrix

| Dimension | A: `primaryGenerator` Flag | B: Ordering Rule (First Wins) | C: Expanded Reconciliation |
|---|---|---|---|
| **Predictability** | HIGH — explicit, deterministic, obvious from manifest | MEDIUM — depends on import order, not obvious from code inspection | MEDIUM — depends on LLM confidence scores (non-deterministic) |
| **Flexibility** | LOW — requires manifest change to swap primary generator | MEDIUM — reorder imports to change primary | HIGH — add any proposal agent, system self-organizes via competition |
| **Migration cost** | LOW — additive field, backward compatible | NONE — no schema change needed | NONE — works with existing Phase 4 pipeline today |
| **Risk** | MEDIUM — no auto-fallback if primary underperforms | HIGH — implicit ordering is a hidden contract, easy to break silently | MEDIUM — cross-agent confidence comparability unproven |
| **Phase 6 compatibility** | HIGH — works with multi-model routing, explicit ownership | MEDIUM — routing layer may conflict with first-registered assumption | HIGH — natural multi-agent competition, scales to N agents |
| **Schema change** | YES — new `primaryGenerator?: boolean` field on AgentManifest | NO — purely convention-based | NO — uses existing Phase 4 pipeline unchanged |
| **Validation** | Registry-time — >1 primaryGenerator = error | None — ordering is emergent | Runtime — confidence comparator must handle cross-agent scores |
| **Auto-fallback** | NO — if primary fails, no agent generates proposals | NO — if first agent fails, same result | YES — if one agent fails, others compete (graceful degradation) |
| **Determinism** | FULLY deterministic | Deterministic but fragile (import-order dependent) | Non-deterministic (LLM output varies per run) |

## 4. Tradeoff Analysis per Strategy

### Strategy A: `primaryGenerator` Flag

**Pros:**
- Most explicit and discoverable — manifest file is the single source of truth
- Deterministic and predictable — no surprises at runtime
- Validation error at registry time catches misconfiguration early
- Backward compatible — additive field, no existing code changes
- Works with multi-model routing in Phase 6

**Cons:**
- No auto-fallback — if primary generator underperforms, system has no recovery path
- Requires manifest change to swap — not suitable for dynamic environments
- Only one primary allowed — limits experimentation

### Strategy B: Ordering Rule (First Registered Wins)

**Pros:**
- Zero schema change — no migration cost
- Simple to implement — already works by import ordering
- No validation infrastructure needed

**Cons:**
- Import order is not obvious — hidden contract that breaks silently
- High risk — reordering imports accidentally changes system behavior
- No error on misconfiguration — wrong primary goes undetected
- Phase 6 routing may conflict with first-registered assumption

### Strategy C: Expanded Reconciliation

**Pros:**
- Zero migration cost — works with existing Phase 4 pipeline today
- Graceful degradation — if one agent fails, others still produce candidates
- Self-organizing — add any proposal-capable agent, system adapts
- Natural competition — highest confidence wins, incentivizes quality
- Scales to N agents — no architectural ceiling

**Cons:**
- Non-deterministic — LLM confidence scores vary across runs
- Cross-agent confidence comparability is UNPROVEN — different agent types may produce systematically different confidence distributions
- Potential false consensus — if all agents converge on same flawed reasoning, confidence may be high but quality low (EDI mitigates this but is UNAVAILABLE in Sprint A)

## 5. Phase 6 Impact Analysis

### If Strategy A (primaryGenerator) is chosen:

**Phase 6 changes required:**
1. Add `primaryGenerator?: boolean` to `AgentManifest` type
2. Add registry-time validation: exactly one agent with `primaryGenerator === true`
3. `DecisionEngine` reads `primaryGenerator` flag from manifest to select generator
4. `ProposalStore.submit()` records which agent generated the proposal

**Migration path:**
- Phase 5: no change — single proposal agent continues working
- Phase 6: when second proposal agent is added, the flag determines which is primary
- Safe rollback: set `primaryGenerator` on the original agent, no behavior change

### If Strategy B (Ordering Rule) is chosen:

**Phase 6 changes required:**
1. No schema changes needed
2. Documentation must explicitly declare import-order sensitivity
3. `AgentLayers` must document registration order

**Risk:**
- Import order is not reviewed in code reviews — easy to break
- Phase 6 multi-agent routing may not respect import order
- Recommend NOT choosing this strategy for Phase 6

### If Strategy C (Expanded Reconciliation) is chosen:

**Phase 6 changes required:**
1. No Phase 5 changes needed — pipeline is ready
2. `ProposalCandidate` schema supports per-agent scores already
3. `ConfidenceReconciliationStrategy` selects highest confidence winner
4. Cross-agent confidence calibration may be needed (see §5 open questions)

**Migration path:**
- Phase 5: no change — single proposal agent works identically
- Phase 6: add second proposal agent → both produce candidates → reconciliation selects winner
- Safe rollback: remove second agent → single agent continues

**Open questions for Phase 6:**
- Are confidence scores from different agent types comparable? (e.g., `context-analyst` with a strict schema vs. a creative agent with loose schema)
- What is the confidence calibration mechanism? (standard deviation normalization, per-agent baselines, or raw comparison?)
- Should `DiversityMetrics.EDI` become available to detect false consensus in multi-agent scenarios?

## 6. Decision Criteria

| Question | Answer / Method | Status |
|---|---|---|
| Is Phase 6 adding a second proposal-capable agent? | Architecture Reviewer decision | **TBD** |
| Will the second agent be same-domain or different-domain? | Informs Strategy C viability — same-domain favors Strategy C | **TBD** |
| Is confidence score comparability proven? | NOT PROVEN in Phase 5 — single proposal agent only | **NEEDS PHASE 6 SPIKE** |
| Is ordering rule acceptable as governance? | Team discussion — not data-driven | **TBD** |

## 7. Recommendation

**Strategy C (Expanded Reconciliation) is the recommended default** for Phase 6 based on:

1. **Zero migration cost** — works with the existing Phase 4 pipeline unchanged
2. **Graceful degradation** — single-agent continues working; multi-agent scales naturally
3. **Self-organizing** — no schema change, no registry change, no ordering dependency
4. **Phase 6 compatibility** — natural fit for multi-agent orchestration

**Condition**: Cross-agent confidence comparability must be validated with a Phase 6 spike before full adoption. If comparability cannot be proven, fallback to Strategy A (primaryGenerator flag) with an explicit manifest configuration.

Strategy B (Ordering Rule) is **NOT RECOMMENDED** due to high risk of silent misconfiguration.

---

*This document informed ADR-022 DRAFT. See ADR-022 for the formal decision record.*
