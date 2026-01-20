# Coding Conventions

**Analysis Date:** 2026-01-19

## Naming Patterns

**Files:**
- Lowercase with hyphens for multi-word: `oauth-provider.ts`, `bus-event.ts`
- Single lowercase word preferred: `index.ts`, `agent.ts`, `config.ts`
- Test files: `*.test.ts` co-located or in `test/` directory mirroring `src/`

**Functions:**
- camelCase for regular functions: `ascending()`, `shouldLog()`, `formatError()`
- PascalCase for factory/creator functions exported from namespaces: `NamedError.create()`

**Variables:**
- Prefer single-word names: `level`, `result`, `write`, `tags`
- camelCase for multi-word when necessary: `lastTimestamp`, `levelPriority`
- Uppercase snake_case for constants within namespace sets: `FOLDERS`, `FILES`, `PATTERNS`

**Types:**
- PascalCase for types/interfaces: `Logger`, `Options`, `Level`
- Namespaces wrap related types and functions: `Log.Level`, `Log.Logger`
- Zod schemas exported with same name as inferred type:
  ```typescript
  export const Level = z.enum(["DEBUG", "INFO", "WARN", "ERROR"])
  export type Level = z.infer<typeof Level>
  ```

**Namespaces:**
- PascalCase module namespaces: `Lock`, `Log`, `FileIgnore`, `Identifier`, `ProviderTransform`
- Group related functions, types, and constants together
- Export functions directly from namespace: `Lock.read()`, `Log.create()`

## Code Style

**Formatting:**
- Prettier configured in root `package.json`
- No semicolons: `"semi": false`
- Print width 120: `"printWidth": 120`

**Indentation:**
- 2 spaces (from `.editorconfig`)
- LF line endings
- UTF-8 charset
- Insert final newline

**Linting:**
- ESLint with TypeScript parser (in `sdks/vscode/`)
- Rules: `curly: "warn"`, `eqeqeq: "warn"`, `no-throw-literal: "warn"`
- Import naming: camelCase or PascalCase

## Import Organization

**Order:**
1. External packages (node built-ins, npm packages)
2. Internal workspace packages (`@opencode-ai/util`, `@opencode-ai/sdk`)
3. Relative imports from same package

**Path Aliases:**
- `@/*` maps to `./src/*` in opencode package
- `@tui/*` maps to `./src/cli/cmd/tui/*`
- Configured in `tsconfig.json` with `paths`

**Example:**
```typescript
import z from "zod"
import path from "path"
import fs from "fs/promises"
import { NamedError } from "@opencode-ai/util/error"
import { Global } from "../global"
import type { Provider } from "./provider"
```

## Error Handling

**Patterns:**
- Use `NamedError.create()` for typed errors with Zod schemas
- Errors include `.data` property with typed payload
- Avoid try/catch where possible (per STYLE_GUIDE.md)
- Let errors propagate rather than swallowing

**Error Definition:**
```typescript
export const OutputLengthError = NamedError.create("MessageOutputLengthError", z.object({}))
export const AuthError = NamedError.create(
  "ProviderAuthError",
  z.object({
    providerID: z.string(),
    message: z.string(),
  }),
)
```

**Error Checking:**
```typescript
if (ErrorClass.isInstance(error)) {
  // handle typed error
}
```

## Logging

**Framework:** Custom `Log` namespace in `packages/opencode/src/util/log.ts`

**Patterns:**
- Create tagged loggers: `Log.create({ service: "provider" })`
- Log levels: DEBUG, INFO, WARN, ERROR
- Include structured extra data: `log.info("message", { key: "value" })`
- Use `.time()` for duration logging with `using` syntax

**When to Log:**
- INFO for significant operations starting/completing
- DEBUG for internal state details
- ERROR for failures that should be investigated
- WARN for recoverable issues

## Comments

**When to Comment:**
- Comment the "why", not the "what"
- JSDoc not widely used in codebase
- Inline comments for non-obvious logic

**Example from codebase:**
```typescript
// Strip null bytes from paths (defensive fix for CI environment issues)
function sanitizePath(p: string): string {
  return p.replace(/\0/g, "")
}
```

## Function Design

**Style Guide Rules (from STYLE_GUIDE.md):**

**Avoid `let` statements:**
```typescript
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

**Avoid `else` statements:**
```typescript
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

**Avoid unnecessary destructuring:**
```typescript
// Preferred - preserves context
obj.a
obj.b

// Avoid
const { a, b } = obj
```

**Single-word naming preferred:**
```typescript
// Good
const foo = 1
const bar = 2

// Only if necessary
const fooBar = 1
```

**Use Bun APIs:**
- Prefer `Bun.file()`, `Bun.Glob`, `Bun.write()` over Node.js equivalents
- Use `bun:test` for testing

**Use `iife` for inline expressions:**
```typescript
import { iife } from "@/util/iife"

const result = iife(() => {
  if (condition) return "a"
  return "b"
})
```

## Module Design

**Exports:**
- Namespace pattern for module grouping
- Types and functions exported from namespace
- Avoid default exports

**Barrel Files:**
- `index.ts` files re-export from directory modules
- Example: `packages/opencode/src/util/` has multiple utility modules

**Module Structure:**
```typescript
export namespace ModuleName {
  // Types
  export const Schema = z.object({...})
  export type Type = z.infer<typeof Schema>

  // Private state
  const privateState = new Map()

  // Private helpers
  function privateHelper() {...}

  // Public API
  export function publicMethod() {...}
  export async function asyncPublicMethod() {...}
}
```

## TypeScript Specifics

**Type Safety:**
- Avoid `any` type (per STYLE_GUIDE.md)
- Use Zod for runtime validation and type inference
- Discriminated unions for state machines

**Async/Disposable Pattern:**
```typescript
// Using Symbol.asyncDispose for cleanup
const result = {
  [Symbol.asyncDispose]: async () => {
    await cleanup()
  },
  path: realpath,
}

// Usage
await using tmp = await tmpdir()
```

**`using` Syntax:**
```typescript
using writer = await Lock.write(key)
// automatically disposed when scope exits
```

---

*Convention analysis: 2026-01-19*
