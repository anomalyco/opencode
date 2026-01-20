# Phase 1: Configuration Foundation - Research

**Researched:** 2026-01-19
**Domain:** Configuration schema extension, validation, and startup error handling
**Confidence:** HIGH

## Summary

This research examines how to extend the existing opencode configuration system with an auth configuration block. The codebase already has a well-established pattern for configuration using Zod schemas, strict object validation, and clear error formatting. The auth configuration will follow these existing patterns.

Key findings:
- The configuration system uses Zod 4.1.8 with `.strict()` objects that reject unknown fields
- Configuration loads at startup via `Config.state()` with hierarchical merging
- Validation errors are formatted via `Config.InvalidError` and displayed through `cli/error.ts`
- Duration parsing needs a new utility (no existing pattern in codebase; `ms` package is the standard)
- Terminal color support is checked via `process.stdin.isTTY` (existing pattern)
- JSON Schema is auto-generated from Zod schemas via `zod-to-json-schema`

**Primary recommendation:** Add auth schema to `Config.Info` using existing Zod patterns; add duration parsing utility; extend validation error formatting for PAM service file checks.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.1.8 | Schema validation and type inference | Already used throughout codebase |
| ms | 2.1.3 | Duration string parsing ("30m" -> milliseconds) | De facto standard, lightweight (recommended add) |
| zod-to-json-schema | 3.24.5 | JSON Schema generation | Already in devDependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsonc-parser | 3.3.1 | Parse JSONC config files | Already used in config loading |
| hono | 4.10.7 | HTTP server (for future phases) | Already used, has basic-auth middleware |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| ms | parse-duration | parse-duration has more features but ms is simpler and sufficient |
| Custom duration parsing | Built-in | Would add tech debt; ms is well-tested |

**Installation:**
```bash
bun add ms
bun add -D @types/ms
```

## Architecture Patterns

### Recommended Project Structure
```
packages/opencode/src/
├── config/
│   ├── config.ts          # Extend Config.Info with Auth schema
│   └── auth.ts            # NEW: Auth config schema and validation
├── util/
│   └── duration.ts        # NEW: Duration parsing utility
├── cli/
│   └── error.ts           # Extend error formatting for auth errors
```

### Pattern 1: Zod Schema Definition with Strict Objects
**What:** All config objects use `.strict()` to reject unknown fields
**When to use:** Any new config section
**Example:**
```typescript
// Source: packages/opencode/src/config/config.ts lines 801-811
export const Server = z
  .object({
    port: z.number().int().positive().optional().describe("Port to listen on"),
    hostname: z.string().optional().describe("Hostname to listen on"),
    mdns: z.boolean().optional().describe("Enable mDNS service discovery"),
    cors: z.array(z.string()).optional().describe("Additional domains to allow for CORS"),
  })
  .strict()
  .meta({
    ref: "ServerConfig",
  })
```

### Pattern 2: Discriminated Unions for Method-Aware Config
**What:** Use `z.discriminatedUnion()` for configs with method selection
**When to use:** When config has a "type" or "method" field that determines other fields
**Example:**
```typescript
// Source: packages/opencode/src/config/config.ts lines 469-470
export const Mcp = z.discriminatedUnion("type", [McpLocal, McpRemote])
export type Mcp = z.infer<typeof Mcp>
```

### Pattern 3: NamedError for Typed Errors
**What:** Create typed errors with structured data using NamedError.create()
**When to use:** Any error that needs structured handling in CLI/UI
**Example:**
```typescript
// Source: packages/opencode/src/config/config.ts lines 1232-1239
export const InvalidError = NamedError.create(
  "ConfigInvalidError",
  z.object({
    path: z.string(),
    issues: z.custom<z.core.$ZodIssue[]>().optional(),
    message: z.string().optional(),
  }),
)
```

### Pattern 4: Optional with Defaults via Zod
**What:** Use `.optional().describe()` for config fields with defaults
**When to use:** Config fields that have sensible defaults
**Example:**
```typescript
// Source: packages/opencode/src/config/config.ts lines 631-632
leader: z.string().optional().default("ctrl+x").describe("Leader key for keybind combinations"),
```

