# Required Execution Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register or reconcile an Execution run before the root controller starts any approved Superpowers plan, and pause when reporting is unavailable.

**Architecture:** A global controller instruction is the fallback when the companion is absent; the companion reporting skill and transient context reminder reinforce the same preflight when present. The root controller performs the durable read/write; neither the read-only UI nor the plugin's context hook infers plan approval or creates a run. This is cooperative controller enforcement, not host-side tool blocking.

**Tech Stack:** OpenCode V2 plugin (Bun/TypeScript), Superpowers skill Markdown, Bun tests, installation-wide `~/.config/opencode/AGENTS.md`.

**Spec:** `docs/superpowers/specs/2026-09-22-execution-tracking-reliability-design.md`

**Rollout:** Build and verify this integration and the companion header plan first. Install the new global policy only after both are ready; its required-tool preflight applies to subsequent plan executions, not to this bootstrap development work.

## Global Constraints

- This is a controller-workflow requirement, not a host-enforced authorization boundary.
- No plan text or agent activity is parsed into task state; the UI and read-only RPC never create runs.
- A registered plugin, successful capability check, visible badge, local ledger, or attempted call is not a persisted run.
- Only the root controller writes; preserve actual ancestry, location ownership, revision checks, and evidence gates.
- Once the policy is activated, missing reporting tools or persistence pauses subsequent approved-plan implementation and new implementer dispatch; recovery starts with `execution_read`.
- Do not restart the running app or server while debugging or verifying.
- Do not edit generated client files or cached external Superpowers skills.

## Review Focus

1. Missing plugin/tool on a new plan: controller policy explicitly pauses before implementation (Task 1 policy test).
2. Active run with a different plan hash: do not silently resume it (Task 1 policy test).
3. Session lookup failure: context hook emits a diagnostic and retries, never admits a run (Task 2 regression).
4. Child controller: no root reporting reminder or permission to write (Task 2 regression).
5. Storage/revision failure after work started: stop new dispatch, request cooperative worker stop, reconcile before resume (Task 1 policy test).

---

## File responsibilities

- `~/.config/opencode/AGENTS.md`: installation-wide, plugin-independent root controller preflight; preserve all existing routing rules.
- `packages/superpowers-execution/skills/superpowers-execution-reporting/SKILL.md`: exact tool sequence, pause and recovery policy.
- `packages/superpowers-execution/src/reporting.ts`: short root-only transient reminder and skill description.
- `packages/superpowers-execution/test/reporting.test.ts`: skill/hook contract regressions.
- `packages/superpowers-execution/README.md`: portable installation-wide policy excerpt and deployment guidance.

### Task 1: Package the mandatory preflight and recovery policy

**Files:**
- Modify: `packages/superpowers-execution/skills/superpowers-execution-reporting/SKILL.md:1-43,202-223`
- Modify: `packages/superpowers-execution/README.md`
- Test: `packages/superpowers-execution/test/reporting.test.ts`

**Interfaces:**
- Consumes: existing `execution_read` and `execution_report` tool contract in `src/plugin.ts` and `src/schema.ts`.
- Produces: the root-controller rule `read approved plan + SHA-256 -> execution_read -> matching active run or persisted run.start -> begin plan work`; no TypeScript interface changes.

- [ ] **Step 1: Write a failing instruction-contract test.** Extend the packaged-skill test in `test/reporting.test.ts` to check for the mandatory sequence and pause semantics, and reject the old continuation text:

```ts
expect(skill.content).toContain("Before implementation or implementer dispatch")
expect(skill.content).toContain("matching plan")
expect(skill.content).toContain("pause")
expect(skill.content).toContain("cooperative safe stop")
expect(skill.content).not.toContain("keep executing the plan")
expect(skill.content).not.toContain("Continue the underlying Superpowers work")
```

