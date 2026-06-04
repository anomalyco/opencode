# Semantic Change Checklist

> **Purpose**: When changing core semantics (how the system interprets data), ensure all dependent code is updated consistently.
>
> **When to use**: Before and after changing the meaning of a field, type, or convention that multiple layers depend on.

---

## What is a "Semantic Change"?

A semantic change is when you modify **how the system interprets data**, not just the data itself.

| Change Type                | Example                                               | Is Semantic?  |
| -------------------------- | ----------------------------------------------------- | ------------- |
| Add new field              | Add `priority` to entity                              | No            |
| Change field meaning       | `type="doc"` can no longer be a directory             | **Yes**       |
| Change implicit convention | "no content = directory" -> "type=folder = directory" | **Yes**       |
| Change timestamp unit      | Seconds -> Milliseconds                               | **Yes**       |
| Change enum values         | Add `"archived"` to status                            | No (additive) |
| Remove enum value          | Remove `"draft"` from status                          | **Yes**       |

**Key indicator**: If existing code that reads this data would behave differently after your change, it's semantic.

---

## The Checklist

### Phase 1: Before Implementation

#### 1.1 Identify All Dependencies

```bash
# Search for field/value usage across entire codebase
rg "field_name" --type ts
rg "old_value" --type ts

# Search for related logic patterns
rg "pattern_description" --type ts
```

**Document all locations that depend on the old semantics:**

| File       | Line | Current Logic             | Needs Update? |
| ---------- | ---- | ------------------------- | ------------- |
| `file1.ts` | 296  | `type === "doc"`          | Yes           |
| `file2.ts` | 27   | checks children + content | Yes           |
| ...        | ...  | ...                       | ...           |

#### 1.2 Identify Cross-Layer Impact

Check each layer for semantic dependencies:

- [ ] **Database Schema**: Does the schema enforce the old semantics?
- [ ] **Main Process**: Which handlers assume old semantics?
- [ ] **Renderer**: Which components render based on old logic?
- [ ] **Shared Types**: Which type definitions assume old semantics?
- [ ] **Tests**: Which tests assert old behavior?

#### 1.3 Plan the Migration

| Step | Description                         | Backward Compatible? |
| ---- | ----------------------------------- | -------------------- |
| 1    | Add new type/field                  | Yes                  |
| 2    | Update writers to use new semantics | Partial              |
| 3    | Update readers to handle both       | Yes                  |
| 4    | Migrate existing data               | N/A                  |
| 5    | Remove old semantics support        | No                   |

**Decision**: Can you do a clean break (delete DB) or need backward compatibility?

---

### Phase 2: During Implementation

#### 2.1 Update All Writers First

Ensure all code that **creates/modifies** data uses new semantics:

- [ ] Database insert operations
- [ ] IPC handlers that create data
- [ ] Initialization functions
- [ ] Import/export functions

#### 2.2 Update All Readers

Ensure all code that **reads/interprets** data uses new semantics:

- [ ] Database queries with WHERE clauses on the field
- [ ] IPC response formatters
- [ ] UI rendering logic
- [ ] Utility functions (isDirectory, isValid, etc.)

#### 2.3 Update Comments and Documentation

- [ ] Inline comments describing old behavior
- [ ] JSDoc/TSDoc on affected functions
- [ ] README or docs if applicable
- [ ] Type definitions

---

### Phase 3: After Implementation

#### 3.1 Verification Grep

Re-run the searches from Phase 1.1 to confirm all locations are updated:

```bash
# Should return 0 results for old pattern (if fully migrated)
rg "old_pattern" --type ts

# Should return results for new pattern
rg "new_pattern" --type ts
```

#### 3.2 Cross-Reference Checklist

For each location identified in Phase 1.1:

| File       | Line | Updated? | Verified? |
| ---------- | ---- | -------- | --------- |
| `file1.ts` | 296  | Yes      | Yes       |
| `file2.ts` | 27   | Yes      | Yes       |
| ...        | ...  | ...      | ...       |

#### 3.3 Type Check

```bash
pnpm typecheck
```

TypeScript should catch most mismatches if types are strict.

#### 3.4 Integration Test

Test the complete flow, not just individual functions:

1. Create data with new semantics
2. Read back and verify interpretation
3. Modify and verify again
4. Verify all layers see consistent data

---

## Common Semantic Changes and Their Gotchas

### 1. Type Field Semantics (e.g., folder vs doc)

**Gotchas**:

- Queries with `eq(type, "doc")` miss the new type
- `isDirectory()` logic scattered across multiple files
- Comments saying "type is always doc" become lies

**Pattern**: Create a single `isValidType()` helper and use everywhere.

### 2. Timestamp Unit Changes (seconds vs milliseconds)

**Gotchas**:

- Date math breaks silently (1000x off)
- Comparisons between old and new data fail
- Display shows wrong times

**Pattern**: Use typed wrappers (`toUnixMs()`) to make unit explicit.

### 3. Null vs Missing vs Default

**Gotchas**:

- `field ?? defaultValue` vs `field || defaultValue` behave differently
- JSON serialization drops `undefined` but keeps `null`
- Database NOT NULL constraints

**Pattern**: Be explicit about the semantic difference in types.

### 4. Soft Delete Semantics

**Gotchas**:

- WHERE clauses must include `isDeleted = false`
- Cascade delete vs orphan handling

**Pattern**: Include `isDeleted` check in all query helpers.

---

## Anti-Patterns to Avoid

### 1. Partial Migration

```typescript
// DON'T: Leave old logic "just in case"
if (entity.type === 'folder' || (entity.type === 'doc' && hasChildren)) {
  // This preserves old bugs!
}

// DO: Clean break to new semantics
if (entity.type === 'folder') {
  // Single source of truth
}
```

### 2. Implicit Backward Compatibility

```typescript
// DON'T: Silently handle both formats
const isDir = entity.type === 'folder' || !hasContent;

// DO: Explicit migration or error on old format
if (entity.type !== 'folder' && entity.type !== 'doc') {
  throw new Error(`Unknown entity type: ${entity.type}`);
}
```

### 3. Documentation Drift

```typescript
// DON'T: Leave outdated comments
/**
 * Returns true if entity is a directory.
 * A directory is a doc with no content and children.  // LIES!
 */
function isDirectory(entity) {
  return entity.type === 'folder'; // Comment doesn't match code
}
```

---

## Real-World Example: Type Field Change

### Before (Implicit Semantics)

```
Directory = doc without content + has children
         OR doc with version=0
```

Multiple implementations across codebase, each slightly different.

### After (Explicit Semantics)

```
Directory = entity.type === "folder"
```

Single source of truth, enforced by type system.

### Files Changed

1. `entity-utils.ts` - Core utilities
2. `file-operations.ts` - File system operations
3. `types.ts` - Type definitions
4. `FileTree.tsx` - UI rendering
5. `init.ts` - Initialization

### Lessons Learned

- Grep for all usages of the field/concept
- Check comments and documentation
- Update UI AND main process
- Data must be consistent everywhere

---

## Quick Reference

```
Before Changing Semantics:
1. grep all usages
2. document all locations
3. plan migration steps

During Change:
4. update writers first
5. update readers
6. update comments

After Change:
7. re-grep to verify
8. typecheck
9. integration test
```

---

**Core Principle**: Semantic changes are high-risk because they're invisible. The code looks the same, but means something different. Explicit is better than implicit.
