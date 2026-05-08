<!-- Context: core/workflows | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Context Operation Workflows

**Purpose**: Detailed interactive workflows for all context operations

**Last Updated**: 2026-01-06

---

## Extract Workflow (Interactive)

### Stage 1: Read Source
```
/context extract from https://react.dev/hooks
  ↓
Agent: "Reading source (8,500 lines)...
Analyzing content for extractable items..."
```

### Stage 2: Analyze & Categorize
```
Agent: "Analysis complete.

Found 12 core concepts:
  - useState (state management)
  - useEffect (side effects)
  - useContext (context consumption)
  ... (9 more)

Found 8 common errors:
  - Hooks called conditionally
  - Hooks in loops
  - Hooks outside components
  ... (5 more)

Found 3 workflows:
  - Setting up custom hooks
  - Debugging hook issues
  - Testing components with hooks"
```

### Stage 3: Select Category (APPROVAL REQUIRED)
```
Agent: "Which category should this go in?
  [1] development/
  [2] core/
  [3] Create new category: ___

Select items to extract:
  Concepts:
    ✓ [A] useState
    ✓ [B] useEffect
    ✓ [C] useContext
    ... [D-L] (9 more)
  
  Errors:
    ✓ [M] Hooks called conditionally
    ✓ [N] Hooks in loops
    ... [O-T] (6 more)
  
  Guides:
    ✓ [U] Setting up custom hooks
    ✓ [V] Debugging hook issues
    ✓ [W] Testing components

Type items (A B M or 'all') + category (1/2/3):"

User: "all 1"
```

### Stage 4: Preview (APPROVAL REQUIRED)
```
Agent: "Would create in development/:

  concepts/use-state.md (45 lines)
  concepts/use-effect.md (52 lines)
  concepts/use-context.md (38 lines)
  ... (9 more concept files)
  
  errors/react-hooks-errors.md (124 lines)
    - 8 errors grouped in one file
  
  guides/custom-hooks.md (87 lines)
  guides/debugging-hooks.md (65 lines)
  guides/testing-hooks.md (72 lines)

Total: 15 files, ~850 lines

Preview specific file? (type filename or 'skip')
Approve? (yes/no/preview):"

User: "preview use-state.md"

Agent: [Shows first 30 lines of use-state.md]

User: "yes"
```

### Stage 5-7: Create, Update, Report
```
Agent: "Creating files...
✅ Extracted 20 items into development/
📄 Created 15 files
📊 Updated development/README.md

Files created:
  - development/concepts/ (12 files)
  - development/errors/react-hooks-errors.md
  - development/guides/ (3 files)"
```

---

## Organize Workflow (Interactive)

### Stage 1-2: Scan & Categorize
```
/context organize development/
  ↓
Agent: "Scanning development/ (23 files, flat structure)...

Categorizing by function..."
```

### Stage 3: Resolve Conflicts (APPROVAL REQUIRED)
```
Agent: "Categorization plan:

Clear categorization (18 files):
  concepts/ (8 files):
    ✓ authentication.md → concepts/authentication.md
    ✓ state-management.md → concepts/state-management.md
    ✓ caching.md → concepts/caching.md
    ... (5 more)
  
  examples/ (5 files):
    ✓ jwt-example.md → examples/jwt-example.md
    ✓ hooks-example.md → examples/hooks-example.md
    ... (3 more)
  
  guides/ (5 files):
    ✓ setting-up-auth.md → guides/setting-up-auth.md
    ... (4 more)

Ambiguous files (5 - need your input):
  
  [?] api-design.md (contains concepts AND step-by-step guide)
      Content: Explains REST principles (concept) + how to design endpoints (guide)
      → [A] Split into:
            concepts/api-design.md (REST principles)
            guides/api-design-guide.md (how to design)
      → [B] Keep as concepts/api-design.md (primary: concepts)
      → [C] Keep as guides/api-design.md (primary: guide)
  
  [?] error-handling.md (contains guide AND error examples)
      Content: How to handle errors (guide) + common error patterns (errors)
      → [D] Split into:
            guides/error-handling.md (how to handle)
            errors/common-errors.md (error patterns)
      → [E] Keep as guides/error-handling.md
      → [F] Keep as errors/error-handling.md
  
  [?] testing-patterns.md (contains concepts AND examples)
      → [G] Split into concepts/ + examples/
      → [H] Keep as concepts/testing-patterns.md
      → [I] Keep as examples/testing-patterns.md

Conflicts (2):
  
  [!] authentication.md → concepts/auth.md
      Target concepts/auth.md already exists (120 lines)
      → [J] Merge authentication.md into existing auth.md
      → [K] Rename to concepts/authentication-v2.md
      → [L] Skip (keep flat)
  
  [!] jwt-example.md → examples/jwt.md
      Target examples/jwt.md already exists (65 lines)
      → [M] Merge jwt-example.md into existing jwt.md
      → [N] Rename to examples/jwt-example-v2.md
      → [O] Skip (keep flat)

Select resolutions (A D G J M or 'auto' for AI suggestions):"

User: "A D G J M"
```

