# Controlled Rename Pattern

**Pattern**: Temp-Name Transactional Rename with Collision Audit  
**Parent Decision**: DECISION_164  
**Created**: 2026-02-26

---

## Problem

Directory rename operations in AI agent workspaces are high-risk:
- Partial renames leave system in inconsistent state
- No visibility into what happened if operation fails
- Duplicate corpora create confusion and ingestion issues
- Path references become stale across codebase

---

## Solution Pattern

### Phase 1: Pre-flight

```bash
# 1. Measure sizes
du -sh <source_dir>

# 2. Check free space
df -h <target_parent>

# 3. Create timestamped backup
cp -r <source_dir> <backup_root>/rename-backup-<timestamp>/
```

### Phase 2: Temp-Name Transaction

**Never rename directly to final name.** Use temp names:

```bash
# Example: Rename bible/ to substack/
mv alma-teachings/bible/ alma-teachings/__tmp__bible__pre/
mv alma-teachings/index/ alma-teachings/__tmp__index__pre/

# Verify counts before finalizing
find alma-teachings/__tmp__bible__pre/ -type f | wc -l
find alma-teachings/__tmp__index__pre/ -type f | wc -l
```

### Phase 3: Finalize Names

```bash
mv alma-teachings/__tmp__bible__pre/ alma-teachings/substack/
mv alma-teachings/__tmp__index__pre/ alma-teachings/bible/
```

### Phase 4: Collision Audit (for merges)

When merging two directories:

```bash
# 1. For each file in source, check if exists in target
for f in $(ls source_dir/); do
  if [ -f "target_dir/$f" ]; then
    # 2. Compare sha256
    sha256_source=$(sha256sum "source_dir/$f" | cut -d' ' -f1)
    sha256_target=$(sha256sum "target_dir/$f" | cut -d' ' -f1)
    
    if [ "$sha256_source" = "$sha256_target" ]; then
      echo "IDENTICAL: $f"
    else
      echo "COLLISION: $f (different content)"
    fi
  else
    echo "NEW: $f"
  fi
done
```

### Phase 5: Reference Update Pass

```bash
# 1. Find all references to old paths
rg -l "old/path/pattern" <workspace_root>

# 2. Update each file
# 3. Generate drift report
```

### Phase 6: Validation

```bash
# 1. Verify new structure
ls new/path/

# 2. Verify old paths gone
rg "old/path/pattern" <workspace_root> || echo "Drift clear"

# 3. Run functional tests
```

---

## Rollback Procedure

```bash
# If something goes wrong
cd <workspace_root>/<affected_dir>
rm -rf <broken_target>
cp -r <backup_root>/rename-backup-<timestamp>/<original_name> ./
```

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Partial state | 0 occurrences |
| Reference drift | 0 active refs to old paths |
| Collision handling | 100% accounted for |
| Rollback time | < 5 minutes |

---

## Lessons from DECISION_164

1. **Empty destination directories are valid** - If renaming to a new purpose (e.g., Index v4 root), empty is correct
2. **Backup until downstream validates** - Keep rename-backup until Index v4 rebuild succeeds
3. **Collision report needs metadata** - Even "perfect" merges should record operation stats
4. **Index v4 generation confirmed** - bible/ populated with 17 files, 340 doc records, 62 sections

---

*Pattern maintained in OP3NF1XER/patterns/*
