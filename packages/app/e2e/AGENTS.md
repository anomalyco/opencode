## Required Reading

- Before writing, changing, or reviewing E2E tests, ALWAYS read and follow Playwright's official [Best Practices](https://playwright.dev/docs/best-practices), [Auto-waiting](https://playwright.dev/docs/actionability), and [Assertions](https://playwright.dev/docs/test-assertions) guides.
- Use the official [Locators](https://playwright.dev/docs/locators), [Network](https://playwright.dev/docs/network), and [Test Isolation](https://playwright.dev/docs/browser-contexts) guides when those concerns apply.

## Test Hygiene

- Test user-visible behavior with isolated, deterministic data and scoped, unique locators.
- Prefer role, label, text, and explicit test-contract locators. Do not use `.first()` or `.last()` merely to silence strictness errors.
- Use locator actions, Playwright auto-waiting, and web-first assertions for observable readiness and outcomes.
- NEVER use `waitForTimeout`, `setTimeout`, sleeps, animation-frame counts, or other wall-clock delays to synchronize a test. Wait for the specific UI state, request, response, event, or application outcome instead.
- Do not treat navigation, a network response, DOM attachment, or visibility alone as proof that asynchronously rendered UI is ready. Assert the state the next action actually requires.
- Register event and network waits before the action that triggers them.
- Do not retry state-changing actions. Retry idempotent readiness checks, then perform the action once and assert its outcome.
- Keep action and assertion timeouts adaptive. Do not use short timeouts as readiness probes or rely on retries to hide flakes.
- Assert exact outcomes and identities so stale state, duplicate rendering, and interactions with the wrong element cannot pass.

## Test Ownership

- Each product area has one keeper suite in `regression/` (for example tabs, settings, review, terminal, timeline history). A new regression is a new case in that suite, not a new spec file.
- Build pages with the shared harness in `utils/` (`app.ts`, `workspace.ts`, `mock-server.ts` with `mockServers` and the mock PTY). Do not hand-write routing, storage seeding, or fixtures inside a spec. If the harness lacks something, add it to `utils/` once rather than copying setup.
- Files in `utils/` must not end in `.spec.ts` or `.test.ts`, or Playwright runs them as tests.
- Assert what the user sees and can do. Assert exact pixels or CSS values only when that measurement is the contract, and then only once, in the owning keeper.
- `performance/` holds benchmarks that CI does not run. Never prove correctness with a benchmark, and never copy benchmark code into a regression spec; import it from `utils/`.
