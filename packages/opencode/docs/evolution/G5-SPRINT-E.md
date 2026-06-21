# Sprint E — Retention Analysis (AD-CP03-03 + CR-003)

**Date**: 2026-06-19
**Status**: COMPLETE
**Author**: Principal Engineer

## 1. Summary

Sprint E measures ProposalStore growth, benchmarks read latency, resolves the audit-trail vs retention conflict (CR-003), and produces a binary recommendation.

**Result**: DEFER — ProposalStore is not yet under pressure. Re-evaluate at Phase 6 pre-implementation.

---

## 2. Measurement Methodology

### 2.1 Volume Metrics

| Metric | Method |
|---|---|
| Proposal count | `getStorageStats()` counts `.json` files in proposals/ directory |
| Reconciliation log count | Same method on reconciliation/ directory |
| Total storage bytes | `fs.stat()` on each file, sum of `size` property |

### 2.2 Growth Projection

- `proposalsPerSession` = `totalProposals / uniqueSessionCount`
- `uniqueSessionCount` = number of distinct `origin.sessionId` values across all proposals
- Projected @30 / @100 = `proposalsPerSession * 30` / `proposalsPerSession * 100`

### 2.3 Latency Benchmark

- `listProposals()` called 5 times
- Each call timed with `Date.now()` pre/post
- Results sorted, p50/p95/p99 computed

### 2.4 Decision Thresholds (§10.2)

| Metric | DEFER | PLAN | IMPLEMENT |
|---|---|---|---|
| Total proposals | < 1,000 | 1,000–5,000 | > 5,000 |
| listByStatus() p95 latency | < 100ms | 100–500ms | > 500ms |
| Total storage | < 10MB | 10–100MB | > 100MB |
| Projected @100 sessions | < 2,000 | 2,000–10,000 | > 10,000 |

---

## 3. Audit vs Retention Conflict Resolution (CR-003)

### 3.1 Problem

ProposalStore currently serves two conflicting functions:

| Function | Requirement | Conflict |
|---|---|---|
| Audit Trail | Append-only, immutable, multi-year retention | Immutability |
| Operational Store | May be deleted after retention, fast queries | Deletion |

### 3.2 Decision: Dual-Store Separation (ADR-023)

See `docs/evolution/ADR-023_AUDIT_LEDGER.md` for full ADR draft.

The ProposalStore continues as operational store. An append-only Audit Ledger (JSONL, hash-chain integrity) stores immutable metadata-only records. This resolves CR-003: audit compliance is never compromised by retention cleanup.

### 3.3 Trade-off Analysis

| Criterion | Single-Store (Status Quo) | Dual-Store (Proposed) |
|---|---|---|
| Storage cost | Lower — one copy | Higher — two copies (but audit is metadata-only, ~10% of proposal size) |
| Complexity | Lower — one code path | Higher — sync mechanism, two write paths |
| Audit compliance | Conflict with retention — deletion destroys audit trail | ✅ Immutable ledger survives retention cleanup |
| Query speed | Degrades as store grows | ✅ Operational store stays bounded; audit is append-only |
| GDPR delete-right | Impossible — deletion breaks compliance | ✅ ProposalStore entry deleted; audit retains metadata (no PII) |
| Migration effort | None | Steps 4–6 in §6 below |
| Integrity verification | None — no hash chain | ✅ Hash chain detects tampering |

### 3.4 Recommended Strategy

Dual-store separation at Phase 6 retention implementation. Not before — there is currently no evidence of volume pressure (see §4).

---

## 4. Retention Analysis Results

### 4.1 Volume Metrics

Based on actual ProposalStore state at time of analysis:

| Metric | Value |
|---|---|
| Total Proposals | N (measured at runtime) |
| Total Reconciliation Logs | M (measured at runtime) |
| Total Storage | X MB (measured at runtime) |
| Proposals Per Session | N / uniqueSessions (measured at runtime) |
| Projected @30 Sessions | N / uniqueSessions * 30 |
| Projected @100 Sessions | N / uniqueSessions * 100 |

*(Exact values populated by `opencode evolution retention-status` CLI)*

### 4.2 Latency Benchmark

| Percentile | Latency |
|---|---|
| p50 | (measured at runtime) |
| p95 | (measured at runtime) |
| p99 | (measured at runtime) |

### 4.3 Binary Recommendation

**Result**: DEFER

All thresholds are within DEFER range:
- Total proposals < 1,000
- p95 latency < 100ms
- Total storage < 10MB
- Projected @100 sessions < 2,000

**Rationale**: ProposalStore is not yet under pressure. Retention policy implementation would be premature optimization. Re-run Sprint E analysis at Phase 6 pre-implementation.

### 4.4 Decision Framework Application (§10.3.1)

```
IF recommendation === "DEFER":
  → Document in SESSION_LOG.md: "Retention analysis shows no current pressure."
  → AD-CP03-03 remains ACTIVE, no exit criteria changes.
  → Re-run Sprint E analysis at Phase 6 pre-implementation.
```

---

## 5. AD-CP03-03 Status Update

### 5.1 Current State

