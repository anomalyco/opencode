# Pattern: Atlas Large File Cleanup

**Decision Link**: DECISION_160
**Date**: 2026-02-26
**Category**: File cleanup, terminology migration, deduplication

## When to Use

When Atlas governance files (CANON, FORGE, VAULT) require bulk terminology changes, deduplication, or structural consolidation.

## Key Learnings

1. **Always do a post-rewrite residual sweep**: Even after a complete file rewrite, terms can survive in keywords arrays, boolean field names, and section headers that reference old JSON paths. Run grep against ALL old terms after every rewrite.

2. **Backup files in `archive/` will match old terms**: This is expected. Only verify against active file patterns (e.g., `CANON_*.txt`, `FORGE_*.json`, `VAULT_*.json`).

3. **Meta-references in changelog notes are acceptable**: When a change note says "Removed all slug notation", the word "slug" appearing there is descriptive, not active usage.

4. **JSON field renames cascade**: Renaming `canonIndex` requires checking:
   - JSON keys (`"canonIndex":`)
   - JSON values/keywords arrays (`"keywords": ["canonIndex", ...]`)
   - Boolean derivatives (`"canonIndexUsed"`)
   - CANON text references to JSON paths (`FORGE.continuityData.atlas.canonIndex`)

5. **Deduplication discovery**: CANON files tend to accumulate duplicated sections when multiple editing sessions append similar content. Check for:
   - Summary blocks at the top that duplicate detail sections below
   - Repeated "Trust & Authority" or "Role" sections
   - Copy-paste artifacts from version bumps

6. **VAULT trimming strategy**: Keep the N most recent entries, not arbitrary selection. Version-ordered trimming preserves the most relevant change history.

## Verification Checklist

```
[ ] JSON.parse() both FORGE and VAULT
[ ] grep all old terms against active files (not archive/)
[ ] Confirm meta-references in changelogs are descriptive only
[ ] Confirm version strings updated (v0058→v1M or equivalent)
[ ] Confirm backups exist before any modification
```
