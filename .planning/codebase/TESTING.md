# Testing Patterns

**Analysis Date:** 2026-01-19

## Test Framework

**Runner:**
- Bun test runner (native to Bun)
- Config: `packages/opencode/bunfig.toml`

**Assertion Library:**
- Built-in `bun:test` assertions
- `expect()` API similar to Jest

**Run Commands:**
```bash
# Run tests for opencode package
bun run --cwd packages/opencode test

# Run with coverage
bun run --cwd packages/opencode test --coverage

# Run specific test file
bun test packages/opencode/test/util/lock.test.ts

# Turbo task (from root)
bun turbo opencode#test
```

## Test File Organization

**Location:**
- Separate `test/` directory in `packages/opencode/`
- Structure mirrors `src/` directory
- Some co-located tests in `packages/app/src/` (e.g., `layout-scroll.test.ts`)

**Naming:**
- Pattern: `*.test.ts`
- Example: `config.test.ts`, `lock.test.ts`, `transform.test.ts`

**Structure:**
```
packages/opencode/
├── src/
│   ├── util/
│   │   └── lock.ts
│   └── config/
│       └── config.ts
└── test/
    ├── preload.ts
    ├── fixture/
    │   └── fixture.ts
    ├── util/
    │   └── lock.test.ts
    └── config/
        └── config.test.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, expect, test } from "bun:test"
import { Lock } from "../../src/util/lock"

describe("util.lock", () => {
  test("writer exclusivity: blocks reads and other writes while held", async () => {
    // Arrange
    const key = "lock:" + Math.random().toString(36).slice(2)
    const state = { writer2: false, reader: false, writers: 0 }

    // Act
    using writer1 = await Lock.write(key)
    state.writers++

    // Assert
    expect(state.writers).toBe(1)
  })
})
```

**Patterns:**
- `describe()` for grouping related tests
- `test()` for individual test cases (prefer over `it()`)
- Descriptive test names explaining behavior being tested
- Arrange/Act/Assert pattern (implicit, not commented)

**Nested Describes:**
```typescript
describe("ProviderTransform.maxOutputTokens", () => {
  test("returns 32k when modelLimit > 32k", () => {...})

  describe("azure", () => {
    test("returns 32k when modelLimit > 32k", () => {...})
    test("returns modelLimit when modelLimit < 32k", () => {...})
  })

  describe("anthropic with thinking options", () => {
    test("returns 32k when budgetTokens + 32k <= modelLimit", () => {...})
  })
})
```

## Mocking

**Framework:** Built-in `bun:test` mock

**Patterns:**
```typescript
import { mock } from "bun:test"

// Mock a function
const mockFetch = mock((url: string | URL | Request) => {
  const urlStr = url.toString()
  if (urlStr.includes(".well-known/opencode")) {
    return Promise.resolve(new Response(JSON.stringify({...}), { status: 200 }))
  }
  return originalFetch(url)
})

// Replace global
globalThis.fetch = mockFetch as unknown as typeof fetch

// Mock a module method
Auth.all = mock(() => Promise.resolve({...}))
```

**What to Mock:**
- External API calls (fetch)
- Time-dependent operations
- File system operations (when testing logic, not I/O)
- Module methods for isolation

**What NOT to Mock:**
- Internal utilities being tested
- Zod schemas (test actual validation)
- Pure functions

## Fixtures and Factories

**Test Data - tmpdir fixture:**
```typescript
import { tmpdir } from "../fixture/fixture"

// Basic temp directory
await using tmp = await tmpdir()

// With git initialization
await using tmp = await tmpdir({ git: true })

// With config
await using tmp = await tmpdir({
  config: {
    model: "test/model",
    username: "testuser",
  },
})

// With custom initialization
await using tmp = await tmpdir({
  init: async (dir) => {
    await Bun.write(path.join(dir, "opencode.json"), JSON.stringify({...}))
    await fs.mkdir(path.join(dir, ".opencode"), { recursive: true })
  },
})
```

**Location:**
- `packages/opencode/test/fixture/fixture.ts` - tmpdir helper
- `packages/opencode/test/preload.ts` - test environment setup

**Preload Pattern:**
```typescript
// packages/opencode/bunfig.toml
[test]
preload = ["./test/preload.ts"]
timeout = 10000
coverage = true
```

## Coverage

**Requirements:** Not enforced, but coverage enabled by default

**View Coverage:**
```bash
bun run --cwd packages/opencode test --coverage
```

**Configuration:**
```toml
# packages/opencode/bunfig.toml
[test]
coverage = true
```

## Test Types

**Unit Tests:**
- Located in `test/util/`, `test/config/`, etc.
- Test individual functions/modules in isolation
- Use fixtures for file system operations

**Integration Tests:**
- Test module interactions
- Use `Instance.provide()` for project context
- Example: `test/config/config.test.ts`, `test/agent/agent.test.ts`

**E2E Tests:**
- Not detected in current codebase
- Manual testing via `bun dev`

## Common Patterns

**Async Testing:**
```typescript
test("loads config with defaults when no files exist", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = await Config.get()
      expect(config.username).toBeDefined()
    },
  })
})
```

**Error Testing:**
```typescript
test("throws error for invalid JSON", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "opencode.json"), "{ invalid json }")
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await expect(Config.get()).rejects.toThrow()
    },
  })
})
```

**Testing with Disposables:**
```typescript
test("writer exclusivity", async () => {
  using writer1 = await Lock.write(key)
  state.writers++

  // writer1 automatically disposed at end of scope
  writer1[Symbol.dispose]()
  state.writers--
})
```

**Async Dispose Pattern:**
```typescript
test("example with async dispose", async () => {
  await using tmp = await tmpdir()
  // tmp.path available
  // automatically cleaned up after test
})
```

**Instance.provide Pattern:**
```typescript
// Provides project context for tests
await Instance.provide({
  directory: tmp.path,
  fn: async () => {
    // Code runs with project context set to tmp.path
    const config = await Config.get()
    expect(config.model).toBe("test/model")
  },
})
```

**Microtask Flushing:**
```typescript
function tick() {
  return new Promise<void>((r) => queueMicrotask(r))
}

async function flush(n = 5) {
  for (let i = 0; i < n; i++) await tick()
}

// Usage in async tests
await flush()
expect(state.writer2).toBe(false)
```

## Test Environment Setup

**Preload Script (`test/preload.ts`):**
- Sets XDG environment variables for isolation
- Creates temp directories for test data
- Clears provider API keys
- Pre-fetches models.json to avoid network in tests
- Initializes logging in test mode

**Environment Isolation:**
```typescript
process.env["XDG_DATA_HOME"] = path.join(dir, "share")
process.env["XDG_CACHE_HOME"] = path.join(dir, "cache")
process.env["XDG_CONFIG_HOME"] = path.join(dir, "config")
process.env["OPENCODE_TEST_HOME"] = testHome
process.env["OPENCODE_DISABLE_MODELS_FETCH"] = "true"
```

## Pre-commit Testing

**Husky pre-push hook (`.husky/pre-push`):**
```bash
# Check bun version matches package.json
EXPECTED_VERSION=$(grep '"packageManager"' package.json | sed 's/.*"bun@\([^"]*\)".*/\1/')
CURRENT_VERSION=$(bun --version)
if [ "$CURRENT_VERSION" != "$EXPECTED_VERSION" ]; then
  exit 1
fi
bun typecheck
```

**Note:** Tests are not automatically run on commit/push. Manual testing expected before PR.

---

*Testing analysis: 2026-01-19*
