---
wave: 2
depends_on: [01-PLAN-1.md]
files_modified:
  - packages/opencode/src/security/prompt-injection.ts
  - packages/opencode/src/security/path.ts
  - packages/opencode/src/security/audit.ts
  - packages/opencode/src/security/rate-limiter.ts
  - "# plus any call site files discovered by grep"
autonomous: true
requirements: [SEC-02, SEC-03, SEC-04, SEC-05]
---

# Plan 2: Discover and Guard Remaining 4 Module Call Sites

## Objective

The research phase confirmed only 2 of 6 module call sites. This plan greps the full source tree to find where `scanForInjection`, `safePath`, `new RateLimiter`, and `defaultAuditLog.log` are called, then applies `!== false` config guards at every discovered call site.

## Tasks

<task id="T1">
<title>Discover all call sites for the 4 unconfirmed modules</title>
<read_first>
- packages/opencode/src/security/prompt-injection.ts — read to confirm exported function name is `scanForInjection`
- packages/opencode/src/security/path.ts — read to confirm exported function name is `safePath`
- packages/opencode/src/security/audit.ts — read to confirm exported singleton name is `defaultAuditLog` and method is `.log()`
- packages/opencode/src/security/rate-limiter.ts — read to confirm class name is `RateLimiter` and constructor signature `{ maxTokens, refillRate, refillIntervalMs }`
</read_first>
<action>
Run these four grep commands across the full packages/opencode/src/ tree (excluding security/ itself):

```bash
grep -rn "scanForInjection" /home/jkang/cobuilder-opencode/packages/opencode/src/ --include="*.ts" | grep -v "/security/"
grep -rn "safePath" /home/jkang/cobuilder-opencode/packages/opencode/src/ --include="*.ts" | grep -v "/security/"
grep -rn "new RateLimiter\|RateLimiter(" /home/jkang/cobuilder-opencode/packages/opencode/src/ --include="*.ts" | grep -v "/security/"
grep -rn "defaultAuditLog\|\.log(" /home/jkang/cobuilder-opencode/packages/opencode/src/ --include="*.ts" | grep -v "/security/"
```

Document every file:line hit. For each hit, read the surrounding 10 lines to understand the async context (is the function already inside an `async` function that can `await Config.get()`?).

**If a module has zero external call sites:** Document this explicitly in a comment at the top of that module's source file: `// SEC-XX: No external call sites found as of 2026-03-26. Guard is in module itself.` Then add the guard directly inside the module's exported function/method as a module-level self-guard (see action in T2).

**If a module has call sites:** Record them for T2.
</action>
<acceptance_criteria>
- All 4 grep commands run to completion with zero shell errors
- A written inventory exists (add as a comment block at top of this plan or in a scratch file at .planning/phases/01-modular-security-system/call-site-inventory.txt) listing every call site found or "NONE" for each module
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun build src/security/prompt-injection.ts src/security/path.ts src/security/audit.ts src/security/rate-limiter.ts --no-bundle 2>&1 | grep -c "error" → 0 (no regressions from reading)
</acceptance_criteria>
</task>

<task id="T2">
<title>Apply config guards to all 4 modules at discovered call sites (SEC-02, SEC-03, SEC-04, SEC-05)</title>
<read_first>
- Every call site file discovered in T1 — read each to understand async context before editing
- packages/opencode/src/security/prompt-injection.ts — if self-guard needed
- packages/opencode/src/security/path.ts — if self-guard needed
- packages/opencode/src/security/audit.ts — if self-guard needed
- packages/opencode/src/security/rate-limiter.ts — if self-guard needed
</read_first>
<action>
For each module, apply the appropriate guard pattern:

**SEC-02 — Prompt injection (`scanForInjection`):**
At each call site (or inside the function if no external call sites):
```typescript
const cfg = await Config.get()
if (cfg.security?.promptInjection?.enabled !== false) {
  const result = scanForInjection(input)
  // existing handling...
}
```
If self-guarding inside the module, make the function async if it is not already.

**SEC-03 — Path traversal (`safePath`):**
```typescript
const cfg = await Config.get()
if (cfg.security?.pathTraversal?.enabled !== false) {
  return safePath(inputPath, root)
}
return inputPath // passthrough when disabled
```

