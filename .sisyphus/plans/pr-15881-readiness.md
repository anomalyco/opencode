# PR 15881 Fork Merge Readiness

## TL;DR

> **Summary**: Validate the current `feat/prompt-bar-parent-color` branch with exhaustive tests and sandbox verification, then merge it directly into fork `dev` (no upstream PR) and branch off for continued animation work.
> **Deliverables**: Verified test/evidence set, fork `dev` merged with current branch, new animation branch created.
> **Effort**: Medium
> **Parallel**: YES - 3 waves
> **Critical Path**: Scope inventory → Test matrix → Merge to fork dev → New animation branch

## Context

### Original Request

"get this PR completed and ready after we do all of our exaustive testing and feature work" + "current branch is the one that we intend to eventually merge" + do not open upstream PRs.

### Interview Summary

- Keep current branch scope and merge into fork `dev` as-is.
- Do not open PRs against the upstream repo; fork-only merge.
- Continue animation work on a new branch after the merge.

### Metis Review (gaps addressed)

Metis consultation timed out; internal gap review applied with explicit guardrails and acceptance criteria for scope, tests, and fork-only merge.

## Work Objectives

### Core Objective

Merge `feat/prompt-bar-parent-color` into fork `dev` after exhaustive verification, then branch for continued animation work without upstream PRs.

### Deliverables

- Verified test/evidence logs for prompt-bar regressions, CI-equivalent tests, and sandbox baseline.
- Fork `dev` updated with `feat/prompt-bar-parent-color` changes.
- New branch off fork `dev` for animation follow-up (spatial ripple plan).

### Definition of Done (verifiable conditions with commands)

- `bun run --cwd packages/opencode test:prompt-bar-regressions` exits 0.
- `bun run --cwd packages/opencode test` exits 0.
- `bun run --cwd packages/opencode typecheck` exits 0.
- `bun run --cwd packages/opencode build` exits 0.
- `bun turbo test` exits 0.
- `bun --cwd packages/app test:e2e:local` exits 0.
- `bash scripts/run-sandbox-suite.sh` and `bash scripts/compare-tui-baseline.sh idle` complete with expected output.
- `fork/dev` contains all commits from `feat/prompt-bar-parent-color` with no upstream PR created.
- New branch `feat/prompt-bar-spatial-ripple` exists off `fork/dev`.

### Must Have

- No upstream PR creation.
- Fork-only merge into `fork/dev`.
- Exhaustive tests and evidence captured locally.
- Follow-up branch created for animation work.

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)

- No rebasing or rewriting shared history.
- No upstream PRs or pushes to `origin`.
- No scope reduction or cleanup unless explicitly requested.

## Verification Strategy

> ZERO HUMAN INTERVENTION — all verification is agent-executed.

