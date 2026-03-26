# Phase 1: Modular Security System - Research

**Researched:** 2026-03-26
**Domain:** TypeScript security module configuration, Zod schema extension, CoBuilder config system
**Confidence:** HIGH

## Summary

CoBuilder currently has 6 security modules in `packages/opencode/src/security/` — all are stateless pure functions or class instances instantiated unconditionally at module load time. None of them read from config. The task is to add a `security` key to the `Config.Info` Zod schema and thread that config into each module's call sites.

The config system is well-understood: it uses Zod (not Effect Schema), merges multiple sources via `mergeDeep`, exposes a single `Config.get()` async function, and the schema is the `.strict()` Zod object `Config.Info` defined at line 1038 of `config.ts`. Adding `security` follows exactly the same pattern as existing keys like `compaction`, `permission`, and `mcp`.

The onboard wizard (`onboard.ts`) writes directly to `opencode.json` using `Filesystem.writeJson`. A security configuration step can be inserted after the provider setup step — or deferred entirely since all modules default to enabled (zero-config backward compatibility guaranteed).

**Primary recommendation:** Add a `security` Zod sub-object to `Config.Info`, thread config via `Config.get()` at each call site, and wrap each module's hot path in an `if (cfg.security?.ssrf?.enabled !== false)` guard (default-on via `!== false`).

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SEC-01 | SSRF module individually configurable via opencode.json | `validateProviderURL` called in onboard.ts line 63 and potentially other provider fetch sites — guard wraps the call |
| SEC-02 | Prompt injection module individually configurable | `scanForInjection` is a pure function — guard wraps call sites |
| SEC-03 | Path traversal module individually configurable | `safePath` is a pure function — guard wraps call sites |
| SEC-04 | Audit log module individually configurable | `defaultAuditLog.log(...)` call sites — guard disables log writes when disabled |
| SEC-05 | Rate limiting module individually configurable | `RateLimiter` class instantiated at call site — guard skips `consume()` or skips instantiation |
| SEC-06 | Security headers module individually configurable | `getSecurityHeaders()` called in server.ts line 119 — guard returns empty object when disabled |
| SEC-07 | All modules default to enabled; existing configs work without changes | Achieved via `!== false` guard pattern or `z.default(true)` in schema |
</phase_requirements>

---

## Project Constraints (from CLAUDE.md)

No CONTEXT.md exists for this phase. CLAUDE.md constraints applicable to this phase:

- Use Bun as runtime (`bun test` for tests, `bun:test` imports)
- All agents must use `9router_local` adapter (not relevant to this code phase)
- Never use `claude_local` (not relevant)
- Context-mode MCP tools preferred over Bash for large output (tooling constraint, not code constraint)
- Token optimization via TOON format for JSON responses

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | Already in project | Config schema validation | Already used throughout `config.ts` — `Config.Info` is a Zod object |
| bun:test | Bun built-in | Unit testing | Already used in all 3 existing security test files |
| remeda `mergeDeep` | Already in project | Deep-merge config objects | Already used in config.ts merge logic |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@clack/prompts` | Already in project | Wizard UI | If adding onboard security step (SEC-07 scope question) |

**Installation:** No new packages required. All needed libraries are already in the project.

---

## Architecture Patterns

### Recommended Security Config Schema

```typescript
// Add inside Config.Info z.object({...}):
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

### Default-On Guard Pattern (SEC-07)

Use `!== false` rather than `=== true` so that absent config (`undefined`) means enabled:

```typescript
// Source: verified pattern — works because undefined !== false
const cfg = await Config.get()
if (cfg.security?.ssrf?.enabled !== false) {
  const check = validateProviderURL(url, opts)
  // ...
}
```

This guarantees zero-config backward compatibility: any existing `opencode.json` without a `security` key continues to work identically.

### Module Call Site Inventory

| Module | Call Site File | Call Site Pattern |
|--------|---------------|-------------------|
| SSRF (`validateProviderURL`) | `src/cli/cmd/onboard.ts:63` | Direct call, result checked |
| Security headers (`getSecurityHeaders`) | `src/server/server.ts:119` | Called in Hono middleware, result iterated |
| Prompt injection (`scanForInjection`) | Unknown — no Grep hit outside security/ | Must search broader codebase |
| Path traversal (`safePath`) | Unknown — no Grep hit outside security/ | Must search broader codebase |
| Rate limiter (`RateLimiter`) | Unknown — class instantiation site | Must find instantiation |
| Audit log (`defaultAuditLog`) | Unknown — exported singleton | Must find `.log()` call sites |

The planner must include a task to grep for all call sites of `scanForInjection`, `safePath`, `new RateLimiter`, and `defaultAuditLog.log` before writing guard code.

### Config Access Pattern (existing standard)

```typescript
// Source: config.ts:1340, used throughout codebase
const cfg = await Config.get()
// Then access: cfg.security?.ssrf?.enabled
```

`Config.get()` is async and returns `Config.Info` (the Zod output type). All call sites already `await` it. The security guard code follows identical patterns already used for `cfg.compaction?.auto`, `cfg.permission`, etc.

