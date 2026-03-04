# Idle Prompt Bar Failure Fix

## TL;DR

> **Summary**: Ensure the idle prompt bar cycles visibly by fixing the render trigger and hardening the TUI harness/baseline comparison to catch regressions.
> **Deliverables**: Idle cycle renders reliably, sandbox harness robust to model/line selection, upstream-vs-fork baseline runner, verified evidence.
> **Effort**: Medium
> **Parallel**: YES - 2 waves
> **Critical Path**: Implement idle render trigger -> Harness/baseline updates -> Verification

## Context

### Original Request

/plan make a plan to address the idle failure which would make the feature work

### Interview Summary

- Test strategy: tests-after.
- Idle cycling only when PromptBarState == "idle" (keep non-idle precedence).

### Metis Review (gaps addressed)

- Metis consultation timed out; proceeded with internal gap analysis and explicit guardrails in tasks.

## Work Objectives

### Core Objective

Fix the idle prompt bar visual update so the cycle is visible when idle, while keeping non-idle states unchanged.

### Deliverables

- Prompt bar idle cycle triggers a render tick in TUI and visibly changes background when idle/empty.
- Harness scripts accept repo/evidence/model overrides and reliably detect idle background changes.
- Fork vs upstream baseline runner for strict diffs.
- Verification evidence for harness, baseline, and tests/build.

### Definition of Done (verifiable conditions with commands)

- `bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh idle` exits 0 and reports "Evidence OK".
- `bash /home/choza/projects/opencode-source/scripts/compare-tui-baseline.sh idle` completes and outputs diff (if any) without stopping on upstream idle failure.
- `export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd packages/opencode typecheck; bun run --cwd packages/opencode test; bun run --cwd packages/opencode build` completes without errors.

### Must Have

- Idle cycle visible in idle/empty state without altering non-idle states.
- Harness checks compare prompt bar background reliably even when placeholder/model text changes.
- Baseline comparison supports upstream worktree and isolated evidence directories.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No changes to non-TUI subsystems or opencode-effects.
- No changes to prompt bar state precedence or non-idle visuals.
- No removal of existing harness checks; only additive/robustness changes.

## Verification Strategy

> ZERO HUMAN INTERVENTION - all verification is agent-executed.

- Test decision: tests-after with bun test + harness/baseline scripts.
- QA policy: Every task has agent-executed scenarios.
- Evidence: .sisyphus/evidence/task-{N}-{slug}.txt

## Execution Strategy

### Parallel Execution Waves

Wave 1: Idle render fix, harness/baseline script hardening
Wave 2: Verification runs (idle harness, baseline compare, typecheck/tests/build)

### Dependency Matrix (full, all tasks)

- T1 -> T3, T4
- T2 -> T3, T4
- T3 -> (none)
- T4 -> (none)

### Agent Dispatch Summary (wave -> task count -> categories)

- Wave 1: 2 tasks -> unspecified-high
- Wave 2: 2 tasks -> unspecified-high

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [x] 1. Add explicit render tick for idle cycle in Prompt

  **What to do**: In `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`, update the idle-cycle `createEffect` to call `renderer.requestRender()` whenever the idle tick increments. Keep the existing `setInterval` cadence (1s) and guard on `promptBarState() === "idle"`, `!hasPromptContent()`, and `animations_enabled`. Ensure the render request only happens while the prompt is visible (respect `props.visible !== false`). Do not alter prompt bar state precedence or overlay palette.
  **Must NOT do**: Do not change `derivePromptBarState` precedence or the overlay palette in `prompt-bar-visual.ts`.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Targeted UI behavior fix with TUI context.
  - Skills: [] - Reason: No special skills required beyond code navigation.
  - Omitted: [`playwright`] - Reason: TUI verification uses bash scripts.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 4] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` - idle cycle `setInterval` and `promptBarBackground` memo.
  - API/Type: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-state.ts` - prompt bar state precedence.
  - API/Type: `packages/opencode/src/cli/cmd/tui/util/prompt-bar-visual.ts` - overlay palette mapping.
  - Pattern: `packages/opencode/src/cli/cmd/tui/app.tsx` - TUI render configuration (`targetFps: 60`).

  **Acceptance Criteria** (agent-executable only):

