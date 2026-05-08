<!-- Context: core/migrate | Priority: medium | Version: 1.0 | Updated: 2026-02-15 -->

# Context Migrate Operation

**Purpose**: Copy context files from global (`~/.config/opencode/context/`) to local (`/Users/apple/.config/opencode/context/`) so they're project-specific and git-committed.

**Last Updated**: 2026-02-06

---

## Core Problem

Users who installed OAC globally have project-intelligence files at `~/.config/opencode/context/project-intelligence/`. These files are project-specific patterns but aren't committed to git or shared with the team.

**Solution**: Migrate project-intelligence from global → local, so patterns are version-controlled and team-shared.

---

## 4-Stage Workflow

<workflow id="migrate" enforce="@critical_rules">

### Stage 1: Detect Sources

Scan for context files in the global config directory:

```
Scanning global context...

Global location: ~/.config/opencode/context/

Found:
  project-intelligence/
    technical-domain.md (1.2 KB, Version: 1.3)
    navigation.md (800 bytes, Version: 1.0)
    business-domain.md (1.5 KB, Version: 1.1)

Local location: /Users/apple/.config/opencode/context/

Status: No local project-intelligence/ found
```

**If no global context found:**
```
No global context found at ~/.config/opencode/context/

Nothing to migrate. Use /add-context to create project intelligence.
```
→ Exit

**If no global project-intelligence found (but other global context exists):**
```
Global context found at ~/.config/opencode/context/ but no project-intelligence/ directory.

Only project-intelligence files are migrated (project-specific patterns).
Core standards stay in global (they're universal, not project-specific).

Nothing to migrate. Use /add-context to create project intelligence.
```
→ Exit

---

### Stage 2: Check for Conflicts

If local `/Users/apple/.config/opencode/context/project-intelligence/` already exists:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Conflict: Local project-intelligence already exists
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Global files:                              Local files:
  technical-domain.md                        technical-domain.md
    Version: 1.3, Updated: 2026-01-15         Version: 1.0, Updated: 2026-02-01
  navigation.md                              navigation.md
    Version: 1.0, Updated: 2026-01-10         Version: 1.0, Updated: 2026-02-01
  business-domain.md                         (not present locally)
    Version: 1.1, Updated: 2026-01-12

Options:
  1. Skip existing — only copy files that don't exist locally
     → Will copy: business-domain.md
     → Will skip: technical-domain.md, navigation.md (local kept)

  2. Overwrite all — replace local with global versions
     → Will overwrite: technical-domain.md, navigation.md
     → Will copy: business-domain.md
     → Local backup created first

  3. Cancel

Choose [1/2/3]: _
```

**If user chooses 2 (Overwrite), show content diff first:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Diff: technical-domain.md
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Local (current):                    Global (incoming):
  Version: 1.0                        Version: 1.3
  Tech Stack: Next.js 14              Tech Stack: Next.js 15  ← different
  API: basic validation                API: Zod validation     ← different
  Component: same                      Component: same
  Naming: same                         Naming: same

Show full diff? [y/n]: _

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Backup local files to .tmp/backup/migrate-{timestamp}/ before overwriting?
[y/n] (default: y): _
```

If no conflicts → proceed directly to Stage 3.

---

### Stage 3: Approval & Copy

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Migration Plan
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Will copy from: ~/.config/opencode/context/project-intelligence/
Will copy to:   /Users/apple/.config/opencode/context/project-intelligence/

Files to copy:
  ✓ technical-domain.md (1.2 KB)
  ✓ navigation.md (800 bytes)
  ✓ business-domain.md (1.5 KB)

After migration:
  → Local files committed to git = team gets your patterns
  → Agents load local (overrides global)
  → Global files remain as fallback for other projects

Proceed? [y/n]: _
```

**Actions on approval:**
1. Create `/Users/apple/.config/opencode/context/project-intelligence/` if it doesn't exist
2. Copy each file from global → local
3. Validate copied files (frontmatter, MVI compliance)

---

### Stage 4: Cleanup & Confirmation

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Migration Complete
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Copied 3 files to /Users/apple/.config/opencode/context/project-intelligence/

  ✓ technical-domain.md
  ✓ navigation.md
  ✓ business-domain.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Clean up global project-intelligence?

The global files are no longer needed for THIS project (local takes priority).
Keeping them means they still apply as fallback to other projects.

  1. Keep global files (safe default)
  2. Remove global project-intelligence/ (only affects this user)

Choose [1/2] (default: 1): _
```

**If user chooses 2 (Remove):**
- Delete `~/.config/opencode/context/project-intelligence/` only
- Do NOT touch `~/.config/opencode/context/core/` or any other global context

</workflow>

---

## What Gets Migrated

| Migrated (project-specific) | NOT Migrated (universal) |
|---|---|
| `project-intelligence/` | `core/standards/` |
| `project-intelligence/technical-domain.md` | `core/context-system/` |
| `project-intelligence/business-domain.md` | `core/workflows/` |
| `project-intelligence/navigation.md` | `core/guides/` |
| `project-intelligence/decisions-log.md` | Any other `core/` files |
| `project-intelligence/living-notes.md` | |

**Rationale**: Project intelligence is project-specific (YOUR tech stack, YOUR patterns). Core standards are universal (code quality, documentation standards) and should stay global.

---

## Error Handling

**Permission denied:**
```
Error: Cannot write to /Users/apple/.config/opencode/context/project-intelligence/
Check directory permissions and try again.
```

**Global path not found:**
```
No global OpenCode config found at ~/.config/opencode/

If you installed to a custom location, set OPENCODE_INSTALL_DIR:
  export OPENCODE_INSTALL_DIR=/your/custom/path
  /context migrate
```

---

## Related

- `/add-context` — Create new project intelligence (interactive wizard)
- `/context harvest` — Extract knowledge from summaries
- Context path resolution: `/Users/apple/.config/opencode/context/core/system/context-paths.md`
