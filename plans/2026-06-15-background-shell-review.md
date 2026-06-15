# Background Shell Review Plan

Date: 2026-06-15

## Goal

Review and finish the remaining gaps in managed background shell support after the initial core V2 implementation.

This plan is intentionally scoped to review and closure of the pending items only. It is not a redesign of session execution, durable recovery, or clustered ownership.

## Current State

Implemented in the current working tree:

- Core V2 Bash accepts `background?: boolean`.
- Core V2 registers `shell_status`, `shell_wait`, `shell_cancel`, and `shell_logs`.
- `ShellJob` keeps process-local session-owned state for background shell jobs.
- `AppProcess.runObserved(...)` observes output while allowing completion to follow the main process.
- Focused core tests cover background launch, logs, wait, cancel, and fast background completion.

Validated commands:

- `cd packages/core && bun typecheck`
- `cd packages/core && bun test test/tool-bash.test.ts test/background-job.test.ts test/process/process.test.ts`
- `cd packages/opencode && bun typecheck`

Known validation gap:

- `cd packages/opencode && bun test test/tool/shell.test.ts` timed out locally and needs another pass after the legacy shell decision below.

## Pending Review Items

### 1. Legacy Shell Tool Coverage

Problem:

- `packages/opencode/src/tool/shell.ts` still has only foreground behavior.
- `packages/opencode/src/tool/shell/prompt.ts` still exposes parameters without `background`.
- The original plan explicitly included the legacy shell tool, so the current implementation is incomplete if users still execute this path.

Review questions:

- Is the legacy shell tool still the active tool for the current CLI/TUI/session path?
- If yes, should it reuse `@opencode-ai/core/shell-job`, or should the core shell job abstraction move/expand to support both packages cleanly?
- If no, should this be documented and tests updated to prove the V2 Bash path is the only target for this feature?

Acceptance criteria:

- Either legacy shell supports managed background jobs with equivalent behavior, or the project has a documented decision that background shell is V2-only for now.
- No model-facing prompt asks for background shell on a path that cannot execute it.
- Tests cover whichever decision is made.

Suggested tests:

- If implementing legacy support:
  - `cd packages/opencode && bun test test/tool/shell.test.ts`
  - Add cases for `background: true`, status/logs/wait/cancel, timeout, and cancellation.
- If explicitly V2-only:
  - Add a regression test that legacy prompt/schema does not advertise unsupported background behavior.

### 2. Output Storage And Truncation

Problem:

- `ShellJob` keeps only an in-memory tail bounded by `MAX_TAIL_BYTES`.
- The original plan required full output storage via truncation/output store when output exceeds limits.
- `shell_logs` currently returns tail only; there is no managed `outputPath` for full logs.

Review questions:

- Should background shell output use `ToolOutputStore`, the existing truncation service, or a new shell-job output file?
- Should stdout/stderr be preserved as separate streams, or is merged output enough for the first complete version?
- What should `shell_status` return when the full output is available elsewhere?

Acceptance criteria:

- Large output keeps fast tail access.
- Full output is saved or explicitly marked as truncated with a path/resource.
- Status/logs expose truncation metadata.
- The implementation does not keep unbounded output in memory.

Suggested tests:

- Background command emits output beyond memory/tail limits.
- `shell_logs` returns tail.
- Status indicates truncation and output path/resource.
- Saved output contains the expected beginning and end.

### 3. API/UI/TUI Integration

Problem:

- Core tools exist, but UI/TUI/API behavior is not integrated.
- The original plan asked for background shell to display as a running item, show job ID/status/duration/tail, allow cancellation, and notify on completion.

Review questions:

- Which UI surface should own background shell rendering: tool metadata, session events, or a new job event stream?
- Should job completion inject a synthetic message like background subagents, or only update tool state?
- How should cancellation map to existing tool cancellation controls?

Acceptance criteria:

- Background shell jobs are visible as running work in the relevant UI/TUI surface.
- Users can cancel from the UI/TUI when applicable.
- Final status is visible without manual polling when the surface supports live updates.
- The CLI/TUI does not show a background job as an already-successful foreground command.

Suggested tests:

- Unit tests for rendering background shell metadata/status.
- TUI/session data tests for pending/running/final tool state.
- Manual smoke with a long-running local command.

### 4. Ownership And Scope Audit

Problem:

- `ShellJob` enforces `sessionID` ownership for observation/cancel, but the registry is currently wired through the Location layer.
- This may be acceptable for process-local first delivery, but it needs an explicit scope decision.

Review questions:

- Can a session move/reuse the same session ID across Location layer refreshes while a job is running?
- Does `Layer.fresh` or idle Location eviction lose background shell jobs earlier than users expect?
- Should shell jobs be Location-scoped, process-scoped, or shared through the existing process-global `BackgroundJob` node?

Acceptance criteria:

- Scope semantics are documented.
- Tests or code structure prevent cross-session reads/cancel.
- Location lifecycle behavior is intentional, not accidental.

Suggested tests:

- Same session can observe its job.
- Different session cannot observe/cancel another job.
- Behavior after Location layer refresh is either preserved or explicitly tested as not preserved.

### 5. Process Semantics Audit

Problem:

- `cross-spawn-spawner` now resolves the process signal on `exit` rather than waiting for `close`.
- This supports not waiting on orphaned pipes, but it changes a core process primitive and should be reviewed carefully.

Review questions:

- Does any existing code depend on `handle.exitCode` waiting for stdio `close`?
- Are stdout/stderr collectors still reliable for normal foreground commands?
- Is the 25ms grace period in `runObserved` enough, too arbitrary, or avoidable with a better drain strategy?

Acceptance criteria:

- Foreground `AppProcess.run(...)` behavior remains stable.
- `runObserved(...)` returns when the main process exits even if descendants keep pipes open.
- Process tree kill still works on Windows and POSIX.

Suggested tests:

- Main process exits while child keeps stdout/stderr open; observed run returns promptly.
- Foreground run still captures normal output.
- Timeout/cancel kills process tree.
- Windows `taskkill /T /F` path is covered when possible.

## Recommended Execution Order

1. Decide whether background shell must support legacy `packages/opencode/src/tool/shell.ts` now.
2. Audit `ShellJob` lifecycle scope and ownership.
3. Add output storage/truncation.
4. Add UI/TUI/API integration.
5. Re-run full focused validation, then broaden only where touched.

## Completion Criteria

The feature can be considered complete only when:

- Active shell paths either support background mode or explicitly do not advertise it.
- Background logs are not memory-only for large output.
- Users can observe and cancel jobs through intended surfaces.
- Ownership and process-local lifecycle are documented and tested.
- Core and opencode package typechecks pass.
- Focused shell/process/background tests pass from package directories.