### Anti-Patterns to Avoid
- **Inline validation logic in config loading:** Keep validation in schema, not in load()
- **Missing `.strict()`:** All config objects must use .strict() to catch typos
- **Validation during runtime:** Validate at startup only, per CONTEXT.md decision
- **Silent defaults:** Always use `.describe()` to document default values

## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Duration parsing | Regex/manual parsing | `ms` package | Handles "30m", "1h", "7d" formats correctly; battle-tested |
| JSON Schema | Manual schema writing | `zod-to-json-schema` | Auto-generates from Zod, stays in sync |
| JSONC parsing | JSON.parse() | `jsonc-parser` | Already used; handles comments and trailing commas |
| TTY detection | Custom checks | `process.stdin.isTTY` | Node.js built-in, already used in codebase |
| Error formatting | String concatenation | `NamedError` pattern | Structured errors enable better UI handling |

**Key insight:** The codebase has mature patterns for config validation. Follow them rather than inventing new ones.

## Common Pitfalls

### Pitfall 1: Missing .strict() on Zod Objects
**What goes wrong:** Config accepts unknown fields, typos go undetected
**Why it happens:** Zod objects are permissive by default
**How to avoid:** Always add `.strict()` to config object schemas
**Warning signs:** Tests pass with typos in config; users report config "not working"

### Pitfall 2: Duration Validation at Parse Time Only
**What goes wrong:** Duration strings like "7d" stored but never converted to ms
**Why it happens:** Storing strings is easy; conversion deferred
**How to avoid:** Parse and validate duration at schema level using `.transform()`
**Warning signs:** Runtime errors when duration is used; inconsistent time units

### Pitfall 3: PAM Service File Check Race Condition
**What goes wrong:** File exists at startup but deleted/changed before use
**Why it happens:** TOCTOU (time-of-check-time-of-use) issue
**How to avoid:** Check at startup for fast-fail; handle errors gracefully at auth time too
**Warning signs:** Auth fails with "file not found" despite passing startup validation

### Pitfall 4: Inadequate Error Context
**What goes wrong:** User gets "Invalid config" with no indication of what's wrong
**Why it happens:** Error messages lack field path and suggestion
**How to avoid:** Include field path, current value, expected format, and fix suggestion
**Warning signs:** Users asking "what's wrong with my config?" repeatedly

### Pitfall 5: Forgetting .meta({ ref: "..." }) for JSON Schema
**What goes wrong:** Generated JSON Schema has no $ref names, hard to read
**Why it happens:** Zod doesn't require it; easy to forget
**How to avoid:** Always add `.meta({ ref: "TypeName" })` to schemas meant for JSON Schema
**Warning signs:** JSON Schema output has inline definitions instead of named refs

## Code Examples

Verified patterns from official sources:

### Duration String Parsing with ms
```typescript
// Source: https://www.npmjs.com/package/ms
import ms from "ms"

// Parse duration strings to milliseconds
ms("7d")   // 604800000
ms("30m")  // 1800000
ms("1h")   // 3600000

// Can also convert ms to string (for display)
ms(604800000) // "7d"
```

### Zod Transform for Duration
```typescript
// Custom Zod type for duration strings
const DurationString = z
  .string()
  .describe("Duration string (e.g., '30m', '1h', '7d')")
  .refine(
    (val) => ms(val) !== undefined,
    { message: "Invalid duration format. Use formats like '30m', '1h', '7d'" }
  )
  .meta({ ref: "DurationString" })

// For internal use with parsed milliseconds
const Duration = z
  .string()
  .transform((val, ctx) => {
    const milliseconds = ms(val)
    if (milliseconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Invalid duration format. Use formats like '30m', '1h', '7d'",
      })
      return z.NEVER
    }
    return milliseconds
  })
```

