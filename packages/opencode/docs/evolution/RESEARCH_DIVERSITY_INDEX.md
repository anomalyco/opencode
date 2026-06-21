# Diversity Index Research — CR-006, M-09

- **Status**: DRAFT (Sprint A research)
- **Author**: Principal Engineer
- **Date**: 2026-06-18
- **Classification**: Research Document — NOT implementation-ready
- **Motivation**: CR-006 (DAFTAR TEMUAN KRITIS) — false consensus risk; semua agent menerima konteks identik

---

## Problem

Semua agent menerima konteks yang sama (dari context-analyst). Jika konteks bias, semua agent menghasilkan output serupa. Konsensus menjadi ilusi — "false consensus."

**Root cause**: Belum ada mekanisme untuk mengukur seberapa beragam output antar agent, atau mendeteksi ketika agreement lebih tinggi dari yang diharapkan berdasarkan input noise.

## Proposed Solution: M-09 Epistemic Diversity Index

### Metric Design

```typescript
interface DiversityMetrics {
  /**
   * Epistemic Diversity Index (EDI): 0..1
   * 0 = semua agent identik (false consensus)
   * 1 = setiap agent menghasilkan output unik (maximum epistemic diversity)
   */
  edi: number

  /**
   * falseConsensusWarning: true jika EDI < threshold (default 0.3)
   * Menandakan bahwa consensus mungkin palsu — semua agent
   * memberikan output sangat mirip tanpa jaminan kebenaran.
   */
  falseConsensusWarning: boolean

  /**
   * Pairwise similarity matrix — cosine similarity antar proposal
   * Berguna untuk debugging: agent mana yang paling berbeda/sama?
   */
  pairwiseSimilarity: Map<string, Map<string, number>>

  /**
   * Per-agent uniqueness score: 0..1
   * 0 = agent ini copy dari agent lain
   * 1 = agent ini unique
   */
  perAgentUniqueness: Map<string, number>
}
```

### Algorithm (Sketch)

```
INPUT: List of N proposals (each proposal is a string or structured data)
OUTPUT: DiversityMetrics

1. Embed each proposal (TF-IDF or LLM embedding)
2. Compute cosine similarity matrix S[N][N]
3. EDI = 1 - mean(S[i][j] for all i != j)
   [Jika semua proposisi identik, mean similarity = 1, EDI = 0]
   [Jika semua proposisi orthogonal, mean similarity ≈ 0, EDI ≈ 1]
4. falseConsensusWarning = EDI < 0.3
5. perAgentUniqueness[i] = 1 - mean(S[i][j] for all j != i)
6. return { edi, falseConsensusWarning, pairwiseSimilarity, perAgentUniqueness }
```

### Embedding Strategy

Untuk Sprint A prototype (tanpa LLM embedding dependency):

| Strategy | Pros | Cons |
|---|---|---|
| **TF-IDF** | Tanpa dependency eksternal | Tidak tangkap semantic |
| **Jaccard similarity (n-gram)** | Sederhana, cepat | Tidak untuk long text |
| **Skip to LLM embedding** | Akurat | Butuh model provider |

**Recommendation (Sprint A)**: TF-IDF + cosine similarity. Cukup untuk deteksi false consensus flag awal. Upgrade ke LLM embedding di Phase 6.

### falseConsensusWarning di ReconciliationLog

```typescript
interface ReconciliationLogV3 {
  // ... existing fields
  diversityMetrics?: {
    edi: number
    falseConsensusWarning: boolean
  }
}
```

Jika `falseConsensusWarning == true`, reconciliation mempertimbangkan re-run dengan konteks yang divariasikan (Phase 6).

## Integration Points

| Component | Integration |
|---|---|
| **ReconciliationLog** | Tambah field `diversityMetrics` |
| **DecisionEngine.evaluate()** | Compute EDI setelah semua agent selesai |
| **CLI evaluate output** | Tampilkan EDI + warning |
| **Context composer** | Phase 6 — variasi konteks per agent |

## Phase 6 Impact

Diversity Index adalah prasyarat untuk:

- Variasi konteks per-agent (jika EDI rendah, sistem bisa memvariasikan konteks secara otomatis)
- Byzantine consensus (jika 1 agent diverge, sisanya false consensus?)
- Policy-driven re-run (policy: `minEDI: 0.2` → auto re-run jika di bawah threshold)
- Goodhart's Law mitigation (agent tidak bisa "game" EDI mudah)

## Related Documents

- DAFTAR_TEMUAN_KRITIS.md — CR-006
- PHASE5_SPECIFICATION.md §10 (Sprint A — MetricsService)
- ADR-017 (Reconciliation)
- ADR-025 (Confidence Calibration — ECE for per-agent calibration)
- ARCHITECTURAL_RISK_WATCHLIST.md — R-04