### Stage 4: Preview (APPROVAL REQUIRED)
```
Agent: "Preview of changes:

CREATE directories:
  development/concepts/
  development/examples/
  development/guides/
  development/lookup/
  development/errors/

MOVE files (18):
  authentication.md → concepts/authentication.md
  state-management.md → concepts/state-management.md
  ... (16 more)

SPLIT files (3):
  api-design.md →
    concepts/api-design.md (concepts section)
    guides/api-design-guide.md (guide section)
  
  error-handling.md →
    guides/error-handling.md (guide section)
    errors/common-errors.md (error examples)
  
  testing-patterns.md →
    concepts/testing-patterns.md (concepts)
    examples/testing-examples.md (examples)

MERGE files (2):
  authentication.md → concepts/auth.md (merge content)
  jwt-example.md → examples/jwt.md (merge content)

UPDATE:
  development/README.md (create navigation tables)
  Fix 47 internal references

Dry-run? (yes/no/show-diff):"

User: "dry-run"

Agent: [Simulates changes without executing, shows what would happen]

User: "yes"
```

### Stage 5-8: Backup, Execute, Update, Report
```
Agent: "Creating backup...
💾 Backup: .tmp/backup/organize-development-2026-01-06-143022/

Executing changes...
✅ Organized 23 files into function folders
📁 Created 5 new folders
🔀 Split 3 ambiguous files
🔗 Fixed 47 references
📊 Updated development/README.md

Rollback available at: .tmp/backup/organize-development-2026-01-06-143022/"
```

---

## Update Workflow (Interactive)

### Stage 1: Identify Changes (APPROVAL REQUIRED)
```
/context update for Next.js 15
  ↓
Agent: "What changed in Next.js 15?
  [A] API changes
  [B] Deprecations
  [C] New features
  [D] Breaking changes
  [E] Other (describe)

Select all that apply (A B C D or describe):"

User: "A C D"

Agent: "Please describe the changes:
  API changes: ___
  New features: ___
  Breaking changes: ___"

User: "API changes: App router is now default
New features: New metadata API, Server Actions stable
Breaking changes: Pages router requires explicit opt-in"
```

### Stage 2: Find Affected Files
```
Agent: "Searching for files referencing Next.js...

Found 5 files with 17 references:
  📄 concepts/routing.md (3 references, 145 lines)
  📄 examples/app-router-example.md (7 references, 78 lines)
  📄 guides/setting-up-nextjs.md (2 references, 132 lines)
  📄 errors/nextjs-errors.md (1 reference, 98 lines)
  📄 lookup/nextjs-commands.md (4 references, 54 lines)

Total impact: 17 references across 5 files"
```

### Stage 3: Preview Changes (APPROVAL REQUIRED)
```
Agent: "Proposed updates:

━━━ concepts/routing.md ━━━

Line 15:
  - App router is optional (use pages/ or app/ directory)
  + App router is now default in Next.js 15 (pages/ still supported with opt-in)

Line 42:
  + ## Metadata API (New in v15)
  + 
  + Next.js 15 introduces new metadata API for SEO optimization.
  + Replaces Head component with metadata exports.

Line 87:
  - **Reference**: https://nextjs.org/docs/app
  + **Reference**: https://nextjs.org/docs/15/app

━━━ examples/app-router-example.md ━━━

Line 8:
  - // Optional: use app router
  + // Default in Next.js 15+

Line 23:
  + // New: Metadata API
  + export const metadata = {
  +   title: 'My App',
  +   description: 'App description'
  + }

━━━ guides/setting-up-nextjs.md ━━━

Line 45:
  - 3. Choose router: pages/ or app/
  + 3. App router is default (use --pages flag for pages router)

━━━ errors/nextjs-errors.md ━━━

Line 67:
  + ## Migration: Next.js 14 → 15
  + 
  + **Breaking Changes**:
  + - App router is now default
  + - Pages router requires explicit opt-in
  + 
  + **Migration Steps**:
  + 1. Update to Next.js 15: `npm install next@15`
  + 2. For pages router: Add `pages: true` to next.config.js
  + 3. Update metadata: Replace Head with metadata exports
  + 
  + **Reference**: https://nextjs.org/docs/15/upgrade-guide

━━━ lookup/nextjs-commands.md ━━━

Line 12:
  - npx create-next-app@latest
  + npx create-next-app@latest  # App router default
  + npx create-next-app@latest --pages  # Pages router

Preview next file? (yes/no/show-all)
Approve changes? (yes/no/edit):"

User: "edit"

Agent: "Line-by-line approval mode.

concepts/routing.md - Line 15 change?
  - App router is optional (use pages/ or app/ directory)
  + App router is now default in Next.js 15 (pages/ still supported with opt-in)

Approve? (yes/no/modify):"

User: "yes"

[... continues for each change ...]
```

