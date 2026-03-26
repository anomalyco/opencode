---
wave: 1
depends_on: []
files_modified:
  - packages/opencode/src/config/config.ts
  - packages/opencode/src/cli/cmd/onboard.ts
  - packages/opencode/src/server/server.ts
autonomous: true
requirements: [SEC-01, SEC-06, SEC-07]
---

# Plan 1: Security Config Schema + Confirmed Call Site Guards

## Objective

Add the `security` Zod sub-object to `Config.Info` and apply `!== false` guards at the two confirmed call sites (SSRF in onboard.ts and headers in server.ts). This is the foundation that all other plans depend on — the schema must exist before any call site guard can reference it.

## Tasks

<task id="T1">
<title>Add `security` key to Config.Info Zod schema</title>
<read_first>
- packages/opencode/src/config/config.ts — must read to find line ~1038 where `export const Info = z.object({` is defined and the `.strict()` call (line ~1230) to insert the new key correctly
</read_first>
<action>
Read config.ts and locate `export const Info = z.object({`. Find the closing `}).strict()`. Insert the following field inside the z.object, following the same structural pattern as the `compaction` key (found near line 1196):

```typescript
security: z
  .object({
    ssrf: z.object({ enabled: z.boolean().optional() }).optional(),
    promptInjection: z.object({ enabled: z.boolean().optional() }).optional(),
    pathTraversal: z.object({ enabled: z.boolean().optional() }).optional(),
    auditLog: z.object({ enabled: z.boolean().optional() }).optional(),
    rateLimiting: z
      .object({
        enabled: z.boolean().optional(),
        maxTokens: z.number().int().positive().optional(),
        refillRate: z.number().int().positive().optional(),
        refillIntervalMs: z.number().int().positive().optional(),
      })
      .optional(),
    headers: z.object({ enabled: z.boolean().optional() }).optional(),
  })
  .optional()
  .describe("Per-module security configuration. All modules enabled by default."),
```

No imports needed — Zod (`z`) is already imported. No changes to mergeDeep logic needed — the schema covers all config layers automatically.

CRITICAL: The key must be inside the `z.object({...})` before the `.strict()` call. Adding it after `.strict()` will cause a TypeScript error.
</action>
<acceptance_criteria>
- grep "security:" packages/opencode/src/config/config.ts → found (inside the Info z.object)
- grep "rateLimiting:" packages/opencode/src/config/config.ts → found
- grep "promptInjection:" packages/opencode/src/config/config.ts → found
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun build src/config/config.ts --no-bundle 2>&1 | grep -c "error" → 0
</acceptance_criteria>
</task>

<task id="T2">
<title>Guard SSRF call site in onboard.ts (SEC-01)</title>
<read_first>
- packages/opencode/src/cli/cmd/onboard.ts — must read to locate the validateProviderURL call at line ~63 and understand surrounding async context
</read_first>
<action>
Read onboard.ts and locate the `validateProviderURL(baseURL, ...)` call (research confirms it is at line ~63). Wrap it with a config guard:

```typescript
// Before the validateProviderURL call, add:
const cfg = await Config.get()
if (cfg.security?.ssrf?.enabled !== false) {
  const ssrfCheck = validateProviderURL(baseURL, { allowLocalhost: true })
  if (!ssrfCheck.ok) {
    prompts.log.error(ssrfCheck.reason)
    process.exit(1)
  }
}
```

If `Config` is not already imported in onboard.ts, add: `import { Config } from "../../config/config"` (adjust relative path to match actual file location).

Use `!== false` (not `=== true`) so absent config key means enabled — this is the SEC-07 default-on guarantee.
</action>
<acceptance_criteria>
- grep "security?.ssrf?.enabled !== false" packages/opencode/src/cli/cmd/onboard.ts → found
- grep "Config.get()" packages/opencode/src/cli/cmd/onboard.ts → found
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun build src/cli/cmd/onboard.ts --no-bundle 2>&1 | grep -c "error" → 0
</acceptance_criteria>
</task>

<task id="T3">
<title>Guard security headers call site in server.ts (SEC-06)</title>
<read_first>
- packages/opencode/src/server/server.ts — must read lines 110-130 to locate the getSecurityHeaders() Hono middleware block at line ~119
</read_first>
<action>
Read server.ts and locate the Hono middleware block that calls `getSecurityHeaders()` (confirmed at line ~119). Replace the existing unconditional call with:

```typescript
.use(async (c, next) => {
  await next()
  const cfg = await Config.get()
  if (cfg.security?.headers?.enabled !== false) {
    const headers = getSecurityHeaders()
    for (const [key, value] of Object.entries(headers)) {
      c.res.headers.set(key, value)
    }
  }
})
```

If `Config` is not already imported in server.ts, add the import. The existing `getSecurityHeaders` import stays unchanged.

Use `!== false` for SEC-07 compliance.
</action>
<acceptance_criteria>
- grep "security?.headers?.enabled !== false" packages/opencode/src/server/server.ts → found
- grep "Config.get()" packages/opencode/src/server/server.ts → found
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun build src/server/server.ts --no-bundle 2>&1 | grep -c "error" → 0
</acceptance_criteria>
</task>

## Verification

```bash
cd /home/jkang/cobuilder-opencode/packages/opencode
bun build src/config/config.ts src/cli/cmd/onboard.ts src/server/server.ts --no-bundle 2>&1 | grep "error"
# Expected: no output (zero errors)
```

## must_haves

truths:
- An existing opencode.json without a "security" key loads without Zod parse errors
- Setting `"security": { "ssrf": { "enabled": false } }` in opencode.json causes the SSRF check in onboard.ts to be skipped
- Setting `"security": { "headers": { "enabled": false } }` causes getSecurityHeaders() to not be called in server.ts
- All three modified files compile without TypeScript errors

artifacts:
- path: packages/opencode/src/config/config.ts
  provides: Zod schema accepting security.ssrf/promptInjection/pathTraversal/auditLog/rateLimiting/headers keys
- path: packages/opencode/src/cli/cmd/onboard.ts
  provides: SSRF guard using !== false pattern
- path: packages/opencode/src/server/server.ts
  provides: Security headers guard using !== false pattern

key_links:
- from: packages/opencode/src/cli/cmd/onboard.ts
  to: packages/opencode/src/config/config.ts
  via: Config.get() → cfg.security?.ssrf?.enabled
- from: packages/opencode/src/server/server.ts
  to: packages/opencode/src/config/config.ts
  via: Config.get() → cfg.security?.headers?.enabled
