# Namespace → flat export migration

Migrate `export namespace` to the `export * as` / flat-export pattern used by
effect-smol. Primary goal: tree-shakeability. Secondary: consistency with Effect
conventions, LLM-friendliness for future migrations.

## What changes and what doesn't

The **consumer API stays the same**. You still write `Provider.ModelNotFoundError`,
`Config.JsonError`, `Bus.publish`, etc. The namespace ergonomics are preserved.

What changes is **how** the namespace is constructed — the TypeScript
`export namespace` keyword is replaced by `export * as` in a barrel file. This
is a mechanical change: unwrap the namespace body into flat exports, add a
one-line barrel. Consumers that import `{ Provider }` don't notice.

Import paths actually get **nicer**. Today most consumers import from the
explicit file (`"../provider/provider"`). After the migration, each module has a
barrel `index.ts`, so imports become `"../provider"` or `"@/provider"`:

```ts
// BEFORE — points at the file directly
import { Provider } from "../provider/provider"

// AFTER — resolves to provider/index.ts, same Provider namespace
import { Provider } from "../provider"
```

## Why this matters right now

The CLI binary startup time (TOI) is too slow. Profiling shows we're loading
massive dependency graphs that are never actually used at runtime — because
bundlers cannot tree-shake TypeScript `export namespace` bodies.

### The problem in one sentence

`cli/error.ts` needs 6 lightweight `.isInstance()` checks on error classes, but
importing `{ Provider }` from `provider.ts` forces the bundler to include **all
20+ `@ai-sdk/*` packages**, `@aws-sdk/credential-providers`,
`google-auth-library`, and every other top-level import in that 1709-line file.

### Why `export namespace` defeats tree-shaking

TypeScript compiles `export namespace Foo { ... }` to an IIFE:

```js
// TypeScript output
export var Provider;
(function (Provider) {
  Provider.ModelNotFoundError = NamedError.create(...)
  // ... 1600 more lines of assignments ...
})(Provider || (Provider = {}))
```

This is **opaque to static analysis**. The bundler sees one big function call
whose return value populates an object. It cannot determine which properties are
used downstream, so it keeps everything. Every `import` statement at the top of
`provider.ts` executes unconditionally — that's 20+ AI SDK packages loaded into
memory just so the CLI can check `Provider.ModelNotFoundError.isInstance(x)`.

### What `export * as` does differently

`export * as Provider from "./provider"` compiles to a static re-export. The
bundler knows the exact shape of `Provider` at compile time — it's the named
export list of `./provider.ts`. When it sees `Provider.ModelNotFoundError` used
but `Provider.layer` unused, it can trace that `ModelNotFoundError` doesn't
reference `createAnthropic` or any AI SDK import, and drop them. The namespace
object still exists at runtime — same API — but the bundler can see inside it.

### Concrete impact

The worst import chain in the codebase:

```
src/index.ts (entry point)
  └── FormatError from src/cli/error.ts
        ├── { Provider } from provider/provider.ts     (1709 lines)
        │     ├── 20+ @ai-sdk/* packages
        │     ├── @aws-sdk/credential-providers
        │     ├── google-auth-library
        │     ├── gitlab-ai-provider, venice-ai-sdk-provider
        │     └── fuzzysort, remeda, etc.
        ├── { Config } from config/config.ts           (1663 lines)
        │     ├── jsonc-parser
        │     ├── LSPServer (all server definitions)
        │     └── Plugin, Auth, Env, Account, etc.
        └── { MCP } from mcp/index.ts                  (930 lines)
              ├── @modelcontextprotocol/sdk (3 transports)
              └── open (browser launcher)
```

All of this gets pulled in to check `.isInstance()` on 6 error classes — code
that needs maybe 200 bytes total. This inflates the binary, increases startup
memory, and slows down initial module evaluation.

### Why this also hurts memory

Every module-level import is eagerly evaluated. Even with Bun's fast module
loader, evaluating 20+ AI SDK factory functions, the AWS credential chain, and
Google's auth library allocates objects, closures, and prototype chains that
persist for the lifetime of the process. Most CLI commands never use a provider
at all.

## What effect-smol does

effect-smol achieves tree-shakeable namespaced APIs via three structural choices.

### 1. Each module is a separate file with flat named exports

```ts
// Effect.ts — no namespace wrapper, just flat exports
export const gen: { ... } = internal.gen
export const fail: <E>(error: E) => Effect<never, E> = internal.fail
export const succeed: <A>(value: A) => Effect<A> = internal.succeed
// ... 230+ individual named exports
```

### 2. Barrel file uses `export * as` (not `export namespace`)

```ts
// index.ts
export * as Effect from "./Effect.ts"
export * as Schema from "./Schema.ts"
export * as Stream from "./Stream.ts"
// ~134 modules
```