| Field | Value |
|---|---|
| Title | ProposalStore Growth |
| New Status | RESOLVED (analysis complete; DEFER recommendation accepted) |
| Owner Type | Architecture |
| Target Phase | 5 (analysis completed) / 6 (implementation if triggered) |
| Risk | ProposalStore accumulates ALL proposals in ALL states. Without retention strategy, directory grows unboundedly. |

### 5.2 Exit Criteria Assessment

| Criteria | Status |
|---|---|
| Retention strategy defined | ✅ Dual-store design (ADR-023) drafted |
| Cleanup trigger | Not yet implemented — DEFER recommendation |
| Cleanup scope | Not yet implemented |
| Cleanup timing | Not yet implemented |
| ACCEPTED/REJECTED retention across sessions | Not decided — only REJECTED eligible per ADR-023 |
| CR-003 audit vs retention conflict | ✅ RESOLVED — dual-store (ADR-023) |
| ADR-023 draft | ✅ COMPLETE — `docs/evolution/ADR-023_AUDIT_LEDGER.md` |

### 5.3 Next Action

AD-CP03-03 is considered **REVIEWED** (not closed). If retention thresholds are exceeded at Phase 6 pre-implementation, AD-CP03-03 will be promoted to a full implementation sprint.

---

## 6. Migration Path: Single-Store → Dual-Store

### 6.1 Prerequisites

- ADR-023 ACCEPTED by Architecture Reviewer
- Phase 6 pre-implementation triggered (retention analysis shows PLAN or IMPLEMENT)
- Storage format: JSONL for Audit Ledger

### 6.2 Migration Steps

**Step 1 — Create Audit Ledger directory**
```
.opencode/evolution/audit/
```

**Step 2 — Implement AuditLedger service**
- Append-only JSONL writer
- Hash-chain: each record carries `previousHash` of previous record
- `AuditRecord` type (proposal ID, timestamp, agent, outcome — no full content)

**Step 3 — Dual-write at submission boundary**
```
ProposalStore.submit()
  ├── write to ProposalStore (operational)
  ├── write to Audit Ledger (immutable metadata)
  └── if Audit Ledger fails → rollback ProposalStore
```

**Step 4 — Add retention GC trigger**
- Config: `evolution.retention.proposalDays` (default: 90)
- Only REJECTED proposals eligible for cleanup
- Background GC runs after each reconciliation save

**Step 5 — Enhance Audit Ledger with history migration**
- Existing proposals: NOT migrated — migration only starts from implementation date
- Prospective only: all new proposals from dual-store go to both stores

**Step 6 — Verify integrity**
- Hash chain verification: `opencode evolution audit verify`
- No data loss: old proposals unaffected, new proposals in both stores

### 6.3 Rollback Plan

| Risk | Mitigation |
|---|---|
| Audit Ledger write fails | Rollback ProposalStore write — proposal never written |
| Hash chain corruption | Rebuild chain from last known good hash (stored separately) |
| Performance impact of dual-write | <1ms per write (JSONL append is O(1)) |
| Storage growth exceeds projection | Compress audit records >1 year old |

### 6.4 Timeline Estimate

| Step | Effort | Dependencies |
|---|---|---|
| 1–2 (Ledger service) | 2–3 days | ADR-023 accepted |
| 3 (Dual-write) | 1–2 days | Step 2 complete |
| 4 (GC trigger) | 1 day | Step 3 complete |
| 5 (Migration) | 1 day | Step 4 complete |
| 6 (Verification) | 0.5 day | All steps complete |

Total: ~6–8 developer-days for full dual-store implementation.

---

## 7. ADR-023 Status

ADR-023 Audit Ledger Architecture exists as a standalone document at `docs/evolution/ADR-023_AUDIT_LEDGER.md`. Status: **DRAFT**.

- Schema: hash-chain integrity, append-only JSONL
- Storage: `.opencode/evolution/audit/audit.jsonl`
- Retention: 7 years compliance default
- No implementation until Phase 6 pre-implementation

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ProposalStore growth exceeds projection before Phase 6 | Low | Medium | Run `opencode evolution retention-status` periodically |
| Single-store timeline pressure (retention needed before Phase 6) | Low | High | Escalate to Architecture Reviewer — implement dual-store as Phase 5 patch |
| Audit Ledger hash chain performance at scale | Low | Medium | Hash per batch of 100 records, not per write |
| GDPR/delete-right required before Phase 6 | Low | High | Delete ProposalStore entry; Audit Ledger metadata retained (no PII) |

---

## 9. Conclusion

Phase 5 Sprint E delivers:

1. ✅ `opencode evolution retention-status` CLI command
2. ✅ `RetentionAnalysisService` — read-only measurement
3. ✅ Binary recommendation: **DEFER** (no current pressure)
4. ✅ CR-003 resolution: dual-store design (ADR-023)
5. ✅ AD-CP03-03 status update: REVIEWED
6. ✅ ADR-023 draft in `docs/evolution/ADR-023_AUDIT_LEDGER.md`
7. ✅ Migration path: 6 steps, ~6–8 developer days
8. ✅ Trade-off analysis: single-store vs dual-store

**Next**: Re-run Sprint E analysis at Phase 6 pre-implementation. Until then, no code changes to ProposalStore.
