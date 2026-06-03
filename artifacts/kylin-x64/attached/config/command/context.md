---
description: Context system manager - harvest summaries, extract knowledge, organize context
tags:
  - context
  - knowledge-management
  - harvest
dependencies:
  - subagent:context-organizer
  - subagent:contextscout
---

# Context Manager

<critical_rules priority="absolute" enforcement="strict">
  <rule id="mvi_strict">
    Files MUST be <200 lines. Extract core concepts only (1-3 sentences), 3-5 key points, minimal example, reference link.
  </rule>
  
  <rule id="approval_gate">
    ALWAYS present approval UI before deleting/archiving files. Letter-based selection (A B C or 'all'). NEVER auto-delete.
  </rule>
  
  <rule id="function_structure">
    ALWAYS organize by function: concepts/, examples/, guides/, lookup/, errors/ (not flat files).
  </rule>
  
  <rule id="lazy_load">
    ALWAYS read required context files from /Users/apple/.config/opencode/context/core/context-system/ BEFORE executing operations.
  </rule>
</critical_rules>

<execution_priority>
  <tier level="1" desc="Safety & MVI">
    - Files <200 lines (@critical_rules.mvi_strict)
    - Show approval before cleanup (@critical_rules.approval_gate)
    - Function-based structure (@critical_rules.function_structure)
    - Load context before operations (@critical_rules.lazy_load)
  </tier>
  <tier level="2" desc="Core Operations">
    - Harvest (default), Extract, Organize, Update workflows
  </tier>
  <tier level="3" desc="Enhancements">
    - Cross-references, validation, navigation
  </tier>
  <conflict_resolution>
    Tier 1 always overrides Tier 2/3.
  </conflict_resolution>
</execution_priority>

**Arguments**: `$ARGUMENTS`

---

## Default Behavior (No Arguments)

When invoked without arguments: `/context`

<workflow id="default_scan_harvest">
  <stage id="1" name="QuickScan">
    Scan workspace for summary files:
    - *OVERVIEW.md, *SUMMARY.md, SESSION-*.md, CONTEXT-*.md
    - Files in .tmp/ directory
    - Files >2KB in root directory
  </stage>
  
  <stage id="2" name="Report">
    Show what was found:
    ```
    Quick scan results:
    
    Found 3 summary files:
      📄 CONTEXT-SYSTEM-OVERVIEW.md (4.2 KB)
      📄 SESSION-auth-work.md (1.8 KB)
      📄 .tmp/NOTES.md (800 bytes)
    
    Recommended action:
      /context harvest  - Clean up summaries → permanent context
    
    Other options:
      /context extract {source}  - Extract from docs/code
      /context organize {category}  - Restructure existing files
      /context help  - Show all operations
    ```
  </stage>
</workflow>

**Purpose**: Quick tidy-up. Default assumes you want to harvest summaries and compact workspace.

---

## Operations

### Primary: Harvest & Compact (Default Focus)

**`/context harvest [path]`** ⭐ Most Common
- Extract knowledge from AI summaries → permanent context
- Clean workspace (archive/delete summaries)
- **Reads**: `operations/harvest.md` + `standards/mvi.md`

**`/context compact {file}`**
- Minimize verbose file to MVI format
- **Reads**: `guides/compact.md` + `standards/mvi.md`

---

### Secondary: Custom Context Creation

**`/context extract from {source}`**
- Extract context from docs/code/URLs
- **Reads**: `operations/extract.md` + `standards/mvi.md` + `guides/compact.md`

**`/context organize {category}`**
- Restructure flat files → function-based folders
- **Reads**: `operations/organize.md` + `standards/structure.md`

**`/context update for {topic}`**
- Update context when APIs/frameworks change
- **Reads**: `operations/update.md` + `guides/workflows.md`

**`/context error for {error}`**
- Add recurring error to knowledge base
- **Reads**: `operations/error.md` + `standards/templates.md`

**`/context create {category}`**
- Create new context category with structure
- **Reads**: `guides/creation.md` + `standards/structure.md` + `standards/templates.md`

---

### Migration

**`/context migrate`**
- Copy project-intelligence from global (`~/.config/opencode/context/`) to local (`/Users/apple/.config/opencode/context/`)
- For users who installed globally but want project-specific, git-committed context
- Shows diff if local files already exist, asks before overwriting
- Optionally cleans up global project-intelligence after migration
- **Reads**: `standards/mvi.md`

