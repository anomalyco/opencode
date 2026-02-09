# Multi-account OAuth Codex Rotation + Quota Optimization

## TL;DR

> **Quick Summary**: Harden existing multi-account Codex OAuth by making rotation deterministic and safe under concurrency, improving quota freshness semantics, and preventing retry/account-state corruption.
>
> **Deliverables**:
>
> - Deterministic, configurable rotation state machine with safe defaults
> - Concurrency-safe auth persistence updates for multi-account state
> - Robust 429/retry behavior with bounded retries + backoff/jitter
> - Consistent quota freshness surfaces across plugin/CLI/server
> - TDD coverage for rotation/quota/concurrency edge paths
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 6

---

## Context

### Original Request

Thorough and detailed analysis/review of implemented multi-account support for OAuth Codex rotation and quota status checks; identify problems and optimize according to best practices.

### Interview Summary

**Key Discussions**:

- Scope fixed to existing implementation, not greenfield rewrite.
- Strategy fixed to TDD.
- Focus fixed to reliability/correctness/perf/maintainability of rotation + quota path.

**Research Findings**:

- Core files: `packages/opencode/src/auth/index.ts`, `packages/opencode/src/plugin/codex.ts`, `packages/opencode/src/cli/cmd/auth.ts`, `packages/opencode/src/server/routes/provider.ts`.
- High-risk issues: shared `auth.json` race windows, recursive retry storm potential, placeholder-email identity collapse, weak tests on rotation/quota state machine.

### Metis Review

**Identified Gaps** (addressed in plan):

- Missing explicit policy contracts (rotation mode, stale quota semantics, retry budget).
- Missing persistence guardrails (atomic/conflict-safe writes).
- Missing acceptance tests for concurrency and failover paths.

---

## Work Objectives

### Core Objective

Make multi-account Codex selection/rotation/quota behavior deterministic, concurrency-safe, observable, and test-backed without broad architectural rewrite.

### Concrete Deliverables

- Rotation policy contract + implementation with default compatibility.
- Safe multi-writer persistence strategy for `auth.json` updates.
- Hardened retry/429 handling and account cooldown logic.
- Unified quota freshness/status contract across plugin, CLI, and provider route.
- New tests validating race, failover, and quota semantics.

### Definition of Done

- [ ] Targeted suites pass under TDD for auth rotation/quota behavior.
- [ ] No unbounded recursion/retry path remains in Codex request flow.
- [ ] Concurrent state updates do not lose `activeIndex`, account metadata, or usage/rate-limit fields.
- [ ] CLI list/usage and `/provider/codex/usage` show consistent freshness/error semantics.

### Must Have

- Preserve current external behavior by default unless policy flag explicitly changes it.
- Keep implementation scope confined to Codex multi-account path.
- Add deterministic tests for edge conditions and concurrency.

### Must NOT Have (Guardrails)

- No storage-backend rewrite beyond safe file-update strategy.
- No unrelated provider refactors.
- No manual-only verification steps.
- No silent account merges on placeholder identities.

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> All verification is agent-executable.

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: TDD
- **Framework**: `bun test`

### If TDD Enabled

Each task follows RED-GREEN-REFACTOR and includes command-level pass criteria.

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

Use Bash with deterministic command assertions for module/integration behavior; include negative/failure scenarios for each task.

---

## Execution Strategy

### Parallel Execution Waves

Wave 1 (Start Immediately):

- Task 1 (state-machine spec + failing tests)
- Task 5 (observability contract/tests scaffolding)

Wave 2 (After Wave 1):

- Task 2 (persistence safety)
- Task 3 (retry/backoff/cooldown hardening)

Wave 3 (After Wave 2):

- Task 4 (rotation policy + identity hardening)
- Task 6 (quota freshness consistency + endpoint/CLI alignment)

Wave 4 (After Wave 3):

- Task 7 (integration polish + regression matrix)

Critical Path: 1 -> 2 -> 3 -> 4 -> 6 -> 7

### Dependency Matrix

| Task | Depends On | Blocks  | Can Parallelize With |
| ---- | ---------- | ------- | -------------------- |
| 1    | None       | 2,3,4,6 | 5                    |
| 2    | 1          | 3,4,6,7 | 3                    |
| 3    | 1,2        | 4,7     | 2                    |
| 4    | 1,2,3      | 6,7     | None                 |
| 5    | None       | 7       | 1                    |
| 6    | 1,2,4      | 7       | None                 |
| 7    | 2,3,4,5,6  | None    | None                 |

---

## TODOs

