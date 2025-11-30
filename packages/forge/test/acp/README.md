# ACP Tests

This directory contains tests for the Agent Client Protocol (ACP) integration.

## Test Structure

```
test/acp/
├── integration/          # Integration tests requiring real ACP agents
│   ├── demo.ts          # Interactive demo (run manually)
│   ├── basic-flow.test.ts    # Basic client operations
│   └── mode-management.test.ts  # Session mode management
├── translation/         # Protocol translation tests
│   ├── text.test.ts    # Text content translation
│   └── tool.test.ts    # Tool call translation
├── orchestrator.test.ts # Orchestrator unit tests
├── subprocess.test.ts   # Subprocess management tests
├── translator.test.ts   # Protocol translator tests
├── helpers.ts           # Test utilities and fixtures
└── fixtures/            # Test data and mock responses
```

## Running Tests

### Unit Tests (no API key required)
```bash
bun test test/acp/orchestrator.test.ts
bun test test/acp/subprocess.test.ts
bun test test/acp/translator.test.ts
bun test test/acp/translation/
```

### Integration Tests (requires ANTHROPIC_API_KEY)
```bash
# All integration tests
ANTHROPIC_API_KEY=xxx bun test test/acp/integration/

# Specific test suite
ANTHROPIC_API_KEY=xxx bun test test/acp/integration/basic-flow.test.ts
ANTHROPIC_API_KEY=xxx bun test test/acp/integration/mode-management.test.ts
```

### Interactive Demo
```bash
ANTHROPIC_API_KEY=xxx bun test/acp/integration/demo.ts
```

## Test Categories

### Integration Tests
- **basic-flow.test.ts**: Tests fundamental ACP operations (connect, initialize, session, prompt)
- **mode-management.test.ts**: Tests session mode operations (get modes, switch modes, notifications)

### Unit Tests
- **orchestrator.test.ts**: Tests the high-level orchestration logic
- **subprocess.test.ts**: Tests subprocess management and lifecycle
- **translator.test.ts**: Tests protocol message translation
- **translation/*.test.ts**: Tests specific translation scenarios

## Writing New Tests

### Integration Test Template
```typescript
import { ACPClient } from "../../../src/acp/client"
import { describe, test, expect } from "bun:test"

describe("My Test Suite", () => {
  test("should do something", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("⊘ Skipping test: ANTHROPIC_API_KEY not set")
      return
    }

    const client = await ACPClient.create({
      command: "npx",
      args: ["@zed-industries/claude-code-acp"],
      cwd: process.cwd(),
      env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY },
    })

    try {
      // Your test logic here
    } finally {
      await client.dispose()
    }
  })
})
```

### Unit Test Template
```typescript
import { describe, test, expect } from "bun:test"
import { YourModule } from "../../src/acp/your-module"

describe("YourModule", () => {
  test("should do something", () => {
    // Test logic using mocks/fixtures
  })
})
```

## Test Guidelines

1. **Integration tests** should always check for `ANTHROPIC_API_KEY` and skip gracefully if not present
2. **Unit tests** should use fixtures from `./fixtures/` and helpers from `./helpers.ts`
3. Always clean up resources in `finally` blocks
4. Use descriptive test names that explain the expected behavior
5. Group related tests in `describe` blocks
6. Keep tests focused - one behavior per test
