# Code Quality Guidelines

> Mandatory code quality rules for all Electron applications.

---

## No Non-Null Assertions

**NEVER** use non-null assertions (`!`). They bypass TypeScript's null checking and lead to runtime errors.

```typescript
// FORBIDDEN
const name = user!.name;
const value = data!.items![0]!;

// REQUIRED - Use explicit checks
const user = getUser();
if (!user) {
  throw new Error('User not found');
}
const name = user.name;

// REQUIRED - Use optional chaining with fallback
const value = data?.items?.[0] ?? defaultValue;

// REQUIRED - Use local variable after null check
const project = getProject(id);
if (!project) {
  return { success: false, error: 'Project not found' };
}
// Now project is narrowed to non-null
const projectName = project.name;
```

---

## Avoid `any` Type

```typescript
// BAD
function process(data: any) { ... }

// GOOD - Use proper types
function process(data: ProcessInput) { ... }

// GOOD - Use unknown for truly unknown data
function parseJSON(input: string): unknown {
  return JSON.parse(input);
}
```

---

## Lint and Type Check Before Commit

```bash
# MUST pass before every commit
npm run lint
npm run typecheck

# Or combined
npm run lint && npm run typecheck
```

---

## Naming Conventions

### Files and Directories

| Type            | Convention                  | Example                     |
| --------------- | --------------------------- | --------------------------- |
| React Component | PascalCase                  | `UserProfile.tsx`           |
| Hook            | camelCase with `use` prefix | `useProject.ts`             |
| Utility         | kebab-case                  | `date-utils.ts`             |
| Type file       | kebab-case or `types.ts`    | `types.ts`, `user-types.ts` |
| Test file       | Same name + `.test`         | `date-utils.test.ts`        |
| Directory       | kebab-case                  | `user-profile/`             |

### Variables and Functions

| Type           | Convention                                  | Example                            |
| -------------- | ------------------------------------------- | ---------------------------------- |
| Variable       | camelCase                                   | `userName`, `isActive`             |
| Constant       | SCREAMING_SNAKE_CASE                        | `MAX_RETRY_COUNT`                  |
| Function       | camelCase                                   | `getUserById`                      |
| Class          | PascalCase                                  | `UserService`                      |
| Type/Interface | PascalCase                                  | `UserInput`, `ProjectOutput`       |
| Enum           | PascalCase (type), SCREAMING_SNAKE (values) | `enum Status { ACTIVE, INACTIVE }` |

### Boolean Variables

Use `is`, `has`, `should`, `can` prefixes:

```typescript
// GOOD
const isLoading = true;
const hasPermission = user.role === 'admin';
const shouldRefresh = Date.now() > expiresAt;
const canEdit = isOwner || hasPermission;

// BAD
const loading = true;
const permission = user.role === 'admin';
```

---

## Error Handling

### Use Structured Errors

```typescript
// Define error types
class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Specific error types
class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}
```

### Error Response Format

```typescript
// Consistent error response
interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
}

// Example
return {
  success: false,
  error: 'Invalid input',
  code: 'VALIDATION_ERROR',
};
```

### Never Swallow Errors

```typescript
// BAD - Swallowing error
try {
  await dangerousOperation();
} catch (e) {
  // Silent failure
}

// GOOD - Log and handle
try {
  await dangerousOperation();
} catch (error) {
  logger.error('operation_failed', { error });
  throw new AppError('Operation failed', 'OPERATION_FAILED');
}
```

---

## Testing Guidelines

### Test File Location

```
src/
├── utils/
│   ├── date-utils.ts
│   └── date-utils.test.ts    # Co-located test
└── __tests__/                 # Integration tests
    └── api.test.ts
```

### Test Naming

```typescript
describe("DateUtils", () => {
  describe("formatDate", () => {
    it("should format date in ISO format", () => { ... });
    it("should handle null input", () => { ... });
    it("should throw on invalid date", () => { ... });
  });
});
```

### Test Structure (AAA Pattern)

```typescript
it('should create a project', async () => {
  // Arrange
  const input = { name: 'Test Project' };

  // Act
  const result = createProject(input);

  // Assert
  expect(result.success).toBe(true);
  expect(result.project.name).toBe('Test Project');
});
```

---

## Summary

| Rule                    | Reason              |
| ----------------------- | ------------------- |
| No `!` assertions       | Runtime errors      |
| No `any` type           | Type safety         |
| Lint before commit      | Consistent code     |
| Typecheck before commit | Catch type errors   |
| Semantic naming         | Readability         |
| Structured errors       | Consistent handling |
| Never swallow errors    | Debuggability       |
