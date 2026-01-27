# TOON Testing Guide

## 🧪 Test Suite Overview

The TOON implementation includes **80+ comprehensive tests** across 5 test files:

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `toon.test.ts` | 23 | Core serialization, all modes, code preservation |
| `toon-metadata.test.ts` | 10 | Metadata tracking, session management |
| `toon-integration.test.ts` | 40+ | End-to-end integration, real-world scenarios |
| `toon-performance.test.ts` | 15+ | Performance, memory efficiency, stress tests |
| `toon-regression.test.ts` | 20+ | Edge cases, boundary conditions, known issues |

---

## 🚀 Running Tests

### Run All TOON Tests

```bash
cd packages/opencode
bun run scripts/test-toon.ts
```

### Run Individual Test Files

```bash
# Core serialization tests
bun test test/toon.test.ts

# Metadata tests
bun test test/toon-metadata.test.ts

# Integration tests
bun test test/toon-integration.test.ts

# Performance tests
bun test test/toon-performance.test.ts

# Regression tests
bun test test/toon-regression.test.ts
```

### Run with Coverage

```bash
bun test --coverage test/toon*.test.ts
```

### Run in Watch Mode

```bash
bun test --watch test/toon*.test.ts
```

---

## 📋 Test Categories

### 1. Unit Tests (`toon.test.ts`)

Tests core TOON serialization functionality:

- ✅ Compact mode transformations
- ✅ Balanced mode transformations
- ✅ Verbose mode transformations
- ✅ Code block preservation
- ✅ Token estimation accuracy
- ✅ Edge cases (empty strings, whitespace, etc.)
- ✅ Real-world examples

**Example:**
```typescript
test("compact mode removes articles", () => {
  const input = "Create a function that returns the value"
  const output = TOON.serialize(input, { mode: "compact", preserveCode: true })
  
  expect(output).not.toContain(" a ")
  expect(output).not.toContain(" the ")
})
```

### 2. Metadata Tests (`toon-metadata.test.ts`)

Tests savings tracking and session management:

- ✅ Recording savings data
- ✅ Retrieving savings by session
- ✅ Formatting display messages
- ✅ Clearing session data
- ✅ Multi-session handling

**Example:**
```typescript
test("records savings data for a session", () => {
  const savingsData = {
    tokensSaved: 42,
    savingsPercentage: 21.0,
    mode: "balanced",
  }
  
  TOONMetadata.recordSavings(sessionID, savingsData)
  const retrieved = TOONMetadata.getSavings(sessionID)
  
  expect(retrieved).toEqual(savingsData)
})
```

### 3. Integration Tests (`toon-integration.test.ts`)

Tests end-to-end message transformation:

- ✅ User message transformation
- ✅ System message preservation
- ✅ Multi-part messages
- ✅ Mixed message types
- ✅ Savings calculation
- ✅ Configuration handling
- ✅ Real-world scenarios (refactoring, configuration, conversations)

**Example:**
```typescript
test("scenario: multi-turn conversation", async () => {
  const messages = [
    { role: "user", content: "Create a function to calculate totals" },
    { role: "assistant", content: "Here is a function that returns the total value" },
    { role: "user", content: "Add a parameter for the tax rate" },
  ]
  
  const result = await TOONTransform.transform(messages, sessionID)
  
  expect(result.savings.tokensSaved).toBeGreaterThan(15)
  expect(result.savings.savingsPercentage).toBeGreaterThan(15)
})
```

### 4. Performance Tests (`toon-performance.test.ts`)

Tests performance and efficiency:

- ✅ Transformation speed (1000 ops < 100ms)
- ✅ Large text handling
- ✅ Memory efficiency
- ✅ Savings consistency
- ✅ Mode comparison
- ✅ Stress tests (10k+ repetitions, 100+ code blocks)

**Example:**
```typescript
test("transforms short text quickly", () => {
  const text = "Create a function that returns a value"
  const start = performance.now()
  
  for (let i = 0; i < 1000; i++) {
    TOON.serialize(text, { mode: "balanced", preserveCode: true })
  }
  
  const duration = performance.now() - start
  expect(duration).toBeLessThan(100) // < 100ms for 1000 ops
})
```

### 5. Regression Tests (`toon-regression.test.ts`)

Tests edge cases and prevents known issues:

- ✅ Code identifier preservation
- ✅ Whitespace normalization
- ✅ Markdown formatting
- ✅ Malformed code blocks
- ✅ Boundary conditions
- ✅ Case sensitivity
- ✅ Multi-language code blocks

**Example:**
```typescript
test("doesn't remove articles from code identifiers", () => {
  const text = `\`\`\`typescript
const theValue = 42
const aFunction = () => {}
\`\`\``
  
  const result = TOON.serialize(text, { mode: "compact", preserveCode: true })
  
  expect(result).toContain("theValue")
  expect(result).toContain("aFunction")
})
```

---

## ✅ Expected Results

When all tests pass, you should see:

```
🧪 Running TOON Test Suite

============================================================

📝 Running test/toon.test.ts...
✅ 23 tests passed

📝 Running test/toon-metadata.test.ts...
✅ 10 tests passed

📝 Running test/toon-integration.test.ts...
✅ 42 tests passed

📝 Running test/toon-performance.test.ts...
✅ 18 tests passed

📝 Running test/toon-regression.test.ts...
✅ 25 tests passed

============================================================

📊 Test Summary:
   Total Tests: 118
   ✅ Passed: 118
   ❌ Failed: 0

🎉 All tests passed!
```

---

## 🐛 Debugging Failed Tests

If tests fail:

1. **Check dependencies**:
   ```bash
   bun install
   ```

2. **Run specific test with verbose output**:
   ```bash
   bun test --verbose test/toon.test.ts
   ```

3. **Check for TypeScript errors**:
   ```bash
   bun run tsc --noEmit
   ```

4. **View detailed error**:
   ```bash
   bun test test/toon.test.ts 2>&1 | less
   ```

---

## 📊 Coverage Goals

Target coverage metrics:

- **Line Coverage**: > 90%
- **Branch Coverage**: > 85%
- **Function Coverage**: 100%

Check coverage:
```bash
bun test --coverage test/toon*.test.ts
```

---

## 🔄 Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
- name: Run TOON Tests
  run: |
    cd packages/opencode
    bun install
    bun run scripts/test-toon.ts
```

---

## 📝 Writing New Tests

When adding new TOON features, follow this pattern:

```typescript
import { describe, test, expect } from "bun:test"
import { TOON } from "../src/format/toon"

describe("New Feature", () => {
  test("should do something", () => {
    const input = "test input"
    const result = TOON.serialize(input, { mode: "balanced", preserveCode: true })
    
    expect(result).toBe("expected output")
  })
})
```

---

## 🎯 Test Checklist

Before submitting changes:

- [ ] All existing tests pass
- [ ] New features have tests
- [ ] Edge cases are covered
- [ ] Performance tests pass
- [ ] Coverage > 90%
- [ ] No console errors or warnings