Add a test that reads the maintained global-policy excerpt in `README.md` (not the machine-specific home file) and asserts `execution_read`, `run.start`, `pause`, `plan hash`, and `different plan`. Do not assert merely that a file exists: check the exact preflight obligations. Make the policy excerpt a fenced `text` block headed `### Required global controller policy` so the test can select it. Replace the existing test assertion expecting `tracking is degraded` with one requiring paused execution; keep the existing `UNRUN` gate assertion.

- [ ] **Step 2: Demonstrate red.** From `packages/superpowers-execution`, run `bun test ./test/reporting.test.ts`; expect the new instruction-contract assertions to fail on the current advisory/degraded wording.
- [ ] **Step 3: Package policy and skill.** Include the following rule under `### Required global controller policy` in the package README; do not activate it in the machine's global AGENTS file until Task 3, after both plans are verified:

```text
Before implementation or implementer dispatch for an approved Superpowers plan, the root controller must read the approved plan, compute its plan hash, load superpowers-execution-reporting, call execution_read, then reconcile a matching plan run or persist execution_report run.start with the complete graph, gates, and final review. A run for a different plan is not a match. Do not begin plan work until registration succeeds. If the reporting skill, tools, or storage are unavailable, pause implementation and new dispatch, state the blocker, and allow only read-only diagnosis. If workers are already running, request a cooperative safe stop; do not claim they were automatically paused. After recovery, execution_read and reconcile before resuming. Never substitute a local ledger, badge, or capabilities response for persisted registration.
```

Update the skill's opening/workflow/failure sections to place the same preflight before native work; compare `plan.sha256` with the active run before resuming; require successful persisted registration or a matching read; remove instructions to keep executing on absence/failure. Preserve the existing gate-evidence, root authorization, and no-auto-admission rules. Document that a global instructions change is installation-local and distributed via the README excerpt; do not edit cached external Superpowers skills. Do not restart the server.

Use this opening workflow contract in the skill (the existing detailed JSON examples remain beneath it):

```md
Before implementation or implementer dispatch, read the approved plan, compute its SHA-256, and call `execution_read`. Resume only an active run for the matching plan path and hash. If no run exists, persist `execution_report` `run.start` with the full graph and final-review gate before starting work. If another active plan exists, pause and ask for reconciliation rather than replacing it. If the skill, either tool, or storage is unavailable, pause implementation and dispatch, disclose the blocker, and allow only read-only diagnosis. Request a cooperative safe stop for already-running workers. After recovery, call `execution_read` and reconcile before resuming.
```

- [ ] **Step 4: Demonstrate green.** Run `bun test ./test/reporting.test.ts` from `packages/superpowers-execution` and inspect the README excerpt against the test contract.
- [ ] **Step 5: Commit repo files.** `git add packages/superpowers-execution/skills/superpowers-execution-reporting/SKILL.md packages/superpowers-execution/README.md packages/superpowers-execution/test/reporting.test.ts` then `git commit -m "fix(superpowers): require reporting before plan work"`.

### Task 2: Root reminder reinforces the same preflight

**Files:**
- Modify: `packages/superpowers-execution/src/reporting.ts:11-44`
- Modify: `packages/superpowers-execution/test/reporting.test.ts:22-94,175-230`

**Interfaces:**
- Consumes: `ReportingReminderInput` and `createReportingContextHook` as currently exported; `readActiveRun` remains read-only.
- Produces: `reportingReminder(input: ReportingReminderInput): string` with mandatory preflight and active-run reconciliation; no API signature changes.

- [ ] **Step 1: Write the failing hook tests.** Keep the existing root/child, deduplication, no-write, and lookup-retry tests. Add assertions for both no-run and active-run cases:

```ts
expect(harness.reminders(context)[0]).toContain("Before implementing an approved Superpowers plan")
expect(harness.reminders(context)[0]).toContain("execution_read")
expect(harness.reminders(context)[0]).toContain("execution_report")
expect(harness.reminders(context)[0]).toContain("pause")
expect(reportingReminder({ rootSessionID: "root", runID: "run-1", revision: 3 })).toContain("reconcile")
expect(harness.storage.writes()).toBe(0)
```

