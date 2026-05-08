<!-- Context: core/update | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Update Operation

**Purpose**: Update context when APIs, frameworks, or contracts change

**Last Updated**: 2026-01-06

---

## When to Use

- Framework version updates (Next.js 14 → 15)
- API changes (breaking changes, deprecations)
- New features added to existing topics
- Migration guides needed

---

## 8-Stage Workflow

### Stage 1: Identify Changes (APPROVAL REQUIRED)
**Action**: User describes what changed

**Format**:
```
What changed in {topic}?
  [A] API changes
  [B] Deprecations
  [C] New features
  [D] Breaking changes
  [E] Other (describe)

Select all that apply (A B C D or describe):
```

**Follow-up**: Get specific details for each selected type

**Validation**: MUST get user input before proceeding

---

### Stage 2: Find Affected Files
**Action**: Search for files referencing the topic

**Process**:
1. Grep for topic references across all context
2. Count references per file
3. Show impact analysis

**Format**:
```
Found 5 files referencing {topic}:
  📄 concepts/routing.md (3 references, 145 lines)
  📄 examples/app-router-example.md (7 references, 78 lines)
  📄 guides/setting-up-nextjs.md (2 references, 132 lines)
  📄 errors/nextjs-errors.md (1 reference, 98 lines)
  📄 lookup/nextjs-commands.md (4 references, 54 lines)

Total impact: 17 references across 5 files
```

---

### Stage 3: Preview Changes (APPROVAL REQUIRED)
**Action**: Show line-by-line diff for each file

**Format**:
```
Proposed updates:

━━━ concepts/routing.md ━━━

Line 15:
  - App router is optional (use pages/ or app/)
  + App router is now default in Next.js 15 (pages/ still supported)

Line 42:
  + ## Metadata API (New in v15)
  + Next.js 15 introduces new metadata API...

━━━ examples/app-router-example.md ━━━

Line 8:
  - // Optional: use app router
  + // Default in Next.js 15+

Preview next file? (yes/no/show-all)
Approve changes? (yes/no/edit):
```

**Edit mode**: Line-by-line approval for each change

**Validation**: MUST get approval before proceeding

---

### Stage 4: Backup
**Action**: Create backup before updating

**Location**: `.tmp/backup/update-{topic}-{timestamp}/`

**Purpose**: Enable rollback if updates cause issues

---

### Stage 5: Update Files
**Action**: Apply approved changes

**Process**:
1. Update concepts, examples, guides, lookups
2. Maintain MVI format (<200 lines)
3. Update "Last Updated" dates
4. Preserve file structure

**Enforcement**: `@critical_rules.mvi_strict`

---

### Stage 6: Add Migration Notes
**Action**: Add migration guide to errors/

**Format**:
```markdown
## Migration: {Old Version} → {New Version}

**Breaking Changes**:
- Change 1
- Change 2

**Migration Steps**:
1. Step 1
2. Step 2

**Reference**: [Link to changelog]
```

**Location**: `{category}/errors/{topic}-errors.md`

---

### Stage 7: Validate
**Action**: Check all references and links

**Checks**:
- All internal references still work
- No broken links
- All files still <200 lines
- MVI format maintained

---

### Stage 8: Report
**Action**: Show comprehensive results

**Format**:
```
✅ Updated X files
📝 Modified Y references
🔄 Added migration notes to errors/
💾 Backup: .tmp/backup/update-{topic}-{timestamp}/

Summary of changes:
  - concepts/routing.md: 2 updates (145 → 162 lines)
  - examples/app-router-example.md: 4 updates (78 → 89 lines)
  - guides/setting-up-nextjs.md: 1 update (132 → 133 lines)

All files still under 200 line limit ✓

Rollback available if needed.
```

---

## Change Types

### API Changes
- Method signatures changed
- Parameters added/removed
- Return types changed

### Deprecations
- Features marked deprecated
- Replacement APIs available
- Timeline for removal

### New Features
- New capabilities added
- New APIs introduced
- New patterns available

### Breaking Changes
- Incompatible changes
- Migration required
- Old code won't work

---

## Examples

### Framework Update
```bash
/context update for Next.js 15
/context update for React 19
```

### API Changes
```bash
/context update for Stripe API v2024
/context update for OpenAI API breaking changes
```

### Library Update
```bash
/context update for Tailwind CSS v4
```

---

## Success Criteria

- [ ] User described changes?
- [ ] All affected files found?
- [ ] Diff preview shown?
- [ ] User approved changes?
- [ ] Backup created?
- [ ] Migration notes added?
- [ ] All references validated?
- [ ] All files still <200 lines?

---

## Related

- guides/workflows.md - Interactive diff examples
- standards/mvi.md - Maintain MVI format
- operations/error.md - Adding migration notes
