---
title: "Finding tests"
description: "Learn how Bun's test runner discovers and filters test files in your project"
---

bun test's file discovery mechanism determines which files to run as tests. Understanding how it works helps you structure your test files effectively.

## Default Discovery Logic

By default, `bun test` recursively searches the project directory for files that match specific patterns:

- `*.test.{js|jsx|ts|tsx}` - Files ending with `.test.js`, `.test.jsx`, `.test.ts`, or `.test.tsx`
- `*_test.{js|jsx|ts|tsx}` - Files ending with `_test.js`, `_test.jsx`, `_test.ts`, or `_test.tsx`
- `*.spec.{js|jsx|ts|tsx}` - Files ending with `.spec.js`, `.spec.jsx`, `.spec.ts`, or `.spec.tsx`
- `*_spec.{js|jsx|ts|tsx}` - Files ending with `_spec.js`, `_spec.jsx`, `_spec.ts`, or `_spec.tsx`

## Exclusions

By default, Bun test ignores:

- `node_modules` directories
- Hidden directories (those starting with a period `.`)
- Files that don't have JavaScript-like extensions (based on available loaders)

## Customizing Test Discovery

### Position Arguments as Filters

You can filter which test files run by passing additional positional arguments to `bun test`:

```bash terminal icon="terminal"
bun test <filter> <filter> ...
```

Any test file with a path that contains one of the filters will run. These filters are simple substring matches, not glob patterns.

For example, to run all tests in a `utils` directory:

```bash terminal icon="terminal"
bun test utils
```

This would match files like `src/utils/string.test.ts` and `lib/utils/array_test.js`.

### Specifying Exact File Paths

To run a specific file in the test runner, make sure the path starts with `./` or `/` to distinguish it from a filter name:

```bash terminal icon="terminal"
bun test ./test/specific-file.test.ts
```

### Filter by Test Name

To filter tests by name rather than file path, use the `-t`/`--test-name-pattern` flag with a regex pattern:

```sh terminal icon="terminal"
# run all tests with "addition" in the name
bun test --test-name-pattern addition
```

The pattern is matched against a concatenated string of the test name prepended with the labels of all its parent describe blocks, separated by spaces. For example, a test defined as:

```ts title="math.test.ts" icon="/icons/typescript.svg"
describe("Math", () => {
  describe("operations", () => {
    test("should add correctly", () => {
      // ...
    });
  });
});
```

Would be matched against the string "Math operations should add correctly".

### Changing the Root Directory

By default, Bun looks for test files starting from the current working directory. You can change this with the `root` option in your `bunfig.toml`:

```toml title="bunfig.toml" icon="settings"
[test]
root = "src"  # Only scan for tests in the src directory
```

## Execution Order

Tests are run in the following order:

1. Test files are executed sequentially (not in parallel)
2. Within each file, tests run sequentially based on their definition order