This creates a namespace-like API (`Effect.gen`, `Schema.parse`) but the
bundler knows the **exact shape** at compile time — it's the static export list
of that file. It can trace property accesses (`Effect.gen` → keep `gen`,
drop `timeout` if unused). With `export namespace`, the IIFE is opaque and
nothing can be dropped.

### 3. `sideEffects: []` and deep imports

```jsonc
// package.json
{ "sideEffects": [] }
```

Plus `"./*": "./src/*.ts"` in the exports map, enabling
`import * as Effect from "effect/Effect"` to bypass the barrel entirely.

### 4. Errors as flat exports, not class declarations

```ts
// Cause.ts
export const NoSuchElementErrorTypeId = core.NoSuchElementErrorTypeId
export interface NoSuchElementError extends YieldableError { ... }
export const NoSuchElementError: new(msg?: string) => NoSuchElementError = core.NoSuchElementError
export const isNoSuchElementError: (u: unknown) => u is NoSuchElementError = core.isNoSuchElementError
```

Each error is 4 independent exports: TypeId, interface, constructor (as const),
type guard. All individually shakeable.

## The plan

The core migration is **Phase 1** — convert `export namespace` to
`export * as`. Once that's done, the bundler can tree-shake individual exports
within each module. You do NOT need to break things into subfiles for
tree-shaking to work — the bundler traces which exports you actually access on
the namespace object and drops the rest, including their transitive imports.

Splitting errors/schemas into separate files (Phase 0) is optional — it's a
lower-risk warmup step that can be done before or after the main conversion, and
it provides extra resilience against bundler edge cases. But the big win comes
from Phase 1.

### Phase 0 (optional): Pre-split errors into subfiles

This is a low-risk warmup that provides immediate benefit even before the full
`export * as` conversion. It's optional because Phase 1 alone is sufficient for
tree-shaking. But it's a good starting point if you want incremental progress:

**For each namespace that defines errors** (15 files, ~30 error classes total):

1. Create a sibling `errors.ts` file (e.g. `provider/errors.ts`) with the error
   definitions as top-level named exports:

   ```ts
   // provider/errors.ts
   import z from "zod"
   import { NamedError } from "@opencode-ai/shared/util/error"
   import { ProviderID, ModelID } from "./schema"

   export const ModelNotFoundError = NamedError.create(
     "ProviderModelNotFoundError",
     z.object({
       providerID: ProviderID.zod,
       modelID: ModelID.zod,
       suggestions: z.array(z.string()).optional(),
     }),
   )

   export const InitError = NamedError.create("ProviderInitError", z.object({ providerID: ProviderID.zod }))
   ```

2. In the namespace file, re-export from the errors file to maintain backward
   compatibility:

   ```ts
   // provider/provider.ts — inside the namespace
   export { ModelNotFoundError, InitError } from "./errors"
   ```

3. Update `cli/error.ts` (and any other light consumers) to import directly:

   ```ts
   // BEFORE
   import { Provider } from "../provider/provider"
   Provider.ModelNotFoundError.isInstance(input)

   // AFTER
   import { ModelNotFoundError as ProviderModelNotFoundError } from "../provider/errors"
   ProviderModelNotFoundError.isInstance(input)
   ```

**Files to split (Phase 0):**

| Current file            | New errors file                 | Errors to extract                                                                                                       |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `provider/provider.ts`  | `provider/errors.ts`            | ModelNotFoundError, InitError                                                                                           |
| `provider/auth.ts`      | `provider/auth-errors.ts`       | OauthMissing, OauthCodeMissing, OauthCallbackFailed, ValidationFailed                                                   |
| `config/config.ts`      | (already has `config/paths.ts`) | ConfigDirectoryTypoError → move to paths.ts                                                                             |
| `config/markdown.ts`    | `config/markdown-errors.ts`     | FrontmatterError                                                                                                        |
| `mcp/index.ts`          | `mcp/errors.ts`                 | Failed                                                                                                                  |
| `session/message-v2.ts` | `session/message-errors.ts`     | OutputLengthError, AbortedError, StructuredOutputError, AuthError, APIError, ContextOverflowError                       |
| `session/message.ts`    | (shares with message-v2)        | OutputLengthError, AuthError                                                                                            |
| `cli/ui.ts`             | `cli/ui-errors.ts`              | CancelledError                                                                                                          |
| `skill/index.ts`        | `skill/errors.ts`               | InvalidError, NameMismatchError                                                                                         |
| `worktree/index.ts`     | `worktree/errors.ts`            | NotGitError, NameGenerationFailedError, CreateFailedError, StartCommandFailedError, RemoveFailedError, ResetFailedError |
| `storage/storage.ts`    | `storage/errors.ts`             | NotFoundError                                                                                                           |
| `npm/index.ts`          | `npm/errors.ts`                 | InstallFailedError                                                                                                      |
| `ide/index.ts`          | `ide/errors.ts`                 | AlreadyInstalledError, InstallFailedError                                                                               |
| `lsp/client.ts`         | `lsp/errors.ts`                 | InitializeError                                                                                                         |

