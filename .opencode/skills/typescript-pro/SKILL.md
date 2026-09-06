---
name: typescript-pro
description: Implements advanced TypeScript type systems, creates custom type guards, utility types, and branded types, and configures tRPC for end-to-end type safety. Use when building TypeScript applications requiring advanced generics, conditional or mapped types, discriminated unions, monorepo setup, or full-stack type safety with tRPC.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: language
  triggers: TypeScript, generics, type safety, conditional types, mapped types, tRPC, tsconfig, type guards, discriminated unions
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, api-designer
---

# TypeScript Pro

## Core Workflow

1. **Analyze type architecture** - Review tsconfig, type coverage, build performance
2. **Design type-first APIs** - Create branded types, generics, utility types
3. **Implement with type safety** - Write type guards, discriminated unions, conditional types; run `tsc --noEmit` to catch type errors before proceeding
4. **Optimize build** - Configure project references, incremental compilation, tree shaking; re-run `tsc --noEmit` to confirm zero errors after changes
5. **Test types** - Confirm type coverage with a tool like `type-coverage`; validate that all public APIs have explicit return types; iterate on steps 3–4 until all checks pass

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Advanced Types | `references/advanced-types.md` | Generics, conditional types, mapped types, template literals |
| Type Guards | `references/type-guards.md` | Type narrowing, discriminated unions, assertion functions |
| Utility Types | `references/utility-types.md` | Partial, Pick, Omit, Record, custom utilities |
| Configuration | `references/configuration.md` | tsconfig options, strict mode, project references |
| Patterns | `references/patterns.md` | Builder pattern, factory pattern, type-safe APIs |

## Code Examples

### Branded Types
```typescript
// Branded type for domain modeling
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId  = Brand<string, "UserId">;
type OrderId = Brand<number, "OrderId">;

const toUserId  = (id: string): UserId  => id as UserId;
const toOrderId = (id: number): OrderId => id as OrderId;

// Usage — prevents accidental id mix-ups at compile time
function getOrder(userId: UserId, orderId: OrderId) { /* ... */ }
```

### Discriminated Unions & Type Guards
```typescript
type LoadingState = { status: "loading" };
type SuccessState = { status: "success"; data: string[] };
type ErrorState   = { status: "error";   error: Error };
type RequestState = LoadingState | SuccessState | ErrorState;

// Type predicate guard
function isSuccess(state: RequestState): state is SuccessState {
  return state.status === "success";
}

// Exhaustive switch with discriminated union
function renderState(state: RequestState): string {
  switch (state.status) {
    case "loading": return "Loading…";
    case "success": return state.data.join(", ");
    case "error":   return state.error.message;
    default: {
      const _exhaustive: never = state;
      throw new Error(`Unhandled state: ${_exhaustive}`);
    }
  }
}
```

### Custom Utility Types
```typescript
// Deep readonly — immutable nested objects
type DeepReadonly<T> = {
  readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K];
};

// Require exactly one of a set of keys
type RequireExactlyOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> &
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Record<Exclude<Keys, K>, never>> }[Keys];
```

### Recommended tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "incremental": true,
    "skipLibCheck": false
  }
}
```

## Constraints

### MUST DO
- Enable strict mode with all compiler flags
- Use type-first API design
- Implement branded types for domain modeling
- Use `satisfies` operator for type validation
- Create discriminated unions for state machines
- Use `Annotated` pattern with type predicates
- Generate declaration files for libraries
- Optimize for type inference

### MUST NOT DO
- Use explicit `any` without justification
- Skip type coverage for public APIs
- Mix type-only and value imports
- Disable strict null checks
- Use `as` assertions without necessity
- Ignore compiler performance warnings
- Skip declaration file generation
- Use enums (prefer const objects with `as const`)

## Output Templates

When implementing TypeScript features, provide:
1. Type definitions (interfaces, types, generics)
2. Implementation with type guards
3. tsconfig configuration if needed
4. Brief explanation of type design decisions

## Knowledge Reference

TypeScript 5.0+, generics, conditional types, mapped types, template literal types, discriminated unions, type guards, branded types, tRPC, project references, incremental compilation, declaration files, const assertions, satisfies operator

[Documentation](https://jeffallan.github.io/claude-skills/skills/language/typescript-pro/)
