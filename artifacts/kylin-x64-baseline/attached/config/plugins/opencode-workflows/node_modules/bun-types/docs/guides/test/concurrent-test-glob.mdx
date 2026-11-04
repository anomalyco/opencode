---
title: Selectively run tests concurrently with glob patterns
sidebarTitle: Concurrent test glob
mode: center
description: Set a glob pattern to decide which tests from which files run in parallel
---

This guide demonstrates how to use the `concurrentTestGlob` option to selectively run tests concurrently based on file naming patterns.

## Project Structure

```sh title="Project Structure" icon="folder-tree"
my-project/
├── bunfig.toml
├── tests/
│   ├── unit/
│   │   ├── math.test.ts          # Sequential
│   │   └── utils.test.ts         # Sequential
│   └── integration/
│       ├── concurrent-api.test.ts     # Concurrent
│       └── concurrent-database.test.ts # Concurrent
```

## Configuration

Configure your `bunfig.toml` to run test files with "concurrent-" prefix concurrently:

```toml title="bunfig.toml" icon="settings"
[test]
# Run all test files with "concurrent-" prefix concurrently
concurrentTestGlob = "**/concurrent-*.test.ts"
```

## Test Files

### Unit Test (Sequential)

Sequential tests are good for tests that share state or have specific ordering requirements:

```ts title="tests/unit/math.test.ts" icon="/icons/typescript.svg"
import { test, expect } from "bun:test";

// These tests run sequentially by default
let sharedState = 0;

test("addition", () => {
  sharedState = 5 + 3;
  expect(sharedState).toBe(8);
});

test("uses previous state", () => {
  // This test depends on the previous test's state
  expect(sharedState).toBe(8);
});
```

### Integration Test (Concurrent)

Tests in files matching the glob pattern automatically run concurrently:

```ts title="tests/integration/concurrent-api.test.ts" icon="/icons/typescript.svg"
import { test, expect } from "bun:test";

// These tests automatically run concurrently due to filename matching the glob pattern.
// Using test() is equivalent to test.concurrent() when the file matches concurrentTestGlob.
// Each test is independent and can run in parallel.

test("fetch user data", async () => {
  const response = await fetch("/api/user/1");
  expect(response.ok).toBe(true);
});

// can also use test.concurrent() for explicitly marking it as concurrent
test.concurrent("fetch posts", async () => {
  const response = await fetch("/api/posts");
  expect(response.ok).toBe(true);
});

// can also use test.serial() for explicitly marking it as sequential
test.serial("fetch comments", async () => {
  const response = await fetch("/api/comments");
  expect(response.ok).toBe(true);
});
```

## Running Tests

```bash terminal icon="terminal"
# Run all tests - concurrent-*.test.ts files will run concurrently
bun test

# Override: Force ALL tests to run concurrently
# Note: This overrides bunfig.toml and runs all tests concurrently, regardless of glob
bun test --concurrent

# Run only unit tests (sequential)
bun test tests/unit

# Run only integration tests (concurrent due to glob pattern)
bun test tests/integration
```

## Benefits

1. **Gradual Migration**: Migrate to concurrent tests file by file by renaming them
2. **Clear Organization**: File naming convention indicates execution mode
3. **Performance**: Integration tests run faster in parallel
4. **Safety**: Unit tests remain sequential where needed
5. **Flexibility**: Easy to change execution mode by renaming files

## Migration Strategy

To migrate existing tests to concurrent execution:

1. **Start with independent integration tests** - These typically don't share state
2. **Rename files to match the glob pattern**: `mv api.test.ts concurrent-api.test.ts`
3. **Verify tests still pass** - Run `bun test` to ensure no race conditions
4. **Monitor for shared state issues** - Watch for flaky tests or unexpected failures
5. **Continue migrating stable tests incrementally** - Don't rush the migration

## Tips

- **Use descriptive prefixes**: `concurrent-`, `parallel-`, `async-`
- **Keep related sequential tests together** in the same directory
- **Document why certain tests must remain sequential** with comments
- **Use `test.concurrent()` for fine-grained control** in sequential files
  (Note: In files matched by `concurrentTestGlob`, plain `test()` already runs concurrently)

## Multiple Patterns

You can specify multiple patterns for different test categories:

```toml title="bunfig.toml" icon="settings"
[test]
concurrentTestGlob = [
  "**/integration/*.test.ts",
  "**/e2e/*.test.ts",
  "**/concurrent-*.test.ts"
]
```

This configuration will run tests concurrently if they match any of these patterns:

- All tests in `integration/` directories
- All tests in `e2e/` directories
- All tests with `concurrent-` prefix anywhere in the project
