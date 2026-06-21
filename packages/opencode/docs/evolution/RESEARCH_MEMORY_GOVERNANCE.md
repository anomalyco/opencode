# Memory Governance Research — CR-004, AR-004

- **Status**: DRAFT (Sprint C+F research)
- **Author**: Principal Engineer
- **Date**: 2026-06-18
- **Classification**: Research Document — NOT implementation-ready
- **Motivation**: CR-004 (DAFTAR TEMUAN KRITIS) — memory poisoning risk tanpa mitigasi; AR-004 TRIGGERED

---

## Problem

Current memory system stores entries indefinitely without:

- Source verification — siapa yang menulis memori?
- Confidence/trust score — seberapa percaya kita pada kebenarannya?
- Decay mechanism — apakah memori lama kurang relevan?
- Contradiction detection — apakah memori baru bertentangan dengan yang sudah ada?
- Age-based deprecation — kapan memori harus dihapus?

Tanpa mitigasi ini, satu entri memori yang keliru bisa membelokkan konteks dan proposal secara kumulatif.

## Proposed Mitigations

### M-01: memorySource Field

Tambahkan field `source` pada setiap MemoryEntry:

```typescript
type MemorySource =
  | { type: "human"; userId: string }
  | { type: "agent"; agentId: string }
  | { type: "system"; reason: string }
  | { type: "llm"; modelId: string; sessionId: string }

interface MemoryEntry {
  // ... existing fields
  source: MemorySource
}
```

**Tujuan**: Setiap memori bisa ditelusuri asalnya. Self-generated memory (dari agent/sistem sendiri) bisa diberi bobot lebih rendah daripada memory dari human.

### M-02: Confidence Decay

```typescript
function effectiveConfidence(
  entry: MemoryEntry,
  now: number,
  halfLifeMs: number = 30 * 24 * 60 * 60 * 1000,  // 30 days
): number {
  const age = now - entry.created
  return entry.confidence * Math.pow(0.5, age / halfLifeMs)
}
```

**Tujuan**: Memori lama secara otomatis kurang berpengaruh. Confidence decay bukan penghapusan — memori tetap ada, hanya bobotnya berkurang.

### M-03: Periodic Verification Flag

```typescript
interface MemoryVerification {
  memoryId: string
  lastVerified: number
  verifiedBy: string    // agentId or "human"
  verificationCount: number
  isStale: boolean      // true if not verified in >90 days
}
```

**Tujuan**: Memori yang tidak diverifikasi dalam periode tertentu ditandai sebagai `stale` dan tidak dimasukkan ke konteks.

### M-04: Contradiction Warning

Deteksi implisit: jika memori baru menentang memori yang sudah ada dengan confidence tinggi, sistem memberikan warning di ReconciliationLog.

Tidak perlu semantic engine — cukup flag kontradiksi berbasis tag/key overlap dengan opposite sentiment.

## Integration Points

| Mitigation | Integration | Effort |
|---|---|---|
| memorySource | MemoryEntry schema + `save()` parameter | Rendah (schema change) |
| Confidence decay | Context composer — filter/bobot memori berdasarkan age | Rendah |
| Verification flag | Memory summarize + compact | Sedang |
| Contradiction warning | ReconciliationLog enrichment | Rendah |

## Phase 6 Impact

Memory governance adalah prasyarat untuk:

- Self-improvement loop yang aman (tanpa poisoning loop)
- Multi-agent memory sharing (agent bisa percaya memori dari agent lain?)
- Auto-execute (sistem harus bisa percaya memorinya sendiri)

## Related Documents

- DAFTAR_TEMUAN_KRITIS.md — CR-004
- ARCHITECTURAL_RISK_WATCHLIST.md — AR-004 (TRIGGERED)
- PHASE5_SPECIFICATION.md §11 (Sprint C) + §16 (Sprint F)
- ADR-014 (Memory Agents)