Use the no-run context test for the first four assertions and the active-run test for the revision/reconcile assertion. Preserve the lookup failure test, confirming no reminder is added on failure and it appears after recovery; the hook never creates a run.

- [ ] **Step 2: Demonstrate red.** Run `bun test ./test/reporting.test.ts` from `packages/superpowers-execution`; expect the newly required wording assertions to fail.
- [ ] **Step 3: Make the reminder directive.** Replace `may load` with an imperative root-only preflight in `reportingReminder`: before an approved plan, load the named skill, call `execution_read`, register through `execution_report` if no matching run, pause if unavailable, and never start a run for an ordinary session. For active runs, mention the run ID/revision and reconcile with the approved plan before work. Keep the existing marker, idempotent `containsReportingReminder`, and readonly `readActiveRun` lookup. Update `reportingSkillDescription` to say that using this skill is required before approved-plan execution.

```ts
const base = `${reportingReminderMarker} Root controller for ${input.rootSessionID}: Before implementing an approved Superpowers plan or dispatching implementers, load ${reportingSkillID}, read the approved plan and call execution_read. Reconcile a matching active run or persist execution_report run.start before work. If reporting is unavailable, pause implementation and dispatch. Do not start a run during brainstorming or just because this session exists.`
if (input.runID === undefined || input.revision === undefined) return base
return `${base} Active run ${input.runID} is at revision ${input.revision}; call execution_read and reconcile its plan before continuing.`
```
- [ ] **Step 4: Demonstrate green.** Run `bun test ./test/reporting.test.ts`, then `bun test` and `bun run typecheck` from `packages/superpowers-execution`. For package distribution, run `bun run build` and package smoke checks from that package; an installed service requires separate deployment and is not verified by source tests.
- [ ] **Step 5: Check the packaged contract boundary.** Run `bun run package:smoke` and `bun run package:host-smoke` in `packages/superpowers-execution` using the disposable host; verify the root hook and tool catalog. This checks delivery, not model compliance. Verify the README policy excerpt and packaged skill direct pause on missing tools/storage and plan-hash mismatch; do not claim a host-enforced block or that a transcript necessarily contains reports.
- [ ] **Step 6: Run canonical check and commit.** From repo root run `bun run check`. If it fails, distinguish regressions from unrelated failures before modifying code. Record exact command results for handoff. `git add packages/superpowers-execution/src/reporting.ts packages/superpowers-execution/test/reporting.test.ts` then `git commit -m "fix(superpowers): make reporting preflight explicit"`.

### Task 3: Activate the installation-wide preflight after both fixes

**Files:**
- Modify: `/root/.config/opencode/AGENTS.md` only after Tasks 1-2 and `docs/superpowers/plans/2026-09-22-execution-header-layout.md` are implemented and verified.

**Interfaces:** Consumes the exact README policy excerpt from Task 1. Produces installation-wide instructions for **subsequent** approved-plan executions; no plugin or tool API changes.

- [ ] **Step 1: Confirm prerequisites.** Read the verification results of both plans and confirm the reporting package smoke checks and header checks passed. Confirm the required global-policy excerpt exists in the package README. Do not activate it if either integration is still incomplete.
- [ ] **Step 2: Install policy.** Append the exact policy text quoted in Task 1 to `/root/.config/opencode/AGENTS.md` without replacing any existing routing or workflow instructions; keep it under an `## Approved Superpowers plan execution` heading. Do not restart the running app or server.
- [ ] **Step 3: Verify installation.** Re-read only the new heading and rule, check it matches the README excerpt, and report that activation applies to future controller contexts. If the running process has not loaded the new companion package, report that deployment gap explicitly rather than claiming the live Map is fixed. The global file is outside this Git repository, so no repo commit is made for this step.
