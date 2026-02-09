# Draft: Multi-account OAuth Codex Review

## Requirements (confirmed)

- User wants thorough analysis/review of implemented multi-account support for OAuth Codex.
- User wants detailed review of account rotation implementation.
- User wants detailed review of quota status checks.
- User wants optimization recommendations aligned with best practices.
- User wants iterative process with thorough validation.

## Technical Decisions

- Start with exhaustive context gathering in parallel (explore + librarian + direct code search).
- Treat this as refactoring/optimization planning, not immediate implementation.
- Treat this as high-risk reliability review (auth persistence + request-path rotation).

## Research Findings

- Implementation hotspots identified:
  - `packages/opencode/src/auth/index.ts` (multi-account schema, active index, rate-limit state, usage persistence)
  - `packages/opencode/src/plugin/codex.ts` (OAuth flow, Codex fetch interception, 429 detection, switch/retry, usage harvesting)
  - `packages/opencode/src/cli/cmd/auth.ts` (login/list/switch/usage workflows)
  - `packages/opencode/src/server/routes/provider.ts` (`/codex/usage` endpoint, concurrent usage fetches)
- Current behavior observed:
  - Selection path uses `getActiveCodexAccount()` for requests and `getNextAvailableCodexAccount()` on rate limit.
  - Rotation currently selects first non-rate-limited account; no runtime-configurable round-robin found in code path.
  - Usage persisted from both `/wham/usage` fetch and response headers.
  - Default reset fallback is 5h when limit reset parse fails.
- High-risk findings (initial):
  - Login still allows fallback email `"unknown"` in OAuth result handling.
  - `setCodexAccount()` dedupes by `email`/`accountId`; placeholder emails can collapse distinct accounts.
  - `auth list` uses non-null assertion on `rateLimit.resetAt` while schema permits missing `resetAt`.
  - Persistence is read-modify-write on shared `auth.json`; concurrent updates can race.
  - `/codex/usage` does parallel per-account fetch + write, which can amplify race windows.
  - Device OAuth polling loop can run indefinitely without timeout/cancellation in headless flow.
  - Recursive retry on 429 in `codexFetch()` can amplify storms under concurrent failures.
- Test coverage snapshot (initial):
  - `packages/opencode/test/plugin/codex.test.ts` focuses on JWT/account-id extraction helpers.
  - No direct tests found yet for rotation selection, fairness mode, 429 retry loops, or concurrent usage update safety.
  - No direct integration test found for `/provider/codex/usage` mixed success/failure semantics.
- External best-practice anchors collected:
  - Token lifecycle discipline (short-lived access, robust refresh handling, stable account IDs).
  - Strict rate-limit header honoring (`Retry-After`, reset windows), per-account throttling/queues.
  - Exponential backoff + jitter for 429 handling.
  - Strong telemetry on quota windows/fairness.

## Test Strategy Decision

- **Infrastructure exists**: YES (`packages/opencode` Bun tests).
- **Automated tests**: [DECISION NEEDED]
- **Automated tests**: YES (TDD) ✅
- **Agent-Executed QA**: ALWAYS (mandatory regardless of test choice).

## Open Questions

- Exact scope boundary for "fix them": planning-only vs immediate execution after plan handoff.
- Acceptable behavior changes vs strict behavior preservation.
- Required validation strategy preference (TDD/tests-after/no-unit-tests + agent QA).
- Rotation policy target: resolved -> keep first-available default, fairness opt-in.
- Quota unknown policy: resolved -> fail-open.
- Retry budget: resolved -> max retries=2 with jittered exponential backoff.

## Scope Boundaries

- INCLUDE: multi-account OAuth Codex, rotation flow, quota status checks, robustness/performance/maintainability risks.
- EXCLUDE: unrelated provider/account systems unless directly coupled.
