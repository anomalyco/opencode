---
title: "Code coverage"
description: "Learn how to use Bun's built-in code coverage reporting to track test coverage and find untested areas in your codebase"
---

Bun's test runner supports built-in code coverage reporting. Use it to see how much of your codebase is covered by tests and find areas that are not currently well-tested.

## Enabling Coverage

`bun:test` supports seeing which lines of code are covered by tests. To use this feature, pass `--coverage` to the CLI. It will print out a coverage report to the console:

```bash terminal icon="terminal"
bun test --coverage

-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   38.89 |   42.11 |
 index-0.ts  |   33.33 |   36.84 | 10-15,19-24
 index-1.ts  |   33.33 |   36.84 | 10-15,19-24
 index-10.ts |   33.33 |   36.84 | 10-15,19-24
 index-2.ts  |   33.33 |   36.84 | 10-15,19-24
 index-3.ts  |   33.33 |   36.84 | 10-15,19-24
 index-4.ts  |   33.33 |   36.84 | 10-15,19-24
 index-5.ts  |   33.33 |   36.84 | 10-15,19-24
 index-6.ts  |   33.33 |   36.84 | 10-15,19-24
 index-7.ts  |   33.33 |   36.84 | 10-15,19-24
 index-8.ts  |   33.33 |   36.84 | 10-15,19-24
 index-9.ts  |   33.33 |   36.84 | 10-15,19-24
 index.ts    |  100.00 |  100.00 |
-------------|---------|---------|-------------------
```

### Enable by Default

To always enable coverage reporting by default, add the following line to your `bunfig.toml`:

```toml title="bunfig.toml"
[test]
# Always enable coverage
coverage = true
```

By default coverage reports will include test files and exclude sourcemaps. This is usually what you want, but it can be configured otherwise in `bunfig.toml`.

```toml title="bunfig.toml" icon="settings"
[test]
coverageSkipTestFiles = true  # default false
```

## Coverage Thresholds

It is possible to specify a coverage threshold in `bunfig.toml`. If your test suite does not meet or exceed this threshold, `bun test` will exit with a non-zero exit code to indicate the failure.

### Simple Threshold

```toml title="bunfig.toml" icon="settings"
[test]
# To require 90% line-level and function-level coverage
coverageThreshold = 0.9
```

### Detailed Thresholds

```toml title="bunfig.toml" icon="settings"
[test]
# To set different thresholds for lines and functions
coverageThreshold = { lines = 0.9, functions = 0.9, statements = 0.9 }
```

Setting any of these thresholds enables `fail_on_low_coverage`, causing the test run to fail if coverage is below the threshold.

## Coverage Reporters

By default, coverage reports will be printed to the console.

For persistent code coverage reports in CI environments and for other tools, you can pass a `--coverage-reporter=lcov` CLI option or `coverageReporter` option in `bunfig.toml`.

```toml title="bunfig.toml" icon="settings"
[test]
coverageReporter = ["text", "lcov"]  # default ["text"]
coverageDir = "path/to/somewhere"    # default "coverage"
```

### Available Reporters

| Reporter | Description                                          |
| -------- | ---------------------------------------------------- |
| `text`   | Prints a text summary of the coverage to the console |
| `lcov`   | Save coverage in lcov format                         |

### LCOV Coverage Reporter

To generate an lcov report, you can use the lcov reporter. This will generate an `lcov.info` file in the coverage directory.

```toml title="bunfig.toml" icon="settings"
[test]
coverageReporter = "lcov"
```

```bash terminal icon="terminal"
# Or via CLI
bun test --coverage --coverage-reporter=lcov
```

The LCOV format is widely supported by various tools and services:

- **Code editors**: VS Code extensions can show coverage inline
- **CI/CD services**: GitHub Actions, GitLab CI, CircleCI
- **Coverage services**: Codecov, Coveralls
- **IDEs**: WebStorm, IntelliJ IDEA

#### Using LCOV with GitHub Actions

```yaml title=".github/workflows/test.yml" icon="file-code"
name: Test with Coverage
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test --coverage --coverage-reporter=lcov
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
```

## Excluding Files from Coverage

### Skip Test Files

By default, test files themselves are included in coverage reports. You can exclude them with:

```toml title="bunfig.toml" icon="settings"
[test]
coverageSkipTestFiles = true  # default false
```

This will exclude files matching test patterns (e.g., `*.test.ts`, `*.spec.js`) from the coverage report.

### Ignore Specific Paths and Patterns

You can exclude specific files or file patterns from coverage reports using `coveragePathIgnorePatterns`:

```toml title="bunfig.toml" icon="settings"
[test]
# Single pattern
coveragePathIgnorePatterns = "**/*.spec.ts"

# Multiple patterns
coveragePathIgnorePatterns = [
  "**/*.spec.ts",
  "**/*.test.ts",
  "src/utils/**",
  "*.config.js"
]
```

This option accepts glob patterns and works similarly to Jest's `collectCoverageFrom` ignore patterns. Files matching any of these patterns will be excluded from coverage calculation and reporting in both text and LCOV outputs.

#### Common Use Cases

```toml title="bunfig.toml" icon="settings"
[test]
coveragePathIgnorePatterns = [
  # Exclude utility files
  "src/utils/**",

  # Exclude configuration files
  "*.config.js",
  "webpack.config.ts",
  "vite.config.ts",

  # Exclude specific test patterns
  "**/*.spec.ts",
  "**/*.e2e.ts",

  # Exclude build artifacts
  "dist/**",
  "build/**",

  # Exclude generated files
  "src/generated/**",
  "**/*.generated.ts",

  # Exclude vendor/third-party code
  "vendor/**",
  "third-party/**"
]
```

