# Superpowers Execution Reporting

Use this skill when you are the root controller executing an approved Superpowers plan and the
`superpowers-execution-reporting` companion plugin is loaded. The plugin registers two tools:
`execution_report` (durable, revision-checked ledger mutations) and `execution_read` (read the
controller's current or historical run).

Reporting is a presentation feature. It never changes the plan, the order of work, or the arguments
you pass to native tools. When tracking fails or the plugin is absent, keep executing the plan and
say explicitly in the conversation that tracking is degraded; a silent failure must never look like
successful tracking.

## Rules

- Only the real root controller session may report. Descendant sessions cannot write the ledger.
  Collect descendant results and report them from the root.
- Do not create a run during brainstorming, exploration, or merely because a session exists. Create
  a run only when you start executing an approved plan.
- Never mark a task complete from prose, elapsed time, an idle agent, a summary, or successful tool
  transport. A task becomes `verified` only through `task.verify` after every required gate has a
  passing report on the task's current attempt. There is no phrase parser; only explicit reports
  change state.
- Native `subagent`, `shell`, `skill`, and prompt tools keep their exact input schemas. Do not add
  reporting fields to their arguments.
- A "verified (reported)" task reflects your report, not an independent attestation. Report only
  gates you actually ran and evidence you actually have.

## Reporting workflow

1. Read the approved plan and `execution_read` before starting or resuming execution.
2. Register stable tasks, dependencies, required gates, and a final review with `execution_report`.
3. Use native execution and delegation tools without changing their arguments.
4. Link real session IDs and report evidence for each gate on the current attempt.
5. Verify tasks only after their required gates pass; finish only after final review.
6. On a conflict read current state before retrying; on tracking failure disclose it.

### 1. Read the approved plan

Read the approved plan file before you touch code, and call `execution_read` with no `runID` to see
whether an active run already exists for this root. Resume that run instead of starting a second
one. `execution_read` is read-only: it never creates a run.

### 2. Register stable tasks

Choose task IDs that are short, stable, and unique within the run (`T01`, `schema`, `api`). IDs must
survive clarification edits; only an approved scope change may renumber or replace the plan, and
`plan.revise` must describe it.

### 3. Declare dependencies, gates, and the final review

Give every task an explicit `dependsOn` list, a nonempty `requiredGates` subset of `tests`,
`spec_review`, `code_review`, and `manual`, and a `phase` and `order`. Mark exactly one included
task with `finalReview: true`. A run finishes only when every included task is verified and the
included final-review task is verified.

### 4. Compute the plan hash

Hash the approved plan file content with SHA-256 and pass the 64-character lowercase hex digest as
`plan.sha256`:

```bash
sha256sum docs/superpowers/plans/my-plan.md
```

The hash records the plan version you claim was approved. It is not proof that the server read the
file.

### 5. Start the run

Call `execution_report` with `expectedRevision: 0` and a fresh `run.start` operation. Pick the
`runID` yourself and keep it for the whole run. Include the complete task graph as
`{id,title,phase,order,dependsOn,requiredGates,finalReview}` definitions.

```jsonc
{
  "operationID": "op-start-1",
  "runID": "run-2026-09-21-a",
  "expectedRevision": 0,
  "operation": {
    "type": "run.start",
    "title": "Execution UI reporting",
    "plan": { "path": "docs/superpowers/plans/my-plan.md", "sha256": "<64 hex chars>" },
    "tasks": [
      { "id": "schema", "title": "Schema", "phase": "Build", "order": 0, "dependsOn": [], "requiredGates": ["tests"], "finalReview": false },
      { "id": "impl", "title": "Implement", "phase": "Build", "order": 1, "dependsOn": ["schema"], "requiredGates": ["tests", "code_review"], "finalReview": false },
      { "id": "final", "title": "Final review", "phase": "Review", "order": 2, "dependsOn": ["impl"], "requiredGates": ["spec_review", "code_review"], "finalReview": true }
    ]
  }
}
```

### 6. Report task start

Move a task to `running` with `task.state` only after every non-skipped dependency is verified. Use
the current `attempt` and the current `expectedRevision`.

```jsonc
{
  "operationID": "op-impl-running-1",
  "runID": "run-2026-09-21-a",
  "expectedRevision": 1,
  "operation": { "type": "task.state", "taskID": "impl", "attempt": 1, "state": "running" }
}
```

### 7. Delegate normally or execute inline

Native delegation and native execution are unchanged. For delegated work, call the native `subagent`
tool with its normal arguments and use the real returned session ID. For inline work in the root
session, assign the root session itself.

Delegated implementer:

```jsonc
{
  "operationID": "op-assign-impl-1",
  "runID": "run-2026-09-21-a",
  "expectedRevision": 2,
  "operation": { "type": "assignment.add", "id": "a-impl-1", "taskID": "impl", "attempt": 1, "sessionID": "<real child session ID>", "role": "implementer" }
}
```

Inline controller:

```jsonc
{
  "operationID": "op-assign-inline-1",
  "runID": "run-2026-09-21-a",
  "expectedRevision": 2,
  "operation": { "type": "assignment.add", "id": "a-inline-1", "taskID": "impl", "attempt": 1, "sessionID": "<this root session ID>", "role": "controller" }
}
```

Roles are `controller`, `implementer`, `spec_reviewer`, `code_reviewer`, and `debugger`. A child may
be reused for several assignments, so never assume a one-to-one task/session mapping. A root-session
assignment represents inline execution.

### 8. Link the real returned child ID

Use the session ID the native tool actually returned. Do not invent, guess, or reuse an unrelated
ID; the bridge validates same-root ancestry and rejects an unknown or foreign session before any
durable change.

### 9. Report gate results with evidence references

Append one `evidence.add` per gate outcome, referencing the real session, message, and (when
available) part that produced it. Mark each required gate `passed` or `failed`.

```jsonc
{
  "operationID": "op-evidence-tests-1",
  "runID": "run-2026-09-21-a",
  "expectedRevision": 3,
  "operation": {
    "type": "evidence.add",
    "id": "ev-tests-1",
    "taskID": "impl",
    "attempt": 1,
    "gate": "tests",
    "outcome": "passed",
    "summary": "bun test ./test/reporting.test.ts ./test/plugin.test.ts: 21 pass",
    "sessionID": "ses_child",
    "messageID": "msg_1"
  }
}
```

A failed gate is evidence, not a verification. Report the failure, keep the task out of `verified`,
and reopen or reassign as the plan requires.

### 10. Verify only after the required gates pass

Call `task.verify` only when every required gate has a passing report on the current attempt and
dependencies are resolved. Otherwise a run can claim completion it never verified.

### 11. Update the plan revision on approved scope changes

When the user approves a scope change, send `plan.revise` with the complete replacement task graph,
the updated plan hash, and a reason. Unchanged task state is retained; changed contracts and their
descendants get new attempts. Omitted tasks remain as skipped history. Increment the plan revision.
Unexplained edits, reordering, or silently dropping work are not scope changes.

### 12. Finish after the final review

Call `run.finish` only after every included task is verified and the included final-review task is
verified. If the work stops, use `run.cancel` with a reason; never report remaining work as
complete. Completed and cancelled runs are immutable; restarting creates a new run ID.

## Conflicts and failures

- A mutation returns `revision_conflict` with the current revision. Call `execution_read`, read the
  current task state, and retry the **same** attempted write with the same `operationID` and the new
  `expectedRevision`. Never reuse an operation ID for a different payload, and never blind-retry
  with a stale revision.
- A repeated operation with the same `operationID` and payload is idempotent and returns
  `duplicate: true` without another mutation.
- `forbidden` means the caller is not the root or an assigned session is outside the run's ancestry.
  Child sessions cannot report; gather their results and write from the root.
- `not_found` and `storage_unavailable` are bridge failures. Continue the underlying Superpowers
  work and disclose the tracking failure in the conversation: reporting failure never implies
  successful tracking. Retry the report when the bridge recovers, starting from `execution_read`.
- Unknown task, stale attempt, cyclic graph, missing dependency, and duplicate IDs are errors. Fix
  the plan with an approved `plan.revise`, not by guessing.

## Do not

- Do not create a run during brainstorming or just because a session exists.
- Do not infer completion from prose, time, or an idle session.
- Do not change native tool input schemas to carry reporting fields.
- Do not report gates or evidence you did not actually run.
