# Test Fixtures Guide

## Temporary Directory Fixture

The `tmpdir` function in `fixture/fixture.ts` creates temporary directories for tests with automatic cleanup.

### Basic Usage

```typescript
import { tmpdir } from "./fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir()
  // tmp.path is the temp directory path
  // automatically cleaned up when test ends
})
```

### Options

- `git?: boolean` - Initialize a git repo with a root commit
- `config?: Partial<Config.Info>` - Write an `opencode.json` config file
- `init?: (dir: string) => Promise<T>` - Custom setup function, returns value accessible as `tmp.extra`
- `dispose?: (dir: string) => Promise<T>` - Custom cleanup function

### Examples

**Git repository:**

```typescript
await using tmp = await tmpdir({ git: true })
```

**With config file:**

```typescript
await using tmp = await tmpdir({
  config: { model: "test/model", username: "testuser" },
})
```

**Custom initialization (returns extra data):**

```typescript
await using tmp = await tmpdir<string>({
  init: async (dir) => {
    await Bun.write(path.join(dir, "file.txt"), "content")
    return "extra data"
  },
})
// Access extra data via tmp.extra
console.log(tmp.extra) // "extra data"
```

**With cleanup:**

```typescript
await using tmp = await tmpdir({
  init: async (dir) => {
    const specialDir = path.join(dir, "special")
    await fs.mkdir(specialDir)
    return specialDir
  },
  dispose: async (dir) => {
    // Custom cleanup logic
    await fs.rm(path.join(dir, "special"), { recursive: true })
  },
})
```

### Returned Object

- `path: string` - Absolute path to the temp directory (realpath resolved)
- `extra: T` - Value returned by the `init` function
- `[Symbol.asyncDispose]` - Enables automatic cleanup via `await using`

### Notes

- Directories are created in the system temp folder with prefix `opencode-test-`
- Use `await using` for automatic cleanup when the variable goes out of scope
- Paths are sanitized to strip null bytes (defensive fix for CI environments)

## Testing With Effects

Use `testEffect(...)` from `test/lib/effect.ts` for tests that exercise Effect services or Effect-based workflows.

### Core Pattern

```typescript
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(MyService.defaultLayer))

describe("my service", () => {
  it.live("does the thing", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const svc = yield* MyService.Service
        const out = yield* svc.run()
        expect(out).toEqual("ok")
      }),
    ),
  )
})
```

### `it.effect` vs `it.live`

- Use `it.effect(...)` when the test should run with `TestClock` and `TestConsole`.
- Use `it.live(...)` when the test depends on real time, filesystem mtimes, child processes, git, locks, or other live OS behavior.
- Most integration-style tests in this package use `it.live(...)`.

### Effect Fixtures

Prefer the Effect-aware helpers from `fixture/fixture.ts` instead of building a manual runtime in each test.

- `tmpdirScoped(options?)` creates a scoped temp directory and cleans it up when the Effect scope closes.
- `provideInstance(dir)(effect)` is the low-level helper. It does not create a directory; it just runs an Effect with `Instance.current` bound to `dir`.
- `provideTmpdirInstance((dir) => effect, options?)` is the convenience helper. It creates a temp directory, binds it as the active instance, and disposes the instance on cleanup.
- `provideTmpdirServer((input) => effect, options?)` does the same, but also provides the test LLM server.

Use `provideTmpdirInstance(...)` by default when a test only needs one temp instance. Use `tmpdirScoped()` plus `provideInstance(...)` when a test needs multiple directories, custom setup before binding, or needs to switch instance context within one test.

### Style

- Define `const it = testEffect(...)` near the top of the file.
- Keep the test body inside `Effect.gen(function* () { ... })`.
- Yield services directly with `yield* MyService.Service` or `yield* MyTool`.
- Avoid custom `ManagedRuntime`, `attach(...)`, or ad hoc `run(...)` wrappers when `testEffect(...)` already provides the runtime.
- When a test needs instance-local state, prefer `provideTmpdirInstance(...)` or `provideInstance(...)` over manual `Instance.provide(...)` inside Promise-style tests.