- [x] `rg -n "requestRender" packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx` shows the idle-cycle interval calling `renderer.requestRender()`.
- [x] `OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh idle` exits 0 with "Evidence OK".

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Idle background changes on tick
    Tool: Bash
    Steps: OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh idle
    Expected: Script exits 0 and prints "Evidence OK: idle".
    Evidence: .sisyphus/evidence/task-1-idle-harness.txt

  Scenario: Idle check fails when captures identical
    Tool: Bash
    Steps: cp /home/choza/projects/opencode-source/.sisyphus/evidence/task-2-idle-a.txt /home/choza/projects/opencode-source/.sisyphus/evidence/task-2-idle-b.txt; bash /home/choza/projects/opencode-source/.sisyphus/evidence/check-sandbox-evidence.sh idle
    Expected: Script exits non-zero and prints "Idle prompt bar background did not change".
    Evidence: .sisyphus/evidence/task-1-idle-fail.txt
  ```

  **Commit**: YES | Message: `fix(tui): render idle prompt bar cycle` | Files: [`packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx`]

- [x] 2. Harden sandbox harness + add upstream baseline comparison

  **What to do**: Update `.sisyphus/evidence/run-sandbox-tui.sh` to accept `OPENCODE_SANDBOX_REPO_ROOT`, `OPENCODE_SANDBOX_OPENCODE_DIR`, `OPENCODE_SANDBOX_EVIDENCE_DIR`, and `OPENCODE_SANDBOX_MODEL`, and pass these into the check script. Update `.sisyphus/evidence/check-sandbox-evidence.sh` to select the prompt-bar line using model text (e.g., `GPT-5.2` or `OpenAI`) before falling back to `Build`/`Ask anything`. Add `scripts/compare-tui-baseline.sh` to run fork and upstream harness captures in isolated evidence dirs and produce diffs; ensure it continues even if upstream idle check fails and supports `OPENCODE_SANDBOX_MODEL` via env.
  **Must NOT do**: Do not change TUI runtime code in this task.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Bash scripting with TUI harness context.
  - Skills: [] - Reason: No special skills required.
  - Omitted: [`playwright`] - Reason: Bash + tmux harness only.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [3, 4] | Blocked By: []

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `.sisyphus/evidence/run-sandbox-tui.sh` - harness entry point.
  - Pattern: `.sisyphus/evidence/check-sandbox-evidence.sh` - idle background validation.
  - Pattern: `packages/opencode/src/provider/models.ts` - model source used by dev builds.

  **Acceptance Criteria** (agent-executable only):

- [x] `bash -n .sisyphus/evidence/run-sandbox-tui.sh` and `bash -n .sisyphus/evidence/check-sandbox-evidence.sh` exit 0.
- [x] `bash -n scripts/compare-tui-baseline.sh` exits 0.
- [x] `OPENCODE_SANDBOX_MODEL=<valid> bash scripts/compare-tui-baseline.sh idle` runs both harnesses and prints diffs without aborting on upstream idle failure.

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Baseline runner completes with model override
    Tool: Bash
    Steps: OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/scripts/compare-tui-baseline.sh idle
    Expected: Both fork and upstream harnesses run; diff output is produced; script exits 0.
    Evidence: .sisyphus/evidence/task-2-baseline.txt

  Scenario: Missing idle evidence files is detected
    Tool: Bash
    Steps: OPENCODE_SANDBOX_EVIDENCE_DIR=/tmp/oc-empty bash /home/choza/projects/opencode-source/.sisyphus/evidence/check-sandbox-evidence.sh idle
    Expected: Script exits non-zero and reports missing idle evidence files.
    Evidence: .sisyphus/evidence/task-2-baseline-error.txt
  ```

  **Commit**: YES | Message: `chore(tui): harden sandbox harness and baseline compare` | Files: [`.sisyphus/evidence/run-sandbox-tui.sh`, `.sisyphus/evidence/check-sandbox-evidence.sh`, `scripts/compare-tui-baseline.sh`]