---

### Utility Operations

**`/context map [category]`**
- View current context structure, file counts

**`/context validate`**
- Check integrity, references, file sizes

**`/context help`**
- Show all operations with examples

---

## Lazy Loading Strategy

<lazy_load_map>
  <operation name="default">
    Read: operations/harvest.md, standards/mvi.md
  </operation>
  
  <operation name="harvest">
    Read: operations/harvest.md, standards/mvi.md, guides/workflows.md
  </operation>
  
  <operation name="compact">
    Read: guides/compact.md, standards/mvi.md
  </operation>
  
  <operation name="extract">
    Read: operations/extract.md, standards/mvi.md, guides/compact.md, guides/workflows.md
  </operation>
  
  <operation name="organize">
    Read: operations/organize.md, standards/structure.md, guides/workflows.md
  </operation>
  
  <operation name="update">
    Read: operations/update.md, guides/workflows.md, standards/mvi.md
  </operation>
  
  <operation name="error">
    Read: operations/error.md, standards/templates.md, guides/workflows.md
  </operation>
  
  <operation name="create">
    Read: guides/creation.md, standards/structure.md, standards/templates.md
  </operation>
  
  <operation name="migrate">
    Read: standards/mvi.md
  </operation>
</lazy_load_map>

**All files located in**: `/Users/apple/.config/opencode/context/core/context-system/`

---

## Subagent Routing

<subagent_routing>
  <!-- Delegate operations to specialized subagents -->
  <route operations="harvest|extract|organize|update|error|create|migrate" to="ContextOrganizer">
    Pass: operation name, arguments, lazy load map
    Subagent loads: Required context files from /Users/apple/.config/opencode/context/core/context-system/
    Subagent executes: Multi-stage workflow per operation
  </route>
  
  <route operations="map|validate" to="ContextScout">
    Pass: operation name, arguments
    Subagent executes: Read-only analysis and reporting
  </route>
</subagent_routing>

---

## Quick Reference

### Structure
```
/Users/apple/.config/opencode/context/core/context-system/
├── operations/     # How to do things (harvest, extract, organize, update)
├── standards/      # What to follow (mvi, structure, templates)
└── guides/         # Step-by-step (workflows, compact, creation)
```

### MVI Principle (Quick)
- Core concept: 1-3 sentences
- Key points: 3-5 bullets
- Minimal example: <10 lines
- Reference link: to full docs
- File size: <200 lines

### Function-Based Structure (Quick)
```
{category}/
├── navigation.md       # Navigation
├── concepts/       # What it is
├── examples/       # Working code
├── guides/         # How to
├── lookup/         # Quick reference
└── errors/         # Common issues
```

---

## Examples

### Default (Quick Scan)
```bash
/context
# Scans workspace, suggests harvest if summaries found
```

### Harvest Summaries
```bash
/context harvest
/context harvest .tmp/
/context harvest OVERVIEW.md
```

### Extract from Docs
```bash
/context extract from docs/api.md
/context extract from https://react.dev/hooks
```

### Organize Existing
```bash
/context organize development/
/context organize development/ --dry-run
```

### Update for Changes
```bash
/context update for Next.js 15
/context update for React 19 breaking changes
```

### Migrate Global to Local
```bash
/context migrate
# Copies project-intelligence from ~/.config/opencode/context/ to /Users/apple/.config/opencode/context/
# Shows what will be copied, asks for approval before proceeding
```

---

## Success Criteria

After any operation:
- [ ] All files <200 lines? (@critical_rules.mvi_strict)
- [ ] Function-based structure used? (@critical_rules.function_structure)
- [ ] Approval UI shown for destructive ops? (@critical_rules.approval_gate)
- [ ] Required context loaded? (@critical_rules.lazy_load)
- [ ] navigation.md updated?
- [ ] Files scannable in <30 seconds?

---

## Full Documentation

**Context System Location**: `/Users/apple/.config/opencode/context/core/context-system/`

**Structure**:
- `operations/` - Detailed operation workflows
- `standards/` - MVI, structure, templates
- `guides/` - Interactive examples, creation standards

**Read before using**: `standards/mvi.md` (understand Minimal Viable Information principle)
