# ADR-023 — Audit Ledger Schema (Audit vs Retention Separation)

- **Status**: ACCEPTED (Sprint F — implemented)
- **Author**: Principal Engineer
- **Date**: 2026-06-18
- **Classification**: Implementation ADR
- **Motivation**: CR-003 (DAFTAR TEMUAN KRITIS) — konflik antara audit trail immutability dan retention policy

---

## Problem

ProposalStore saat ini menjalankan dua fungsi yang saling bertentangan:

| Fungsi | Requirement | Konflik |
|---|---|---|
| **Audit Trail** | Append-only, tidak boleh diubah/dihapus, disimpan bertahun-tahun | Immutability |
| **Operational Store** | Boleh dihapus setelah masa retensi, query cepat, ukuran terbatas | Deletion |

Satu store tidak bisa memenuhi keduanya. Mempertahankan status quo berarti:

- Jika dihapus → jejak audit hilang, compliance failure
- Jika simpan semua → ukuran membengkak, operational query lambat
- Jika kompromi (soft-delete) → tidak ada yang optimal

## Proposed Solution: Dual-Store Separation

```
┌─────────────────────┐     ┌──────────────────────┐
│  Audit Ledger       │     │  Operational Store   │
│  (append-only)      │     │  (retention policy)  │
├─────────────────────┤     ├──────────────────────┤
│ - All proposals     │     │ - Active proposals   │
│ - All reconciliations│    │ - Recent decisions   │
│ - All status changes│     │ - Query-optimized    │
│ - Immutable JSONL   │     │ - Mutable JSON files │
│ - NEVER delete      │     │ - Retention: TTL     │
└─────────────────────┘     └──────────────────────┘
        │                            │
        └─────────── Sync ───────────┘
               (one-way: ledger ← operational)
```

### Audit Ledger Schema (DRAFT)

```typescript
interface AuditRecord {
  id: string
  type: "proposal_submit" | "proposal_update" | "reconciliation" | "rejection"
  timestamp: number
  data: AuditPayload
  previousHash?: string     // hash chain integrity
  hash: string              // SHA-256 of (previousHash + timestamp + JSON(data))
}

type AuditPayload =
  | { proposalId: string; status: ProposalStatus; origin: ProposalOrigin }
  | { reconciliationId: string; candidates: string[]; winner: string }
  | { rejectionId: string; code: RejectionCode; reason: string }
```

### Operational Store Changes

- Current `ProposalStore` tetap sebagai operational store
- Hanya menyimpan proposal ACTIVE (SUBMITTED, VALIDATING, ACCEPTED terbaru)
- REJECTED proposal dipindahkan ke Audit Ledger lalu dihapus dari operational
- Retention TTL dikonfigurasi via `evolution.retention.proposalDays` (default: 90 hari)

### Hash Chain Integrity

```
Block N-1: { hash: "abc", ... }
Block N:   { previousHash: "abc", hash: "def", ... }
Block N+1: { previousHash: "def", hash: "ghi", ... }
```

Memungkinkan deteksi modifikasi: jika `Block N` diubah, hash `Block N+1` tidak match.

## Implementation Boundaries

| Aspect | Decision |
|---|---|
| **Research** | ✅ Sprint E — this document is the deliverable |
| **Code** | ❌ NO implementation until Sprint E analysis complete |
| **Storage** | JSONL file: `.opencode/evolution/audit/audit.jsonl` |
| **Write timing** | Sama dengan AC-17 boundary — ditulis SEBELUM proposal submit |
| **Read API** | Read-only — `AuditLedger.query({ type, timeRange, proposalId })` |
| **Retention** | Config-driven — `evolution.retention.auditDays` (default: 7 tahun compliance) |
| **Migration** | Existing proposals tidak perlu migrasi — ledger mulai dari implementasi |

## Risks and Mitigations

| Risk | Detail | Mitigation |
|---|---|---|
| **Dual-write consistency** | Ledger dan operational store bisa out of sync | Write operational → ledger in sequence; if ledger fails, rollback operational |
| **Hash chain performance** | SHA-256 setiap write untuk ribuan proposal | Hash chain per batch (misal per 100 records) |
| **Storage growth** | 7 tahun audit data bisa besar | Compressed JSONL, cold storage untuk data >1 tahun |
| **CR-003 resolution** | Konflik audit vs retention fully resolved | ✅ Dual-store pattern — masing-masing fungsi punya store sendiri |

## Implementation (Sprint F)

### Dual-Store Verification

| Store | Path | Immutability | Cleanup |
|---|---|---|---|
| **Audit Ledger** | `.opencode/evolution/audit/audit.jsonl` | ✅ Append-only, hash-chain integrity | ❌ Never deleted |
| **Proposal Store** | `.opencode/evolution/proposals/` | ❌ Mutable (status updates) | ✅ GC via `retention.proposalDays` (default 90) |
| **Reconciliation Logs** | `.opencode/evolution/reconciliation/` | ❌ Mutable (submissionStatus update) | ✅ TTL cleanup (default 90 days) |

### TTL Constraint

**Reconciliation log TTL default: 90 days (minimum).**

This is NOT an arbitrary number. ADR-025 (Confidence Calibration) requires a minimum of 100 proposals per model to build a reliable calibration curve. If reconciliation logs are cleaned aggressively (e.g., 7-day TTL), Phase 6 will not have sufficient historical data for temperature scaling.

The 90-day default ensures at least:
- ~300 proposals (at 1/day) — sufficient for calibration
- 3+ data points per acceptance rate quintile — minimum for ECE computation
- Buffer for delayed analysis (e.g., retrospective model comparison)

Configurable via `evolution.retention.proposalDays` (shared with proposal GC). Setting this to `0` disables all cleanup.

## Phase 6 Impact

Audit Ledger adalah prasyarat untuk:

- Regulatory compliance (multi-year immutable audit trail)
- Decision Provenance Graph (ADR-024) sebagai consumer ledger data
- Byzantine fault detection (audit trail sebagai source of truth)
- Self-improvement loop verification (Phase 5 metrics membutuhkan historical data)

## Related Documents

- DAFTAR_TEMUAN_KRITIS.md — CR-003
- PHASE5_SPECIFICATION.md §13 (Sprint E)
- ADR-024 (Decision Provenance — consumer audit data)
- ARCHITECTURE_DEBT_REGISTRY.md (AD-CP03-03)
- PHASE4_SPECIFICATION.md (ProposalStore sebagai audit trail)
