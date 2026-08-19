# Multi-threaded Architect-Coder Workflows

## Goal

Allow a user to choose an Architect agent and a Coder agent independently, persist those choices per project, then submit a story that is planned by the Architect and implemented by the Coder across parallel task threads.

## MVP Decisions

- Ship the Architect-Coder workflow first.
- Keep Manager, Reviewer, QA, docs, and merge-specialist roles as future extension points.
- Persist role selections per project.
- Snapshot role selections when a workflow is created. Later preference changes only affect future workflows.
- Run up to two independent tasks concurrently by default.
- Require a clean git worktree before starting a workflow.
- Use isolated worktrees/branches for coder task attempts.
- Integrate approved work into one workflow branch.
- Use a fresh read-only Architect session for each audit and for the final integrated audit.
- After three rejected attempts or repeated execution failures, run one final Thinking-model remediation and fresh Thinking-model audit before pausing for human input.
- Deliver a workflow branch for manual user inspection and merge.

## Segment 1: Durable Contracts

- Status: foundation implemented.
- Add workflow schemas for IDs, role selection snapshots, project preferences, workflow info, workflow status, task status, attempts, audit findings, and events.
- Add persisted workflow preferences keyed by project.
- Add persisted workflow records keyed by workflow ID.
- Add immutable role snapshots to each workflow record.
- Keep runtime state changes deterministic and owned by the coordinator, not model output.

## Segment 2: Public API

- Status: base endpoints implemented; coordinator-only state operations are implemented in Core.
- Add Protocol endpoints:
  - `GET /api/workflow/preferences`
  - `PUT /api/workflow/preferences`
  - `POST /api/workflow`
  - `GET /api/workflow`
  - `GET /api/workflow/:workflowID`
  - `POST /api/workflow/:workflowID/pause`
  - `POST /api/workflow/:workflowID/resume`
  - `POST /api/workflow/:workflowID/cancel`
- Regenerate the client after Protocol changes.
- Keep the API location-scoped so project preferences naturally follow the current project.

## Segment 3: Coordinator

- Status: first coordinator pass implemented.
- Prompt overlay status: implemented.
- Add a process-global coordinator keyed by workflow ID.
- On creation:
  - Resolve the current project.
  - Validate the git worktree is clean.
  - Snapshot Architect/Coder selections and concurrency.
  - Create the workflow record.
  - Create the initial Architect planning session.
- Parse Architect output into a task DAG.
- Dispatch only ready tasks whose dependencies are integrated.
- Respect `parallelEligible` and file/path conflict hints.
- Keep Coder execution in isolated worktrees.
- Reuse the Coder session for remediation on the same task.
- Use fresh Architect audit sessions for each submitted task revision.
- After three rejected attempts, run one final Thinking-model remediation and fresh Thinking-model audit before marking the workflow as needing human input.
- Implementation notes:
  - `POST /api/workflow` persists the workflow and wakes the coordinator.
  - Dirty source worktrees move the workflow to `needs_human`.
  - Architect planning, Coder results, and Architect audits are decoded from strict JSON session output.
  - Ready tasks dispatch up to the configured concurrency limit.
  - Remediation-ready tasks are redispatched; after three terminal failures/rejections, the redispatch forces the selected model variant to `thinking` for both the Coder rescue attempt and fresh Architect audit.
  - Each Coder task runs in a git-worktree project copy.
  - Approved task diffs are applied back to the source worktree before the task becomes `integrated`.
  - A final fresh Architect audit moves the workflow to `completed` or `needs_human`.
  - This pass uses V2 active-session polling because `SessionV2.wait` is not yet implemented.
  - Workflow branch naming, commits, conflict remediation, and restart recovery remain for the integration hardening slice.

## Segment 4: Integration and Recovery

- Integrate approved task branches in topological order.
- Use ticket ID as the deterministic tie-breaker for otherwise independent tasks.
- If integration conflicts, create remediation from the latest workflow branch state.
- Persist every state transition before scheduling follow-up execution.
- On restart, safely resume ready work and reconcile interrupted active phases.
- Never duplicate provider turns after restart without an explicit recovery design.

## Segment 5: TUI

- Status: first workflow mode pass implemented.
- Add a dedicated workflow composer mode.
- Let users choose Architect profile/model/variant separately from Coder profile/model/variant.
- Persist the project-level selections.
- Show workflow state, task tree, attempts, audit feedback, active sessions, and workflow branch.
- Provide pause, resume, cancel, retry, and clarify actions.
- Implementation notes:
  - `/workflow` opens a dedicated TUI route with story composer, role selectors, model/variant selectors, concurrency selector, workflow list, status panel, task tree, pause/resume/cancel controls, and session links.
  - The first pass polls the workflow HTTP endpoints because workflow lifecycle events are not yet published on the global event stream.
  - The TUI route currently uses direct workflow HTTP requests; the legacy JavaScript SDK now generates workflow methods and can replace this thin client in a cleanup slice.

## Segment 6: Validation

- Status: first lower-level test pass implemented.
- Add schema and migration tests.
- Add workflow state-machine tests.
- Add coordinator tests with a temporary git repo and real worktrees.
- Add API handler tests for preference persistence and workflow lifecycle actions.
- Add TUI tests for persistence and composer behavior.
- Run package-local `bun typecheck`; never run typecheck or tests from the repo root.
- Implementation notes:
  - Added workflow schema decode/encode and strict structured-output rejection tests.
  - Added workflow service persistence, preference snapshot, DAG validation, state transition, dependency unblocking, and Thinking rescue exhaustion tests.
  - Added workflow migration coverage for fresh databases and direct migration application.
  - Added protocol OpenAPI route registration coverage for workflow endpoints.
  - Full coordinator and HTTP handler tests need a dedicated fake session/coordinator seam or stabilized in-process HTTP harness before they can be deterministic.
