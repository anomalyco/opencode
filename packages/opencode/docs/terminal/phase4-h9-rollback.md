# Phase 4 H9 — Rollback Procedure

**Scope**: Phase 4 (DirtyRowsBitset, OutputParser)
**Date**: 2026-06-22
**Reference**: MUEL v1.0 §H9

---

## Prerequisites

1. Working tree clean (`git status` shows no uncommitted changes)
2. Confirm target commit SHAs before executing rollback commands

## Option A: Full Revert (git revert)

```bash
# Identify Phase 4 commits
git log --oneline --all -- packages/opencode/src/terminal/core/ScreenBuffer.ts

# Revert each commit in reverse chronological order
git revert <phase4-commit-1> --no-edit
git revert <phase4-commit-2> --no-edit
```

## Option B: Targeted File Revert (Partial)

```bash
# Revert ScreenBuffer (dirtyRows field)
git checkout HEAD~1 -- packages/opencode/src/terminal/core/ScreenBuffer.ts

# Revert DirtyDiff (dirtyRows skip)
git checkout HEAD~1 -- packages/opencode/src/terminal/core/DirtyDiff.ts

# Revert DoubleBuffer (dirtyRows reset)
git checkout HEAD~1 -- packages/opencode/src/terminal/buffer/DoubleBuffer.ts

# Remove new files
git rm packages/opencode/src/terminal/core/OutputParser.ts
git rm packages/opencode/docs/terminal/phase4-h9-rollback.md
git rm packages/opencode/docs/terminal/phase4-h10-blast.md
```

## Option C: Uncommitted Changes Only

```bash
# Discard all Phase 4 changes
git checkout -- packages/opencode/src/terminal/core/ScreenBuffer.ts
git checkout -- packages/opencode/src/terminal/core/DirtyDiff.ts
git checkout -- packages/opencode/src/terminal/buffer/DoubleBuffer.ts
rm packages/opencode/src/terminal/core/OutputParser.ts
```

## Post-Rollback Verification

```bash
bun test test/terminal/ --timeout 120000
bun typecheck 2>&1 | grep "terminal/" || echo "No terminal type errors"
```

## Risk Assessment

| Change | Irreversible? | Data Loss Risk |
|--------|--------------|----------------|
| ScreenBuffer dirtyRows field | Yes — added internal field | No data — in-memory only |
| DirtyDiff skip clean rows | Yes — changed algorithm | No data — pure computation |
| DoubleBuffer swap lifecycle | Yes — changed reset logic | No data — in-memory only |
| OutputParser (new file) | No — new file, can be deleted | No |
| H9/H10 docs (new files) | No — new files, can be deleted | No |

All changes in-memory only. Zero data loss risk.
