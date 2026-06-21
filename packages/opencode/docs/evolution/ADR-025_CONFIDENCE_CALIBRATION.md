# ADR-025 — Confidence Calibration Framework

- **Status**: DRAFT (Sprint F research)
- **Author**: Principal Engineer
- **Date**: 2026-06-18
- **Classification**: Research ADR — NOT implementation-ready
- **Motivation**: CR-002 (DAFTAR TEMUAN KRITIS) — confidence antar-model LLM tidak sebanding

---

## Problem Statement

Current EF-AI reconciliation selects proposals based on raw confidence scores derived from `SCORING_CONTRACT[reasoningStrength]`. This assumes confidence is comparable across models — an assumption contradicted by research:

> RLHF-tuned models are systematically overconfident. Verbalized confidence has ECE ~0.377 (Tianpan 2026).

Without calibration, a model with naturally higher confidence (e.g., RLHF-tuned GPT) will always dominate reconciliation, regardless of actual decision quality. Multi-agent diversity becomes illusory — the "winner" is determined by model architecture, not proposal merit.

## Current State

### Confidence Flow

```
Agent Output → reasoningStrength ("high"|"medium"|"low")
           → SCORING_CONTRACT → raw confidence (0.9, 0.7, 0.3)
           → ConfidenceReconciliationStrategy.reconcile()
           → winner = highest confidence (with tiebreak by producedAt)
```

### Problems

1. **No cross-model normalization** — `reasoningStrength` is self-reported by each agent. A model that always says "high" wins every round against a model that calibrates honestly.
2. **ECE is unknown** — No metric exists to measure whether confidence matches accuracy.
3. **No calibration data** — No history of "predicted confidence vs actual outcome" to learn from.
4. **G4-AR-001 dependency** — Before selecting between multiple proposal-capable agents, confidence must be calibrated; otherwise selection is meaningless.

## Proposed Solution: Temperature Scaling

Temperature scaling is a post-hoc calibration method with a single learned parameter `T`:

```
P_calibrated(q) = softmax(logits / T)
```

For EF-AI, since we work with ordinal confidence (high/medium/low → 0.9/0.7/0.3), temperature applies at the score level:

```
confidence_calibrated = confidence_raw ^ (1/T)
```

Where `T > 1` reduces overconfidence and `T < 1` increases underconfidence.

### Schema (DRAFT — no implementation)

```typescript
interface CalibrationConfig {
  modelId: string
  temperature: number           // learned scaling parameter
  ece: number                   // Expected Calibration Error
  calibratedAt: number
  calibrationSetSize: number
  lastUpdated: number
}
```

### Learning Procedure

1. Collect `N` proposals with `(predictedConfidence, actualOutcome: ACCEPTED|REJECTED)` pairs.
2. Bucket predictions by confidence decile.
3. Compute ECE = Σ(bucket_size / N) * |accuracy - confidence|.
4. Optimize `T` to minimize ECE via grid search or gradient descent.
5. Store `CalibrationConfig` in a JSON file: `.opencode/evolution/calibration.json`

### Integration with Reconciliation

```typescript
function reconcileWithCalibration(
  candidates: ProposalCandidate[],
  calibration: Map<string, CalibrationConfig>,
): CandidateSelection {
  const calibrated = candidates.map((c) => {
    const config = calibration.get(c.agentId)
    if (!config) return c  // uncalibrated — use raw
    const raw = calcConfidence(c)
    const adjusted = Math.pow(raw, 1 / config.temperature)
    return { ...c, confidenceScore: adjusted }
  })
  return ConfidenceReconciliationStrategy.reconcile(calibrated, options)
}
```

## Implementation Boundaries

| Aspect | Decision |
|---|---|
| **Research** | ✅ Sprint F — this document is the deliverable |
| **Code** | ❌ NO implementation until Phase 6 (>1 active model) |
| **Schema** | ✅ Define in spec, NOT implement until ADR accepted |
| **Storage** | Single JSON file, not database — calibration is global, not per-instance |
| **Learning** | Manual trigger (CLI command) or periodic — never automatic in Phase 5 |
| **Integration** | Wraps `ConfidenceReconciliationStrategy` — no changes to existing reconciliation |

## Risks

| Risk | Detail | Mitigation |
|---|---|---|
| **R-NEW-01: Confidence Drift** | `T` calibrated for model v1.0 becomes invalid after model update to v2.0 | Timestamp every calibration; flag if >30 days since last update |
| **Small calibration set** | ECE unreliable with <20 samples | Minimum calibration set size of 50 proposals |
| **Goodhart's Law** | Agents learn to game confidence after calibration is deployed | Keep calibration blind to agent training process |

## Phase 6 Impact

Confidence calibration is a **prerequisite** for multi-model reconciliation (Phase 6). Without it:

- Agent selection degrades to "who talks loudest wins"
- Byzantine fault detection cannot distinguish genuine confidence from adversarial overconfidence
- G4-AR-001 (multiple proposal-capable agents) has no meaningful selection strategy

## Related Documents

- PHASE5_SPECIFICATION.md §16 (Sprint F)
- CR-002 (DAFTAR TEMUAN KRITIS)
- ADR-017 (Reconciliation Authority — confidence-based selection)
- ADR-024 (Decision Provenance — lineage for calibration set mining)
- ARCHITECTURE_DEBT_REGISTRY.md (CR-002 entry)
- EF-AI_STATE.md (G4-AR-001 — multi-agent selection research)
