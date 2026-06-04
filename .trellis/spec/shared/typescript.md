# TypeScript Best Practices

> TypeScript guidelines for Electron applications.

---

## Explicit Return Types

Always use explicit return types for exported functions:

```typescript
// BAD - Implicit return type
export function getUser(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

// GOOD - Explicit return type
export function getUser(id: string): User | undefined {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

// GOOD - Async with Promise
export async function getUser(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}
```

---

## Use `type` for Object Types

```typescript
// Use type for most cases
type User = {
  id: string;
  name: string;
  email: string;
};

// Use interface when you expect extension
interface Plugin {
  name: string;
  init(): void;
}

interface AdvancedPlugin extends Plugin {
  cleanup(): void;
}
```

---

## Type Imports

Always use `import type` for type-only imports:

```typescript
// GOOD
import type { User, Project } from './types';
import { createUser } from './procedures';

// Also acceptable
import { type User, createUser } from './types';

// BAD - Mixed imports without type annotation
import { User, createUser } from './types';
```

---

## Zod Schema for Runtime Validation

Use Zod for all external data validation:

```typescript
import { z } from 'zod';

// Define schema
const userInputSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(0).optional(),
});

// Derive type from schema
type UserInput = z.infer<typeof userInputSchema>;

// Validate input
const parseResult = userInputSchema.safeParse(rawInput);
if (!parseResult.success) {
  return { success: false, error: parseResult.error.issues[0].message };
}
const validInput = parseResult.data;
```

---

## Discriminated Unions

Use strict equality for type narrowing:

```typescript
type Result = { success: true; data: string } | { success: false; error: string };

const result: Result = doSomething();

// CORRECT: Use === true
if (result.success === true) {
  console.log(result.data); // TypeScript knows data exists
} else {
  console.log(result.error); // TypeScript knows error exists
}

// WRONG: Truthy check may not narrow properly
if (result.success) {
  console.log(result.data);
} else {
  console.log(result.error); // May cause type error
}
```

---

## Type Guards

Create type guards for runtime type checking:

```typescript
// Type guard function
function isUser(value: unknown): value is User {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'email' in value &&
    typeof (value as User).id === 'string' &&
    typeof (value as User).email === 'string'
  );
}

// Usage
const data: unknown = JSON.parse(response);
if (isUser(data)) {
  console.log(data.email); // TypeScript knows it's a User
}

// With Zod (simpler)
const parseResult = userSchema.safeParse(data);
if (parseResult.success) {
  console.log(parseResult.data.email); // Type-safe
}
```

---

## Generics

Use generics for reusable type-safe functions:

```typescript
// Generic function
function first<T>(items: T[]): T | undefined {
  return items[0];
}

// Generic with constraints
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Generic type
type Result<T> = { success: true; data: T } | { success: false; error: string };

function createResult<T>(data: T): Result<T> {
  return { success: true, data };
}
```

---

## Utility Types

Use built-in utility types:

```typescript
// Partial - all properties optional
type PartialUser = Partial<User>;

// Required - all properties required
type RequiredUser = Required<User>;

// Pick - select specific properties
type UserName = Pick<User, 'name' | 'email'>;

// Omit - exclude specific properties
type UserWithoutId = Omit<User, 'id'>;

// Record - key-value mapping
type UserMap = Record<string, User>;

// ReturnType - extract function return type
type CreateResult = ReturnType<typeof createUser>;
```

---

## Avoid Common Pitfalls

### Don't use `any`

```typescript
// BAD
function process(data: any) { ... }

// GOOD
function process(data: unknown) { ... }
function process(data: ProcessInput) { ... }
```

### Don't use non-null assertion

```typescript
// BAD
const name = user!.name;

// GOOD
if (user) {
  const name = user.name;
}
```

### Don't ignore TypeScript errors

```typescript
// BAD
// @ts-ignore
doSomething(invalidArg);

// GOOD - Fix the type issue
doSomething(validArg);
```

---

## Summary

| Practice              | Reason                      |
| --------------------- | --------------------------- |
| Explicit return types | Documentation, catch errors |
| `import type`         | Clear separation            |
| Zod for validation    | Runtime type safety         |
| `=== true` for unions | Proper narrowing            |
| Type guards           | Runtime checks              |
| Generics              | Reusability                 |
| Utility types         | DRY types                   |
| Avoid `any`           | Type safety                 |
