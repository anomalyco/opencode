# ADR-024 — Decision Provenance Graph

- **Status**: DRAFT (Sprint F research)
- **Author**: Principal Engineer
- **Date**: 2026-06-18
- **Classification**: Research ADR — NOT implementation-ready
- **Motivation**: CR-005 (DAFTAR TEMUAN KRITIS) — zero end-to-end decision lineage

---

## Problem Statement

Current EF-AI stores proposals individually but has no mechanism to trace a decision back to its inputs: which memory triggered it, which context was assembled, which agent produced it, which policies were applied, and which earlier decisions influenced it.

Without provenance, debugging bad decisions requires manual log inspection. Audits cannot answer "why was this decision made?" with architectural evidence.

## Proposed Solution: Decision Provenance Graph

A lightweight, append-only lineage record attached to each proposal at creation time:

### Schema (DRAFT)

```typescript
interface DecisionProvenance {
  proposalId: string
  trigger: { type: "user" | "agent" | "system"; id: string }
  contextSnapshot: {
    memoryIds: string[]
    budgetTokens: number
    hash: string
  }
  agentId: string
  appliedRules: string[]   // e.g. ["AC-04", "AC-17"]
  parentProposalId?: string  // supersede chain
  enrichedBy: string[]       // advisor agent IDs
  confidenceScores: Record<string, number>
}
```

### Storage

- Append-only JSONL file: `.opencode/evolution/provenance/provenance.jsonl`
- NEVER modified or deleted — satisfies audit immutability requirement (CR-003)
- Written BEFORE proposal submission (same AC-17 boundary)

### Integrity

- Each record links via `proposalId` to existing proposal files
- No foreign key enforcement (storage-independent)
- Lineage traversal: `parentProposalId` forms a DAG from latest → earliest ancestor

## Implementation Boundaries

| Scope | Decision |
|---|---|
| Schema | ✅ Define in spec, NOT implement until ADR accepted |
| Storage | ✅ JSONL file alongside proposals directory |
| Write timing | ✅ Same AC-17 boundary as ReconciliationLog |
| Read API | ✅ Read-only query by proposalId or time range |
| Agent enrichment | ✅ `enrichedBy` array — populated by ReconciliationLog participants |
| Memory linking | `contextSnapshot.memoryIds` — populated by evolution context builder |

## Open Questions for Sprint D Research (G4-AR-001)

1. Should `memoryIds` be a hash only (privacy) or full IDs (debuggability)?
2. Does provenance need a separate storage layer or can it be embedded in DecisionProposal?
3. Traversal of large DAGs: depth limits or pagination needed?

## Phase 6 Impact

Decision Provenance Graph is a prerequisite for:
- Byzantine fault detection (requires agent-level traceability)
- Regulatory compliance (multi-year audit trail)
- Self-improvement loop verification (Phase 5 efficacy)

## Related Documents

- PHASE5_SPECIFICATION.md §16 (Sprint F)
- CR-005 (DAFTAR TEMUAN KRITIS)
- ADR-024 referenced in ARCHITECTURE_DEBT_REGISTRY.md
