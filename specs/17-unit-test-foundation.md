## Unit test foundation

Establish reliable unit coverage for core app logic.

---

### Summary

`packages/app` is heavily e2e-focused but has very little active unit coverage in `src`, and both existing unit test files are currently skipped. This spec creates a stable unit-test baseline that runs quickly in CI/local and catches logic regressions earlier.

---

### Goals

- Add a clear unit-test command for app source tests.
- Unskip and stabilize existing skipped unit tests.
- Add fast tests for high-value pure logic.
- Keep unit suite independent of full e2e environment.

---

### Non-goals

- No replacement of e2e tests.
- No broad product-code refactors unless required to make logic testable.
- No flaky browser-automation tests added here.

---

### Parallel ownership (important)

This workstream owns:

- `packages/app/package.json` (test scripts only)
- `packages/app/happydom.ts` (if harness tweaks are needed)
- `packages/app/src/**/*.test.ts`
- `packages/app/src/**/*.test.tsx`

This workstream should avoid editing product code files owned by other specs, unless a tiny testability export is strictly required.

---

### Current state

- Unit tests in `src` are limited and skipped:
  - `src/context/layout-scroll.test.ts` (`test.skip`)
  - `src/addons/serialize.test.ts` (`describe.skip`)
- Test scripts focus on Playwright e2e.

---

### Proposed approach

1. Add dedicated unit-test script(s), for example:

- `test:unit` using Bun test + happydom preload where needed.

2. Unskip and stabilize existing tests:

- make `layout-scroll.test.ts` deterministic
- enable a reliable subset of `serialize.test.ts` (or split smoke vs heavy integration cases)

3. Add new fast unit tests for pure logic already exposed by source:

- keybind parsing/formatting/matching (`context/command.tsx` exports)
- worktree state machine (`utils/worktree.ts`)

---

### Phased steps

1. Wire `test:unit` in `package.json`.
2. Make existing skipped tests runnable and stable.
3. Add at least 2 new unit test files for core pure logic.
4. Ensure unit suite can run standalone without Playwright server setup.

---

### Acceptance criteria

- `bun run test:unit` exists and passes locally.
- No full-file `describe.skip`/`test.skip` remains in `packages/app/src/**/*.test.*` (unless documented as intentionally quarantined with reason).
- Unit suite includes meaningful assertions for keybind + worktree logic.
- Runtime for unit suite remains fast (target: under 15 seconds locally, excluding first install).

---

### Validation plan

- Run: `bun run test:unit`.
- Run: `bun run typecheck`.
- Verify unit tests can execute without starting full app/backend servers.

---

### Handoff notes

- Keep tests implementation-focused, not duplicated business logic.
- Avoid mocks where practical; prefer real small-scope code paths.
- If integration-heavy serialize cases remain flaky, separate them into a clearly named non-default test target.