### Stage 4-8: Backup, Update, Add Migration, Validate, Report
```
Agent: "Creating backup...
💾 Backup: .tmp/backup/update-nextjs-2026-01-06-143530/

Updating files...
✅ Updated 5 files
📝 Modified 17 references
🔄 Added migration notes to errors/nextjs-errors.md
🔗 Validated all references (0 broken links)

Summary of changes:
  - concepts/routing.md: 3 updates (145 → 162 lines)
  - examples/app-router-example.md: 4 updates (78 → 89 lines)
  - guides/setting-up-nextjs.md: 1 update (132 → 133 lines)
  - errors/nextjs-errors.md: Added migration section (98 → 125 lines)
  - lookup/nextjs-commands.md: 2 updates (54 → 56 lines)

All files still under 200 line limit ✓

Rollback available at: .tmp/backup/update-nextjs-2026-01-06-143530/"
```

---

## Error Workflow (Interactive)

### Stage 1: Search Existing
```
/context error for "Cannot read property 'map' of undefined"
  ↓
Agent: "Searching existing errors for similar issues...

Found 1 similar error:
  📄 development/errors/react-errors.md (Line 45)
     ## Error: Cannot read property 'X' of undefined
     Covers: General undefined property access in React
     Frequency: common

Found 2 related errors:
  📄 development/errors/react-errors.md
     ## Error: Cannot read property 'length' of undefined
     ## Error: Undefined is not an object"
```

### Stage 2: Check Duplication (APPROVAL REQUIRED)
```
Agent: "Options:
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

Select option + category (e.g., 'B 1'):"

User: "B 1"
```

### Stage 3: Preview (APPROVAL REQUIRED)
```
Agent: "Would update development/errors/react-errors.md:

Current (Line 45):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Error: Cannot read property 'X' of undefined

**Symptom**:
```
TypeError: Cannot read property 'X' of undefined
```

**Cause**: Attempting to access property on undefined/null object.

**Solution**:
1. Add null check before accessing property
2. Use optional chaining (?.)
3. Provide default value

**Code**:
```jsx
// ❌ Before
const value = obj.property

// ✅ After
const value = obj?.property ?? 'default'
```

**Prevention**: Always validate data exists before accessing
**Frequency**: common
**Reference**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cant_access_property
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
1. Add null check before accessing property
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
// Or with optional chaining:
const items = data?.map(item => item.name) ?? []  ← NEW
```

**Prevention**: Always validate data exists before accessing.
For arrays, provide empty array default.  ← UPDATED

**Frequency**: common
**Reference**: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Cant_access_property
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File size: 98 lines → 105 lines (under 150 limit ✓)

Approve? (yes/no/edit):"

User: "yes"
```

### Stage 4-6: Add, Update, Report
```
Agent: "Updating development/errors/react-errors.md...

✅ Updated error in development/errors/react-errors.md
🔗 Cross-referenced with 2 related errors
📊 File size: 105 lines (under 150 limit)

Changes:
  - Added 'map' and 'length' to symptom examples
  - Updated cause to mention array methods
  - Added array-specific code examples
  - Updated prevention guidance"
```

---

## Common Patterns

### Approval Gates
All operations with `enforce="@critical_rules.approval_gate"` MUST:
1. Show clear preview of what will happen
2. Wait for explicit user input
3. Provide options (yes/no/edit/preview/dry-run)
4. Never proceed without confirmation

### Conflict Resolution
When conflicts detected:
1. Present all options clearly
2. Use letter-based selection (A/B/C)
3. Show impact of each option
4. Allow user to choose resolution

### Previews
All previews should show:
1. What will be created/modified/deleted
2. File sizes (before → after)
3. Line-by-line diffs for updates
4. Validation status (under limits, no broken links)

### Backups
Operations that modify files MUST:
1. Create backup before changes
2. Store in `.tmp/backup/{operation}-{topic}-{timestamp}/`
3. Report backup location
4. Keep backups for rollback

---

## Related

- context.md - Main command interface
- harvest.md - Harvest workflow details
- mvi-principle.md - What to extract
- compact.md - How to minimize
