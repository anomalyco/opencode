# Phase 4 H10 — Blast Radius Map

**Scope**: Phase 4 (DirtyRowsBitset, OutputParser)
**Date**: 2026-06-22
**Reference**: MUEL v1.0 §H10

---

## Level 1: Direct (Modified)

| Component | Type of Change | Risk |
|-----------|---------------|------|
| `src/terminal/core/ScreenBuffer.ts` | Added `dirtyRows: Uint32Array` field + lifecycle in setCell/clear/clone/copyFrom | Low — internal field only, public API unchanged |
| `src/terminal/core/DirtyDiff.ts` | `findSpans()` now reads `curr.dirtyRows` to skip clean rows | Low — export `computeDirtyDiff()` signature preserved |
| `src/terminal/buffer/DoubleBuffer.ts` | `swap()` resets `this.back.dirtyRows.fill(0)` after diff | Low — export `swap()` signature preserved |

## Level 2: Secondary (Import Direct Targets)

| Component | Imported From | Impact | Verified? |
|-----------|--------------|--------|-----------|
| `DoubleBuffer` | `ScreenBuffer`, `DirtyDiff` | `dirtyRows` is internal — no API change | ✅ Existing tests cover |
| All widgets (Box, Text, List, etc.) | `ScreenBuffer` | `setCell/clear/clone/copyFrom` signatures unchanged | ✅ No widget changes needed |
| `App`, `Container` | `DoubleBuffer`, `ScreenBuffer` | No API change | ✅ |

## Level 3: Phase N+1 Impact

| Component | Phase | Dependency | Risk |
|-----------|-------|------------|------|
| `Adapter.ts` | 4B | Uses `OutputParser` — new dependency | None — new file, no existing consumers |
| `RawAdapter.ts` | 4B | Uses `Adapter` — new dependency | None — new file, no existing consumers |

## Level 4: Cross-System

| Component | Dependency | Risk |
|-----------|-----------|------|
| `packages/opencode` consumers | All terminal core | None — public API unchanged |
| `packages/sdk` | Terminal | None — no terminal dependency |

## Summary

```
Level 1 (Direct):   3 files modified (internal field + lifecycle)
Level 2 (Import):   12+ components — 0 API breaks
Level 3 (N+1):      2 planned features — compatible
Level 4 (Cross):    0 external API consumers
─────────────────────────────────────────────────────
Risk verdict:       LOW — all changes are internal/ additive
```
