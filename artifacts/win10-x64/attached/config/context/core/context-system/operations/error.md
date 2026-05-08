<!-- Context: core/error | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Error Operation

**Purpose**: Add recurring errors to knowledge base with deduplication

**Last Updated**: 2026-01-06

---

## When to Use

- Encountered same error multiple times
- Want to document solution for team
- Building error knowledge base
- Preventing repeated debugging

---

## 6-Stage Workflow

### Stage 1: Search Existing
**Action**: Search for similar/related errors

**Process**:
1. Search error message across all errors/ files
2. Find similar errors (fuzzy matching)
3. Find related errors (same category)

**Format**:
```
Searching for: "Cannot read property 'map' of undefined"

Found 1 similar error:
  📄 development/errors/react-errors.md (Line 45)
     ## Error: Cannot read property 'X' of undefined
     Covers: General undefined property access
     Frequency: common

Found 2 related errors:
  📄 development/errors/react-errors.md
     ## Error: Cannot read property 'length' of undefined
     ## Error: Undefined is not an object
```

---

### Stage 2: Check Duplication (APPROVAL REQUIRED)
**Action**: Present deduplication options

**Format**:
```
Options:
  [A] Add as new error to react-errors.md
      (Specific case: 'map' on undefined array)
  
  [B] Update existing 'Cannot read property X' error
      (Add 'map' as common example)
  
  [C] Skip (already covered sufficiently)

Which framework/category?
  [1] React (react-errors.md)
  [2] JavaScript (js-errors.md)
  [3] General (common-errors.md)
  [4] Create new: ___

Select option + category (e.g., 'B 1'):
```

**Validation**: MUST wait for user input

---

### Stage 3: Preview (APPROVAL REQUIRED)
**Action**: Show full error entry before adding

**Format**:
```
Would update development/errors/react-errors.md:

Current (Line 45):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Error: Cannot read property 'X' of undefined

**Symptom**:
```
TypeError: Cannot read property 'X' of undefined
```

**Cause**: Attempting to access property on undefined/null object.

**Solution**:
1. Add null check
2. Use optional chaining (?.)
3. Provide default value

**Code**:
```jsx
// ❌ Before
const value = obj.property

// ✅ After
const value = obj?.property ?? 'default'
```

**Prevention**: Always validate data exists
**Frequency**: common
**Reference**: [Link]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Proposed update:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Error: Cannot read property 'X' of undefined

**Symptom**:
```
TypeError: Cannot read property 'X' of undefined
TypeError: Cannot read property 'map' of undefined  ← NEW
TypeError: Cannot read property 'length' of undefined  ← NEW
```

**Cause**: Attempting to access property on undefined/null object.
Common with array methods (map, filter) when data hasn't loaded.  ← NEW

**Solution**:
1. Add null check
2. Use optional chaining (?.)
3. Provide default value (especially for arrays)  ← UPDATED

**Code**:
```jsx
// ❌ Before
const value = obj.property
const items = data.map(item => item.name)  ← NEW

// ✅ After
const value = obj?.property ?? 'default'
const items = (data || []).map(item => item.name)  ← NEW
```

**Prevention**: Always validate data exists. For arrays, provide empty array default.  ← UPDATED
**Frequency**: common
**Reference**: [Link]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File size: 98 lines → 105 lines (under 150 limit ✓)

Approve? (yes/no/edit):
```

**Edit mode**: Allow modification before adding

**Validation**: MUST get approval before proceeding

---

### Stage 4: Add/Update
**Action**: Add or update error entry

**Process**:
1. Add/update error in target file
2. Follow error template format
3. Maintain file size <150 lines
4. Update "Last Updated" date

**Template Format**:
```markdown
## Error: {Name}

**Symptom**: [Error message]
**Cause**: [Why - 1-2 sentences]
**Solution**: [Steps]
**Code**: [Before/After example]
**Prevention**: [How to avoid]
**Frequency**: common/occasional/rare
**Reference**: [Link]
```

---

### Stage 5: Update Navigation
**Action**: Update README.md and add cross-references

**Process**:
1. Update README.md if new file created
2. Add cross-references to related errors
3. Link from related concepts/examples

---

### Stage 6: Report
**Action**: Show results

**Format**:
```
✅ Added error to {category}/errors/{file}.md
🔗 Cross-referenced with X related errors
📊 Updated README.md (if needed)

Changes:
  - Updated existing error entry
  - Added 'map' and 'length' examples
  - File size: 105 lines (under 150 limit)
```

---

## Deduplication Strategy

### Similar Errors
Same root cause, different manifestations
→ **Update existing** to include new examples

### Related Errors
Different causes, same category
→ **Cross-reference** between errors

### Duplicate Errors
Exact same error already documented
→ **Skip** (already covered)

### New Errors
Unique error not yet documented
→ **Add as new** error entry

---

## Error Grouping

Group errors by framework/topic in single file:
- `react-errors.md` - All React errors
- `nextjs-errors.md` - All Next.js errors
- `auth-errors.md` - All authentication errors

**Don't create**: One file per error (too granular)

---

## Examples

### Add New Error
```bash
/context error for "hooks can only be called inside components"
```

### Add Common Error
```bash
/context error for "Cannot read property 'map' of undefined"
```

### Add Framework Error
```bash
/context error for "Hydration failed in Next.js"
```

---

## Success Criteria

- [ ] Searched for similar errors?
- [ ] Deduplication options presented?
- [ ] Preview shown?
- [ ] User approved?
- [ ] Error follows template format?
- [ ] File size <150 lines?
- [ ] Cross-references added?
- [ ] README.md updated (if new file)?

---

## Related

- standards/templates.md - Error template format
- guides/workflows.md - Interactive examples
