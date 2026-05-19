---
name: todo-create
description: Use when creating durable work items, managing todo lifecycle, or tracking findings across sessions in the file-based todo system
disable-model-invocation: true
---

# File-Based Todo Tracking

## Overview

The `.context/compound-engineering/todos/` directory is a file-based tracking system for code review feedback, technical debt, feature requests, and work items. Each todo is a markdown file with YAML frontmatter.

> **Legacy support:** Always check both `.context/compound-engineering/todos/` (canonical) and `todos/` (legacy) when reading. Write new todos only to the canonical path. This directory has a multi-session lifecycle -- do not clean it up as scratch.

## Directory Paths

| Purpose | Path |
|---------|------|
| **Canonical (write here)** | `.context/compound-engineering/todos/` |
| **Legacy (read-only)** | `todos/` |

## File Naming Convention

```
{issue_id}-{status}-{priority}-{description}.md
```

- **issue_id**: Sequential number (001, 002, ...) -- never reused
- **status**: `pending` | `ready` | `complete`
- **priority**: `p1` (critical) | `p2` (important) | `p3` (nice-to-have)
- **description**: kebab-case, brief

**Example:** `002-ready-p1-fix-n-plus-1.md`

## File Structure

Each todo has YAML frontmatter and structured sections. Use the todo template included below when creating new todos.

```yaml
---
status: ready
priority: p1
issue_id: "002"
tags: [rails, performance]
dependencies: ["001"]     # Issue IDs this is blocked by
---
```

**Required sections:** Problem Statement, Findings, Proposed Solutions, Recommended Action (filled during triage), Acceptance Criteria, Work Log.

**Optional sections:** Technical Details, Resources, Notes.

## Workflows

> **Tool preference:** Use native file-search/glob and content-search tools instead of shell commands for finding and reading todo files. Shell only for operations with no native equivalent (`mv`, `mkdir -p`).

### Creating a New Todo

1. `mkdir -p .context/compound-engineering/todos/`
2. Search both paths for `[0-9]*-*.md`, find the highest numeric prefix, increment, zero-pad to 3 digits.
3. Use the todo template included below, write to canonical path as `{NEXT_ID}-pending-{priority}-{description}.md`.
4. Fill Problem Statement, Findings, Proposed Solutions, Acceptance Criteria, and initial Work Log entry.
5. Set status: `pending` (needs triage) or `ready` (pre-approved).

**Create a todo when** the work needs more than ~15 minutes, has dependencies, requires planning, or needs prioritization. **Act immediately instead** when the fix is trivial, obvious, and self-contained.

### Triaging Pending Items

1. Glob `*-pending-*.md` in both paths.
2. Review each todo's Problem Statement, Findings, and Proposed Solutions.
3. Approve: rename `pending` -> `ready` in filename and frontmatter, fill Recommended Action.
4. Defer: leave as `pending`.

Load the `todo-triage` skill for an interactive approval workflow.

### Managing Dependencies

```yaml
dependencies: ["002", "005"]  # Blocked by these issues
dependencies: []               # No blockers
```

To check blockers: search for `{dep_id}-complete-*.md` in both paths. Missing matches = incomplete blockers.

### Completing a Todo

1. Verify all acceptance criteria.
2. Update Work Log with final session.
3. Rename `ready` -> `complete` in filename and frontmatter.
4. Check for unblocked work: search for files containing `dependencies:.*"{issue_id}"`.

## Integration with Workflows

| Trigger | Flow |
|---------|------|
| Code review | `/ce:review` -> Findings -> `/todo-triage` -> Todos |
| Autonomous review | `/ce:review mode:autofix` -> Residual todos -> `/todo-resolve` |
| Code TODOs | `/todo-resolve` -> Fixes + Complex todos |
| Planning | Brainstorm -> Create todo -> Work -> Complete |

## Key Distinction

This skill manages **durable, cross-session work items** persisted as markdown files. For temporary in-session step tracking, use platform task tools (`TaskCreate`/`TaskUpdate` in Claude Code, `update_plan` in Codex) instead.

---

## Todo Template

@./assets/todo-template.md
