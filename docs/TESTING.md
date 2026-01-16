# Testing Guide

**Last Updated:** 2026-01-15

This document covers testing patterns, strategies, and setup for the OpenWork codebase.

## Table of Contents

- [Overview](#overview)
- [Test Runner](#test-runner)
- [Testing Patterns](#testing-patterns)
- [Solid.js Component Testing](#solidjs-component-testing)
- [Rust Testing](#rust-testing)
- [Writing Tests](#writing-tests)
- [Running Tests](#running-tests)

---

## Overview

### Current Testing Status

The OpenWork codebase uses **Bun's built-in test runner** for TypeScript/JavaScript tests and **Cargo** for Rust tests.

| Package | Has Tests | Test Framework |
|---------|-----------|----------------|
| `packages/opencode` | Yes | Bun test |
| `packages/app` | Partial | Bun test |
| `packages/ui` | No | - |
| `packages/sdk` | No | - |
| `packages/desktop` (Rust) | Yes | Cargo test |
| `tauri-plugin-mcp` (Rust) | Yes | Cargo test |

### Test Philosophy

1. **Unit tests** for utilities and pure functions
2. **Integration tests** for context providers and stores
3. **Rust tests** for backend functionality
4. **Manual testing** for UI components (via desktop app)

---

## Test Runner

### Bun Test

OpenWork uses Bun's built-in test runner which is Jest-compatible:

```bash
# Run all tests in a package
cd packages/opencode
bun test

# Run specific test file
bun test src/utils/serialize.test.ts

# Run with coverage
bun test --coverage

# Watch mode
bun test --watch
```

### Test File Naming

Tests should be co-located with source files:

```
src/
├── utils/
│   ├── serialize.ts
│   └── serialize.test.ts
├── context/
│   ├── layout.tsx
│   └── layout.test.ts
```

Or in a `__tests__` directory:

```
src/
├── utils/
│   ├── serialize.ts
│   └── __tests__/
│       └── serialize.test.ts
```

---

## Testing Patterns

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test"

describe("MyModule", () => {
  beforeEach(() => {
    // Setup before each test
  })

  afterEach(() => {
    // Cleanup after each test
  })

  describe("functionName", () => {
    it("should do something specific", () => {
      const result = functionName(input)
      expect(result).toBe(expected)
    })

    it("should handle edge cases", () => {
      expect(() => functionName(null)).toThrow()
    })
  })
})
```

### Testing Async Functions

```typescript
import { describe, it, expect } from "bun:test"

describe("AsyncModule", () => {
  it("should resolve with correct value", async () => {
    const result = await asyncFunction()
    expect(result).toBe(expected)
  })

  it("should reject on error", async () => {
    await expect(asyncFunction()).rejects.toThrow("Error message")
  })
})
```

### Mocking

```typescript
import { describe, it, expect, mock, spyOn } from "bun:test"

describe("WithMocks", () => {
  it("should call dependency", () => {
    const mockFn = mock(() => "mocked value")

    const result = functionUnderTest(mockFn)

    expect(mockFn).toHaveBeenCalled()
    expect(mockFn).toHaveBeenCalledWith(expectedArg)
  })

  it("should spy on method", () => {
    const obj = { method: () => "original" }
    const spy = spyOn(obj, "method").mockReturnValue("mocked")

    const result = obj.method()

    expect(spy).toHaveBeenCalled()
    expect(result).toBe("mocked")
  })
})
```

---

## Solid.js Component Testing

### Setup for Solid.js Tests

```typescript
import { describe, it, expect } from "bun:test"
import { render, screen, fireEvent } from "@solidjs/testing-library"
import { MyComponent } from "./my-component"

describe("MyComponent", () => {
  it("renders correctly", () => {
    render(() => <MyComponent name="Test" />)

    expect(screen.getByText("Test")).toBeTruthy()
  })

  it("handles click events", async () => {
    const handleClick = mock(() => {})
    render(() => <MyComponent onClick={handleClick} />)

    await fireEvent.click(screen.getByRole("button"))

    expect(handleClick).toHaveBeenCalled()
  })
})
```

### Testing Contexts

```typescript
import { describe, it, expect } from "bun:test"
import { render } from "@solidjs/testing-library"
import { MyProvider, useMyContext } from "./my-context"

// Test component that uses the context
function TestConsumer() {
  const ctx = useMyContext()
  return <div data-testid="value">{ctx.value()}</div>
}

describe("MyContext", () => {
  it("provides default values", () => {
    const { getByTestId } = render(() => (
      <MyProvider>
        <TestConsumer />
      </MyProvider>
    ))

    expect(getByTestId("value").textContent).toBe("default")
  })
})
```

### Testing Stores

Example from the codebase (`layout-scroll.test.ts`):

```typescript
import { describe, it, expect } from "bun:test"
import { createStore } from "solid-js/store"

describe("Layout Store", () => {
  it("should update nested values", () => {
    const [store, setStore] = createStore({
      sidebar: { opened: false, width: 280 }
    })

    setStore("sidebar", "opened", true)

    expect(store.sidebar.opened).toBe(true)
    expect(store.sidebar.width).toBe(280)
  })

  it("should handle array operations", () => {
    const [store, setStore] = createStore({
      items: [] as string[]
    })

    setStore("items", (items) => [...items, "new item"])

    expect(store.items).toContain("new item")
  })
})
```

### Testing Reactive Effects

```typescript
import { describe, it, expect } from "bun:test"
import { createRoot, createSignal, createEffect } from "solid-js"

describe("Reactive Effects", () => {
  it("should react to signal changes", () => {
    return new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [count, setCount] = createSignal(0)
        const values: number[] = []

        createEffect(() => {
          values.push(count())
          if (values.length === 2) {
            expect(values).toEqual([0, 1])
            dispose()
            resolve()
          }
        })

        setCount(1)
      })
    })
  })
})
```

---

## Rust Testing

### Running Rust Tests

```bash
# Run all Rust tests
cargo test

# Run tests for specific package
cargo test -p openwork-desktop

# Run with output
cargo test -- --nocapture

# Run specific test
cargo test test_name
```

### Rust Test Structure

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_functionality() {
        let result = my_function(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_error_handling() {
        let result = risky_function();
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_async_function() {
        let result = async_function().await;
        assert!(result.is_ok());
    }
}
```

### Testing Tauri Commands

```rust
#[cfg(test)]
mod tests {
    use tauri::test::MockRuntime;

    #[test]
    fn test_command() {
        let app = tauri::test::mock_builder()
            .build(tauri::generate_context!())
            .unwrap();

        let result = my_command(app.handle());
        assert!(result.is_ok());
    }
}
```

---

## Writing Tests

### Test Naming Conventions

```typescript
// Use descriptive names
describe("UserService", () => {
  describe("createUser", () => {
    it("should create a user with valid data")
    it("should throw ValidationError for invalid email")
    it("should hash password before storing")
  })
})
```

### Arrange-Act-Assert Pattern

```typescript
it("should calculate total correctly", () => {
  // Arrange
  const items = [
    { price: 10, quantity: 2 },
    { price: 5, quantity: 3 },
  ]

  // Act
  const total = calculateTotal(items)

  // Assert
  expect(total).toBe(35)
})
```

### Testing Edge Cases

```typescript
describe("parseInput", () => {
  it("handles empty string", () => {
    expect(parseInput("")).toEqual([])
  })

  it("handles null input", () => {
    expect(() => parseInput(null)).toThrow()
  })

  it("handles very long strings", () => {
    const longString = "a".repeat(10000)
    expect(parseInput(longString)).toBeDefined()
  })

  it("handles unicode characters", () => {
    expect(parseInput("Hello 世界")).toContain("世界")
  })
})
```

### Test Fixtures

```typescript
// fixtures/users.ts
export const validUser = {
  id: "user_123",
  email: "test@example.com",
  name: "Test User",
}

export const invalidUser = {
  id: "",
  email: "invalid-email",
  name: "",
}

// users.test.ts
import { validUser, invalidUser } from "./fixtures/users"

describe("validateUser", () => {
  it("accepts valid user", () => {
    expect(validateUser(validUser)).toBe(true)
  })

  it("rejects invalid user", () => {
    expect(validateUser(invalidUser)).toBe(false)
  })
})
```

---

## Running Tests

### Package-Level Tests

```bash
# OpenCode CLI tests
cd packages/opencode
bun test

# App tests
cd packages/app
bun test
```

### Rust Tests

```bash
# Desktop backend tests
cd packages/desktop/src-tauri
cargo test

# MCP plugin tests
cd tauri-plugin-mcp
cargo test
```

### Continuous Integration

Tests run automatically on PR via GitHub Actions:

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run typecheck
      - run: bun test
```

### Coverage Reports

```bash
# Generate coverage report
bun test --coverage

# View coverage summary
open coverage/index.html
```

---

## Best Practices

### Do's

1. **Test behavior, not implementation**
   ```typescript
   // Good: tests the behavior
   it("should return sorted items", () => {
     expect(sortItems([3, 1, 2])).toEqual([1, 2, 3])
   })

   // Avoid: tests implementation details
   it("should call Array.sort", () => { /* ... */ })
   ```

2. **Keep tests isolated**
   ```typescript
   beforeEach(() => {
     // Reset state before each test
     resetStore()
   })
   ```

3. **Use meaningful assertions**
   ```typescript
   // Good
   expect(user.email).toBe("test@example.com")

   // Avoid
   expect(user).toBeTruthy()
   ```

### Don'ts

1. **Don't test third-party libraries**
2. **Don't write tests that depend on execution order**
3. **Don't use arbitrary timeouts**
   ```typescript
   // Avoid
   await new Promise(r => setTimeout(r, 1000))

   // Better: use proper async handling
   await waitFor(() => expect(element).toBeVisible())
   ```

4. **Don't ignore failing tests**
   ```typescript
   // Never do this in production code
   it.skip("broken test", () => { /* ... */ })
   ```

---

## Debugging Tests

### Verbose Output

```bash
# Show console.log output
bun test -- --reporter=verbose

# Show all output including passed tests
bun test --reporter=spec
```

### Debugging with Breakpoints

```typescript
it("debug this test", () => {
  debugger // Add breakpoint
  const result = myFunction()
  expect(result).toBe(expected)
})
```

Run with:
```bash
bun test --inspect-brk
```

### Isolating Failing Tests

```typescript
// Run only this test
it.only("specific test", () => { /* ... */ })

// Skip this test temporarily
it.skip("flaky test", () => { /* ... */ })
```
