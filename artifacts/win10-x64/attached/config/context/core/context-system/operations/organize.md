<!-- Context: core/organize | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Organize Operation

**Purpose**: Restructure flat context files into function-based folder structure

**Last Updated**: 2026-01-06

---

## When to Use

- Migrating from flat structure to function-based
- Cleaning up disorganized context directories
- Splitting ambiguous files into proper categories
- Resolving duplicate/conflicting files

---

## 8-Stage Workflow

### Stage 1: Scan
**Action**: Scan category for all files and detect structure

**Output**: List of files with current structure type (flat vs organized)

---

### Stage 2: Categorize
**Action**: Categorize each file by function

**Categorization Rules**:
- Explains concept? → `concepts/`
- Shows working code? → `examples/`
- Step-by-step instructions? → `guides/`
- Reference data (tables, commands)? → `lookup/`
- Errors/issues? → `errors/`

**Output**: Categorization plan with flagged ambiguous files

---

### Stage 3: Resolve Conflicts (APPROVAL REQUIRED)
**Action**: Present categorization plan and handle conflicts

**Format**:
```
Organizing {category}/ (23 files, flat structure)

Clear categorization (18 files):
  concepts/ (8):
    ✓ authentication.md → concepts/authentication.md
  
  examples/ (5):
    ✓ jwt-example.md → examples/jwt-example.md

Ambiguous files (5 - need your input):
  
  [?] api-design.md (contains concepts AND steps)
      → [A] Split: concepts/api-design.md + guides/api-design-guide.md
      → [B] Keep as concepts/api-design.md
      → [C] Keep as guides/api-design.md

Conflicts (2):
  
  [!] authentication.md → concepts/auth.md
      Target already exists (120 lines)
      → [J] Merge into existing
      → [K] Rename to concepts/authentication-v2.md
      → [L] Skip (keep flat)

Select resolutions (A J or 'auto'):
```

**Validation**: MUST wait for user input

---

### Stage 4: Preview (APPROVAL REQUIRED)
**Action**: Show preview of all changes

**Format**:
```
Preview changes:

CREATE directories:
  {category}/concepts/
  {category}/examples/
  {category}/guides/
  {category}/lookup/
  {category}/errors/

MOVE files (18):
  authentication.md → concepts/authentication.md
  ... (17 more)

SPLIT files (3):
  api-design.md → concepts/api-design.md + guides/api-design-guide.md

MERGE files (2):
  authentication.md → concepts/auth.md (merge content)

UPDATE:
  {category}/README.md
  Fix 47 internal references

Dry-run? (yes/no/show-diff):
```

**Dry-run**: Simulates changes without executing

**Validation**: MUST get approval before proceeding

---

### Stage 5: Backup
**Action**: Create backup before making changes

**Location**: `.tmp/backup/organize-{category}-{timestamp}/`

**Purpose**: Enable rollback if needed

---

### Stage 6: Execute
**Action**: Perform the reorganization

**Process**:
1. Create function folders
2. Move files to correct locations
3. Split ambiguous files if requested
4. Merge conflicts if requested

---

### Stage 7: Update
**Action**: Update navigation and fix references

**Process**:
1. Update README.md with navigation tables
2. Fix all internal references to moved files
3. Validate all links work
4. Update "Last Updated" dates

---

### Stage 8: Report
**Action**: Show comprehensive results

**Format**:
```
✅ Organized X files into function folders
📁 Created Y new folders
🔀 Split Z ambiguous files
🔗 Fixed N references
💾 Backup: .tmp/backup/organize-{category}-{timestamp}/

Rollback available if needed.
```

---

## Conflict Resolution

### Ambiguous Files
File fits multiple categories (e.g., has concepts AND steps)

**Options**:
- Split into multiple files (recommended)
- Keep in primary category
- User decides which is primary

### Duplicate Targets
Target file already exists

**Options**:
- Merge content into existing file
- Rename to avoid conflict (e.g., -v2)
- Skip (keep in flat structure)

### Auto-Resolution
Agent suggests best option based on:
- File size
- Content analysis
- Existing structure

---

## Examples

### Organize Flat Directory
```bash
/context organize development/
```

### Dry-Run First
```bash
/context organize development/ --dry-run
```

### Organize Multiple
```bash
/context organize development/
/context organize core/
```

---

## Success Criteria

- [ ] All files in function folders (not flat)?
- [ ] Ambiguous files resolved?
- [ ] Conflicts handled?
- [ ] README.md created/updated?
- [ ] All references fixed?
- [ ] Backup created?
- [ ] User approved changes?

---

## Related

- standards/structure.md - Folder organization rules
- guides/workflows.md - Interactive examples
