<!-- Context: core/managing-tasks | Priority: high | Version: 1.0 | Updated: 2026-02-15 -->

# Guide: Managing Task Lifecycle

**Purpose**: Step-by-step workflow for JSON-driven task management

**Last Updated**: 2026-01-11

---

## Prerequisites

- TaskManager agent available
- Feature folder created in `.tmp/tasks/` (at project root)

---

## Workflow Overview

```
1. Initiation    → TaskManager creates task.json + subtasks
2. Selection     → Find eligible tasks (deps satisfied)
3. Execution     → Working agent implements task
4. Verification  → TaskManager validates completion
5. Archiving     → Move to completed/ when done
```

---

## 1. Initiation (TaskManager)

Create feature folder and files:
```
.tmp/tasks/{feature-slug}/
├── task.json
├── subtask_01.json
├── subtask_02.json
└── subtask_03.json
```

Validate with: `task-cli.ts validate {feature}`

---

## 2. Task Selection

Find eligible tasks using CLI:
```bash
task-cli.ts next {feature}      # All ready tasks
task-cli.ts parallel {feature}  # Parallelizable only
```

Selection criteria:
- `status == "pending"`
- All `depends_on` tasks have `status == "completed"`

---

## 3. Execution (Working Agent)

When picking up task:

1. Read subtask JSON
2. Update status:
   ```json
   {
     "status": "in_progress",
     "agent_id": "coder-agent",
     "started_at": "2026-01-11T14:30:00Z"
   }
   ```
3. Load `context_files` (lazy)
4. Implement `deliverables`
5. Add `completion_summary` (max 200 chars)

---

## 4. Verification (TaskManager)

After agent signals completion:

1. Check each `acceptance_criteria`
2. If all pass → Mark completed:
   ```bash
   task-cli.ts complete {feature} {seq} "summary"
   ```
3. If fail → Keep in_progress, report failures

---

## 5. Archiving

When `completed_count == subtask_count`:

1. Update task.json: `status: "completed"`
2. Move folder: `.tmp/tasks/{slug}/` → `.tmp/tasks/completed/{slug}/`

---

## Status Ownership

| Status | Who Sets | When |
|--------|----------|------|
| pending | TaskManager | Initial creation |
| in_progress | Working agent | Picks up task |
| completed | TaskManager | After verification |
| blocked | Either | Dependency/issue found |

---

## CLI Commands Summary

| Command | Use Case |
|---------|----------|
| `status` | Quick overview |
| `next` | What to work on |
| `parallel` | Batch parallel work |
| `deps` | Understand blockers |
| `blocked` | Identify issues |
| `complete` | Mark task done |
| `validate` | Health check |

---

## Related

- `../standards/task-schema.md` - JSON field reference
- `splitting-tasks.md` - How to create subtasks
- `../lookup/task-commands.md` - Full CLI reference