- [ ] 1. Define Rotation/Quota State Machine + RED Tests

  **What to do**:
  - Write formal behavior contract for account states (active, rate-limited, stale-quota, invalid-token).
  - Add failing tests for selection, rate-limit expiry, stale quota semantics, and identity handling.

  **Must NOT do**:
  - No implementation changes before failing tests exist.

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `git-master`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 5)
  - **Blocks**: 2,3,4,6
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/auth/index.ts` - selection and persisted state mutation methods.
  - `packages/opencode/src/plugin/codex.ts` - runtime retry/429 and usage update behavior.
  - `packages/opencode/test/plugin/codex.test.ts` - existing test patterns.

  **Acceptance Criteria**:
  - [ ] RED tests added for rotation + quota state machine and initially fail.
  - [ ] `bun test packages/opencode/test/auth/codex-rotation.test.ts` -> FAIL (expected pre-implementation).

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: RED rotation tests fail first
    Tool: Bash
    Preconditions: test file exists, implementation unchanged
    Steps:
      1. Run: bun test packages/opencode/test/auth/codex-rotation.test.ts
      2. Assert: exit code != 0
      3. Assert: output includes failing rotation expectation
    Expected Result: test suite fails with known assertions
    Evidence: terminal output capture
  ```

- [ ] 2. Make Auth Persistence Conflict-Safe

  **What to do**:
  - Implement atomic/serialized update path for shared `auth.json` mutations.
  - Ensure concurrent calls do not lose account/usage/rate-limit fields.

  **Must NOT do**:
  - No backend migration away from file storage in this iteration.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3)
  - **Blocks**: 3,4,6,7
  - **Blocked By**: 1

  **References**:
  - `packages/opencode/src/auth/index.ts`
  - `packages/opencode/src/global/index.ts`

  **Acceptance Criteria**:
  - [ ] Concurrency tests pass for simultaneous mutation paths.
  - [ ] `bun test packages/opencode/test/auth/codex-concurrency.test.ts` -> PASS.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Concurrent writes preserve activeIndex and usage
    Tool: Bash
    Steps:
      1. Run targeted concurrency suite
      2. Assert: no lost update failures
      3. Assert: deterministic final auth state assertions pass
    Expected Result: stable pass under repeated runs
    Evidence: terminal output capture
  ```

- [ ] 3. Harden 429 Retry/Backoff and Cooldown Behavior

  **What to do**:
  - Replace unbounded recursive retry with bounded iterative retry budget.
  - Honor reset/retry headers when available; apply jittered backoff.

  **Must NOT do**:
  - No infinite retry; no stormy immediate retries.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 2)
  - **Blocks**: 4,7
  - **Blocked By**: 1,2

  **References**:
  - `packages/opencode/src/plugin/codex.ts`

  **Acceptance Criteria**:
  - [ ] Retry budget enforced.
  - [ ] Backoff/jitter tests pass for 429 sequences.
  - [ ] `bun test packages/opencode/test/plugin/codex-retry.test.ts` -> PASS.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: 429 sequence stops at retry cap
    Tool: Bash
    Steps:
      1. Run retry suite with mocked 429 responses
      2. Assert: retries <= configured cap
      3. Assert: failure path reports exhausted accounts safely
    Expected Result: bounded retries, no recursion overflow
    Evidence: test output capture
  ```

- [ ] 4. Rotation Policy + Account Identity Hardening

  **What to do**:
  - Implement policy gate for configurable rotation mode while keeping default compatibility.
  - Enforce canonical identity strategy; prevent placeholder-based merges.

  **Must NOT do**:
  - No default behavior flip without explicit config.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: 6,7
  - **Blocked By**: 1,2,3

  **References**:
  - `packages/opencode/src/auth/index.ts`
  - `packages/opencode/src/plugin/codex.ts`
  - `packages/opencode/src/cli/cmd/auth.ts`
  - `packages/opencode/src/config/config.ts`

  **Acceptance Criteria**:
  - [ ] Rotation mode behavior matches contract tests.
  - [ ] Identity merge safety tests pass with missing/placeholder email inputs.
  - [ ] `bun test packages/opencode/test/auth/codex-rotation-policy.test.ts` -> PASS.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Placeholder email does not merge distinct accounts
    Tool: Bash
    Steps:
      1. Run identity safety tests
      2. Assert: separate accounts remain separate with stable IDs
    Expected Result: no accidental account collapse
    Evidence: test output capture
  ```

- [ ] 5. Add Structured Telemetry for Rotation/Quota Decisions

  **What to do**:
  - Add structured events/counters for selection, failover, all-accounts-limited, stale quota.
  - Add tests for emitted event shape in key branches.

  **Must NOT do**:
  - No noisy per-token logging flood.

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: 7
  - **Blocked By**: None

  **References**:
  - `packages/opencode/src/plugin/codex.ts`
  - `packages/opencode/src/util/log.ts`

  **Acceptance Criteria**:
  - [ ] Telemetry tests verify structured payloads on failover/exhaustion branches.
  - [ ] `bun test packages/opencode/test/plugin/codex-observability.test.ts` -> PASS.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Failover emits structured event
    Tool: Bash
    Steps:
      1. Run observability suite
      2. Assert: event includes account id/email hash, reason, retry count
    Expected Result: deterministic telemetry shape
    Evidence: test output capture
  ```