### Auth Config Schema Structure
```typescript
// Following existing patterns in config.ts
export const AuthPamConfig = z
  .object({
    service: z.string().optional().default("opencode").describe("PAM service name"),
  })
  .strict()
  .meta({ ref: "AuthPamConfig" })

export const AuthConfig = z
  .object({
    enabled: z.boolean().optional().default(false).describe("Enable authentication"),
    method: z.enum(["pam"]).optional().default("pam").describe("Authentication method"),
    pam: AuthPamConfig.optional().describe("PAM-specific configuration"),
    sessionTimeout: z.string().optional().default("7d").describe("Session timeout duration"),
    rememberMeDuration: z.string().optional().default("90d").describe("Remember me cookie duration"),
    requireHttps: z.enum(["off", "warn", "block"]).optional().default("warn"),
    rateLimiting: z.boolean().optional().default(true),
    allowedUsers: z.array(z.string()).optional().default([]),
    sessionPersistence: z.boolean().optional().default(true),
    trustProxy: z.boolean().optional().describe("Trust X-Forwarded-Proto header"),
  })
  .strict()
  .meta({ ref: "AuthConfig" })
```

### Error Formatting Pattern
```typescript
// Source: packages/opencode/src/cli/error.ts lines 33-38
if (Config.InvalidError.isInstance(input))
  return [
    `Configuration is invalid${input.data.path && input.data.path !== "config" ? ` at ${input.data.path}` : ""}` +
      (input.data.message ? `: ${input.data.message}` : ""),
    ...(input.data.issues?.map((issue) => "↳ " + issue.message + " " + issue.path.join(".")) ?? []),
  ].join("\n")
```

### PAM Service File Existence Check
```typescript
// Using existing Filesystem.exists pattern
import { Filesystem } from "../util/filesystem"

const PAM_SERVICE_DIR = "/etc/pam.d"

async function checkPamServiceExists(serviceName: string): Promise<boolean> {
  const servicePath = `${PAM_SERVICE_DIR}/${serviceName}`
  return Filesystem.exists(servicePath)
}
```

### TTY Detection Pattern
```typescript
// Source: packages/opencode/src/cli/cmd/tui/util/terminal.ts line 20
if (!process.stdin.isTTY) return { background: null, foreground: null, colors: [] }

// For error formatting
const useColors = process.stdout.isTTY
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3 | Zod 4 | Late 2024 | New `.meta()` API, better JSON Schema support |
| Manual config merge | remeda.mergeDeep | Already in use | Consistent deep merging |
| String validation only | Zod transforms | Already in use | Type-safe parsed values |

**Deprecated/outdated:**
- Zod 3's `z.ZodSchema` - use `z.core.$ZodType` in Zod 4
- Manual JSON Schema writing - use zod-to-json-schema

## Open Questions

Things that couldn't be fully resolved:

1. **PAM Service File Creation Automation**
   - What we know: Can check `/etc/pam.d/{service}` exists
   - What's unclear: Best template content for PAM service file varies by distro
   - Recommendation: Provide generic template; note it may need distro-specific adjustment

2. **X-Forwarded-Proto Trust**
   - What we know: Should trust header when behind known proxy
   - What's unclear: Exact validation logic (check IP ranges? require config?)
   - Recommendation: Start with simple `trustProxy: boolean` flag; can enhance later

3. **Duration Upper Bounds**
   - What we know: CONTEXT.md says "no duration bounds checking"
   - What's unclear: Should we warn on obviously wrong values like "100y"?
   - Recommendation: Follow CONTEXT.md - trust user, no bounds checking

## Sources

### Primary (HIGH confidence)
- packages/opencode/src/config/config.ts - Existing config patterns, Zod schema structure
- packages/opencode/src/cli/error.ts - Error formatting patterns
- packages/opencode/src/util/filesystem.ts - File existence checking
- packages/opencode/package.json - Current dependencies (Zod 4.1.8)

### Secondary (MEDIUM confidence)
- [ms npm package](https://www.npmjs.com/package/ms) - Duration parsing library
- [Zod documentation](https://zod.dev/api) - Schema validation patterns
- [PAM configuration](https://man7.org/linux/man-pages/man5/pam.d.5.html) - PAM service file location

### Tertiary (LOW confidence)
- None required - all findings verified with primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against existing package.json and config.ts
- Architecture: HIGH - patterns directly from codebase
- Pitfalls: MEDIUM - based on codebase patterns and general Zod experience

**Research date:** 2026-01-19
**Valid until:** 60 days (stable technology, codebase patterns unlikely to change)
