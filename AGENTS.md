# OpenCode Agent Guidelines

## Project Overview

Monorepo using Bun workspaces. Main packages:

- `packages/opencode` — CLI backend (Node.js/Bun)
- `packages/app` — SolidJS web app
- `packages/ui` — Shared UI components
- `packages/sdk/js` — JavaScript SDK

## Commands

### Build & Type Check

```bash
bun turbo build                           # Build all packages
bun run --cwd packages/opencode build     # Build opencode only
bun typecheck                             # Type check all packages
bun run --cwd packages/opencode typecheck # Type check opencode (never use tsc directly)
bun run --cwd packages/app typecheck      # Type check app
```

### Testing

```bash
# OpenCode package tests
bun run --cwd packages/opencode test                              # Run all tests
bun test --cwd packages/opencode test/agent/agent.test.ts         # Run single test file
bun test --cwd packages/opencode -t "timeout"                     # Run tests matching pattern
bun test --cwd packages/opencode -t "should resolve" test/util/*  # Run specific test in file

# App tests
bun run --cwd packages/app test:unit      # Unit tests
bun run --cwd packages/app test:unit:watch # Unit tests (watch mode)
bun run --cwd packages/app test:e2e       # E2E tests (Playwright)
bun run --cwd packages/app test:e2e:ui    # E2E tests with UI
```

**CRITICAL**: Tests cannot run from repo root. Always run from package directories.

### Formatting & Database

```bash
bunx prettier --write <file>              # Format file (semi: false, printWidth: 120)
bun run db generate --name <slug>         # Generate migration (from packages/opencode)
bun ./packages/sdk/js/script/build.ts     # SDK generation
```

## Local Development

`opencode dev web` proxies `https://app.opencode.ai` — local UI changes won't appear. For local UI changes, run servers separately:

```bash
# Terminal 1 - Backend (from packages/opencode)
bun run --conditions=browser ./src/index.ts serve --port 4096

# Terminal 2 - App (from packages/app)
bun dev -- --port 4444

# Open http://localhost:4444 (targets backend at localhost:4096)
```

- **NEVER** restart the app or server process during debugging

## Code Style

### General Principles

- Keep logic in one function unless composable/reusable
- Avoid `try`/`catch` — prefer Effect's error handling
- Avoid `any` type
- Use Bun APIs when possible (e.g., `Bun.file()`)
- Rely on type inference; explicit types only for exports
- Prefer functional array methods (flatMap, filter, map) over for loops

### Naming (MANDATORY)

Single word by default. Multi-word only when clarity requires it.

```ts
// Good: pid, cfg, err, opts, dir, root, child, state, timeout
// Bad: inputPID, existingClient, connectTimeout, workerPath

// Good
const foo = 1
function journal(dir: string) {}
const data = await Bun.file(path.join(dir, "file.json")).json()

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
const filePath = path.join(dir, "file.json")
```

### Destructuring & Control Flow

```ts
// Prefer dot notation
obj.a // Good
const { a } = obj // Bad

// Prefer const with ternary
const foo = condition ? 1 : 2 // Good

// Prefer early returns (no else after return)
function foo() {
  if (condition) return 1
  return 2
}
```

### Imports

Group: external packages → internal (`@/`) → relative:

```ts
import { Effect, Schema } from "effect"
import { Database } from "@/storage/db"
import { AccountTable } from "./account.sql"
```

### Schema Definitions (Drizzle)

Use snake_case for field names:

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
})
```

## Effect Library (Backend)

- Use `Effect.gen(function* () { ... })` for composition
- Use `Effect.fn("Domain.method")` for named effects
- Use `Schema.Class` for multi-field data, `Schema.brand` for single-value types
- Use `Schema.TaggedErrorClass` for typed errors
- Prefer Effect services: `FileSystem`, `ChildProcessSpawner`, `HttpClient`, `Path`, `Clock`

## SolidJS (App/UI)

- Always prefer `createStore` over multiple `createSignal` calls
- Use `splitProps` to separate local props from rest props
- Use `createMemo` for derived state
- Use `createSimpleContext` from `@opencode-ai/ui/context` for context creation

```tsx
export function Link(props: LinkProps) {
  const platform = usePlatform()
  const [local, rest] = splitProps(props, ["href", "children", "class"])

  return (
    <a href={local.href} class={`text-text-strong underline ${local.class ?? ""}`} {...rest}>
      {local.children}
    </a>
  )
}
```

## Browser Automation (App)

Use `agent-browser` for web automation. Core workflow:

1. `agent-browser open <url>` - Navigate to page
2. `agent-browser snapshot -i` - Get interactive elements with refs (@e1, @e2)
3. `agent-browser click @e1` / `fill @e2 "text"` - Interact using refs
4. Re-snapshot after page changes

## Testing

- Avoid mocks; test actual implementation
- Use `tmpdir` fixture for temporary directories:

```ts
import { describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir({ git: true })
})
```

## Git

- Default branch is `dev` (not `main`)
- Local `main` may not exist; use `dev` or `origin/dev` for diffs

## Notes

- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE
- Package manager: Bun 1.3.11
- TypeScript: 5.8.2
- Prettier: `semi: false`, `printWidth: 120`
