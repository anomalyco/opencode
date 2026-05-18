<!-- Context: standards/tests | Priority: critical | Version: 2.0 | Updated: 2025-01-21 -->

# Testing Standards

## Quick Reference

**Golden Rule**: If you can't test it easily, refactor it

**AAA Pattern**: Arrange → Act → Assert

**Test** (✅ DO):
- Happy path, edge cases, error cases
- Business logic, public APIs

**Don't Test** (❌ DON'T):
- Third-party libraries, framework internals
- Simple getters/setters, private details

**Coverage**: Critical (100%), High (90%+), Medium (80%+)

---

## Principles

**Test behavior, not implementation**: Focus on what code does, not how
**Keep tests simple**: One assertion per test, clear names, minimal setup
**Independent tests**: No shared state, run in any order
**Fast and reliable**: Quick execution, no flaky tests, deterministic

## Test Structure (AAA Pattern)

```javascript
test('calculateTotal returns sum of item prices', () => {
  // Arrange - Set up test data
  const items = [{ price: 10 }, { price: 20 }, { price: 30 }];
  
  // Act - Execute code
  const result = calculateTotal(items);
  
  // Assert - Verify result
  expect(result).toBe(60);
});
```

## What to Test

### ✅ DO Test
- Happy path (normal usage)
- Edge cases (boundaries, empty, null, undefined)
- Error cases (invalid input, failures)
- Business logic (core functionality)
- Public APIs (exported functions)

### ❌ DON'T Test
- Third-party libraries
- Framework internals
- Simple getters/setters
- Private implementation details

## Coverage Goals

1. **Critical**: Business logic, data transformations (100%)
2. **High**: Public APIs, user-facing features (90%+)
3. **Medium**: Utilities, helpers (80%+)
4. **Low**: Simple wrappers, configs (optional)

## Testing Pure Functions

```javascript
function add(a, b) { return a + b; }

test('add returns sum', () => {
  expect(add(2, 3)).toBe(5);
  expect(add(-1, 1)).toBe(0);
  expect(add(0, 0)).toBe(0);
});
```

## Testing with Dependencies

```javascript
// Testable with dependency injection
function createUserService(database) {
  return {
    getUser: (id) => database.findById('users', id)
  };
}

// Test with mock
test('getUser retrieves from database', () => {
  const mockDb = {
    findById: jest.fn().mockReturnValue({ id: 1, name: 'John' })
  };
  
  const service = createUserService(mockDb);
  const user = service.getUser(1);
  
  expect(mockDb.findById).toHaveBeenCalledWith('users', 1);
  expect(user).toEqual({ id: 1, name: 'John' });
});
```

## Test Naming

```javascript
// ✅ Good: Descriptive, clear expectation
test('calculateDiscount returns 10% off for premium users', () => {});
test('validateEmail returns false for invalid format', () => {});
test('createUser throws error when email exists', () => {});

// ❌ Bad: Vague, unclear
test('it works', () => {});
test('test user', () => {});
```

## Best Practices

✅ Test one thing per test
✅ Use descriptive test names
✅ Keep tests independent
✅ Mock external dependencies
✅ Test edge cases and errors
✅ Make tests readable
✅ Run tests frequently
✅ Fix failing tests immediately

**Golden Rule**: If you can't test it easily, refactor it.