- Test decision: tests-after using bun + Playwright.
- QA policy: Every task has agent-executed scenarios.
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.txt`.

## Execution Strategy

### Parallel Execution Waves

Wave 1: Scope inventory + branch sync
Wave 2: Test matrix + sandbox/baseline checks
Wave 3: Merge to fork dev + create animation branch

### Dependency Matrix (full, all tasks)

- Task 1 → Task 2
- Tasks 3, 4, 5 → Task 6

### Agent Dispatch Summary (wave → task count → categories)

- Wave 1 → 2 tasks → unspecified-high
- Wave 2 → 3 tasks → unspecified-high
- Wave 3 → 1 task → unspecified-high

## TODOs

> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Inventory branch scope and verify fork-only constraints

  **What to do**: Capture a full diff inventory against `origin/dev`, categorize changed files (code/tests/harness/evidence/docs), and confirm there are no secrets or upstream-only artifacts that would block a fork-only merge. Record results in evidence.
  **Must NOT do**: Do not modify or delete any files. Do not open upstream PRs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Git scope analysis and compliance checks.
  - Skills: [`git-master`] — Required for git diff/branch inspection.
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: [2] | Blocked By: []

  **References** (executor has NO interview context — be exhaustive):
  - Scope diff: `git diff --name-only origin/dev...HEAD`
  - Evidence directory: `.sisyphus/evidence/`
  - Pre-commit guard: `.husky/pre-commit`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `git diff --name-only origin/dev...HEAD` captured to `.sisyphus/evidence/task-1-scope.txt`.
  - [ ] `git diff --stat origin/dev...HEAD` captured to the same evidence file.
  - [ ] `rg -n "(API_KEY|SECRET|TOKEN|sk-)" .sisyphus/evidence` returns no hits; output recorded.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Scope inventory captured
    Tool: Bash
    Steps: git diff --name-only origin/dev...HEAD | tee .sisyphus/evidence/task-1-scope.txt
    Expected: Evidence file lists all changed files.
    Evidence: .sisyphus/evidence/task-1-scope.txt

  Scenario: Secret scan clean
    Tool: Bash
    Steps: rg -n "(API_KEY|SECRET|TOKEN|sk-)" .sisyphus/evidence | tee -a .sisyphus/evidence/task-1-scope.txt
    Expected: No matches; evidence shows empty output.
    Evidence: .sisyphus/evidence/task-1-scope.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [ ] 2. Sync feature branch with fork/dev (no rebase)

  **What to do**: Ensure the feature branch is up to date with `fork/dev` using a merge (no rebase). Resolve conflicts by keeping prompt-bar related changes from the branch and preferring `fork/dev` for unrelated files. Record merge status and resulting commit list.
  **Must NOT do**: Do not rebase or force-push. Do not push to `origin`.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Git synchronization and conflict handling.
  - Skills: [`git-master`] — Required for safe merge handling.
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: [3, 4, 5] | Blocked By: [1]

  **References** (executor has NO interview context — be exhaustive):
  - Branch: `feat/prompt-bar-parent-color`
  - Fork base: `fork/dev`
  - Git remote check: `git remote -v`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `git fetch fork` completed without errors.
  - [ ] `git merge fork/dev` completes with no unresolved conflicts.
  - [ ] `git log --oneline fork/dev..HEAD` captured to `.sisyphus/evidence/task-2-merge.txt`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Branch merges cleanly
    Tool: Bash
    Steps: git checkout feat/prompt-bar-parent-color; git fetch fork; git merge fork/dev; git status -sb | tee .sisyphus/evidence/task-2-merge.txt
    Expected: Working tree clean; merge is complete.
    Evidence: .sisyphus/evidence/task-2-merge.txt

  Scenario: Conflict resolution log (if conflicts occur)
    Tool: Bash
    Steps: git diff --name-only --diff-filter=U | tee -a .sisyphus/evidence/task-2-merge.txt
    Expected: Conflicts list is empty after resolution.
    Evidence: .sisyphus/evidence/task-2-merge.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [ ] 3. Run prompt-bar regression suite and opencode package checks

  **What to do**: Run the prompt-bar regressions and package-level tests/build/typecheck for `packages/opencode`. Use package-scoped commands (do not run tests from repo root).
  **Must NOT do**: Do not run `bun test` from repo root.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: multi-command verification run.
  - Skills: []
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [2]

  **References** (executor has NO interview context — be exhaustive):
  - Scripts: `packages/opencode/package.json` (`test`, `typecheck`, `build`, `test:prompt-bar-regressions`).
  - Guard: `packages/opencode/AGENTS.md` (tests not from repo root).

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun run --cwd packages/opencode test:prompt-bar-regressions` exits 0.
  - [ ] `bun run --cwd packages/opencode test` exits 0.
  - [ ] `bun run --cwd packages/opencode typecheck` exits 0.
  - [ ] `bun run --cwd packages/opencode build` exits 0.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Prompt-bar regression suite passes
    Tool: Bash
    Steps: bun run --cwd packages/opencode test:prompt-bar-regressions | tee .sisyphus/evidence/task-3-prompt-regressions.txt
    Expected: Exit code 0 and no failures.
    Evidence: .sisyphus/evidence/task-3-prompt-regressions.txt

  Scenario: Package test/build/typecheck pass
    Tool: Bash
    Steps: bun run --cwd packages/opencode test | tee .sisyphus/evidence/task-3-opencode-checks.txt; bun run --cwd packages/opencode typecheck | tee -a .sisyphus/evidence/task-3-opencode-checks.txt; bun run --cwd packages/opencode build | tee -a .sisyphus/evidence/task-3-opencode-checks.txt
    Expected: All commands exit 0.
    Evidence: .sisyphus/evidence/task-3-opencode-checks.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [ ] 4. Run CI-equivalent test matrix locally

  **What to do**: Execute repo root typecheck and unit tests plus app e2e. Match CI workflows: `bun typecheck`, `bun turbo test`, `bun --cwd packages/app test:e2e:local` after installing Playwright.
  **Must NOT do**: Do not run `bun test` from repo root; use `bun turbo test`.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: CI-equivalent verification.
  - Skills: [`playwright`] — Required for app e2e.
  - Omitted: []

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [2]

  **References** (executor has NO interview context — be exhaustive):
  - CI workflow: `.github/workflows/test.yml` (unit + e2e).
  - CI workflow: `.github/workflows/typecheck.yml`.
  - App tests: `packages/app/package.json` (`test:e2e:local`).

  **Acceptance Criteria** (agent-executable only):
  - [ ] `bun typecheck` exits 0.
  - [ ] `bun turbo test` exits 0.
  - [ ] `bun --cwd packages/app test:e2e:local` exits 0.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Root typecheck + unit tests pass
    Tool: Bash
    Steps: bun typecheck | tee .sisyphus/evidence/task-4-ci-unit.txt; bun turbo test | tee -a .sisyphus/evidence/task-4-ci-unit.txt
    Expected: Exit code 0 for both commands.
    Evidence: .sisyphus/evidence/task-4-ci-unit.txt

  Scenario: App e2e passes
    Tool: Bash
    Steps: cd packages/app; bunx playwright install --with-deps; bun test:e2e:local | tee ../../.sisyphus/evidence/task-4-ci-e2e.txt
    Expected: Exit code 0 and no failures.
    Evidence: .sisyphus/evidence/task-4-ci-e2e.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [ ] 5. Run sandbox harness suite and baseline compare

  **What to do**: Run the sandbox suite for non-idle states and run baseline comparison for idle state. Provide required env variables for API key and upstream comparison directory; capture evidence outputs.
  **Must NOT do**: Do not alter harness scripts or evidence files beyond capturing logs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: TUI harness + baseline verification.
  - Skills: []
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: [6] | Blocked By: [2]

  **References** (executor has NO interview context — be exhaustive):
  - Harness: `scripts/run-sandbox-suite.sh`
  - TUI runner: `scripts/run-sandbox-tui.sh`
  - Baseline compare: `scripts/compare-tui-baseline.sh`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `--openai-api-key` (or `--openai-api-key-cmd`) provided; suite completes.
  - [ ] `bash scripts/run-sandbox-suite.sh` output captured.
  - [ ] `bash scripts/compare-tui-baseline.sh idle` completes and logs normalized parity output.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Sandbox suite completes
    Tool: Bash
    Steps: bash scripts/run-sandbox-suite.sh --openai-api-key "***" | tee .sisyphus/evidence/task-5-sandbox-suite.txt
    Expected: All states run without errors.
    Evidence: .sisyphus/evidence/task-5-sandbox-suite.txt

  Scenario: Baseline compare for idle
    Tool: Bash
    Steps: OPENCODE_UPSTREAM_DIR=/tmp/opencode-upstream OPENCODE_BENCH_EVIDENCE_DIR=.sisyphus/evidence/task-5-baseline bash scripts/compare-tui-baseline.sh idle | tee .sisyphus/evidence/task-5-baseline.txt
    Expected: Script completes and prints normalized parity output.
    Evidence: .sisyphus/evidence/task-5-baseline.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

