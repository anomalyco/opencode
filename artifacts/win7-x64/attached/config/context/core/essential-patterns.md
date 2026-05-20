<!-- Context: core/essential-patterns | Priority: critical | Version: 1.0 | Updated: 2026-02-15 -->

# Essential Patterns - Core Development Guidelines

## Quick Reference

**Core Philosophy**: Modular, Functional, Maintainable

**Critical Patterns**: Error Handling, Validation, Security, Logging, Pure Functions

**ALWAYS**: Handle errors gracefully, validate input, use env vars for secrets, write pure functions

**NEVER**: Expose sensitive info, hardcode credentials, skip input validation, mutate state

**Language-agnostic**: Apply to all programming languages

---

## Overview

This file provides essential development patterns that apply across all programming languages. For detailed standards, see:
- `standards/code-quality.md` - Modular, functional code patterns
- `standards/security-patterns.md` - Language-agnostic patterns
- `standards/test-coverage.md` - Testing standards
- `standards/documentation.md` - Documentation standards
- `standards/code-analysis.md` - Analysis framework

---

## Core Philosophy

**Modular**: Everything is a component - small, focused, reusable
**Functional**: Pure functions, immutability, composition over inheritance
**Maintainable**: Self-documenting, testable, predictable

---

## Critical Patterns

### 1. Pure Functions

**ALWAYS** write pure functions:
- Same input = same output
- No side effects
- No mutation of external state
- Predictable and testable

### 2. Error Handling

**ALWAYS** handle errors gracefully:
- Catch specific errors, not generic ones
- Log errors with context
- Return meaningful error messages
- Don't expose internal implementation details
- Use language-specific error handling mechanisms (try/catch, Result, error returns)

### 3. Input Validation

**ALWAYS** validate input data:
- Check for null/nil/None values
- Validate data types
- Validate data ranges and constraints
- Sanitize user input
- Return clear validation error messages

### 4. Security

**NEVER** expose sensitive information:
- Don't log passwords, tokens, or API keys
- Use environment variables for secrets
- Sanitize all user input
- Use parameterized queries (prevent SQL injection)
- Validate and escape output (prevent XSS)

### 5. Logging

**USE** consistent logging levels:
- **Debug**: Detailed information for debugging (development only)
- **Info**: Important events and milestones
- **Warning**: Potential issues that don't stop execution
- **Error**: Failures and exceptions

---

## Code Structure Patterns

### Modular Design
- Single responsibility per module
- Clear interfaces (explicit inputs/outputs)
- Independent and composable
- < 100 lines per component (ideally < 50)

### Functional Approach
- **Pure functions**: Same input = same output, no side effects
- **Immutability**: Create new data, don't modify existing
- **Composition**: Build complex from simple functions
- **Declarative**: Describe what, not how

### Component Structure
```
component/
├── index.js      # Public interface
├── core.js       # Core logic (pure functions)
├── utils.js      # Helpers
└── tests/        # Tests
```

---

## Anti-Patterns to Avoid

**Code Smells**:
- ❌ Mutation and side effects
- ❌ Deep nesting (> 3 levels)
- ❌ God modules (> 200 lines)
- ❌ Global state
- ❌ Large functions (> 50 lines)
- ❌ Hardcoded values
- ❌ Tight coupling

**Security Issues**:
- ❌ Hardcoded credentials
- ❌ Exposed sensitive data in logs
- ❌ Unvalidated user input
- ❌ SQL injection vulnerabilities
- ❌ XSS vulnerabilities

---

## Testing Patterns

**ALWAYS** write tests:
- Unit tests for pure functions
- Integration tests for components
- Test edge cases and error conditions
- Aim for > 80% coverage
- Use descriptive test names

**Test Structure**:
```
describe('Component', () => {
  it('should handle valid input', () => {
    // Arrange
    const input = validData;
    
    // Act
    const result = component(input);
    
    // Assert
    expect(result).toBe(expected);
  });
  
  it('should handle invalid input', () => {
    // Test error cases
  });
});
```

---

## Documentation Patterns

**ALWAYS** document:
- Public APIs and interfaces
- Complex logic and algorithms
- Non-obvious decisions
- Usage examples

**Use clear, concise language**:
- Explain WHY, not just WHAT
- Include examples
- Keep it up to date
- Use consistent formatting

---

## Language-Specific Implementations

These patterns are language-agnostic. For language-specific implementations:

**TypeScript/JavaScript**: See project context for Next.js, React, Node.js patterns
**Python**: See project context for FastAPI, Django patterns
**Go**: See project context for Go-specific patterns
**Rust**: See project context for Rust-specific patterns

---

## Quick Checklist

Before committing code, verify:
- ✅ Pure functions (no side effects)
- ✅ Input validation
- ✅ Error handling
- ✅ No hardcoded secrets
- ✅ Tests written and passing
- ✅ Documentation updated
- ✅ No security vulnerabilities
- ✅ Code is modular and maintainable

---

## Additional Resources

For more detailed guidelines, see:
- `standards/code-quality.md` - Comprehensive code standards
- `standards/security-patterns.md` - Detailed pattern catalog
- `standards/test-coverage.md` - Testing best practices
- `standards/documentation.md` - Documentation guidelines
- `standards/code-analysis.md` - Code analysis framework
- `workflows/code-review.md` - Code review process
