---
plan: 01-02
status: complete
completed: 2026-03-26
commit: 95a390e
---

# Summary: Discover and Guard Remaining 4 Module Call Sites

## What was done

- Grepped full source tree for `scanForInjection`, `safePath`, `new RateLimiter`, `defaultAuditLog` — all 4 had zero external production call sites
- Applied self-guards inside each module:
  - `prompt-injection.ts`: `scanForInjection` made async, reads Config, skips when `cfg.security?.promptInjection?.enabled === false`
  - `path.ts`: `safePath` reads Config, bypasses traversal check when disabled (passthrough mode)
  - `audit.ts`: `AuditLog.log()` returns early when `cfg.security?.auditLog?.enabled === false`
  - `rate-limiter.ts`: Added `static async consumeIfEnabled()` factory that respects config; reads `maxTokens`/`refillRate`/`refillIntervalMs` from config with defaults
- Updated test files to use async signatures
- Typecheck passed with zero errors

## Artifacts

- `call-site-inventory.txt` — documents NONE for all 4 modules
- `packages/opencode/src/security/prompt-injection.ts` — guarded
- `packages/opencode/src/security/path.ts` — guarded
- `packages/opencode/src/security/audit.ts` — guarded
- `packages/opencode/src/security/rate-limiter.ts` — guarded with configurable params

## All 6 modules now guarded

| Module | Guard location | Enabled key |
|--------|---------------|-------------|
| SSRF | onboard.ts call site | `security.ssrf.enabled` |
| Security headers | server.ts call site | `security.headers.enabled` |
| Prompt injection | self-guard in module | `security.promptInjection.enabled` |
| Path traversal | self-guard in module | `security.pathTraversal.enabled` |
| Audit log | self-guard in module | `security.auditLog.enabled` |
| Rate limiter | static factory method | `security.rateLimiting.enabled` |
