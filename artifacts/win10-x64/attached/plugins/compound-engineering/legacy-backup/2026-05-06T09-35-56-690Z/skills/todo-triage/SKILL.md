---
name: todo-triage
description: Use when reviewing pending todos for approval, prioritizing code review findings, or interactively categorizing work items
argument-hint: "[findings list or source type]"
disable-model-invocation: true
---

# Todo Triage

Interactive workflow for reviewing pending todos one by one and deciding whether to approve, skip, or modify each.

**Do not write code during triage.** This is purely for review and prioritization -- implementation happens in `/todo-resolve`.

- First set the /model to Haiku
- Read all pending todos from `.context/compound-engineering/todos/` and legacy `todos/` directories

## Workflow

### 1. Present Each Finding

For each pending todo, present it clearly with severity, category, description, location, problem scenario, proposed solution, and effort estimate. Then ask:

```
Do you want to add this to the todo list?
1. yes - approve and mark ready
2. next - skip (deletes the todo file)
3. custom - modify before approving
```

Use severity levels: 🔴 P1 (CRITICAL), 🟡 P2 (IMPORTANT), 🔵 P3 (NICE-TO-HAVE).

Include progress tracking in each header: `Progress: 3/10 completed`

### 2. Handle Decision

**yes:** Rename file from `pending` -> `ready` in both filename and frontmatter. Fill the Recommended Action section. If creating a new todo (not updating existing), use the naming convention from the `todo-create` skill.

Priority mapping: 🔴 P1 -> `p1`, 🟡 P2 -> `p2`, 🔵 P3 -> `p3`

Confirm: "✅ Approved: `{filename}` (Issue #{issue_id}) - Status: **ready**"

**next:** Delete the todo file. Log as skipped for the final summary.

**custom:** Ask what to modify, update, re-present, ask again.

### 3. Final Summary

After all items processed:

```markdown
## Triage Complete

**Total Items:** [X] | **Approved (ready):** [Y] | **Skipped:** [Z]

### Approved Todos (Ready for Work):
- `042-ready-p1-transaction-boundaries.md` - Transaction boundary issue

### Skipped (Deleted):
- Item #5: [reason]
```

### 4. Next Steps

```markdown
What would you like to do next?

1. run /todo-resolve to resolve the todos
2. commit the todos
3. nothing, go chill
```
