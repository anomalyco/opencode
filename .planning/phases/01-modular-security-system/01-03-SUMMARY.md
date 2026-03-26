---
plan: 01-03
status: complete
completed: 2026-03-26
commit: 6b5069f
---

# Summary: Unit Tests for Config-Driven Enable/Disable Behavior

## What was done

- **Edited 3 existing test files** (ssrf, prompt-injection, path) to add `"config-driven behavior"` describe blocks
- **Created 3 new test files** (audit, rate-limiter, headers) for SEC-04, SEC-05, SEC-06
- **Fixed NUL byte handling in path.ts**: changed from stripping NUL bytes (and passing the cleaned path) to rejecting paths that contain NUL bytes (returning null) — correct security behavior
- Added top-level `beforeEach`/`afterEach` mock to prompt-injection and path test files to provide `Config.get()` context that the test environment cannot provide natively (AsyncLocalStorage not initialized)

## Test results: 32 pass, 0 fail

| File | Tests |
|------|-------|
| ssrf.test.ts | 9 (6 existing + 3 config-driven) |
| prompt-injection.test.ts | 8 (5 existing + 3 config-driven) |
| path.test.ts | 6 (3 existing + 3 config-driven) |
| audit.test.ts | 3 (new) |
| rate-limiter.test.ts | 3 (new) |
| headers.test.ts | 3 (new) |

## Coverage

Every module has tests for:
- **Default-on** (SEC-07): absent security key → module runs
- **Disabled**: `enabled: false` → module skips its logic
- **Enabled**: `enabled: true` → module runs

Phase 1 all 3 waves complete. Ready for PR to main.