- [ ] 6. Unify Quota Freshness Contract Across Plugin/CLI/Server

  **What to do**:
  - Define and enforce freshness states (`fresh|stale|unknown`) and TTL semantics.
  - Align `/provider/codex/usage` and CLI rendering to avoid unsafe assumptions on missing fields.

  **Must NOT do**:
  - No misleading quota status when data is stale/unknown.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: 7
  - **Blocked By**: 1,2,4

  **References**:
  - `packages/opencode/src/plugin/codex.ts`
  - `packages/opencode/src/server/routes/provider.ts`
  - `packages/opencode/src/cli/cmd/auth.ts`

  **Acceptance Criteria**:
  - [ ] Freshness semantics test-backed end-to-end.
  - [ ] `bun test packages/opencode/test/server/provider-codex-usage.test.ts` -> PASS.
  - [ ] `bun test packages/opencode/test/cli/auth-codex-list-usage.test.ts` -> PASS.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Missing resetAt handled safely in list output
    Tool: Bash
    Steps:
      1. Run CLI usage/list tests with missing reset fields
      2. Assert: no crash, status shown as unknown/stale contract
    Expected Result: resilient rendering
    Evidence: test output capture
  ```

- [ ] 7. Final Regression Matrix + Stability Verification

  **What to do**:
  - Run focused suites together and verify no regression in existing Codex behavior.
  - Confirm config-compat default behavior remains preserved.

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: None
  - **Blocked By**: 2,3,4,5,6

  **References**:
  - `packages/opencode/test/plugin/codex.test.ts`
  - New test files from Tasks 1-6

  **Acceptance Criteria**:
  - [ ] All targeted suites pass.
  - [ ] Existing plugin codex tests still pass.
  - [ ] No flaky failures across repeat runs.

  **Agent-Executed QA Scenarios**:

  ```bash
  Scenario: Full targeted codex reliability matrix
    Tool: Bash
    Steps:
      1. Run all targeted codex/auth/server/cli suites
      2. Repeat run at least twice
      3. Assert: consistent pass, no intermittent failures
    Expected Result: stable regression baseline
    Evidence: terminal output capture
  ```

---

## Commit Strategy

| After Task | Message                                                                | Verification                 |
| ---------- | ---------------------------------------------------------------------- | ---------------------------- |
| 1          | `test(codex): add failing rotation state-machine coverage`             | target test file fails (RED) |
| 2-3        | `fix(codex): harden auth persistence and retry failover`               | targeted suites pass         |
| 4-6        | `feat(codex): enforce rotation identity and quota freshness contracts` | targeted suites pass         |
| 7          | `test(codex): add regression matrix for multi-account quota flow`      | matrix pass                  |

---

## Success Criteria

### Verification Commands

```bash
bun test packages/opencode/test/auth/codex-rotation.test.ts
bun test packages/opencode/test/auth/codex-concurrency.test.ts
bun test packages/opencode/test/plugin/codex-retry.test.ts
bun test packages/opencode/test/plugin/codex-observability.test.ts
bun test packages/opencode/test/server/provider-codex-usage.test.ts
bun test packages/opencode/test/cli/auth-codex-list-usage.test.ts
bun test packages/opencode/test/plugin/codex.test.ts
```

### Final Checklist

- [ ] Rotation logic deterministic under configured policy.
- [ ] Shared auth persistence safe under concurrent updates.
- [ ] Retry behavior bounded and header-aware.
- [ ] Quota freshness/status consistent across plugin/CLI/server.
- [ ] Regression matrix green and stable.

---

## Defaults Applied

- Preserve current default behavior (`first available`) unless explicit config changes mode.
- Keep scope constrained to Codex multi-account path and directly coupled files.

## Decisions Needed

- None. User selected recommended defaults:
  - Rotation default: keep `first_available`, fairness mode opt-in.
  - Quota unknown policy: fail-open.
  - Retry budget: max retries per request = 2, jittered exponential backoff.

---

## Unresolved Questions

- none.
