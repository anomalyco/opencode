<!-- Context: core/extract | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Extract Operation

**Purpose**: Extract context from docs, code, or URLs into organized context files

**Last Updated**: 2026-01-06

---

## When to Use

- Extracting from documentation (React docs, API docs, etc.)
- Extracting from codebase (patterns, conventions)
- Extracting from URLs (blog posts, guides)
- Creating initial context for new topics

---

## 7-Stage Workflow

### Stage 1: Read Source
```
/context extract from https://react.dev/hooks
  ↓
Agent: "Reading source (8,500 lines)...
Analyzing content for extractable items..."
```

**Action**: Read and analyze source material

---

### Stage 2: Analyze & Categorize
**Action**: Extract and categorize content by function

**Categorization**:
- Design decisions → `concepts/`
- Working code → `examples/`
- Step-by-step workflows → `guides/`
- Reference data (commands, paths) → `lookup/`
- Errors/gotchas → `errors/`

**Output**: List of extractable items with previews

---

### Stage 3: Select Category (APPROVAL REQUIRED)
**Action**: User chooses target category and items

**Format**:
```
Found 12 extractable items from {source}:

Concepts (8):
  ✓ [A] useState - State management hook
  ✓ [B] useEffect - Side effects hook
  ... (6 more)

Errors (4):
  ✓ [I] Hooks called conditionally
  ✓ [J] Hooks in loops
  ... (2 more)

Which category?
  [1] development/
  [2] core/
  [3] Create new category: ___

Select items (A B I or 'all') + category (1/2/3):
```

**Validation**: MUST wait for user input before proceeding

---

### Stage 4: Preview (APPROVAL REQUIRED)
**Action**: Show what will be created, check for conflicts

**Format**:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Extraction Plan: development/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CREATE (new files):
  concepts/use-state.md (45 lines)
  concepts/use-effect.md (52 lines)
  concepts/use-context.md (38 lines)
  ... (6 more)
  guides/custom-hooks.md (87 lines)
  guides/debugging-hooks.md (65 lines)

ADD TO (existing files):
  errors/react-hooks-errors.md (98 → 124 lines)
    + 4 new error entries

⚠️  CONFLICT (file already exists):
  concepts/use-memo.md already exists (42 lines)
    Options:
      [A] Skip — keep existing file
      [B] Overwrite — replace with extracted version
      [C] Merge — add new content to existing file (42 → 58 lines)
    Choose [A/B/C]: _

NAVIGATION UPDATE:
  development/navigation.md
    + 9 new entries in Concepts table
    + 2 new entries in Guides table
    + 1 updated entry in Errors table

Total: 12 files, ~650 lines

Preview content? (type filename, 'all' for batch, or 'skip')
Approve? [y/n/edit]: _
```

**If user types 'all'**: Show first 10 lines of each file in sequence
**If user types filename**: Show full content of that file
**If user types 'skip'**: Proceed to approval

**Validation**: MUST get approval before proceeding

---

### Stage 5: Create
**Action**: Create files in function folders

**Process**:
1. Apply MVI format (1-3 sentences, 3-5 key points, minimal example)
2. Create files in correct function folders
3. Ensure all files <200 lines
4. Add cross-references

**Enforcement**: `@critical_rules.mvi_strict` + `@critical_rules.function_structure`

---

### Stage 6: Update Navigation (preview included in Stage 4)
**Action**: Update navigation.md and add cross-references

**Process**:
1. Update category navigation.md with new files (as previewed in Stage 4)
2. Add priority levels (critical/high/medium/low)
3. Add cross-references between related files
4. Update "Last Updated" dates

---

### Stage 7: Report
**Action**: Show comprehensive results

**Format**:
```
✅ Extracted X items into {category}
📄 Created Y files
📊 Updated {category}/README.md

Files created:
  - {category}/concepts/ (N files)
  - {category}/examples/ (N files)
  - {category}/errors/ (N files)
```

---

## Examples

### Extract from URL
```bash
/context extract from https://react.dev/hooks
```

### Extract from Local Docs
```bash
/context extract from docs/api.md
/context extract from docs/architecture/
```

### Extract from Code
```bash
/context extract from src/utils/
```

---

## Success Criteria

- [ ] All files <200 lines?
- [ ] MVI format applied (1-3 sentences, 3-5 points, example, reference)?
- [ ] Files in correct function folders?
- [ ] README.md updated?
- [ ] Cross-references added?
- [ ] User approved before creation?

---

## Related

- standards/mvi.md - What to extract
- guides/compact.md - How to minimize
- guides/workflows.md - Interactive examples