### Phase 1: The real migration — `export namespace` → `export * as`

This is the phase that actually fixes tree-shaking. For each module:

1. **Unwrap** the `export namespace Foo { ... }` — remove the namespace wrapper,
   keep all the members as top-level `export const` / `export function` / etc.
2. **Rename** the file if it's currently `index.ts` (e.g. `bus/index.ts` →
   `bus/bus.ts`), so the barrel can take `index.ts`.
3. **Create the barrel** `index.ts` with one line: `export * as Foo from "./foo"`

The file structure change for a module that's currently a single file:

```
# BEFORE
provider/
  provider.ts        ← 1709-line file with `export namespace Provider { ... }`

# AFTER
provider/
  index.ts           ← NEW: `export * as Provider from "./provider"`
  provider.ts        ← SAME file, same name, just unwrap the namespace
```

And the code change is purely removing the wrapper:

```ts
// BEFORE: provider/provider.ts
export namespace Provider {
  export class Service extends Context.Service<...>()("@opencode/Provider") {}
  export const layer = Layer.effect(Service, ...)
  export const ModelNotFoundError = NamedError.create(...)
  export function parseModel(model: string) { ... }
}

// AFTER: provider/provider.ts — identical exports, no namespace keyword
export class Service extends Context.Service<...>()("@opencode/Provider") {}
export const layer = Layer.effect(Service, ...)
export const ModelNotFoundError = NamedError.create(...)
export function parseModel(model: string) { ... }
```

```ts
// NEW: provider/index.ts
export * as Provider from "./provider"
```

Consumer code barely changes — import path gets shorter:

```ts
// BEFORE
import { Provider } from "../provider/provider"

// AFTER — resolves to provider/index.ts, same Provider object
import { Provider } from "../provider"
```

All access like `Provider.ModelNotFoundError`, `Provider.Service`,
`Provider.layer` works exactly as before. The difference is invisible to
consumers but lets the bundler see inside the namespace.

**Once this is done, you don't need to break anything into subfiles for
tree-shaking.** The bundler traces that `Provider.ModelNotFoundError` only
depends on `NamedError` + `zod` + the schema file, and drops
`Provider.layer` + all 20 AI SDK imports when they're unused. This works because
`export * as` gives the bundler a static export list it can do inner-graph
analysis on — it knows which exports reference which imports.

**Order of conversion** (by risk / size, do small modules first):

1. Tiny utilities: `Archive`, `Color`, `Token`, `Rpc`, `LocalContext` (~7-66 lines each)
2. Small services: `Auth`, `Env`, `BusEvent`, `SessionStatus`, `SessionRunState`, `Editor`, `Selection` (~25-91 lines)
3. Medium services: `Bus`, `Format`, `FileTime`, `FileWatcher`, `Command`, `Question`, `Permission`, `Vcs`, `Project`
4. Large services: `Config`, `Provider`, `MCP`, `Session`, `SessionProcessor`, `SessionPrompt`, `ACP`

### Phase 2: Build configuration

After the module structure supports tree-shaking:

1. Add `"sideEffects": []` to `packages/opencode/package.json` (or
   `"sideEffects": false`) — this is safe because our services use explicit
   layer composition, not import-time side effects.
2. Verify Bun's bundler respects the new structure. If Bun's tree-shaking is
   insufficient, evaluate whether the compiled binary path needs an esbuild
   pre-pass.
3. Consider adding `/*#__PURE__*/` annotations to `NamedError.create(...)` calls
   — these are factory functions that return classes, and bundlers may not know
   they're side-effect-free without the annotation.

## Automation

The transformation is scripted. From `packages/opencode`:

```bash
bun script/unwrap-namespace.ts <file> [--dry-run]
```

The script uses ast-grep for accurate AST-based namespace boundary detection
(no false matches from braces in strings/templates/comments), then:

1. Removes the `export namespace Foo {` line and its closing `}`
2. Dedents the body by one indent level (2 spaces)
3. If the file is `index.ts`, renames it to `<name>.ts` and creates a new
   `index.ts` barrel
4. If the file is NOT `index.ts`, rewrites it in place and creates `index.ts`
5. Prints the exact commands to find and rewrite import paths

### Walkthrough: converting a module

Using `Provider` as an example:

```bash
# 1. Preview what will change
bun script/unwrap-namespace.ts src/provider/provider.ts --dry-run

# 2. Apply the transformation
bun script/unwrap-namespace.ts src/provider/provider.ts

# 3. Rewrite import paths (script prints the exact command)
rg -l 'from.*provider/provider' src/ | xargs sed -i '' 's|provider/provider"|provider"|g'

# 4. Verify
bun typecheck
bun run test
```

