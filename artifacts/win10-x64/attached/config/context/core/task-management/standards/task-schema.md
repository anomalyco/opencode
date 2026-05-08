<!-- Context: core/task-schema | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Standard: Task JSON Schema

**Purpose**: JSON schema reference for task management files

**Last Updated**: 2026-02-14

---

## Core Concepts

Task management uses two JSON file types:
- `task.json` - Feature-level metadata and tracking
- `subtask_NN.json` - Individual atomic tasks with dependencies

Location: `.tmp/tasks/{feature-slug}/` (at project root)

---

## Schema Versions

This document describes the **base schema** (v1.0) that all task files must follow.

For **enhanced features** (line-number precision, domain modeling, contracts, ADRs, prioritization):
- See `enhanced-task-schema.md` for extended fields and capabilities
- All enhanced fields are **optional** and backward compatible
- Use enhanced schema for multi-stage orchestration workflows

---

## task.json Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | kebab-case identifier |
| `name` | string | Yes | Human-readable name (max 100) |
| `status` | enum | Yes | active / completed / blocked / archived |
| `objective` | string | Yes | One-line objective (max 200) |
| `context_files` | array | No | **Standards paths only** — coding conventions, patterns, security rules to follow |
| `reference_files` | array | No | **Source material only** — project files to look at (existing code, config, schemas) |
| `exit_criteria` | array | No | Completion conditions |
| `subtask_count` | int | No | Total subtasks |
| `completed_count` | int | No | Done subtasks |
| `created_at` | datetime | Yes | ISO 8601 |
| `completed_at` | datetime | No | ISO 8601 |

---

## subtask_NN.json Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | {feature}-{seq} |
| `seq` | string | Yes | 2-digit (01, 02) |
| `title` | string | Yes | Task title (max 100) |
| `status` | enum | Yes | pending / in_progress / completed / blocked |
| `depends_on` | array | No | Sequence numbers of dependencies |
| `parallel` | bool | No | True if can run alongside others |
| `context_files` | array | No | **Standards paths only** — conventions and patterns to follow |
| `reference_files` | array | No | **Source material only** — existing files to reference |
| `suggested_agent` | string | No | Recommended agent for this task (e.g., OpenFrontendSpecialist) |
| `acceptance_criteria` | array | No | Binary pass/fail conditions |
| `deliverables` | array | No | Files to create/modify |
| `agent_id` | string | No | Set when in_progress |
| `started_at` | datetime | No | ISO 8601 |
| `completed_at` | datetime | No | ISO 8601 |
| `completion_summary` | string | No | What was done (max 200) |

---

## Status Transitions

```
pending → in_progress   (by working agent, when deps satisfied)
in_progress → completed (by TaskManager, after verification)
* → blocked             (by either, when issue found)
blocked → pending       (when unblocked)
```

---

## Parallel Flag

- `parallel: true` = Isolated task, can run alongside others
- `parallel: false` = May affect shared state, run sequentially

Use `task-cli.ts parallel` to find all parallelizable tasks ready to run.

---

## context_files vs reference_files — The Rule

These two fields serve fundamentally different purposes. **Never mix them.**

| Field | Answers | Contains | Agent behavior |
|-------|---------|----------|----------------|
| `context_files` | "What rules do I follow?" | Standards, conventions, patterns from `/Users/apple/.config/opencode/context/` | Load and apply as coding guidelines |
| `reference_files` | "What existing code do I look at?" | Project source files, configs, schemas | Read to understand existing patterns |

**Wrong** ❌ — mixing standards and source files:
```json
"context_files": [
  "/Users/apple/.config/opencode/context/core/standards/code-quality.md",
  "package.json",
  "src/existing-auth.ts"
]
```

**Right** ✅ — clean separation:
```json
"context_files": [
  "/Users/apple/.config/opencode/context/core/standards/code-quality.md",
  "/Users/apple/.config/opencode/context/core/standards/security-patterns.md"
],
"reference_files": [
  "package.json",
  "src/existing-auth.ts"
]
```

---

## Example

```json
{
  "id": "auth-system-02",
  "seq": "02",
  "title": "Create JWT service",
  "status": "pending",
  "depends_on": ["01"],
  "parallel": false,
  "context_files": [
    "/Users/apple/.config/opencode/context/core/standards/code-quality.md",
    "/Users/apple/.config/opencode/context/core/standards/security-patterns.md"
  ],
  "reference_files": [
    "src/auth/token-utils.ts"
  ],
  "acceptance_criteria": ["JWT tokens signed with RS256", "Tests pass"],
  "deliverables": ["src/auth/jwt.service.ts"]
}
```

---

## Migration to Enhanced Schema

The enhanced schema adds powerful features while maintaining full backward compatibility:

### When to Use Enhanced Schema

Use `enhanced-task-schema.md` when you need:
- **Line-number precision** - Point to specific sections of large files (reduces cognitive load)
- **Domain modeling** - Track bounded contexts, modules, vertical slices
- **Contract tracking** - Manage API/interface dependencies
- **Design artifacts** - Link Figma, wireframes, mockups
- **ADR references** - Connect architectural decisions to tasks
- **Prioritization** - RICE/WSJF scoring for release planning

### Migration Path

1. **No changes required** - Existing task files work as-is
2. **Gradual adoption** - Add enhanced fields incrementally:
   - Start with line-number precision for large context files
   - Add domain fields (bounded_context, module) when modeling architecture
   - Add contracts when defining APIs
   - Add prioritization scores when planning releases
3. **Mixed formats** - You can mix old and new formats in the same file

### Example: Adding Line-Number Precision

**Old format** (still valid):
```json
"context_files": [
  "/Users/apple/.config/opencode/context/core/standards/code-quality.md"
]
```

**New format** (enhanced):
```json
"context_files": [
  {
    "path": "/Users/apple/.config/opencode/context/core/standards/code-quality.md",
    "lines": "53-95",
    "reason": "Pure function patterns for service layer"
  }
]
```

Both formats work. Agents handle both automatically.

---

## Related

- `enhanced-task-schema.md` - Extended schema with advanced features
- `../guides/splitting-tasks.md` - How to decompose features
- `../guides/managing-tasks.md` - Lifecycle workflow
- `../lookup/task-commands.md` - CLI reference
