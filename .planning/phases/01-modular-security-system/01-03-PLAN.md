---
wave: 3
depends_on: [01-PLAN-1.md, 01-PLAN-2.md]
files_modified:
  - packages/opencode/src/security/__tests__/ssrf.test.ts
  - packages/opencode/src/security/__tests__/prompt-injection.test.ts
  - packages/opencode/src/security/__tests__/path.test.ts
  - packages/opencode/src/security/__tests__/audit.test.ts
  - packages/opencode/src/security/__tests__/rate-limiter.test.ts
  - packages/opencode/src/security/__tests__/headers.test.ts
autonomous: true
requirements: [SEC-01, SEC-02, SEC-03, SEC-04, SEC-05, SEC-06, SEC-07]
---

# Plan 3: Unit Tests for Config-Driven Enable/Disable Behavior

## Objective

Write bun:test tests verifying that every module correctly enables when no config is present (SEC-07), enables when `enabled: true`, and disables when `enabled: false`. Three test files need to be created from scratch (audit, rate-limiter, headers); three existing files need config-guard test cases appended.

## Tasks

<task id="T1" tdd="true">
<title>Add config-guard tests to existing 3 test files (SEC-01, SEC-02, SEC-03, SEC-07)</title>
<read_first>
- packages/opencode/src/security/__tests__/ssrf.test.ts — read to understand existing test structure before appending
- packages/opencode/src/security/__tests__/prompt-injection.test.ts — same
- packages/opencode/src/security/__tests__/path.test.ts — same
- packages/opencode/src/security/ssrf.ts — read to understand validateProviderURL signature for mock setup
- packages/opencode/src/security/prompt-injection.ts — read scanForInjection signature
- packages/opencode/src/security/path.ts — read safePath signature
</read_first>
<action>
For each of the 3 existing test files, append a new `describe` block: "config-driven behavior". Each block must test 3 cases: absent config (default-on), explicitly enabled, explicitly disabled.

The config-guard tests require mocking `Config.get()`. Use bun:test's `mock` function:

```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Config } from "../../../config/config"

// Mock Config.get to return a controlled security config
const mockConfigGet = mock(Config.get)

beforeEach(() => {
  mockConfigGet.mockRestore()
})
```

**Pattern for each module — example for SSRF (append to ssrf.test.ts):**

```typescript
describe("config-driven behavior", () => {
  test("SEC-07: enabled by default when security key absent", async () => {
    mockConfigGet.mockResolvedValue({} as any) // no security key
    // Call the guarded call site function or verify the guard logic directly
    // The module should execute (not skip) when config is absent
    // Verify by checking that validateProviderURL is called / result is not bypassed
    expect(true).toBe(true) // placeholder — replace with actual observable assertion
  })

  test("SEC-01: skips SSRF check when ssrf.enabled = false", async () => {
    mockConfigGet.mockResolvedValue({
      security: { ssrf: { enabled: false } }
    } as any)
    // Call the function that wraps validateProviderURL
    // Assert the SSRF check was skipped (no error thrown for a normally-blocked URL)
  })

  test("SEC-01: runs SSRF check when ssrf.enabled = true", async () => {
    mockConfigGet.mockResolvedValue({
      security: { ssrf: { enabled: true } }
    } as any)
    // Assert the SSRF check runs and blocks a private IP
  })
})
```

Apply the same 3-case pattern to prompt-injection.test.ts (SEC-02) and path.test.ts (SEC-03).

If the guard lives at the call site (external file) rather than in the module itself, test the exported wrapper function that applies the guard, or test by directly invoking the guarded logic with a mocked config.

NOTE: The exact mock pattern depends on how `Config.get` is exported. If it uses Effect or a singleton, adjust the mock target accordingly. Read the config import in the security module to determine the correct mock path.
</action>
<acceptance_criteria>
- grep -c "config-driven behavior" packages/opencode/src/security/__tests__/ssrf.test.ts → 1
- grep -c "config-driven behavior" packages/opencode/src/security/__tests__/prompt-injection.test.ts → 1
- grep -c "config-driven behavior" packages/opencode/src/security/__tests__/path.test.ts → 1
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun test src/security/__tests__/ssrf.test.ts src/security/__tests__/prompt-injection.test.ts src/security/__tests__/path.test.ts --timeout 30000 → all pass
</acceptance_criteria>
</task>

<task id="T2" tdd="true">
<title>Create 3 new test files for audit, rate-limiter, and headers (SEC-04, SEC-05, SEC-06, SEC-07)</title>
<read_first>
- packages/opencode/src/security/audit.ts — read to understand defaultAuditLog.log signature and what an audit entry looks like
- packages/opencode/src/security/rate-limiter.ts — read to understand RateLimiter constructor and consume() signature
- packages/opencode/src/security/headers.ts — read to understand getSecurityHeaders() return type
</read_first>
<action>
Create three new test files from scratch following the bun:test pattern from the existing test files.

