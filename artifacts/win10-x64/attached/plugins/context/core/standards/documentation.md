<!-- Context: standards/docs | Priority: critical | Version: 2.0 | Updated: 2025-01-21 -->

# Documentation Standards

## Quick Reference

**Golden Rule**: If users ask the same question twice, document it

**Document** (✅ DO):
- WHY decisions were made
- Complex algorithms/logic
- Public APIs, setup, common use cases

**Don't Document** (❌ DON'T):
- Obvious code (i++ doesn't need comment)
- What code does (should be self-explanatory)

**Principles**: Audience-focused, Show don't tell, Keep current

---

## Principles

**Audience-focused**: Write for users (what/how), developers (why/when), contributors (setup/conventions)
**Show, don't tell**: Code examples, real use cases, expected output
**Keep current**: Update with code changes, remove outdated info, mark deprecations

## README Structure

```markdown
# Project Name
Brief description (1-2 sentences)

## Features
- Key feature 1
- Key feature 2

## Installation
```bash
npm install package-name
```

## Quick Start
```javascript
const result = doSomething();
```

## Usage
[Detailed examples]

## API Reference
[If applicable]

## Contributing
[Link to CONTRIBUTING.md]

## License
[License type]
```

## Function Documentation

```javascript
/**
 * Calculate total price including tax
 * 
 * @param {number} price - Base price
 * @param {number} taxRate - Tax rate (0-1)
 * @returns {number} Total with tax
 * 
 * @example
 * calculateTotal(100, 0.1) // 110
 */
function calculateTotal(price, taxRate) {
  return price * (1 + taxRate);
}
```

## What to Document

### ✅ DO
- **WHY** decisions were made
- Complex algorithms/logic
- Non-obvious behavior
- Public APIs
- Setup/installation
- Common use cases
- Known limitations
- Workarounds (with explanation)

### ❌ DON'T
- Obvious code (i++ doesn't need comment)
- What code does (should be self-explanatory)
- Redundant information
- Outdated/incorrect info

## Comments

### Good
```javascript
// Calculate discount by tier (Bronze: 5%, Silver: 10%, Gold: 15%)
const discount = getDiscountByTier(customer.tier);

// HACK: API returns null instead of [], normalize it
const items = response.items || [];

// TODO: Use async/await when Node 18+ is minimum
```

### Bad
```javascript
// Increment i
i++;

// Get user
const user = getUser();
```

## API Documentation

```markdown
### POST /api/users
Create a new user

**Request:**
```json
{ "name": "John", "email": "john@example.com" }
```

**Response:**
```json
{ "id": "123", "name": "John", "email": "john@example.com" }
```

**Errors:**
- 400 - Invalid input
- 409 - Email exists
```

## Best Practices

✅ Explain WHY, not just WHAT
✅ Include working examples
✅ Show expected output
✅ Cover error handling
✅ Use consistent terminology
✅ Keep structure predictable
✅ Update when code changes

**Golden Rule**: If users ask the same question twice, document it.