### Schema Registration Location

The `Info` Zod object is defined at `config.ts:1038` as `export const Info = z.object({...}).strict()`. The `.strict()` call means **any unknown key causes a Zod parse error at startup** — the `security` key MUST be added to the schema before any config file uses it, or existing configs with a `security` key will fail to load.

### Anti-Patterns to Avoid

- **Adding `security` to only global config but not project config:** Config merging is layered — the schema governs all layers. One schema addition covers all.
- **Using `=== true` as the guard:** This breaks existing deployments (absent key = disabled, violating SEC-07).
- **Instantiating `RateLimiter` unconditionally then checking enabled at `consume()`:** Prefer checking before instantiation if possible, but checking at `consume()` is acceptable for simplicity.
- **Bypassing `Config.get()` in favor of reading the JSON file directly:** Always use `Config.get()`, which handles all config layers, merging, and caching.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Config validation | Custom JSON validator | Zod (already in `Config.Info`) | Zod handles `.strict()`, type inference, `.optional()` defaults — zero extra code |
| Deep merge of partial security config | Custom merge | `remeda.mergeDeep` (already in config.ts) | Already handles nested optional objects correctly |
| Test framework | Any new test runner | `bun:test` | Already used in all 3 existing test files; `bun test --timeout 30000` is the test command |

---

## Common Pitfalls

### Pitfall 1: `.strict()` Schema Rejection
**What goes wrong:** A user adds `"security": {...}` to their `opencode.json` before the schema is updated, causing Zod parse failure at startup ("Unrecognized key(s) in object: 'security'").
**Why it happens:** `Config.Info` uses `.strict()` at line 1230.
**How to avoid:** Add the `security` key to the Zod schema in the same commit/task as any other changes. Never ship a config file example before the schema accepts it.
**Warning signs:** Zod validation error mentioning "security" at startup.

### Pitfall 2: Missing Call Sites
**What goes wrong:** Guards are added for modules that appear unused in obvious files, but there are hidden call sites deeper in the session/tool layer.
**Why it happens:** `scanForInjection`, `safePath`, `RateLimiter`, and `defaultAuditLog` were not found in non-security source files by the initial Grep (only `validateProviderURL` in onboard.ts and `getSecurityHeaders` in server.ts were confirmed). This does NOT mean the others have no call sites — they may be in session, tool, or other layers not yet searched.
**How to avoid:** The plan MUST include a task to grep the full `packages/opencode/src/` tree for each of the 4 unconfirmed modules before writing guard code.
**Warning signs:** Module appears "unused" — this is suspicious for security code and warrants verification.

### Pitfall 3: RateLimiter Constructor Options Not Configurable
**What goes wrong:** `RateLimiter` takes `{ maxTokens, refillRate, refillIntervalMs }` in its constructor — if instantiated with hardcoded values, the config options for those fields are ignored at runtime even though they appear in the schema.
**Why it happens:** The class stores values at construction time.
**How to avoid:** The guard code must pass `cfg.security?.rateLimiting?.maxTokens ?? DEFAULT` etc. into the constructor, not hardcoded values.

### Pitfall 4: Onboard Wizard Config Write Overwrites Security Key
**What goes wrong:** `onboard.ts` does `{ ...existing, model: ..., provider: ... }` spread — if a user has manually added `security` to their config, the wizard preserves it correctly (spread preserves all existing keys). This is safe.
**Why it happens:** The spread pattern is `{ ...existing, newKey: value }` — existing keys not in the spread are preserved.
**How to avoid:** No action needed — existing pattern is correct.

---

## Code Examples

### Pattern: Adding a key to Config.Info (existing example — `compaction`)
```typescript
// Source: config.ts:1196 — verified existing pattern
compaction: z
  .object({
    auto: z.boolean().optional().describe("Enable automatic compaction when context is full (default: true)"),
    prune: z.boolean().optional().describe("Enable pruning of old tool outputs (default: true)"),
    reserved: z.number().int().min(0).optional().describe("Token buffer for compaction."),
  })
  .optional(),
```
The `security` key follows this exact structural pattern.

### Pattern: Guarding a pure function call site
```typescript
// Apply at validateProviderURL call site in onboard.ts:63
const cfg = await Config.get()
if (cfg.security?.ssrf?.enabled !== false) {
  const ssrfCheck = validateProviderURL(baseURL, { allowLocalhost: true })
  if (!ssrfCheck.ok) {
    prompts.log.error(ssrfCheck.reason)
    process.exit(1)
  }
}
```

### Pattern: Guarding getSecurityHeaders in Hono middleware
```typescript
// Apply in server.ts:117-123
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

### Pattern: Existing test file structure (bun:test)
```typescript
// Source: src/security/__tests__/ssrf.test.ts:1
import { describe, test, expect } from "bun:test"
import { validateProviderURL } from "../ssrf"