**SEC-04 — Audit log (`defaultAuditLog.log`):**
```typescript
const cfg = await Config.get()
if (cfg.security?.auditLog?.enabled !== false) {
  defaultAuditLog.log(entry)
}
```
If self-guarding inside the `log()` method of the audit module, make the method async.

**SEC-05 — Rate limiter (`RateLimiter`):**
At the instantiation/consume site:
```typescript
const cfg = await Config.get()
if (cfg.security?.rateLimiting?.enabled !== false) {
  const limiter = new RateLimiter({
    maxTokens: cfg.security?.rateLimiting?.maxTokens ?? DEFAULT_MAX_TOKENS,
    refillRate: cfg.security?.rateLimiting?.refillRate ?? DEFAULT_REFILL_RATE,
    refillIntervalMs: cfg.security?.rateLimiting?.refillIntervalMs ?? DEFAULT_REFILL_INTERVAL_MS,
  })
  const allowed = limiter.consume(tokens)
  if (!allowed) { /* existing rejection logic */ }
}
```
Replace DEFAULT_* with the hardcoded values currently in the source. This makes rate limiter parameters configurable per SEC-05.

All guards use `!== false` (not `=== true`) for SEC-07 default-on compliance.
Ensure `Config` is imported in every modified file.
</action>
<acceptance_criteria>
- grep -rn "security?.promptInjection?.enabled !== false" /home/jkang/cobuilder-opencode/packages/opencode/src/ → at least 1 hit
- grep -rn "security?.pathTraversal?.enabled !== false" /home/jkang/cobuilder-opencode/packages/opencode/src/ → at least 1 hit
- grep -rn "security?.auditLog?.enabled !== false" /home/jkang/cobuilder-opencode/packages/opencode/src/ → at least 1 hit
- grep -rn "security?.rateLimiting?.enabled !== false" /home/jkang/cobuilder-opencode/packages/opencode/src/ → at least 1 hit
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun build src/security/ --no-bundle 2>&1 | grep -c "error" → 0
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun test src/security --timeout 30000 (existing tests must still pass — no regressions)
</acceptance_criteria>
</task>

## Verification

```bash
cd /home/jkang/cobuilder-opencode/packages/opencode

# All 6 guards exist (2 from Plan 1, 4 from Plan 2)
grep -rn "!== false" src/ --include="*.ts" | grep "security?" | wc -l
# Expected: >= 6

# No build errors
bun build src/security/ --no-bundle 2>&1 | grep "error"
# Expected: no output

# Existing tests pass
bun test src/security --timeout 30000
# Expected: all pass
```

## must_haves

truths:
- Every security module has a guard that respects `cfg.security?.MODULE?.enabled !== false`
- A user can disable any of the 4 modules by setting `"security": { "MODULE": { "enabled": false } }` in opencode.json
- Disabling a module does not crash — the call site gracefully skips the module's logic
- Existing tests (written before this phase) continue to pass

artifacts:
- path: .planning/phases/01-modular-security-system/call-site-inventory.txt
  provides: Record of every external call site found for all 6 modules
- path: packages/opencode/src/security/prompt-injection.ts
  provides: scanForInjection guarded by cfg.security?.promptInjection?.enabled !== false
- path: packages/opencode/src/security/path.ts
  provides: safePath guarded by cfg.security?.pathTraversal?.enabled !== false
- path: packages/opencode/src/security/audit.ts
  provides: defaultAuditLog.log guarded by cfg.security?.auditLog?.enabled !== false
- path: packages/opencode/src/security/rate-limiter.ts
  provides: RateLimiter instantiation guarded by cfg.security?.rateLimiting?.enabled !== false with configurable constructor params

key_links:
- from: call site files (discovered in T1)
  to: packages/opencode/src/config/config.ts
  via: Config.get() → cfg.security?.MODULE?.enabled
- from: packages/opencode/src/security/rate-limiter.ts
  to: packages/opencode/src/config/config.ts
  via: cfg.security?.rateLimiting?.maxTokens/refillRate/refillIntervalMs fed into RateLimiter constructor