**What changes on disk:**

```
# BEFORE
provider/
  provider.ts        ← 1709 lines, `export namespace Provider { ... }`

# AFTER
provider/
  index.ts           ← NEW: `export * as Provider from "./provider"`
  provider.ts        ← same file, namespace unwrapped to flat exports
```

**What changes in consumer code:**

```ts
// BEFORE
import { Provider } from "../provider/provider"

// AFTER — shorter path, same Provider object
import { Provider } from "../provider"
```

All property access (`Provider.Service`, `Provider.ModelNotFoundError`, etc.)
stays identical.

### Two cases the script handles

**Case A: file is NOT `index.ts`** (e.g. `provider/provider.ts`)

- Rewrites the file in place (unwrap + dedent)
- Creates `provider/index.ts` as the barrel
- Import paths change: `"../provider/provider"` → `"../provider"`

**Case B: file IS `index.ts`** (e.g. `bus/index.ts`)

- Renames `index.ts` → `bus.ts` (kebab-case of namespace name)
- Creates new `index.ts` as the barrel
- **No import rewrites needed** — `"@/bus"` already resolves to `bus/index.ts`

## Do I need to split errors/schemas into subfiles?

**No.** Once you do the `export * as` conversion, the bundler can tree-shake
individual exports within the file. If `cli/error.ts` only accesses
`Provider.ModelNotFoundError`, the bundler traces that `ModelNotFoundError`
doesn't reference `createAnthropic` and drops the AI SDK imports.

Splitting into subfiles (errors.ts, schema.ts) is still a fine idea for **code
organization** — smaller files are easier to read and review. But it's not
required for tree-shaking. The `export * as` conversion alone is sufficient.

The one case where subfile splitting provides extra tree-shake value is if an
imported package has module-level side effects that the bundler can't prove are
unused. In practice this is rare — most npm packages are side-effect-free — and
adding `"sideEffects": []` to package.json handles the common cases.

## Scope

| Metric                                          | Count           |
| ----------------------------------------------- | --------------- |
| Files with `export namespace`                   | 106             |
| Total namespace declarations                    | 118 (12 nested) |
| Files with `NamedError.create` inside namespace | 15              |
| Total error classes to extract                  | ~30             |
| Files using `export * as` today                 | 0               |

Phase 1 (the `export * as` conversion) is the main change. It's mechanical and
LLM-friendly but touches every import site, so it should be done module by
module with type-checking between each step. Each module is an independent PR.

## Rules for new code

Going forward:

- **No new `export namespace`**. Use a file with flat named exports and
  `export * as` in the barrel.
- Keep the service, layer, errors, schemas, and runtime wiring together in one
  file if you want — that's fine now. The `export * as` barrel makes everything
  individually shakeable regardless of file structure.
- If a file grows large enough that it's hard to navigate, split by concern
  (errors.ts, schema.ts, etc.) for readability. Not for tree-shaking — the
  bundler handles that.

## Circular import rules

Barrel files (`index.ts` with `export * as`) introduce circular import risks.
These cause `ReferenceError: Cannot access 'X' before initialization` at
runtime — not caught by the type checker.

### Rule 1: Sibling files never import through their own barrel

Files in the same directory must import directly from the source file, never
through `"."` or `"@/<own-dir>"`:

```ts
// BAD — circular: index.ts re-exports both files, so A → index → B → index → A
import { Sibling } from "."

// GOOD — direct, no cycle
import * as Sibling from "./sibling"
```

### Rule 2: Cross-directory imports must not form cycles through barrels

If `src/lsp/lsp.ts` imports `Config` from `"../config"`, and
`src/config/config.ts` imports `LSPServer` from `"../lsp"`, that's a cycle:

```
lsp/lsp.ts → config/index.ts → config/config.ts → lsp/index.ts → lsp/lsp.ts 💥
```

Fix by importing the specific file, breaking the cycle:

```ts
// In config/config.ts — import directly, not through the lsp barrel
import * as LSPServer from "../lsp/server"
```

### Why the type checker doesn't catch this

TypeScript resolves types lazily — it doesn't evaluate module-scope
expressions. The `ReferenceError` only happens at runtime when a module-scope
`const` or function call accesses a value from a circular dependency that
hasn't finished initializing. The SDK build step (`bun run --conditions=browser
./src/index.ts generate`) is the reliable way to catch these because it
evaluates all modules eagerly.

### How to verify

After any namespace conversion, run:

```bash
cd packages/opencode
bun run --conditions=browser ./src/index.ts generate
```

If this completes without `ReferenceError`, the module graph is safe.