describe("SSRF Protection", () => {
  test("allows valid HTTPS URLs", () => {
    expect(validateProviderURL("https://api.openai.com/v1").ok).toBe(true)
  })
})
```
New tests for config-driven behavior follow this same structure.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | bun:test (Bun built-in) |
| Config file | None — Bun auto-discovers `*.test.ts` |
| Quick run command | `cd /home/jkang/cobuilder-opencode/packages/opencode && bun test src/security --timeout 30000` |
| Full suite command | `cd /home/jkang/cobuilder-opencode/packages/opencode && bun test --timeout 30000` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEC-01 | SSRF disabled via config skips validateProviderURL | unit | `bun test src/security/__tests__/ssrf.test.ts` | Partial — needs config-driven tests added |
| SEC-02 | Prompt injection disabled via config skips scanForInjection | unit | `bun test src/security/__tests__/prompt-injection.test.ts` | Partial — needs config-driven tests added |
| SEC-03 | Path traversal disabled via config skips safePath | unit | `bun test src/security/__tests__/path.test.ts` | Partial — needs config-driven tests added |
| SEC-04 | Audit log disabled via config skips log writes | unit | `bun test src/security/__tests__/audit.test.ts` | No — Wave 0 gap |
| SEC-05 | Rate limiter disabled via config allows all requests | unit | `bun test src/security/__tests__/rate-limiter.test.ts` | No — Wave 0 gap |
| SEC-06 | Headers disabled via config returns empty headers object | unit | `bun test src/security/__tests__/headers.test.ts` | No — Wave 0 gap |
| SEC-07 | Absent security key = all modules enabled (default-on) | unit | All above tests include absent-key case | No — needs additions |

### Wave 0 Gaps
- [ ] `src/security/__tests__/audit.test.ts` — covers SEC-04
- [ ] `src/security/__tests__/rate-limiter.test.ts` — covers SEC-05
- [ ] `src/security/__tests__/headers.test.ts` — covers SEC-06
- [ ] Config-guard test cases added to existing ssrf/prompt-injection/path tests — covers SEC-01, SEC-02, SEC-03, SEC-07

---

## Environment Availability

Step 2.6: SKIPPED — this phase is purely code/config changes. No external services, databases, or CLI tools beyond Bun (already installed as project runtime) are required.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| All 6 modules hardcoded ON | Per-module `enabled` flag via `opencode.json` | This phase | Users can disable specific modules without code changes |
| `RateLimiter` constructed with hardcoded values | Constructor params configurable via schema | This phase | Operators can tune rate limits per deployment |

---

## Open Questions

1. **Are `scanForInjection`, `safePath`, `new RateLimiter`, and `defaultAuditLog.log` actually called anywhere outside `security/`?**
   - What we know: Grep of the source tree shows `validateProviderURL` called in `onboard.ts`, `getSecurityHeaders` called in `server.ts`. The other 4 modules had no hits outside the security directory in the initial search.
   - What's unclear: Either these modules are unused (suspicious — why write them?), or the call sites exist in files not yet searched (tool layer, session layer, plugin layer).
   - Recommendation: The plan's first task must be a comprehensive grep for all 6 module exports across `packages/opencode/src/`. If modules are genuinely unused, document that — the guard code is trivially added but the modules need integration too.

2. **Should the onboard wizard include a security configuration step?**
   - What we know: SEC-07 requires all modules default to enabled. The wizard currently writes `model` and `provider` keys only. Adding a security step is optional — users can edit `opencode.json` manually.
   - What's unclear: Phase description says "individually configurable via opencode.json" but does not specify wizard integration.
   - Recommendation: Omit wizard step from Phase 1. Add it as a separate task only if explicitly requested. Default-on behavior satisfies SEC-07 without wizard changes.

3. **Should `rateLimiting` expose all 3 constructor params (`maxTokens`, `refillRate`, `refillIntervalMs`) or just `enabled`?**
   - What we know: `RateLimiter` constructor requires all 3. Current hardcoded values are unknown (must check call sites).
   - What's unclear: Whether exposing all 3 is in scope for this phase (SEC-05 says "individually configurable" which could mean just `enabled`).
   - Recommendation: Expose all 3 as optional with sensible defaults baked into the constructor call. Schema accepts them but they are not required.

---

## Sources

### Primary (HIGH confidence)
- Direct file reads of all 6 security modules — complete source available
- Direct read of `config.ts` lines 1-1355 — Zod schema structure fully understood
- Direct read of `onboard.ts` — wizard write pattern fully understood
- Direct read of `server.ts` lines 110-123 — headers middleware call site confirmed

### Secondary (MEDIUM confidence)
- `bun:test` import in existing test files — test framework confirmed as Bun built-in
- `package.json` scripts `"test": "bun test --timeout 30000"` — test command confirmed

### Tertiary (LOW confidence)
- None — all claims verified from source files

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified from package.json and existing source imports
- Architecture: HIGH — Zod schema pattern verified from config.ts, guard pattern is idiomatic TypeScript
- Pitfalls: HIGH for schema/call-site pitfalls (verified); MEDIUM for "missing call sites" (known unknown)
- Test framework: HIGH — confirmed from test files and package.json

**Research date:** 2026-03-26
**Valid until:** 2026-04-25 (stable codebase, 30-day window)