## Sourcemaps

Internally, Bun transpiles all files by default, so Bun automatically generates an internal source map that maps lines of your original source code onto Bun's internal representation. If for any reason you want to disable this, set `test.coverageIgnoreSourcemaps` to `true`; this will rarely be desirable outside of advanced use cases.

```toml title="bunfig.toml" icon="settings"
[test]
coverageIgnoreSourcemaps = true  # default false
```

<Warning>
  When using this option, you probably want to stick a `// @bun` comment at the top of the source file to opt out of the
  transpilation process.
</Warning>

## Coverage Defaults

By default, coverage reports:

- **Exclude** `node_modules` directories
- **Exclude** files loaded via non-JS/TS loaders (e.g., `.css`, `.txt`) unless a custom JS loader is specified
- **Include** test files themselves (can be disabled with `coverageSkipTestFiles = true`)
- Can exclude additional files with `coveragePathIgnorePatterns`

## Advanced Configuration

### Custom Coverage Directory

```toml title="bunfig.toml" icon="settings"
[test]
coverageDir = "coverage-reports"  # default "coverage"
```

### Multiple Reporters

```toml title="bunfig.toml" icon="settings"
[test]
coverageReporter = ["text", "lcov"]
```

### Coverage with Specific Test Patterns

```bash terminal icon="terminal"
# Run coverage only on specific test files
bun test --coverage src/components/*.test.ts

# Run coverage with name pattern
bun test --coverage --test-name-pattern="API"
```

## CI/CD Integration

### GitHub Actions Example

```yaml title=".github/workflows/coverage.yml" icon="file-code"
name: Coverage Report
on: [push, pull_request]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Run tests with coverage
        run: bun test --coverage --coverage-reporter=lcov

      - name: Upload to Codecov
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
          fail_ci_if_error: true
```

### GitLab CI Example

```yaml title=".gitlab-ci.yml"
test:coverage:
  stage: test
  script:
    - bun install
    - bun test --coverage --coverage-reporter=lcov
  coverage: '/Lines\s*:\s*(\d+.\d+)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/lcov.info
```

## Interpreting Coverage Reports

### Text Output Explanation

```
-------------|---------|---------|-------------------
File         | % Funcs | % Lines | Uncovered Line #s
-------------|---------|---------|-------------------
All files    |   85.71 |   90.48 |
 src/        |   85.71 |   90.48 |
  utils.ts   |  100.00 |  100.00 |
  api.ts     |   75.00 |   85.71 | 15-18,25
  main.ts    |   80.00 |   88.89 | 42,50-52
-------------|---------|---------|-------------------
```

- **% Funcs**: Percentage of functions that were called during tests
- **% Lines**: Percentage of executable lines that were run during tests
- **Uncovered Line #s**: Specific line numbers that were not executed

### What to Aim For

- **80%+ overall coverage**: Generally considered good
- **90%+ critical paths**: Important business logic should be well-tested
- **100% utility functions**: Pure functions and utilities are easy to test completely
- **Lower coverage for UI components**: Often acceptable as they may require integration tests

## Best Practices

### Focus on Quality, Not Just Quantity

```ts title="test.ts" icon="/icons/typescript.svg"
// Good: Test actual functionality
test("calculateTax should handle different tax rates", () => {
  expect(calculateTax(100, 0.08)).toBe(8);
  expect(calculateTax(100, 0.1)).toBe(10);
  expect(calculateTax(0, 0.08)).toBe(0);
});

// Avoid: Just hitting lines for coverage
test("calculateTax exists", () => {
  calculateTax(100, 0.08); // No assertions!
});
```

### Test Edge Cases

```ts title="test.ts" icon="/icons/typescript.svg"
test("user input validation", () => {
  // Test normal case
  expect(validateEmail("user@example.com")).toBe(true);

  // Test edge cases that improve coverage meaningfully
  expect(validateEmail("")).toBe(false);
  expect(validateEmail("invalid")).toBe(false);
  expect(validateEmail(null)).toBe(false);
});
```

### Use Coverage to Find Missing Tests

```bash terminal icon="terminal"
# Run coverage to identify untested code
bun test --coverage

# Look at specific files that need attention
bun test --coverage src/critical-module.ts
```

### Combine with Other Quality Metrics

Coverage is just one metric. Also consider:

- **Code review quality**
- **Integration test coverage**
- **Error handling tests**
- **Performance tests**
- **Type safety**

## Troubleshooting

### Coverage Not Showing for Some Files

If files aren't appearing in coverage reports, they might not be imported by your tests. Coverage only tracks files that are actually loaded.

```ts title="test.ts" icon="/icons/typescript.svg"
// Make sure to import the modules you want to test
import { myFunction } from "../src/my-module";

test("my function works", () => {
  expect(myFunction()).toBeDefined();
});
```

### False Coverage Reports

If you see coverage reports that don't match your expectations:

1. Check if source maps are working correctly
2. Verify file patterns in `coveragePathIgnorePatterns`
3. Ensure test files are actually importing the code to test

### Performance Issues with Large Codebases

For large projects, coverage collection can slow down tests:

```toml title="bunfig.toml" icon="settings"
[test]
# Exclude large directories you don't need coverage for
coveragePathIgnorePatterns = [
  "node_modules/**",
  "vendor/**",
  "generated/**"
]
```

Consider running coverage only on CI or specific branches rather than every test run during development.