- [x] 3. Verify idle cycle in fork vs upstream baseline

  **What to do**: Run idle harness and baseline comparison with a known-valid model string for your account. If `OPENCODE_SANDBOX_MODEL` is unset, default it to `openai/gpt-4o-mini` before running. Save evidence logs to `.sisyphus/evidence` and confirm fork passes idle check while upstream shows no idle background change.
  **Must NOT do**: Do not modify code; verification only.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Verification scripting and evidence capture.
  - Skills: [] - Reason: Bash-only validation.
  - Omitted: [`playwright`] - Reason: TUI harness uses tmux.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1, 2]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `.sisyphus/evidence/run-sandbox-tui.sh`
  - Pattern: `scripts/compare-tui-baseline.sh`

  **Acceptance Criteria** (agent-executable only):

- [x] `OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh idle` exits 0.
- [x] `OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/scripts/compare-tui-baseline.sh idle` completes and prints diff output.

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Fork idle harness passes
    Tool: Bash
    Steps: OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/.sisyphus/evidence/run-sandbox-tui.sh idle
    Expected: "Evidence OK: idle" appears and exit code is 0.
    Evidence: .sisyphus/evidence/task-3-idle-pass.txt

  Scenario: Upstream baseline shows no idle change
    Tool: Bash
    Steps: OPENCODE_SANDBOX_MODEL=<valid> bash /home/choza/projects/opencode-source/scripts/compare-tui-baseline.sh idle
    Expected: Output includes upstream idle failure message and diff output.
    Evidence: .sisyphus/evidence/task-3-idle-upstream.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [x] 4. Run opencode package verification (typecheck, tests, build)

  **What to do**: With bun on PATH (`export PATH="$HOME/.bun/bin:$PATH"`), run typecheck, tests, and build for `packages/opencode` from repo root to ensure no regressions.
  **Must NOT do**: Do not run root `bun test`; use package-scoped commands only.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` - Reason: Full verification run with tooling.
  - Skills: [] - Reason: Standard bun scripts.
  - Omitted: [`playwright`] - Reason: Not needed for CLI/TUI tests.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [] | Blocked By: [1, 2]

  **References** (executor has NO interview context - be exhaustive):
  - Pattern: `packages/opencode/package.json` - scripts `typecheck`, `test`, `build`.
  - Pattern: `package.json` - root scripts note not to run tests from root.

  **Acceptance Criteria** (agent-executable only):

- [x] `export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd packages/opencode typecheck` exits 0.
- [x] `export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd packages/opencode test` exits 0.
- [x] `export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd packages/opencode build` exits 0.

  **QA Scenarios** (MANDATORY - task incomplete without these):

  ```
  Scenario: Typecheck + test + build succeed
    Tool: Bash
    Steps: export PATH="$HOME/.bun/bin:$PATH"; bun run --cwd packages/opencode typecheck; bun run --cwd packages/opencode test; bun run --cwd packages/opencode build
    Expected: All commands exit 0; build artifacts generated without errors.
    Evidence: .sisyphus/evidence/task-4-verify.txt

  Scenario: Test command misuse is blocked
    Tool: Bash
    Steps: bun run test
    Expected: Command exits non-zero with "do not run tests from root".
    Evidence: .sisyphus/evidence/task-4-verify-error.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [x] F1. Plan Compliance Audit - oracle
- [x] F2. Code Quality Review - unspecified-high
- [x] F3. Real Manual QA - unspecified-high (+ playwright if UI)
- [x] F4. Scope Fidelity Check - deep

## Commit Strategy

- Commit 1: `fix(tui): render idle prompt bar cycle` (prompt component change)
- Commit 2: `chore(tui): harden sandbox harness and baseline compare`

## Success Criteria

- Idle prompt bar visibly changes at least once across two idle captures in sandbox.
- Baseline comparison produces deterministic diffs between fork and upstream without false negatives.
- Typecheck, tests, and build complete without errors.