- [ ] 6. Merge to fork/dev and create follow-up animation branch

  **What to do**: Merge the feature branch into fork `dev`, push to fork, then create a new branch off fork `dev` for the animation follow-up plan. Do not open upstream PRs.
  **Must NOT do**: Do not push to `origin` or open upstream PRs.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: Git merge + branch management.
  - Skills: [`git-master`] — Required for safe merges.
  - Omitted: [`playwright`] — Not needed.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: [] | Blocked By: [3, 4, 5]

  **References** (executor has NO interview context — be exhaustive):
  - Merge target: `fork/dev`
  - Feature branch: `feat/prompt-bar-parent-color`
  - Follow-up plan: `.sisyphus/plans/prompt-bar-spatial-ripple.md`

  **Acceptance Criteria** (agent-executable only):
  - [ ] `fork/dev` contains all commits from `feat/prompt-bar-parent-color`.
  - [ ] `git push fork dev` succeeds.
  - [ ] New branch `feat/prompt-bar-spatial-ripple` created off fork `dev`.

  **QA Scenarios** (MANDATORY — task incomplete without these):

  ```
  Scenario: Merge and push to fork dev
    Tool: Bash
    Steps: git checkout -B dev fork/dev; git merge feat/prompt-bar-parent-color; git push fork dev; git log --oneline fork/dev..HEAD | tee .sisyphus/evidence/task-6-merge.txt
    Expected: No commits listed after push; merge completed.
    Evidence: .sisyphus/evidence/task-6-merge.txt

  Scenario: Create follow-up branch
    Tool: Bash
    Steps: git checkout -b feat/prompt-bar-spatial-ripple fork/dev; git branch --show-current | tee -a .sisyphus/evidence/task-6-merge.txt
    Expected: Current branch is `feat/prompt-bar-spatial-ripple`.
    Evidence: .sisyphus/evidence/task-6-merge.txt
  ```

  **Commit**: NO | Message: `n/a` | Files: []

## Final Verification Wave (4 parallel agents, ALL must APPROVE)

- [ ] F1. Plan Compliance Audit — oracle
- [ ] F2. Code Quality Review — unspecified-high
- [ ] F3. Real Manual QA — unspecified-high (+ playwright if UI)
- [ ] F4. Scope Fidelity Check — deep

## Commit Strategy

- No new commits expected; keep existing history.
- Merge into fork `dev` via fast-forward if possible; otherwise use a merge commit.

## Success Criteria

- Fork `dev` reflects `feat/prompt-bar-parent-color` and passes all verification steps.
- No upstream PRs opened.
- New animation branch created and ready for next plan execution.