**packages/opencode/src/security/__tests__/audit.test.ts:**
```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Config } from "../../../config/config"

// Mock Config.get
const mockConfigGet = mock(Config.get)
beforeEach(() => { mockConfigGet.mockRestore() })

describe("Audit Log — config-driven behavior", () => {
  test("SEC-07: audit logging enabled by default (absent security key)", async () => {
    mockConfigGet.mockResolvedValue({} as any)
    // Import and call defaultAuditLog.log with a test entry
    // Assert: log method executes without throwing, entry is recorded
  })

  test("SEC-04: skips audit log when auditLog.enabled = false", async () => {
    mockConfigGet.mockResolvedValue({ security: { auditLog: { enabled: false } } } as any)
    // Assert: log method returns without writing
  })

  test("SEC-04: writes audit log when auditLog.enabled = true", async () => {
    mockConfigGet.mockResolvedValue({ security: { auditLog: { enabled: true } } } as any)
    // Assert: log method executes
  })
})
```

**packages/opencode/src/security/__tests__/rate-limiter.test.ts:**
```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Config } from "../../../config/config"

const mockConfigGet = mock(Config.get)
beforeEach(() => { mockConfigGet.mockRestore() })

describe("Rate Limiter — config-driven behavior", () => {
  test("SEC-07: rate limiting enabled by default (absent security key)", async () => {
    mockConfigGet.mockResolvedValue({} as any)
    // Assert: consume() is called and returns a boolean (not bypassed)
  })

  test("SEC-05: skips rate limiting when rateLimiting.enabled = false", async () => {
    mockConfigGet.mockResolvedValue({ security: { rateLimiting: { enabled: false } } } as any)
    // Assert: all requests pass through (consume never called or always returns true)
  })

  test("SEC-05: respects custom maxTokens from config", async () => {
    mockConfigGet.mockResolvedValue({
      security: { rateLimiting: { enabled: true, maxTokens: 1, refillRate: 1, refillIntervalMs: 60000 } }
    } as any)
    // Assert: second request within refill window is rejected (maxTokens=1)
  })
})
```

**packages/opencode/src/security/__tests__/headers.test.ts:**
```typescript
import { describe, test, expect, mock, beforeEach } from "bun:test"
import { Config } from "../../../config/config"

const mockConfigGet = mock(Config.get)
beforeEach(() => { mockConfigGet.mockRestore() })

describe("Security Headers — config-driven behavior", () => {
  test("SEC-07: headers applied by default (absent security key)", async () => {
    mockConfigGet.mockResolvedValue({} as any)
    // Assert: getSecurityHeaders() returns non-empty object
  })

  test("SEC-06: headers skipped when headers.enabled = false", async () => {
    mockConfigGet.mockResolvedValue({ security: { headers: { enabled: false } } } as any)
    // Assert: guarded path returns empty object or headers are not set on response
  })

  test("SEC-06: headers applied when headers.enabled = true", async () => {
    mockConfigGet.mockResolvedValue({ security: { headers: { enabled: true } } } as any)
    // Assert: getSecurityHeaders() returns headers including X-Frame-Options etc.
  })
})
```

Fill in the actual assertions based on reading the module source files. Replace placeholder comments with real `expect(...)` calls matching the actual module API.
</action>
<acceptance_criteria>
- ls packages/opencode/src/security/__tests__/audit.test.ts → file exists
- ls packages/opencode/src/security/__tests__/rate-limiter.test.ts → file exists
- ls packages/opencode/src/security/__tests__/headers.test.ts → file exists
- grep -c "SEC-07" packages/opencode/src/security/__tests__/audit.test.ts → >= 1
- grep -c "SEC-07" packages/opencode/src/security/__tests__/rate-limiter.test.ts → >= 1
- grep -c "SEC-07" packages/opencode/src/security/__tests__/headers.test.ts → >= 1
- cd /home/jkang/cobuilder-opencode/packages/opencode && bun test src/security --timeout 30000 → all 6 test files pass, 0 failures
</acceptance_criteria>
</task>

## Verification

```bash
cd /home/jkang/cobuilder-opencode/packages/opencode

# Full security test suite — all 6 files, all pass
bun test src/security --timeout 30000

# Expected output structure:
# src/security/__tests__/ssrf.test.ts         — N pass
# src/security/__tests__/prompt-injection.test.ts — N pass
# src/security/__tests__/path.test.ts         — N pass
# src/security/__tests__/audit.test.ts        — N pass
# src/security/__tests__/rate-limiter.test.ts — N pass
# src/security/__tests__/headers.test.ts      — N pass
# 0 failures
```

## must_haves

truths:
- All 6 security modules have tests proving they skip their logic when `enabled: false` in config
- All 6 modules have tests proving they run their logic when no security config key is present (SEC-07 default-on)
- `bun test src/security --timeout 30000` exits 0 with no failures

artifacts:
- path: packages/opencode/src/security/__tests__/audit.test.ts
  provides: Tests for SEC-04 (audit log enable/disable) and SEC-07
- path: packages/opencode/src/security/__tests__/rate-limiter.test.ts
  provides: Tests for SEC-05 (rate limiter enable/disable, configurable params) and SEC-07
- path: packages/opencode/src/security/__tests__/headers.test.ts
  provides: Tests for SEC-06 (headers enable/disable) and SEC-07

key_links:
- from: packages/opencode/src/security/__tests__/*.test.ts
  to: packages/opencode/src/config/config.ts
  via: mock(Config.get) returning controlled security sub-object
- from: packages/opencode/src/security/__tests__/*.test.ts
  to: packages/opencode/src/security/*.ts
  via: direct imports of module functions under test
