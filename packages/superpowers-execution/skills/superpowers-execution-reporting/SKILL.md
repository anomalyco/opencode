# Superpowers Execution Reporting

Before implementation or implementer dispatch for an approved Superpowers plan, the root controller
must use this skill. The `superpowers-execution-reporting` companion plugin registers two tools:
`execution_report` (durable, revision-checked ledger mutations) and `execution_read` (read the
controller's current or historical run).

Reporting is a presentation feature. It never changes the plan, the order of work, or the arguments
you pass to native tools. Registration is a prerequisite to executing an approved plan. If the
skill, tools, or storage are unavailable, pause implementation and new implementer dispatch, state
the blocker, and use only read-only diagnosis until reporting recovers. Do not substitute a local
ledger, successful capability check, or visible badge for a persisted run.

## Rules

- Only the real root controller session may report. Descendant sessions cannot write the ledger.
  Collect descendant results and report them from the root.
- Do not create a run during brainstorming, exploration, or merely because a session exists. Create
  a run only when you start executing an approved plan.
- Before implementation or implementer dispatch, read the approved plan, compute its SHA-256, and
  call `execution_read`. Resume only a run for the matching plan path and hash. If another active
  run belongs to a different plan, pause and reconcile rather than replacing it.
- Never mark a task complete from prose, elapsed time, an idle agent, a summary, or successful tool
  transport. A task becomes `verified` only through `task.verify` after every required gate has a
  passing report on the task's current attempt. There is no phrase parser; only explicit reports
  change state.
- Native `subagent`, `shell`, `skill`, and prompt tools keep their exact input schemas. Do not add
  reporting fields to their arguments.
- A required gate the environment cannot run stays UNRUN: it is never reported as passed or as
  failed, it blocks verification, and the inability is disclosed explicitly.
- A "verified (reported)" task reflects your report, not an independent attestation. Report only
  gates you actually ran and evidence you actually have.

## Reporting workflow

1. Read the approved plan, hash it, and call `execution_read` before starting or resuming execution.
2. Reconcile a matching active run, or register stable tasks, dependencies, required gates, and a
   final review with `execution_report`. Wait for a persisted result before starting work.
3. Use native execution and delegation tools without changing their arguments only after registration.
4. Link real session IDs and report evidence for each gate on the current attempt.
5. Verify tasks only after their required gates pass; finish only after final review.
6. On a conflict read current state before retrying; on tracking failure pause new plan work.

### 1. Read the approved plan

Read the approved plan file before you touch code, and call `execution_read` with no `runID` to see
whether an active run already exists for this root. Compare the active run's `plan.path` and
`plan.sha256` with the approved file. Resume only a matching plan; if the active run is for a
different plan, pause and request reconciliation. `execution_read` is read-only: it never creates
a run.

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
Wait for the successful persisted response before implementation or implementer dispatch.

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

When the environment cannot run a required gate at all, that gate stays **UNRUN**. It must not be
recorded as passed or failed: an unavailable environment is an unrun gate, never a pass, and an
inability to execute is not a failed result. Leave the gate unreported and keep the task out of
`verified`, because `task.verify` requires a passing report for every required gate on the current
attempt. Disclose the inability visibly with the exact command and error, and record the reason
when you report the task `blocked` or `failed`. Never let a missing tool, credential, network path,
or skipped run silently imply successful tracking, and never substitute a partial or unrelated
result for the gate.

### 10. Verify only after the required gates pass

Call `task.verify` only when every required gate has a passing report on the current attempt and
dependencies are resolved. A gate that could not run (UNRUN), a gate with no report, and a gate
whose latest report failed all block verification. Otherwise a run can claim completion it never
verified.

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
- Missing tools, `not_found`, and `storage_unavailable` block tracking. Pause implementation and new
  implementer dispatch, disclose the blocker, and allow only read-only diagnosis. Request a
  cooperative safe stop for workers already running; do not claim that pausing the controller
  stopped them automatically. After recovery, call `execution_read` and reconcile before resuming.
- Unknown task, stale attempt, cyclic graph, missing dependency, and duplicate IDs are errors. Fix
  the plan with an approved `plan.revise`, not by guessing.

## Do not

- Do not create a run during brainstorming or just because a session exists.
- Do not infer completion from prose, time, or an idle session.
- Do not change native tool input schemas to carry reporting fields.
- Do not report gates or evidence you did not actually run.
- Do not execute an approved plan without a persisted run for that plan.
