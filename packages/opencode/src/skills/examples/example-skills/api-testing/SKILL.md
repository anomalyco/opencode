---
name: api-testing
description: Use for testing REST APIs, validating endpoints, checking HTTP responses, or API integration testing. Activate when user mentions API testing, endpoint validation, REST testing, or wants to test HTTP requests.
allowed-tools: [Read, Grep, Glob, WebFetch, Bash]
---

# API Testing Skill

This skill provides guidance for testing REST APIs and validating endpoint behavior.

## Testing Approach

### 1. Endpoint Discovery
- Find all API routes in the codebase
- Identify HTTP methods (GET, POST, PUT, DELETE, PATCH)
- Document expected request/response formats

### 2. Test Scenarios
- **Happy Path**: Test with valid inputs
- **Error Cases**: Test with invalid/missing data
- **Edge Cases**: Boundary conditions, special characters
- **Authentication**: Test with/without valid tokens
- **Rate Limiting**: Test throttling behavior

### 3. Validation
- Status codes (200, 201, 400, 401, 404, 500)
- Response schema matches expected format
- Response time within acceptable limits
- Proper error messages
- CORS headers if applicable

## Tools

Use these tools for API testing:
- `curl` or `fetch` for making requests
- Test frameworks: vitest, jest, mocha
- Assertion libraries: chai, expect
- HTTP mocking: msw, nock

## Example Test Structure

```typescript
describe('User API', () => {
  describe('GET /api/users/:id', () => {
    it('should return user data for valid ID', async () => {
      // Test implementation
    })

    it('should return 404 for non-existent user', async () => {
      // Test implementation
    })

    it('should return 401 without authentication', async () => {
      // Test implementation
    })
  })
})
```

## When to Use

Activate this skill for:
- Testing API endpoints
- Validating HTTP responses
- Integration testing with external APIs
- Debugging API issues
- Writing API test suites
